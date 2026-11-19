/* Voice for the Valet apps: fast dictation (speech is streamed to a live transcriber, word for word, and comes back the moment he stops, with filler sounds and stuttered repeats removed) and a spoken conversation through Gemini Live in which the agent stays the brain. */
const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
const b64 = (buffer) => { const bytes = new Uint8Array(buffer); let out = ""; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (pcm) => JSON.stringify({ realtimeInput: { audio: { data: b64(pcm), mimeType: "audio/pcm;rate=16000" } } });
const KEPT = new Set(["nie", "tak", "no", "ha", "he", "oj", "aj", "hej"]);

export function tidy(text) {
  return String(text || "")
    .replace(/(^|[\s,])(?:e{2,}m?|y{2,}m?|m{3,}|hm{2,})(?=[\s,.!?]|$),?/giu, "$1")
    .replace(/(^|[^\p{L}])(\p{L}{1,4})(?:\s+\2)+(?=[^\p{L}]|$)/giu, (all, lead, word) => (KEPT.has(word.toLowerCase()) ? all : `${lead}${word}`))
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

export const voiceReady = () => !!(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode && window.WebSocket);

async function post(base, token, path, body) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Serwer nie odpowiedział.");
  return d;
}

async function microphone(onChunk) {
  const ctx = new AudioContext();
  const resumed = ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia(MIC);
  await Promise.all([resumed, ctx.audioWorklet.addModule(new URL("./voice-worklet.js", import.meta.url))]);
  const node = new AudioWorkletNode(ctx, "valet-capture");
  node.port.onmessage = ({ data }) => onChunk(data);
  ctx.createMediaStreamSource(stream).connect(node);
  return { ctx, close: () => { try { node.disconnect(); } catch (e) {} for (const track of stream.getTracks()) track.stop(); ctx.close().catch(() => {}); } };
}

const read = async (e) => { try { return JSON.parse(typeof e.data === "string" ? e.data : await e.data.text()); } catch (err) { return {}; } };

export class Dictation {
  constructor({ base, token, onLevel = () => {} }) {
    Object.assign(this, { base, token, onLevel });
    this.queue = [];
    this.final = "";
    this.interim = "";
    this.live = false;
    this.done = false;
    this.over = false;
    this.touched = 0;
  }

  async start() {
    this.mic = await microphone((data) => {
      if (this.over) return;
      this.onLevel(data.level);
      const out = frame(data.pcm);
      if (this.live && this.ws.readyState === 1) this.ws.send(out); else if (this.queue.length < 600) this.queue.push(out);
    });
    this.link = this.connect();
    this.link.catch(() => {});
  }

  async connect() {
    const ticket = await post(this.base, this.token, "/api/voice/token", { mode: "dictate" });
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(ticket.url);
      this.ws = ws;
      ws.addEventListener("open", () => ws.send(JSON.stringify({ setup: ticket.setup })));
      ws.addEventListener("message", async (e) => {
        const m = await read(e);
        if (m.setupComplete) {
          this.live = true;
          for (const out of this.queue.splice(0)) ws.send(out);
          return resolve();
        }
        const c = m.serverContent;
        if (!c) return;
        if (c.inputTranscription?.text) { this.final += c.inputTranscription.text; this.interim = ""; this.touched = Date.now(); }
        if (c.interimInputTranscription?.text) { this.interim = c.interimInputTranscription.text; this.touched = Date.now(); }
        if (this.over && (c.generationComplete || c.turnComplete)) this.done = true;
      });
      ws.addEventListener("close", () => { this.done = true; if (!this.live) reject(new Error("Nie udało się zacząć dyktowania.")); });
      ws.addEventListener("error", () => {});
    });
  }

  async stop() {
    if (this.over) return "";
    this.over = true;
    this.mic.close();
    try {
      await this.link;
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      const asked = Date.now();
      this.touched = asked;
      while (!this.done && Date.now() - asked < 2600 && !(Date.now() - asked > 300 && Date.now() - this.touched > 650)) await pause(50);
    } finally {
      try { this.ws?.close(); } catch (e) {}
    }
    return tidy(`${this.final} ${this.interim}`);
  }

  cancel() {
    if (this.over) return;
    this.over = true;
    this.mic?.close();
    try { this.ws?.close(); } catch (e) {}
  }
}

