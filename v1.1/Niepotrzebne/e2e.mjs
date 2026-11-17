/* Dev check: drives the local app at phone size in real Chrome, takes screenshots and exercises send, tabs, agents and settings. */
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(here, "../worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const out = join(here, "shots");
mkdirSync(out, { recursive: true });
const mode = process.argv[2] || "look";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: join(out, `${name}.png`) }); };

await page.goto(`http://localhost:2141/#k=${token}`);
await page.waitForSelector("#app:not([hidden]) #thread > *", { timeout: 15000 });
const report = { paired: true };

if (mode === "look") {
  await shot("czat");
  await page.evaluate(() => { const v = document.getElementById("view-chat"), sky = document.querySelector("#thread .sky"); if (sky) v.scrollTop = sky.offsetTop - 140; });
  await shot("czat-pogoda");
  await page.tap('[data-tab="tasks"]');
  await shot("zadania");
  await page.tap('[data-tab="make"]');
  await shot("tworz");
  await page.tap('[data-tab="chat"]');
  await page.tap("#agents-btn");
  await page.waitForSelector("#preview .av");
  await shot("agenci");
  await page.tap('[data-agent="kurier"]');
  await page.waitForSelector("#pix");
  await page.tap('[data-state-chip="working"]');
  await page.evaluate(() => document.getElementById("sheet").scrollTo(0, 260));
  await shot("agenci-piksel");
  report.pixelCells = await page.locator("#pix i").count();
  await page.tap("[data-close]");
  await page.tap("#me-btn");
  await page.waitForSelector("#push-on");
  await shot("ustawienia");
  report.models = await page.locator("[data-model]").evaluateAll((els) => els.map((e) => e.value));
  await page.tap("[data-close]");
}

if (mode === "send") {
  const before = await page.locator("#thread .msg.ag").count();
  await page.fill("#input", process.argv[3] || "Odpowiedz jednym krótkim zdaniem: działa test z apki?");
  report.sendEnabled = await page.locator("#send").isEnabled();
  await page.tap("#send");
  await page.waitForSelector("#thread .typing", { timeout: 15000 });
  report.typingShown = true;
  report.stateDuringTurn = await page.getAttribute("#puck", "data-state");
  report.pillDuringTurn = await page.textContent("#status");
  await shot("tura");
  await page.waitForFunction((n) => document.querySelectorAll("#thread .msg.ag").length > n, before, { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector("#thread .typing"), null, { timeout: 30000 });
  report.reply = await page.locator("#thread .msg.ag").last().innerText();
  report.pending = await page.locator("#thread .msg.pending").count();
  report.mine = await page.locator("#thread .msg.me").count();
  await shot("po-odpowiedzi");
}

if (mode === "avatar") {
  await page.tap("#agents-btn");
  await page.waitForSelector("#preview .av");
  await page.tap('[data-type="buzka"]');
  await page.selectOption('select[data-k="mouth"]', "smile");
  await page.tap("#e-save");
  await page.waitForFunction(() => document.querySelector("#puck .av")?.classList.contains("av-buzka"), null, { timeout: 8000 });
  report.headerAfterSave = await page.getAttribute("#puck .av", "class");
  await page.tap("[data-close]");
  await shot("awatar-zmieniony");
  await page.tap("#agents-btn");
  await page.waitForSelector("#preview .av");
  await page.tap('[data-type="orbita"]');
  await page.tap("#e-save");
  await page.waitForFunction(() => document.querySelector("#puck .av")?.classList.contains("av-orbita"), null, { timeout: 8000 });
  report.headerRestored = await page.getAttribute("#puck .av", "class");
}

report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
