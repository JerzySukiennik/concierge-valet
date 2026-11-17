/* Connector cards shared by the phone and Mac apps: YouTube videos, a film or series, a shelf of posters, a generated image with its lightbox. */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const compact = new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 });
const ago = new Intl.RelativeTimeFormat("pl", { numeric: "auto" });
const score = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const TMDB = "https://image.tmdb.org/t/p/";
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4.2" fill="currentColor"/><path d="M10.2 9.3v5.4l4.7-2.7z" fill="var(--card, #fff)"/></svg>';
const FILM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M8 4.5v15M16 4.5v15M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5"/></svg>';
const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const WARSAW = "Europe/Warsaw";
const dayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: WARSAW });
const hm = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, hour: "numeric", minute: "2-digit" });
const hourParts = new Intl.DateTimeFormat("en-GB", { timeZone: WARSAW, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
const longDay = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, weekday: "long", day: "numeric", month: "long" });
const shortDate = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, day: "numeric", month: "short" });
const weekdayShort = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, weekday: "short" });
const dayNumber = new Intl.DateTimeFormat("pl-PL", { timeZone: WARSAW, day: "numeric" });
const links = new Map();

export const CARD_KINDS = ["videos", "title", "titles", "image", "agenda", "event"];

const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);

function clockOf(total) {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function since(ts) {
  const days = Math.max(0, (Date.now() - ts) / 86400000);
  if (days < 1) return "dziś";
  if (days < 30) return ago.format(-Math.round(days), "day");
  if (days < 365) return ago.format(-Math.max(1, Math.round(days / 30)), "month");
  return ago.format(-Math.max(1, Math.round(days / 365)), "year");
}

function spring(kind = "spring") {
  const css = getComputedStyle(document.documentElement);
  return { easing: css.getPropertyValue(`--ease-${kind}`).trim() || "cubic-bezier(.2, .9, .25, 1)", duration: (parseFloat(css.getPropertyValue(`--dur-${kind}`)) || 0.5) * 1000 };
}

function move(node, frames, extra = {}) {
  if (reduce || !node.animate) return null;
  try { return node.animate(frames, { ...spring(), ...extra }); } catch (e) { return node.animate(frames, { duration: 320, easing: "ease-out", ...extra }); }
}

export function fileLink(id, ctx) {
  const hit = links.get(id);
  if (hit && hit.until > Date.now()) return hit.url;
  const url = ctx.link(id);
  links.set(id, { url, until: Date.now() + 5 * 3600000 });
  url.catch(() => links.delete(id));
  return url;
}

function videos(m) {
  const card = el("div", "card kx kx-vids");
  card.append(el("div", "kx-head", `${PLAY}<span>YouTube</span><em>${esc(m.text)}</em>`));
  m.data.videos.filter((v) => /^[\w-]{6,20}$/.test(v.id)).forEach((v, i) => {
    const a = el("a", `kx-vid${i === 0 ? " kx-lead" : ""}`);
    a.href = `https://www.youtube.com/watch?v=${v.id}`;
    a.target = "_blank";
    a.rel = "noopener";
    const meta = [esc(v.channel), v.views ? `${compact.format(v.views)} wyświetleń` : "", v.published ? since(v.published) : ""].filter(Boolean).join(" · ");
    a.innerHTML = `<span class="kx-thumb"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${v.id}/${i === 0 ? "sddefault" : "mqdefault"}.jpg"><i></i><b>${v.live ? "na żywo" : clockOf(v.seconds)}</b></span><span class="kx-meta"><strong>${esc(v.title)}</strong><span class="sub">${meta}</span></span>`;
    const img = a.querySelector("img");
    if (i === 0) img.addEventListener("error", () => { img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; }, { once: true });
    card.append(a);
  });
  return card;
}

function chips(label, list) {
  return `<div class="kx-where"><span class="kx-lab">${label}</span><span class="kx-chips">${list.map((p) => `<span class="kx-svc">${p.logo ? `<img loading="lazy" alt="" src="${TMDB}w92${esc(p.logo)}">` : ""}${esc(p.name)}</span>`).join("")}</span></div>`;
}

function film(m) {
  const t = m.data.title, movie = t.type === "movie", card = el("div", "card kx kx-film");
  const years = movie ? t.year : t.year ? (t.ended ? (t.lastYear && t.lastYear !== t.year ? `${t.year}–${t.lastYear}` : t.year) : `od ${t.year}`) : "";
  const length = movie ? (t.runtime ? `${t.runtime >= 60 ? `${Math.floor(t.runtime / 60)} h ` : ""}${t.runtime % 60} min` : "") : t.seasons ? `${t.seasons} ${plural(t.seasons, "sezon", "sezony", "sezonów")}` : "";
  const sub = [years, length, (t.genres || []).join(", ")].filter(Boolean).join(" · ");
  const ring = t.rating ? `<span class="kx-score" title="Ocena w TMDB, ${compact.format(t.votes || 0)} głosów"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"/><circle class="kx-arc" cx="18" cy="18" r="15" stroke-dasharray="${((t.rating / 10) * 94.25).toFixed(1)} 94.25" transform="rotate(-90 18 18)"/></svg><b>${score.format(t.rating)}</b></span>` : "";
  const w = t.watch;
  const where = w ? (w.stream.length ? chips("W abonamencie", w.stream) : "") + (w.free.length ? chips("Za darmo", w.free) : "") + (!w.stream.length && !w.free.length && w.rent.length ? chips("Do wypożyczenia", w.rent) : "") + (!w.stream.length && !w.free.length && !w.rent.length && w.buy.length ? chips("Do kupienia", w.buy) : "") : '<div class="kx-where"><span class="sub">Nie ma jeszcze danych o streamingu w Polsce.</span></div>';
  const crew = [t.makers?.length ? `${movie ? "Reż." : "Twórcy:"} ${esc(t.makers.join(", "))}` : "", t.cast?.length ? esc(t.cast.join(", ")) : ""].filter(Boolean).join(" · ");
  const actions = [t.trailer ? `<a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${esc(t.trailer)}">Zwiastun</a>` : "", `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(w?.link || t.page)}">${w?.link ? "Gdzie obejrzeć" : "Więcej"}</a>`].join("");
  card.innerHTML = `${t.backdrop ? `<div class="kx-backdrop"><img loading="lazy" alt="" src="${TMDB}w780${esc(t.backdrop)}"></div>` : '<div class="kx-backdrop kx-none"></div>'}
    <div class="kx-in">
      <div class="kx-top">${t.poster ? `<img class="kx-poster" loading="lazy" alt="" src="${TMDB}w342${esc(t.poster)}">` : ""}<div class="kx-id"><h3>${esc(t.name)}</h3>${t.original ? `<span class="kx-orig">${esc(t.original)}</span>` : ""}<span class="sub">${esc(sub)}</span></div>${ring}</div>
      ${t.tagline ? `<p class="kx-tagline">${esc(t.tagline)}</p>` : ""}
      ${t.overview ? `<p class="kx-plot">${esc(t.overview)}</p>` : ""}
      ${crew ? `<p class="kx-crew">${crew}</p>` : ""}
      ${where}
      <div class="kx-actions">${actions}</div>
      <div class="kx-credit">Dane: TMDB. Dostępność: JustWatch.</div>
    </div>`;
  const plot = card.querySelector(".kx-plot");
  if (plot) plot.addEventListener("click", () => plot.classList.toggle("kx-open"));
  return card;
}

function shelf(m, ctx) {
  const card = el("div", "card kx kx-shelf");
  card.append(el("div", "kx-head", `${FILM}<span>${esc(m.text)}</span>`));
  const rail = el("div", "kx-rail");
  for (const t of m.data.titles) {
    const b = el("button", "kx-tile", `<span class="kx-cover"><img loading="lazy" alt="" src="${TMDB}w342${esc(t.poster)}"></span><strong>${esc(t.name)}</strong><span class="sub">${[t.year, t.rating ? score.format(t.rating) : ""].filter(Boolean).join(" · ")}</span>`);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (b.classList.contains("kx-busy")) return;
      b.classList.add("kx-busy");
      try { await ctx.post("/api/title", { type: t.type, id: t.id }); } catch (e) { b.classList.add("kx-fail"); }
      setTimeout(() => b.classList.remove("kx-busy"), 600);
    });
    rail.append(b);
  }
  card.append(rail);
  return card;
}

