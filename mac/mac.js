/* Concierge Valet for Mac: desktop client for the same thread, with a sidebar, an inspector, keyboard shortcuts and a native shell bridge. */
import { TYPES, SWATCHES, defaults, mount, watch, look, poke, setState } from "../avatar.js";
import { CARD_KINDS, card as connectorCard, openImage, thumb } from "../cards.js";

const V = window.VALET || {};
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) && !V.api;
const devPort = /^\d{4,5}$/.test(new URLSearchParams(location.search).get("api") || "") ? new URLSearchParams(location.search).get("api") : "8790";
const API = V.api || (LOCAL ? `http://127.0.0.1:${devPort}` : "https://concierge-valet-api.kalakasanyt.workers.dev");
const shell = window.webkit?.messageHandlers?.valet || null;
const native = (msg) => { try { shell?.postMessage(msg); } catch (e) {} };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};
const clock = new Intl.DateTimeFormat("pl-PL", { hour: "numeric", minute: "2-digit" });
const dayName = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short" });
const when = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const MODEL_NAMES = { "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-5-5": "Haiku 5.5", "claude-opus-5-5": "Opus 5.5" };
const MODEL_OF = { valet: "chat", atelier: "docs", kurier: "text" };
const STATES = [["idle", "Spokój"], ["listening", "Słucha"], ["thinking", "Myśli"], ["working", "Pracuje"], ["speaking", "Mówi"], ["asking", "Pyta"], ["happy", "Gotowe"], ["sleeping", "Śpi"]];
const TITLES = { chat: "Rozmowa", tasks: "Zadania", files: "Pliki", memory: "Pamięć" };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const S = { token: V.token || store.get("valet-token") || "", settings: null, byId: new Map(), tasks: new Map(), files: [], sched: [], facts: [], spend: { today: 0, month: 0, limit: 6 }, status: { state: "idle", text: "" }, view: "chat", agentKey: null, ws: null, lastDay: "", pending: [], retry: 1000, unread: 0, missed: 0 };
const puck = $("puck"), thread = $("thread"), scroller = $("chat-scroll"), input = $("input");
let typingNode = null, statusTimer = 0, listenTimer = 0, flashTimer = 0, local = "", E = null, brush = "1", painting = false, motion = null;

function tokens() {
  if (motion) return motion;
  const css = getComputedStyle(document.documentElement);
  const read = (k) => ({ easing: css.getPropertyValue(`--ease-${k}`).trim() || "ease-out", duration: (parseFloat(css.getPropertyValue(`--dur-${k}`)) || 0.5) * 1000 });
  motion = { spring: read("spring"), bounce: read("bounce") };
  return motion;
}

function play(node, frames, kind = "bounce", extra = {}) {
  if (reduce || !node.animate) return null;
  try { return node.animate(frames, { ...tokens()[kind], ...extra }); } catch (e) { return node.animate(frames, { duration: 300, easing: "ease-out", ...extra }); }
}

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

