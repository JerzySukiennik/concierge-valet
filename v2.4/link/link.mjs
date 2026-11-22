/* Concierge Valet link: keeps a WhatsApp linked-device session through Baileys and serves the cloud agent over the bridge socket: chats, messages, sends approved by the owner, new messages from watched chats. */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import makeWASocket, { Browsers, DisconnectReason, getContentType, jidNormalizedUser, normalizeMessageContent, useMultiFileAuthState } from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { openStore } from "./store.mjs";

const HOME = process.env.VALET_LINK_HOME || join(homedir(), ".valet-link");
const API = process.env.VALET_API || "https://concierge-valet-api.kalakasanyt.workers.dev";
const PORT = +(process.env.VALET_LINK_PORT || 21430);
const AUTH = join(HOME, "auth");
mkdirSync(AUTH, { recursive: true });
chmodSync(HOME, 0o700);
chmodSync(AUTH, 0o700);
const TOKEN = (process.env.VALET_TOKEN || (existsSync(join(HOME, "token")) ? readFileSync(join(HOME, "token"), "utf8") : "")).trim();
if (!TOKEN) { process.stderr.write("valet link: no access token (VALET_TOKEN or ~/.valet-link/token)\n"); process.exit(1); }

const store = openStore(join(HOME, "store.db"));
const S = { wa: "connecting", qr: "", shown: false, watch: [], sends: [], waRetry: 2000, apiRetry: 2000 };
const log = (...a) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${a.join(" ")}\n`);
for (const name of ["log", "info", "warn", "error", "debug", "trace"]) console[name] = () => {};
let sock = null, bridge = null, pinger = null;

const norm = (jid) => (jid ? jidNormalizedUser(jid) : "");
const stamp = (t) => { const n = typeof t === "number" ? t : Number(t?.toString?.() || 0); return n > 0 ? n * 1000 : Date.now(); };
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").trim();
const usable = (jid) => !!jid && (jid.endsWith("@g.us") || jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));

function textOf(message) {
  const c = normalizeMessageContent(message);
  if (!c) return "";
  const type = getContentType(c);
  if (c.conversation) return c.conversation;
  if (c.extendedTextMessage?.text) return c.extendedTextMessage.text;
  if (c.imageMessage) return ["[zdjęcie]", c.imageMessage.caption].filter(Boolean).join(" ");
  if (c.videoMessage) return ["[film]", c.videoMessage.caption].filter(Boolean).join(" ");
  if (c.audioMessage) return "[wiadomość głosowa]";
  if (c.documentMessage) return ["[plik]", c.documentMessage.fileName || c.documentMessage.caption].filter(Boolean).join(" ");
  if (c.locationMessage || c.liveLocationMessage) return "[lokalizacja]";
  if (c.contactMessage) return ["[kontakt]", c.contactMessage.displayName].filter(Boolean).join(" ");
  const poll = c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3;
  if (poll) return `[ankieta] ${poll.name || ""}: ${(poll.options || []).map((o) => o.optionName).join(", ")}`.trim();
  return type === "albumMessage" ? "[album zdjęć]" : "";
}

function keep(m, live) {
  const key = m.key || {};
  let chat = norm(key.remoteJid);
  if (!usable(chat) || !key.id) return null;
  const group = chat.endsWith("@g.us");
  if (!group && key.remoteJidAlt) {
    const alt = norm(key.remoteJidAlt);
    if (chat.endsWith("@lid") && alt.endsWith("@s.whatsapp.net")) store.link(chat, alt);
    if (alt.endsWith("@lid") && chat.endsWith("@s.whatsapp.net")) store.link(alt, chat);
  }
  let sender = key.fromMe ? "" : group ? norm(key.participant) : chat;
  if (group && key.participant && key.participantAlt) {
    const a = norm(key.participant), b = norm(key.participantAlt);
    if (a.endsWith("@lid") && b.endsWith("@s.whatsapp.net")) store.link(a, b);
    if (b.endsWith("@lid") && a.endsWith("@s.whatsapp.net")) store.link(b, a);
  }
  if (!key.fromMe && sender && m.pushName) store.setName(sender, m.pushName, false);
  const text = textOf(m.message);
  if (!text) return null;
  const ts = stamp(m.messageTimestamp);
  const fresh = store.addMessage({ chat, id: key.id, ts, sender, me: !!key.fromMe, text, incoming: live && !key.fromMe });
  return fresh ? { chat, sender, ts, text, me: !!key.fromMe } : null;
}

function watched(name) {
  const title = fold(name);
  return S.watch.some((w) => title.startsWith(fold(w)));
}

async function groups() {
  try {
    const all = await sock.groupFetchAllParticipating();
    for (const g of Object.values(all)) {
      store.touch(g.id, { name: g.subject, group: true });
      for (const p of g.participants || []) {
        const lid = p.lid || (String(p.id).endsWith("@lid") ? p.id : ""), pn = p.phoneNumber || (String(p.id).endsWith("@s.whatsapp.net") ? p.id : "");
        if (lid && pn) store.link(norm(lid), norm(pn));
        if (p.name || p.notify) store.setName(norm(p.id), p.name || p.notify, !!p.name);
      }
    }
    log("groups", Object.keys(all).length);
  } catch (err) {
    log("groups failed", String(err?.message || err));
  }
}

function contacts(list, strong) {
  for (const c of list || []) {
    const id = norm(c.id);
    if (c.lid && c.phoneNumber) store.link(norm(c.lid), norm(c.phoneNumber));
    else if (c.lid && id.endsWith("@s.whatsapp.net")) store.link(norm(c.lid), id);
    else if (c.phoneNumber && id.endsWith("@lid")) store.link(id, norm(c.phoneNumber));
    if (c.name) store.setName(id, c.name, true);
    else if (c.notify || c.verifiedName) store.setName(id, c.notify || c.verifiedName, strong);
  }
}

async function whatsapp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  S.wa = "connecting";
  sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: Browsers.macOS("Chrome"),
    syncFullHistory: true,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    getMessage: async (key) => { const text = store.textById(norm(key.remoteJid), key.id); return text ? { conversation: text } : undefined; },
  });
  const mine = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u) => {
    if (mine !== sock) return;
    if (u.qr) {
      S.wa = "qr";
      S.qr = await QRCode.toString(u.qr, { type: "svg", margin: 2 });
      report();
      if (!S.shown && process.env.VALET_LINK_OPEN !== "0") { S.shown = true; spawn("open", [`http://127.0.0.1:${PORT}/`], { stdio: "ignore", detached: true }).unref(); }
    }
    if (u.connection === "open") {
      S.wa = "open";
      S.qr = "";
      S.waRetry = 2000;
      store.setOwn(norm(sock.user?.id), norm(sock.user?.lid));
      log("whatsapp open");
      report();
      groups();
    }
    if (u.connection === "close") {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      log("whatsapp closed", code || "");
      S.qr = "";
      if (code === DisconnectReason.loggedOut) {
        S.wa = "logged_out";
        S.shown = false;
        rmSync(AUTH, { recursive: true, force: true });
        mkdirSync(AUTH, { recursive: true });
        chmodSync(AUTH, 0o700);
      } else S.wa = "connecting";
      report();
      const wait = code === DisconnectReason.restartRequired ? 200 : S.waRetry;
      S.waRetry = Math.min(60000, S.waRetry * 2);
      setTimeout(() => whatsapp().catch((err) => log("whatsapp failed", String(err?.message || err))), wait);
    }
  });
  sock.ev.on("messaging-history.set", ({ chats, contacts: people, messages, lidPnMappings }) => {
    for (const m of lidPnMappings || []) store.link(norm(m.lid), norm(m.pn));
    contacts(people, false);
    for (const c of chats || []) {
      const id = norm(c.id);
      if (!usable(id)) continue;
      if (c.lidJid && c.pnJid) store.link(norm(c.lidJid), norm(c.pnJid));
      store.touch(id, { name: id.endsWith("@g.us") ? c.name : "", last: c.conversationTimestamp ? stamp(c.conversationTimestamp) : 0, unread: c.unreadCount ?? undefined });
      if (!id.endsWith("@g.us") && (c.name || c.displayName)) store.setName(id, c.name || c.displayName, false);
    }
    let kept = 0;
    for (const m of messages || []) if (keep(m, false)) kept++;
    log("history", (chats || []).length, "chats,", kept, "messages");
  });
  sock.ev.on("lid-mapping.update", (m) => store.link(norm(m.lid), norm(m.pn)));
  sock.ev.on("contacts.upsert", (list) => contacts(list, false));
  sock.ev.on("contacts.update", (list) => contacts(list, false));
  sock.ev.on("chats.upsert", (list) => { for (const c of list) if (usable(norm(c.id))) store.touch(norm(c.id), { name: String(c.id).endsWith("@g.us") ? c.name : "", unread: c.unreadCount ?? undefined }); });
  sock.ev.on("chats.update", (list) => { for (const c of list) if (c.id && usable(norm(c.id)) && c.unreadCount !== undefined && c.unreadCount !== null) store.touch(norm(c.id), { unread: c.unreadCount }); });
  sock.ev.on("groups.upsert", (list) => { for (const g of list) store.touch(g.id, { name: g.subject, group: true }); });
  sock.ev.on("groups.update", (list) => { for (const g of list) if (g.id && g.subject) store.touch(g.id, { name: g.subject, group: true }); });
  sock.ev.on("messages.update", (list) => { for (const u of list || []) if (u.key?.fromMe && u.key.id && u.update?.status) store.ack(norm(u.key.remoteJid), u.key.id, +u.update.status); });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    const news = [];
    for (const m of messages || []) {
      const live = type === "notify";
      const got = keep(m, live);
      if (!got || !live || got.me || Date.now() - got.ts > 30 * 60000) continue;
      const info = store.describe(got.chat, got.sender);
      if (info && watched(info.chat)) news.push({ chat: info.chat, group: info.group, ts: got.ts, from: info.from, text: got.text });
    }
    if (news.length) send({ t: "event", kind: "wa", messages: news });
  });
}