export function lightbox(url, { from = null, caption = "", ratio = 0, ctx = null } = {}) {
  const wrap = el("div", "kx-light"), img = el("img"), bar = el("div", "kx-light-bar");
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-label", caption || "Obrazek");
  img.alt = caption;
  img.src = url;
  if (ratio) img.style.setProperty("--ar", ratio);
  const open = el("button", "", "Otwórz"), close = el("button", "", "Zamknij");
  bar.append(el("span", "", esc(caption)), open, close);
  wrap.append(img, bar);
  document.body.append(wrap);
  const rect = () => from?.isConnected ? from.getBoundingClientRect() : null;
  const frames = () => {
    const a = rect(), b = img.getBoundingClientRect();
    if (!a || !b.width) return [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }];
    return [{ transformOrigin: "0 0", borderRadius: "16px", transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transformOrigin: "0 0", borderRadius: "10px", transform: "none" }];
  };
  const enter = () => { move(img, frames()); if (from) from.style.visibility = "hidden"; };
  if (ratio) enter(); else img.decode().then(() => { img.style.setProperty("--ar", img.naturalWidth / img.naturalHeight); enter(); }).catch(() => {});
  let gone = false;
  const shut = () => {
    if (gone) return;
    gone = true;
    window.removeEventListener("keydown", key, true);
    wrap.classList.add("out");
    const back = move(img, frames().reverse(), { duration: 300, easing: "cubic-bezier(.3, .7, .2, 1)", fill: "forwards" });
    const done = () => { if (from) from.style.visibility = ""; wrap.remove(); };
    if (back) back.onfinish = done; else done();
  };
  const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); } };
  window.addEventListener("keydown", key, true);
  open.addEventListener("click", (e) => { e.stopPropagation(); ctx?.open(url); });
  wrap.addEventListener("click", shut);
  return shut;
}

