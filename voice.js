/* Voice for the Valet apps: dictation into the composer (record, then a clean transcript) and a live spoken conversation through Gemini Live in which the agent stays the brain. */
const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
const b64 = (buffer) => { const bytes = new Uint8Array(buffer); let out = ""; for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(out); };
export const voiceReady = () => !!(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.MediaRecorder);

export async function startDictation() {
  const stream = await navigator.mediaDevices.getUserMedia(MIC);
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined), parts = [];
  recorder.addEventListener("dataavailable", (e) => { if (e.data.size) parts.push(e.data); });
  recorder.start();
  const close = () => { for (const track of stream.getTracks()) track.stop(); };
  return {
    stop: () => new Promise((resolve) => {
      recorder.addEventListener("stop", () => { close(); resolve(new Blob(parts, { type: (recorder.mimeType || type || "audio/mp4").split(";")[0] })); }, { once: true });
      try { recorder.stop(); } catch (e) { close(); resolve(new Blob([])); }
    }),
    cancel: () => { try { recorder.stop(); } catch (e) {} close(); },
  };
}

export async function transcribe({ base, token }, blob) {
  const res = await fetch(`${base}/api/transcribe`, { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": blob.type || "audio/mp4" }, body: blob });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Nie udało się przepisać nagrania.");
  return String(d.text || "").trim();
}

export class VoiceSession {
  constructor({ base, token, onState = () => {}, onCaption = () => {}, onLevel = () => {}, onEnd = () => {} }) {
    Object.assign(this, { base, token, onState, onCaption, onLevel, onEnd });
    this.sources = new Set();
    this.next = 0;
    this.state = "";
    this.muted = false;
    this.drop = false;
    this.busy = 0;
    this.over = false;
    this.played = 0;
  }

  set(state) {
    if (this.over || state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  async call(path, body) {
    const res = await fetch(`${this.base}${path}`, { method: "POST", headers: { authorization: `Bearer ${this.token()}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Serwer nie odpowiedział.");
    return d;
  }

  async start() {
    this.set("connecting");
    this.ctx = new AudioContext();
    await this.ctx.resume();
    this.stream = await navigator.mediaDevices.getUserMedia(MIC);
    const [ticket] = await Promise.all([this.call("/api/voice/token", {}), this.ctx.audioWorklet.addModule(new URL("./voice-worklet.js", import.meta.url))]);
    if (this.over) return;
    this.ws = new WebSocket(ticket.url);
    this.ws.addEventListener("open", () => this.ws.send(JSON.stringify({ setup: ticket.setup })));
    this.ws.addEventListener("message", async (e) => {
      let m;
      try { m = JSON.parse(typeof e.data === "string" ? e.data : await e.data.text()); } catch (err) { return; }
      this.handle(m);
    });
    this.ws.addEventListener("close", () => this.end(this.state === "connecting" ? "Nie udało się połączyć z głosem." : ""));
    this.ws.addEventListener("error", () => {});
  }

  listen() {
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.capture = new AudioWorkletNode(this.ctx, "valet-capture");
    this.capture.port.onmessage = ({ data }) => {
      const open = !this.muted && !this.sources.size && !this.busy;
      this.onLevel(open ? data.level : 0);
      if (open && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(data.pcm), mimeType: "audio/pcm;rate=16000" } } }));
    };
    source.connect(this.capture);
    this.set("listening");
  }

  handle(m) {
    if (m.setupComplete) return this.listen();
    if (m.toolCall) return void this.ask(m.toolCall.functionCalls || []);
    if (m.goAway) return this.end("Rozmowa trwała długo, więc ją zakończyłem. Możesz zacząć nową.");
    const c = m.serverContent;
    if (!c) return;
    if (c.inputTranscription?.text) this.onCaption("me", c.inputTranscription.text);
    if (c.outputTranscription?.text && !this.drop) this.onCaption("valet", c.outputTranscription.text);
    for (const part of c.modelTurn?.parts || []) if (part.inlineData?.data && !this.drop) this.play(part.inlineData.data);
    if (c.interrupted) this.hush();
    if (c.turnComplete) { this.drop = false; this.onCaption("end", ""); if (!this.sources.size && !this.busy) this.set("listening"); }
  }

  async ask(calls) {
    this.busy++;
    this.set("thinking");
    const answers = [];
    for (const call of calls) {
      let result = "Nie udało się połączyć z Valetem.";
      try { result = (await this.call("/api/voice/ask", { text: String(call.args?.request || "") })).reply || result; } catch (err) {}
      answers.push({ id: call.id, name: call.name, response: { result } });
    }
    this.busy--;
    if (!this.over && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ toolResponse: { functionResponses: answers } }));
  }

  play(data) {
    const raw = atob(data), samples = new Float32Array(raw.length >> 1);
    for (let i = 0; i < samples.length; i++) { const v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); samples[i] = (v >= 32768 ? v - 65536 : v) / 32768; }
    const buffer = this.ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime + 0.04, this.next);
    source.start(at);
    this.next = at + buffer.duration;
    this.played += buffer.duration;
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
    try { this.capture?.disconnect(); } catch (e) {}
    for (const track of this.stream?.getTracks() || []) track.stop();
    try { this.ws?.close(); } catch (e) {}
    this.ctx?.close().catch(() => {});
    this.onEnd(message);
  }
}