function hello() {
  send({ t: "hello", role: "wa", host: hostname().replace(/\.local$/, ""), wa: S.wa === "open", ax: S.wa === "open", state: S.wa, qr: S.qr });
}

function report() {
  hello();
}

function send(body) {
  try { if (bridge && bridge.readyState === 1) bridge.send(JSON.stringify(body)); } catch (err) {}
}

function online() {
  if (S.wa !== "open" || !sock) throw new Error(S.wa === "qr" || S.wa === "logged_out" ? "Łącze WhatsApp czeka na zeskanowanie kodu QR w telefonie." : "Łącze WhatsApp nie jest teraz połączone. Spróbuj za chwilę.");
}

async function run(tool, input) {
  if (tool === "status") return { host: hostname(), state: S.wa, ...store.counts() };
  if (tool === "wa.chats") { online(); return { chats: store.chats(input.query || "", Math.min(80, +input.limit || 40)), stale: false }; }
  if (tool === "wa.read") { online(); return { ...store.read(input.chat || "", +input.since || 0, Math.min(400, +input.limit || 200)), stale: false }; }
  if (tool === "wa.find") {
    const hit = store.find(input.chat || "");
    return hit.chat ? { chat: hit.chat.title, group: !!hit.chat.grp } : { candidates: hit.candidates };
  }
  if (tool === "wa.confirm") {
    const at = store.sent(input.chat || "", input.text || "", +input.since || 0);
    return { sent: !!at, at: at || 0 };
  }
  if (tool === "wa.fresh") return { messages: store.fresh(S.watch, Date.now() - Math.min(1440, Math.max(1, +input.minutes || 60)) * 60000) };
  if (tool === "wa.send") {
    online();
    const text = String(input.text || "").trim();
    if (!text) throw new Error("Pusta wiadomość.");
    const hit = store.find(input.chat || "");
    if (!hit.chat) throw new Error("Nie mam w WhatsAppie jednego czatu o tej nazwie.");
    if (input.dry) return { result: "dry run ok", chat: hit.chat.title };
    const hour = Date.now() - 3600000;
    S.sends = S.sends.filter((t) => t > hour);
    if (S.sends.length >= 30) throw new Error("Za dużo wiadomości w ciągu godziny, wstrzymuję wysyłanie dla bezpieczeństwa konta.");
    S.sends.push(Date.now());
    const done = await sock.sendMessage(hit.chat.jid, { text });
    const id = done?.key?.id || "";
    if (id) store.addMessage({ chat: hit.chat.jid, id, ts: Date.now(), sender: "", me: true, text });
    let acked = false;
    for (let i = 0; i < 25 && id && !(acked = store.acked(hit.chat.jid, id)); i++) await new Promise((r) => setTimeout(r, 200));
    return { result: "sent", chat: hit.chat.title, acked };
  }
  throw new Error(`Łącze nie zna polecenia ${tool}.`);
}

