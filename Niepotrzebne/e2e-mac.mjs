/* Dev check for the Mac interface: drives mac/ at desktop size in real Chrome, takes screenshots and exercises views, the agent editor, settings and send. */
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(here, "../worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const out = join(here, "shots/mac");
mkdirSync(out, { recursive: true });
const mode = process.argv[2] || "look";
const dark = process.argv.includes("--dark");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const shot = async (name) => { await page.waitForTimeout(900); await page.screenshot({ path: join(out, `${name}${dark ? "-dark" : ""}.png`) }); };

await page.goto(`${process.env.VALET_APP || "http://localhost:2141"}/mac/${process.env.VALET_API_PORT ? `?api=${process.env.VALET_API_PORT}` : ""}#k=${token}`);
await page.waitForSelector("#app:not([hidden]) #thread > *", { timeout: 15000 });
const report = { hashStripped: await page.evaluate(() => location.hash === "") };

if (mode === "look") {
  await shot("rozmowa");
  report.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.keyboard.press("Meta+2");
  await page.waitForSelector("#view-tasks:not([hidden])");
  await shot("zadania");
  await page.click('[data-view="files"]');
  await page.waitForSelector("#view-files:not([hidden])");
  await shot("pliki");
  await page.click('[data-view="memory"]');
  await shot("pamiec");
  await page.click('[data-agent="kurier"]');
  await page.waitForSelector("#preview .av");
  await page.click('[data-state-chip="working"]');
  await shot("agent-kurier");
  report.glide = await page.evaluate(() => getComputedStyle(document.getElementById("glide")).getPropertyValue("--y"));
  await page.click('[data-agent="valet"]');
  await page.waitForSelector("#preview .av-orbita");
  await shot("agent-valet");
  await page.keyboard.press("Meta+,");
  await page.waitForSelector("#dialog:not([hidden]) #limit");
  await shot("ustawienia");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#dialog", { state: "hidden" });
  await page.keyboard.press("Meta+1");
  await page.click("#insp-btn");
  await shot("bez-panelu");
  await page.click("#insp-btn");
  await page.setViewportSize({ width: 900, height: 640 });
  await shot("waskie");
}

if (mode === "cards") {
  await page.waitForFunction(() => [...document.querySelectorAll("#thread .kx img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  report.kinds = await page.evaluate(() => ({ vids: document.querySelectorAll("#thread .kx-vids").length, film: document.querySelectorAll("#thread .kx-film").length, shelf: document.querySelectorAll("#thread .kx-shelf").length, shot: document.querySelectorAll("#thread .kx-shot").length, broken: [...document.querySelectorAll("#thread .kx img")].filter((i) => !i.naturalWidth).map((i) => i.src.slice(0, 80)) }));
  report.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  for (const [cls, name] of [["kx-vids", "karta-youtube"], ["kx-film", "karta-film"], ["kx-shelf", "karta-polka"], ["kx-shot", "karta-obrazek"]]) {
    const node = page.locator(`#thread .${cls}`).last();
    if (!(await node.count())) continue;
    await node.scrollIntoViewIfNeeded();
    await page.evaluate((c) => { const n = [...document.querySelectorAll(`#thread .${c}`)].pop(); n.scrollIntoView({ block: "center" }); }, cls);
    await shot(name);
  }
  if (await page.locator("#thread .kx-shot .kx-frame").count()) {
    await page.locator("#thread .kx-shot .kx-frame").last().click();
    await page.waitForSelector(".kx-light img");
    await shot("obrazek-powiekszony");
    report.lightRatio = await page.evaluate(() => { const r = document.querySelector(".kx-light img").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    await page.keyboard.press("Escape");
    await page.waitForSelector(".kx-light", { state: "detached" });
  }
  await page.click('[data-view="files"]');
  await page.waitForSelector("#view-files:not([hidden])");
  await shot("pliki-obrazki");
}

if (mode === "send") {
  const before = await page.locator("#thread .msg.ag").count();
  await page.fill("#input", process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "Jednym krótkim zdaniem: działa test z Maca?");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#thread .typing", { timeout: 15000 });
  report.stateDuringTurn = await page.getAttribute("#puck", "data-state");
  report.heroDuringTurn = await page.textContent("#hero-status");
  await shot("tura");
  await page.waitForFunction((n) => document.querySelectorAll("#thread .msg.ag").length > n, before, { timeout: 90000 });
  report.reply = await page.locator("#thread .msg.ag").last().innerText();
  report.pending = await page.locator("#thread .msg.pending").count();
  report.typingLeft = await page.locator("#thread .typing").count();
  await shot("po-odpowiedzi");
}

report.errors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close();
