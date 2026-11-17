/* Phone check for the connector cards: opens the thread at phone size in real Chrome, screenshots each card kind, the lightbox and a poster tap that posts a film card. */
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(here, "../worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const out = join(here, "shots/phone");
mkdirSync(out, { recursive: true });
const origin = process.env.VALET_APP || "http://localhost:2141";
const query = process.env.VALET_API_PORT ? `?api=${process.env.VALET_API_PORT}` : "";
const dark = process.argv.includes("--dark");
const tap = process.argv.includes("--tap");
const suffix = dark ? "-ciemny" : "";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: join(out, `${name}${suffix}.png`) }); };

await page.goto(`${origin}/${query}#k=${token}`);
await page.waitForSelector("#app:not([hidden]) #thread .msg", { timeout: 15000 });
const report = { kinds: {} };

for (const [cls, name] of [["kx-vids", "karta-youtube"], ["kx-film", "karta-film"], ["kx-shelf", "karta-polka"], ["kx-shot", "karta-obrazek"], ["kx-cal", "karta-kalendarz"], ["kx-event", "karta-wydarzenie"]]) {
  const n = await page.locator(`#thread .${cls}`).count();
  report.kinds[cls] = n;
  if (!n) continue;
  await page.evaluate((c) => [...document.querySelectorAll(`#thread .${c}`)].pop().scrollIntoView({ block: "center" }), cls);
  await shot(name);
}
report.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
report.widths = await page.evaluate(() => [...document.querySelectorAll("#thread .kx")].map((n) => Math.round(n.getBoundingClientRect().width)));

if (await page.locator("#thread .kx-shot .kx-frame").count()) {
  await page.locator("#thread .kx-shot .kx-frame").last().tap();
  await page.waitForSelector(".kx-light img");
  await shot("obrazek-powiekszony");
  await page.locator(".kx-light").tap({ position: { x: 20, y: 40 } });
  await page.waitForSelector(".kx-light", { state: "detached" });
  report.lightboxClosed = true;
}

if (tap && (await page.locator("#thread .kx-shelf .kx-tile").count())) {
  const before = await page.locator("#thread .kx-film").count();
  await page.evaluate(() => [...document.querySelectorAll("#thread .kx-shelf")].pop().scrollIntoView({ block: "center" }));
  await page.locator("#thread .kx-shelf").last().locator(".kx-tile").nth(2).tap();
  await page.waitForFunction((n) => document.querySelectorAll("#thread .kx-film").length > n, before, { timeout: 20000 });
  report.posterTapPostedCard = true;
  await page.waitForTimeout(1200);
  await page.evaluate(() => [...document.querySelectorAll("#thread .kx-film")].pop().scrollIntoView({ block: "start" }));
  await shot("karta-serial");
}

if (process.argv.includes("--delete") && (await page.locator("#thread .kx-event .btn:not(.ghost)").count())) {
  const card = page.locator("#thread .kx-event").last();
  await card.locator(".btn:not(.ghost)").tap();
  await page.waitForSelector("#thread .kx-event.kx-gone", { timeout: 20000 });
  report.deleteState = await page.locator("#thread .kx-event").last().locator(".kx-state").innerText();
  await shot("karta-wydarzenie-usuniete");
}

await page.tap('[data-tab="make"]').catch(() => {});
await shot("pliki-obrazki");

report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
