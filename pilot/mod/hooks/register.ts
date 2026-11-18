// valet-pilot: links this Claude app session to the Concierge Valet hub on the same Mac, so the owner can follow the session and prompt it from his Valet thread. Talks only to the hub's private Unix socket.
import type { EngineInterface, Register } from 'claude-code'

type Command = { id: string; kind: 'prompt' | 'read' | 'hello'; text?: string; count?: number }

const link = { sock: '', id: '', title: '', live: false }

async function hub($: EngineInterface, method: string, path: string, body?: unknown): Promise<{ cmd?: Command } | null> {
  try {
    const res = await $.http.fetch(`http://hub${path}`, {
      method,
      socketPath: link.sock,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.ok ? JSON.parse(res.text || '{}') : null
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

async function loop($: EngineInterface): Promise<void> {
  let wait = 5000
  try {
    link.id = await $.session.id()
    const asked = await $.clock.now()
    const got = await hub($, 'GET', `/next?session=${encodeURIComponent(link.id)}`)
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

  on('session.end', ($, e, next) => {
    if (link.live) void hub($, 'POST', '/event', { session: e.sessionId, kind: 'bye' })
    if (e.reason !== 'clear') link.live = false
    return next(e)
  })
}
