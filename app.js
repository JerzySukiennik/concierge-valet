/* Concierge Valet phone app: one live thread with the agents, tasks and files, settings and the avatar configurator in sheets. */
import { TYPES, SWATCHES, defaults, mount, watch, look, poke, setState } from "./avatar.js";
import { RM, anim, stagger, crossText, pressFeedback } from "./motion.js";
import { createSheet, makePage } from "./sheet.js";
import { CARD_KINDS, SIGNS, agendaNode, card as connectorCard, openImage, thumb } from "./cards.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const devPort = /^\d{4,5}$/.test(new URLSearchParams(location.search).get("api") || "") ? new URLSearchParams(location.search).get("api") : "8790";
const API = LOCAL ? `http://127.0.0.1:${devPort}` : "https://concierge-valet-api.kalakasanyt.workers.dev";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};
const clock = new Intl.DateTimeFormat("pl-PL", { hour: "numeric", minute: "2-digit" });
const dayName = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
const weekday = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const when = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const MODEL_NAMES = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5" };
const MODEL_NOTES = { "claude-opus-5-5": "Najstaranniejszy, do dokumentów i rzeczy wizualnych", "claude-sonnet-5-5": "Zrównoważony, do zwykłej rozmowy", "claude-haiku-5-5": "Najszybszy i najtańszy, do krótkich tekstów" };
const SLOTS = { chat: "Rozmowa", text: "Tekst i briefy", docs: "Dokumenty" };
const SLOT_NOTES = { chat: "Tym modelem Valet rozmawia z Tobą.", text: "Tym modelem Kurier pisze briefy, przypomnienia i krótkie teksty.", docs: "Tym modelem Atelier robi dokumenty, prezentacje i rzeczy wizualne." };
const AGENT_SLOT = { valet: "chat", atelier: "docs", kurier: "text" };
const AGENT_ABOUT = {
  valet: "Odpisuje od razu, pamięta, co mu mówisz, i przekazuje dłuższą pracę pozostałym agentom.",
  atelier: "Robi w tle pliki: PDF, dokumenty, arkusze, prezentacje i małe strony. Wynik wraca jako odpowiedź w wątku.",
  kurier: "Pisze poranny brief i Weekly Briefing, a do tego krótkie teksty i przypomnienia.",
};
const ORDER = ["valet", "atelier", "kurier"];
const TABS = ["chat", "tasks", "make"];
const STATES = [["idle", "Spokój"], ["listening", "Słucha"], ["thinking", "Myśli"], ["working", "Pracuje"], ["speaking", "Mówi"], ["asking", "Pyta"], ["happy", "Gotowe"], ["sleeping", "Śpi"]];
const REPEAT = { daily: "codziennie", weekdays: "w dni robocze", weekly: "co tydzień" };
const KINDS = { PDF: "Dokument PDF", DOC: "Dokument Word", DOCX: "Dokument Word", XLS: "Arkusz", XLSX: "Arkusz", CSV: "Arkusz", PPT: "Prezentacja", PPTX: "Prezentacja", HTML: "Strona", HTM: "Strona", MD: "Tekst", TXT: "Tekst", PNG: "Obraz", JPG: "Obraz", JPEG: "Obraz", WEBP: "Obraz", SVG: "Obraz", ZIP: "Archiwum" };
const ICON = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>',
  updown: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>',
  check: '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H7a2.5 2.5 0 0 0-2.5 2.5v7A2.5 2.5 0 0 0 7 16h1.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
};

const S = { token: store.get("valet-token") || "", settings: null, byId: new Map(), tasks: new Map(), files: [], sched: [], facts: [], spend: { today: 0, month: 0, limit: 6 }, status: { state: "idle", text: "" }, vapid: "", push: 0, tab: "chat", ws: null, retry: 1000, pending: [], lastDay: "", lastTs: 0, tail: null, hasMore: false, loadingOlder: false, unread: 0, booted: false, offline: false, offTimer: 0, seen: new Set(["chat"]), ctx: null };
const puck = $("puck"), thread = $("thread"), chat = $("view-chat"), input = $("input");
let typingNode = null, statusTimer = 0, listenTimer = 0, speakTimer = 0, local = "", mirror = null;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const money = (n) => (+n || 0).toFixed(2).replace(".", ",");

async function api(path, body) {
  const res = await fetch(API + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${S.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) { unpair(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`api ${res.status}`);
  return res.json();
}

function md(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = [];
  let list = null, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; } };
  for (const line of String(text || "").split("\n")) {
    const item = /^\s*[-•]\s+(.*)$/.exec(line);
    if (item) { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } (list ||= []).push(`<li>${inline(item[1])}</li>`); }
    else if (!line.trim()) flush();
    else { if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; } para.push(inline(line)); }
  }
  flush();
  return out.join("");
}

