/* Bottom sheet with push navigation: spring open and close, drag to dismiss with release velocity, rubber band, edge swipe back. */
import { Spring, Velocity, project, rubberband, RM, anim } from "./motion.js";

const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';

export function makePage({ title = "", back = "", action = null, big = "", fade = false, cls = "" } = {}) {
  const el = document.createElement("div");
  el.className = `page ${cls}`.trim();
  const nav = document.createElement("header");
  nav.className = `nav${big || fade ? "" : " titled"}`;
  const left = back ? `<button class="back" data-back aria-label="Wstecz">${CHEV}<span></span></button>` : "<span></span>";
  nav.innerHTML = `${left}<h1></h1><span class="right"></span>`;
  if (back) nav.querySelector(".back span").textContent = back;
  nav.querySelector("h1").textContent = title;
  const right = nav.querySelector(".right");
  if (action) right.append(action);
  else { const done = document.createElement("button"); done.className = "act"; done.dataset.close = ""; done.textContent = "Gotowe"; right.append(done); }
  const body = document.createElement("div");
  body.className = "page-body";
  if (big) { const h = document.createElement("h2"); h.className = "big"; h.textContent = big; body.append(h); }
  const shade = document.createElement("i");
  shade.className = "shade";
  el.append(nav, body, shade);
  if (big || fade) {
    let raf = 0;
    const at = big ? 34 : 120;
    body.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; nav.classList.toggle("titled", body.scrollTop > at); nav.classList.toggle("edge", body.scrollTop > 2); });
    }, { passive: true });
  } else {
    body.addEventListener("scroll", () => nav.classList.toggle("edge", body.scrollTop > 2), { passive: true });
  }
  return { el, nav, body, title };
}