export async function openImage(file, from, ctx) {
  const url = await fileLink(file.id, ctx);
  lightbox(url, { from, caption: String(file.name || "").replace(/\.\w+$/, ""), ratio: file.w && file.h ? file.w / file.h : 0, ctx });
}

export function thumb(file, ctx) {
  const img = el("img");
  img.alt = "";
  img.loading = "lazy";
  fileLink(file.id, ctx).then((url) => { img.src = url; }).catch(() => {});
  return img;
}

function picture(m, ctx) {
  const f = m.data.image, box = el("div", "kx kx-shot");
  box.style.setProperty("--ar", f.w && f.h ? f.w / f.h : 16 / 9);
  const frame = el("button", "kx-frame");
  frame.type = "button";
  frame.setAttribute("aria-label", `Powiększ: ${m.text}`);
  const img = thumb(f, ctx);
  img.addEventListener("load", () => frame.classList.add("kx-ready"), { once: true });
  frame.append(img);
  frame.addEventListener("click", () => openImage(f, frame, ctx));
  box.append(frame, el("div", "kx-cap", esc(m.text)));
  return box;
}

const noon = (key) => Date.parse(`${key}T12:00:00Z`);
const lastMoment = (e) => (e.end > e.start ? e.end - 1 : e.start);
const hourOf = (ts) => { const [h, m] = hourParts.format(ts).split(":"); return +h + +m / 60; };
const tint = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "var(--accent)");

function dayTitle(key) {
  const today = dayKey.format(Date.now()), tomorrow = dayKey.format(Date.now() + 86400000);
  const name = longDay.format(noon(key));
  return key === today ? ["Dziś", name] : key === tomorrow ? ["Jutro", name] : [name.charAt(0).toUpperCase() + name.slice(1), ""];
}

export function agendaNode(agenda, { ribbon = true, empty = true, heads = (agenda.days || 1) > 1 } = {}) {
  const box = el("div", "kx-agenda"), now = Date.now(), today = dayKey.format(now);
  const days = Math.max(1, agenda.days || 1), FROM = 6, HOURS = 17;
  for (let i = 0; i < days; i++) {
    const key = new Date(noon(agenda.from) + i * 86400000).toISOString().slice(0, 10);
    const list = agenda.events.filter((e) => dayKey.format(e.start) <= key && dayKey.format(lastMoment(e)) >= key);
    if (!list.length && (!empty || days > 7)) continue;
    const day = el("div", "kx-day"), [lead, rest] = dayTitle(key);
    if (heads) day.append(el("div", "kx-dayhead", `<strong>${esc(lead)}</strong>${rest ? `<span>${esc(rest)}</span>` : ""}`));
    const whole = list.filter((e) => e.allDay), timed = list.filter((e) => !e.allDay);
    if (ribbon && days <= 3 && timed.length) {
      const band = el("div", "kx-ribbon");
      for (const e of timed) {
        const a = dayKey.format(e.start) < key ? 0 : hourOf(e.start), b = dayKey.format(lastMoment(e)) > key ? 24 : hourOf(e.end);
        const left = Math.max(0, Math.min(100, ((a - FROM) / HOURS) * 100)), right = Math.max(0, Math.min(100, ((b - FROM) / HOURS) * 100));
        band.insertAdjacentHTML("beforeend", `<i style="left:${left.toFixed(1)}%;width:${Math.max(1.6, right - left).toFixed(1)}%;--c:${tint(e.color)}"></i>`);
      }
      const h = hourOf(now);
      if (key === today && h >= FROM && h <= FROM + HOURS) band.insertAdjacentHTML("beforeend", `<b style="left:${(((h - FROM) / HOURS) * 100).toFixed(1)}%"></b>`);
      day.append(band, el("div", "kx-ticks", [6, 9, 12, 15, 18, 21].map((t) => `<span style="left:${(((t - FROM) / HOURS) * 100).toFixed(1)}%">${t}</span>`).join("")));
    }
    if (whole.length) day.append(el("div", "kx-whole", whole.map((e) => `<span style="--c:${tint(e.color)}">${esc(e.title)}</span>`).join("")));
    for (const e of timed) {
      const starts = dayKey.format(e.start) === key, ends = dayKey.format(lastMoment(e)) === key;
      const state = e.end <= now ? " kx-past" : e.start <= now ? " kx-live" : "";
      const sub = [e.location, e.cal].filter(Boolean).map(esc).join(" · ");
      day.append(el("div", `kx-ev${state}`, `<span class="kx-when"><b>${starts ? hm.format(e.start) : "trwa"}</b><i>${ends ? hm.format(e.end) : ""}</i></span><i class="kx-bar" style="--c:${tint(e.color)}"></i><span class="kx-what"><strong>${esc(e.title)}</strong>${sub ? `<span class="sub">${sub}</span>` : ""}</span>${state === " kx-live" ? '<em class="kx-nowtag">teraz</em>' : ""}`));
    }
    if (!list.length) day.append(el("div", "kx-free", "Nic w kalendarzu"));
    box.append(day);
  }
  if (!box.children.length) box.append(el("div", "kx-free", "Nic w kalendarzu"));
  return box;
}