const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isImage = (f) => String(f?.mime || "").startsWith("image/");
const NUDGES = [[0, "Wyłączone"], [10, "10 min"], [15, "15 min"], [30, "30 min"], [60, "1 godz."]];
const nudgeName = (n) => (NUDGES.find(([v]) => v === n) || NUDGES[0])[1];
const signText = (key) => (SIGNS[key] || SIGNS.made)(S.settings?.agents?.valet?.name || "Valet", "Jurka").replace(/[_`]|^> /g, "");
const cards = {
  link: (id) => api("/api/file/link", { id, hold: true }).then((d) => d.url),
  post: (path, body) => api(path, body),
  open: (url) => window.open(url, "_blank", "noopener"),
};
const agentOf = (key) => S.settings.agents[key] || S.settings.agents.valet;
const avKey = (a) => JSON.stringify(a);

function remount(p, avatar) {
  const k = avKey(avatar);
  if (p._av === k) return;
  p._av = k;
  mount(p, avatar);
}

function mini(key, state = "idle") {
  const p = el("div", "puck");
  p.dataset.agentPuck = key;
  remount(p, agentOf(key).avatar);
  p.dataset.state = state;
  return p;
}

function remountMinis() {
  document.querySelectorAll("[data-agent-puck]").forEach((p) => remount(p, agentOf(p.dataset.agentPuck).avatar));
}

function renderCrew() {
  const c = $("crew");
  if (c.querySelectorAll("[data-agent-puck]").length !== ORDER.length) { c.textContent = ""; ORDER.forEach((k) => c.append(mini(k))); }
}

function skyNode(sky) {
  const box = el("div");
  const n = sky.hours.length, x = (i) => (i / (n - 1)) * 100;
  const lo = Math.min(...sky.temp), hi = Math.max(...sky.temp), span = Math.max(1, hi - lo);
  const y = (t) => 24 - ((t - lo) / span) * 17;
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const NIGHT = [20, 26, 51], GLOW = [243, 200, 166], CLEAR = [134, 196, 239], GREY = [164, 176, 188];
  const rise = sky.rise ?? 7, set = sky.set ?? 16;
  const color = (h, cloud) => {
    const day = mix(CLEAR, GREY, Math.min(1, cloud / 100));
    const edge = Math.min(Math.abs(h - rise), Math.abs(h - set));
    if (h < rise - 0.9 || h > set + 0.9) return NIGHT;
    if (edge <= 0.9) return h < rise || h > set ? mix(GLOW, NIGHT, edge / 0.9) : mix(GLOW, day, edge / 0.9);
    return day;
  };
  const stops = sky.hours.map((h, i) => `rgb(${color(h, sky.cloud[i]).join(",")}) ${x(i).toFixed(1)}%`).join(", ");
  let path = "";
  sky.temp.forEach((t, i) => { path += i === 0 ? `M0 ${y(t).toFixed(1)}` : ` L${x(i).toFixed(1)} ${y(t).toFixed(1)}`; });
  let rain = "";
  for (let i = 0; i < n; i++) {
    if (sky.rain[i] < 50) continue;
    let j = i;
    while (j + 1 < n && sky.rain[j + 1] >= 50) j++;
    rain += `<i class="rain" style="left:${Math.max(0, x(i) - 3).toFixed(1)}%;width:${(x(j) - x(i) + 6).toFixed(1)}%"></i>`;
    i = j;
  }
  const now = sky.at >= 0 ? `<i class="now" style="left:${x(sky.at).toFixed(1)}%;top:${((y(sky.temp[sky.at]) / 30) * 100).toFixed(1)}%"></i>` : "";
  const hours = sky.hours.map((h, i) => (h % 3 === 0 ? `<span style="left:${Math.min(97, Math.max(3, x(i))).toFixed(1)}%">${h}</span>` : "")).join("");
  box.innerHTML = `<div class="sky-head"><div><strong>${sky.now ?? sky.max}°</strong><span>${esc(sky.city)} · ${esc(sky.note)}</span></div><em>${sky.min}° / ${sky.max}°</em></div><div class="sky-band" style="background:linear-gradient(90deg, ${stops})">${rain}<svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d="${path}"/></svg>${now}</div><div class="sky-hours">${hours}</div>`;
  return box;
}

function fileNode(f, full = false) {
  const ext = (f.name.split(".").pop() || "").slice(0, 4).toUpperCase();
  const card = el("button", "card file");
  card.type = "button";
  card.dataset.open = f.id;
  const pic = isImage(f);
  card.innerHTML = `<span class="doc${pic ? " pic" : ""}">${pic ? "" : `<span>${esc(ext || "PLIK")}</span>`}</span><span class="meta"><strong></strong><span class="sub"></span></span><span class="go">${pic ? "Pokaż" : "Otwórz"}</span>`;
  if (pic) card.querySelector(".doc").append(thumb(f, cards));
  card.querySelector("strong").textContent = pic ? f.name.replace(/\.\w+$/, "") : f.name;
  card.querySelector(".sub").textContent = [pic ? "Obrazek" : KINDS[ext] || "Plik", size(f.size), full ? shortDay.format(new Date(f.ts)) : ""].filter(Boolean).join(" · ");
  return card;
}

function taskSub(t, full) {
  const base = t.status === "running" ? t.step || "Pracuje" : t.status === "done" ? "Gotowe" : t.status === "cancelled" ? "Przerwane" : "Nie udało się";
  if (!full || t.status === "running") return base;
  return [base, t.usd ? `${money(t.usd)} USD` : "", t.updated || t.ts ? when.format(new Date(t.updated || t.ts)) : ""].filter(Boolean).join(" · ");
}

function taskCard(t, where) {
  const running = t.status === "running";
  const card = el("div", `card task${running ? " running" : ""}`);
  card.dataset.task = t.id;
  card.dataset.where = where;
  if (where === "thread") card.dataset.goto = "tasks";
  card.append(mini(t.agent, running ? "working" : t.status === "done" ? "idle" : "sleeping"));
  const meta = el("div", "meta", "<strong></strong><span class=\"sub\"></span>");
  meta.querySelector("strong").textContent = t.title;
  meta.querySelector(".sub").textContent = taskSub(t, where === "list");
  card.append(meta);
  if (running) {
    const b = el("button", "btn ghost small", "Przerwij");
    b.type = "button";
    b.dataset.cancel = t.id;
    card.append(b, el("i", "track", '<i class="bar"></i>'));
  }
  return card;
}

const isBubble = (m) => m.who !== "sys" && !["task", "sky", "brief", ...CARD_KINDS].includes(m.kind);
const fromKey = (m) => (m.who === "agent" ? `a:${m.agent || "valet"}` : m.who);
const stampNode = (ts) => el("time", "stamp", clock.format(new Date(ts)));

function nodes(m, join) {
  const out = [];
  if (m.who === "sys") { const n = el("div", `sys${m.kind === "error" ? " err" : ""}`, esc(m.text)); n.dataset.id = m.id; out.push(n); return out; }
  if (m.who === "agent" && m.agent && m.agent !== "valet" && m.kind !== "task" && !join) {
    const who = el("div", "who");
    who.append(mini(m.agent), document.createTextNode(agentOf(m.agent).name));
    out.push(who);
  }
  if (m.kind === "task") {
    const task = S.tasks.get(m.data?.task) || { id: m.data?.task, title: m.text, status: "done", agent: m.agent, step: "" };
    const card = taskCard(task, "thread");
    card.dataset.id = m.id;
    out.push(card);
    return out;
  }
  if (m.kind === "sky" && m.data?.sky) {
    const card = el("div", "card sky");
    card.dataset.id = m.id;
    card.append(skyNode(m.data.sky));
    out.push(card);
    return out;
  }
  if (CARD_KINDS.includes(m.kind)) {
    const card = connectorCard(m, cards);
    if (card) { card.dataset.id = m.id; out.push(card); return out; }
  }
  if (m.kind === "brief") {
    const card = el("div", "card brief", `<h3>${esc(m.data?.title || "Brief")}</h3><div class="text">${md(m.text)}</div>`);
    card.dataset.id = m.id;
    if (m.data?.agenda) { const box = el("div", "sky-box"); box.append(agendaNode(m.data.agenda, { empty: false })); card.append(box); }
    if (m.data?.sky) { const box = el("div", "sky-box"); box.append(skyNode(m.data.sky)); card.append(box); }
    if (m.data?.week) card.append(el("div", "week", m.data.week.map((d) => `<div><span>${weekday.format(new Date(`${d.day}T12:00`))}</span><b>${d.max}°</b><span>${d.min}°</span><i style="--o:${(d.rain / 100).toFixed(2)}"></i></div>`).join("")));
    out.push(card);
    return out;
  }
  const bubble = el("div", `msg ${m.who === "me" ? "me" : "ag"}${join ? " join" : ""}`);
  if (m.reply_to && S.byId.has(m.reply_to)) {
    const q = el("span", "quote", esc(S.byId.get(m.reply_to).text));
    q.dataset.jump = m.reply_to;
    bubble.append(q);
  }
  if (m.kind === "remind") bubble.append(el("span", "label", "Przypomnienie"));
  if (m.who === "me") bubble.append(document.createTextNode(m.text));
  else bubble.insertAdjacentHTML("beforeend", md(m.text));
  bubble.append(stampNode(m.ts));
  bubble.dataset.id = m.id;
  out.push(bubble);
  for (const f of m.data?.files || []) { const c = fileNode(f); c.classList.add("att"); out.push(c); }
  if (m.data?.sources?.length) {
    const row = el("div", "sources att hscroll");
    for (const s of m.data.sources) {
      const a = el("a", "", esc(s.title));
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
      row.append(a);
    }
    out.push(row);
  }
  return out;
}

function nearBottom() { return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 160; }
function toBottom() { chat.scrollTop = chat.scrollHeight; }
function place(n) { thread.insertBefore(n, typingNode && typingNode.parentNode === thread ? typingNode : null); }

function separator(ts) {
  const d = new Date(ts), key = d.toDateString();
  let label = "";
  if (key !== S.lastDay) {
    const today = new Date().toDateString(), yesterday = new Date(Date.now() - 86400000).toDateString();
    label = `<b>${key === today ? "Dziś" : key === yesterday ? "Wczoraj" : dayName.format(d)}</b> ${clock.format(d)}`;
  } else if (ts - S.lastTs > 3600000) label = clock.format(d);
  S.lastDay = key;
  S.lastTs = ts;
  if (!label) return null;
  S.tail = null;
  return el("div", "day", label);
}

function enter(n, mine, i = 0) {
  anim(n, [{ opacity: 0, transform: `translate3d(${mine ? 0 : -16}px, 10px, 0) scale(.94)` }, { opacity: 1, transform: "none" }], { ease: "bounce", delay: i * 45 });
}

function morphIn(n, r) {
  const b = n.getBoundingClientRect();
  const sx = Math.min(1, r.width / b.width), sy = Math.min(1, r.height / b.height);
  anim(n, [{ transform: `translate3d(${(r.left - b.left).toFixed(1)}px, ${(r.bottom - b.bottom).toFixed(1)}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})` }, { transform: "none" }], { dur: 520 });
  [...n.children].forEach((c) => { if (!c.classList.contains("stamp")) anim(c, [{ opacity: 0 }, { opacity: 1 }], { dur: 280, delay: 120, ease: "out" }); });
  const dots = el("span", "dots-ghost", "<i></i><i></i><i></i>");
  n.append(dots);
  const a = anim(dots, [{ opacity: 1 }, { opacity: 0 }], { dur: 140, ease: "out", fill: "forwards" });
  if (a) a.onfinish = () => dots.remove(); else dots.remove();
}

function addMsg(m, animate = true) {
  if (S.byId.has(m.id)) return;
  S.byId.set(m.id, m);
  const stick = nearBottom();
  if (m.who === "me") {
    const i = S.pending.findIndex((p) => p.text === m.text);
    if (i >= 0) {
      const p = S.pending.splice(i, 1)[0];
      p.node.classList.remove("pending");
      p.node.dataset.id = m.id;
      S.lastTs = m.ts;
      return;
    }
  }
  $("thread-empty")?.remove();
  const sep = separator(m.ts);
  if (sep) { place(sep); if (animate) anim(sep, [{ opacity: 0 }, { opacity: 1 }], { dur: 300, ease: "out" }); }
  const from = fromKey(m);
  const join = isBubble(m) && S.tail?.from === from && m.ts - S.tail.ts < 300000;
  const list = nodes(m, join);
  const bubble = list.find((n) => n.classList.contains("msg"));
  const morph = animate && !RM.matches && typingNode && m.who === "agent" && bubble && stick;
  const from0 = morph ? typingNode.getBoundingClientRect() : null;
  list.forEach(place);
  S.tail = isBubble(m) && !m.data?.files?.length && !m.data?.sources?.length ? { from, ts: m.ts } : null;
  if (morph) { typingNode.remove(); typingNode = null; }
  if (stick || m.who === "me") toBottom();
  if (!animate) return;
  list.forEach((n, i) => (n === bubble && morph ? morphIn(n, from0) : enter(n, m.who === "me", i)));
  if (!stick && m.who !== "me") bump(1);
  if (m.who === "agent" && S.status.state === "idle") flash("speaking", 1300);
}

function editMsg(m) {
  if (!S.byId.has(m.id)) return;
  S.byId.set(m.id, m);
  const old = thread.querySelector(`.kx[data-id="${m.id}"]`), fresh = old && connectorCard(m, cards);
  if (fresh) { fresh.dataset.id = m.id; old.replaceWith(fresh); }
}

function emptyThread() {
  const box = el("div", "empty in-thread");
  box.id = "thread-empty";
  const p = mini("valet");
  p.classList.add("tap");
  p.dataset.poke = "";
  watch(p);
  box.append(p, el("p", "", "To początek rozmowy. Napisz, czego potrzebujesz, a Valet odpisze tutaj."));
  return box;
}

function renderThread(msgs) {
  const keep = S.pending.map((p) => p.node);
  thread.textContent = "";
  typingNode = null;
  S.byId.clear();
  S.lastDay = "";
  S.lastTs = 0;
  S.tail = null;
  const older = el("div", "older", '<i class="spin"></i>');
  older.id = "older";
  older.hidden = !S.hasMore;
  thread.append(older);
  if (!msgs.length && !keep.length) thread.append(emptyThread());
  msgs.forEach((m) => addMsg(m, false));
  keep.forEach(place);
  if (IOS && !standalone()) thread.append(el("div", "sys hint", "Dodaj apkę do ekranu początkowego: Udostępnij, potem „Do ekranu początkowego”, i otwieraj ją stamtąd. Dopiero wtedy działają powiadomienia."));
  if (S.status.turn) showTyping(true, false);
}

function showTyping(on, animate = true) {
  if (on && !typingNode) {
    const stick = nearBottom();
    typingNode = el("div", "typing", "<i></i><i></i><i></i>");
    thread.append(typingNode);
    if (stick) toBottom();
    if (animate) anim(typingNode, [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "none" }], { ease: "pop", dur: 620 });
  } else if (!on && typingNode) {
    const n = typingNode;
    typingNode = null;
    const a = anim(n, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.6)" }], { dur: 160, ease: "in", fill: "forwards" });
    if (a) a.onfinish = () => n.remove(); else n.remove();
  }
}

async function loadOlder() {
  if (S.loadingOlder || !S.hasMore || !S.byId.size) return;
  S.loadingOlder = true;
  $("older")?.classList.add("on");
  try {
    const first = Math.min(...S.byId.keys());
    const { msgs } = await api(`/api/thread?before=${first}`);
    S.hasMore = msgs.length > 0 && msgs[0].id > 1;
    if (msgs.length) {
      const all = [...msgs, ...[...S.byId.values()].sort((a, b) => a.id - b.id)];
      const fromBottom = chat.scrollHeight - chat.scrollTop;
      renderThread(all);
      chat.scrollTop = chat.scrollHeight - fromBottom;
    } else if ($("older")) $("older").hidden = true;
  } catch (e) {
    S.hasMore = false;
    if ($("older")) $("older").hidden = true;
  } finally {
    S.loadingOlder = false;
    $("older")?.classList.remove("on");
  }
  if (S.hasMore && chat.scrollTop < 200) requestAnimationFrame(loadOlder);
}

let scrollRaf = 0;
function onChatScroll() {
  scrollRaf = 0;
  const dist = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
  $("jump").classList.toggle("on", dist > 260 && S.tab === "chat");
  if (dist < 80 && S.unread) bump(0);
  if (chat.scrollTop < 200 && S.booted) loadOlder();
}

function bump(n) {
  S.unread = n ? S.unread + n : 0;
  const c = $("jump-n");
  c.hidden = !S.unread;
  c.textContent = S.unread > 9 ? "9+" : String(S.unread);
  if (n) anim(c, [{ transform: "scale(.3)" }, { transform: "none" }], { ease: "pop" });
}

function jumpTo(id) {
  const target = thread.querySelector(`[data-id="${id}"]`);
  if (!target) return;
  target.scrollIntoView({ behavior: RM.matches ? "auto" : "smooth", block: "center" });
  setTimeout(() => {
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
    anim(target, [{ transform: "none" }, { transform: "scale(1.035)", offset: 0.3 }, { transform: "none" }], { dur: 700, ease: "spring" });
    setTimeout(() => target.classList.remove("flash"), 1400);
  }, RM.matches ? 0 : 380);
}

function pill(text) {
  const p = $("status"), label = $("status-text");
  p.classList.toggle("wait", S.offline);
  if (!text) { p.classList.remove("on"); return; }
  if (!p.classList.contains("on")) { label.textContent = text; p.classList.add("on"); return; }
  if (label.textContent === text) return;
  const w0 = p.offsetWidth;
  const ghost = label.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.classList.add("ghost");
  p.append(ghost);
  label.textContent = text;
  const w1 = p.offsetWidth;
  anim($("status-bg"), [{ transform: `scaleX(${(w0 / w1).toFixed(3)})` }, { transform: "none" }], { dur: 460 });
  anim(label, [{ opacity: 0, transform: "translate3d(0, 6px, 0)" }, { opacity: 1, transform: "none" }], { dur: 420, delay: 50 });
  const a = anim(ghost, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, -6px, 0)" }], { dur: 150, ease: "in", fill: "forwards" });
  if (a) a.onfinish = () => ghost.remove(); else ghost.remove();
}

function paintStatus() {
  const state = local || S.status.state || "idle";
  setState(puck, state);
  pill(S.offline ? "Łączenie" : local === "listening" ? "Słucha" : S.status.text || "");
}

function flash(state, ms) {
  local = state;
  paintStatus();
  clearTimeout(speakTimer);
  speakTimer = setTimeout(() => { if (local === state) { local = ""; paintStatus(); } }, ms);
}

function setStatus(st) {
  S.status = st;
  clearTimeout(statusTimer);
  if (st.state === "happy" || st.state === "error") statusTimer = setTimeout(() => { S.status = { state: "idle", text: "" }; paintStatus(); api("/api/boot").then((d) => { if (d.status.state !== "idle") setStatus(d.status); }).catch(() => {}); }, 2800);
  if (st.state !== "idle") { local = ""; look(puck, 0, 0); }
  showTyping(!!st.turn);
  paintStatus();
}

function setLive(on) {
  clearTimeout(S.offTimer);
  if (on) { if (S.offline) { S.offline = false; paintStatus(); } return; }
  S.offTimer = setTimeout(() => { if (!S.offline) { S.offline = true; paintStatus(); } }, 1500);
}

function setBadge(n) {
  const b = $("badge"), was = b.hidden ? 0 : +b.textContent;
  b.hidden = !n;
  b.textContent = String(n);
  if (n && n !== was) anim(b, [{ transform: "scale(.3)" }, { transform: "none" }], { ease: "pop" });
}

function updateTask(task) {
  const prev = S.tasks.get(task.id);
  S.tasks.set(task.id, task);
  const same = prev && prev.status === task.status;
  if (!same) renderTasks();
  document.querySelectorAll(`[data-task="${task.id}"]`).forEach((old) => {
    if (same) { const sub = old.querySelector(".sub"); if (sub) crossText(sub, taskSub(task, old.dataset.where === "list")); return; }
    if (old.dataset.where !== "thread") return;
    const n = taskCard(task, "thread");
    if (old.dataset.id) n.dataset.id = old.dataset.id;
    old.replaceWith(n);
    anim(n, [{ opacity: 0.4, transform: "scale(.97)" }, { opacity: 1, transform: "none" }], { ease: "bounce" });
    if (task.status === "done") { const p = n.querySelector(".puck"); setState(p, "happy"); setTimeout(() => setState(p, "idle"), 1800); }
  });
}

function secTitle(text) { return el("h3", "sec-t", esc(text)); }

function emptyState(key, text) {
  const box = el("div", "empty");
  const p = mini(key);
  p.classList.add("tap");
  p.dataset.poke = "";
  watch(p);
  box.append(p, el("p", "", esc(text)));
  return box;
}

function relDay(d) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  if (diff === 0) return "dziś";
  if (diff === 1) return "jutro";
  if (diff > 1 && diff < 7) return weekday.format(d);
  return shortDay.format(d);
}

function schedRow(r) {
  const d = new Date(r.due);
  const fromCal = String(r.builtin || "").startsWith("cal:");
  const row = el("div", `row sched${r.builtin ? " tap" : ""}`);
  row.dataset.sched = r.id;
  if (r.builtin) { row.dataset.openSettings = ""; row.setAttribute("role", "button"); }
  row.innerHTML = `<span class="when"><b>${clock.format(d)}</b><small>${esc(relDay(d))}</small></span><span class="meta"><strong></strong><span class="sub">${fromCal ? "przypomnienie z kalendarza" : REPEAT[r.repeat] || "jednorazowo"}</span></span>`;
  row.querySelector("strong").textContent = r.text;
  if (r.builtin) row.insertAdjacentHTML("beforeend", ICON.chev);
  else {
    const x = el("button", "icon-btn", ICON.minus);
    x.type = "button";
    x.dataset.unsched = r.id;
    x.setAttribute("aria-label", "Usuń przypomnienie");
    row.append(x);
  }
  return row;
}

function pastRow(t) {
  const row = el("div", "row past");
  row.dataset.task = t.id;
  row.dataset.where = "list";
  row.append(mini(t.agent, t.status === "done" ? "idle" : "sleeping"));
  const meta = el("span", "meta", "<strong></strong><span class=\"sub\"></span>");
  meta.querySelector("strong").textContent = t.title;
  meta.querySelector(".sub").textContent = taskSub(t, true);
  row.append(meta);
  return row;
}

function renderTasks() {
  const box = $("tasks");
  const all = [...S.tasks.values()].sort((a, b) => b.id - a.id), running = all.filter((t) => t.status === "running"), past = all.filter((t) => t.status !== "running");
  setBadge(running.length);
  box.textContent = "";
  box.append(el("h2", "big", "Zadania"));
  if (!all.length && !S.sched.length) { box.append(emptyState("kurier", "Tu pojawią się zadania w tle i przypomnienia. Poproś w czacie o raport, dokument albo przypomnienie.")); return; }
  if (running.length) { box.append(secTitle("W toku")); running.forEach((t) => box.append(taskCard(t, "list"))); }
  if (S.sched.length) {
    box.append(secTitle("Zaplanowane"));
    const g = el("div", "group");
    S.sched.forEach((r) => g.append(schedRow(r)));
    box.append(g);
  }
  if (past.length) {
    box.append(secTitle("Zakończone"));
    const g = el("div", "group");
    past.slice(0, 20).forEach((t) => g.append(pastRow(t)));
    box.append(g);
  }
}

function renderMake() {
  const box = $("make");
  box.textContent = "";
  box.append(el("h2", "big", "Twórz"));
  if (!S.files.length) { box.append(emptyState("atelier", "Tu trafią pliki od Atelier: PDF, dokumenty, arkusze, prezentacje, małe strony i obrazki.")); return; }
  box.append(el("p", "lead", "Poproś w czacie o plik, a Atelier zrobi go w tle i odda tutaj."));
  box.append(secTitle("Pliki"));
  for (const f of S.files) box.append(fileNode(f, true));
}

function setTab(tab, animate = true) {
  if (tab === S.tab) {
    const v = $(`view-${tab}`);
    if (tab === "chat") v.scrollTo({ top: v.scrollHeight, behavior: RM.matches ? "auto" : "smooth" });
    else v.scrollTo({ top: 0, behavior: RM.matches ? "auto" : "smooth" });
    return;
  }
  const from = S.tab, dir = TABS.indexOf(tab) > TABS.indexOf(from) ? 1 : -1;
  S.tab = tab;
  const a = $(`view-${from}`), b = $(`view-${tab}`);
  if (b._out) { b._out.cancel(); b._out = null; }
  b.hidden = false;
  $("composer").hidden = tab !== "chat";
  $("tabs").style.setProperty("--i", TABS.indexOf(tab));
  $("tabs").querySelectorAll("[data-tab]").forEach((x) => { const on = x.dataset.tab === tab; x.classList.toggle("on", on); x.setAttribute("aria-selected", on); });
  $("jump").classList.remove("on");
  if (tab === "chat") { toBottom(); requestAnimationFrame(onChatScroll); }
  if (animate) {
    anim(b, [{ opacity: 0, transform: `translate3d(${dir * 30}px, 0, 0)` }, { opacity: 1, transform: "none" }], { dur: 480 });
    const out = anim(a, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translate3d(${-dir * 30}px, 0, 0)` }], { dur: 200, ease: "out", fill: "forwards" });
    if (out) { a._out = out; out.onfinish = () => { if (a._out !== out) return; a._out = null; if (S.tab !== from) a.hidden = true; out.cancel(); }; }
    else a.hidden = true;
  } else a.hidden = true;
  if (!S.seen.has(tab)) { S.seen.add(tab); stagger(b.querySelector(".list").children, { from: animate ? 60 : 0 }); }
}

