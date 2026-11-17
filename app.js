/* Concierge Valet app: one thread with the agent, live over WebSocket, tasks, files and settings with the avatar configurator. */
import { TYPES, SWATCHES, defaults, mount, watch, look, poke } from "./avatar.js";

const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = LOCAL ? "http://127.0.0.1:8790" : "https://concierge-valet-api.kalakasanyt.workers.dev";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};
const clock = new Intl.DateTimeFormat("pl-PL", { hour: "numeric", minute: "2-digit" });
const dayName = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
const when = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const MODEL_NAMES = { "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5", "claude-opus-5-5": "Opus 5.5" };
const STATES = [["idle", "Spokój"], ["listening", "Słucha"], ["thinking", "Myśli"], ["working", "Pracuje"], ["speaking", "Mówi"], ["asking", "Pyta"], ["happy", "Gotowe"], ["sleeping", "Śpi"]];

const S = { token: store.get("valet-token") || "", settings: null, byId: new Map(), tasks: new Map(), files: [], sched: [], facts: [], spend: { today: 0, month: 0, limit: 6 }, status: { state: "idle", text: "" }, vapid: "", push: 0, tab: "chat", ws: null, lastDay: "", pending: [], retry: 1000 };
const puck = $("puck"), thread = $("thread"), chat = $("view-chat"), input = $("input");
let typingNode = null, statusTimer = 0, listenTimer = 0, speakTimer = 0, local = "";

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
const agentOf = (key) => S.settings.agents[key] || S.settings.agents.valet;

