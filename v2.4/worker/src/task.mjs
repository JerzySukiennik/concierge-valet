/* Task: one background job per Durable Object. Runs the agent loop step by step in alarms and reports to Valet. */
import { DurableObject } from "cloudflare:workers";
import { ask, client, explain, extract, fileIds, label } from "./agent.mjs";
import { TASK_SYSTEM, taskBrief } from "./prompt.mjs";
import { taskTools } from "./tools.mjs";
import { cost, json } from "./util.mjs";

const CHUNK = 900000;
const MAX_STEPS = 14;

export class Task extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS big (k TEXT, i INTEGER, v TEXT, PRIMARY KEY (k, i))");
  }

  get(k, fallback = null) {
    const row = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0];
    return row ? JSON.parse(row.v) : fallback;
  }
  put(k, v) { this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, JSON.stringify(v)); }
  getBig(k) { return JSON.parse(this.sql.exec("SELECT v FROM big WHERE k = ? ORDER BY i", k).toArray().map((r) => r.v).join("") || "null"); }
  putBig(k, value) {
    const text = JSON.stringify(value);
    this.sql.exec("DELETE FROM big WHERE k = ?", k);
    for (let i = 0, off = 0; off < text.length; i++, off += CHUNK) this.sql.exec("INSERT INTO big (k, i, v) VALUES (?, ?, ?)", k, i, text.slice(off, off + CHUNK));
  }

  report(event, extra = {}) {
    const meta = this.get("meta");
    return this.env.VALET.get(this.env.VALET.idFromName("main")).fetch("https://valet/internal/task", { method: "POST", body: JSON.stringify({ id: meta.id, event, ...extra }) }).catch(() => null);
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/start") {
      const meta = await req.json();
      this.put("meta", meta);
      this.put("state", { step: 0, errors: 0, container: null, done: false });
      this.putBig("messages", [{ role: "user", content: taskBrief(meta) }]);
      await this.ctx.storage.setAlarm(Date.now());
      return json({ ok: true });
    }
    if (path === "/cancel") {
      this.put("cancelled", true);
      await this.ctx.storage.deleteAlarm();
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  async alarm() {
    const meta = this.get("meta"), state = this.get("state");
    if (!meta || !state || state.done || this.get("cancelled")) return;
    const messages = this.getBig("messages");
    const pending = [];
    let shown = "", sent = 0;
    try {
      const res = await ask(this.env, {
        model: meta.model,
        max_tokens: 64000,
        cache_control: { type: "ephemeral" },
        system: TASK_SYSTEM,
        tools: taskTools(meta),
        thinking: { type: "adaptive" },
        output_config: { effort: meta.effort || "medium" },
        messages,
        ...(state.container ? { container: state.container } : {}),
      }, (e) => {
        const text = label(e);
        if (!text || text === shown || sent >= 10) return;
        shown = text;
        sent++;
        pending.push(this.report("progress", { step: text }));
      });
      await Promise.all(pending);
      const usd = cost(res.usage, res.model || meta.model);
      console.log("task usage", meta.id, state.step, res.stop_reason, usd.toFixed(3), JSON.stringify(res.usage));
      if (res.container?.id) state.container = res.container.id;
      messages.push({ role: "assistant", content: res.content });
      state.step++;
      state.errors = 0;
      if (this.get("cancelled")) return;

      if (res.stop_reason === "refusal") return this.finish(state, messages, "failed", { text: "Model odmówił wykonania tego zadania.", usd });
      if (res.stop_reason === "pause_turn" || res.stop_reason === "max_tokens") {
        if (state.step >= MAX_STEPS) return this.finish(state, messages, "failed", { text: "Zadanie okazało się za długie i zostało przerwane.", usd });
        if (res.stop_reason === "max_tokens") messages.push({ role: "user", content: "Kontynuuj dokładnie od miejsca, w którym skończyłeś." });
        this.putBig("messages", messages);
        this.put("state", state);
        await this.report("progress", { step: "Pracuje dalej", usd });
        return this.ctx.storage.setAlarm(Date.now() + 100);
      }

      const { text, sources } = extract(res.content);
      const files = [];
      const c = client(this.env);
      for (const id of fileIds(messages).slice(-8)) {
        try {
          const m = await c.files.retrieveMetadata(id);
          files.push({ id, name: m.filename, mime: m.mime_type || "application/octet-stream", size: m.size_bytes || 0 });
        } catch (err) {
          console.error("file metadata", id, String(err));
        }
      }
      const wanted = meta.format && meta.format !== "none" ? files.filter((f) => f.name.toLowerCase().endsWith(`.${meta.format}`)) : [];
      const byName = new Map((wanted.length ? wanted : files).map((f) => [f.name, f]));
      return this.finish(state, messages, "done", { text: text || "Gotowe.", sources, files: [...byName.values()].slice(-4), usd });
    } catch (err) {
      console.error("task step", String(err?.stack || err));
      state.errors++;
      this.put("state", state);
      if (state.errors >= 3) return this.finish(state, messages, "failed", { text: explain(err), usd: 0 });
      return this.ctx.storage.setAlarm(Date.now() + 15000 * state.errors);
    }
  }

  async finish(state, messages, event, extra) {
    state.done = true;
    this.put("state", state);
    this.putBig("messages", messages);
    await this.report(event, extra);
  }
}
