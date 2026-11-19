/* concierge-valet-api: the cloud brain of Concierge Valet. Routes authenticated requests to the Valet thread and serves signed file links. */
import { client } from "./agent.mjs";
import { json, same, sign } from "./util.mjs";

export { Valet } from "./valet.mjs";
export { Task } from "./task.mjs";

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(env, origin) {
  const ok = origin === env.APP_ORIGIN || LOCAL.test(origin || "");
  return {
    "access-control-allow-origin": ok ? origin : env.APP_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function withCors(res, env, origin) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(env, origin))) out.headers.set(k, v);
  return out;
}

async function file(req, env, url) {
  const [, , id, name] = url.pathname.split("/");
  const e = +url.searchParams.get("e"), mime = url.searchParams.get("m") || "application/octet-stream";
  if (!id || !e || e < Date.now() || !same(url.searchParams.get("s"), await sign(env.ACCESS_TOKEN, `${id}|${e}|${mime}`))) return new Response("Ten link wygasł. Otwórz plik jeszcze raz z aplikacji.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  const own = /^(img|up)_/.test(id);
  const res = own ? await env.VALET.get(env.VALET.idFromName("main")).fetch(`https://valet/internal/blob?id=${encodeURIComponent(id)}`) : await client(env).files.download(id);
  if (own && !res.ok) return new Response("Nie ma już takiego pliku.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const headers = { "content-type": mime, "content-disposition": `${mime === "application/x-apple-shortcut" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(decodeURIComponent(name || "plik"))}`, "cache-control": own ? "private, max-age=21600, immutable" : "private, max-age=600", "x-content-type-options": "nosniff" };
  if (/html|svg|xml/.test(mime)) headers["content-security-policy"] = "sandbox allow-scripts";
  return new Response(res.body, { headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get("origin") || "";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, origin) });
    if (!env.ACCESS_TOKEN) return json({ error: "server not configured" }, 500);
    try {
      if (url.pathname.startsWith("/f/")) return await file(req, env, url);
      if (url.pathname === "/api/ping") return withCors(json({ ok: true }), env, origin);
      if (!url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
      const valet = env.VALET.get(env.VALET.idFromName("main"));
      if (url.pathname === "/api/ws" || url.pathname === "/api/bridge") {
        const [e, s] = String(url.searchParams.get("k") || "").split(".");
        if (!+e || +e < Date.now() || !same(s, await sign(env.ACCESS_TOKEN, `ws|${e}`))) return json({ error: "unauthorized" }, 401);
        return valet.fetch(req);
      }
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (url.pathname === "/api/hook") {
        if (req.method !== "POST" || !same(token, `hk_${await sign(env.ACCESS_TOKEN, "hook|1")}`)) return json({ error: "unauthorized" }, 401);
        return valet.fetch(req);
      }
      if (!same(token, env.ACCESS_TOKEN)) return withCors(json({ error: "unauthorized" }, 401), env, origin);
      return withCors(await valet.fetch(req), env, origin);
    } catch (err) {
      console.error("request", String(err?.stack || err));
      return withCors(json({ error: "server error" }, 500), env, origin);
    }
  },
};