function agenda(m) {
  const a = m.data.agenda, card = el("div", "card kx kx-cal");
  const last = new Date(noon(a.from) + (a.days - 1) * 86400000).toISOString().slice(0, 10);
  const label = a.days === 1 ? dayTitle(a.from)[0].toLowerCase() : `${shortDate.format(noon(a.from))} do ${shortDate.format(noon(last))}`;
  card.append(el("div", "kx-head", `${CAL}<span>Kalendarz</span><em>${esc(label)}</em>`));
  card.append(agendaNode(a, { empty: a.days <= 7 }));
  return card;
}

function eventSpan(e) {
  const first = dayKey.format(e.start), last = dayKey.format(lastMoment(e));
  const name = (ts) => longDay.format(ts);
  if (e.allDay) return first === last ? `${name(e.start)} · cały dzień` : `${shortDate.format(e.start)} do ${shortDate.format(lastMoment(e))} · całe dni`;
  return first === last ? `${name(e.start)} · ${hm.format(e.start)}–${hm.format(e.end)}` : `${shortDate.format(e.start)} ${hm.format(e.start)} do ${shortDate.format(e.end)} ${hm.format(e.end)}`;
}

function eventCard(m, ctx) {
  const e = m.data.event, card = el("div", "card kx kx-event");
  const gone = e.done === "undone" || e.done === "deleted";
  if (gone) card.classList.add("kx-gone");
  const sub = [e.location, e.cal].filter(Boolean).map(esc).join(" · ");
  card.innerHTML = `<div class="kx-evrow"><span class="kx-date" style="--c:${tint(e.color)}"><i>${esc(weekdayShort.format(e.start).replace(".", ""))}</i><b>${dayNumber.format(e.start)}</b></span><span class="kx-what"><strong>${esc(e.title)}</strong><span class="sub">${esc(eventSpan(e))}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</span></div>`;
  const state = { undone: "Cofnięte, wydarzenia nie ma w kalendarzu", deleted: "Usunięte z kalendarza", kept: "Zostaje w kalendarzu" }[e.done] || { added: "Dodane do kalendarza", changed: "Zmienione w kalendarzu", ask_delete: "Usunąć z kalendarza?" }[e.op] || "";
  const foot = el("div", "kx-evfoot", `<span class="kx-state">${state}</span>`);
  const button = (label, act, ghost) => {
    const b = el("button", `btn${ghost ? " ghost" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (card.classList.contains("kx-busy")) return;
      card.classList.add("kx-busy");
      try {
        const d = await ctx.post("/api/calendar/act", { msg: m.id, act });
        const fresh = eventCard({ ...m, data: { ...m.data, event: d.event || e } }, ctx);
        if (card.dataset.id) fresh.dataset.id = card.dataset.id;
        card.replaceWith(fresh);
      } catch (err) {
        card.classList.remove("kx-busy");
        foot.querySelector(".kx-state").textContent = "Nie udało się, spróbuj jeszcze raz";
      }
    });
    foot.append(b);
  };
  if (!e.done && e.op === "added") button("Cofnij", "undo", true);
  if (!e.done && e.op === "ask_delete") { button("Zostaw", "keep", true); button("Usuń", "delete", false); }
  card.append(foot);
  return card;
}

export function card(m, ctx) {
  try {
    if (m.kind === "agenda" && m.data?.agenda) return agenda(m);
    if (m.kind === "event" && m.data?.event) return eventCard(m, ctx);
    if (m.kind === "videos" && m.data?.videos?.length) return videos(m);
    if (m.kind === "title" && m.data?.title) return film(m);
    if (m.kind === "titles" && m.data?.titles?.length) return shelf(m, ctx);
    if (m.kind === "image" && m.data?.image) return picture(m, ctx);
  } catch (e) {
    console.error("card", e);
  }
  return null;
}
