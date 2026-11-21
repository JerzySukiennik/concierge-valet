/* Builds and signs the three iOS shortcuts that talk to the agent's hook: "Valet" (ask or dictate, hear the answer), "Wyślij do Valeta" (share a link or text) and "Zdjęcie do Valeta" (share a photo). Run with --prod for the live agent; the files hold the hook token, so they stay out of git. */
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const prod = process.argv.includes("--prod");
const { sign } = await import(join(here, "../worker/src/util.mjs"));
const access = readFileSync(join(here, `../worker/${prod ? ".prod.vars" : ".dev.vars"}`), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const token = `hk_${await sign(access, "hook|1")}`;
const hook = `${prod ? "https://concierge-valet-api.kalakasanyt.workers.dev" : "http://127.0.0.1:8790"}/api/hook`;
const out = join(here, "skroty");
mkdirSync(out, { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function xml(v) {
  if (typeof v === "string") return `<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number") return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
  if (Array.isArray(v)) return `<array>${v.map(xml).join("")}</array>`;
  return `<dict>${Object.entries(v).map(([k, x]) => `<key>${esc(k)}</key>${xml(x)}`).join("")}</dict>`;
}

const id = () => randomUUID().toUpperCase();
const text = (s) => ({ Value: { string: s }, WFSerializationType: "WFTextTokenString" });
const output = (uuid, name) => ({ Type: "ActionOutput", OutputName: name, OutputUUID: uuid });
const INPUT = { Type: "ExtensionInput" };
const token1 = (attachment) => ({ Value: { string: "￼", attachmentsByRange: { "{0, 1}": attachment } }, WFSerializationType: "WFTextTokenString" });
const attach = (attachment) => ({ Value: attachment, WFSerializationType: "WFTextTokenAttachment" });
const fields = (items) => ({ Value: { WFDictionaryFieldValueItems: items }, WFSerializationType: "WFDictionaryFieldValue" });
const field = (key, value, type = 0) => ({ WFItemType: type, WFKey: text(key), WFValue: value });
const action = (name, params) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${name}`, WFWorkflowActionParameters: params });
const post = (uuid, body) => action("downloadurl", { UUID: uuid, WFURL: hook, WFHTTPMethod: "POST", ShowHeaders: true, WFHTTPHeaders: fields([field("Authorization", text(`Bearer ${token}`))]), ...body });
const reply = (from) => { const pick = id(); return [action("getvalueforkey", { UUID: pick, WFDictionaryKey: "reply", WFInput: attach(output(from, "Contents of URL")) }), pick]; };

function shortcut({ actions, share = [], glyph, color }) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${xml({
    WFWorkflowClientVersion: "2607.0.2",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: share.length > 0,
    WFWorkflowIcon: { WFWorkflowIconStartColor: color, WFWorkflowIconGlyphNumber: glyph },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: share,
    WFWorkflowOutputContentItemClasses: [],
    WFQuickActionSurfaces: [],
    WFWorkflowTypes: share.length ? ["ActionExtension"] : [],
    WFWorkflowActions: actions,
  })}</plist>\n`;
}

const made = {};
{
  const ask = id(), call = id(), [pick, picked] = reply(call);
  made.Valet = shortcut({
    glyph: 59446,
    color: 4251333119,
    actions: [
      action("ask", { UUID: ask, WFAskActionPrompt: "Co przekazać Valetowi?", WFInputType: "Text" }),
      post(call, { WFHTTPBodyType: "JSON", WFJSONValues: fields([field("text", token1(output(ask, "Provided Input"))), field("wait", text("1"))]) }),
      pick,
      action("showresult", { Text: token1(output(picked, "Dictionary Value")) }),
    ],
  });
}
{
  const call = id(), [pick, picked] = reply(call);
  made["Wyślij do Valeta"] = shortcut({
    glyph: 59771,
    color: 4251333119,
    share: ["WFURLContentItem", "WFStringContentItem", "WFSafariWebPageContentItem", "WFArticleContentItem", "WFRichTextContentItem"],
    actions: [
      post(call, { WFHTTPBodyType: "JSON", WFJSONValues: fields([field("text", token1(INPUT)), field("wait", text("0"))]) }),
      pick,
      action("notification", { WFNotificationActionTitle: "Valet", WFNotificationActionBody: token1(output(picked, "Dictionary Value")), WFNotificationActionSound: false }),
    ],
  });
}
{
  const jpeg = id(), call = id(), [pick, picked] = reply(call);
  made["Zdjęcie do Valeta"] = shortcut({
    glyph: 59651,
    color: 4251333119,
    share: ["WFImageContentItem", "WFPhotoMediaContentItem"],
    actions: [
      action("image.convert", { UUID: jpeg, WFImageFormat: "JPEG", WFImageCompressionQuality: 0.7, WFImagePreserveMetadata: false, WFInput: attach(INPUT) }),
      post(call, { WFHTTPBodyType: "Form", WFFormValues: fields([field("file", { Value: attach(output(jpeg, "Converted Image")), WFSerializationType: "WFTokenAttachmentParameterState" }, 5), field("wait", text("0"))]) }),
      pick,
      action("notification", { WFNotificationActionTitle: "Valet", WFNotificationActionBody: token1(output(picked, "Dictionary Value")), WFNotificationActionSound: false }),
    ],
  });
}

for (const [name, body] of Object.entries(made)) {
  const raw = join(out, `${name}.unsigned.shortcut`), done = join(out, `${name}.shortcut`);
  rmSync(done, { force: true });
  writeFileSync(raw, body);
  let problem = "";
  for (let attempt = 0; attempt < 3 && !existsSync(done); attempt++) {
    try { execFileSync("/usr/bin/shortcuts", ["sign", "--mode", "anyone", "--input", raw, "--output", done], { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }); } catch (err) { problem = String(err.stderr || err.message).trim().split("\n").filter((l) => !/ERROR: Unrecognized attribute string flag/.test(l)).slice(-2).join(" ").slice(0, 300); }
  }
  console.log(existsSync(done) ? `signed: ${name}` : `NOT signed: ${name}: ${problem}`);
  if (!process.env.KEEP) rmSync(raw, { force: true });
}
if (process.argv.includes("--send")) {
  const base = hook.replace(/\/api\/hook$/, ""), call = async (path, body) => { const res = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error(`${path} ${res.status}`); return res.json(); };
  const files = [];
  for (const name of Object.keys(made).filter((n) => existsSync(join(out, `${n}.shortcut`)))) files.push((await call("/api/upload", { name: `${name}.shortcut`, mime: "application/x-apple-shortcut", data: readFileSync(join(out, `${name}.shortcut`)).toString("base64") })).file);
  await call("/api/note", { text: "Skróty do dodania na telefonie. Stuknij każdy plik i wybierz otwarcie w Skrótach.", files });
  console.log(`sent to the thread: ${files.length} files`);
}
console.log(`target: ${hook}`);
