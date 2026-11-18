/* Phone UI check: drives the redesigned app at phone size in real Chrome with touch, in light, dark, narrow and reduced motion, saves screenshots and asserts behavior. */
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || join(here, "../../Flop/node_modules/playwright-core/index.mjs"));
const token = readFileSync(join(here, "../worker/.dev.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const out = join(here, "shots/phone");
mkdirSync(out, { recursive: true });
const modes = (process.argv[2] || "light,dark,narrow,flows").split(",");
const ORIGIN = "http://localhost:2141";

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu-vsync"] });
const report = {};
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(extra ? `${name}: ${JSON.stringify(extra)}` : name); return ok; };

async function open(opts = {}, path = "/") {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: opts.dark ? "dark" : "light", reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  if (opts.route) await opts.route(page);
  if (opts.paired !== false) await page.goto(`${ORIGIN}${path}#k=${token}`);
  else await page.goto(`${ORIGIN}${path}`);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errors, cdp };
}

const settle = (page, ms = 700) => page.waitForTimeout(ms);
const shot = async (page, name, ms = 650) => { await settle(page, ms); await page.screenshot({ path: join(out, `${name}.png`) }); };
const frame = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });

async function touch(cdp, page, pts, { hold = 0, step = 16 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  if (hold) await page.waitForTimeout(hold);
  for (const [x, y] of pts.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(step);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const line = (x0, y0, x1, y1, n = 14) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

async function ready(page) {
  await page.waitForSelector("#app:not([hidden]):not(.booting) #thread .msg", { timeout: 15000, state: "attached" });
  await settle(page, 900);
}

async function overflow(page, label) {
  const r = await page.evaluate(() => {
    const bad = [];
    for (const s of document.querySelectorAll(".view:not([hidden]), .page-body, #app")) if (s.scrollWidth > s.clientWidth + 1) bad.push(`${s.id || s.className} ${s.scrollWidth}>${s.clientWidth}`);
    if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`document ${document.documentElement.scrollWidth}`);
    return bad;
  });
  check(`no horizontal overflow (${label})`, !r.length, r);
}

async function sheetState(page) {
  return page.evaluate(() => ({ hidden: document.getElementById("sheet").hidden, pages: [...document.querySelectorAll("#pages .page")].map((p) => p.querySelector(".nav h1").textContent), behind: document.body.classList.contains("behind") }));
}

async function tour(tag, opts) {
  const { ctx, page, errors, cdp } = await open(opts);
  await ready(page);
  const W = opts.viewport?.width || 390;
  await shot(page, `${tag}-01-czat`);
  await overflow(page, `${tag} chat`);

  await page.evaluate(() => { const v = document.getElementById("view-chat"), sky = document.querySelector("#thread .sky"); v.scrollTop = sky ? sky.offsetTop - 160 : Math.max(0, v.scrollHeight - v.clientHeight - 1400); });
  await settle(page, 400);
  check(`${tag} jump button appears when scrolled up`, await page.evaluate(() => document.getElementById("jump").classList.contains("on")));
  await shot(page, `${tag}-02-czat-pogoda-jump`);
  await page.tap("#jump");
  await settle(page, 2500);
  check(`${tag} jump returns to latest`, await page.evaluate(() => { const v = document.getElementById("view-chat"); return v.scrollHeight - v.scrollTop - v.clientHeight < 4; }));

  await page.tap("#input");
  await page.fill("#input", "pierwsza linia\ndruga linia\ntrzecia linia");
  await settle(page, 300);
  const grown = await page.evaluate(() => ({ h: document.getElementById("input").offsetHeight, send: !document.getElementById("send").disabled, bottom: (() => { const v = document.getElementById("view-chat"); return v.scrollHeight - v.scrollTop - v.clientHeight < 4; })() }));
  check(`${tag} composer grows and keeps thread at bottom`, grown.h > 70 && grown.send && grown.bottom, grown);
  await shot(page, `${tag}-02b-kompozytor`, 300);
  await page.fill("#input", "");
  await page.evaluate(() => document.getElementById("input").blur());
  await settle(page, 300);
  check(`${tag} composer shrinks back`, await page.evaluate(() => document.getElementById("input").offsetHeight <= 42 && document.getElementById("send").disabled));
  await page.tap("#thread .msg.ag >> nth=-1");
  check(`${tag} tap reveals time`, await page.evaluate(() => !!document.querySelector("#thread .msg.timed")));
  await shot(page, `${tag}-03-czas`, 500);

  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
  await page.tap('[data-tab="tasks"]');
  await page.waitForTimeout(200);
  await frame(page, `${tag}-04a-zadania-w-ruchu`);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await shot(page, `${tag}-04-zadania`);
  await overflow(page, `${tag} tasks`);
  await page.tap('[data-tab="make"]');
  await shot(page, `${tag}-05-tworz`);
  await overflow(page, `${tag} make`);
  await page.tap('[data-tab="chat"]');
  await settle(page, 500);

  await page.tap("#agents-btn");
  await page.waitForTimeout(110);
  await frame(page, `${tag}-06a-arkusz-w-ruchu`);
  await shot(page, `${tag}-06-agenci`);
  check(`${tag} agents sheet open`, (await sheetState(page)).pages.join() === "Agenci");
  await page.tap('[data-agent-open="kurier"]');
  await page.waitForTimeout(120);
  await frame(page, `${tag}-07a-push-w-ruchu`);
  await shot(page, `${tag}-07-kurier`);
  check(`${tag} configurator hidden until asked`, (await page.locator("#pix, #preview").count()) === 0);
  await page.tap("[data-edit-avatar]");
  await page.waitForSelector("#pix");
  await shot(page, `${tag}-08-edytor`);
  await page.tap('[data-state-chip="working"]');
  await page.evaluate(() => { const b = document.querySelector(".page:last-child .page-body"); b.scrollTop = 520; });
  await shot(page, `${tag}-09-edytor-piksele`);
  check(`${tag} preview pinned while scrolling`, await page.evaluate(() => { const p = document.getElementById("preview").getBoundingClientRect(), b = document.querySelector(".page:last-child .page-body").getBoundingClientRect(); return p.top >= b.top - 1 && p.top < b.top + 30; }));
  report[`${tag}PixelCells`] = await page.locator("#pix i").count();
  await overflow(page, `${tag} editor`);
  await page.tap(".page:last-child [data-back]");
  await settle(page, 900);
  await page.tap(".page:last-child [data-back]");
  await settle(page, 900);
  check(`${tag} back to list`, (await sheetState(page)).pages.join() === "Agenci");
  await page.tap(".page:last-child [data-close]");
  await settle(page, 800);
  check(`${tag} sheet closed by Gotowe`, (await sheetState(page)).hidden);

  await page.tap("#me-btn");
  await shot(page, `${tag}-10-ustawienia`);
  await overflow(page, `${tag} settings`);
  await page.evaluate(() => { const b = document.querySelector(".page-body"); b.scrollTop = 560; });
  await shot(page, `${tag}-11-ustawienia-dol`);
  await page.evaluate(() => { const b = document.querySelector(".page-body"); b.scrollTop = b.scrollHeight; });
  await shot(page, `${tag}-12-ustawienia-koniec`);
  await page.mouse.click(W / 2, 12);
  await settle(page, 1500);
  check(`${tag} backdrop tap closes`, (await sheetState(page)).hidden);

  report[`${tag}Errors`] = errors;
  check(`${tag} zero console errors`, !errors.length, errors);
  await ctx.close();
}

async function flows() {
  const { ctx, page, errors, cdp } = await open({});
  await ready(page);

  await page.tap("#agents-btn");
  await settle(page, 700);
  const h = await page.evaluate(() => document.querySelector("#sheet .nav").getBoundingClientRect().top + 20);
  await touch(cdp, page, line(195, h, 195, h + 70, 6), { step: 30 });
  await settle(page, 800);
  check("slow short drag springs back", !(await sheetState(page)).hidden);
  const mid = [];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: h }] });
  for (const [x, y] of line(195, h, 195, h + 200, 10)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await page.waitForTimeout(12); }
  mid.push(await page.evaluate(() => document.getElementById("sheet").style.transform));
  await frame(page, "flow-01-przeciaganie");
  for (const [x, y] of line(195, h + 200, 195, h + 320, 6)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); await page.waitForTimeout(10); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await settle(page, 900);
  report.dragTransform = mid[0];
  check("finger tracks 1:1 while dragging", /translate3d\(0px, (19\d|20\d|18\d)(\.\d+)?px/.test(mid[0]), mid[0]);
  check("fast drag down dismisses", (await sheetState(page)).hidden);

  await page.tap("#agents-btn");
  await settle(page, 700);
  await touch(cdp, page, line(195, h, 195, h - 160, 8), { step: 20 });
  await settle(page, 900);
  check("rubber band past top returns to open", await page.evaluate(() => /translate3d\(0px, 0(\.0+)?px/.test(document.getElementById("sheet").style.transform)));

  await page.tap('[data-agent-open="atelier"]');
  await settle(page, 700);
  await touch(cdp, page, line(6, 420, 330, 430, 12), { step: 16 });
  await settle(page, 800);
  check("edge swipe goes back", (await sheetState(page)).pages.join() === "Agenci", await sheetState(page));
  await page.tap('[data-agent-open="valet"]');
  await settle(page, 600);
  await page.tap("[data-edit-avatar]");
  await page.waitForSelector("#preview .av");
  await page.tap('[data-type="buzka"]');
  await page.tap('[data-k-set="mouth"][data-v="smile"]');
  await shot(page, "flow-02-edytor-buzka");
  await page.tap("#e-save");
  await page.waitForFunction(() => document.querySelector("#puck .av")?.classList.contains("av-buzka"), null, { timeout: 8000 });
  await settle(page, 800);
  check("save pops back to detail", (await sheetState(page)).pages.length === 2);
  await shot(page, "flow-03-po-zapisie");
  await page.tap("[data-edit-avatar]");
  await page.waitForSelector("#preview .av");
  await page.tap('[data-type="orbita"]');
  await page.tap("#e-save");
  await page.waitForFunction(() => document.querySelector("#puck .av")?.classList.contains("av-orbita"), null, { timeout: 8000 });
  await page.tap(".page:last-child [data-close]");
  await settle(page, 700);

  await page.touchscreen.tap(1, 1);
  const bubble = await page.evaluate(() => { const r = [...document.querySelectorAll("#thread .msg.ag")].at(-1).getBoundingClientRect(); return [r.left + 40, r.top + 16]; });
  await touch(cdp, page, [bubble], { hold: 750 });
  await settle(page, 500);
  check("long press opens menu", await page.evaluate(() => !document.getElementById("ctx").hidden));
  await frame(page, "flow-04-menu");
  await page.tap("[data-copy]");
  await page.waitForTimeout(250);
  await frame(page, "flow-05-skopiowane");
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check("Kopiuj copies message text", clip.length > 20, clip.slice(0, 40));
  await settle(page, 500);

  await page.evaluate(() => { document.getElementById("view-chat").scrollTop = 0; });
  await settle(page, 300);
  const q = page.locator("#thread .quote").first();
  if (await q.count()) {
    await page.evaluate(() => { const qq = document.querySelector("#thread .quote"); if (qq) qq.scrollIntoView({ block: "center" }); });
    await settle(page, 300);
    await q.tap();
    await page.waitForTimeout(500);
    check("quote jumps and flashes the original", await page.evaluate(() => !!document.querySelector("#thread .flash")));
    await frame(page, "flow-06-cytat-blysk");
  }

  await page.tap('[data-tab="tasks"]');
  await settle(page, 600);
  const minus = page.locator("[data-unsched]").first();
  if (await minus.count()) {
    await minus.tap();
    await shot(page, "flow-07-potwierdz-usuniecie", 600);
    check("delete asks for confirmation", await page.evaluate(() => !!document.querySelector(".row.confirm .confirm-box")));
    await page.tap(".confirm-box .ghost");
    await settle(page, 400);
    check("cancel keeps the reminder", await page.evaluate(() => !document.querySelector(".row.confirm") && !!document.querySelector("[data-unsched]")));
    await page.route("**/api/sched/delete", async (route) => {
      const res = await route.fetch({ url: route.request().url().replace("/api/sched/delete", "/api/boot"), method: "GET", postData: null, headers: { authorization: route.request().headers().authorization } });
      const d = await res.json();
      const id = JSON.parse(route.request().postData()).id;
      await route.fulfill({ json: { sched: d.sched.filter((r) => r.id !== id) } });
    });
    const before = await page.locator("#tasks .row.sched").count();
    await minus.tap();
    await settle(page, 400);
    await page.tap(".confirm-box .dark");
    await page.waitForTimeout(230);
    await frame(page, "flow-08-zwijanie");
    await settle(page, 700);
    check("confirmed delete removes the row", (await page.locator("#tasks .row.sched").count()) === before - 1);
    await page.unroute("**/api/sched/delete");
  }

  await page.tap("#me-btn");
  await settle(page, 700);
  const daily = await page.getAttribute("#b-daily", "aria-checked");
  await page.tap('[data-switch="b-daily"]');
  await page.waitForTimeout(160);
  await frame(page, "flow-09-przelacznik");
  await settle(page, 700);
  check("switch toggles", (await page.getAttribute("#b-daily", "aria-checked")) !== daily);
  await page.tap('[data-switch="b-daily"]');
  await settle(page, 700);
  check("switch restored", (await page.getAttribute("#b-daily", "aria-checked")) === daily);
  await page.tap('[data-step="1"]');
  await settle(page, 200);
  report.limitUp = await page.textContent("#limit");
  await page.tap('[data-step="-1"]');
  await settle(page, 900);
  report.limitBack = await page.textContent("#limit");
  check("limit stepper returns", report.limitBack.startsWith("6,00"), report);
  await page.tap("#push-test");
  await settle(page, 1200);
  report.pushNote = await page.textContent("#push-note");
  await page.tap('[data-model-slot="chat"]');
  await shot(page, "flow-10-model", 700);
  check("model picker shows current choice", await page.evaluate(() => document.querySelector(".pick.on strong")?.textContent === "Sonnet 5.5"));
  await page.tap(".page:last-child [data-back]");
  await settle(page, 600);
  const fx = page.locator("[data-fact]").first();
  if (await fx.count()) {
    await fx.scrollIntoViewIfNeeded();
    await fx.tap();
    await shot(page, "flow-11-pamiec-potwierdz", 500);
    await page.tap(".confirm-box .ghost");
    await settle(page, 300);
  }
  await page.tap("#unpair");
  await settle(page, 400);
  check("unpair asks first", await page.evaluate(() => !!document.querySelector("#unpair.confirm")));
  await page.tap("#unpair .confirm-box .ghost");
  await settle(page, 300);
  await page.tap(".page:last-child [data-close]");
  await settle(page, 700);

  await page.tap("#puck");
  await settle(page, 300);
  const pb = await page.evaluate(() => { const r = document.getElementById("puck").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await touch(cdp, page, [pb], { hold: 750 });
  await settle(page, 900);
  check("long press on avatar opens Valet detail", (await sheetState(page)).pages.join() === "Agenci,Valet", await sheetState(page));
  await page.tap(".page:last-child [data-close]");
  await settle(page, 700);

  report.flowErrors = errors;
  check("flows zero console errors", !errors.length, errors);
  await ctx.close();
}

async function older() {
  const route = (page) => page.route("**/api/boot", async (r) => { const res = await r.fetch(); const d = await res.json(); d.msgs = d.msgs.slice(-2); await r.fulfill({ json: d }); });
  const { ctx, page, errors } = await open({ route });
  await ready(page);
  await page.waitForFunction(() => document.querySelectorAll("#thread [data-id]").length > 3, null, { timeout: 8000 }).catch(() => {});
  const n = await page.evaluate(() => document.querySelectorAll("#thread .msg, #thread .card").length);
  report.olderLoaded = n;
  check("older messages load when at the top", n >= 6, n);
  check("older: zero console errors", !errors.length, errors);
  await ctx.close();
}

async function offline() {
  const route = async (page) => { await page.route("**/api/ticket", (r) => r.fulfill({ status: 503, json: { error: "down" } })); };
  const { ctx, page, errors } = await open({ route });
  await ready(page);
  await page.waitForFunction(() => document.getElementById("status-text").textContent === "Łączenie", null, { timeout: 8000 }).catch(() => {});
  check("pill says Łączenie while live link is down", (await page.textContent("#status-text")) === "Łączenie" && (await page.evaluate(() => document.getElementById("status").classList.contains("on"))));
  await shot(page, "stan-laczenie", 400);
  report.offlineErrors = errors.filter((e) => !/503|WebSocket/i.test(e));
  check("offline: zero console errors", !report.offlineErrors.length, report.offlineErrors);
  await ctx.close();
}

async function pairing(dark) {
  const { ctx, page, errors } = await open({ paired: false, dark });
  await page.waitForSelector("#pair:not([hidden])");
  await shot(page, `parowanie${dark ? "-ciemny" : ""}`, 900);
  if (!dark) {
    await page.fill("#pair-key", "zly-klucz-123456789");
    await page.tap("#pair-go");
    await page.waitForFunction(() => document.getElementById("pair-err").textContent.length > 0);
    await shot(page, "parowanie-blad", 500);
    await page.fill("#pair-key", token);
    await page.tap("#pair-go");
    await ready(page);
    check("pairing by typed key works", await page.evaluate(() => localStorage.getItem("valet-token")?.length > 10));
  }
  check(`pairing${dark ? " dark" : ""}: zero console errors`, !errors.filter((e) => !/401/.test(e)).length, errors);
  await ctx.close();
}

async function running() {
  const route = (page) => page.route("**/api/boot", async (r) => { const res = await r.fetch(); const d = await res.json(); d.tasks = d.tasks.map((t, i) => (i ? t : { ...t, status: "running", step: "Składa PDF z planem" })); d.status = { state: "working", text: "Składa PDF z planem" }; await r.fulfill({ json: d }); });
  const { ctx, page, errors } = await open({ route });
  await ready(page);
  await page.evaluate(() => { const c = document.querySelector('#thread [data-task]'); if (c) c.scrollIntoView({ block: "center" }); });
  await shot(page, "zadanie-w-toku-czat", 900);
  await page.tap('[data-tab="tasks"]');
  await shot(page, "zadanie-w-toku-lista", 900);
  check("running card shows progress and cancel", await page.evaluate(() => !!document.querySelector("#tasks .task.running .track .bar") && !!document.querySelector("#tasks [data-cancel]")));
  check("running: zero console errors", !errors.length, errors);
  await ctx.close();
}

async function boot() {
  const route = (page) => page.route("**/api/boot", async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.continue(); });
  const { ctx, page, errors } = await open({ route });
  await page.waitForSelector("#app.booting .skel");
  await shot(page, "start-szkielet", 300);
  await ready(page);
  await ctx.close();
}

async function deep() {
  for (const [path, want] of [["/?tab=tasks", "tasks"], ["/?sheet=agents&agent=atelier", "Agenci,Atelier"], ["/?sheet=settings", "Ustawienia"]]) {
    const { ctx, page, errors } = await open({}, path);
    await ready(page);
    const got = want === "tasks" ? await page.evaluate(() => !document.getElementById("view-tasks").hidden && "tasks") : (await sheetState(page)).pages.join();
    check(`deep link ${path}`, got === want, got);
    check(`deep link ${path} no errors`, !errors.length, errors);
    await ctx.close();
  }
}

async function reduced() {
  const { ctx, page, errors } = await open({ reduced: true });
  await ready(page);
  await page.tap('[data-tab="tasks"]');
  await settle(page, 400);
  await page.tap("#agents-btn");
  await settle(page, 500);
  await page.tap('[data-agent-open="valet"]');
  await shot(page, "ograniczony-ruch", 500);
  check("reduced motion: push still navigates", (await sheetState(page)).pages.length === 2);
  await page.tap(".page:last-child [data-close]");
  await settle(page, 500);
  check("reduced motion: sheet closes", (await sheetState(page)).hidden);
  check("reduced: zero console errors", !errors.length, errors);
  await ctx.close();
}

async function sendOne() {
  const { ctx, page, errors } = await open({});
  await ready(page);
  const before = await page.locator("#thread .msg.ag").count();
  await page.tap("#input");
  await page.fill("#input", process.argv[3] || "Odpowiedz jednym krótkim zdaniem: czy nowy wygląd apki działa?");
  await page.waitForTimeout(500);
  report.sendEnabled = await page.locator("#send").isEnabled();
  await page.tap("#send");
  await page.waitForTimeout(60);
  await frame(page, "send-01-wylot");
  report.focusKept = await page.evaluate(() => document.activeElement?.id === "input");
  check("keyboard focus stays after send", report.focusKept);
  await page.waitForSelector("#thread .typing", { timeout: 20000 });
  await shot(page, "send-02-pisze", 500);
  report.pill = await page.textContent("#status-text");
  await page.waitForFunction((n) => document.querySelectorAll("#thread .msg.ag").length > n, before, { timeout: 90000 });
  await page.waitForTimeout(90);
  await frame(page, "send-03-odpowiedz-w-ruchu");
  await shot(page, "send-04-po-odpowiedzi", 1200);
  report.reply = await page.locator("#thread .msg.ag").last().innerText();
  report.pending = await page.locator("#thread .msg.pending").count();
  check("pending bubble confirmed", report.pending === 0);
  check("send: zero console errors", !errors.length, errors);
  await ctx.close();
}

const t0 = Date.now();
const run = async (name, fn) => { try { await fn(); } catch (e) { fails.push(`${name} crashed: ${String(e.message || e).split("\n")[0]}`); } };
for (const m of modes) {
  if (m === "light") await run("light", () => tour("jasny", {}));
  if (m === "dark") await run("dark", () => tour("ciemny", { dark: true }));
  if (m === "narrow") await run("narrow", () => tour("waski", { viewport: { width: 320, height: 640 } }));
  if (m === "flows") for (const [n, f] of [["flows", flows], ["older", older], ["offline", offline], ["pair", () => pairing(false)], ["pair dark", () => pairing(true)], ["running", running], ["boot", boot], ["deep", deep], ["reduced", reduced]]) await run(n, f);
  if (m === "send") await run("send", sendOne);
}
report.seconds = Math.round((Date.now() - t0) / 1000);
report.fails = fails;
console.log(JSON.stringify(report, null, 1));
setTimeout(() => process.exit(fails.length ? 1 : 0), 3000);
await browser.close();
process.exit(fails.length ? 1 : 0);