function applySettings(settings) {
  S.settings = settings;
  store.set("valet-settings", JSON.stringify(settings));
  remount(puck, settings.agents.valet.avatar);
  puck.setAttribute("aria-label", settings.agents.valet.name);
  $("me-btn").textContent = (settings.owner || "J").slice(0, 1).toUpperCase();
  renderCrew();
  remountMinis();
  paintStatus();
  SH.stack.forEach((p) => p.refresh?.());
}

async function openFile(id, card) {
  const f = S.files.find((x) => x.id === id);
  if (isImage(f)) return openImage(f, card?.querySelector(".doc") || null, cards).catch(() => toast("Nie udało się otworzyć obrazka"));
  const win = window.open("", "_blank");
  if (card) card.classList.add("busy");
  try {
    const { url } = await api("/api/file/link", { id });
    if (win) win.location = url; else location.href = url;
  } catch (e) {
    if (win) win.close();
    toast("Nie udało się otworzyć pliku");
  } finally {
    if (card) card.classList.remove("busy");
  }
}

function grow() {
  if (!mirror) {
    mirror = input.cloneNode();
    for (const a of ["id", "aria-label", "placeholder", "enterkeyhint"]) mirror.removeAttribute(a);
    mirror.className = "mirror";
    mirror.tabIndex = -1;
    mirror.setAttribute("aria-hidden", "true");
    $("cbox").append(mirror);
  }
  mirror.style.width = `${input.offsetWidth}px`;
  mirror.value = input.value || " ";
  const full = mirror.scrollHeight + 2, h = Math.min(132, Math.max(40, full));
  if (input.style.height !== `${h}px`) {
    const stick = nearBottom();
    input.style.height = `${h}px`;
    if (stick && S.tab === "chat") toBottom();
  }
  input.style.overflowY = full > 132 ? "auto" : "hidden";
  $("send").disabled = !input.value.trim();
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  grow();
  clearTimeout(listenTimer);
  local = "";
  look(puck, 0, 0);
  paintStatus();
  $("thread-empty")?.remove();
  const now = Date.now();
  const sep = separator(now);
  if (sep) place(sep);
  const join = S.tail?.from === "me" && now - S.tail.ts < 300000;
  const node = el("div", `msg me pending${join ? " join" : ""}`);
  node.textContent = text;
  node.append(stampNode(now));
  place(node);
  S.tail = { from: "me", ts: now };
  const item = { text, node };
  S.pending.push(item);
  toBottom();
  const r = node.getBoundingClientRect(), f = $("cbox").getBoundingClientRect();
  anim(node, [{ opacity: 0.2, transform: `translate3d(0, ${Math.max(0, f.top - r.top + 4).toFixed(1)}px, 0) scale(.92)` }, { opacity: 1, transform: "none" }], { ease: "bounce" });
  try {
    await api("/api/message", { text });
    setTimeout(() => { if (S.pending.includes(item)) sync().catch(() => {}); }, 1500);
  } catch (e) {
    S.pending = S.pending.filter((p) => p !== item);
    const a = anim(node, [{ opacity: 1 }, { opacity: 0 }], { dur: 160, ease: "out", fill: "forwards" });
    if (a) a.onfinish = () => node.remove(); else node.remove();
    S.tail = null;
    input.value = text;
    grow();
    const err = el("div", "sys err", "Nie udało się wysłać. Sprawdź połączenie i spróbuj jeszcze raz.");
    place(err);
    enter(err, false);
    toBottom();
  }
}