export function createSheet({ sheet, pages, scrim, app, onClose }) {
  const stack = [];
  let H = 1, W = 1, isOpen = false, closing = false, nav = null, g = null;
  const lift = () => {
    const top = parseFloat(getComputedStyle(sheet).top) || 0;
    return Math.max(0, top - 10);
  };
  let appLift = 0;

  const render = (y) => {
    sheet.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    const p = Math.max(0, Math.min(1, 1 - y / H));
    scrim.style.opacity = p.toFixed(3);
    app.style.transform = p > 0.002 ? `translate3d(0, ${(p * appLift).toFixed(2)}px, 0) scale(${(1 - 0.075 * p).toFixed(4)})` : "";
    document.body.classList.toggle("behind", p > 0.002);
  };
  const ys = new Spring(0, render, (y) => { if (closing && y >= H - 0.5) finish(); });

  const navRender = (x) => {
    if (!nav) return;
    const k = Math.max(0, Math.min(1, x / W));
    nav.top.el.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    nav.under.el.style.transform = `translate3d(${(-(1 - k) * W * 0.3).toFixed(2)}px, 0, 0)`;
    nav.under.el.querySelector(".shade").style.opacity = ((1 - k) * 0.1).toFixed(3);
  };
  const navRest = (x) => {
    if (!nav) return;
    const { top, under } = nav;
    nav = null;
    if (x >= W - 0.5) {
      top.el.remove();
      const i = stack.indexOf(top);
      if (i >= 0) stack.splice(i, 1);
      under.el.style.transform = "";
      under.el.querySelector(".shade").style.opacity = 0;
      under.onShow?.();
    } else {
      top.el.style.transform = "";
      under.el.classList.add("covered");
    }
  };
  const xs = new Spring(0, navRender, navRest);
  const settleNav = () => { if (nav) { xs.stop(); navRender(xs.t); navRest(xs.t); } };

  function measure() {
    H = sheet.offsetHeight || innerHeight;
    W = pages.offsetWidth || innerWidth;
    appLift = lift();
  }

  function finish() {
    isOpen = false;
    closing = false;
    settleNav();
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.style.opacity = "";
    scrim.style.opacity = 0;
    app.style.transform = "";
    document.body.classList.remove("behind", "sheet-open");
    app.removeAttribute("inert");
    pages.textContent = "";
    stack.length = 0;
    onClose?.();
  }

  function show(page) {
    settleNav();
    pages.textContent = "";
    stack.length = 0;
    stack.push(page);
    pages.append(page.el);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if (!isOpen) {
      isOpen = true;
      sheet.hidden = false;
      scrim.hidden = false;
      document.body.classList.add("sheet-open");
      app.setAttribute("inert", "");
      measure();
      ys.set(H);
    }
    closing = false;
    measure();
    if (RM.matches) { ys.set(0); anim(sheet, [{ opacity: 0 }, { opacity: 1 }]); return; }
    ys.to(0, { damping: 1, response: 0.44 });
  }

  function close(velocity = 0) {
    if (!isOpen) return;
    closing = true;
    if (RM.matches) {
      const a = anim(sheet, [{ opacity: 1 }, { opacity: 0 }], { fill: "forwards" });
      anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { fill: "forwards" });
      if (a) a.onfinish = () => { a.cancel(); finish(); }; else finish();
      return;
    }
    ys.to(H, { velocity, damping: 1, response: 0.36 });
  }

  function push(page, { instant = false } = {}) {
    settleNav();
    const under = stack[stack.length - 1];
    stack.push(page);
    pages.append(page.el);
    measure();
    nav = { top: page, under };
    if (instant || RM.matches) {
      xs.set(0);
      if (RM.matches && !instant) anim(page.el, [{ opacity: 0 }, { opacity: 1 }]);
      navRest(0);
      return;
    }
    xs.set(W);
    xs.to(0, { damping: 1, response: 0.42 });
  }

  function pop(velocity = 0) {
    if (stack.length < 2) return;
    const top = stack[stack.length - 1], under = stack[stack.length - 2];
    if (!nav || nav.top !== top) {
      settleNav();
      nav = { top, under };
      xs.set(0);
    }
    under.el.classList.remove("covered");
    measure();
    if (RM.matches) {
      const a = anim(top.el, [{ opacity: 1 }, { opacity: 0 }], { fill: "forwards" });
      xs.set(W);
      navRender(W);
      if (a) { top.el.style.transform = ""; a.onfinish = () => navRest(W); } else navRest(W);
      return;
    }
    xs.to(W, { velocity, damping: 1, response: 0.38 });
  }

  function begin(x, y, target, edgeOk) {
    const flying = isOpen && ys.active;
    if (flying) ys.stop();
    const rect = sheet.getBoundingClientRect();
    g = {
      x0: x, y0: y, y: ys.x, mode: null, flying, vel: new Velocity(),
      scroller: target.closest(".page-body"),
      edge: edgeOk && stack.length > 1 && x - rect.left < 26,
      lock: !!target.closest('input[type="range"], .pixgrid, textarea, input[type="text"]:focus'),
    };
    if (flying) closing = false;
  }

  function move(x, y, ev) {
    if (!g) return;
    const dx = x - g.x0, dy = y - g.y0;
    if (!g.mode) {
      if (!dx && !dy) return;
      const vertical = Math.abs(dy) >= Math.abs(dx);
      const sc = g.scroller, atTop = !sc || sc.scrollTop <= 0, fits = !sc || sc.scrollHeight <= sc.clientHeight + 1;
      if (g.flying) g.mode = "sheet";
      else if (g.lock) g.mode = "native";
      else if (g.edge && dx > 0 && !vertical) g.mode = "back";
      else if (vertical && (dy > 0 ? atTop : fits)) g.mode = "sheet";
      else g.mode = "native";
      if (g.mode === "back") {
        settleNav();
        const top = stack[stack.length - 1], under = stack[stack.length - 2];
        under.el.classList.remove("covered");
        nav = { top, under };
        xs.set(0);
      }
    }
    if (g.mode === "sheet") {
      ev?.cancelable && ev.preventDefault();
      let ny = g.y + dy;
      if (ny < 0) ny = -rubberband(-ny, H);
      ys.set(ny);
      g.vel.add(ny);
    } else if (g.mode === "back") {
      ev?.cancelable && ev.preventDefault();
      const nx = Math.max(0, dx);
      xs.set(nx);
      g.vel.add(nx);
    }
  }

  function end() {
    if (!g) return;
    const { mode, flying, vel } = g;
    g = null;
    if (mode === "sheet" || (flying && !mode)) {
      const v = vel.get(), y = ys.x, landing = y + project(v);
      if ((landing > H * 0.42 && v > -250) || v > 1100) close(v);
      else { closing = false; ys.to(0, { velocity: v, damping: Math.abs(v) > 300 ? 0.82 : 1, response: 0.4 }); }
    } else if (mode === "back") {
      const v = vel.get(), x = xs.x;
      if (x + project(v) > W * 0.5 && v > -200) xs.to(W, { velocity: v, damping: 1, response: 0.34 });
      else xs.to(0, { velocity: v, damping: 1, response: 0.36 });
    }
  }

  sheet.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { g = null; return; }
    begin(e.touches[0].clientX, e.touches[0].clientY, e.target, true);
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
  sheet.addEventListener("touchend", end, { passive: true });
  sheet.addEventListener("touchcancel", end, { passive: true });

  sheet.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !e.target.closest(".grab, .nav")) return;
    if (e.target.closest("button")) return;
    begin(e.clientX, e.clientY, e.target, false);
    const mv = (ev) => move(ev.clientX, ev.clientY, ev);
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); end(); };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });

  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen) close(); });
  window.addEventListener("resize", () => { if (isOpen && !ys.active && !g) { measure(); if (!closing) ys.set(0); } });

  return {
    show, close, push, pop,
    get open() { return isOpen && !closing; },
    get stack() { return stack; },
    top: () => stack[stack.length - 1],
    finish: () => { if (isOpen) { ys.stop(); finish(); } },
  };
}
