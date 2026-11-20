/* Local store of the WhatsApp link: chats, names and messages in SQLite, with the lookups the cloud agent asks for. */
import { DatabaseSync } from "node:sqlite";

const HIDDEN = /[‎‏‪-‮⁦-⁩]/g;
const clean = (s) => String(s || "").replace(HIDDEN, "").trim();
const fold = (s) => clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
const userOf = (jid) => String(jid || "").split("@")[0].split(":")[0];

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS chats (jid TEXT PRIMARY KEY, name TEXT, grp INTEGER DEFAULT 0, last INTEGER DEFAULT 0, unread INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS names (jid TEXT PRIMARY KEY, name TEXT, strong INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS alias (lid TEXT PRIMARY KEY, pn TEXT)");
  db.exec("CREATE TABLE IF NOT EXISTS msgs (chat TEXT, id TEXT, ts INTEGER, sender TEXT, me INTEGER, text TEXT, PRIMARY KEY (chat, id))");
  db.exec("CREATE INDEX IF NOT EXISTS msgs_time ON msgs (chat, ts)");
  if (!db.prepare("SELECT name FROM pragma_table_info('msgs') WHERE name = 'status'").get()) db.exec("ALTER TABLE msgs ADD COLUMN status INTEGER DEFAULT 0");

  const q = (sql) => db.prepare(sql);
  const aliasOf = q("SELECT pn FROM alias WHERE lid = ?");
  const own = { pn: "", lid: "" };

  const canon = (jid) => {
    if (!jid) return "";
    if (!jid.endsWith("@lid")) return jid;
    return aliasOf.get(jid)?.pn || jid;
  };

  function link(lid, pn) {
    if (!lid || !pn || !lid.endsWith("@lid") || aliasOf.get(lid)?.pn === pn) return;
    q("INSERT INTO alias (lid, pn) VALUES (?, ?) ON CONFLICT(lid) DO UPDATE SET pn = excluded.pn").run(lid, pn);
    q("UPDATE OR IGNORE msgs SET chat = ? WHERE chat = ?").run(pn, lid);
    q("DELETE FROM msgs WHERE chat = ?").run(lid);
    q("UPDATE OR IGNORE msgs SET sender = ? WHERE sender = ?").run(pn, lid);
    const old = q("SELECT * FROM chats WHERE jid = ?").get(lid);
    if (old) {
      touch(pn, { name: old.name, last: old.last, unread: old.unread });
      q("DELETE FROM chats WHERE jid = ?").run(lid);
    }
    const name = q("SELECT * FROM names WHERE jid = ?").get(lid);
    if (name) { setName(pn, name.name, !!name.strong); q("DELETE FROM names WHERE jid = ?").run(lid); }
  }

  function setName(jid, name, strong = false) {
    const text = clean(name);
    jid = canon(jid);
    if (!jid || !text) return;
    const cur = q("SELECT strong FROM names WHERE jid = ?").get(jid);
    if (cur && cur.strong && !strong) return;
    q("INSERT INTO names (jid, name, strong) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name, strong = excluded.strong").run(jid, text, strong ? 1 : 0);
  }

  function touch(jid, { name, last, unread, group } = {}) {
    jid = canon(jid);
    if (!jid) return;
    q("INSERT OR IGNORE INTO chats (jid, grp) VALUES (?, ?)").run(jid, jid.endsWith("@g.us") || group ? 1 : 0);
    if (clean(name)) q("UPDATE chats SET name = ? WHERE jid = ?").run(clean(name), jid);
    if (last) q("UPDATE chats SET last = max(last, ?) WHERE jid = ?").run(Math.round(last), jid);
    if (unread !== undefined && unread !== null) q("UPDATE chats SET unread = ? WHERE jid = ?").run(Math.max(0, +unread || 0), jid);
  }

  function addMessage({ chat, id, ts, sender, me, text, incoming = false }) {
    chat = canon(chat);
    if (!chat || !id || !text) return false;
    const fresh = q("INSERT OR IGNORE INTO msgs (chat, id, ts, sender, me, text) VALUES (?, ?, ?, ?, ?, ?)").run(chat, id, Math.round(ts), canon(sender) || "", me ? 1 : 0, String(text).slice(0, 4000)).changes > 0;
    touch(chat, { last: ts });
    if (fresh && incoming) q("UPDATE chats SET unread = unread + 1 WHERE jid = ?").run(chat);
    return fresh;
  }

  const isOwn = (jid) => !!jid && (jid === own.pn || jid === own.lid);

  function chatName(row) {
    if (isOwn(row.jid)) return "You";
    if (row.grp) return row.name || "Grupa bez nazwy";
    return q("SELECT name FROM names WHERE jid = ?").get(row.jid)?.name || row.name || (row.jid.endsWith("@s.whatsapp.net") ? `+${userOf(row.jid)}` : "Nieznany kontakt");
  }

  function senderName(jid, chat) {
    if (!jid) return chat.grp ? "ktoś" : chatName(chat);
    if (isOwn(jid)) return "Jurek";
    return q("SELECT name FROM names WHERE jid = ?").get(jid)?.name || (jid.endsWith("@s.whatsapp.net") ? `+${userOf(jid)}` : "ktoś");
  }

  function list() {
    return q("SELECT * FROM chats WHERE jid LIKE '%@g.us' OR jid LIKE '%@s.whatsapp.net' OR jid LIKE '%@lid' ORDER BY last DESC").all().map((row) => ({ ...row, title: chatName(row) }));
  }

  function chats(query, limit) {
    const want = fold(query);
    return list().filter((c) => c.last > 0 && (!want || fold(c.title).includes(want))).slice(0, limit).map((c) => ({ name: c.title, group: !!c.grp, last: c.last, unread: c.unread }));
  }

  function find(text) {
    const want = fold(text);
    if (!want) return { candidates: [] };
    const all = list();
    const exact = all.filter((c) => fold(c.title) === want);
    const found = exact.length ? exact : all.filter((c) => fold(c.title).includes(want));
    if (found.length === 1) return { chat: found[0] };
    return { candidates: [...new Set(found.map((c) => c.title))].slice(0, 8) };
  }

  function read(text, since, limit) {
    const hit = find(text);
    if (!hit.chat) return { candidates: hit.candidates };
    const chat = hit.chat;
    const rows = q("SELECT * FROM msgs WHERE chat = ? AND ts >= ? ORDER BY ts DESC LIMIT ?").all(chat.jid, Math.round(since), limit).reverse();
    return { chat: chat.title, group: !!chat.grp, messages: rows.map((r) => ({ id: r.id, ts: r.ts, from: r.me ? "Jurek" : senderName(r.sender, chat), me: !!r.me, text: r.text })) };
  }

  function sent(text, body, since) {
    const hit = find(text), start = clean(body).slice(0, 80);
    if (!hit.chat || !start) return null;
    const row = q("SELECT ts, text FROM msgs WHERE chat = ? AND me = 1 AND ts >= ? ORDER BY ts DESC LIMIT 30").all(hit.chat.jid, Math.round(since)).find((r) => clean(r.text).startsWith(start));
    return row ? row.ts : null;
  }

  function fresh(watch, since) {
    const wanted = watch.map(fold).filter(Boolean);
    if (!wanted.length) return [];
    const out = [];
    for (const chat of list().filter((c) => wanted.some((w) => fold(c.title).startsWith(w)))) {
      for (const r of q("SELECT * FROM msgs WHERE chat = ? AND me = 0 AND ts >= ? ORDER BY ts LIMIT 60").all(chat.jid, Math.round(since))) out.push({ id: r.id, chat: chat.title, group: !!chat.grp, ts: r.ts, from: senderName(r.sender, chat), text: r.text });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  function describe(jid, sender) {
    const row = q("SELECT * FROM chats WHERE jid = ?").get(canon(jid));
    if (!row) return null;
    return { chat: chatName(row), group: !!row.grp, from: senderName(canon(sender), row) };
  }

  const ack = (chat, id, status) => { q("UPDATE msgs SET status = max(status, ?) WHERE chat = ? AND id = ?").run(status, canon(chat), id); };
  const acked = (chat, id) => (q("SELECT status FROM msgs WHERE chat = ? AND id = ?").get(canon(chat), id)?.status || 0) >= 2;
  const textById = (chat, id) => q("SELECT text FROM msgs WHERE chat = ? AND id = ?").get(canon(chat), id)?.text || "";
  const counts = () => ({ chats: q("SELECT count(*) AS n FROM chats").get().n, messages: q("SELECT count(*) AS n FROM msgs").get().n, newest: q("SELECT max(ts) AS t FROM msgs").get().t || 0 });
  const setOwn = (pn, lid) => { own.pn = pn || ""; own.lid = lid || ""; if (pn && lid) link(lid, pn); if (pn) touch(pn, {}); };

  return { canon, link, setName, touch, addMessage, ack, acked, chats, find, read, sent, fresh, describe, textById, counts, setOwn, own };
}