async function sync() {
  const d = await api("/api/boot");
  S.vapid = d.vapid;
  S.push = d.push;
  S.files = d.files;
  S.sched = d.sched;
  S.facts = d.facts;
  S.spend = d.spend;
  S.calendar = d.calendar || { on: false, calendars: [], today: [] };
  S.mac = d.mac || { on: false };
  const prevTasks = S.tasks;
  S.tasks = new Map(d.tasks.map((t) => [t.id, t]));
  S.status = d.status;
  applySettings(d.settings);
  if (!S.booted || !S.byId.size) {
    S.hasMore = d.msgs.length > 0 && d.msgs[0].id > 1;
    renderThread(d.msgs);
    toBottom();
  } else {
    const max = Math.max(...S.byId.keys());
    if (d.msgs.length && d.msgs[0].id > max + 1) { S.hasMore = true; renderThread(d.msgs); toBottom(); }
    else d.msgs.filter((m) => m.id > max).forEach((m) => addMsg(m));
    for (const t of d.tasks) { const p = prevTasks.get(t.id); if (p && (p.status !== t.status || p.step !== t.step)) { S.tasks.set(t.id, p); updateTask(t); } }
    showTyping(!!S.status.turn);
  }
  renderTasks();
  renderMake();
  paintStatus();
  refreshFacts();
  updateSpend();
}

