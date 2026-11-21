/* Pairing helper: builds a local page with a QR code for the production access key and opens it. The key never leaves this Mac. */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(here, "../worker/.prod.vars"), "utf8").split("\n").find((l) => l.startsWith("ACCESS_TOKEN=")).split("=")[1].trim();
const url = `https://concierge-valet.gzowo.fun/#k=${token}`;
const file = join(tmpdir(), "valet-parowanie.html");

writeFileSync(file, `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Concierge Valet · parowanie</title>
<style>
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8f6f1; color: #1d1c19; font: 16px/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; }
main { text-align: center; max-width: 460px; padding: 32px; }
h1 { font: 500 30px/1.1 ui-serif, "New York", Georgia, serif; margin: 0 0 10px; }
p { color: #7d7a72; margin: 0 0 18px; }
#qr { background: #fff; border: 1px solid #e6e1d6; border-radius: 22px; padding: 18px; display: inline-block; }
#qr svg { display: block; width: 300px; height: 300px; }
.row { display: flex; gap: 10px; justify-content: center; margin-top: 18px; flex-wrap: wrap; }
button, a.btn { font: 600 15px/1 -apple-system, sans-serif; height: 42px; padding: 0 18px; border-radius: 999px; border: 1px solid #c9c3b6; background: transparent; color: #1d1c19; cursor: pointer; text-decoration: none; display: inline-grid; place-items: center; }
a.btn { background: #1f5a46; color: #fff; border-color: #1f5a46; }
small { display: block; margin-top: 18px; color: #7d7a72; }
</style></head>
<body><main>
<h1>Sparuj telefon</h1>
<p>Zeskanuj kod aparatem iPhone'a i otwórz link w Safari. Potem: Udostępnij, „Do ekranu początkowego”, i otwieraj apkę stamtąd.</p>
<div id="qr"></div>
<div class="row"><a class="btn" href="${url}" target="_blank" rel="noopener">Otwórz na tym Macu</a><button id="copy">Kopiuj klucz</button></div>
<small>Ten kod to klucz do Twojego agenta. Nie pokazuj go nikomu i zamknij tę kartę po sparowaniu.</small>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<script>
const qr = qrcode(0, "M");
qr.addData(${JSON.stringify(url)});
qr.make();
document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
document.getElementById("copy").addEventListener("click", async (e) => { await navigator.clipboard.writeText(${JSON.stringify(token)}); e.target.textContent = "Skopiowano"; });
</script>
</body></html>`, { mode: 0o600 });

if (process.argv[2] !== "--no-open") execFileSync("open", [file]);
console.log("pairing page written");