const plain = (text) => String(text || "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const money = (n) => n.toFixed(2).replace(".", ",");
const agentOf = (key) => S.settings.agents[key] || S.settings.agents.valet;
const isImage = (f) => String(f?.mime || "").startsWith("image/");
const cards = {
  link: (id) => api("/api/file/link", { id, hold: true }).then((d) => d.url),
  post: (path, body) => api(path, body),
  open: (url) => { if (shell) native({ type: "open", url }); else window.open(url, "_blank", "noopener"); },
};

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

function fileNode(f, withDate = false) {
  const card = el("div", "card file");
  card.dataset.open = f.id;
  const ext = (f.name.split(".").pop() || "").slice(0, 4).toUpperCase(), pic = isImage(f);
  card.innerHTML = `<span class="ico${pic ? " pic" : ""}">${pic ? "" : esc(ext)}</span><div class="grid-meta"><strong>${esc(pic ? f.name.replace(/\.\w+$/, "") : f.name)}</strong><span class="sub">${pic ? "Obrazek · " : ""}${size(f.size)}${withDate && f.ts ? ` · ${shortDay.format(new Date(f.ts))}` : ""}</span></div>${pic && withDate ? "" : `<button class="btn">${pic ? "Pokaż" : "Otwórz"}</button>`}`;
  if (pic) card.querySelector(".ico").append(thumb(f, cards));
  if (pic && withDate) card.classList.add("pic-tile");
  return card;
}

function taskCard(task) {
  const card = el("div", "card");
  card.dataset.task = task.id;
  const running = task.status === "running";
  const row = el("div", "task");
  row.append(mini(task.agent, running ? "working" : task.status === "done" ? "idle" : "sleeping"));
  const label = running ? task.step || "Pracuje" : task.status === "done" ? "Gotowe" : task.status === "cancelled" ? "Przerwane" : "Nie udało się";
  row.append(el("div", "grid-meta", `<strong>${esc(task.title)}</strong><span class="sub">${esc(agentOf(task.agent).name)} · ${esc(label)}</span>`));
  if (running) { const b = el("button", "btn ghost", "Przerwij"); b.dataset.cancel = task.id; row.append(b); }
  card.append(row);
  if (running) card.append(el("div", "track", "<i></i>"));
  return card;
}

function nodes(m) {
  const out = [];
  if (m.who === "sys") { out.push(el("div", `sys${m.kind === "error" ? " err" : ""}`, esc(m.text))); return out; }
  if (m.who === "agent" && m.agent && m.agent !== "valet" && m.kind !== "task") {
    const who = el("div", "who");
    who.append(mini(m.agent), document.createTextNode(agentOf(m.agent).name));
    out.push(who);
  }
  if (m.kind === "task") {
    out.push(taskCard(S.tasks.get(m.data?.task) || { id: m.data?.task, title: m.text, status: "done", agent: m.agent, step: "" }));
    return out;
  }
  if (m.kind === "sky" && m.data?.sky) {
    const card = el("div", "card");
    card.append(skyNode(m.data.sky));
    out.push(card);
    return out;
  }
  if (CARD_KINDS.includes(m.kind)) {
    const card = connectorCard(m, cards);
    if (card) { out.push(card); return out; }
  }
  if (m.kind === "brief") {
    const card = el("div", "card brief", `<h3>${esc(m.data?.title || "Brief")}</h3><div class="text">${md(m.text)}</div>`);
    if (m.data?.sky) { const box = el("div", "sky-box"); box.append(skyNode(m.data.sky)); card.append(box); }
    if (m.data?.week) card.append(el("div", "week", m.data.week.map((d) => `<div><span>${new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(new Date(`${d.day}T12:00`))}</span><b>${d.max}°</b><span>${d.min}°</span><i style="--o:${(d.rain / 100).toFixed(2)}"></i></div>`).join("")));
    out.push(card);
    return out;
  }
  const line = el("div", `line ${m.who === "me" ? "me" : "ag"}`);
  const bubble = el("div", `msg ${m.who === "me" ? "me" : "ag"}`);
  bubble.dataset.id = m.id;
  if (m.reply_to && S.byId.has(m.reply_to)) {
    const q = el("span", "quote", esc(plain(S.byId.get(m.reply_to).text)));
    q.dataset.jump = m.reply_to;
    bubble.append(q);
  }
  if (m.kind === "remind") bubble.append(el("span", "tag", "Przypomnienie"));
  if (m.who === "me") bubble.append(document.createTextNode(m.text));
  else bubble.insertAdjacentHTML("beforeend", md(m.text));
  const meta = el("span", "meta", esc(clock.format(new Date(m.ts))));
  const copy = el("button", "", "Kopiuj");
  copy.dataset.copy = m.id;
  meta.append(copy);
  line.append(bubble, meta);
  out.push(line);
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

const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 220;
const toBottom = (smooth = false) => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reduce ? "smooth" : "instant" });

function dayBreak(ts) {
  const d = new Date(ts), key = d.toDateString();
  if (key === S.lastDay) return;
  S.lastDay = key;
  const today = new Date().toDateString(), yesterday = new Date(Date.now() - 86400000).toDateString();
  thread.insertBefore(el("div", "day", key === today ? "Dziś" : key === yesterday ? "Wczoraj" : dayName.format(d)), typingNode);
}