export class VoiceSession {
  constructor({ base, token, onState = () => {}, onLevel = () => {}, onEnd = () => {} }) {
    Object.assign(this, { base, token, onState, onLevel, onEnd });
    this.sources = new Set();
    this.next = 0;
    this.state = "";
    this.muted = false;
    this.drop = false;
    this.busy = 0;
    this.live = false;
    this.over = false;
  }

  set(state) {
    if (this.over || state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  async start() {
    this.set("connecting");
    this.mic = await microphone((data) => {
      const open = this.live && !this.muted && !this.sources.size && !this.busy;
      this.onLevel(open ? data.level : 0);
      if (open && this.ws?.readyState === 1) this.ws.send(frame(data.pcm));
    });
    const ticket = await post(this.base, this.token, "/api/voice/token", {});
    if (this.over) return;
    this.ws = new WebSocket(ticket.url);
    this.ws.addEventListener("open", () => this.ws.send(JSON.stringify({ setup: ticket.setup })));
    this.ws.addEventListener("message", async (e) => this.handle(await read(e)));
    this.ws.addEventListener("close", () => this.end(this.live ? "" : "Nie udało się połączyć z głosem."));
    this.ws.addEventListener("error", () => {});
  }

  handle(m) {
    if (m.setupComplete) { this.live = true; return this.set("listening"); }
    if (m.toolCall) return void this.ask(m.toolCall.functionCalls || []);
    if (m.goAway) return this.end("Rozmowa trwała długo, więc ją zakończyłem. Możesz zacząć nową.");
    const c = m.serverContent;
    if (!c) return;
    for (const part of c.modelTurn?.parts || []) if (part.inlineData?.data && !this.drop) this.play(part.inlineData.data);
    if (c.interrupted) this.hush();
    if (c.turnComplete) { this.drop = false; if (!this.sources.size && !this.busy) this.set("listening"); }
  }

  async ask(calls) {
    this.busy++;
    this.set("thinking");
    const answers = [];
    for (const call of calls) {
      let result = "Nie udało się połączyć z Valetem.";
      try { result = (await post(this.base, this.token, "/api/voice/ask", { text: String(call.args?.request || "") })).reply || result; } catch (err) {}
      answers.push({ id: call.id, name: call.name, response: { result } });
    }
    this.busy--;
    if (!this.over && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ toolResponse: { functionResponses: answers } }));
  }

  play(data) {
    const ctx = this.mic.ctx, raw = atob(data), samples = new Float32Array(raw.length >> 1);
    for (let i = 0; i < samples.length; i++) { const v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); samples[i] = (v >= 32768 ? v - 65536 : v) / 32768; }
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.04, this.next);
    source.start(at);
    this.next = at + buffer.duration;
    this.sources.add(source);
    source.addEventListener("ended", () => { this.sources.delete(source); if (!this.sources.size && !this.busy) this.set("listening"); });
    this.set("speaking");
  }

  hush() {
    for (const source of this.sources) { try { source.stop(); } catch (e) {} }
    this.sources.clear();
    this.next = 0;
  }

  interrupt() {
    if (!this.sources.size) return;
    this.drop = true;
    this.hush();
    this.set("listening");
  }

  mute(value) {
    this.muted = !!value;
  }

  end(message = "") {
    if (this.over) return;
    this.over = true;
    this.hush();
    this.mic?.close();
    try { this.ws?.close(); } catch (e) {}
    this.onEnd(message);
  }
}