async function connect() {
  if (S.ws) return;
  try {
    const { ticket } = await api("/api/ticket", {});
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/api/ws?k=${ticket}`);
    S.ws = ws;
    ws.onopen = () => { ws._ok = setTimeout(() => { S.retry = 1000; }, 5000); setLive(true); ws._ping = setInterval(() => { try { ws.send("ping"); } catch (e) {} }, 25000); };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const ev = JSON.parse(e.data);
      if (ev.t === "msg") addMsg(ev.m);
      else if (ev.t === "edit") editMsg(ev.m);
      else if (ev.t === "mac") S.mac = ev.mac;
      else if (ev.t === "status") setStatus(ev);
      else if (ev.t === "task") updateTask(ev.task);
      else if (ev.t === "files") { S.files = ev.files; renderMake(); }
      else if (ev.t === "sched") { S.sched = ev.sched; renderTasks(); }
      else if (ev.t === "facts") { S.facts = ev.facts; refreshFacts(); }
      else if (ev.t === "spend") { S.spend = ev.spend; updateSpend(); }
      else if (ev.t === "settings") { applySettings(ev.settings); if (ev.sched) { S.sched = ev.sched; renderTasks(); } }
    };
    ws.onclose = () => {
      clearInterval(ws._ping);
      clearTimeout(ws._ok);
      if (S.ws === ws) S.ws = null;
      setLive(false);
      if (!S.token) return;
      setTimeout(() => { if (document.visibilityState === "visible" && S.token) sync().then(connect).catch(() => connect()); }, S.retry);
      S.retry = Math.min(15000, S.retry * 2);
    };
  } catch (e) {
    setLive(false);
    if (!S.token) return;
    setTimeout(connect, S.retry);
    S.retry = Math.min(15000, S.retry * 2);
  }
}

function showPair(err = "") {
  SH.finish();
  $("app").hidden = true;
  const pair = $("pair"), was = !pair.hidden;
  pair.hidden = false;
  $("pair-err").textContent = err;
  const pp = $("pair-puck");
  if (!pp.firstChild) { mount(pp, { type: "orbita", cfg: {} }); watch(pp); }
  if (!was) stagger(pair.querySelectorAll(".pair-in > *"), { step: 55, y: 14 });
  if (err) { setState(pp, "error"); setTimeout(() => setState(pp, "idle"), 1500); }
}

function unpair() {
  S.token = "";
  S.booted = false;
  store.set("valet-token", null);
  store.set("valet-settings", null);
  if (S.ws) S.ws.close();
  showPair();
}

function booting() {
  if (S.booted) return;
  const app = $("app");
  app.hidden = false;
  app.classList.add("booting");
  try {
    const s = JSON.parse(store.get("valet-settings") || "null");
    if (s?.agents) { S.settings = s; remount(puck, s.agents.valet.avatar); renderCrew(); }
  } catch (e) {}
  if (!S.settings) { puck.classList.add("ghost"); $("crew").innerHTML = '<i class="puck ghost"></i><i class="puck ghost"></i><i class="puck ghost"></i>'; }
  thread.innerHTML = [[58, "ag"], [44, "me"], [72, "ag"], [36, "me"], [64, "ag"]].map(([w, k]) => `<div class="skel ${k}" style="width:${w}%"></div>`).join("");
}

function reveal() {
  const app = $("app");
  app.classList.remove("booting");
  puck.classList.remove("ghost");
  stagger([...thread.children].filter((n) => !n.hidden).slice(-8), { step: 38, y: 10 });
}

async function start() {
  booting();
  try {
    await sync();
    $("pair").hidden = true;
    $("app").hidden = false;
    if (!S.booted) { S.booted = true; reveal(); requestAnimationFrame(onChatScroll); }
    toBottom();
    setLive(false);
    connect();
    refreshPush();
    carryToken();
    const q = new URLSearchParams(location.search);
    if (["tasks", "make"].includes(q.get("tab"))) setTab(q.get("tab"), false);
    if (q.get("sheet") === "agents") openAgents(S.settings.agents[q.get("agent")] ? q.get("agent") : "");
    if (q.get("sheet") === "settings") openSettings();
  } catch (e) {
    if (S.token) { $("app").classList.remove("booting"); showPair("Nie mogę połączyć się z agentem. Spróbuj za chwilę."); }
  }
}

function bytes(b64) {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function subscribe() {
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(S.vapid) }));
  await api("/api/push", { subscription: sub.toJSON() });
}

function refreshPush() {
  if ("serviceWorker" in navigator && "PushManager" in window && window.Notification?.permission === "granted" && S.vapid) subscribe().catch(() => {});
}

function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.Notification) return { label: IOS && !standalone() ? "Najpierw ekran początkowy" : "Niedostępne", can: false };
  if (Notification.permission === "denied") return { label: "Zablokowane", can: false };
  if (Notification.permission === "granted") return { label: "Włączone", can: true, on: true };
  return { label: "Wyłączone", can: true };
}

function pushNote() {
  const st = pushState();
  if (!st.can && IOS && !standalone()) return "Na iPhonie powiadomienia działają tylko w apce dodanej do ekranu początkowego: Udostępnij, potem „Do ekranu początkowego”.";
  if (st.label === "Zablokowane") return "Powiadomienia są zablokowane w ustawieniach systemu dla tej aplikacji.";
  return S.push ? `Urządzenia z powiadomieniami: ${S.push}.` : "Żadne urządzenie nie ma jeszcze włączonych powiadomień.";
}

async function enablePush() {
  const note = $("push-note");
  const st = pushState();
  if (!st.can) { if (note) note.textContent = pushNote(); return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { renderPush(); return; }
  try {
    await subscribe();
    S.push = Math.max(1, S.push);
    renderPush();
    if ($("push-note")) $("push-note").textContent = "Powiadomienia włączone na tym urządzeniu.";
  } catch (e) {
    renderPush();
    if ($("push-note")) $("push-note").textContent = "Nie udało się włączyć powiadomień. Spróbuj ponownie.";
  }
}

const SH = createSheet({ sheet: $("sheet"), pages: $("pages"), scrim: $("scrim"), app: $("app"), onClose: () => { E = null; } });
let E = null, brush = "1", painting = false;

function row(cls, inner) { const r = el("div", `row ${cls || ""}`.trim(), inner); return r; }

function seg(items, current, attr) {
  const i = Math.max(0, items.findIndex(([v]) => String(v) === String(current)));
  return `<div class="seg" style="--n:${items.length};--i:${i}"><i class="thumb"></i>${items.map(([v, l], k) => `<button type="button" ${attr}="${esc(v)}" data-i="${k}"${k === i ? ' class="on"' : ""}>${esc(l)}</button>`).join("")}</div>`;
}

function segPick(btn) {
  const s = btn.closest(".seg");
  s.style.setProperty("--i", btn.dataset.i);
  s.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
}

function openAgents(key) {
  SH.show(agentsPage());
  if (key) SH.push(detailPage(key), { instant: true });
}

function agentsPage() {
  const pg = makePage({ title: "Agenci", big: "Agenci" });
  pg.body.append(el("p", "lead", "Trzech agentów w jednym wątku. Każdy ma swoją rolę, swój model i swój awatar."));
  const g = el("div", "group");
  pg.body.append(g);
  pg.refresh = () => {
    g.textContent = "";
    for (const k of ORDER) {
      const a = agentOf(k);
      const r = el("button", "row tap agent-row");
      r.type = "button";
      r.dataset.agentOpen = k;
      r.append(mini(k));
      r.insertAdjacentHTML("beforeend", `<span class="meta"><strong></strong><span class="sub"></span></span>${ICON.chev}`);
      r.querySelector("strong").textContent = a.name;
      r.querySelector(".sub").textContent = a.role;
      g.append(r);
    }
  };
  pg.refresh();
  stagger(g.children, { from: 140, step: 45 });
  return pg;
}

function detailPage(key) {
  const pg = makePage({ title: agentOf(key).name, back: "Agenci", fade: true, cls: "detail" });
  const hero = el("div", "hero");
  const big = el("div", "puck tap");
  big.dataset.poke = "";
  big.dataset.agentPuck = key;
  hero.append(big, el("h2", "name"), el("p", "role"));
  const about = el("p", "about");
  const g1 = el("div", "group"), g2 = el("div", "group");
  pg.body.append(hero, about, el("div", "sec", "Praca"), g1, el("div", "sec", "Wygląd"), g2);
  pg.refresh = () => {
    const a = agentOf(key), slot = AGENT_SLOT[key];
    remount(big, a.avatar);
    pg.nav.querySelector("h1").textContent = a.name;
    hero.querySelector(".name").textContent = a.name;
    hero.querySelector(".role").textContent = a.role;
    about.textContent = AGENT_ABOUT[key] || "";
    g1.innerHTML = `<button type="button" class="row tap" data-model-slot="${slot}" data-from="${esc(a.name)}"><span class="meta"><strong>Model</strong><span class="sub">${SLOTS[slot]}</span></span><span class="val">${MODEL_NAMES[S.settings.models[slot]] || ""}</span>${ICON.chev}</button>`;
    g2.innerHTML = `<button type="button" class="row tap action" data-edit-avatar="${key}"><span class="meta"><strong>Edytuj awatar</strong><span class="sub">${esc(TYPES[a.avatar.type]?.name || "")}, kolory i kształt</span></span>${ICON.chev}</button>`;
  };
  pg.refresh();
  watch(big);
  return pg;
}

function swatchRow(k, label) {
  const v = String(E.avatar.cfg[k]).toLowerCase();
  const known = SWATCHES.includes(v);
  return `<div class="crow"><div class="row"><span class="meta"><strong>${label}</strong></span><span class="dot" data-dot="${k}" style="background:${esc(v)}"></span></div><div class="swatches hscroll">${SWATCHES.map((s) => `<button type="button" class="sw${s === v ? " on" : ""}" style="background:${s}" data-k="${k}" data-v="${s}" aria-label="Kolor ${s}"></button>`).join("")}<label class="sw custom${known ? "" : " on"}" style="${known ? "" : `background:${esc(v)}`}" aria-label="Własny kolor">${ICON.plus}<input type="color" data-k="${k}" value="${esc(v)}"></label></div></div>`;
}

function editorPage(key) {
  const a = agentOf(key);
  E = { key, name: a.name, avatar: { type: a.avatar.type, cfg: { ...defaults(a.avatar.type), ...a.avatar.cfg } }, state: "idle", dirty: false };
  const save = el("button", "act strong", "Zapisz");
  save.type = "button";
  save.id = "e-save";
  save.disabled = true;
  const pg = makePage({ title: "Awatar", back: a.name, action: save, cls: "editor" });
  pg.body.innerHTML = `
    <div class="stage"><div class="puck tap" id="preview"></div><div class="chips hscroll" id="chips">${STATES.map(([id, name]) => `<button type="button" class="chip${id === "idle" ? " on" : ""}" data-state-chip="${id}">${name}</button>`).join("")}</div></div>
    <div class="group"><label class="row field"><span class="meta"><strong>Nazwa</strong></span><input type="text" id="e-name" maxlength="24" autocomplete="off" spellcheck="false" enterkeyhint="done"></label></div>
    <div class="sec">Rodzaj</div>
    <div id="e-type">${seg(Object.entries(TYPES).map(([k, v]) => [k, v.name]), E.avatar.type, "data-type")}</div>
    <div class="sec">Kolory</div>
    <div class="group" id="e-colors"></div>
    <div class="sec">Kształt</div>
    <div id="e-params"></div>`;
  pg.body.querySelector("#e-name").value = E.name;
  pg.body.querySelector("#e-colors").innerHTML = swatchRow("pk", "Krążek") + swatchRow("ink", "Rysunek") + swatchRow("acc", "Akcent");
  const preview = pg.body.querySelector("#preview");
  mount(preview, E.avatar);
  preview.dataset.state = "idle";
  watch(preview);
  renderParams(pg.body.querySelector("#e-params"), false);
  return pg;
}

function renderParams(box = $("e-params"), animate = true) {
  if (!box || !E) return;
  const t = TYPES[E.avatar.type], c = E.avatar.cfg;
  const g = el("div", "group");
  for (const p of t.params) {
    if (p.kind === "range") {
      const k = ((c[p.k] - p.min) / (p.max - p.min)) * 100;
      g.append(row("col", `<div class="row-top"><strong>${p.label}</strong><span class="val" data-val="${p.k}">${c[p.k]}</span></div><input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${c[p.k]}" style="--p:${k.toFixed(1)}%" aria-label="${p.label}">`));
    }
    if (p.kind === "select") g.append(row("col", `<div class="row-top"><strong>${p.label}</strong></div>${seg(p.opts, c[p.k], `data-k-set="${p.k}" data-v`)}`));
    if (p.kind === "pixels") {
      const brushes = [[".", "gumka"], ["1", "piksel"], ["2", "oko"], ["3", "usta"], ["4", "akcent"]];
      g.append(row("col", `<div class="row-top"><strong>${p.label}</strong><span class="val">Rysuj palcem po siatce</span></div>${seg(brushes, brush, "data-brush")}<div class="pixgrid" id="pix">${c[p.k].map((r, y) => [...r].map((k, x) => `<i data-i="${y * 8 + x}" data-k="${k}"></i>`).join("")).join("")}</div>`));
    }
  }
  box.textContent = "";
  box.append(g);
  tintGrid();
  if (animate) anim(g, [{ opacity: 0, transform: "translate3d(0, 10px, 0)" }, { opacity: 1, transform: "none" }]);
}

function tintGrid() {
  const g = $("pix");
  if (!g || !E) return;
  for (const k of ["pk", "ink", "acc"]) g.style.setProperty(`--${k}`, E.avatar.cfg[k]);
}

function paintPreview() {
  const p = $("preview");
  if (!p || !E) return;
  mount(p, E.avatar);
  tintGrid();
}

function markDirty() {
  if (!E) return;
  E.dirty = true;
  const s = $("e-save");
  if (s && s.disabled) { s.disabled = false; anim(s, [{ transform: "scale(.85)" }, { transform: "none" }], { ease: "pop" }); }
}

function setColor(k, v) {
  E.avatar.cfg[k] = v;
  const row = document.querySelector(`.crow [data-dot="${k}"]`)?.closest(".crow");
  if (row) {
    row.querySelector(".dot").style.background = v;
    const known = SWATCHES.includes(v.toLowerCase());
    row.querySelectorAll(".sw").forEach((s) => s.classList.toggle("on", s.classList.contains("custom") ? !known : s.dataset.v === v));
    const custom = row.querySelector(".custom");
    custom.style.background = known ? "" : v;
  }
  paintPreview();
  markDirty();
}

