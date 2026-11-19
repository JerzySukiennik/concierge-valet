/* Links to short videos and posts: Gemini watches a video and reports what it shows and says, X posts are read through the public embed endpoint. */
const API = "https://generativelanguage.googleapis.com";
const PROMPT = `You are the eyes and ears of another assistant that cannot watch video. Report everything it needs to act on this video without seeing it, in this order:
1. GIST: one sentence on what the video is.
2. SPEECH: the full transcript of what is said, in the original language.
3. ON SCREEN: every piece of text shown on screen, in order.
4. STEPS: what happens step by step, with every quantity, ingredient, tool, setting, command, piece of code, name and link that appears or is mentioned.
Write plainly, add no advice and no commentary, and say "unclear" where you cannot tell instead of guessing.`;

const keys = (env) => String(env.GEMINI_API_KEYS || env.GEMINI_API_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
export const geminiOn = (env) => keys(env).length > 0;
const models = (env) => String(env.GEMINI_VIDEO_MODELS || "gemini-3.5-flash,gemini-3.8-flash,gemini-2.5-flash").split(",").map((m) => m.trim()).filter(Boolean);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(key, env, part, focus) {
  let last;
  for (const model of models(env)) {
    let res;
    try {
      res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(80000),
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [part, { text: focus ? `${PROMPT}\nPay special attention to: ${focus}` : PROMPT }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 6000 } }),
      });
    } catch (err) {
      last = new Error(`Gemini did not answer in time (${model})`);
      continue;
    }
    if (!res.ok) {
      last = new Error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      last.status = res.status;
      if ([404, 429, 500, 503].includes(res.status)) continue;
      throw last;
    }
    const d = await res.json(), u = d.usageMetadata || {};
    const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) { last = new Error("Gemini returned nothing for this video"); continue; }
    return { text: text.slice(0, 14000), usd: ((u.promptTokenCount || 0) * 0.5 + (u.candidatesTokenCount || 0) * 3) / 1e6 };
  }
  throw last || new Error("the video viewer is not available");
}