function addMsg(m, live = true) {
  if (S.byId.has(m.id)) return;
  S.byId.set(m.id, m);
  const stick = nearBottom() || m.who === "me";
  if (m.who === "me") {
    const i = S.pending.findIndex((p) => p.text === m.text);
    if (i >= 0) {
      const item = S.pending.splice(i, 1)[0], bubble = item.line.querySelector(".msg");
      bubble.classList.remove("pending");
      bubble.dataset.id = m.id;
      item.line.querySelector(".meta").firstChild.textContent = clock.format(new Date(m.ts));
      item.line.querySelector("[data-copy]").dataset.copy = m.id;
      return;
    }
  }
  dayBreak(m.ts);
  const list = nodes(m);
  const from = typingNode && live && m.who === "agent" && m.kind === "text" ? typingNode.getBoundingClientRect() : null;
  if (from) showTyping(false);
  for (const n of list) thread.insertBefore(n, typingNode);
  if (live) {
    list.forEach((n, i) => {
      const bubble = n.classList.contains("line") ? n.querySelector(".msg") : n;
      if (i === 0 && from && n.classList.contains("line")) {
        const to = bubble.getBoundingClientRect();
        play(bubble, [{ transformOrigin: "0 100%", transform: `translate(${from.left - to.left}px, ${from.bottom - to.bottom}px) scale(${from.width / to.width}, ${from.height / to.height})` }, { transformOrigin: "0 100%", transform: "none" }], "spring");
        [...bubble.children].forEach((c) => c.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, fill: "backwards" }));
      } else play(bubble, [{ opacity: 0, transform: m.who === "me" ? "translateY(22px) scale(.94)" : "translateY(12px) scale(.97)" }, { opacity: 1, transform: "none" }], "bounce", { delay: i * 60, fill: "backwards" });
    });
  }
  if (stick) toBottom(live);
  else if (live && m.who !== "me") { S.missed++; paintJump(); }
  if (live && m.who === "agent") {
    if (S.status.state === "idle") flash("speaking", 1300);
    if (!document.hasFocus() && !CARD_KINDS.includes(m.kind)) {
      S.unread++;
      native({ type: "badge", count: S.unread });
      native({ type: "notify", title: agentOf(m.agent).name, body: plain(m.text).slice(0, 220) });
    }
    if (m.kind === "sky") renderInspector();
  }
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
    play(typingNode, [{ opacity: 0, transform: "translateY(10px) scale(.8)" }, { opacity: 1, transform: "none" }]);
    if (stick) toBottom(true);
  } else if (!on && typingNode) {
    typingNode.remove();
    typingNode = null;
  }
}

function paintJump() {
  const far = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 420;
  if (!far) S.missed = 0;
  $("jump").hidden = !far;
  $("jump").textContent = S.missed ? `Nowe wiadomości: ${S.missed}` : "Do najnowszych";
}

function paintStatus() {
  const state = local || S.status.state || "idle";
  setState(puck, state);
  const text = local === "listening" ? "Słucha" : S.status.text || (state === "idle" ? "Czeka" : "");
  const node = $("hero-status");
  if (node.textContent !== text) {
    node.textContent = text;
    play(node, [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], "spring");
  }
}

function flash(state, ms) {
  local = state;
  paintStatus();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (local === state) { local = ""; paintStatus(); } }, ms);
}

function setStatus(st) {
  S.status = st;
  clearTimeout(statusTimer);
  if (st.state === "happy" || st.state === "error") statusTimer = setTimeout(() => { S.status = { state: "idle", text: "" }; paintStatus(); renderInspector(); }, 2800);
  if (st.state !== "idle") { local = ""; look(puck, 0, 0); }
  showTyping(!!st.turn);
  paintStatus();
  renderInspector();
}

function updateTask(task) {
  S.tasks.set(task.id, task);
  document.querySelectorAll(`[data-task="${task.id}"]`).forEach((old) => old.replaceWith(taskCard(task)));
  paintCount();
  if (S.view === "tasks") renderTasks(false);
  renderInspector();
}

function paintCount() {
  const n = [...S.tasks.values()].filter((t) => t.status === "running").length;
  $("count").hidden = !n;
  $("count").textContent = n;
}

function stagger(box) {
  box.classList.add("stagger");
  [...box.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 14)));
}

