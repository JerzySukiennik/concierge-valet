/* Phone check for voice in real Chrome with a spoken Polish sentence fed in as the microphone: dictation fills the composer with a clean transcript, and the live conversation hears a question, asks the agent and speaks the answer. */
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
const report = {};

function speech(name, text) {
  const aiff = join(out, `${name}.aiff`), wav = join(out, `${name}.wav`);
  execFileSync("/usr/bin/say", ["-v", "Zosia", "-o", aiff, text]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-af", "adelay=1200,apad=pad_dur=8", "-ar", "48000", "-ac", "1", wav]);
  return wav;
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

if (!process.argv.includes("--talk")) {
  const { browser, page, errors } = await open(speech("dyktowanie", "Dodaj proszę do do kalendarza, eee, jutro o siedemnastej, trening piłki nożnej."));
  report.micShown = await page.locator("#mic").isVisible();
  report.talkMode = await page.evaluate(() => document.getElementById("send").classList.contains("talk"));
  await page.locator("#mic").tap();
  await page.waitForSelector("#mic.rec", { timeout: 8000 });
  await page.waitForTimeout(7500);
  await page.screenshot({ path: join(out, "dyktowanie-nagrywa.png") });
  await page.locator("#mic").tap();
  await page.waitForFunction(() => document.getElementById("input").value.trim().length > 0 || document.querySelector(".toast"), null, { timeout: 45000 }).catch(() => {});
  report.dictated = await page.evaluate(() => document.getElementById("input").value);
  report.sendReady = await page.evaluate(() => { const s = document.getElementById("send"); return !s.disabled && !s.classList.contains("talk"); });
  await page.screenshot({ path: join(out, "dyktowanie-tekst.png") });
  report.dictationErrors = errors;
  await browser.close();
}

if (!process.argv.includes("--dictate")) {
  const { browser, page, errors } = await open(speech("pytanie", "Cześć Valet. Co mam jutro w kalendarzu?"));
  const before = await page.locator("#thread .msg").count();
  await page.locator("#send").tap();
  await page.waitForSelector("#voice:not([hidden])", { timeout: 8000 });
  const seen = new Set(), lines = new Set();
  const t0 = Date.now();
  let spoke = 0;
  while (Date.now() - t0 < 70000) {
    const s = await page.evaluate(() => ({ hidden: document.getElementById("voice").hidden, state: document.getElementById("voice-state").textContent, line: document.getElementById("voice-line").textContent, me: document.getElementById("voice-line").classList.contains("me") }));
    if (s.hidden) break;
    seen.add(s.state);
    if (s.line) lines.add(`${s.me ? "ja" : "valet"}: ${s.line}`);
    if (s.state === "Mówi" && !spoke) { spoke = Date.now() - t0; await page.screenshot({ path: join(out, "rozmowa-mowi.png") }); }
    if (spoke && s.state === "Słucham" && Date.now() - t0 - spoke > 2500) break;
    await page.waitForTimeout(350);
  }
  report.states = [...seen];
  report.firstSpeechMs = spoke;
  report.captions = [...lines].slice(-4);
  await page.locator("#voice-end").tap();
  await page.waitForTimeout(1200);
  report.closed = await page.evaluate(() => document.getElementById("voice").hidden);
  report.newMessages = (await page.locator("#thread .msg").count()) - before;
  report.lastReply = await page.evaluate(() => [...document.querySelectorAll("#thread .msg.ag")].pop()?.textContent.slice(0, 220));
  report.talkErrors = errors;
  await browser.close();
}

console.log(JSON.stringify(report, null, 1));
process.exit(0);
