/* Valet: the one thread. Stores messages, runs chat turns and due reminders in the alarm, serves clients over HTTP and WebSocket. */
import { DurableObject } from "cloudflare:workers";
import { ask, explain, extract, label } from "./agent.mjs";
import { SYSTEM, BRIEF_SYSTEM } from "./prompt.mjs";
import { chatTools } from "./tools.mjs";
import { clockOf, findTitles, image, title, titleList, youtube } from "./connectors.mjs";
import { calendarOn, changeEvent, createEvent, discover, listEvents, parts, removeEvent } from "./calendar.mjs";
import { sendPush } from "./push.mjs";
import { cost, dayKey, fromLocal, hm, human, isoLocal, json, local, nextAt, nextRepeat, parseLocal, sign } from "./util.mjs";

const PIXELS = ["..1111..", ".114411.", "11111111", ".22..22.", ".22..22.", "........", ".3....3.", "..3333.."];
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];
const AVATARS = ["orbita", "buzka", "piksel"];
const CHUNK = 1000000;
const CARDS = { task: " (rozpoczęte zadanie w tle)", sky: " (karta pogody)", brief: " (brief)", remind: " (przypomnienie)", agenda: " (karta kalendarza)", event: " (karta wydarzenia w kalendarzu)", videos: " (karta z filmami z YouTube)", title: " (karta filmu lub serialu)", titles: " (karta z plakatami tytułów)", image: " (wygenerowany obrazek)" };
const names = (list) => list.map((p) => p.name).join(", ");
const SYNC = 30 * 60000;
const dayLabel = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "short", day: "numeric", month: "short" });
const rangeDay = new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "long", day: "numeric", month: "long" });
const shiftDay = (p, n) => { const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: p.h || 0, mi: p.mi || 0 }; };
const ms = (p) => fromLocal(p.y, p.mo, p.d, p.h || 0, p.mi || 0);
const span = (e) => (e.allDay ? (e.end - e.start > 86400000 ? `${dayLabel.format(e.start)} do ${dayLabel.format(e.end - 3600000)}, cały dzień` : `${dayLabel.format(e.start)}, cały dzień`) : `${dayLabel.format(e.start)} ${hm(e.start)}-${hm(e.end)}`);
const eventLine = (e) => `[${e.id}] ${span(e)}: ${e.title}${e.location ? ` @ ${e.location}` : ""} (${e.cal}${e.recurring ? ", repeats" : ""})`;
const publicEvent = (e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, cal: e.cal, color: e.color, location: e.location, recurring: !!e.recurring });
function shortId(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function defaults(env) {
  return {
    owner: "Jurek",
    models: { chat: env.CHAT_MODEL || MODELS[0], text: env.TEXT_MODEL || MODELS[1], docs: env.DOC_MODEL || MODELS[2] },
    dailyUsd: +(env.DAILY_USD || 6),
    city: { name: "Warszawa", lat: 52.23, lon: 21.01 },
    briefs: { daily: true, weekly: true, hour: 7, minute: 0 },
    calendar: { nudge: 30, home: "", hidden: [] },
    agents: {
      valet: { name: "Valet", role: "Rozmawia z Tobą i rozdziela pracę", avatar: { type: "orbita", cfg: { pk: "#ffffff", ink: "#1d1c19", acc: "#1f5a46", sats: 1, tilt: -24 } } },
      atelier: { name: "Atelier", role: "Dokumenty i rzeczy wizualne", avatar: { type: "buzka", cfg: { pk: "#1f5a46", ink: "#f8f6f1", acc: "#f8f6f1", eye: "pill", gap: 13, mouth: "none" } } },
      kurier: { name: "Kurier", role: "Briefy i tekst", avatar: { type: "piksel", cfg: { pk: "#ffffff", ink: "#1d1c19", acc: "#1f5a46", px: PIXELS } } },
    },
  };
}

export class Valet extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.live = null;
    const s = this.sql;
    s.exec("CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, who TEXT, agent TEXT, kind TEXT, text TEXT, data TEXT, reply_to INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, updated INTEGER, title TEXT, kind TEXT, format TEXT, agent TEXT, model TEXT, status TEXT, step TEXT, origin INTEGER, card INTEGER, ref TEXT, usd REAL DEFAULT 0)");
    s.exec("CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, ts INTEGER, name TEXT, mime TEXT, size INTEGER, task INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, text TEXT)");
    s.exec("CREATE TABLE IF NOT EXISTS sched (id INTEGER PRIMARY KEY AUTOINCREMENT, due INTEGER, repeat TEXT, text TEXT, builtin TEXT)");
    s.exec("CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, body TEXT, ts INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL, calls INTEGER)");
    s.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    s.exec("CREATE TABLE IF NOT EXISTS blobs (id TEXT, seq INTEGER, data BLOB, PRIMARY KEY (id, seq))");
    ctx.blockConcurrencyWhile(async () => { this.seed(); await this.rearm(); });
  }

  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  get(k, fallback = null) { const r = this.rows("SELECT v FROM kv WHERE k = ?", k)[0]; return r ? JSON.parse(r.v) : fallback; }
  put(k, v) { this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v)); }

  saveBlob(id, bytes) {
    for (let seq = 0, off = 0; off < bytes.length; seq++, off += CHUNK) this.sql.exec("INSERT INTO blobs (id, seq, data) VALUES (?, ?, ?)", id, seq, bytes.slice(off, off + CHUNK).buffer);
  }

  readBlob(id) {
    const parts = this.rows("SELECT data FROM blobs WHERE id = ? ORDER BY seq", id).map((r) => new Uint8Array(r.data));
    if (!parts.length) return null;
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  settings() {
    const d = defaults(this.env), s = this.get("settings", {});
    const agents = {};
    for (const k of Object.keys(d.agents)) agents[k] = { ...d.agents[k], ...(s.agents?.[k] || {}) };
    return { ...d, ...s, models: { ...d.models, ...s.models }, city: { ...d.city, ...s.city }, briefs: { ...d.briefs, ...s.briefs }, calendar: { ...d.calendar, ...s.calendar }, agents };
  }

  seed() {
    const b = this.settings().briefs, now = Date.now();
    const has = (name) => this.rows("SELECT id FROM sched WHERE builtin = ?", name).length > 0;
    const want = { daily: b.daily ? nextAt(b.hour, b.minute, now) : null, weekly: b.weekly ? nextAt(b.hour, b.minute, now, (x) => x.wd === 0) : null };
    for (const [name, due] of Object.entries(want)) {
      if (!due) this.sql.exec("DELETE FROM sched WHERE builtin = ?", name);
      else if (!has(name)) this.sql.exec("INSERT INTO sched (due, repeat, text, builtin) VALUES (?, ?, ?, ?)", due, name === "daily" ? "daily" : "weekly", name === "daily" ? "Poranny brief" : "Weekly Briefing", name);
    }
  }

  broadcast(event) {
    const text = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(text); } catch (e) {} }
  }

  status(state, text = "", turn = false) {
    this.live = state === "idle" ? null : { state, text, turn };
    this.broadcast({ t: "status", ...this.currentStatus() });
  }

  currentStatus() {
    if (this.live) return this.live;
    const running = this.rows("SELECT title, step FROM tasks WHERE status = 'running' ORDER BY id DESC LIMIT 1")[0];
    return running ? { state: "working", text: running.step || "Pracuje w tle" } : { state: "idle", text: "" };
  }

  post({ who, agent = null, kind = "text", text = "", data = null, reply_to = null }) {
    const ts = Date.now();
    const id = this.sql.exec("INSERT INTO msgs (ts, who, agent, kind, text, data, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id", ts, who, agent, kind, text, data ? JSON.stringify(data) : null, reply_to).one().id;
    const m = { id, ts, who, agent, kind, text, data, reply_to };
    this.broadcast({ t: "msg", m });
    return m;
  }

  msgs(before = null, limit = 80) {
    const list = before ? this.rows("SELECT * FROM msgs WHERE id < ? ORDER BY id DESC LIMIT ?", before, limit) : this.rows("SELECT * FROM msgs ORDER BY id DESC LIMIT ?", limit);
    return list.reverse().map((m) => ({ ...m, data: m.data ? JSON.parse(m.data) : null }));
  }

  spend() {
    const today = dayKey(), month = today.slice(0, 7);
    const t = this.rows("SELECT usd FROM spend WHERE day = ?", today)[0];
    const m = this.rows("SELECT coalesce(sum(usd), 0) AS usd FROM spend WHERE day LIKE ?", `${month}%`)[0];
    return { today: t ? t.usd : 0, month: m.usd, limit: this.settings().dailyUsd };
  }

  addSpend(usd) {
    if (!usd) return;
    this.sql.exec("INSERT INTO spend (day, usd, calls) VALUES (?, ?, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + excluded.usd, calls = calls + 1", dayKey(), usd);
    this.broadcast({ t: "spend", spend: this.spend() });
  }

  boot() {
    const cal = this.get("cal", null);
    return {
      calendar: { on: calendarOn(this.env), calendars: (cal?.list || []).map((c) => ({ name: c.name, color: c.color, write: c.write })), today: this.get("calToday", { events: [] }).events },
      settings: this.settings(),
      msgs: this.msgs(),
      tasks: this.rows("SELECT id, ts, updated, title, kind, format, agent, status, step, usd FROM tasks ORDER BY id DESC LIMIT 40"),
      files: this.rows("SELECT * FROM files ORDER BY ts DESC LIMIT 60"),
      sched: this.rows("SELECT * FROM sched ORDER BY due"),
      facts: this.rows("SELECT * FROM facts ORDER BY id"),
      spend: this.spend(),
      status: this.currentStatus(),
      vapid: this.env.VAPID_PUBLIC || "",
      push: this.rows("SELECT count(*) AS n FROM subs")[0].n,
    };
  }

  async fetch(req) {
    const url = new URL(req.url), path = url.pathname;
    if (path === "/api/ws") {
      if (req.headers.get("upgrade") !== "websocket") return json({ error: "upgrade" }, 426);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ t: "status", ...this.currentStatus() }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/internal/blob") {
      const bytes = this.readBlob(url.searchParams.get("id") || "");
      return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (path === "/internal/task") return this.taskEvent(body);

    switch (`${req.method} ${path}`) {
      case "GET /api/boot":
        return json(this.boot());
      case "GET /api/thread":
        return json({ msgs: this.msgs(+url.searchParams.get("before") || null, 60) });
      case "POST /api/ticket": {
        const e = Date.now() + 60000;
        return json({ ticket: `${e}.${await sign(this.env.ACCESS_TOKEN, `ws|${e}`)}` });
      }
      case "POST /api/message": {
        const text = String(body.text || "").trim().slice(0, 8000);
        if (!text) return json({ error: "empty" }, 400);
        const m = this.post({ who: "me", text });
        await this.ctx.storage.setAlarm(Date.now());
        return json({ id: m.id });
      }
      case "POST /api/settings": {
        const cur = this.get("settings", {}), next = { ...cur };
        if (body.models) next.models = { ...cur.models, ...Object.fromEntries(Object.entries(body.models).filter(([k, v]) => ["chat", "text", "docs"].includes(k) && MODELS.includes(v))) };
        if (body.dailyUsd !== undefined) next.dailyUsd = Math.max(0.5, Math.min(50, +body.dailyUsd || 6));
        if (body.briefs) next.briefs = { ...cur.briefs, daily: !!body.briefs.daily, weekly: !!body.briefs.weekly, hour: Math.max(0, Math.min(23, +body.briefs.hour || 7)), minute: 0 };
        if (body.calendar) {
          const c = body.calendar, prev = this.settings().calendar;
          next.calendar = { nudge: [0, 10, 15, 30, 60].includes(+c.nudge) ? +c.nudge : prev.nudge, home: c.home === undefined ? prev.home : String(c.home).slice(0, 80), hidden: Array.isArray(c.hidden) ? c.hidden.map((x) => String(x).slice(0, 80)).slice(0, 40) : prev.hidden };
        }
        if (body.agent && defaults(this.env).agents[body.agent.key]) {
          const a = body.agent, prev = this.settings().agents[a.key];
          const avatar = a.avatar && AVATARS.includes(a.avatar.type) ? { type: a.avatar.type, cfg: a.avatar.cfg || {} } : prev.avatar;
          next.agents = { ...cur.agents, [a.key]: { name: String(a.name || prev.name).slice(0, 24), avatar } };
        }
        this.put("settings", next);
        if (body.briefs) { this.sql.exec("DELETE FROM sched WHERE builtin IN ('daily', 'weekly')"); this.seed(); await this.rearm(); }
        if (body.calendar) { await this.syncCalendar().catch((err) => console.error("calendar", String(err?.message || err))); await this.rearm(); }
        this.broadcast({ t: "settings", settings: this.settings(), sched: this.rows("SELECT * FROM sched ORDER BY due") });
        return json({ settings: this.settings() });
      }
      case "POST /api/push": {
        const sub = body.subscription;
        if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return json({ error: "bad subscription" }, 400);
        this.sql.exec("INSERT INTO subs (endpoint, body, ts) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET body = excluded.body, ts = excluded.ts", sub.endpoint, JSON.stringify(sub), Date.now());
        return json({ ok: true });
      }
      case "POST /api/push/test": {
        const sent = await this.notify("Valet", "Powiadomienia działają.", true);
        return json({ sent });
      }
      case "POST /api/file/link": {
        const f = this.rows("SELECT * FROM files WHERE id = ?", String(body.id || ""))[0];
        if (!f) return json({ error: "not found" }, 404);
        const e = body.hold ? (Math.floor(Date.now() / 21600000) + 2) * 21600000 : Date.now() + 15 * 60000;
        const s = await sign(this.env.ACCESS_TOKEN, `${f.id}|${e}|${f.mime}`);
        return json({ url: `${url.origin}/f/${f.id}/${encodeURIComponent(f.name)}?e=${e}&m=${encodeURIComponent(f.mime)}&s=${s}` });
      }
      case "POST /api/task/cancel": {
        const t = this.rows("SELECT * FROM tasks WHERE id = ? AND status = 'running'", +body.id)[0];
        if (!t) return json({ error: "not running" }, 404);
        await this.env.TASK.get(this.env.TASK.idFromName(t.ref)).fetch("https://task/cancel", { method: "POST" });
        this.setTask(t.id, { status: "cancelled", step: "Przerwane" });
        this.status("idle");
        return json({ ok: true });
      }
      case "POST /api/selftest": {
        try {
          const model = this.settings().models.text;
          const res = await ask(this.env, { model, max_tokens: 200, messages: [{ role: "user", content: "Odpowiedz jednym słowem: ok" }] });
          this.addSpend(cost(res.usage, res.model || model));
          return json({ ok: true, model: res.model, text: extract(res.content).text.slice(0, 40) });
        } catch (err) {
          return json({ ok: false, error: explain(err) });
        }
      }
      case "POST /api/brief/now":
        await this.brief(body.kind === "weekly" ? "weekly" : "daily");
        return json({ ok: true });
      case "POST /api/calendar/act": {
        const row = this.rows("SELECT * FROM msgs WHERE id = ? AND kind = 'event'", +body.msg)[0];
        if (!row) return json({ error: "not found" }, 404);
        const data = JSON.parse(row.data || "{}"), ev = data.event;
        if (!ev || ev.done) return json({ ok: true, event: ev || null });
        try {
          if (body.act === "keep" && ev.op === "ask_delete") ev.done = "kept";
          else if ((body.act === "undo" && ev.op === "added") || (body.act === "delete" && ev.op === "ask_delete")) {
            await removeEvent(this.env, { href: ev.href });
            ev.done = body.act === "undo" ? "undone" : "deleted";
            await this.syncCalendar().catch(() => {});
            await this.rearm();
          } else return json({ error: "bad action" }, 400);
        } catch (err) {
          return json({ error: String(err?.message || err).slice(0, 200) }, 502);
        }
        data.note = `${data.note || ""} State: ${ev.done}.`.trim();
        this.sql.exec("UPDATE msgs SET data = ? WHERE id = ?", JSON.stringify(data), row.id);
        this.broadcast({ t: "edit", m: { ...row, data } });
        return json({ ok: true, event: ev });
      }
      case "POST /api/title": {
        if (!+body.id) return json({ error: "bad id" }, 400);
        try {
          await this.showTitle(body.type === "tv" ? "tv" : "movie", +body.id);
          return json({ ok: true });
        } catch (err) {
          return json({ error: String(err?.message || err).slice(0, 200) }, 502);
        }
      }
      case "POST /api/fact/delete":
        this.sql.exec("DELETE FROM facts WHERE id = ?", +body.id);
        this.broadcast({ t: "facts", facts: this.rows("SELECT * FROM facts ORDER BY id") });
        return json({ facts: this.rows("SELECT * FROM facts ORDER BY id") });
      case "POST /api/sched/delete":
        this.sql.exec("DELETE FROM sched WHERE id = ? AND builtin IS NULL", +body.id);
        await this.rearm();
        this.broadcast({ t: "sched", sched: this.rows("SELECT * FROM sched ORDER BY due") });
        return json({ sched: this.rows("SELECT * FROM sched ORDER BY due") });
      default:
        return json({ error: "not found" }, 404);
    }
  }

  webSocketMessage(ws, raw) {
    if (raw === "ping") ws.send("pong");
  }
  webSocketClose(ws) { try { ws.close(); } catch (e) {} }
  webSocketError(ws) { try { ws.close(); } catch (e) {} }

  async notify(title, body, force = false) {
    if (!force && this.ctx.getWebSockets().length) return 0;
    const subs = this.rows("SELECT endpoint, body FROM subs");
    let sent = 0;
    await Promise.all(subs.map(async (row) => {
      try {
        const status = await sendPush(this.env, JSON.parse(row.body), { title, body: String(body).replace(/\*\*/g, "").slice(0, 180) });
        if (status === 404 || status === 410) this.sql.exec("DELETE FROM subs WHERE endpoint = ?", row.endpoint);
        else if (status >= 200 && status < 300) sent++;
      } catch (err) {
        console.error("push", String(err));
      }
    }));
    return sent;
  }

  async rearm() {
    const cursor = this.get("cursor", 0);
    if (this.rows("SELECT id FROM msgs WHERE id > ? AND who = 'me' LIMIT 1", cursor).length) return this.ctx.storage.setAlarm(Date.now() + 50);
    const due = this.rows("SELECT min(due) AS due FROM sched")[0].due;
    const sync = calendarOn(this.env) ? this.get("calNext", 0) || Date.now() + 1000 : null;
    const next = Math.min(due || Infinity, sync || Infinity);
    if (Number.isFinite(next)) return this.ctx.storage.setAlarm(Math.max(next, Date.now() + 500));
    return this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    try {
      await this.chatTurn();
    } catch (err) {
      console.error("chat", String(err?.stack || err));
      const last = this.rows("SELECT max(id) AS id FROM msgs WHERE who = 'me'")[0].id || 0;
      this.put("cursor", last);
      this.post({ who: "sys", kind: "error", text: `Nie udało się odpowiedzieć. ${explain(err)}` });
      this.status("error", "Coś poszło nie tak");
      this.live = null;
    }
    try {
      await this.runDue();
    } catch (err) {
      console.error("due", String(err?.stack || err));
    }
    if (calendarOn(this.env) && Date.now() >= this.get("calNext", 0)) {
      try {
        await this.syncCalendar();
      } catch (err) {
        console.error("calendar", String(err?.message || err));
        this.put("calNext", Date.now() + SYNC);
      }
    }
    await this.rearm();
  }

  context(fresh, cursor) {
    const s = this.settings(), owner = s.owner;
    const line = (m) => {
      const who = m.who === "me" ? owner : m.who === "sys" ? "System" : s.agents[m.agent]?.name || "Valet";
      const files = m.data?.files?.length ? ` [pliki: ${m.data.files.map((f) => f.name).join(", ")}]` : "";
      const note = m.data?.note ? `\n${String(m.data.note).slice(0, 800)}` : "";
      return `[${hm(m.ts)}] ${who}${CARDS[m.kind] || ""}: ${String(m.text || "").slice(0, 900)}${files}${note}`;
    };
    const prior = this.msgs(fresh[fresh.length - 1].id + 1, 34).filter((m) => !(m.who === "me" && m.id > cursor));
    const facts = this.rows("SELECT id, text FROM facts ORDER BY id");
    const tasks = this.rows("SELECT id, title, status, step FROM tasks WHERE status = 'running' OR updated > ? ORDER BY id DESC LIMIT 6", Date.now() - 6 * 3600000);
    const spend = this.spend();
    return [
      `<now>${human()} (Europe/Warsaw), ${isoLocal(Date.now())}</now>`,
      `<owner>${owner}</owner>`,
      `<memory>\n${facts.length ? facts.map((f) => `#${f.id} ${f.text}`).join("\n") : "(nothing yet)"}\n</memory>`,
      this.calendarLine(),
      `<background_tasks>\n${tasks.length ? tasks.map((t) => `#${t.id} "${t.title}": ${t.status}${t.step ? `, ${t.step}` : ""}`).join("\n") : "(none)"}\n</background_tasks>`,
      spend.today >= spend.limit ? "<budget>The daily API budget is used up. You are running on the small model, and new background tasks are refused until tomorrow. Tell him if he asks for one.</budget>" : "",
      `<thread>\n${prior.length ? prior.map(line).join("\n") : "(this is the start of the thread)"}\n</thread>`,
      `<new_messages>\n${fresh.map((m) => `[${hm(m.ts)}] ${owner}: ${m.text}`).join("\n")}\n</new_messages>`,
    ].filter(Boolean).join("\n\n");
  }

  calendarLine() {
    if (!calendarOn(this.env)) return "<calendar>Not connected.</calendar>";
    const list = this.get("cal", null)?.list || [], s = this.settings().calendar;
    const open = list.filter((c) => !s.hidden.includes(c.name));
    if (!open.length) return "<calendar>Connected.</calendar>";
    const home = this.homeCalendar(list);
    return `<calendar>Connected. Calendars: ${open.map((c) => `${c.name}${c.write ? "" : " (read only)"}`).join(", ")}. New events go to "${home?.name || open[0].name}" unless another calendar clearly fits.</calendar>`;
  }

  homeCalendar(list) {
    const s = this.settings().calendar, can = list.filter((c) => c.write && !s.hidden.includes(c.name));
    return can.find((c) => c.name === s.home) || can[0] || null;
  }

  async calendars(force = false) {
    const cached = this.get("cal", null);
    if (!force && cached && Date.now() - cached.ts < 12 * 3600000) return cached.list;
    const list = await discover(this.env);
    this.put("cal", { ts: Date.now(), list });
    return list;
  }

  remember(list) {
    const map = this.get("calEv", {});
    for (const e of list) { delete map[e.id]; map[e.id] = { href: e.href, etag: e.etag, title: e.title, start: e.start, end: e.end, allDay: e.allDay, cal: e.cal, color: e.color, location: e.location, recurring: !!e.recurring }; }
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete map[k];
    this.put("calEv", map);
  }

  async calendarRange(from, to) {
    const hidden = this.settings().calendar.hidden;
    let cals = await this.calendars();
    let list;
    try {
      list = await listEvents(this.env, cals.filter((c) => !hidden.includes(c.name)), from, to);
    } catch (err) {
      cals = await this.calendars(true);
      list = await listEvents(this.env, cals.filter((c) => !hidden.includes(c.name)), from, to);
    }
    for (const e of list) e.id = shortId(`${e.href}|${e.recurring ? e.start : ""}`);
    this.remember(list);
    return list;
  }

  async syncCalendar() {
    const now = Date.now(), s = this.settings().calendar;
    this.put("calNext", now + SYNC);
    if (!calendarOn(this.env)) return;
    const l = local(now), dayStart = fromLocal(l.y, l.mo, l.d, 0, 0);
    const list = await this.calendarRange(dayStart, dayStart + 2 * 86400000);
    this.put("calToday", { ts: now, events: list.slice(0, 60).map(publicEvent) });
    this.sql.exec("DELETE FROM sched WHERE builtin LIKE 'cal:%'");
    const fired = this.get("calFired", []);
    if (s.nudge > 0) {
      for (const e of list) {
        const key = `cal:${e.id}:${e.start}`;
        const due = e.start - s.nudge * 60000;
        if (e.allDay || e.start <= now + 120000 || fired.includes(key)) continue;
        if (due < now && (now - (e.touched || 0) < 45 * 60000 || e.start - now < 5 * 60000)) continue;
        this.sql.exec("INSERT INTO sched (due, repeat, text, builtin) VALUES (?, 'none', ?, ?)", Math.max(now + 1000, due), [e.title, hm(e.start), e.location].filter(Boolean).join(" · ").slice(0, 300), key);
      }
    }
    this.broadcast({ t: "sched", sched: this.rows("SELECT * FROM sched ORDER BY due") });
    this.broadcast({ t: "calendar", today: this.get("calToday", { events: [] }).events });
  }

  async chatTurn() {
    const cursor = this.get("cursor", 0);
    const fresh = this.rows("SELECT * FROM msgs WHERE id > ? AND who = 'me' ORDER BY id", cursor);
    if (!fresh.length) return;
    const origin = fresh[fresh.length - 1].id;
    const s = this.settings(), budget = this.spend();
    const model = budget.today >= budget.limit ? s.models.text : s.models.chat;
    this.status("thinking", "Myśli", true);
    this.drawn = 0;
    const messages = [{ role: "user", content: this.context(fresh, cursor) }];
    let shown = "", reply = "", sources = [];
    for (let i = 0; i < 8; i++) {
      const res = await ask(this.env, {
        model,
        max_tokens: 16000,
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
        tools: chatTools(model),
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages,
      }, (e) => {
        const text = label(e);
        if (!text || text === shown) return;
        shown = text;
        this.status(text === "Pisze" ? "speaking" : "working", text, true);
      });
      this.addSpend(cost(res.usage, res.model || model));
      console.log("chat usage", i, res.stop_reason, cost(res.usage, res.model || model).toFixed(4), JSON.stringify(res.usage));
      if (res.stop_reason === "refusal") { reply = "Tego nie mogę zrobić."; break; }
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason === "pause_turn") continue;
      const uses = res.content.filter((b) => b.type === "tool_use");
      if (res.stop_reason === "tool_use" && uses.length) {
        const results = [];
        for (const u of uses) {
          let content, failed = false;
          try { content = await this.tool(u.name, u.input || {}, origin); } catch (err) { failed = true; content = `Tool failed: ${String(err?.message || err).slice(0, 300)}`; }
          results.push({ type: "tool_result", tool_use_id: u.id, content, ...(failed ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      ({ text: reply, sources } = extract(res.content));
      break;
    }
    this.put("cursor", origin);
    if (reply) {
      const m = this.post({ who: "agent", agent: "valet", text: reply, data: sources.length ? { sources } : null });
      await this.notify(s.agents.valet.name, m.text);
    }
    this.status("idle");
  }

  async tool(name, input, origin) {
    const s = this.settings();
    if (name === "start_task") {
      const budget = this.spend();
      if (budget.today >= budget.limit) return "Refused: the daily API budget is used up, so no background task was started. Tell him it can run tomorrow or after he raises the limit in settings.";
      const doc = input.kind === "document";
      const agent = doc ? "atelier" : "valet", model = doc ? s.models.docs : s.models.chat, now = Date.now();
      const format = doc ? (input.format === "none" ? "pdf" : input.format) : "none";
      const id = this.sql.exec("INSERT INTO tasks (ts, updated, title, kind, format, agent, model, status, step, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 'W kolejce', ?) RETURNING id", now, now, String(input.title).slice(0, 80), input.kind, format, agent, model, origin).one().id;
      const ref = `task-${id}-${now}`;
      const card = this.post({ who: "agent", agent, kind: "task", text: String(input.title).slice(0, 80), data: { task: id }, reply_to: origin });
      this.sql.exec("UPDATE tasks SET ref = ?, card = ? WHERE id = ?", ref, card.id, id);
      const facts = this.rows("SELECT text FROM facts ORDER BY id").map((f) => f.text);
      await this.env.TASK.get(this.env.TASK.idFromName(ref)).fetch("https://task/start", { method: "POST", body: JSON.stringify({ id, title: input.title, instructions: input.instructions, kind: input.kind, format, model, facts, now: human() }) });
      this.broadcast({ t: "task", task: this.taskRow(id) });
      return `Task #${id} started in the background (${doc ? `${format.toUpperCase()} file` : "research"}). The result will be posted into the thread automatically.`;
    }
    if (name === "remember") {
      const id = this.sql.exec("INSERT INTO facts (ts, text) VALUES (?, ?) RETURNING id", Date.now(), String(input.text).slice(0, 400)).one().id;
      this.broadcast({ t: "facts", facts: this.rows("SELECT * FROM facts ORDER BY id") });
      return `Saved as #${id}.`;
    }
    if (name === "forget") {
      this.sql.exec("DELETE FROM facts WHERE id = ?", +input.id);
      this.broadcast({ t: "facts", facts: this.rows("SELECT * FROM facts ORDER BY id") });
      return `Fact #${input.id} deleted.`;
    }
    if (name === "schedule") {
      const due = parseLocal(input.at);
      if (!due) return "Refused: 'at' must look like 2026-11-18T07:30.";
      if (due < Date.now() - 60000 && input.repeat === "none") return "Refused: that time is in the past.";
      const first = due < Date.now() ? nextRepeat(due, input.repeat) : due;
      const id = this.sql.exec("INSERT INTO sched (due, repeat, text, builtin) VALUES (?, ?, ?, NULL) RETURNING id", first, input.repeat, String(input.text).slice(0, 400)).one().id;
      this.broadcast({ t: "sched", sched: this.rows("SELECT * FROM sched ORDER BY due") });
      return `Reminder #${id} set for ${human(first)}${input.repeat === "none" ? "" : `, repeating ${input.repeat}`}.`;
    }
    if (name === "list_schedule") {
      const list = this.rows("SELECT * FROM sched ORDER BY due");
      return list.length ? list.map((r) => `#${r.id} ${human(r.due)} (${r.repeat}${r.builtin ? ", built-in brief" : ""}): ${r.text}`).join("\n") : "Nothing is scheduled.";
    }
    if (name === "cancel_schedule") {
      const row = this.rows("SELECT * FROM sched WHERE id = ?", +input.id)[0];
      if (!row) return `There is no reminder #${input.id}.`;
      if (row.builtin) return "That one is a built-in brief; he can switch it off in settings.";
      this.sql.exec("DELETE FROM sched WHERE id = ?", row.id);
      this.broadcast({ t: "sched", sched: this.rows("SELECT * FROM sched ORDER BY due") });
      return `Reminder #${row.id} deleted.`;
    }
    if (name === "show_weather") {
      const wx = await this.weather(input.day === "tomorrow" ? 1 : 0);
      this.post({ who: "agent", agent: "valet", kind: "sky", text: wx.summary, data: { sky: wx.sky } });
      return `Card posted. ${wx.summary}`;
    }
    if (name === "calendar" || name === "add_event" || name === "change_event" || name === "delete_event") {
      if (!calendarOn(this.env)) return "The calendar is not connected: the iCloud app password has not been added to the server yet. Tell him that plainly.";
      return this.calendarTool(name, input);
    }
    if (name === "youtube_search") {
      const query = String(input.query).slice(0, 200);
      const list = await youtube(this.env, { query, order: input.order, count: 5 });
      if (!list.length) return `No videos found for "${query}".`;
      const note = list.map((v, i) => `${i + 1}. ${v.title} | ${v.channel} | ${v.live ? "live" : clockOf(v.seconds)} | ${v.views} views | ${dayKey(v.published)} | https://youtu.be/${v.id}`).join("\n");
      this.post({ who: "agent", agent: "valet", kind: "videos", text: query, data: { videos: list, note } });
      return `Card with ${list.length} videos posted.\n${note}`;
    }
    if (name === "show_title") {
      let type = input.type, id = +input.id || 0, others = [];
      if (id && type === "any") return "Refused: with an id the type must be movie or tv.";
      if (!id) {
        const found = await findTitles(this.env, { query: String(input.query).slice(0, 200), type, year: +input.year || 0 });
        if (!found.length) return `Nothing found for "${input.query}".`;
        ({ type, id } = found[0]);
        others = found.slice(1, 5);
      }
      const t = await this.showTitle(type, id);
      const rest = others.length ? `\nOther matches: ${others.map((o) => `${o.name} (${o.year || "?"}, ${o.type}, id ${o.id})`).join("; ")}` : "";
      return `Card posted. ${t.note}${t.overview ? `\nPlot: ${t.overview.slice(0, 500)}` : ""}${t.cast.length ? `\nCast: ${t.cast.join(", ")}` : ""}${rest}`;
    }
    if (name === "show_titles") {
      const query = String(input.query || "").trim().slice(0, 200);
      if ((input.list === "search" || input.list === "similar") && !query) return "Refused: this list needs a query.";
      const { label, titles } = await titleList(this.env, { list: input.list, query, type: input.type });
      const top = titles.filter((t) => t.poster).slice(0, 10);
      if (!top.length) return "Nothing found.";
      const note = top.map((t, i) => `${i + 1}. ${t.name} (${t.year || "?"}, ${t.type}, id ${t.id}${t.rating ? `, ${t.rating}/10` : ""})`).join("; ");
      this.post({ who: "agent", agent: "valet", kind: "titles", text: label, data: { titles: top, note } });
      return `Row of ${top.length} posters posted under "${label}". ${note}`;
    }
    if (name === "make_image") {
      const budget = this.spend();
      if (budget.today >= budget.limit) return "Refused: the daily budget is used up, so no image was made. Tell him it can be made tomorrow or after he raises the limit in settings.";
      if (this.drawn >= 3) return "Refused: three images were already made for this request.";
      this.drawn = (this.drawn || 0) + 1;
      const made = await image(this.env, { prompt: String(input.prompt).slice(0, 4000), aspect: input.aspect, quality: input.quality });
      const id = `img_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
      const label = String(input.title || "").replace(/[\\/:*?"<>|\n]/g, " ").trim().slice(0, 60) || "Obrazek";
      const file = { id, name: `${label}.${made.ext}`, mime: made.mime, size: made.bytes.length };
      this.saveBlob(id, made.bytes);
      this.sql.exec("INSERT INTO files (id, ts, name, mime, size, task) VALUES (?, ?, ?, ?, ?, NULL)", id, Date.now(), file.name, file.mime, file.size);
      this.addSpend(made.usd);
      this.post({ who: "agent", agent: "atelier", kind: "image", text: label, data: { image: { ...file, w: made.w, h: made.h }, note: `Prompt: ${String(input.prompt).slice(0, 500)}` } });
      this.broadcast({ t: "files", files: this.rows("SELECT * FROM files ORDER BY ts DESC LIMIT 60") });
      return `Image posted into the thread and saved as "${file.name}" (${made.w}x${made.h}, cost $${made.usd.toFixed(3)}). You cannot see it, so do not describe details you did not ask for.`;
    }
    return `Unknown tool ${name}.`;
  }

  async calendarTool(name, input) {
    if (name === "calendar") {
      const p = parts(input.from);
      if (!p) return "Refused: from must look like 2026-11-18.";
      const days = Math.max(1, Math.min(31, +input.days || 1));
      let list = await this.calendarRange(ms({ ...p, h: 0, mi: 0 }), ms(shiftDay({ ...p, h: 0, mi: 0 }, days)));
      const q = String(input.query || "").trim().toLowerCase();
      if (q) list = list.filter((e) => `${e.title} ${e.location}`.toLowerCase().includes(q));
      const note = list.length ? list.slice(0, 70).map(eventLine).join("\n") : "No events.";
      if (input.show) this.post({ who: "agent", agent: "valet", kind: "agenda", text: list.length ? `Wydarzenia: ${list.length}` : "Nic w kalendarzu", data: { agenda: { from: `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, days, events: list.slice(0, 80).map(publicEvent) }, note: note.slice(0, 700) } });
      const first = ms({ ...p, h: 12, mi: 0 }), last = ms(shiftDay({ ...p, h: 12, mi: 0 }, days - 1));
      return `${input.show ? "Agenda card posted. " : ""}Range read: ${rangeDay.format(first)}${days > 1 ? ` to ${rangeDay.format(last)}` : ""}. ${list.length} event(s):\n${note}`;
    }
    const map = this.get("calEv", {});
    if (name === "add_event") {
      const start = parts(input.start), allDay = !!input.all_day;
      if (!start) return "Refused: start must look like 2026-11-18T15:00.";
      let end = parts(input.end) || start;
      if (allDay) { if (ms({ ...end, h: 0, mi: 0 }) < ms({ ...start, h: 0, mi: 0 })) end = start; }
      else if (ms(end) <= ms(start)) { const l = local(ms(start) + 3600000); end = { y: l.y, mo: l.mo, d: l.d, h: l.h, mi: l.mi }; }
      const cals = await this.calendars(), wanted = String(input.calendar || "").trim().toLowerCase();
      const cal = wanted ? cals.find((c) => c.write && c.name.toLowerCase() === wanted) : this.homeCalendar(cals);
      if (!cal) return `Refused: there is no writable calendar ${wanted ? `named "${input.calendar}"` : "to use"}. Writable calendars: ${names(cals.filter((c) => c.write)) || "none"}.`;
      const title = String(input.title).trim().slice(0, 200), location = String(input.location || "").trim().slice(0, 200);
      const made = await createEvent(this.env, cal, { title, start, end, allDay, location, notes: String(input.notes || "").slice(0, 2000), alert: Math.max(0, Math.min(10080, +input.alert_minutes || 0)) });
      const ev = { id: shortId(`${made.href}|`), title, start: allDay ? ms({ ...start, h: 0, mi: 0 }) : ms(start), end: allDay ? ms(shiftDay({ ...end, h: 0, mi: 0 }, 1)) : ms(end), allDay, cal: cal.name, color: cal.color, location, recurring: false, href: made.href, etag: made.etag };
      this.remember([ev]);
      this.post({ who: "agent", agent: "valet", kind: "event", text: title, data: { event: { ...publicEvent(ev), href: ev.href, op: "added" }, note: `Added: ${eventLine(ev)}` } });
      await this.syncCalendar().catch(() => {});
      return `Added and a card with an undo button is in the thread: ${eventLine(ev)}`;
    }
    const ref = map[input.id];
    if (!ref) return "Refused: unknown event id. Read the calendar again and use an id from that result.";
    if (ref.recurring) return "Refused: repeating events can only be changed or deleted in the Calendar app for now. Tell him that.";
    if (name === "delete_event") {
      this.post({ who: "agent", agent: "valet", kind: "event", text: ref.title, data: { event: { ...publicEvent(ref), id: input.id, href: ref.href, op: "ask_delete" }, note: `Asked to confirm deleting: ${eventLine({ id: input.id, ...ref })}` } });
      return "A card asking him to confirm is in the thread. Nothing is deleted until he taps it, so do not say it was deleted.";
    }
    const patch = { title: String(input.title || "").trim().slice(0, 200), location: input.location ? String(input.location).trim().slice(0, 200) : undefined };
    const next = { ...ref };
    if (input.start) {
      const start = parts(input.start), allDay = !!input.all_day;
      if (!start) return "Refused: start must look like 2026-11-18T15:00.";
      let end = parts(input.end);
      if (!end || (!allDay && ms(end) <= ms(start))) { const l = local(ms(start) + Math.max(900000, ref.end - ref.start)); end = allDay ? start : { y: l.y, mo: l.mo, d: l.d, h: l.h, mi: l.mi }; }
      Object.assign(patch, { start, end, allDay });
      Object.assign(next, { allDay, start: allDay ? ms({ ...start, h: 0, mi: 0 }) : ms(start), end: allDay ? ms(shiftDay({ ...end, h: 0, mi: 0 }, 1)) : ms(end) });
    }
    if (patch.title) next.title = patch.title;
    if (patch.location) next.location = patch.location;
    const done = await changeEvent(this.env, ref, patch);
    next.etag = done.etag;
    const ev = { id: input.id, ...next };
    this.remember([ev]);
    this.post({ who: "agent", agent: "valet", kind: "event", text: ev.title, data: { event: { ...publicEvent(ev), href: ev.href, op: "changed" }, note: `Changed to: ${eventLine(ev)}` } });
    await this.syncCalendar().catch(() => {});
    return `Changed, a card is in the thread: ${eventLine(ev)}`;
  }

  async showTitle(type, id) {
    const t = await title(this.env, type, id);
    const w = t.watch;
    const where = w ? [w.stream.length ? `subscription: ${names(w.stream)}` : "", w.free.length ? `free: ${names(w.free)}` : "", w.rent.length ? `rent: ${names(w.rent)}` : "", !w.stream.length && !w.rent.length && w.buy.length ? `buy: ${names(w.buy)}` : ""].filter(Boolean).join("; ") : "no streaming data";
    const length = type === "movie" ? (t.runtime ? `, ${t.runtime} min` : "") : t.seasons ? `, ${t.seasons} seasons, ${t.episodes} episodes` : "";
    const note = `${t.name} (${t.year || "?"}), ${type === "movie" ? "film" : "series"}, TMDB ${type} id ${t.id}${t.rating ? `, rating ${t.rating}/10` : ""}${length}${t.makers.length ? `, by ${t.makers.join(", ")}` : ""}. In Poland: ${where}.`;
    this.post({ who: "agent", agent: "valet", kind: "title", text: t.name, data: { title: t, note } });
    return { ...t, note };
  }

  async weather(dayOffset = 0) {
    const c = this.settings().city;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=temperature_2m,precipitation_probability,precipitation,cloud_cover&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset&timezone=Europe%2FWarsaw&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather service returned ${res.status}`);
    const d = await res.json();
    const day = d.daily.time[dayOffset];
    const hours = [], temp = [], rain = [], cloud = [];
    d.hourly.time.forEach((t, i) => {
      const h = +t.slice(11, 13);
      if (!t.startsWith(day) || h < 6 || h > 22) return;
      hours.push(h);
      temp.push(Math.round(d.hourly.temperature_2m[i]));
      rain.push(d.hourly.precipitation_probability[i] ?? 0);
      cloud.push(d.hourly.cloud_cover[i] ?? 0);
    });
    const nowH = local().h, at = dayOffset === 0 ? Math.max(0, hours.indexOf(Math.min(22, Math.max(6, nowH)))) : -1;
    const wet = hours.filter((h, i) => rain[i] >= 50);
    const min = Math.round(d.daily.temperature_2m_min[dayOffset]), max = Math.round(d.daily.temperature_2m_max[dayOffset]);
    const rainText = wet.length ? `opady prawdopodobne w godzinach ${wet[0]}:00-${wet[wet.length - 1] + 1}:00` : "bez większych opadów";
    const clock = (t) => (t ? +t.slice(11, 13) + +t.slice(14, 16) / 60 : null);
    const sky = { city: c.name, day, hours, temp, rain, cloud, min, max, at, now: at >= 0 ? temp[at] : null, rise: clock(d.daily.sunrise?.[dayOffset]), set: clock(d.daily.sunset?.[dayOffset]), note: wet.length ? `deszcz ${wet[0]}:00-${wet[wet.length - 1] + 1}:00` : "bez deszczu" };
    const week = d.daily.time.map((t, i) => ({ day: t, min: Math.round(d.daily.temperature_2m_min[i]), max: Math.round(d.daily.temperature_2m_max[i]), rain: d.daily.precipitation_probability_max[i] ?? 0 }));
    return { sky, week, summary: `${c.name}, ${dayOffset ? "jutro" : "dziś"}: od ${min}° do ${max}°${at >= 0 ? `, teraz ${temp[at]}°` : ""}, ${rainText}.` };
  }

  async runDue() {
    const now = Date.now();
    for (const row of this.rows("SELECT * FROM sched WHERE due <= ? ORDER BY due", now)) {
      const next = row.repeat && row.repeat !== "none" ? nextRepeat(row.due, row.repeat, now) : null;
      if (next) this.sql.exec("UPDATE sched SET due = ? WHERE id = ?", next, row.id);
      else this.sql.exec("DELETE FROM sched WHERE id = ?", row.id);
      if (row.builtin && row.builtin.startsWith("cal:")) {
        const start = +row.builtin.split(":").pop(), mins = Math.round((start - now) / 60000);
        if (mins < -5) continue;
        this.put("calFired", [...this.get("calFired", []), row.builtin].slice(-150));
        const lead = mins <= 1 ? "Zaczyna się" : mins < 60 ? `Za ${mins} min` : `Za ${Math.round(mins / 60)} godz.`;
        const [what, ...rest] = row.text.split(" · ");
        const m = this.post({ who: "agent", agent: "valet", kind: "remind", text: `${lead}: **${what}**${rest.length ? ` (${rest.join(", ")})` : ""}` });
        await this.notify("Kalendarz", m.text, true);
      } else if (row.builtin) await this.brief(row.builtin);
      else {
        const m = this.post({ who: "agent", agent: "valet", kind: "remind", text: row.text });
        await this.notify("Przypomnienie", m.text, true);
      }
      this.broadcast({ t: "sched", sched: this.rows("SELECT * FROM sched ORDER BY due") });
    }
  }

  async brief(kind) {
    const s = this.settings(), now = Date.now(), days = kind === "weekly" ? 7 : 1;
    let wx = null;
    try { wx = await this.weather(0); } catch (err) { console.error("weather", String(err)); }
    let agenda = null;
    if (calendarOn(this.env)) {
      try {
        const l = local(now), from = fromLocal(l.y, l.mo, l.d, 0, 0);
        const list = await this.calendarRange(from, from + days * 86400000);
        agenda = { from: dayKey(now), days, events: list.slice(0, 60).map(publicEvent) };
      } catch (err) {
        console.error("calendar", String(err?.message || err));
      }
    }
    const facts = {
      kind,
      now: human(now),
      calendar: agenda ? agenda.events.map((e) => `${span(e)}: ${e.title}${e.location ? ` @ ${e.location}` : ""}`) : "not connected",
      weather: wx ? (kind === "weekly" ? wx.week : wx.summary) : "unavailable",
      reminders: this.rows("SELECT due, text FROM sched WHERE builtin IS NULL AND due < ? ORDER BY due", now + days * 86400000).map((r) => ({ when: human(r.due), text: r.text })),
      tasks: this.rows("SELECT title, status FROM tasks WHERE status = 'running' OR updated > ? ORDER BY id DESC LIMIT 8", now - days * 86400000),
      memory: this.rows("SELECT text FROM facts ORDER BY id").map((f) => f.text),
    };
    this.status("working", kind === "weekly" ? "Pisze Weekly Briefing" : "Pisze brief");
    const res = await ask(this.env, { model: s.models.text, max_tokens: 3000, system: BRIEF_SYSTEM, thinking: { type: "adaptive" }, output_config: { effort: "low" }, messages: [{ role: "user", content: JSON.stringify(facts) }] });
    this.addSpend(cost(res.usage, res.model || s.models.text));
    const title = kind === "weekly" ? "Weekly Briefing" : "Poranny brief";
    const m = this.post({ who: "agent", agent: "kurier", kind: "brief", text: extract(res.content).text || "Dziś nic szczególnego.", data: { title, sky: wx?.sky || null, week: kind === "weekly" ? wx?.week || null : null, agenda: agenda?.events.length ? agenda : null } });
    this.status("idle");
    await this.notify(title, m.text, true);
  }

  taskRow(id) { return this.rows("SELECT id, ts, updated, title, kind, format, agent, status, step, usd FROM tasks WHERE id = ?", id)[0]; }

  setTask(id, patch) {
    const cur = this.rows("SELECT * FROM tasks WHERE id = ?", id)[0];
    if (!cur) return null;
    this.sql.exec("UPDATE tasks SET status = ?, step = ?, usd = ?, updated = ? WHERE id = ?", patch.status || cur.status, patch.step ?? cur.step, cur.usd + (patch.usd || 0), Date.now(), id);
    const row = this.taskRow(id);
    this.broadcast({ t: "task", task: row });
    return { ...cur, ...row };
  }

  async taskEvent(e) {
    const cur = this.rows("SELECT * FROM tasks WHERE id = ?", +e.id)[0];
    if (!cur || cur.status !== "running") return json({ ok: false });
    if (e.usd) this.addSpend(e.usd);
    const s = this.settings(), agent = cur.agent;
    if (e.event === "progress") {
      this.setTask(cur.id, { step: e.step, usd: e.usd || 0 });
      if (!this.live) this.broadcast({ t: "status", ...this.currentStatus() });
      return json({ ok: true });
    }
    if (e.event === "done") {
      this.setTask(cur.id, { status: "done", step: "Gotowe", usd: e.usd || 0 });
      const files = (e.files || []).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size }));
      for (const f of files) this.sql.exec("INSERT INTO files (id, ts, name, mime, size, task) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name", f.id, Date.now(), f.name, f.mime, f.size, cur.id);
      const data = {};
      if (files.length) data.files = files;
      if (e.sources?.length) data.sources = e.sources;
      const m = this.post({ who: "agent", agent, text: e.text, data: Object.keys(data).length ? data : null, reply_to: cur.origin });
      this.broadcast({ t: "files", files: this.rows("SELECT * FROM files ORDER BY ts DESC LIMIT 60") });
      this.status("happy", "Gotowe");
      this.live = null;
      await this.notify(s.agents[agent]?.name || "Valet", m.text, true);
      return json({ ok: true });
    }
    this.setTask(cur.id, { status: "failed", step: "Nie udało się", usd: e.usd || 0 });
    const m = this.post({ who: "agent", agent: "valet", text: `Zadanie „${cur.title}” się nie udało. ${e.text || ""}`.trim(), reply_to: cur.origin });
    this.status("error", "Coś poszło nie tak");
    this.live = null;
    await this.notify("Valet", m.text, true);
    return json({ ok: true });
  }
}