function renderTasks(animate = true) {
  const box = $("tasks");
  box.textContent = "";
  const all = [...S.tasks.values()].sort((a, b) => b.id - a.id), running = all.filter((t) => t.status === "running"), past = all.filter((t) => t.status !== "running");
  box.append(el("h3", "", "W toku"));
  if (!running.length) box.append(el("div", "empty", "Nic nie pracuje w tle. Poproś w rozmowie o raport albo dokument, a zadanie pojawi się tutaj."));
  running.forEach((t) => box.append(taskCard(t)));
  box.append(el("h3", "", "Zaplanowane"));
  if (!S.sched.length) box.append(el("div", "empty", "Brak przypomnień i briefów."));
  for (const r of S.sched) {
    const repeat = { daily: "codziennie", weekdays: "w dni robocze", weekly: "co tydzień" }[r.repeat] || "jednorazowo";
    const row = el("div", "card row", `<div class="grid-meta"><strong>${esc(r.text)}</strong><span class="sub">${esc(when.format(new Date(r.due)))} · ${repeat}</span></div>`);
    if (!r.builtin) { const x = el("button", "x", "×"); x.dataset.unsched = r.id; x.title = "Usuń"; row.append(x); }
    box.append(row);
  }
  if (past.length) {
    box.append(el("h3", "", "Zakończone"));
    past.slice(0, 30).forEach((t) => box.append(taskCard(t)));
  }
  if (animate) stagger(box); else box.classList.remove("stagger");
}

function renderFiles() {
  const box = $("files");
  box.textContent = "";
  if (!S.files.length) { box.append(el("div", "empty", "Tu trafiają pliki, które zrobią dla Ciebie agenci: PDF, dokumenty, arkusze, prezentacje, małe strony i obrazki.")); return; }
  const tiles = el("div", "tiles");
  S.files.forEach((f) => tiles.append(fileNode(f, true)));
  box.append(tiles);
  stagger(tiles);
}

function renderMemory() {
  const box = $("memory");
  box.textContent = "";
  box.append(el("div", "empty", "To, co Valet o Tobie zapamiętał. Korzysta z tego w każdej rozmowie i przekazuje agentom, którym zleca pracę."));
  if (!S.facts.length) box.append(el("div", "card row", '<div class="grid-meta"><span class="sub">Jeszcze nic. Powiedz Valetowi, co ma zapamiętać.</span></div>'));
  for (const f of S.facts) {
    const row = el("div", "card row", `<div class="grid-meta"><strong>${esc(f.text)}</strong></div>`);
    const x = el("button", "x", "×");
    x.dataset.fact = f.id;
    x.title = "Zapomnij";
    row.append(x);
    box.append(row);
  }
  stagger(box);
}

function renderAgents() {
  const box = $("agents");
  box.textContent = "";
  for (const [key, a] of Object.entries(S.settings.agents)) {
    const b = el("button", "item");
    b.dataset.agent = key;
    b.append(mini(key), document.createTextNode(a.name), el("small", "", MODEL_NAMES[S.settings.models[MODEL_OF[key]]] || ""));
    box.append(b);
  }
  markActive();
}

function markActive() {
  let active = null;
  document.querySelectorAll("#rail .item").forEach((b) => {
    const on = S.view === "agent" ? b.dataset.agent === S.agentKey : b.dataset.view === S.view;
    b.classList.toggle("on", on);
    if (on) active = b;
  });
  const glide = $("glide");
  if (active) { glide.style.setProperty("--y", `${active.offsetTop}px`); glide.style.opacity = 1; } else glide.style.opacity = 0;
}

function setView(view, key = null) {
  const same = S.view === view && S.agentKey === key;
  const apply = () => {
    for (const v of ["chat", "tasks", "files", "memory", "agent"]) $(`view-${v}`).hidden = v !== view;
    S.view = view;
    S.agentKey = view === "agent" ? key : null;
    $("app").classList.toggle("focus", view === "agent");
    $("title").textContent = view === "agent" ? agentOf(key).name : TITLES[view];
    if (view === "tasks") renderTasks();
    if (view === "files") renderFiles();
    if (view === "memory") renderMemory();
    if (view === "agent") openAgent(key);
    if (view === "chat") { toBottom(); input.focus(); }
  };
  if (!same && document.startViewTransition && !reduce) document.startViewTransition(apply); else apply();
  S.view = view;
  S.agentKey = view === "agent" ? key : null;
  markActive();
}

function paintSpend() {
  $("spend-text").textContent = `Dziś ${money(S.spend.today)} z ${money(S.spend.limit)} USD`;
  $("spend-bar").style.setProperty("--v", Math.min(1, S.spend.today / Math.max(0.01, S.spend.limit)).toFixed(3));
}

