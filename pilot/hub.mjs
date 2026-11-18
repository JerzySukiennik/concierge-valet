/* Concierge Valet pilot hub: the meeting point on this Mac between the sessions of the Claude app (the valet-pilot mod talks to it over a private Unix socket) and the cloud agent (over the bridge socket). It lists live sessions, passes the owner's prompts into them and reports finished turns. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, hostname, tmpdir, uptime } from "node:os";
import { basename, extname, join, relative, sep } from "node:path";
import { execFile } from "node:child_process";

const HOME = process.env.VALET_PILOT_HOME || join(homedir(), ".valet-pilot");
const API = process.env.VALET_API || "https://concierge-valet-api.kalakasanyt.workers.dev";
const SOCK = join(HOME, "hub.sock");
const SHELF = process.env.VALET_PILOT_SHELF || join(homedir(), "Documents", "Gzowo Labs");
const MIMES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv" };
mkdirSync(HOME, { recursive: true });
chmodSync(HOME, 0o700);
const TOKEN = (process.env.VALET_TOKEN || (existsSync(join(HOME, "token")) ? readFileSync(join(HOME, "token"), "utf8") : "")).trim();
if (!TOKEN) { process.stderr.write("valet pilot: no access token (VALET_TOKEN or ~/.valet-pilot/token)\n"); process.exit(1); }

const sessions = new Map(), pending = new Map(), asks = new Map();
let bridge = null, pinger = null, retry = 2000, seq = 0, listed = [], told = -1;
const log = (...a) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${a.join(" ")}\n`);
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").trim();
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const label = (s) => s.title || "bez tytułu";

const idleSeconds = () => new Promise((resolve) => {
  execFile("/usr/sbin/ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 4000, maxBuffer: 8e6 }, (err, out) => {
    const m = /"HIDIdleTime" = (\d+)/.exec(out || "");
    resolve(m ? Math.round(+m[1] / 1e9) : -1);
  });
});

const TOOLS_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const sh = (file, args, ms = 6000) => new Promise((resolve) => execFile(file, args, { timeout: ms, maxBuffer: 24e6, env: { ...process.env, PATH: TOOLS_PATH } }, (err, out) => resolve(err ? "" : String(out).trim())));
const script = (source) => sh("/usr/bin/osascript", ["-e", source], 8000);

async function macState() {
  const [batt, front, vol, disk] = await Promise.all([
    sh("/usr/bin/pmset", ["-g", "batt"]),
    sh("/usr/bin/lsappinfo", ["front"]).then((asn) => (asn ? sh("/usr/bin/lsappinfo", ["info", "-only", "name", asn]) : "")),
    script('set v to get volume settings\nreturn ((output volume of v) as text) & "|" & ((output muted of v) as text)'),
    sh("/bin/df", ["-k", "/System/Volumes/Data"]),
  ]);
  const b = /(\d+)%;\s*([a-z ]+);/i.exec(batt), free = +(disk.split("\n").pop() || "").trim().split(/\s+/)[3] || 0;
  const [level, muted] = vol.split("|");
  return { host: hostname().replace(/\.local$/, ""), battery: b ? +b[1] : null, power: b ? b[2].trim() : "", app: (/="(.+)"/.exec(front) || [])[1] || "", volume: level ? +level : null, muted: muted === "true", freeGb: free ? Math.round(free / 1048576) : null, upHours: Math.round(uptime() / 3600), idle: await idleSeconds(), sessions: sessions.size, music: await music("status").catch(() => null) };
}

async function music(action) {
  const player = (await sh("/usr/bin/pgrep", ["-x", "Spotify"])) ? "Spotify" : (await sh("/usr/bin/pgrep", ["-x", "Music"])) ? "Music" : "";
  if (!player) { if (action === "status") return { player: "", state: "off" }; throw new Error("Na Macu nie jest otwarta ani Muzyka, ani Spotify."); }
  const verb = { playpause: "playpause", next: "next track", previous: "previous track" }[action];
  if (verb) { await script(`tell application "${player}" to ${verb}`); await new Promise((r) => setTimeout(r, 700)); }
  const out = await script(`tell application "${player}"\nif player state is stopped then return "stopped||"\nreturn (player state as text) & "|" & (name of current track) & "|" & (artist of current track)\nend tell`);
  if (!out) throw new Error(`macOS nie pozwolił sterować aplikacją ${player}. Trzeba raz kliknąć zgodę w okienku na Macu.`);
  const [state, track, artist] = out.split("|");
  return { player, state, track: track || "", artist: artist || "" };
}

async function media(url, focus) {
  if (!/^https?:\/\//i.test(url)) throw new Error("To nie jest link.");
  const tool = [process.env.VALET_YTDLP, join(homedir(), ".valet-pilot", "venv", "bin", "yt-dlp"), "/usr/local/bin/yt-dlp", "/opt/homebrew/bin/yt-dlp"].find((f) => f && existsSync(f));
  if (!tool) throw new Error("Na Macu nie ma narzędzia yt-dlp do pobierania wideo.");
  const dir = mkdtempSync(join(tmpdir(), "valet-media-"));
  try {
    let info = null;
    try { info = JSON.parse(await sh(tool, ["-J", "--no-playlist", "--no-warnings", "--", url], 60000)); } catch (err) {}
    if (!info) throw new Error("Nie udało się otworzyć tego linku: może jest prywatny albo wymaga logowania.");
    if ((info.duration || 0) > 900) throw new Error("To wideo ma ponad 15 minut, a na razie oglądam tylko krótkie.");
    await sh(tool, ["-f", "b[height<=480][ext=mp4]/bv*[height<=480]+ba/b[height<=720]/b", "--merge-output-format", "mp4", "--max-filesize", "45M", "--no-playlist", "--no-warnings", "-o", join(dir, "clip.%(ext)s"), "--", url], 200000);
    const file = readdirSync(dir).find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f));
    if (!file) throw new Error("Nie udało się pobrać wideo z tego linku.");
    const res = await fetch(`${API}/api/media`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": file.endsWith(".webm") ? "video/webm" : "video/mp4", "x-focus": encodeURIComponent(String(focus || "")) }, body: readFileSync(join(dir, file)) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.text) throw new Error(d.error || `Serwer nie obejrzał wideo (${res.status}).`);
    log("media", info.extractor_key || "?", `${Math.round(info.duration || 0)}s`);
    return { site: clip(info.extractor_key, 30), title: clip(info.title, 200), author: clip(info.uploader || info.channel || info.uploader_id, 80), caption: String(info.description || "").slice(0, 3000), seconds: Math.round(info.duration || 0), text: d.text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function installSkill(input) {
  const name = String(input.name || ""), body = String(input.body || "").trim(), description = String(input.description || "").replace(/\s+/g, " ").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(name) || !description || body.length < 40 || body.length > 20000) throw new Error("Ten skill ma złą nazwę albo pustą treść.");
  const dir = join(process.env.VALET_PILOT_SKILLS || join(homedir(), ".claude", "skills"), name), mark = join(dir, ".valet");
  if (existsSync(dir) && !existsSync(mark)) throw new Error(`Skill o nazwie ${name} już istnieje i nie jest mój, więc go nie nadpisuję.`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`);
  writeFileSync(mark, `${JSON.stringify({ by: "Concierge Valet", source: String(input.source || ""), at: new Date().toISOString() })}\n`);
  log("skill", name);
  return { path: `~/.claude/skills/${name}/SKILL.md` };
}

function shelf(query, limit = 12) {
  const want = fold(query).split(/\s+/).filter(Boolean), found = [];
  const walk = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 5) walk(full, depth + 1); continue; }
      const rel = relative(SHELF, full);
      if (want.length && !want.every((w) => fold(rel).includes(w))) continue;
      const info = statSync(full);
      found.push({ path: rel, size: info.size, changed: Math.round(info.mtimeMs) });
    }
  };
  walk(SHELF, 0);
  return found.sort((a, b) => b.changed - a.changed).slice(0, limit);
}

async function sendFile(path) {
  const full = realpathSync(join(SHELF, String(path || ""))), root = realpathSync(SHELF);
  if (full !== root && !full.startsWith(root + sep)) throw new Error("Ten plik leży poza folderem Gzowo Labs.");
  const mime = MIMES[extname(full).toLowerCase()], info = statSync(full);
  if (!mime) throw new Error("Tego rodzaju pliku nie umiem jeszcze przesłać do wątku (na razie obrazki, PDF i tekst).");
  if (info.size > 12e6) throw new Error("Plik jest większy niż 12 MB, a to na razie limit wątku.");
  const res = await fetch(`${API}/api/upload`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ name: basename(full), mime, data: readFileSync(full).toString("base64") }) });
  if (!res.ok) throw new Error(`Serwer nie przyjął pliku (${res.status}).`);
  return { file: (await res.json()).file, path: relative(root, full) };
}

function touch(id, patch = {}) {
  let s = sessions.get(id);
  if (!s) {
    s = { id, cwd: "", root: "", project: "", model: "", title: "", state: "idle", since: Date.now(), seen: Date.now(), last: "", queue: [], waiter: null, remote: false, asked: false };
    sessions.set(id, s);
    log("session", id.slice(0, 8), "joined");
  }
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== "") s[k] = v;
  if (s.root || s.cwd) s.project = basename(s.root || s.cwd);
  s.seen = Date.now();
  return s;
}

function prune() {
  for (const [id, s] of sessions) {
    if (Date.now() - s.seen < 75000) continue;
    sessions.delete(id);
    log("session", id.slice(0, 8), "gone");
  }
  hello();
}

function find(query) {
  prune();
  const text = String(query || "").trim(), all = [...sessions.values()];
  if (sessions.has(text)) return { one: sessions.get(text) };
  if (/^\d{1,2}$/.test(text) && listed[+text - 1] && sessions.has(listed[+text - 1])) return { one: sessions.get(listed[+text - 1]) };
  const want = fold(text);
  if (!want) return all.length === 1 ? { one: all[0] } : { many: all };
  const exact = all.filter((s) => fold(s.title) === want || fold(s.project) === want);
  const hit = exact.length ? exact : all.filter((s) => fold(s.title).includes(want) || fold(s.project).includes(want));
  return hit.length === 1 ? { one: hit[0] } : { many: hit.length ? hit : all };
}

function command(s, cmd, ms = 15000) {
  const id = String(++seq);
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); s.queue = s.queue.filter((c) => c.id !== id); reject(new Error("Sesja nie odpowiedziała na czas.")); }, ms);
    pending.set(id, { resolve, reject, timer });
  });
  const full = { ...cmd, id };
  if (s.waiter) { const give = s.waiter; s.waiter = null; give(full); } else s.queue.push(full);
  return result;
}

function settle(ask, answer) {
  ask.answer = answer;
  if (ask.waiter) {
    const give = ask.waiter;
    ask.waiter = null;
    asks.delete(ask.id);
    give(answer);
  } else setTimeout(() => asks.delete(ask.id), 60000);
}

async function run(tool, input) {
  if (tool === "code.answer") {
    const ask = asks.get(String(input.id));
    if (!ask || ask.answer) throw new Error("To pytanie jest już nieaktualne: sesja dostała odpowiedź na Macu albo została przerwana.");
    settle(ask, { decision: String(input.decision || ""), answers: input.answers || {}, text: String(input.text || "").slice(0, 2000) });
    log("answer", ask.session.slice(0, 8), ask.kind, String(input.decision || ""));
    return { ok: true };
  }
  if (tool === "hub.state") return macState();
  if (tool === "hub.media") return media(String(input.url || ""), input.focus);
  if (tool === "hub.skill") return installSkill(input);
  if (tool === "hub.music") return music(String(input.action || "status"));
  if (tool === "hub.files") {
    try { return { folder: "Documents/Gzowo Labs", files: shelf(String(input.query || ""), Math.max(1, Math.min(20, +input.limit || 12))) }; } catch (err) { throw new Error(err.code === "EPERM" || err.code === "EACCES" ? "macOS nie dał dostępu do folderu Dokumenty. Trzeba raz kliknąć zgodę w okienku na Macu." : `Nie udało się przejrzeć folderu: ${err.message}`); }
  }
  if (tool === "hub.send") {
    try { return await sendFile(input.path); } catch (err) { throw new Error(err.code === "ENOENT" ? "Nie ma takiego pliku w folderze Gzowo Labs." : err.code === "EPERM" || err.code === "EACCES" ? "macOS nie dał dostępu do folderu Dokumenty. Trzeba raz kliknąć zgodę w okienku na Macu." : err.message); }
  }
  if (tool === "code.sessions") {
    prune();
    const all = [...sessions.values()].sort((a, b) => b.since - a.since);
    listed = all.map((s) => s.id);
    return { sessions: all.map((s, i) => ({ n: i + 1, title: label(s), project: s.project || "?", state: s.state, minutes: Math.max(0, Math.round((Date.now() - s.since) / 60000)), last: clip(s.last, 320) })) };
  }
  const hit = find(input.session);
  if (!hit.one) {
    if (!hit.many.length) throw new Error("W apce Claude na Macu nie ma teraz otwartej sesji.");
    return { candidates: hit.many.map((s) => `"${label(s)}" (${s.project || "?"})`).slice(0, 8) };
  }
  const s = hit.one, about = { sid: s.id, title: label(s), project: s.project || "?" };
  if (tool === "code.read") {
    const d = await command(s, { kind: "read", count: Math.max(2, Math.min(30, +input.count || 8)) });
    return { ...about, state: s.state, messages: d.messages || [] };
  }
  if (tool === "code.prompt") {
    const text = String(input.text || "").trim();
    if (!text) throw new Error("Pusty prompt.");
    const state = s.state;
    await command(s, { kind: "prompt", text });
    s.asked = true;
    log("prompt", s.id.slice(0, 8), `${text.length} chars`);
    return { ...about, state };
  }
  throw new Error(`Hub nie zna polecenia ${tool}.`);
}

const send = (body) => { try { if (bridge?.readyState === 1) bridge.send(JSON.stringify(body)); } catch (err) {} };
function hello(force = false) {
  if (!force && told === sessions.size) return;
  told = sessions.size;
  send({ t: "hello", host: hostname().replace(/\.local$/, ""), sessions: sessions.size });
}

async function event(body) {
  const s = touch(String(body.session), { cwd: body.cwd, root: body.root, model: body.model, title: clip(body.title, 80) });
  if (body.kind === "hello") hello();
  else if (body.kind === "start") {
    s.state = "working";
    s.since = Date.now();
    s.remote = s.asked;
    s.asked = false;
    if (!s.title && body.prompt) s.title = clip(body.prompt, 60);
    if (s.remote) send({ t: "event", kind: "code", what: "start", sid: s.id, title: label(s), project: s.project || "?" });
  } else if (body.kind === "done") {
    const remote = s.remote;
    s.state = "idle";
    s.since = Date.now();
    s.remote = false;
    if (body.answer) s.last = String(body.answer).slice(0, 4000);
    const idle = await idleSeconds();
    log("done", s.id.slice(0, 8), body.reason || "answer", remote ? "remote" : "local", `idle ${idle}s`);
    send({ t: "event", kind: "code", what: "done", sid: s.id, title: label(s), project: s.project || "?", reason: String(body.reason || "answer"), durationMs: +body.durationMs || 0, answer: s.last, remote, idle });
  } else if (body.kind === "bye") {
    sessions.delete(s.id);
    log("session", s.id.slice(0, 8), "left");
    hello();
  }
}

const read = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 400000) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (err) { resolve({}); } });
  req.on("error", () => resolve({}));
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://hub");
  const reply = (body, status = 200) => { if (res.writableEnded) return; res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  try {
    if (req.method === "POST" && url.pathname === "/event") {
      const body = await read(req);
      if (!body.session) return reply({ error: "session" }, 400);
      await event(body);
      return reply({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/result") {
      const body = await read(req), call = pending.get(String(body.id));
      if (call) {
        pending.delete(String(body.id));
        clearTimeout(call.timer);
        if (body.ok) call.resolve(body.data || {}); else call.reject(new Error(String(body.error || "Sesja zgłosiła błąd.").slice(0, 300)));
      }
      return reply({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/presence") return reply({ idle: await idleSeconds() });
    if (req.method === "POST" && url.pathname === "/ask") {
      const body = await read(req), id = String(body.id || "");
      if (!body.session || !id) return reply({ error: "ask" }, 400);
      const s = touch(String(body.session));
      const ask = { id, session: s.id, kind: body.kind === "question" ? "question" : "permission", answer: null, waiter: null };
      asks.set(id, ask);
      log("ask", s.id.slice(0, 8), ask.kind, clip(body.tool, 40));
      send({ t: "event", kind: "code", what: "ask", sid: s.id, title: label(s), project: s.project || "?", ask: { id, kind: ask.kind, tool: clip(body.tool, 60), summary: String(body.summary || "").slice(0, 1500), reason: clip(body.reason, 300), questions: Array.isArray(body.questions) ? body.questions.slice(0, 4) : [], agent: !!body.agent } });
      return reply({ ok: bridge?.readyState === 1 });
    }
    if (req.method === "GET" && url.pathname === "/ask/wait") {
      const ask = asks.get(String(url.searchParams.get("id")));
      if (!ask) return reply({ gone: true });
      if (ask.answer) { asks.delete(ask.id); return reply({ answer: ask.answer }); }
      const timer = setTimeout(() => { if (ask.waiter === give) ask.waiter = null; reply({}); }, 20000);
      const give = (answer) => { clearTimeout(timer); reply({ answer }); };
      ask.waiter = give;
      req.on("close", () => { if (ask.waiter === give) { ask.waiter = null; clearTimeout(timer); } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/ask/end") {
      const body = await read(req), ask = asks.get(String(body.id));
      if (ask && !ask.answer) {
        asks.delete(ask.id);
        log("ask ended", ask.session.slice(0, 8), clip(body.why, 20));
        send({ t: "event", kind: "code", what: "ask-end", id: ask.id, why: body.why === "local" ? "local" : "aborted" });
      }
      return reply({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/next") {
      const id = url.searchParams.get("session");
      if (!id) return reply({ error: "session" }, 400);
      const known = sessions.has(id), s = touch(id);
      if (!known) return reply({ cmd: { id: "0", kind: "hello" } });
      if (s.queue.length) return reply({ cmd: s.queue.shift() });
      if (s.waiter) s.waiter(null);
      const timer = setTimeout(() => { if (s.waiter === give) s.waiter = null; reply({}); }, 20000);
      const give = (cmd) => { clearTimeout(timer); s.seen = Date.now(); reply(cmd ? { cmd } : {}); };
      s.waiter = give;
      req.on("close", () => { if (s.waiter === give) { s.waiter = null; clearTimeout(timer); } });
      return;
    }
    reply({ error: "not found" }, 404);
  } catch (err) {
    reply({ error: String(err?.message || err).slice(0, 200) }, 500);
  }
});

async function connect() {
  try {
    const res = await fetch(`${API}/api/ticket`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error(`ticket ${res.status}`);
    const { ticket } = await res.json();
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/api/bridge?k=${ticket}&role=code`);
    bridge = ws;
    ws.addEventListener("open", () => {
      retry = 2000;
      log("bridge open");
      hello(true);
      clearInterval(pinger);
      pinger = setInterval(() => { try { ws.send("ping"); } catch (err) {} }, 25000);
    });
    ws.addEventListener("message", async (e) => {
      if (e.data === "pong" || typeof e.data !== "string") return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t !== "call" || !m.id) return;
      try {
        send({ t: "result", id: m.id, ok: true, data: await run(m.tool, m.input || {}) });
      } catch (err) {
        send({ t: "result", id: m.id, ok: false, error: String(err?.message || err).slice(0, 300) });
      }
    });
    const again = () => {
      if (bridge !== ws) return;
      bridge = null;
      clearInterval(pinger);
      const wait = retry;
      retry = Math.min(60000, retry * 2);
      setTimeout(connect, wait);
    };
    ws.addEventListener("close", again);
    ws.addEventListener("error", () => { try { ws.close(); } catch (err) {} });
  } catch (err) {
    log("bridge failed", String(err?.message || err));
    const wait = retry;
    retry = Math.min(60000, retry * 2);
    setTimeout(connect, wait);
  }
}

rmSync(SOCK, { force: true });
server.listen(SOCK, () => { chmodSync(SOCK, 0o600); log("hub listening"); });
setInterval(prune, 30000);
connect();