function mini(key, state = "idle") {
  const p = el("div", "puck");
  mount(p, agentOf(key).avatar);
  p.dataset.state = state;
  return p;
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

function fileNode(f) {
  const card = el("div", "card file");
  const ext = (f.name.split(".").pop() || "").slice(0, 4).toUpperCase();
  card.innerHTML = `<span class="ico">${esc(ext)}</span><div class="meta"><strong>${esc(f.name)}</strong><span>${size(f.size)}</span></div><button class="btn small" data-open="${esc(f.id)}">Otwórz</button>`;
  return card;
}

function taskCard(task) {
  const card = el("div", "card task");
  card.dataset.task = task.id;
  const running = task.status === "running";
  card.append(mini(task.agent, running ? "working" : task.status === "done" ? "idle" : "sleeping"));
  const meta = el("div", "meta", `<strong>${esc(task.title)}</strong><span class="sub">${esc(running ? task.step || "Pracuje" : task.status === "done" ? "Gotowe" : task.status === "cancelled" ? "Przerwane" : "Nie udało się")}</span>`);
  card.append(meta);
  if (running) card.append(el("button", "btn ghost small", "Przerwij")).dataset.cancel = task.id;
  return card;
}

function nodes(m) {
  const out = [];
  const agent = m.who === "agent" ? agentOf(m.agent) : null;
  if (m.who === "agent" && m.agent && m.agent !== "valet" && m.kind !== "task") {
    const who = el("div", "who");
    who.append(mini(m.agent), document.createTextNode(agent.name));
    out.push(who);
  }
  if (m.who === "sys") { out.push(el("div", `sys${m.kind === "error" ? " err" : ""}`, esc(m.text))); return out; }
  if (m.kind === "task") {
    const task = S.tasks.get(m.data?.task) || { id: m.data?.task, title: m.text, status: "done", agent: m.agent, step: "" };
    out.push(taskCard(task));
    return out;
  }
  if (m.kind === "sky" && m.data?.sky) {
    const card = el("div", "card sky");
    card.append(skyNode(m.data.sky));
    out.push(card);
    return out;
  }
  if (m.kind === "brief") {
    const card = el("div", "card brief", `<h3>${esc(m.data?.title || "Brief")}</h3><div class="text">${md(m.text)}</div>`);
    if (m.data?.sky) { const box = el("div", "sky-box"); box.append(skyNode(m.data.sky)); card.append(box); }
    if (m.data?.week) card.append(el("div", "week", m.data.week.map((d) => `<div><span>${new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(new Date(`${d.day}T12:00`))}</span><b>${d.max}°</b><span>${d.min}°</span><i style="--o:${(d.rain / 100).toFixed(2)}"></i></div>`).join("")));
    out.push(card);
    return out;
  }
  const bubble = el("div", `msg ${m.who === "me" ? "me" : "ag"}`);
  if (m.reply_to && S.byId.has(m.reply_to)) {
    const q = el("span", "quote", esc(S.byId.get(m.reply_to).text));
    q.dataset.jump = m.reply_to;
    bubble.append(q);
  }
  if (m.kind === "remind") bubble.append(el("span", "label", "Przypomnienie"));
  if (m.who === "me") bubble.append(document.createTextNode(m.text));
  else bubble.insertAdjacentHTML("beforeend", md(m.text));
  bubble.dataset.id = m.id;
  out.push(bubble);
  for (const f of m.data?.files || []) out.push(fileNode(f));
  if (m.data?.sources?.length) {
    const row = el("div", "sources");
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

function addMsg(m, animate = true) {
  if (S.byId.has(m.id)) return;
  S.byId.set(m.id, m);
  const stick = nearBottom();
  if (m.who === "me") {
    const i = S.pending.findIndex((p) => p.text === m.text);
    if (i >= 0) S.pending.splice(i, 1)[0].node.remove();
  }
  const d = new Date(m.ts), key = d.toDateString();
  if (key !== S.lastDay) {
    S.lastDay = key;
    const today = new Date().toDateString(), yesterday = new Date(Date.now() - 86400000).toDateString();
    thread.insertBefore(el("div", "day", key === today ? "Dziś" : key === yesterday ? "Wczoraj" : dayName.format(d)), typingNode);
  }
  for (const n of nodes(m)) {
    if (!animate) n.style.animation = "none";
    thread.insertBefore(n, typingNode);
  }
  if (stick || m.who === "me") toBottom();
  if (animate && m.who === "agent" && S.status.state === "idle") flash("speaking", 1300);
}

function renderThread(msgs) {
  thread.textContent = "";
  typingNode = null;
  S.byId.clear();
  S.lastDay = "";
  S.pending = [];
  if (!msgs.length) thread.append(el("div", "sys", "To początek rozmowy. Napisz, czego potrzebujesz."));
  msgs.forEach((m) => addMsg(m, false));
  showTyping(!!S.status.turn);
  toBottom();
}

function showTyping(on) {
  if (on && !typingNode) {
    const stick = nearBottom();
    typingNode = el("div", "typing", "<i></i><i></i><i></i>");
    thread.append(typingNode);
    if (stick) toBottom();
  } else if (!on && typingNode) {
    typingNode.remove();
    typingNode = null;
  }
}

function paintStatus() {
  const state = local || S.status.state || "idle";
  puck.dataset.state = state;
  const text = local === "listening" ? "Słucha" : S.status.text || "";
  $("status").hidden = !text;
  $("status").textContent = text;
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

function updateTask(task) {
  S.tasks.set(task.id, task);
  document.querySelectorAll(`[data-task="${task.id}"]`).forEach((old) => old.replaceWith(taskCard(task)));
  renderTasks();
}

function renderTasks() {
  const box = $("tasks");
  box.textContent = "";
  const all = [...S.tasks.values()].sort((a, b) => b.id - a.id), running = all.filter((t) => t.status === "running"), past = all.filter((t) => t.status !== "running");
  $("badge").hidden = !running.length;
  $("badge").textContent = running.length;
  box.append(el("h2", "", "W toku"));
  if (!running.length) box.append(el("div", "empty", "Nic nie pracuje w tle. Poproś w czacie o raport albo dokument."));
  running.forEach((t) => box.append(taskCard(t)));
  box.append(el("h2", "", "Zaplanowane"));
  if (!S.sched.length) box.append(el("div", "empty", "Brak przypomnień i briefów."));
  for (const r of S.sched) {
    const repeat = { daily: "codziennie", weekdays: "w dni robocze", weekly: "co tydzień" }[r.repeat] || "jednorazowo";
    const card = el("div", "card row", `<div class="meta"><strong>${esc(r.text)}</strong><span class="sub">${esc(when.format(new Date(r.due)))} · ${repeat}</span></div>`);
    if (!r.builtin) { const x = el("button", "x", "×"); x.dataset.unsched = r.id; x.setAttribute("aria-label", "Usuń"); card.append(x); }
    box.append(card);
  }
  if (past.length) {
    box.append(el("h2", "", "Zakończone"));
    past.slice(0, 20).forEach((t) => box.append(taskCard(t)));
  }
}

function renderMake() {
  const box = $("make");
  box.textContent = "";
  box.append(el("h2", "", "Twórz"));
  if (!S.files.length) box.append(el("div", "empty", "Tu trafiają pliki, które zrobią dla Ciebie agenci: PDF, dokumenty, arkusze, prezentacje i małe strony."));
  for (const f of S.files) {
    const card = fileNode(f);
    card.querySelector(".meta span").textContent = `${size(f.size)} · ${dayName.format(new Date(f.ts))}`;
    box.append(card);
  }
}

function setTab(tab) {
  S.tab = tab;
  for (const name of ["chat", "tasks", "make"]) $(`view-${name}`).hidden = name !== tab;
  $("tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("composer").hidden = tab !== "chat";
  if (tab === "chat") toBottom();
}

function applySettings(settings) {
  S.settings = settings;
  mount(puck, settings.agents.valet.avatar);
  puck.setAttribute("aria-label", settings.agents.valet.name);
  $("me-btn").textContent = (settings.owner || "J").slice(0, 1).toUpperCase();
  paintStatus();
}

async function openFile(id, button) {
  const win = window.open("", "_blank");
  if (button) button.disabled = true;
  try {
    const { url } = await api("/api/file/link", { id });
    if (win) win.location = url; else location.href = url;
  } catch (e) {
    if (win) win.close();
  } finally {
    if (button) button.disabled = false;
  }
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
  const node = el("div", "msg me pending");
  node.textContent = text;
  thread.insertBefore(node, typingNode);
  const item = { text, node };
  S.pending.push(item);
  toBottom();
  try {
    await api("/api/message", { text });
    setTimeout(() => { if (S.pending.includes(item)) sync(); }, 1500);
  } catch (e) {
    node.remove();
    S.pending = S.pending.filter((p) => p !== item);
    input.value = text;
    grow();
    thread.insertBefore(el("div", "sys err", "Nie udało się wysłać. Sprawdź połączenie i spróbuj jeszcze raz."), typingNode);
  }
}

function grow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(132, Math.max(44, input.scrollHeight + 2))}px`;
  $("send").disabled = !input.value.trim();
}

async function sync() {
  const d = await api("/api/boot");
  S.vapid = d.vapid;
  S.push = d.push;
  S.files = d.files;
  S.sched = d.sched;
  S.facts = d.facts;
  S.spend = d.spend;
  S.tasks = new Map(d.tasks.map((t) => [t.id, t]));
  S.status = d.status;
  applySettings(d.settings);
  renderThread(d.msgs);
  renderTasks();
  renderMake();
}

async function connect() {
  if (S.ws) return;
  try {
    const { ticket } = await api("/api/ticket", {});
    const ws = new WebSocket(`${API.replace(/^http/, "ws")}/api/ws?k=${ticket}`);
    S.ws = ws;
    ws.onopen = () => { S.retry = 1000; ws._ping = setInterval(() => { try { ws.send("ping"); } catch (e) {} }, 25000); };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const ev = JSON.parse(e.data);
      if (ev.t === "msg") addMsg(ev.m);
      else if (ev.t === "status") setStatus(ev);
      else if (ev.t === "task") updateTask(ev.task);
      else if (ev.t === "files") { S.files = ev.files; renderMake(); }
      else if (ev.t === "sched") { S.sched = ev.sched; renderTasks(); }
      else if (ev.t === "facts") S.facts = ev.facts;
      else if (ev.t === "spend") S.spend = ev.spend;
      else if (ev.t === "settings") { applySettings(ev.settings); if (ev.sched) { S.sched = ev.sched; renderTasks(); } }
    };
    ws.onclose = () => {
      clearInterval(ws._ping);
      S.ws = null;
      if (!S.token) return;
      setTimeout(() => { if (document.visibilityState === "visible") sync().then(connect).catch(() => connect()); }, S.retry);
      S.retry = Math.min(15000, S.retry * 2);
    };
  } catch (e) {
    setTimeout(connect, S.retry);
    S.retry = Math.min(15000, S.retry * 2);
  }
}

function unpair() {
  S.token = "";
  store.set("valet-token", null);
  if (S.ws) S.ws.close();
  $("app").hidden = true;
  $("sheet").hidden = true;
  $("pair").hidden = false;
  mount($("pair-puck"), { type: "orbita", cfg: {} });
  watch($("pair-puck"));
}

async function start() {
  try {
    await sync();
    $("pair").hidden = true;
    $("app").hidden = false;
    toBottom();
    connect();
    refreshPush();
    const q = new URLSearchParams(location.search);
    if (["tasks", "make"].includes(q.get("tab"))) setTab(q.get("tab"));
    if (q.get("sheet") === "agents") openAgents(S.settings.agents[q.get("agent")] ? q.get("agent") : "valet");
    if (q.get("sheet") === "settings") openSettings();
  } catch (e) {
    if (S.token) { $("pair").hidden = false; $("pair-err").textContent = "Nie mogę połączyć się z agentem. Spróbuj za chwilę."; mount($("pair-puck"), { type: "orbita", cfg: {} }); }
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

async function enablePush(note) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.Notification) { note.textContent = "Ta przeglądarka nie pokaże powiadomień. Na iPhonie najpierw dodaj aplikację do ekranu początkowego: Udostępnij, potem „Do ekranu początkowego”, i otwórz ją stamtąd."; return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { note.textContent = "Powiadomienia są zablokowane w ustawieniach systemu dla tej aplikacji."; return; }
  try {
    await subscribe();
    note.textContent = "Powiadomienia włączone na tym urządzeniu.";
  } catch (e) {
    note.textContent = "Nie udało się włączyć powiadomień. Spróbuj ponownie.";
  }
}

const sheet = $("sheet"), sheetIn = $("sheet-in");
let E = null, brush = "1", painting = false;

function closeSheet() { sheet.hidden = true; sheetIn.textContent = ""; E = null; }

function head(title) {
  const h = el("div", "sheet-head", `<h1>${esc(title)}</h1>`);
  const b = el("button", "btn ghost small", "Gotowe");
  b.dataset.close = "1";
  h.append(b);
  return h;
}

function openAgents(key = "valet") {
  const a = S.settings.agents[key];
  E = { key, name: a.name, avatar: { type: a.avatar.type, cfg: { ...defaults(a.avatar.type), ...a.avatar.cfg } }, state: "idle" };
  sheet.hidden = false;
  renderAgents();
}

function renderAgents() {
  sheetIn.textContent = "";
  sheetIn.append(head("Agenci"));
  const list = el("div", "agents");
  for (const [key, a] of Object.entries(S.settings.agents)) {
    const row = el("button", `agent${key === E.key ? " on" : ""}`);
    row.dataset.agent = key;
    row.append(mini(key), el("div", "", `<strong>${esc(key === E.key ? E.name : a.name)}</strong><span class="sub">${esc(a.role)}</span>`));
    list.append(row);
  }
  sheetIn.append(list);
  const ed = el("div", "editor");
  ed.id = "editor";
  sheetIn.append(ed);
  renderEditor();
}

function renderEditor() {
  const ed = $("editor"), c = E.avatar.cfg, t = TYPES[E.avatar.type];
  const colors = (k, label) => `<div class="field"><span>${label}</span><span class="colors"><input type="color" data-k="${k}" value="${esc(c[k])}">${SWATCHES.map((s) => `<button class="sw" style="background:${s}" data-k="${k}" data-v="${s}" aria-label="${s}"></button>`).join("")}</span></div>`;
  let html = `<div class="stage"><div class="puck tap" id="preview"></div><div class="chips">${STATES.map(([id, name]) => `<button class="chip${id === E.state ? " on" : ""}" data-state-chip="${id}">${name}</button>`).join("")}</div></div>`;
  html += `<div class="field"><span>Nazwa</span><input type="text" id="e-name" maxlength="24" value="${esc(E.name)}"></div>`;
  html += `<div class="field"><span>Rodzaj</span><span class="chips" style="justify-content:flex-start">${Object.entries(TYPES).map(([k, v]) => `<button class="chip${k === E.avatar.type ? " on" : ""}" data-type="${k}">${v.name}</button>`).join("")}</span></div>`;
  html += colors("pk", "Krążek") + colors("ink", "Rysunek") + colors("acc", "Akcent");
  for (const p of t.params) {
    const v = c[p.k];
    if (p.kind === "select") html += `<div class="field"><span>${p.label}</span><select data-k="${p.k}">${p.opts.map(([val, lab]) => `<option value="${val}"${val === v ? " selected" : ""}>${lab}</option>`).join("")}</select></div>`;
    if (p.kind === "range") html += `<div class="field"><span>${p.label}</span><input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"></div>`;
    if (p.kind === "pixels") html += `<div class="field top-align"><span>${p.label}</span><span><span class="chips" style="justify-content:flex-start;margin-bottom:8px">${[[".", "gumka"], ["1", "piksel"], ["2", "oko"], ["3", "usta"], ["4", "akcent"]].map(([k, l]) => `<button class="chip${k === brush ? " on" : ""}" data-brush="${k}">${l}</button>`).join("")}</span><span class="pixgrid" id="pix">${v.map((row, y) => [...row].map((k, x) => `<i data-i="${y * 8 + x}" data-k="${k}"></i>`).join("")).join("")}</span></span></div>`;
  }
  html += `<div class="actions"><button class="btn" id="e-save">Zapisz awatar</button><span class="note" id="e-note"></span></div>`;
  ed.innerHTML = html;
  paintPreview();
}

function paintPreview() {
  const p = $("preview");
  if (!p) return;
  mount(p, E.avatar);
  p.dataset.state = E.state;
  watch(p);
}

function paint(cell) {
  if (!cell || cell.dataset.i === undefined || !cell.closest("#pix") || cell.dataset.k === brush) return;
  cell.dataset.k = brush;
  const i = +cell.dataset.i, rows = E.avatar.cfg.px.map((r) => [...r]);
  rows[Math.floor(i / 8)][i % 8] = brush;
  E.avatar.cfg.px = rows.map((r) => r.join(""));
  paintPreview();
}

function openSettings() {
  sheet.hidden = false;
  const s = S.settings;
  const select = (key, label) => `<div class="field"><span>${label}</span><select data-model="${key}">${Object.entries(MODEL_NAMES).map(([id, name]) => `<option value="${id}"${s.models[key] === id ? " selected" : ""}>${name}</option>`).join("")}</select></div>`;
  sheetIn.textContent = "";
  sheetIn.append(head("Ustawienia"));
  const box = el("div");
  box.style.display = "grid";
  box.style.gap = "12px";
  box.innerHTML = `
    <h2>Powiadomienia</h2>
    <div class="actions"><button class="btn" id="push-on">Włącz na tym urządzeniu</button><button class="btn ghost" id="push-test">Wyślij testowe</button></div>
    <div class="note" id="push-note">${S.push ? `Urządzenia z powiadomieniami: ${S.push}.` : "Żadne urządzenie nie ma jeszcze włączonych powiadomień."}</div>
    <h2>Modele</h2>
    ${select("chat", "Rozmowa")}${select("text", "Tekst i briefy")}${select("docs", "Dokumenty")}
    <h2>Briefy</h2>
    <label class="toggle">Poranny brief<input type="checkbox" id="b-daily"${s.briefs.daily ? " checked" : ""}></label>
    <label class="toggle">Weekly Briefing w poniedziałek<input type="checkbox" id="b-weekly"${s.briefs.weekly ? " checked" : ""}></label>
    <div class="field"><span>Godzina</span><select id="b-hour">${[5, 6, 7, 8, 9, 10].map((h) => `<option value="${h}"${s.briefs.hour === h ? " selected" : ""}>${h}:00</option>`).join("")}</select></div>
    <h2>Wydatki</h2>
    <div class="note">Dziś ${S.spend.today.toFixed(2).replace(".", ",")} USD, w tym miesiącu ${S.spend.month.toFixed(2).replace(".", ",")} USD. Po przekroczeniu dziennego limitu rozmowa schodzi na mały model, a nowe zadania w tle czekają do jutra.</div>
    <div class="field"><span>Limit dzienny</span><input type="number" id="limit" min="0.5" max="50" step="0.5" value="${s.dailyUsd}" inputmode="decimal"></div>
    <h2>Pamięć</h2>
    <div id="facts" style="display:grid;gap:8px"></div>
    <h2>Urządzenie</h2>
    <div class="actions"><button class="btn ghost" id="unpair">Rozłącz to urządzenie</button></div>`;
  sheetIn.append(box);
  renderFacts();
}

function renderFacts() {
  const box = $("facts");
  if (!box) return;
  box.textContent = "";
  if (!S.facts.length) box.append(el("div", "empty", "Valet nic jeszcze o Tobie nie zapamiętał."));
  for (const f of S.facts) {
    const row = el("div", "card row", `<div class="meta">${esc(f.text)}</div>`);
    const x = el("button", "x", "×");
    x.dataset.fact = f.id;
    x.setAttribute("aria-label", "Usuń");
    row.append(x);
    box.append(row);
  }
}

async function saveBriefs() {
  const d = await api("/api/settings", { briefs: { daily: $("b-daily").checked, weekly: $("b-weekly").checked, hour: +$("b-hour").value } });
  S.settings = d.settings;
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  const open = t.closest("[data-open]");
  if (open) return openFile(open.dataset.open, open);
  const cancel = t.closest("[data-cancel]");
  if (cancel) { cancel.disabled = true; return api("/api/task/cancel", { id: +cancel.dataset.cancel }).catch(() => {}); }
  const jump = t.closest("[data-jump]");
  if (jump) { const target = thread.querySelector(`[data-id="${jump.dataset.jump}"]`); if (target) target.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const unsched = t.closest("[data-unsched]");
  if (unsched) { const d = await api("/api/sched/delete", { id: +unsched.dataset.unsched }); S.sched = d.sched; return renderTasks(); }
  const tab = t.closest("[data-tab]");
  if (tab) return setTab(tab.dataset.tab);
  if (t.closest("#puck")) return poke(puck);
  if (t.closest("#agents-btn")) return openAgents();
  if (t.closest("#me-btn")) return openSettings();
  if (t.closest("[data-close]")) return closeSheet();
  const agent = t.closest("[data-agent]");
  if (agent) return openAgents(agent.dataset.agent);
  const chip = t.closest("[data-state-chip]");
  if (chip) { E.state = chip.dataset.stateChip; $("editor").querySelectorAll("[data-state-chip]").forEach((c) => c.classList.toggle("on", c === chip)); $("preview").dataset.state = E.state; return; }
  const type = t.closest("[data-type]");
  if (type) { E.avatar = { type: type.dataset.type, cfg: { ...defaults(type.dataset.type), pk: E.avatar.cfg.pk, ink: E.avatar.cfg.ink, acc: E.avatar.cfg.acc } }; return renderEditor(); }
  const sw = t.closest(".sw");
  if (sw) { E.avatar.cfg[sw.dataset.k] = sw.dataset.v; return renderEditor(); }
  const b = t.closest("[data-brush]");
  if (b) { brush = b.dataset.brush; $("editor").querySelectorAll("[data-brush]").forEach((x) => x.classList.toggle("on", x === b)); return; }
  if (t.closest("#preview")) return poke($("preview"));
  if (t.closest("#e-save")) {
    const d = await api("/api/settings", { agent: { key: E.key, name: E.name, avatar: E.avatar } });
    applySettings(d.settings);
    renderThread([...S.byId.values()]);
    renderTasks();
    const note = $("e-note");
    renderAgents();
    $("e-note").textContent = "Zapisane.";
    return note;
  }
  if (t.closest("#push-on")) return enablePush($("push-note"));
  if (t.closest("#push-test")) { const d = await api("/api/push/test", {}); $("push-note").textContent = d.sent ? `Wysłane na ${d.sent} urządzenie.` : "Nie ma jeszcze urządzenia z włączonymi powiadomieniami."; return; }
  const fact = t.closest("[data-fact]");
  if (fact) { const d = await api("/api/fact/delete", { id: +fact.dataset.fact }); S.facts = d.facts; return renderFacts(); }
  if (t.closest("#unpair")) return unpair();
});

sheet.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "e-name") { E.name = t.value; return; }
  if (E && t.dataset.k) { E.avatar.cfg[t.dataset.k] = t.type === "range" ? +t.value : t.value; return paintPreview(); }
});
sheet.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.model) { const d = await api("/api/settings", { models: { [t.dataset.model]: t.value } }); S.settings = d.settings; }
  if (["b-daily", "b-weekly", "b-hour"].includes(t.id)) saveBriefs();
  if (t.id === "limit") { const d = await api("/api/settings", { dailyUsd: +t.value }); S.settings = d.settings; S.spend.limit = d.settings.dailyUsd; }
});
sheet.addEventListener("pointerdown", (e) => { if (e.target.closest("#pix")) { painting = true; paint(e.target); e.preventDefault(); } });
window.addEventListener("pointermove", (e) => { if (painting) paint(document.elementFromPoint(e.clientX, e.clientY)); });
window.addEventListener("pointerup", () => { painting = false; });

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

$("pair-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("pair-key").value.trim();
  if (!key) return;
  S.token = key;
  $("pair-err").textContent = "";
  try {
    await api("/api/boot");
    store.set("valet-token", key);
    $("pair-key").value = "";
    start();
  } catch (err) {
    S.token = "";
    $("pair-err").textContent = "Ten klucz nie pasuje.";
    $("pair").hidden = false;
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
  if (document.visibilityState === "visible" && S.token && !S.ws) sync().then(connect).catch(() => {});
});

function fromLink() {
  const linked = /[#&]k=([A-Za-z0-9_-]{16,})/.exec(location.hash);
  if (!linked) return false;
  S.token = linked[1];
  store.set("valet-token", S.token);
  history.replaceState(null, "", location.pathname);
  return true;
}

watch(puck);
window.addEventListener("hashchange", () => { if (fromLink()) start(); });
fromLink();
if (S.token) start(); else unpair();
