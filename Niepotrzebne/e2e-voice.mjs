/* Phone check for voice in real Chrome with a spoken Polish sentence fed in as the microphone: dictation shows live waves, Stop puts a clean transcript into the composer, Send posts it at once, and the live conversation answers out loud without writing anything into the thread. */
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(here, "../worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const origin = process.env.VALET_APP || "http://localhost:2141";
const out = join(here, "shots/voice");
mkdirSync(out, { recursive: true });
const only = process.argv.find((a) => ["--stop", "--send", "--talk"].includes(a));
const report = {};

function speech(name, text) {
  const aiff = join(out, `${name}.aiff`), wav = join(out, `${name}.wav`);
  execFileSync("/usr/bin/say", ["-v", "Zosia", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-af", "adelay=1200,apad=pad_dur=8", "-ar", "48000", "-ac", "1", wav]);
  const seconds = +execFileSync("ffprobe", ["-loglevel", "error", "-show_entries", "format=duration", "-of", "csv=p=0", aiff]).toString();
  return { wav, ms: Math.round(seconds * 1000) + 1200 };
}

async function open(wav) {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["microphone"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto(`${origin}/#k=${token}`);
  await page.waitForSelector("#app:not([hidden]) #thread .msg", { timeout: 15000 });
  await page.waitForTimeout(600);
  return { browser, page, errors };
}

const waveInk = (page) => page.evaluate(() => { const c = document.getElementById("dict-wave"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let rows = new Set(); for (let i = 3; i < d.length; i += 4) if (d[i] > 40) rows.add(Math.floor(i / 4 / c.width)); return rows.size; });

if (!only || only === "--stop") {
  const said = speech("dyktowanie", "Dodaj proszę do do kalendarza, eee, jutro o siedemnastej, trening piłki nożnej.");
  const { browser, page, errors } = await open(said.wav);
  await page.locator("#mic").tap();
  await page.waitForSelector("#dict:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(700);
  const quiet = await waveInk(page);
  await page.waitForTimeout(2600);
  const loud = await waveInk(page);
  await page.screenshot({ path: join(out, "dyktowanie-fale.png") });
  await page.waitForTimeout(Math.max(0, said.ms - 3300) + 500);
  const t0 = Date.now();
  await page.locator("#dict-stop").tap();
  await page.waitForFunction(() => document.getElementById("dict").hidden, null, { timeout: 15000 });
  report.stop = { waveRowsQuiet: quiet, waveRowsSpeaking: loud, msToText: Date.now() - t0, text: await page.evaluate(() => document.getElementById("input").value), errors };
  await browser.close();
}

if (!only || only === "--send") {
  const said = speech("wyslij", "To jest test dyktowania. Nie odpowiadaj nic poza słowem przyjąłem.");
  const { browser, page, errors } = await open(said.wav);
  const before = await page.locator("#thread .msg.me").count();
  await page.locator("#mic").tap();
  await page.waitForSelector("#dict:not([hidden])", { timeout: 8000 });
  await page.waitForTimeout(said.ms + 600);
  const t0 = Date.now();
  await page.locator("#dict-send").tap();
  await page.waitForFunction((n) => document.querySelectorAll("#thread .msg.me").length > n, before, { timeout: 15000 });
  report.send = { msToMessage: Date.now() - t0, sent: await page.evaluate(() => [...document.querySelectorAll("#thread .msg.me")].pop().firstChild.textContent), inputLeft: await page.evaluate(() => document.getElementById("input").value), errors };
  await browser.close();
}

if (!only || only === "--talk") {
  const said = speech("pytanie", "Cześć Valet. Jaka jest jutro pogoda w Warszawie?");
  const { browser, page, errors } = await open(said.wav);
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => document.querySelectorAll("#thread > *").length);
  let audio = 0, asked = "";
  page.on("websocket", (ws) => {
    if (!ws.url().includes("generativelanguage")) return;
    ws.on("framereceived", (f) => { const p = typeof f.payload === "string" ? f.payload : f.payload.toString(); if (p.includes("inlineData")) audio++; const m = /"request":\s*"([^"]{0,200})/.exec(p); if (m) asked = m[1]; });
  });
  await page.locator("#send").tap();
  await page.waitForSelector("#voice:not([hidden])", { timeout: 8000 });
  const seen = new Set(), t0 = Date.now();
  let spoke = 0;
  while (Date.now() - t0 < 80000) {
    const s = await page.evaluate(() => ({ hidden: document.getElementById("voice").hidden, state: document.getElementById("voice-state").textContent }));
    if (s.hidden) break;
    seen.add(s.state);
    if (s.state === "Mówi" && !spoke) { spoke = Date.now() - t0; await page.screenshot({ path: join(out, "rozmowa-mowi.png") }); }
    if (spoke && s.state === "Słucham" && Date.now() - t0 - spoke > 2500) break;
    await page.waitForTimeout(300);
  }
  await page.locator("#voice-end").tap();
  await page.waitForTimeout(2500);
  report.talk = { states: [...seen], firstSpeechMs: spoke, audioFrames: audio, askedValet: asked, captionShown: await page.locator("#voice-line").count(), closed: await page.evaluate(() => document.getElementById("voice").hidden), threadGrewBy: (await page.evaluate(() => document.querySelectorAll("#thread > *").length)) - before, errors };
  await browser.close();
}

console.log(JSON.stringify(report, null, 1));
process.exit(0);