function renderInspector() {
  const box = $("insp");
  if (!S.settings) return;
  box.textContent = "";
  const state = S.status.state || "idle", running = [...S.tasks.values()].filter((t) => t.status === "running");
  const lead = running[0] && state === "working" && !S.status.turn ? running[0].agent : "valet";
  box.append(el("h4", "", "Teraz"));
  const now = el("div", "card now-card");
  now.append(mini(lead, state), el("div", "grid-meta", `<strong>${esc(state === "idle" ? "Spokój" : S.status.text || "Pracuje")}</strong><span class="sub">${esc(state === "idle" ? "Valet czeka na wiadomość." : agentOf(lead).name)}</span>`));
  box.append(now);
  running.forEach((t) => box.append(taskCard(t)));
  const sky = [...S.byId.values()].reverse().find((m) => m.data?.sky && m.data.sky.day === new Date().toLocaleDateString("sv-SE"));
  if (sky) {
    box.append(el("h4", "", "Dziś"));
    const card = el("div", "card");
    card.append(skyNode(sky.data.sky));
    box.append(card);
  }
  if (S.sched.length) {
    box.append(el("h4", "", "Najbliższe"));
    S.sched.slice(0, 4).forEach((r) => box.append(el("div", "mini", `<strong>${esc(r.text)}</strong><span class="sub">${esc(when.format(new Date(r.due)))}</span>`)));
  }
  if (S.files.length) {
    box.append(el("h4", "", "Ostatnie pliki"));
    S.files.slice(0, 3).forEach((f) => { const row = el("div", "mini", `<strong>${esc(f.name)}</strong><span class="sub">${size(f.size)} · ${shortDay.format(new Date(f.ts))}</span>`); row.dataset.open = f.id; box.append(row); });
  }
}

function applySettings(settings) {
  S.settings = settings;
  mount(puck, settings.agents.valet.avatar);
  $("hero-name").textContent = settings.agents.valet.name;
  renderAgents();
  paintStatus();
}

