/* Phone check for two things: a WhatsApp draft drawn while the chat is hidden still shows its whole text, and an open app reloads itself once a newer shell is on the server (never while a message is being typed). `--old` runs the draft check against the committed cards.js. */
import { readFileSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(root, "worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const origin = process.env.VALET_APP || "http://localhost:2141";
const old = process.argv.includes("--old");
const report = {};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { report.errors = [...(report.errors || []), String(e)]; });
  return page;
};
const bump = () => { const now = new Date(); utimesSync(join(root, "index.html"), now, now); };

{
  const page = await open();
  if (old) await page.route("**/cards.js", (route) => route.fulfill({ contentType: "text/javascript; charset=utf-8", body: execFileSync("git", ["-C", root, "show", "HEAD:cards.js"]) }));
  await page.route("**/api/boot", async (route) => {
    const response = await route.fetch(), body = await response.json();
    const last = [...body.msgs].reverse().find((m) => m.data?.wa?.to?.length > 1);
    if (last) { last.data.wa.state = "draft"; for (const r of last.data.wa.to) r.state = "draft"; report.draft = last.id; }
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${origin}/?tab=tasks#k=${token}`);
  await page.waitForSelector("#app:not([hidden]) #thread .msg", { state: "attached", timeout: 15000 });
  await page.waitForTimeout(700);
  await page.locator('#tabs [data-tab="chat"]').tap();
  await page.waitForTimeout(900);
  report.field = await page.evaluate(() => {
    const f = [...document.querySelectorAll("#thread .kx-wa .kx-field")].pop();
    if (!f) return null;
    f.scrollIntoView({ block: "center" });
    const head = f.closest(".kx-wa").querySelector(".kx-head em").textContent;
    return { shown: f.clientHeight, needed: f.scrollHeight, whole: f.clientHeight >= f.scrollHeight - 1 && f.scrollHeight > 30, head };
  });
  await page.screenshot({ path: join(here, `shots/phone/szkic-${old ? "stary" : "nowy"}.png`) });
  await page.context().close();
}

if (!old) {
  const page = await open();
  let bumped = false, typed;
  const ready = new Promise((r) => { typed = r; });
  await page.route("**/api/ticket", async (route) => {
    if (!bumped) { bumped = true; await ready; bump(); }
    await route.continue();
  });
  await page.goto(`${origin}/#k=${token}`);
  await page.waitForSelector("#app:not([hidden]) #thread .msg", { timeout: 15000 });
  await page.evaluate(() => { window.__mark = 1; });
  await page.locator("#input").fill("pisze");
  typed();
  await page.waitForTimeout(2500);
  report.keptWhileTyping = await page.evaluate(() => window.__mark === 1 && document.getElementById("input").value === "pisze");
  await page.locator("#input").fill("");
  await page.evaluate(() => { document.activeElement?.blur(); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__mark !== 1, null, { timeout: 8000 }).then(() => { report.reloaded = true; }, () => { report.reloaded = false; });
  await page.waitForSelector("#app:not([hidden]) #thread .msg", { timeout: 15000 });
  await page.evaluate(() => { window.__mark = 2; });
  await page.waitForTimeout(3000);
  report.stableAfter = await page.evaluate(() => window.__mark === 2);
  await page.context().close();
}

console.log(JSON.stringify(report, null, 1));
setTimeout(() => process.exit(0), 3000);
await browser.close();
process.exit(0);