function paint(cell) {
  if (!E || !cell || cell.dataset.i === undefined || !cell.closest("#pix") || cell.dataset.k === brush) return;
  cell.dataset.k = brush;
  const i = +cell.dataset.i, rows = E.avatar.cfg.px.map((r) => [...r]);
  rows[Math.floor(i / 8)][i % 8] = brush;
  E.avatar.cfg.px = rows.map((r) => r.join(""));
  paintPreview();
  markDirty();
}

async function saveAvatar(btn) {
  if (!E) return;
  btn.disabled = true;
  try {
    const d = await api("/api/settings", { agent: { key: E.key, name: E.name.trim() || agentOf(E.key).name, avatar: E.avatar } });
    E.dirty = false;
    applySettings(d.settings);
    toast("Zapisane");
    SH.pop();
  } catch (e) {
    btn.disabled = false;
    toast("Nie udało się zapisać");
  }
}

function modelPage(slot, back) {
  const pg = makePage({ title: SLOTS[slot], back });
  const g = el("div", "group");
  pg.body.append(el("div", "sec", "Model"), g, el("p", "foot", SLOT_NOTES[slot]));
  pg.refresh = () => {
    g.textContent = "";
    for (const id of Object.keys(MODEL_NAMES)) {
      const r = el("button", `row tap pick${S.settings.models[slot] === id ? " on" : ""}`);
      r.type = "button";
      r.dataset.pickModel = id;
      r.dataset.slot = slot;
      r.innerHTML = `<span class="meta"><strong>${MODEL_NAMES[id]}</strong><span class="sub">${MODEL_NOTES[id]}</span></span>${ICON.check}`;
      g.append(r);
    }
  };
  pg.refresh();
  return pg;
}

async function pickModel(btn) {
  const slot = btn.dataset.slot, id = btn.dataset.pickModel, prev = S.settings.models[slot];
  if (prev === id) return;
  btn.closest(".group").querySelectorAll(".pick").forEach((r) => r.classList.toggle("on", r === btn));
  anim(btn.querySelector(".check"), [{ transform: "scale(.3)", opacity: 0 }, { transform: "none", opacity: 1 }], { ease: "pop" });
  try {
    const d = await api("/api/settings", { models: { [slot]: id } });
    applySettings(d.settings);
  } catch (e) {
    S.settings.models[slot] = prev;
    SH.stack.forEach((p) => p.refresh?.());
    toast("Nie udało się zmienić modelu");
  }
}

function openSettings() {
  SH.show(settingsPage());
  requestAnimationFrame(() => requestAnimationFrame(() => updateSpend(true)));
}

