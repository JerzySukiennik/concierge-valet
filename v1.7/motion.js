/* Motion kit for the phone app: re-targetable springs, velocity tracking, Web Animations on the shared spring tokens, press feedback. */
export const RM = matchMedia("(prefers-reduced-motion: reduce)");

let tokens = null;
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const valid = (e) => { try { document.documentElement.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, easing: e }).cancel(); return true; } catch (err) { return false; } };
  const ease = (name, fb) => { const v = cs.getPropertyValue(name).trim(); return v && valid(v) ? v : fb; };
  const dur = (name, fb) => { const v = cs.getPropertyValue(name).trim(); if (!v) return fb; return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000; };
  tokens = {
    spring: ease("--ease-spring", "cubic-bezier(.2,.85,.25,1)"),
    bounce: ease("--ease-bounce", "cubic-bezier(.3,1.25,.5,1)"),
    pop: ease("--ease-pop", "cubic-bezier(.3,1.6,.5,1)"),
    out: "cubic-bezier(.165,.84,.44,1)",
    in: "cubic-bezier(.55,.06,.68,.19)",
    dur: { spring: dur("--dur-spring", 550), bounce: dur("--dur-bounce", 570), pop: dur("--dur-pop", 800), out: 220, in: 160 },
  };
}
const T = () => tokens || (readTokens(), tokens);

export function anim(el, frames, { dur, ease = "spring", delay = 0, fill = "backwards" } = {}) {
  if (!el || !el.animate) return null;
  const t = T();
  if (RM.matches) {
    const f = frames.map((k) => { const o = {}; if ("opacity" in k) o.opacity = k.opacity; if ("offset" in k) o.offset = k.offset; return o; });
    if (!f.some((k) => "opacity" in k)) return null;
    return el.animate(f, { duration: 180, delay: Math.min(delay, 60), easing: "ease", fill });
  }
  return el.animate(frames, { duration: dur ?? t.dur[ease] ?? 300, delay, easing: t[ease] || ease, fill });
}

export function stagger(nodes, { from = 0, step = 34, max = 10, y = 12 } = {}) {
  [...nodes].slice(0, max).forEach((n, i) => anim(n, [{ opacity: 0, transform: `translate3d(0, ${y}px, 0)` }, { opacity: 1, transform: "none" }], { delay: from + i * step }));
}

export function crossText(node, text) {
  if (node._text === text || (!node._text && node.textContent === text)) return;
  node._text = text;
  if (RM.matches || !node.animate) { node.textContent = text; return; }
  const out = node.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translate3d(0, -4px, 0)" }], { duration: 120, easing: "ease-in", fill: "forwards" });
  out.onfinish = () => {
    if (node._text !== text) return;
    node.textContent = text;
    out.cancel();
    anim(node, [{ opacity: 0, transform: "translate3d(0, 5px, 0)" }, { opacity: 1, transform: "none" }], { dur: 380 });
  };
}

export class Spring {
  constructor(x, onUpdate, onRest) {
    this.x = this.t = x;
    this.v = 0;
    this.raf = 0;
    this.on = onUpdate;
    this.rest = onRest;
    this.tick = this.tick.bind(this);
    this.params(1, 0.4);
  }
  params(damping, response) {
    const w = (2 * Math.PI) / response;
    this.k = w * w;
    this.c = 2 * damping * w;
  }
  get active() { return this.raf !== 0; }
  set(x) {
    this.stop();
    this.x = this.t = x;
    this.v = 0;
    this.on(x);
  }
  to(t, { velocity, damping = 1, response = 0.4 } = {}) {
    this.t = t;
    if (velocity !== undefined) this.v = velocity;
    this.params(damping, response);
    if (RM.matches) { this.set(t); this.rest?.(t); return; }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  tick(now) {
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    while (dt > 0) {
      const s = Math.min(1 / 240, dt);
      this.v += (-this.k * (this.x - this.t) - this.c * this.v) * s;
      this.x += this.v * s;
      dt -= s;
    }
    if (Math.abs(this.x - this.t) < 0.5 && Math.abs(this.v) < 12) {
      this.x = this.t;
      this.v = 0;
      this.raf = 0;
      this.on(this.x);
      this.rest?.(this.x);
      return;
    }
    this.on(this.x);
    this.raf = requestAnimationFrame(this.tick);
  }
}

export class Velocity {
  constructor() { this.s = []; }
  reset() { this.s = []; }
  add(v) {
    const t = performance.now();
    this.s.push([v, t]);
    while (this.s.length > 2 && t - this.s[0][1] > 90) this.s.shift();
  }
  get() {
    if (this.s.length < 2) return 0;
    const [a, ta] = this.s[0], [b, tb] = this.s[this.s.length - 1];
    if (performance.now() - tb > 80 || tb <= ta) return 0;
    return (b - a) / ((tb - ta) / 1000);
  }
}

export const project = (v, d = 0.998) => ((v / 1000) * d) / (1 - d);
export const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

export function pressFeedback(selector) {
  let cur = null, timer = 0, sx = 0, sy = 0, armed = false;
  const lift = () => { clearTimeout(timer); if (cur) cur.classList.remove("down"); cur = null; };
  document.addEventListener("pointerdown", (e) => {
    lift();
    const t = e.target.closest(selector);
    if (!t || t.disabled || t.closest("[data-nopress]")) return;
    cur = t;
    sx = e.clientX;
    sy = e.clientY;
    armed = false;
    if (e.pointerType === "touch" && t.closest(".view, .page-body, .hscroll")) timer = setTimeout(() => { if (cur === t) { t.classList.add("down"); armed = true; } }, 70);
    else { t.classList.add("down"); armed = true; }
  }, { passive: true });
  document.addEventListener("pointermove", (e) => { if (cur && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) lift(); }, { passive: true });
  document.addEventListener("pointerup", () => {
    if (cur && !armed) { const t = cur; clearTimeout(timer); t.classList.add("down"); cur = null; setTimeout(() => t.classList.remove("down"), 90); return; }
    lift();
  }, { passive: true });
  document.addEventListener("pointercancel", lift, { passive: true });
  window.addEventListener("blur", lift);
}
