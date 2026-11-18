/* Connectors to outside services: YouTube search, TMDB films and series, OpenRouter image generation. */
const IMAGE_MODEL = "openai/gpt-image-2.6-flare";
const TMDB = "https://api.themoviedb.org/3";
const ASPECTS = { "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "1:1": 1, "3:4": 3 / 4, "2:3": 2 / 3, "9:16": 9 / 16 };

const key = (env, name) => String(env[`${name}_API_KEYS`] || env[`${name}_API_KEY`] || "").split(",")[0].trim();

async function getJson(url, init, what) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const why = data?.error?.message || data?.status_message || "";
    throw new Error(`${what} returned ${res.status}${why ? `: ${String(why).slice(0, 160)}` : ""}`);
  }
  return data;
}

function seconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}

export function clockOf(total) {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export async function youtube(env, { query, order = "relevance", count = 5 }) {
  const k = key(env, "YOUTUBE");
  if (!k) throw new Error("YouTube is not connected: the API key is missing");
  const search = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(count), q: query, order: order === "views" ? "viewCount" : order, relevanceLanguage: "pl", regionCode: "PL", safeSearch: "moderate", key: k });
  const found = await getJson(`https://www.googleapis.com/youtube/v3/search?${search}`, undefined, "YouTube");
  const ids = (found.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const more = await getJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: "snippet,contentDetails,statistics", id: ids.join(","), key: k })}`, undefined, "YouTube");
  const byId = new Map((more.items || []).map((v) => [v.id, v]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    published: Date.parse(v.snippet.publishedAt) || 0,
    seconds: seconds(v.contentDetails?.duration),
    views: +v.statistics?.viewCount || 0,
    live: v.snippet.liveBroadcastContent === "live",
  }));
}

async function tmdb(env, path, params = {}) {
  const k = key(env, "TMDB");
  if (!k) throw new Error("TMDB is not connected: the API key is missing");
  const bearer = k.length > 40;
  const q = new URLSearchParams({ language: "pl-PL", ...params, ...(bearer ? {} : { api_key: k }) });
  return getJson(`${TMDB}/${path}?${q}`, bearer ? { headers: { authorization: `Bearer ${k}` } } : undefined, "TMDB");
}

const brief = (r, type) => ({
  type,
  id: r.id,
  name: r.title || r.name || "",
  year: +String(r.release_date || r.first_air_date || "").slice(0, 4) || null,
  rating: r.vote_count ? Math.round(r.vote_average * 10) / 10 : null,
  poster: r.poster_path || null,
});

const screen = (r) => r.media_type === "movie" || r.media_type === "tv";

export async function findTitles(env, { query, type = "any", year = 0 }) {
  const extra = year && type === "movie" ? { year: String(year) } : year && type === "tv" ? { first_air_date_year: String(year) } : {};
  const d = await tmdb(env, type === "any" ? "search/multi" : `search/${type}`, { query, include_adult: "false", ...extra });
  const list = (d.results || []).filter((r) => type !== "any" || screen(r)).map((r) => brief(r, type === "any" ? r.media_type : type));
  if (year && type === "any") list.sort((a, b) => (b.year === year) - (a.year === year));
  return list;
}

function trailer(videos) {
  const list = (videos?.results || []).filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
  const score = (v) => (v.type === "Trailer" ? 4 : 0) + (v.iso_639_1 === "pl" ? 2 : 0) + (v.official ? 1 : 0);
  list.sort((a, b) => score(b) - score(a));
  return list[0]?.key || null;
}

function providers(d) {
  const pl = d["watch/providers"]?.results?.PL;
  if (!pl) return null;
  const pick = (list) => (list || []).slice(0, 6).map((p) => ({ name: p.provider_name, logo: p.logo_path || null }));
  const out = { stream: pick(pl.flatrate), free: pick([...(pl.free || []), ...(pl.ads || [])]), rent: pick(pl.rent), buy: pick(pl.buy), link: pl.link || null };
  return out.stream.length || out.free.length || out.rent.length || out.buy.length ? out : null;
}

export async function title(env, type, id) {
  const d = await tmdb(env, `${type}/${id}`, { append_to_response: "watch/providers,credits,videos", include_video_language: "pl,en" });
  let overview = d.overview || "";
  if (!overview) overview = (await tmdb(env, `${type}/${id}`, { language: "en-US" }).catch(() => null))?.overview || "";
  const movie = type === "movie";
  const makers = movie ? (d.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name) : (d.created_by || []).map((c) => c.name);
  return {
    ...brief(d, type),
    original: (d.original_title || d.original_name || "") !== (d.title || d.name) ? d.original_title || d.original_name : null,
    votes: d.vote_count || 0,
    tagline: d.tagline || "",
    overview,
    genres: (d.genres || []).map((g) => g.name).slice(0, 3),
    runtime: movie ? d.runtime || null : null,
    seasons: movie ? null : d.number_of_seasons || null,
    episodes: movie ? null : d.number_of_episodes || null,
    ended: movie ? null : d.status === "Ended" || d.status === "Canceled",
    lastYear: movie ? null : +String(d.last_air_date || "").slice(0, 4) || null,
    backdrop: d.backdrop_path || null,
    makers: makers.slice(0, 2),
    cast: (d.credits?.cast || []).slice(0, 4).map((c) => c.name),
    trailer: trailer(d.videos),
    watch: providers(d),
    page: `https://www.themoviedb.org/${type}/${d.id}`,
  };
}

export async function titleList(env, { list, query, type }) {
  if (list === "trending") {
    const d = await tmdb(env, `trending/${type === "any" ? "all" : type}/week`);
    return { label: "Popularne w tym tygodniu", titles: (d.results || []).filter((r) => type !== "any" || screen(r)).map((r) => brief(r, type === "any" ? r.media_type : type)) };
  }
  if (list === "in_cinemas") {
    const d = await tmdb(env, "movie/now_playing", { region: "PL" });
    return { label: "Teraz w kinach", titles: (d.results || []).map((r) => brief(r, "movie")) };
  }
  const found = await findTitles(env, { query, type });
  if (list === "similar") {
    const base = found[0];
    if (!base) return { label: "", titles: [] };
    const d = await tmdb(env, `${base.type}/${base.id}/recommendations`);
    return { label: `Podobne do: ${base.name}`, titles: (d.results || []).map((r) => brief(r, base.type)) };
  }
  return { label: `Wyniki: ${query}`, titles: found };
}

function decode(b64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(b64);
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function dimensions(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return { w: 0, h: 0 };
}

export async function image(env, { prompt, aspect = "16:9", quality = "low" }) {
  const k = key(env, "OPENROUTER");
  if (!k) throw new Error("image generation is not connected: the API key is missing");
  const ratio = ASPECTS[aspect] ? aspect : "16:9";
  const d = await getJson("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, quality, aspect_ratio: ratio, output_format: "jpeg", output_compression: 88 }),
  }, "the image service");
  const item = d?.data?.[0];
  if (!item?.b64_json) throw new Error("the image service returned no image");
  const bytes = decode(item.b64_json);
  let { w, h } = dimensions(bytes);
  if (!w || !h) { w = 1600; h = Math.round(1600 / ASPECTS[ratio]); }
  const mime = item.media_type || "image/jpeg";
  return { bytes, mime, ext: mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg", w, h, usd: +d.usage?.cost || 0.016 };
}