function settingsPage() {
  const pg = makePage({ title: "Ustawienia", big: "Ustawienia" });
  const s = S.settings;
  pg.body.insertAdjacentHTML("beforeend", `
    <div class="sec">Powiadomienia</div>
    <div class="group" id="push-group"></div>
    <p class="foot" id="push-note"></p>
    <div class="sec">Modele</div>
    <div class="group" id="models"></div>
    <p class="foot">Valet rozmawia, Kurier pisze briefy, Atelier robi dokumenty.</p>
    <div class="sec">Briefy</div>
    <div class="group">
      <div class="row tap" data-switch="b-daily"><span class="meta"><strong>Poranny brief</strong><span class="sub">Codziennie</span></span><button type="button" class="switch" role="switch" id="b-daily" aria-label="Poranny brief" aria-checked="${!!s.briefs.daily}"><i></i></button></div>
      <div class="row tap" data-switch="b-weekly"><span class="meta"><strong>Weekly Briefing</strong><span class="sub">W poniedziałek</span></span><button type="button" class="switch" role="switch" id="b-weekly" aria-label="Weekly Briefing" aria-checked="${!!s.briefs.weekly}"><i></i></button></div>
      <label class="row tap select-row"><span class="meta"><strong>Godzina</strong></span><span class="val" id="b-hour-val">${s.briefs.hour}:00</span>${ICON.updown}<select id="b-hour" aria-label="Godzina briefu">${[5, 6, 7, 8, 9, 10].map((h) => `<option value="${h}"${s.briefs.hour === h ? " selected" : ""}>${h}:00</option>`).join("")}</select></label>
    </div>
    <p class="foot">Brief przychodzi do wątku o tej godzinie.</p>
    <div class="sec">Kalendarz</div>
    <div class="group">
      <div class="row"><span class="meta"><strong>iCloud</strong></span><span class="val">${S.calendar?.on ? `Połączony, kalendarze: ${S.calendar.calendars.length}` : "Niepołączony"}</span></div>
      ${S.calendar?.on ? `<label class="row tap select-row"><span class="meta"><strong>Przypomnienie</strong><span class="sub">Przed wydarzeniem</span></span><span class="val" id="c-nudge-val">${nudgeName(s.calendar?.nudge ?? 30)}</span>${ICON.updown}<select id="c-nudge" aria-label="Przypomnienie przed wydarzeniem">${NUDGES.map(([v, n]) => `<option value="${v}"${(s.calendar?.nudge ?? 30) === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="row tap select-row"><span class="meta"><strong>Nowe wydarzenia</strong></span><span class="val" id="c-home-val">${esc(s.calendar?.home || S.calendar.calendars.find((c) => c.write)?.name || "")}</span>${ICON.updown}<select id="c-home" aria-label="Kalendarz dla nowych wydarzeń">${S.calendar.calendars.filter((c) => c.write).map((c) => `<option value="${esc(c.name)}"${s.calendar?.home === c.name ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
    </div>
    <p class="foot">${S.calendar?.on ? "Valet czyta kalendarz z iCloud, dodaje i przenosi wydarzenia, a o usunięcie zawsze pyta." : "Żeby Valet widział kalendarz, na serwerze musi być hasło aplikacji iCloud."}</p>
    <div class="sec">WhatsApp</div>
    <div class="group">
      <div class="row"><span class="meta"><strong>Mac</strong></span><span class="val">${S.mac?.on ? (S.mac.wa ? "Połączony" : "Połączony, bez dostępu do WhatsAppa") : "Niepołączony"}</span></div>
      <label class="row tap select-row"><span class="meta"><strong>Podpis</strong></span><span class="val" id="w-sign-val">${esc(signText(s.whatsapp?.sign))}</span>${ICON.updown}<select id="w-sign" aria-label="Podpis pod wiadomościami">${Object.keys(SIGNS).map((k) => `<option value="${k}"${(s.whatsapp?.sign || "made") === k ? " selected" : ""}>${esc(signText(k))}</option>`).join("")}</select></label>
      <div class="row tap" data-switch="w-pro"><span class="meta"><strong>Pilnowanie rozmów</strong><span class="sub">Valet pyta, czy odpisać</span></span><button type="button" class="switch" role="switch" id="w-pro" aria-label="Pilnowanie rozmów" aria-checked="${s.whatsapp?.proactive !== false}"><i></i></button></div>
    </div>
    <p class="foot">Valet czyta WhatsAppa przez aplikację na Macu i niczego nie wysyła bez Twojego „Wyślij”. Pilnowane rozmowy ustawisz w aplikacji na Macu.</p>
    <div class="sec">Wydatki</div>
    <div class="group" id="spend">
      <div class="row col meter-row"><div class="row-top"><strong>Dziś</strong><span class="val" id="spend-today"></span></div><div class="meter"><i id="meter"></i></div></div>
      <div class="row"><span class="meta"><strong>W tym miesiącu</strong></span><span class="val" id="spend-month"></span></div>
      <div class="row"><span class="meta"><strong>Limit dzienny</strong></span><span class="stepper"><button type="button" data-step="-1" aria-label="Zmniejsz limit">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>'}</button><output id="limit"></output><button type="button" data-step="1" aria-label="Zwiększ limit">${ICON.plus}</button></span></div>
    </div>
    <p class="foot">Po przekroczeniu dziennego limitu rozmowa schodzi na mały model, a nowe zadania w tle czekają do jutra.</p>
    <div class="sec">Pamięć</div>
    <div class="group" id="facts"></div>
    <p class="foot">To, co Valet o Tobie pamięta. Usunięta rzecz znika z jego pamięci.</p>
    <div class="sec">Urządzenie</div>
    <div class="group"><div class="row tap action" id="unpair" role="button" tabindex="0"><span class="meta"><strong>Rozłącz to urządzenie</strong></span></div></div>
    <p class="foot">Żeby połączyć je ponownie, potrzebny będzie klucz dostępu.</p>`);
  pg.refresh = () => { renderPush(); renderModels(); updateSpend(); };
  setTimeout(() => { renderPush(); renderModels(); renderFacts(); updateSpend(); }, 0);
  pg.onShow = () => { renderModels(); };
  return pg;
}

function renderPush() {
  const g = $("push-group");
  if (!g) return;
  const st = pushState();
  g.innerHTML = `<div class="row"><span class="meta"><strong>Na tym urządzeniu</strong></span><span class="val state${st.on ? " ok" : ""}">${st.label}</span></div>${st.can && !st.on ? '<button type="button" class="row tap action" id="push-on"><span class="meta"><strong>Włącz powiadomienia</strong></span></button>' : ""}<button type="button" class="row tap action" id="push-test"><span class="meta"><strong>Wyślij testowe powiadomienie</strong></span></button>`;
  $("push-note").textContent = pushNote();
}

function renderModels() {
  const g = $("models");
  if (!g) return;
  g.innerHTML = Object.entries(SLOTS).map(([slot, label]) => `<button type="button" class="row tap" data-model-slot="${slot}" data-from="Ustawienia"><span class="meta"><strong>${label}</strong></span><span class="val">${MODEL_NAMES[S.settings.models[slot]] || ""}</span>${ICON.chev}</button>`).join("");
}

function updateSpend(fromZero = false) {
  const m = $("meter");
  if (!m || !S.settings) return;
  const lim = S.settings.dailyUsd ?? S.spend.limit, k = Math.max(0, Math.min(1, S.spend.today / lim));
  $("spend-today").innerHTML = `<b>${money(S.spend.today)}</b> z ${money(lim)} USD`;
  $("spend-month").textContent = `${money(S.spend.month)} USD`;
  $("limit").textContent = `${money(lim)} USD`;
  m.classList.toggle("full", k >= 1);
  if (fromZero) { m.style.transition = "none"; m.style.transform = "scaleX(0)"; void m.offsetWidth; m.style.transition = ""; }
  m.style.transform = `scaleX(${Math.max(k, 0.012).toFixed(4)})`;
}

let limitTimer = 0;
function stepLimit(dir) {
  const cur = S.settings.dailyUsd ?? 6, next = Math.max(0.5, Math.min(50, Math.round((cur + dir * 0.5) * 2) / 2));
  if (next === cur) return;
  S.settings.dailyUsd = next;
  S.spend.limit = next;
  updateSpend();
  anim($("limit"), [{ transform: `translate3d(0, ${dir > 0 ? 6 : -6}px, 0)`, opacity: 0.3 }, { transform: "none", opacity: 1 }], { dur: 360 });
  clearTimeout(limitTimer);
  limitTimer = setTimeout(async () => {
    try { const d = await api("/api/settings", { dailyUsd: next }); S.settings = d.settings; S.spend.limit = d.settings.dailyUsd; updateSpend(); }
    catch (e) { toast("Nie udało się zapisać limitu"); }
  }, 600);
}

function renderFacts() {
  const box = $("facts");
  if (!box) return;
  box.textContent = "";
  if (!S.facts.length) { box.append(row("muted", "<span class=\"meta\">Valet nic jeszcze o Tobie nie zapamiętał.</span>")); return; }
  for (const f of S.facts) {
    const r = row("fact", "<span class=\"meta\"><span class=\"txt\"></span></span>");
    r.querySelector(".txt").textContent = f.text;
    const x = el("button", "icon-btn", ICON.minus);
    x.type = "button";
    x.dataset.fact = f.id;
    x.setAttribute("aria-label", "Usuń z pamięci");
    r.append(x);
    box.append(r);
  }
}

function refreshFacts() {
  const box = $("facts");
  if (!box || box.querySelector(".confirm")) return;
  renderFacts();
}

async function saveBriefs() {
  try {
    const d = await api("/api/settings", { briefs: { daily: $("b-daily").getAttribute("aria-checked") === "true", weekly: $("b-weekly").getAttribute("aria-checked") === "true", hour: +$("b-hour").value } });
    S.settings = d.settings;
  } catch (e) {
    toast("Nie udało się zapisać");
  }
}

function confirmRow(r, label, run) {
  if (r.classList.contains("confirm")) return;
  const box = el("span", "confirm-box");
  const no = el("button", "btn ghost small", "Anuluj"), yes = el("button", "btn small dark", esc(label));
  no.type = yes.type = "button";
  box.append(no, yes);
  r.append(box);
  r.classList.add("confirm");
  anim(box, [{ opacity: 0, transform: "translate3d(18px, 0, 0)" }, { opacity: 1, transform: "none" }], { dur: 420 });
  let timer = 0;
  const done = () => {
    clearTimeout(timer);
    r.classList.remove("confirm");
    const a = anim(box, [{ opacity: 1 }, { opacity: 0 }], { dur: 140, ease: "out", fill: "forwards" });
    if (a) a.onfinish = () => box.remove(); else box.remove();
  };
  timer = setTimeout(done, 5000);
  no.addEventListener("click", (e) => { e.stopPropagation(); done(); });
  yes.addEventListener("click", async (e) => {
    e.stopPropagation();
    clearTimeout(timer);
    yes.disabled = no.disabled = true;
    try { await run(); } catch (err) { yes.disabled = no.disabled = false; done(); toast("Nie udało się"); }
  });
}

async function collapse(node) {
  const a = anim(node, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.96)" }], { dur: 170, ease: "in", fill: "forwards" });
  if (a) await a.finished.catch(() => {});
  const scope = node.closest(".list, .page-body") || node.parentNode;
  const items = [...scope.querySelectorAll(".row, .card, .group, .sec, .sec-t, .foot")].filter((n) => n !== node && !node.contains(n) && !n.contains(node));
  const before = new Map(items.map((n) => [n, n.getBoundingClientRect().top]));
  node.remove();
  for (const [n, top] of before) {
    const d = top - n.getBoundingClientRect().top;
    if (Math.abs(d) > 0.5) anim(n, [{ transform: `translate3d(0, ${d.toFixed(1)}px, 0)` }, { transform: "none" }], { dur: 480 });
  }
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 1700);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = el("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (err) {}
    ta.remove();
    return ok;
  }
}

function openCtx(node) {
  const m = S.byId.get(+node.dataset.id), ctx = $("ctx");
  if (!m || !ctx.hidden) return;
  node.classList.remove("down");
  const r = node.getBoundingClientRect();
  ctx.textContent = "";
  ctx.hidden = false;
  const shade = el("div", "ctx-shade");
  const clone = node.cloneNode(true);
  clone.classList.remove("down", "timed", "flash");
  clone.classList.add("ctx-clone");
  clone.removeAttribute("data-id");
  clone.querySelectorAll("[data-id], [data-open], [data-jump]").forEach((n) => { n.removeAttribute("data-id"); n.removeAttribute("data-open"); n.removeAttribute("data-jump"); });
  Object.assign(clone.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  const menu = el("div", "ctx-menu", `<button type="button" class="ctx-item" data-copy>Kopiuj${ICON.copy}</button>`);
  const mine = node.classList.contains("me");
  ctx.append(shade, clone, menu);
  const mh = menu.offsetHeight, vh = window.visualViewport?.height || innerHeight;
  const below = r.bottom + 12 + mh < vh - 20;
  const top = below ? Math.max(r.bottom + 12, 16) : r.top - 12 - mh >= 16 ? r.top - 12 - mh : vh - mh - 24;
  menu.style.top = `${top}px`;
  if (mine) menu.style.right = `${Math.max(16, innerWidth - r.right)}px`; else menu.style.left = `${Math.max(16, r.left)}px`;
  menu.style.transformOrigin = `${mine ? "100%" : "0"} ${below ? "0" : "100%"}`;
  node.style.visibility = "hidden";
  S.ctx = { node, text: m.text, shade, clone, menu };
  anim(shade, [{ opacity: 0 }, { opacity: 1 }], { dur: 240, ease: "out" });
  anim(clone, [{ transform: "scale(.96)" }, { transform: "scale(1.03)" }], { ease: "bounce", fill: "forwards" });
  anim(menu, [{ opacity: 0, transform: "scale(.4)" }, { opacity: 1, transform: "none" }], { ease: "bounce", delay: 30 });
}

function closeCtx() {
  const c = S.ctx;
  if (!c) return;
  S.ctx = null;
  anim(c.shade, [{ opacity: 1 }, { opacity: 0 }], { dur: 200, ease: "out", fill: "forwards" });
  anim(c.menu, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.6)" }], { dur: 160, ease: "in", fill: "forwards" });
  anim(c.clone, [{ transform: "scale(1.03)" }, { transform: "none" }], { dur: 300, fill: "forwards" });
  setTimeout(() => { c.node.style.visibility = ""; if (!S.ctx) { $("ctx").hidden = true; $("ctx").textContent = ""; } }, RM.matches ? 190 : 290);
}

let hold = null;
function holdStart(e, target, fn) {
  hold = { x: e.clientX, y: e.clientY, fired: false, target };
  hold.timer = setTimeout(() => { if (hold) { hold.fired = true; fn(); } }, 460);
}

document.addEventListener("pointerdown", (e) => {
  if (hold) clearTimeout(hold.timer);
  hold = null;
  if (e.button > 0) return;
  const b = e.target.closest("#thread .msg:not(.pending), #thread .card.sky, #thread .card.brief");
  if (b && !e.target.closest("a, [data-jump], [data-open]")) return holdStart(e, b, () => openCtx(b));
  if (e.target.closest("#puck")) return holdStart(e, puck, () => openAgents("valet"));
}, { passive: true });
document.addEventListener("pointermove", (e) => { if (hold && !hold.fired && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 9) { clearTimeout(hold.timer); hold = null; } }, { passive: true });
document.addEventListener("pointerup", () => { if (hold && !hold.fired) { clearTimeout(hold.timer); hold = null; } }, { passive: true });
document.addEventListener("pointercancel", () => { if (hold && !hold.fired) { clearTimeout(hold.timer); hold = null; } }, { passive: true });
document.addEventListener("click", (e) => { if (hold?.fired) { e.stopPropagation(); e.preventDefault(); hold = null; } }, true);
thread.addEventListener("contextmenu", (e) => {
  const b = e.target.closest(".msg:not(.pending), .card.sky, .card.brief");
  if (!b) return;
  e.preventDefault();
  if (!hold?.fired) openCtx(b);
});

let timedTimer = 0;
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (S.ctx) {
    if (t.closest("[data-copy]")) { const ok = await copy(S.ctx.text); closeCtx(); toast(ok ? "Skopiowane" : "Nie udało się skopiować"); return; }
    if (t.closest("#ctx")) return closeCtx();
  }
  const open = t.closest("[data-open]");
  if (open) return openFile(open.dataset.open, open);
  const cancel = t.closest("[data-cancel]");
  if (cancel) { cancel.disabled = true; return api("/api/task/cancel", { id: +cancel.dataset.cancel }).catch(() => { cancel.disabled = false; toast("Nie udało się przerwać"); }); }
  const jump = t.closest("[data-jump]");
  if (jump) return jumpTo(jump.dataset.jump);
  const unsched = t.closest("[data-unsched]");
  if (unsched) {
    const r = unsched.closest(".row");
    return confirmRow(r, "Usuń", async () => {
      const d = await api("/api/sched/delete", { id: +unsched.dataset.unsched });
      S.sched = d.sched;
      await collapse(r);
      if (!S.sched.length) renderTasks();
    });
  }
  if (t.closest("[data-open-settings]")) return openSettings();
  const goto = t.closest("[data-goto]");
  if (goto && !t.closest("button")) return setTab(goto.dataset.goto);
  const tab = t.closest("[data-tab]");
  if (tab) { const svg = tab.querySelector("svg"); anim(svg, [{ transform: "scale(.78)" }, { transform: "none" }], { ease: "pop" }); return setTab(tab.dataset.tab); }
  if (t.closest("#jump")) { bump(0); return chat.scrollTo({ top: chat.scrollHeight, behavior: RM.matches ? "auto" : "smooth" }); }
  const msg = t.closest("#thread .msg");
  if (msg && !t.closest("a")) {
    const on = !msg.classList.contains("timed");
    thread.querySelectorAll(".msg.timed").forEach((n) => n.classList.remove("timed"));
    msg.classList.toggle("timed", on);
    clearTimeout(timedTimer);
    if (on) timedTimer = setTimeout(() => msg.classList.remove("timed"), 4000);
    return;
  }
  if (t.closest("#puck")) return poke(puck);
  const pk = t.closest("[data-poke]");
  if (pk) return poke(pk);
  if (t.closest("#agents-btn")) return openAgents();
  if (t.closest("#me-btn")) return openSettings();
  if (t.closest("[data-close]")) return SH.close();
  if (t.closest("[data-back]")) return SH.pop();
  const ag = t.closest("[data-agent-open]");
  if (ag) return SH.push(detailPage(ag.dataset.agentOpen));
  const ed = t.closest("[data-edit-avatar]");
  if (ed) return SH.push(editorPage(ed.dataset.editAvatar));
  const slot = t.closest("[data-model-slot]");
  if (slot) return SH.push(modelPage(slot.dataset.modelSlot, slot.dataset.from || "Wstecz"));
  const pickBtn = t.closest("[data-pick-model]");
  if (pickBtn) return pickModel(pickBtn);
  const chip = t.closest("[data-state-chip]");
  if (chip && E) {
    E.state = chip.dataset.stateChip;
    chip.parentNode.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === chip));
    setState($("preview"), E.state);
    return;
  }
  const type = t.closest("[data-type]");
  if (type && E) {
    if (type.dataset.type === E.avatar.type) return;
    segPick(type);
    E.avatar = { type: type.dataset.type, cfg: { ...defaults(type.dataset.type), pk: E.avatar.cfg.pk, ink: E.avatar.cfg.ink, acc: E.avatar.cfg.acc } };
    paintPreview();
    renderParams();
    markDirty();
    return;
  }
  const kset = t.closest("[data-k-set]");
  if (kset && E) { segPick(kset); E.avatar.cfg[kset.dataset.kSet] = kset.dataset.v; paintPreview(); markDirty(); return; }
  const sw = t.closest(".sw[data-v]");
  if (sw && E) return setColor(sw.dataset.k, sw.dataset.v);
  const b = t.closest("[data-brush]");
  if (b) { brush = b.dataset.brush; segPick(b); return; }
  if (t.closest("#preview")) return poke($("preview"));
  const save = t.closest("#e-save");
  if (save) return saveAvatar(save);
  if (t.closest("#push-on")) return enablePush();
  if (t.closest("#push-test")) {
    try { const d = await api("/api/push/test", {}); $("push-note").textContent = d.sent ? `Wysłane na ${d.sent === 1 ? "1 urządzenie" : `${d.sent} urządzenia`}.` : "Nie ma jeszcze urządzenia z włączonymi powiadomieniami."; }
    catch (err) { $("push-note").textContent = "Nie udało się wysłać testowego powiadomienia."; }
    anim($("push-note"), [{ opacity: 0 }, { opacity: 1 }], { dur: 240, ease: "out" });
    return;
  }
  const swRow = t.closest("[data-switch]");
  if (swRow) {
    const s = $(swRow.dataset.switch), on = s.getAttribute("aria-checked") !== "true";
    s.setAttribute("aria-checked", on);
    if (swRow.dataset.switch === "w-pro") return api("/api/settings", { whatsapp: { proactive: on } }).then((d) => { S.settings = d.settings; toast("Zapisane"); }).catch(() => toast("Nie udało się zapisać"));
    return saveBriefs();
  }
  const step = t.closest("[data-step]");
  if (step) return stepLimit(+step.dataset.step);
  const fact = t.closest("[data-fact]");
  if (fact) {
    const r = fact.closest(".row");
    return confirmRow(r, "Usuń", async () => {
      const d = await api("/api/fact/delete", { id: +fact.dataset.fact });
      S.facts = d.facts;
      await collapse(r);
      if (!S.facts.length) renderFacts();
    });
  }
  const un = t.closest("#unpair");
  if (un) return confirmRow(un, "Rozłącz", async () => unpair());
});

const sheetEl = $("sheet");
sheetEl.addEventListener("input", (e) => {
  const t = e.target;
  if (!E) return;
  if (t.id === "e-name") { E.name = t.value; return markDirty(); }
  if (t.type === "color" && t.dataset.k) return setColor(t.dataset.k, t.value);
  if (t.type === "range" && t.dataset.k) {
    E.avatar.cfg[t.dataset.k] = +t.value;
    t.style.setProperty("--p", `${(((+t.value - +t.min) / (+t.max - +t.min)) * 100).toFixed(1)}%`);
    const v = document.querySelector(`[data-val="${t.dataset.k}"]`);
    if (v) v.textContent = t.value;
    paintPreview();
    markDirty();
  }
});
sheetEl.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "b-hour") { $("b-hour-val").textContent = `${t.value}:00`; saveBriefs(); }
  if (t.id === "w-sign") {
    $("w-sign-val").textContent = signText(t.value);
    api("/api/settings", { whatsapp: { sign: t.value } }).then((d) => { S.settings = d.settings; toast("Zapisane"); }).catch(() => toast("Nie udało się zapisać"));
  }
  if (t.id === "c-nudge" || t.id === "c-home") {
    $("c-nudge-val").textContent = nudgeName(+$("c-nudge").value);
    $("c-home-val").textContent = $("c-home").value;
    api("/api/settings", { calendar: { nudge: +$("c-nudge").value, home: $("c-home").value } }).then((d) => { S.settings = d.settings; toast("Zapisane"); }).catch(() => toast("Nie udało się zapisać"));
  }
});
sheetEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "e-name") e.target.blur(); });
sheetEl.addEventListener("pointerdown", (e) => { if (e.target.closest("#pix")) { painting = true; paint(e.target); e.preventDefault(); } });
window.addEventListener("pointermove", (e) => { if (painting) paint(document.elementFromPoint(e.clientX, e.clientY)); });
window.addEventListener("pointerup", () => { painting = false; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.ctx) closeCtx();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("#unpair, [data-open-settings]")) { e.preventDefault(); e.target.click(); }
  if ((e.key === "Enter" || e.key === " ") && e.target === puck) { e.preventDefault(); poke(puck); }
});

$("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
input.addEventListener("input", () => {
  grow();
  if (S.status.state !== "idle") return;
  local = "listening";
  look(puck, 0, 0.9);
  paintStatus();
  clearTimeout(listenTimer);
  listenTimer = setTimeout(() => { if (local === "listening") { local = ""; look(puck, 0, 0); paintStatus(); } }, 1500);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); send(); }
});
$("send").addEventListener("pointerdown", (e) => e.preventDefault());
chat.addEventListener("scroll", () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(onChatScroll); }, { passive: true });

$("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("pair-key").value.trim(), go = $("pair-go");
  if (!key) { if (S.token) start(); else anim($("pair-key"), [{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(7px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(0)" }], { dur: 380, ease: "out" }); return; }
  S.token = key;
  $("pair-err").textContent = "";
  go.disabled = true;
  go.textContent = "Łączenie";
  try {
    await api("/api/boot");
    store.set("valet-token", key);
    $("pair-key").value = "";
    await start();
  } catch (err) {
    S.token = "";
    showPair("Ten klucz nie pasuje.");
    anim($("pair-key"), [{ transform: "translateX(0)" }, { transform: "translateX(-9px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(0)" }], { dur: 420, ease: "out" });
  } finally {
    go.disabled = false;
    go.textContent = "Połącz";
  }
});

if (window.visualViewport) {
  const fit = () => {
    document.documentElement.style.setProperty("--vvh", `${visualViewport.height}px`);
    document.body.classList.toggle("keys", window.innerHeight - visualViewport.height > 120);
    window.scrollTo(0, 0);
    if (S.tab === "chat" && document.activeElement === input) toBottom();
  };
  visualViewport.addEventListener("resize", fit);
  visualViewport.addEventListener("scroll", fit);
  fit();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.token && !S.ws && S.booted) sync().then(connect).catch(() => {});
});

function fromLink() {
  const linked = /[#&]k=([A-Za-z0-9_-]{16,})/.exec(location.hash);
  if (!linked) return false;
  S.token = linked[1];
  store.set("valet-token", S.token);
  if (standalone() || LOCAL) history.replaceState(null, "", location.pathname + location.search);
  return true;
}

function carryToken() {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link || !S.token || standalone() || LOCAL) return;
  const base = location.origin + location.pathname;
  const manifest = { name: "Concierge Valet", short_name: "Valet", lang: "pl", start_url: `${base}#k=${S.token}`, scope: base, display: "standalone", orientation: "portrait", background_color: "#f8f6f1", theme_color: "#f8f6f1", icons: [192, 512].map((n) => ({ src: `${base}icons/icon-${n}.png`, sizes: `${n}x${n}`, type: "image/png" })) };
  link.href = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(JSON.stringify(manifest))}`;
}

pressFeedback("button, .row.tap, .card, .msg:not(.pending), .chip");
document.addEventListener("touchstart", () => {}, { passive: true });
watch(puck);
window.addEventListener("hashchange", () => { if (fromLink()) start(); });
fromLink();
if (S.token) start(); else showPair();
