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
  {
    name: "calendar",
    description: "Read his iCloud calendar. Returns the events in a range of days, each with an id for later changes, and can put an agenda card into the thread. Use it for anything about his plans, free time or a particular event.",
    strict: true,
    input_schema: obj({
      from: { type: "string", description: "First day, Europe/Warsaw, as YYYY-MM-DD" },
      days: { type: "integer", description: "How many days starting from that day, 1 to 31" },
      query: { type: "string", description: "Only events whose title or place contains this text, empty for all events" },
      show: { type: "boolean", description: "true to put the agenda card into the thread, when he asks what he has planned; false when you only need the facts for your answer" },
    }),
  },
  {
    name: "add_event",
    description: "Add an event to his calendar. A card with an undo button appears in the thread.",
    strict: true,
    input_schema: obj({
      title: { type: "string", description: "Event title, short, in Polish" },
      start: { type: "string", description: "Start in Europe/Warsaw as YYYY-MM-DDTHH:MM, or YYYY-MM-DD for an all-day event" },
      end: { type: "string", description: "End in the same form; for an all-day event its last day. One hour after the start when he gave no end" },
      all_day: { type: "boolean" },
      calendar: { type: "string", description: "Calendar name from the context when a particular one fits, otherwise empty" },
      location: { type: "string", description: "Place, or empty" },
      notes: { type: "string", description: "Notes, or empty" },
      alert_minutes: { type: "integer", description: "Minutes before the start for an alert on his devices, 0 for none" },
    }),
  },
  {
    name: "change_event",
    description: "Move, rename or relocate one event from an earlier calendar result. Repeating events cannot be changed yet.",
    strict: true,
    input_schema: obj({
      id: { type: "string", description: "Event id from a calendar result" },
      title: { type: "string", description: "New title, or empty to keep it" },
      start: { type: "string", description: "New start as YYYY-MM-DDTHH:MM or YYYY-MM-DD, or empty to keep the time" },
      end: { type: "string", description: "New end in the same form, or empty to keep the same length" },
      all_day: { type: "boolean", description: "Used only together with a new start" },
      location: { type: "string", description: "New place, or empty to keep it" },
    }),
  },
  {
    name: "delete_event",
    description: "Ask him to confirm deleting an event: puts a card with a delete button into the thread. Nothing is deleted until he taps it.",
    strict: true,
    input_schema: obj({ id: { type: "string", description: "Event id from a calendar result" } }),
  },
  {
    name: "whatsapp_chats",
    description: "List his WhatsApp chats: groups and people, newest first, with unread counts. Works only while the context says WhatsApp is connected.",
    strict: true,
    input_schema: obj({ query: { type: "string", description: "Part of a chat name to filter by, or empty for the most recent chats" } }),
  },
  {
    name: "whatsapp_read",
    description: "Read recent messages of one WhatsApp chat, with the authors' names. Use it when he asks what was written, what was assigned, when something is, or before drafting a reply.",
    strict: true,
    input_schema: obj({
      chat: { type: "string", description: "Chat or group name, or a clear part of it" },
      days: { type: "integer", description: "How many days back to read, 1 to 60" },
    }),
  },
  {
    name: "whatsapp_draft",
    description: "Prepare a WhatsApp message for him to approve: puts a card with the text into the thread. Nothing is sent until he taps send on the card; he can edit the text there. A signature naming you is added automatically, so do not write one.",
    strict: true,
    input_schema: obj({
      chat: { type: "string", description: "Chat or group name the message is for; You for his own chat with himself" },
      text: { type: "string", description: "The message exactly as it should be sent, in his voice: short, natural, the way a student writes to classmates or the way he writes to that person. WhatsApp formatting only: *bold*, _italic_, simple lines" },
    }),
  },
  {
    name: "youtube_search",
    description: "Search YouTube and put a card with the best videos into the thread; he taps a video to open it in the YouTube app. The result lists the same videos for you. Use it when he asks for a video, a tutorial, a channel's uploads or something to watch on YouTube.",
    strict: true,
    input_schema: obj({
      query: { type: "string", description: "Search words, in the language the videos should be in" },
      order: { type: "string", enum: ["relevance", "date", "views"], description: "relevance by default, date for the newest uploads, views for the most watched" },
    }),
  },
  {
    name: "show_title",
    description: "Put a card about one film or series into the thread: poster, year, rating, plot, makers, trailer and where it can be watched in Poland. The result gives you the same facts and the other matches. Use it for any question about a specific film or series.",
    strict: true,
    input_schema: obj({
      query: { type: "string", description: "Title to look for, Polish or original" },
      type: { type: "string", enum: ["any", "movie", "tv"] },
      year: { type: "integer", description: "Release year when he gave one or it is needed to tell titles apart, otherwise 0" },
      id: { type: "integer", description: "TMDB id from an earlier result when you want exactly that title, otherwise 0" },
    }),
  },
  {
    name: "show_titles",
    description: "Put a row of film and series posters into the thread; he taps a poster to get the full card. Use it when he wants several options: what to watch, something similar to a title, what is popular or what is in cinemas.",
    strict: true,
    input_schema: obj({
      list: { type: "string", enum: ["search", "similar", "trending", "in_cinemas"], description: "search: titles matching the query. similar: recommendations based on the title in the query. trending: most popular this week. in_cinemas: films now showing in Poland" },
      query: { type: "string", description: "Title or search words for search and similar, empty for the other lists" },
      type: { type: "string", enum: ["any", "movie", "tv"] },
    }),
  },
  {
    name: "make_image",
    description: "Generate an image and post it into the thread; it is also saved in his files. Use it when he asks for a picture, a mockup, a concept, an icon or a visualisation. You do not see the result.",
    strict: true,
    input_schema: obj({
      title: { type: "string", description: "Short Polish name of the picture, two to five words, used as the caption and the file name" },
      prompt: { type: "string", description: "The prompt in English, concrete, one paragraph: subject, style, composition, light. Put exact on-screen text in single quotes ('LAUNCH') and place elements by position (top-left, bottom-center)" },
      aspect: { type: "string", enum: ["16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], description: "16:9 by default, 9:16 for a phone screen or a wallpaper, 1:1 for an icon or an avatar" },
      quality: { type: "string", enum: ["low", "medium", "high"], description: "low unless he explicitly asks for better quality; medium and high cost several times more" },
    }),
  },
];

export const VERDICT = {
  name: "verdict",
  description: "Report whether the assistant should look at these messages.",
  input_schema: obj({
    action: { type: "string", enum: ["ignore", "attention"] },
    reason: { type: "string", description: "A few words on why, in English" },
  }),
};

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