async function openFile(id, from = null) {
  const f = S.files.find((x) => x.id === id);
  if (isImage(f)) return openImage(f, from?.querySelector(".ico") || null, cards).catch(() => {});
  const win = shell ? null : window.open("", "_blank");
  try {
    const { url } = await api("/api/file/link", { id });
    if (shell) native({ type: "open", url }); else if (win) win.location = url; else location.href = url;
  } catch (e) {
    if (win) win.close();
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
  dayBreak(Date.now());
  const line = el("div", "line me"), bubble = el("div", "msg me pending"), meta = el("span", "meta", esc(clock.format(new Date())));
  bubble.textContent = text;
  const copy = el("button", "", "Kopiuj");
  copy.dataset.copy = "";
  meta.append(copy);
  line.append(bubble, meta);
  thread.insertBefore(line, typingNode);
  play(bubble, [{ opacity: 0, transform: "translateY(26px) scale(.9)" }, { opacity: 1, transform: "none" }]);
  const item = { text, line };
  S.pending.push(item);
  toBottom(true);
  try {
    await api("/api/message", { text });
    setTimeout(() => { if (S.pending.includes(item)) sync(); }, 1500);
  } catch (e) {
    line.remove();
    S.pending = S.pending.filter((p) => p !== item);
    input.value = text;
    grow();
    thread.insertBefore(el("div", "sys err", "Nie udało się wysłać. Sprawdź połączenie i spróbuj jeszcze raz."), typingNode);
  }
}

function grow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(200, Math.max(35, input.scrollHeight))}px`;
  $("send").disabled = !input.value.trim();
}

async function sync() {
  const d = await api("/api/boot");
  S.files = d.files;
  S.sched = d.sched;
  S.facts = d.facts;
  S.spend = d.spend;
  S.tasks = new Map(d.tasks.map((t) => [t.id, t]));
  S.status = d.status;
  applySettings(d.settings);
  renderThread(d.msgs);
  paintCount();
  paintSpend();
  renderInspector();
  if (S.view !== "chat") setView(S.view, S.agentKey);
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
      else if (ev.t === "files") { S.files = ev.files; if (S.view === "files") renderFiles(); renderInspector(); }
      else if (ev.t === "sched") { S.sched = ev.sched; if (S.view === "tasks") renderTasks(false); renderInspector(); }
      else if (ev.t === "facts") { S.facts = ev.facts; if (S.view === "memory") renderMemory(); }
      else if (ev.t === "spend") { S.spend = ev.spend; paintSpend(); }
      else if (ev.t === "settings") { applySettings(ev.settings); if (ev.sched) S.sched = ev.sched; renderInspector(); }
    };
    ws.onclose = () => {
      clearInterval(ws._ping);
      S.ws = null;
      if (!S.token) return;
      setTimeout(() => sync().then(connect).catch(() => connect()), S.retry);
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
  $("dialog").hidden = true;
  $("pair").hidden = false;
  mount($("pair-puck"), { type: "orbita", cfg: {} });
  watch($("pair-puck"));
}

async function start() {
  try {
    await sync();
    $("pair").hidden = true;
    $("app").hidden = false;
    markActive();
    toBottom();
    connect();
    input.focus();
    native({ type: "ready" });
    const q = new URLSearchParams(location.search);
    if (TITLES[q.get("view")] && q.get("view") !== "chat") setView(q.get("view"));
    if (q.get("agent") && S.settings.agents[q.get("agent")]) setView("agent", q.get("agent"));
    if (q.get("dialog") === "settings") openSettings();
  } catch (e) {
    if (S.token) { $("pair").hidden = false; $("pair-err").textContent = "Nie mogę połączyć się z agentem. Spróbuj za chwilę."; mount($("pair-puck"), { type: "orbita", cfg: {} }); }
  }
}

function openAgent(key) {
  const a = S.settings.agents[key];
  E = { key, name: a.name, avatar: { type: a.avatar.type, cfg: { ...defaults(a.avatar.type), ...a.avatar.cfg } }, state: "idle" };
  renderAgent();
}

function renderAgent() {
  const box = $("agent"), c = E.avatar.cfg, t = TYPES[E.avatar.type], a = S.settings.agents[E.key];
  const colors = (k, label) => `<div class="f"><span>${label}</span><span class="colors"><input type="color" data-k="${k}" value="${esc(c[k])}">${SWATCHES.map((s) => `<button class="sw" style="background:${s}" data-k="${k}" data-v="${s}" title="${s}"></button>`).join("")}</span></div>`;
  let form = `<div class="f"><span>Nazwa</span><input type="text" id="e-name" maxlength="24" value="${esc(E.name)}"></div>`;
  form += `<div class="f"><span>Rodzaj</span><span class="seg">${Object.entries(TYPES).map(([k, v]) => `<button class="${k === E.avatar.type ? "on" : ""}" data-type="${k}">${v.name}</button>`).join("")}</span></div>`;
  form += colors("pk", "Krążek") + colors("ink", "Rysunek") + colors("acc", "Akcent");
  for (const p of t.params) {
    const v = c[p.k];
    if (p.kind === "select") form += `<div class="f"><span>${p.label}</span><span class="seg">${p.opts.map(([val, lab]) => `<button class="${val === v ? "on" : ""}" data-opt="${p.k}" data-v="${val}">${lab}</button>`).join("")}</span></div>`;
    if (p.kind === "range") form += `<div class="f"><span>${p.label}</span><input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}"></div>`;
    if (p.kind === "pixels") form += `<div class="f top"><span>${p.label}</span><span><span class="seg" style="margin-bottom:10px">${[[".", "gumka"], ["1", "piksel"], ["2", "oko"], ["3", "usta"], ["4", "akcent"]].map(([k, l]) => `<button class="${k === brush ? "on" : ""}" data-brush="${k}">${l}</button>`).join("")}</span><span class="pixgrid" id="pix">${v.map((row, y) => [...row].map((k, x) => `<i data-i="${y * 8 + x}" data-k="${k}"></i>`).join("")).join("")}</span></span></div>`;
  }
  form += `<div class="f"><span></span><span class="actions"><button class="btn" id="e-save">Zapisz</button><span class="note" id="e-note"></span></span></div>`;
  box.innerHTML = `<div class="agent-page"><div class="card stagebox"><div class="puck tap" id="preview"></div><h3>${esc(E.name)}</h3><div class="sub">${esc(a.role)} · ${esc(MODEL_NAMES[S.settings.models[MODEL_OF[E.key]]] || "")}</div><div class="chips">${STATES.map(([id, name]) => `<button class="chip${id === E.state ? " on" : ""}" data-state-chip="${id}">${name}</button>`).join("")}</div></div><div class="form">${form}</div></div>`;
  paintPreview();
}