async function upload(key, bytes, mime) {
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start", "x-goog-upload-header-content-length": String(bytes.byteLength), "x-goog-upload-header-content-type": mime, "content-type": "application/json" },
    body: JSON.stringify({ file: { display_name: "valet-clip" } }),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) { const err = new Error(`Gemini refused the upload (${start.status})`); err.status = start.status; throw err; }
  const done = await fetch(url, { method: "POST", headers: { "x-goog-upload-offset": "0", "x-goog-upload-command": "upload, finalize", "content-length": String(bytes.byteLength) }, body: bytes });
  if (!done.ok) throw new Error(`Gemini did not take the file (${done.status})`);
  let file = (await done.json()).file;
  for (let i = 0; i < 40 && file?.state === "PROCESSING"; i++) {
    await pause(2000);
    file = await (await fetch(`${API}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key } })).json();
  }
  if (file?.state !== "ACTIVE") throw new Error("Gemini could not process the video");
  return file;
}

async function withKeys(env, work) {
  const list = keys(env);
  if (!list.length) throw new Error("the video viewer is not connected");
  let last;
  for (const key of list) {
    try { return await work(key); } catch (err) { last = err; if (![400, 401, 403, 429, 500, 503].includes(err.status)) throw err; }
  }
  throw last;
}

export const watchBytes = (env, bytes, mime, focus) => withKeys(env, async (key) => {
  const file = await upload(key, bytes, mime);
  try { return await generate(key, env, { file_data: { file_uri: file.uri, mime_type: file.mimeType || mime } }, focus); } finally { fetch(`${API}/v1beta/${file.name}`, { method: "DELETE", headers: { "x-goog-api-key": key } }).catch(() => {}); }
});

export const watchYouTube = (env, url, focus) => withKeys(env, (key) => generate(key, env, { file_data: { file_uri: url } }, focus));

export function kindOf(link) {
  let url;
  try { url = new URL(link); } catch (e) { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^(www|m|mobile)\./, "");
  if (host === "youtu.be" || host.endsWith("youtube.com")) {
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || (/\/(shorts|live|embed)\/([\w-]{6,})/.exec(url.pathname) || [])[2];
    return id ? { kind: "youtube", url: `https://www.youtube.com/watch?v=${id}`, id } : null;
  }
  if (host === "x.com" || host === "twitter.com") {
    const id = (/\/status(?:es)?\/(\d{5,25})/.exec(url.pathname) || [])[1];
    return id ? { kind: "x", url: url.href, id } : null;
  }
  return { kind: "other", url: url.href };
}

export async function readPost(id) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=pl`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" } });
  if (!res.ok) throw new Error(res.status === 404 ? "that post is not public or no longer exists" : `X answered ${res.status}`);
  const d = await res.json();
  if (!d || !d.text) throw new Error("that post is not public or no longer exists");
  const media = d.mediaDetails || [];
  const clip = media.find((m) => m.type === "video" || m.type === "animated_gif");
  const variants = (clip?.video_info?.variants || []).filter((v) => v.content_type === "video/mp4").sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
  const quote = d.quoted_tweet ? `\nQuoted post by ${d.quoted_tweet.user?.name || "someone"}: ${String(d.quoted_tweet.text || "").slice(0, 1500)}` : "";
  return {
    author: `${d.user?.name || ""} (@${d.user?.screen_name || "?"})`,
    at: d.created_at || "",
    text: `${String(d.text).slice(0, 4000)}${quote}`,
    photos: media.filter((m) => m.type === "photo").map((m) => m.media_url_https).filter(Boolean).slice(0, 3),
    video: variants.length ? (variants.find((v) => (v.bitrate || 0) >= 600000) || variants[variants.length - 1]).url : "",
  };
}

const LIVE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export function liveSetup(env, owner, agent) {
  return {
    model: `models/${env.GEMINI_LIVE_MODEL || "gemini-3.8-live"}`,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env.GEMINI_LIVE_VOICE || "Kore" } }, languageCode: "pl-PL" } },
    systemInstruction: { parts: [{ text: `You are the voice of ${agent}, the personal assistant of ${owner}. You speak with him out loud. Speak Polish unless he speaks another language, in short natural sentences, with no lists, no markdown and no reading out of links or symbols.
You know nothing about his data yourself: ${agent} does, and it also acts for him. For every question, request or task call ask_valet with what he wants, written so it stands on its own (add what was said a moment ago if his sentence depends on it). The only things you answer alone are a greeting, a thank you, a request to repeat or to speak differently.
When the answer comes back, tell it to him faithfully and briefly in your own spoken words. Never add facts, never say something was done unless the answer says so, and when the answer says something waits for his decision in the app, tell him that it waits there.
If you did not catch what he said, ask him to say it again instead of guessing.` }] },
    tools: [{ functionDeclarations: [{ name: "ask_valet", description: `Hand his request to ${agent}, which knows his calendar, memory, messages, files and sessions and can act for him. Returns the answer to say out loud.`, parameters: { type: "OBJECT", properties: { request: { type: "STRING", description: "What he wants, in his own words, complete enough to stand alone" } }, required: ["request"] } }] }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export const liveToken = (env, setup) => withKeys(env, async (key) => {
  const soon = (s) => new Date(Date.now() + s * 1000).toISOString();
  const res = await fetch(`${API}/v1beta/auth_tokens`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ uses: 1, expireTime: soon(1800), newSessionExpireTime: soon(90), bidiGenerateContentSetup: setup }) });
  if (!res.ok) { const err = new Error(`Gemini refused a voice session (${res.status}): ${(await res.text()).slice(0, 160)}`); err.status = res.status; throw err; }
  const d = await res.json();
  if (!d.name) throw new Error("Gemini returned no voice token");
  return { url: `${LIVE}?access_token=${encodeURIComponent(d.name)}`, setup };
});

export const transcribe = (env, bytes, mime) => withKeys(env, async (key) => {
  let last;
  for (const model of models(env)) {
    let res;
    try {
      res = await fetch(`${API}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(40000),
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: bytes } }, { text: "This is a dictated note, most likely in Polish. Write down exactly what the speaker means to say, in the language spoken: keep his words and his meaning, drop stutters, repeated words, false starts and filler sounds, and add punctuation. Do not answer it, do not translate it, do not add anything. If there is no speech, output nothing. Output only the text." }] }], generationConfig: { temperature: 0, maxOutputTokens: 2000 } }),
      });
    } catch (err) { last = new Error("Gemini did not answer in time"); continue; }
    if (!res.ok) { last = new Error(`Gemini answered ${res.status}`); last.status = res.status; if ([404, 429, 500, 503].includes(res.status)) continue; throw last; }
    const d = await res.json(), u = d.usageMetadata || {};
    return { text: (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim().slice(0, 6000), usd: ((u.promptTokenCount || 0) * 0.5 + (u.candidatesTokenCount || 0) * 3) / 1e6 };
  }
  throw last || new Error("the transcriber is not available");
});