async function connect() {
  try {
    const res = await fetch(`${API}/api/ticket`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "{}" });
    if (!res.ok) throw new Error(`ticket ${res.status}`);
    const { ticket } = await res.json();
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/api/bridge?k=${ticket}&role=wa`);
    bridge = ws;
    let heard = Date.now();
    ws.addEventListener("open", () => {
      S.apiRetry = 2000;
      heard = Date.now();
      log("bridge open");
      hello();
      clearInterval(pinger);
      pinger = setInterval(() => {
        if (Date.now() - heard > 70000) {
          log("bridge silent, reconnecting");
          try { ws.close(); } catch (err) {}
          return again();
        }
        try { ws.send("ping"); } catch (err) {}
      }, 25000);
    });
    ws.addEventListener("message", async (e) => {
      heard = Date.now();
      if (e.data === "pong" || typeof e.data !== "string") return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === "config") { S.watch = Array.isArray(m.watch) ? m.watch : []; return; }
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
      const wait = S.apiRetry;
      S.apiRetry = Math.min(60000, S.apiRetry * 2);
      setTimeout(connect, wait);
    };
    ws.addEventListener("close", again);
    ws.addEventListener("error", () => { try { ws.close(); } catch (err) {} });
  } catch (err) {
    log("bridge failed", String(err?.message || err));
    const wait = S.apiRetry;
    S.apiRetry = Math.min(60000, S.apiRetry * 2);
    setTimeout(connect, wait);
  }
}

const PAGE = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Połącz WhatsApp z Valetem</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8f6f1;color:#1d1c19;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif}
main{width:min(460px,calc(100vw - 48px));text-align:center;display:grid;gap:16px;justify-items:center}
h1{font:500 28px/1.15 ui-serif,"New York",Georgia,serif;margin:0}
#qr{background:#fff;border:1px solid #e6e1d6;border-radius:22px;padding:14px;width:300px;height:300px;display:grid;place-items:center}
#qr svg{width:100%;height:100%;display:block}
ol{text-align:left;margin:0;padding-left:22px;color:#55524b;display:grid;gap:4px}
p{margin:0;color:#7d7a72}
</style></head><body><main><h1 id="title">Połącz WhatsApp z Valetem</h1><div id="qr"></div><ol id="steps"><li>Otwórz WhatsApp na telefonie.</li><li>Wejdź w Ustawienia, potem Połączone urządzenia.</li><li>Stuknij Połącz urządzenie i zeskanuj ten kod.</li></ol><p id="note">Kod odświeża się sam co kilkanaście sekund.</p></main><script>
async function tick(){try{const s=await (await fetch("/state",{cache:"no-store"})).json();const q=document.getElementById("qr");if(s.state==="open"){document.getElementById("title").textContent="WhatsApp połączony";q.innerHTML="";q.style.display="none";document.getElementById("steps").style.display="none";document.getElementById("note").textContent="Możesz zamknąć tę kartę. Valet pobiera teraz historię rozmów, co może potrwać kilka minut.";}else if(s.qr){if(q.dataset.v!==s.qr){q.dataset.v=s.qr;q.innerHTML=s.qr;}}else{document.getElementById("note").textContent="Czekam na kod z WhatsAppa.";}}catch(e){document.getElementById("note").textContent="Łącze nie odpowiada.";}setTimeout(tick,1500)}tick();
</script></body></html>`;

createServer((req, res) => {
  if (req.url === "/state") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({ state: S.wa, qr: S.qr }));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(PAGE);
}).listen(PORT, "127.0.0.1", () => log("pairing page on", `http://127.0.0.1:${PORT}/`));

process.on("unhandledRejection", (err) => log("unhandled", String(err?.message || err)));
connect();
whatsapp().catch((err) => { log("whatsapp failed", String(err?.message || err)); setTimeout(() => whatsapp().catch(() => {}), 5000); });