function paintPreview() {
  const p = $("preview");
  if (!p) return;
  mount(p, E.avatar);
  setState(p, E.state);
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

function openDialog(html) {
  const wrap = $("dialog");
  wrap.classList.remove("out");
  $("dialog-in").innerHTML = html;
  wrap.hidden = false;
}

function closeDialog() {
  const wrap = $("dialog");
  if (wrap.hidden) return;
  wrap.classList.add("out");
  setTimeout(() => { wrap.hidden = true; wrap.classList.remove("out"); input.focus(); }, reduce ? 0 : 160);
}

function openSettings() {
  const s = S.settings;
  const select = (key, label) => `<div class="f"><span>${label}</span><select data-model="${key}">${Object.entries(MODEL_NAMES).map(([id, name]) => `<option value="${id}"${s.models[key] === id ? " selected" : ""}>${name}</option>`).join("")}</select></div>`;
  openDialog(`
    <div class="dhead"><h2>Ustawienia</h2><button class="btn ghost" data-close>Gotowe</button></div>
    <h3>Modele</h3>
    ${select("chat", "Rozmowa")}${select("text", "Tekst i briefy")}${select("docs", "Dokumenty")}
    <h3>Briefy</h3>
    <label class="switch">Poranny brief<input type="checkbox" id="b-daily"${s.briefs.daily ? " checked" : ""}></label>
    <label class="switch">Weekly Briefing w poniedziałek<input type="checkbox" id="b-weekly"${s.briefs.weekly ? " checked" : ""}></label>
    <div class="f"><span>Godzina</span><select id="b-hour">${[5, 6, 7, 8, 9, 10].map((h) => `<option value="${h}"${s.briefs.hour === h ? " selected" : ""}>${h}:00</option>`).join("")}</select></div>
    <h3>Wydatki</h3>
    <div class="note">Dziś ${money(S.spend.today)} USD, w tym miesiącu ${money(S.spend.month)} USD. Po przekroczeniu dziennego limitu rozmowa schodzi na mały model, a nowe zadania w tle czekają do jutra.</div>
    <div class="f"><span>Limit dzienny (USD)</span><input type="number" id="limit" min="0.5" max="50" step="0.5" value="${s.dailyUsd}"></div>
    <h3>Powiadomienia</h3>
    <div class="note">${shell ? "Gdy okno jest w tle, nowe wiadomości przychodzą jako powiadomienia macOS, a na ikonie w Docku pojawia się licznik." : "Powiadomienia systemowe działają w aplikacji na Maca i w apce na iPhonie."}</div>
    ${shell ? '<div class="actions"><button class="btn ghost" id="notify-test">Wyślij testowe</button></div>' : ""}
    <h3>To urządzenie</h3>
    <div class="actions"><button class="btn ghost" id="unpair">Rozłącz</button></div>`);
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  const cancel = t.closest("[data-cancel]");
  if (cancel) { cancel.disabled = true; return api("/api/task/cancel", { id: +cancel.dataset.cancel }).catch(() => {}); }
  const open = t.closest("[data-open]");
  if (open) return openFile(open.dataset.open, open);
  const copy = t.closest("[data-copy]");
  if (copy) {
    const m = S.byId.get(+copy.dataset.copy), text = m ? plain(m.text) : copy.closest(".line").querySelector(".msg").textContent;
    try { await navigator.clipboard.writeText(text); } catch (err) { native({ type: "copy", text }); }
    copy.textContent = "Skopiowano";
    setTimeout(() => { copy.textContent = "Kopiuj"; }, 1200);
    return;
  }
  const jump = t.closest("[data-jump]");
  if (jump) { const target = thread.querySelector(`[data-id="${jump.dataset.jump}"]`); if (target) { target.scrollIntoView({ behavior: reduce ? "instant" : "smooth", block: "center" }); target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash"); } return; }
  if (t.closest("#jump")) { S.missed = 0; toBottom(true); return; }
  const unsched = t.closest("[data-unsched]");
  if (unsched) { const d = await api("/api/sched/delete", { id: +unsched.dataset.unsched }); S.sched = d.sched; renderTasks(false); return renderInspector(); }
  const fact = t.closest("[data-fact]");
  if (fact) { const d = await api("/api/fact/delete", { id: +fact.dataset.fact }); S.facts = d.facts; return renderMemory(); }
  const view = t.closest("[data-view]");
  if (view) return setView(view.dataset.view);
  const agent = t.closest("[data-agent]");
  if (agent) return setView("agent", agent.dataset.agent);
  if (t.closest("#puck")) return poke(puck);
  if (t.closest("#preview")) return poke($("preview"));
  if (t.closest("#settings-btn")) return openSettings();
  if (t.closest("#insp-btn")) { const off = $("app").classList.toggle("no-insp"); return store.set("valet-insp", off ? "0" : "1"); }
  if (t.closest("[data-close]")) return closeDialog();
  const chip = t.closest("[data-state-chip]");
  if (chip) { E.state = chip.dataset.stateChip; $("agent").querySelectorAll("[data-state-chip]").forEach((c) => c.classList.toggle("on", c === chip)); return setState($("preview"), E.state); }
  const type = t.closest("[data-type]");
  if (type) { E.avatar = { type: type.dataset.type, cfg: { ...defaults(type.dataset.type), pk: E.avatar.cfg.pk, ink: E.avatar.cfg.ink, acc: E.avatar.cfg.acc } }; return renderAgent(); }
  const opt = t.closest("[data-opt]");
  if (opt) { E.avatar.cfg[opt.dataset.opt] = opt.dataset.v; opt.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === opt)); return paintPreview(); }
  const sw = t.closest(".sw");
  if (sw) { E.avatar.cfg[sw.dataset.k] = sw.dataset.v; sw.parentElement.querySelector("input").value = sw.dataset.v; return paintPreview(); }
  const b = t.closest("[data-brush]");
  if (b) { brush = b.dataset.brush; b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); return; }
  if (t.closest("#e-save")) {
    const d = await api("/api/settings", { agent: { key: E.key, name: E.name, avatar: E.avatar } });
    applySettings(d.settings);
    renderThread([...S.byId.values()]);
    renderInspector();
    $("title").textContent = d.settings.agents[E.key].name;
    $("e-note").textContent = "Zapisane.";
    return;
  }
  if (t.closest("#notify-test")) return native({ type: "notify", title: S.settings.agents.valet.name, body: "Powiadomienia działają.", force: true });
  if (t.closest("#unpair")) return unpair();
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "e-name") { E.name = t.value; return; }
  if (E && t.dataset.k && t.closest("#agent")) { E.avatar.cfg[t.dataset.k] = t.type === "range" ? +t.value : t.value; paintPreview(); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.model) { const d = await api("/api/settings", { models: { [t.dataset.model]: t.value } }); S.settings = d.settings; renderAgents(); }
  if (["b-daily", "b-weekly", "b-hour"].includes(t.id)) { const d = await api("/api/settings", { briefs: { daily: $("b-daily").checked, weekly: $("b-weekly").checked, hour: +$("b-hour").value } }); S.settings = d.settings; }
  if (t.id === "limit") { const d = await api("/api/settings", { dailyUsd: +t.value }); S.settings = d.settings; S.spend.limit = d.settings.dailyUsd; paintSpend(); }
});
document.addEventListener("pointerdown", (e) => { if (e.target.closest("#pix")) { painting = true; paint(e.target); e.preventDefault(); } });
window.addEventListener("pointermove", (e) => { if (painting) paint(document.elementFromPoint(e.clientX, e.clientY)); });
window.addEventListener("pointerup", () => { painting = false; });

