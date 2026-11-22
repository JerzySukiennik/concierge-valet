/* Read-only look into the owner's thread with Valet, for diagnosing what the agent did: prints the latest messages with their cards, and with --trace the tools each turn called, their inputs and results. With --log it prints the diagnostic journal the iPhone app keeps (launches, connection drops, voice, dictation, sharing), without message content. Usage: node Niepotrzebne/watek.mjs [--n 40] [--before ID] [--trace | --log] [--full] [--local]. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const local = flag("local");
const base = local ? "http://127.0.0.1:8790" : "https://concierge-valet-api.kalakasanyt.workers.dev";
const token = readFileSync(join(here, "../worker", local ? ".dev.vars" : ".prod.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const width = flag("full") ? 6000 : 420;
const clip = (text, n = width) => { const t = String(text ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const when = (ts) => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(ts);

async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, "user-agent": "valet-watek/1" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const count = Math.max(1, Math.min(400, +value("n", 40)));
let before = +value("before", 0) || null;

if (flag("log")) {
  const { log } = await get(`/api/log?n=${Math.min(300, count)}${before ? `&before=${before}` : ""}`).catch((err) => { console.log(/HTTP 404/.test(err.message) ? "Ten serwer nie zbiera jeszcze dziennika apki." : err.message); process.exit(1); });
  for (const e of log.reverse()) console.log(`${when(e.ts)} ${String(e.app).padEnd(5)} ${e.what}${e.detail ? `: ${clip(e.detail)}` : ""}`);
} else if (flag("trace")) {
  const { trace } = await get(`/api/trace?n=${Math.min(100, count)}${before ? `&before=${before}` : ""}`).catch((err) => { console.log(/HTTP 404/.test(err.message) ? "Ten serwer nie zapisuje jeszcze kroków Valeta (wersja sprzed zapisu tur)." : err.message); process.exit(1); });
  for (const t of trace.reverse()) {
    console.log(`\n=== tura ${t.id} · ${when(t.ts)} · ${t.kind} · ${t.model} · ${(t.ms / 1000).toFixed(1)} s · ${t.usd.toFixed(4)} USD${t.origin ? ` · wiadomość #${t.origin}` : ""}`);
    if (t.asked) console.log(`  wejście: ${clip(t.asked)}`);
    t.steps.forEach((step, i) => {
      console.log(`  krok ${i + 1}: ${step.stop}, ${(step.ms / 1000).toFixed(1)} s`);
      for (const tool of step.tools) console.log(`    ${tool.error ? "BŁĄD " : ""}${tool.name}(${clip(tool.input, 300)})${tool.server ? "" : ` -> ${clip(tool.result, 300)}`}`);
    });
    console.log(`  odpowiedź: ${clip(t.said)}`);
  }
} else {
  let list = [];
  while (list.length < count) {
    const { msgs } = await get(`/api/thread${before ? `?before=${before}` : ""}`);
    if (!msgs.length) break;
    list = [...msgs, ...list];
    before = msgs[0].id;
  }
  for (const m of list.slice(-count)) {
    const who = m.who === "me" ? "JUREK" : m.who === "sys" ? "system" : (m.agent || "valet").toUpperCase();
    const data = m.data && typeof m.data === "object" ? m.data : null;
    const extra = data ? Object.entries(data).filter(([k]) => !["sources"].includes(k)).map(([k, v]) => `${k}: ${clip(JSON.stringify(v), 260)}`).join(" | ") : "";
    console.log(`#${m.id} ${when(m.ts)} ${who}${m.kind && m.kind !== "text" ? ` [${m.kind}]` : ""}${m.reply_to ? ` (do #${m.reply_to})` : ""}: ${clip(m.text)}${extra ? `\n      ${extra}` : ""}`);
  }
}
