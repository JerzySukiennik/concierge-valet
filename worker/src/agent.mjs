/* Claude calls: key rotation, refusal fallback, live status labels, text and file extraction. */
import Anthropic from "@anthropic-ai/sdk";
import { HAIKU, sleep } from "./util.mjs";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const keys = (env) => (env.ANTHROPIC_API_KEYS || env.ANTHROPIC_API_KEY || "").split(",").map((s) => s.trim()).filter(Boolean);
export const client = (env, i = 0) => new Anthropic({ apiKey: keys(env)[i] || "", maxRetries: 1 });

export async function ask(env, params, onEvent) {
  const n = keys(env).length || 1;
  let last;
  for (let i = 0; i < n * 2; i++) {
    const c = client(env, i % n);
    try {
      const stream = params.model === HAIKU ? c.messages.stream(params) : c.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" });
      if (onEvent) stream.on("streamEvent", onEvent);
      return await stream.finalMessage();
    } catch (err) {
      last = err;
      const rotate = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.RateLimitError;
      if (!rotate) throw err;
      if (i % n === n - 1 && i < n * 2 - 1) await sleep(5000);
    }
  }
  throw last;
}

export function explain(err) {
  if (err instanceof Anthropic.RateLimitError) return "Za dużo zapytań naraz albo skończyły się kredyty API.";
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return "Klucz Claude API nie działa.";
  if (err instanceof Anthropic.BadRequestError) return `Claude API odrzuciło zapytanie: ${String(err.message).slice(0, 160)}`;
  if (err instanceof Anthropic.APIConnectionError) return "Nie mogę połączyć się z Claude API.";
  if (err instanceof Anthropic.APIError) return err.status >= 500 ? "Claude API ma chwilową przerwę." : `Claude API zwróciło błąd ${err.status}.`;
  return `Błąd wewnętrzny: ${String(err?.message || err).slice(0, 160)}`;
}

const SERVER_LABELS = { web_search: "Szuka w sieci", web_fetch: "Czyta stronę", bash_code_execution: "Pracuje w piaskownicy", text_editor_code_execution: "Pisze plik", code_execution: "Liczy" };
const TOOL_LABELS = { start_task: "Zleca zadanie", remember: "Zapamiętuje", forget: "Zapomina", schedule: "Ustawia przypomnienie", show_weather: "Sprawdza pogodę", calendar: "Sprawdza kalendarz", add_event: "Dodaje do kalendarza", change_event: "Zmienia w kalendarzu", delete_event: "Sprawdza kalendarz", youtube_search: "Szuka na YouTube", show_title: "Szuka tytułu", show_titles: "Wybiera tytuły", make_image: "Rysuje obrazek" };

export function label(e) {
  if (e.type !== "content_block_start") return null;
  const b = e.content_block;
  if (b.type === "server_tool_use") return SERVER_LABELS[b.name] || "Pracuje";
  if (b.type === "tool_use") return TOOL_LABELS[b.name] || null;
  if (b.type === "text") return "Pisze";
  return null;
}

export function extract(content) {
  let text = "";
  const sources = [];
  const blocks = content || [];
  let from = 0;
  blocks.forEach((b, i) => { if (typeof b.type === "string" && b.type.includes("tool")) from = i + 1; });
  const tail = blocks.slice(from).some((b) => b.type === "text" && b.text.trim()) ? blocks.slice(from) : blocks;
  for (const b of tail) {
    if (b.type !== "text") continue;
    text += b.text;
    for (const c of b.citations || []) if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ url: c.url, title: c.title || c.url });
  }
  return { text: text.trim(), sources: sources.slice(0, 5) };
}

export function fileIds(messages) {
  const ids = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.file_id === "string" && !ids.includes(v.file_id)) ids.push(v.file_id);
    Object.values(v).forEach(walk);
  };
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (typeof b.type === "string" && b.type.endsWith("tool_result")) walk(b.content);
  }
  return ids;
}
