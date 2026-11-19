// valet-pilot: links this Claude app session to the Concierge Valet hub on the same Mac, so the owner can follow the session, prompt it and answer its questions and permission requests from his Valet thread while he is away from the Mac. Talks only to the hub's private Unix socket.
import type { EngineInterface, Register } from 'claude-code'

type Command = { id: string; kind: 'prompt' | 'read' | 'hello'; text?: string; count?: number }
type Answer = { decision?: string; answers?: Record<string, string>; text?: string }

const AWAY_SECONDS = 120
const BACK_SECONDS = 20
const link = { sock: '', id: '', title: '', live: false }

async function hub<T>($: EngineInterface, method: string, path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await $.http.fetch(`http://hub${path}`, {
      method,
      socketPath: link.sock,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.ok ? (JSON.parse(res.text || '{}') as T) : null
  } catch {
    return null
  }
}

function tell($: EngineInterface, kind: string, more: Record<string, unknown> = {}): void {
  if (link.live && link.id) void hub($, 'POST', '/event', { session: link.id, kind, title: link.title, ...more })
}

async function greet($: EngineInterface): Promise<void> {
  if (!link.title) {
    const first = (await $.session.messages()).find((m) => m.role === 'user' && m.text.trim())
    if (first) link.title = first.text.trim().replace(/\s+/g, ' ').slice(0, 60)
  }
  tell($, 'hello', { cwd: await $.session.cwd(), root: await $.session.root(), model: await $.session.model() })
}

async function idle($: EngineInterface): Promise<number | null> {
  const got = await hub<{ idle?: number }>($, 'GET', '/presence')
  return got && typeof got.idle === 'number' && got.idle >= 0 ? got.idle : null
}

async function away($: EngineInterface): Promise<boolean> {
  if (!link.live || !link.id) return false
  const seconds = await idle($)
  return seconds !== null && seconds >= AWAY_SECONDS
}

async function ask($: EngineInterface, signal: AbortSignal, body: Record<string, unknown>): Promise<Answer | null> {
  const id = String(body.id)
  const sent = await hub<{ ok?: boolean }>($, 'POST', '/ask', { session: link.id, ...body })
  if (!sent?.ok) return null
  for (;;) {
    if (signal.aborted) {
      await hub($, 'POST', '/ask/end', { id, why: 'aborted' })
      return null
    }
    const got = await hub<{ answer?: Answer; gone?: boolean }>($, 'GET', `/ask/wait?id=${encodeURIComponent(id)}`)
    if (got?.answer) return got.answer
    if (!got || got.gone) return null
    const seconds = await idle($)
    if (seconds !== null && seconds < BACK_SECONDS) {
      await hub($, 'POST', '/ask/end', { id, why: 'local' })
      return null
    }
  }
}

function describe(tool: string, input: unknown): string {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const pick = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : '')
  const text = pick('command') || pick('file_path') || pick('notebook_path') || pick('url') || pick('path') || JSON.stringify(args)
  return text.slice(0, 1500)
}

async function loop($: EngineInterface): Promise<void> {
  let wait = 5000
  try {
    link.id = await $.session.id()
    const asked = await $.clock.now()
    const got = await hub<{ cmd?: Command }>($, 'GET', `/next?session=${encodeURIComponent(link.id)}`)
    const cmd = got?.cmd
    if (got) wait = cmd || (await $.clock.now()) - asked > 1500 ? 50 : 2000
    if (cmd?.kind === 'hello') {
      await greet($)
    } else if (cmd?.kind === 'prompt' && cmd.text) {
      void $.prompt.submit({ text: cmd.text, asUser: true })
      await hub($, 'POST', '/result', { id: cmd.id, ok: true, data: {} })
    } else if (cmd?.kind === 'read') {
      const all = await $.session.messages()
      const messages = all.slice(-(cmd.count ?? 8)).map((m) => ({
        role: m.role,
        text: m.text.slice(0, 1600),
        tools: [...new Set(m.toolUses.map((t) => t.tool))].slice(0, 12),
      }))
      await hub($, 'POST', '/result', { id: cmd.id, ok: true, data: { messages } })
    }
  } catch {
    wait = 5000
  }
  if (link.live) $.clock.after(wait, () => void loop($))
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    const home = await $.env.get('HOME')
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop' || !home) return out
    link.sock = `${home}/.valet-pilot/hub.sock`
    link.id = await $.session.id()
    link.live = true
    void greet($)
    $.clock.after(300, () => void loop($))
    return out
  })

  on('classic.SessionStart', ($, e, next) => {
    if (e.session_title) link.title = e.session_title
    return next(e)
  })

  on('classic.UserPromptSubmit', ($, e, next) => {
    if (e.session_title) link.title = e.session_title
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) tell($, 'start', { prompt: e.text.slice(0, 80) })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (e.agentId === undefined) tell($, 'done', { answer: e.answer.slice(0, 4000), reason: e.reason, durationMs: e.durationMs })
    return out
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || e.tool_use_id === undefined || e.approver === undefined) return verdict
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode' || !(await away($))) return verdict
    const got = await ask($, next.signal, {
      id: e.tool_use_id,
      kind: 'permission',
      tool: e.tool,
      summary: describe(e.tool, e.input),
      reason: verdict.reason ?? '',
      agent: e.agentId !== undefined,
    })
    if (got?.decision === 'allow') return { decision: 'allow', reason: 'Allowed by the owner through Concierge Valet.' }
    if (got?.decision === 'deny') {
      return { decision: 'deny', reason: got.text ? `The owner declined this through Concierge Valet: ${got.text}` : 'The owner declined this through Concierge Valet.' }
    }
    return verdict
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.tool !== 'AskUserQuestion' || e.agentId !== undefined || e.tool_use_id === undefined || !(await away($))) return next(e)
    const got = await ask($, next.signal, {
      id: e.tool_use_id,
      kind: 'question',
      tool: e.tool,
      summary: e.questions.map((q) => q.question).join('\n'),
      questions: e.questions.map((q) => ({
        question: q.question,
        header: q.header,
        multi: q.multiSelect,
        options: q.options.map((o) => ({ label: o.label, description: o.description })),
      })),
    })
    if (got?.decision === 'answer' && got.answers && Object.keys(got.answers).length) return { result: { questions: e.questions, answers: got.answers } }
    if (got?.decision === 'answer' && got.text) return { result: { questions: e.questions, answers: {}, response: got.text } }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    if (link.live) void hub($, 'POST', '/event', { session: e.sessionId, kind: 'bye' })
    if (e.reason !== 'clear') link.live = false
    return next(e)
  })
}
