/* Avatar engine: three reactive avatar kinds (orbita, buzka, piksel) drawn as SVG and driven by data-state plus pointer variables. */
export const PIXELS = ["..1111..", ".114411.", "11111111", ".22..22.", ".22..22.", "........", ".3....3.", "..3333.."];
export const SWATCHES = ["#ffffff", "#f8f6f1", "#ece8df", "#1d1c19", "#1f5a46", "#6fd3b0", "#e9c46a", "#b8821c", "#d9822b", "#2440d8", "#10261f"];

const svg = (inner) => `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;

export const TYPES = {
  orbita: {
    name: "Orbita",
    params: [
      { k: "sats", label: "Satelity", kind: "range", min: 0, max: 3, step: 1, def: 1 },
      { k: "tilt", label: "Nachylenie", kind: "range", min: -50, max: 50, step: 2, def: -24 },
    ],
    draw: (c) => {
      const n = +c.sats;
      let sats = "";
      for (let i = 0; i < n; i++) sats += `<g class="spin c" style="--dl:calc(var(--spd, 3.6s) * ${(-i / n).toFixed(3)})"><ellipse class="sat" cx="50" cy="16" rx="4" ry="10.5"/></g>`;
      return svg(`<g class="f tiltg c"><path class="ring" d="M16 50 A34 13 0 0 1 84 50"/></g><g class="f planetp"><circle class="planet vox" cx="50" cy="50" r="12"/></g><g class="f tiltg c"><path class="ring" d="M16 50 A34 13 0 0 0 84 50"/><g class="squash c">${sats}</g></g>`);
    },
  },
  buzka: {
    name: "Buźka",
    params: [
      { k: "eye", label: "Oczy", kind: "select", opts: [["pill", "pigułki"], ["round", "okrągłe"], ["square", "kwadratowe"]], def: "pill" },
      { k: "gap", label: "Rozstaw", kind: "range", min: 9, max: 24, step: 1, def: 13 },
      { k: "mouth", label: "Usta", kind: "select", opts: [["none", "brak"], ["line", "kreska"], ["smile", "uśmiech"], ["o", "kółko"]], def: "none" },
    ],
    draw: (c) => {
      const big = c.eye === "round" || c.eye === "square";
      const w = big ? 12 : 9, h = big ? 12 : 18, rx = c.eye === "square" ? 2.5 : 6, g = +c.gap;
      const mouth = c.mouth === "smile" ? '<path class="mouth vox" d="M39 66 Q50 76 61 66"/>' : c.mouth === "line" ? '<path class="mouth vox" d="M42 68 H58"/>' : c.mouth === "o" ? '<ellipse class="mouth o vox" cx="50" cy="68" rx="5" ry="4.5"/>' : "";
      const ey = mouth ? 43 : 50;
      return svg(`<g class="f facep"><g class="face"><g class="eyes${mouth ? "" : " vox"}"><rect class="eye l" x="${50 - g - w / 2}" y="${ey - h / 2}" width="${w}" height="${h}" rx="${rx}"/><rect class="eye r" x="${50 + g - w / 2}" y="${ey - h / 2}" width="${w}" height="${h}" rx="${rx}"/></g>${mouth}</g></g>`);
    },
  },
  piksel: {
    name: "Piksel",
    params: [{ k: "px", label: "Piksele", kind: "pixels", def: PIXELS }],
    draw: (c) => {
      const px = Array.isArray(c.px) && c.px.length === 8 ? c.px : PIXELS, cell = 8, o = 18;
      let body = "", eyes = "", mouth = "", prog = "";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const k = px[y][x];
        if (!"1234".includes(k)) continue;
        const r = `<rect class="k${k}" x="${o + x * cell}" y="${o + y * cell}" width="${cell + 0.3}" height="${cell + 0.3}"/>`;
        if (k === "2") eyes += r; else if (k === "3") mouth += r; else body += r;
      }
      for (let i = 0; i < 6; i++) prog += `<rect x="${26 + i * 8.4}" y="87" width="5" height="5" style="--d:${(i * 0.18).toFixed(2)}s"/>`;
      return svg(`<g class="spr">${body}<g class="eyes">${eyes}</g><g class="mouth vox">${mouth}</g></g><g class="prog">${prog}</g>`);
    },
  },
};

export function defaults(type) {
  return Object.fromEntries([["pk", "#ffffff"], ["ink", "#1d1c19"], ["acc", "#1f5a46"], ...TYPES[type].params.map((p) => [p.k, p.def])]);
}

export function mount(puck, avatar) {
  const type = TYPES[avatar?.type] ? avatar.type : "orbita";
  const c = { ...defaults(type), ...(avatar?.cfg || {}) };
  puck.classList.add("puck");
  puck.style.setProperty("--pk", c.pk);
  puck.style.setProperty("--ink", c.ink);
  puck.style.setProperty("--acc", c.acc);
  if (type === "orbita") puck.style.setProperty("--tilt", `${c.tilt}deg`); else puck.style.removeProperty("--tilt");
  puck.innerHTML = `<div class="av av-${type}">${TYPES[type].draw(c)}</div>`;
  if (!puck.dataset.state) puck.dataset.state = "idle";
}

const watched = new Set();
let px = null, py = null, raf = 0, rest = 0;

function apply() {
  raf = 0;
  for (const p of watched) {
    if (!p.isConnected) { watched.delete(p); continue; }
    let lx = 0, ly = 0;
    if (px !== null) {
      const r = p.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), dist = Math.hypot(dx, dy) || 1, k = Math.min(1, dist / 150);
      lx = (dx / dist) * k;
      ly = (dy / dist) * k;
    }
    p.style.setProperty("--lx", lx.toFixed(3));
    p.style.setProperty("--ly", ly.toFixed(3));
    p.style.setProperty("--sx", Math.round(lx));
    p.style.setProperty("--sy", Math.round(ly));
  }
}

function point(e) {
  px = e.clientX;
  py = e.clientY;
  if (!raf) raf = requestAnimationFrame(apply);
  clearTimeout(rest);
  rest = setTimeout(() => { px = py = null; if (!raf) raf = requestAnimationFrame(apply); }, 3500);
}

export function watch(puck) {
  if (!watched.size) {
    window.addEventListener("pointermove", point, { passive: true });
    window.addEventListener("pointerdown", point, { passive: true });
  }
  watched.add(puck);
}

export function look(puck, lx, ly) {
  puck.style.setProperty("--lx", lx);
  puck.style.setProperty("--ly", ly);
  puck.style.setProperty("--sy", Math.round(ly));
}

export function poke(puck) {
  puck.classList.remove("poke");
  void puck.offsetWidth;
  puck.classList.add("poke");
  clearTimeout(puck._poke);
  puck._poke = setTimeout(() => puck.classList.remove("poke"), 1200);
}