$("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
input.addEventListener("input", () => {
  grow();
  if (S.status.state !== "idle") return;
  local = "listening";
  look(puck, 0.7, 0.5);
  paintStatus();
  clearTimeout(listenTimer);
  listenTimer = setTimeout(() => { if (local === "listening") { local = ""; look(puck, 0, 0); paintStatus(); } }, 1500);
});
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
scroller.addEventListener("scroll", paintJump, { passive: true });

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return closeDialog();
  if (e.metaKey && !e.shiftKey && !e.altKey) {
    const view = { 1: "chat", 2: "tasks", 3: "files", 4: "memory" }[e.key];
    if (view) { e.preventDefault(); return setView(view); }
    if (e.key === ",") { e.preventDefault(); return openSettings(); }
    if (e.key === "i") { e.preventDefault(); return $("insp-btn").click(); }
    if (e.key === "k") { e.preventDefault(); setView("chat"); return input.focus(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if (!typing && $("dialog").hidden && S.view === "chat" && e.key.length === 1 && !e.ctrlKey && !e.altKey) input.focus();
});
window.addEventListener("focus", () => { S.unread = 0; native({ type: "badge", count: 0 }); });
window.addEventListener("resize", markActive);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.token && !S.ws) sync().then(connect).catch(() => {}); });

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

if (store.get("valet-insp") === "0") $("app").classList.add("no-insp");
watch(puck);
const linked = /[#&]k=([A-Za-z0-9_-]{16,})/.exec(location.hash);
if (linked) {
  S.token = linked[1];
  store.set("valet-token", S.token);
  history.replaceState(null, "", location.pathname + location.search);
}
if (S.token) start(); else unpair();
