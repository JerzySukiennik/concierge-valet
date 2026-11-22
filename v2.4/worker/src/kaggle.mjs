/* Kaggle: the owner's recent notebooks, the status of their runs and the tail of a run's log. */
const API = "https://www.kaggle.com/api/v1";

export const kaggleOn = (env) => !!(String(env.KAGGLE_TOKEN || "").trim() && String(env.KAGGLE_USER || "").trim());

async function get(env, path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${String(env.KAGGLE_TOKEN).trim()}` } });
  if (res.status === 401 || res.status === 403) throw new Error("Kaggle rejected the access token");
  if (!res.ok) throw new Error(`Kaggle answered ${res.status}`);
  return res.json();
}

export async function recent(env, count = 8) {
  const list = await get(env, `/kernels/list?user=${encodeURIComponent(env.KAGGLE_USER)}&pageSize=${count}&sortBy=dateRun`);
  return (Array.isArray(list) ? list : []).map((k) => ({ slug: String(k.slug || String(k.ref || "").split("/")[1] || ""), title: String(k.title || k.slug || "").slice(0, 80), ran: Date.parse(k.lastRunTime) || 0, gpu: String(k.enableGpu) === "true" || k.enableGpu === true })).filter((k) => k.slug);
}

export async function status(env, slug) {
  const d = await get(env, `/kernels/status?userName=${encodeURIComponent(env.KAGGLE_USER)}&kernelSlug=${encodeURIComponent(slug)}`);
  return { status: String(d.status || "unknown").toLowerCase(), failure: String(d.failureMessage || "").slice(0, 400) };
}

export async function tail(env, slug, lines = 14) {
  const d = await get(env, `/kernels/output?userName=${encodeURIComponent(env.KAGGLE_USER)}&kernelSlug=${encodeURIComponent(slug)}`);
  let rows = [];
  try { rows = JSON.parse(d.log || "[]"); } catch (e) { rows = String(d.log || "").split("\n").map((data) => ({ data })); }
  const text = rows.map((r) => String(r.data || "").replace(/\s+$/, "")).filter(Boolean);
  return { log: text.slice(-lines).join("\n").slice(-1800), files: (d.files || []).map((f) => String(f.fileName || "")).filter(Boolean).slice(0, 12) };
}
