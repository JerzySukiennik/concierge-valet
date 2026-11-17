/* Tool definitions for the thread agent and for background task agents. */
import { HAIKU } from "./util.mjs";

const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });

const CUSTOM = [
  {
    name: "start_task",
    description: "Hand work to a background agent that runs on its own and posts the result into the thread when it is finished. Use for research that deserves a report and for anything that ends in a file: PDF, Word, Excel, a presentation, a small web page. Not for answers you can give right now.",
    strict: true,
    input_schema: obj({
      title: { type: "string", description: "Short Polish title for the task card, up to six words" },
      kind: { type: "string", enum: ["research", "document"], description: "document when the result is a file, research when the result is findings written into the thread" },
      format: { type: "string", enum: ["pdf", "docx", "xlsx", "pptx", "html", "none"], description: "File format for a document task, none for research" },
      instructions: { type: "string", description: "The complete brief for the background agent, which sees nothing else: the goal, what he asked for in his own words, audience, length, language, and anything from memory or the thread that matters" },
    }),
  },
  {
    name: "remember",
    description: "Save one durable fact or preference about the owner for later conversations.",
    strict: true,
    input_schema: obj({ text: { type: "string", description: "The fact, in Polish, one sentence" } }),
  },
  {
    name: "forget",
    description: "Delete a remembered fact by its number from the memory list.",
    strict: true,
    input_schema: obj({ id: { type: "integer", description: "Number of the fact" } }),
  },
  {
    name: "schedule",
    description: "Set a reminder that Valet sends into the thread at a given time, once or on a repeat.",
    strict: true,
    input_schema: obj({
      at: { type: "string", description: "First time it fires, Europe/Warsaw local time as YYYY-MM-DDTHH:MM" },
      repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly"] },
      text: { type: "string", description: "What to tell him when it fires, in Polish, phrased as the reminder itself" },
    }),
  },
  { name: "list_schedule", description: "List reminders and recurring briefs that are set.", strict: true, input_schema: obj({}) },
  {
    name: "cancel_schedule",
    description: "Delete a reminder by its number from list_schedule.",
    strict: true,
    input_schema: obj({ id: { type: "integer", description: "Number of the reminder" } }),
  },
  {
    name: "show_weather",
    description: "Put a weather card for his city into the thread and get the numbers back.",
    strict: true,
    input_schema: obj({ day: { type: "string", enum: ["today", "tomorrow"] } }),
  },
];

export function chatTools(model) {
  const web = model === HAIKU
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
    : [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 6000 }];
  return [...web, ...CUSTOM];
}

export function taskTools(meta) {
  if (meta.kind === "document") {
    return [
      { type: "code_execution_20260521", name: "code_execution" },
      { type: "web_search_20250305", name: "web_search", max_uses: 6 },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: 4, max_content_tokens: 8000 },
    ];
  }
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: 8 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6, max_content_tokens: 8000 },
  ];
}
