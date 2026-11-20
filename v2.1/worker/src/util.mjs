/* Shared helpers: pricing, Warsaw time, encoding, signed links. */
export const TZ = "Europe/Warsaw";
export const HAIKU = "claude-haiku-5-5";
export const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-opus-5-5": [4, 20, 0.2],
};

export function cost(u, model) {
  if (!u) return 0;
  const [input, output, read] = PRICES[model] || PRICES["claude-opus-5-5"];
  const hour = u.cache_creation?.ephemeral_1h_input_tokens || 0, short = Math.max(0, (u.cache_creation_input_tokens || 0) - hour);
  const tokens = ((u.input_tokens || 0) * input + (u.output_tokens || 0) * output + (u.cache_read_input_tokens || 0) * read + short * input * 1.25 + hour * input * 2) / 1e6;
  return tokens + (u.server_tool_use?.web_search_requests || 0) * 0.01;
}

const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");

export function local(ts = Date.now()) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: WEEK.indexOf(p.weekday) };
}

export function fromLocal(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const l = local(guess);
  return guess - (Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi) - guess);
}

const zones = new Map();
function wall(ts, tz) {
  let f = zones.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); zones.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}

export function fromZone(y, mo, d, h, mi, tz = TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  try {
    const first = guess - (wall(guess, tz) - guess);
    return guess - (wall(first, tz) - first);
  } catch (e) {
    return fromLocal(y, mo, d, h, mi);
  }
}

export function parseLocal(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(text || ""));
  return m ? fromLocal(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

export function dayKey(ts = Date.now()) {
  const l = local(ts);
  return `${l.y}-${pad(l.mo)}-${pad(l.d)}`;
}

export const hm = (ts) => { const l = local(ts); return `${l.h}:${pad(l.mi)}`; };
export const human = (ts = Date.now()) => new Intl.DateTimeFormat("pl-PL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ts));
export const isoLocal = (ts) => { const l = local(ts); return `${l.y}-${pad(l.mo)}-${pad(l.d)}T${pad(l.h)}:${pad(l.mi)}`; };

export function nextAt(h, mi, after = Date.now(), ok = () => true) {
  for (let i = 0; i < 9; i++) {
    const l = local(after + i * 86400000);
    const t = fromLocal(l.y, l.mo, l.d, h, mi);
    if (t > after && ok(local(t))) return t;
  }
  return after + 86400000;
}

export function nextRepeat(due, repeat, now = Date.now()) {
  const l = local(due);
  if (repeat === "daily") return nextAt(l.h, l.mi, Math.max(due, now));
  if (repeat === "weekdays") return nextAt(l.h, l.mi, Math.max(due, now), (x) => x.wd < 5);
  if (repeat === "weekly") return nextAt(l.h, l.mi, Math.max(due, now), (x) => x.wd === l.wd);
  return null;
}

const te = new TextEncoder();
export const enc = (s) => te.encode(s);
export function b64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(text) {
  const s = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

export async function sign(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc(data))));
}

export function same(a, b) {
  a = String(a || "");
  b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
