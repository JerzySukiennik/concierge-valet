/* iCloud calendar over CalDAV: account discovery, events in a range with recurrences expanded, create, change and delete. */
import ICAL from "ical.js";
import { TZ, fromZone } from "./util.mjs";

const ROOT = "https://caldav.icloud.com";
const WARSAW = ["BEGIN:VTIMEZONE", "TZID:Europe/Warsaw", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];

const open = (name) => `<(?:[\\w-]+:)?${name}(?=[\\s/>])[^>]*`;
const inner = (xml, name) => { const m = new RegExp(`${open(name)}>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml || ""); return m ? m[1] : ""; };
const every = (xml, name) => [...(xml || "").matchAll(new RegExp(`${open(name)}>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi"))].map((m) => m[1]);
const has = (xml, name) => new RegExp(`${open(name)}>`, "i").test(xml || "");
const plain = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
const pad = (n) => String(n).padStart(2, "0");

const creds = (env) => ({ user: String(env.ICLOUD_USER || "").trim(), pass: String(env.ICLOUD_PASSWORD || env.ICLOUD_API_KEY || "").trim() });
export const calendarOn = (env) => { const c = creds(env); return !!(c.user && c.pass); };

async function dav(env, method, url, { depth, body, type = "application/xml; charset=utf-8", headers = {} } = {}) {
  const { user, pass } = creds(env);
  if (!user || !pass) throw new Error("the calendar is not connected");
  const res = await fetch(url, { method, body, headers: { authorization: `Basic ${btoa(`${user}:${pass}`)}`, ...(body ? { "content-type": type } : {}), ...(depth === undefined ? {} : { depth: String(depth) }), ...headers } });
  if (res.status === 401 || res.status === 403) throw new Error("iCloud rejected the calendar login");
  return res;
}

export async function discover(env) {
  const first = await dav(env, "PROPFIND", `${ROOT}/`, { depth: 0, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
  const principal = plain(inner(inner(await first.text(), "current-user-principal"), "href"));
  if (!principal) throw new Error("iCloud did not return the calendar account");
  const second = await dav(env, "PROPFIND", new URL(principal, ROOT).href, { depth: 0, body: '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>' });
  const home = plain(inner(inner(await second.text(), "calendar-home-set"), "href"));
  if (!home) throw new Error("iCloud did not return the calendar home");
  const base = new URL(home, ROOT).href;
  const third = await dav(env, "PROPFIND", base, { depth: 1, body: '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>' });
  const list = [];
  for (const r of every(await third.text(), "response")) {
    if (!has(inner(r, "resourcetype"), "calendar") || !/name=["']VEVENT["']/i.test(inner(r, "supported-calendar-component-set"))) continue;
    const rights = inner(r, "current-user-privilege-set");
    const color = plain(inner(r, "calendar-color"));
    list.push({ url: new URL(plain(inner(r, "href")), base).href, name: plain(inner(r, "displayname")) || "Kalendarz", color: /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : "", write: has(rights, "write") || has(rights, "write-content") || has(rights, "all") });
  }
  return list;
}

function when(time, prop) {
  if (time.isDate) return fromZone(time.year, time.month, time.day, 0, 0, TZ);
  const tzid = prop?.getParameter("tzid");
  if (!tzid && time.zone?.tzid === "UTC") return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  return fromZone(time.year, time.month, time.day, time.hour, time.minute, tzid || TZ);
}

function moment(component, name) {
  try {
    const t = component.getFirstPropertyValue(name);
    return t ? t.toJSDate().getTime() : 0;
  } catch (e) {
    return 0;
  }
}

export function expand(ics, from, to) {
  const comp = new ICAL.Component(ICAL.parse(ics));
  const list = comp.getAllSubcomponents("vevent");
  const master = list.find((v) => !v.hasProperty("recurrence-id")) || list[0];
  if (!master) return [];
  const event = new ICAL.Event(master, { exceptions: list.filter((v) => v !== master && v.hasProperty("recurrence-id")) });
  const base = master.getFirstProperty("dtstart");
  if (!base) return [];
  const out = [];
  const add = (item, startTime, endTime, recurring) => {
    if (String(item.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") return;
    const sp = item.component.getFirstProperty("dtstart") || base, allDay = !!startTime.isDate;
    const start = when(startTime, sp);
    let end = endTime ? when(endTime, item.component.getFirstProperty("dtend") || sp) : start;
    if (end < start) end = start;
    if (allDay && end === start) end = start + 86400000;
    if (start >= to || (end <= from && !(end === start && start >= from))) return;
    out.push({ uid: event.uid || "", title: String(item.summary || "").trim() || "Bez tytułu", start, end, allDay, location: String(item.location || "").replace(/\s*\n\s*/g, ", ").trim(), recurring, touched: Math.max(moment(item.component, "created"), moment(item.component, "last-modified")) });
  };
  if (!event.isRecurring()) { add(event, event.startDate, event.endDate, false); return out; }
  const it = event.iterator();
  for (let i = 0, next; i < 6000 && (next = it.next()); i++) {
    if (when(next, base) >= to) break;
    const d = event.getOccurrenceDetails(next);
    add(d.item, d.startDate, d.endDate, true);
  }
  return out;
}

export async function listEvents(env, calendars, from, to) {
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(from)}" end="${stamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const lists = await Promise.all(calendars.map(async (cal) => {
    const res = await dav(env, "REPORT", cal.url, { depth: 1, body });
    if (res.status !== 207) return [];
    const out = [];
    for (const r of every(await res.text(), "response")) {
      const ics = plain(inner(r, "calendar-data"));
      if (!ics) continue;
      const href = new URL(plain(inner(r, "href")), cal.url).href, etag = plain(inner(r, "getetag"));
      try {
        for (const o of expand(ics, from, to)) out.push({ ...o, cal: cal.name, color: cal.color, href, etag });
      } catch (err) {
        console.error("calendar parse", String(err?.message || err));
      }
    }
    return out;
  }));
  return lists.flat().sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => (line.match(/.{1,70}/gu) || [""]).join("\r\n ");
const day = (p) => `${p.y}${pad(p.mo)}${pad(p.d)}`;
const clock = (p) => `${day(p)}T${pad(p.h)}${pad(p.mi)}00`;

export function parts(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(text || ""));
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0) } : null;
}

const nextDay = (p) => { const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: 0, mi: 0 }; };

export async function createEvent(env, cal, e) {
  const uid = crypto.randomUUID().toUpperCase(), href = `${cal.url}${uid}.ics`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Concierge Valet//PL", "CALSCALE:GREGORIAN", ...(e.allDay ? [] : WARSAW), "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp(Date.now())}`, `CREATED:${stamp(Date.now())}`];
  if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(nextDay(e.end))}`);
  else lines.push(`DTSTART;TZID=${TZ}:${clock(e.start)}`, `DTEND;TZID=${TZ}:${clock(e.end)}`);
  lines.push(`SUMMARY:${esc(e.title)}`);
  if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
  if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
  if (e.alert > 0) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", `TRIGGER:-PT${Math.round(e.alert)}M`, "END:VALARM");
  lines.push("END:VEVENT", "END:VCALENDAR");
  const res = await dav(env, "PUT", href, { body: `${lines.map(fold).join("\r\n")}\r\n`, type: "text/calendar; charset=utf-8", headers: { "if-none-match": "*" } });
  if (res.status !== 201 && res.status !== 204) throw new Error(`iCloud refused to save the event (${res.status})`);
  return { href, etag: String(res.headers.get("etag") || "").replace(/^W\//, ""), uid };
}

const strong = (etag) => String(etag || "").replace(/^W\//, "");

async function etagOf(env, href) {
  const res = await dav(env, "PROPFIND", href, { depth: 0, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' });
  return res.status === 207 ? plain(inner(await res.text(), "getetag")) : "";
}

export async function changeEvent(env, ref, patch) {
  const listed = await etagOf(env, ref.href);
  const got = await dav(env, "GET", ref.href);
  if (!got.ok) throw new Error(got.status === 404 ? "that event no longer exists" : `iCloud did not return the event (${got.status})`);
  const etag = listed || strong(got.headers.get("etag")) || ref.etag || "";
  const comp = new ICAL.Component(ICAL.parse(await got.text()));
  const list = comp.getAllSubcomponents("vevent");
  if (list.length !== 1 || list[0].hasProperty("rrule")) throw new Error("repeating events can only be changed in the Calendar app for now");
  const v = list[0];
  if (patch.title) v.updatePropertyWithValue("summary", patch.title);
  if (patch.location !== undefined && patch.location !== null) { if (patch.location) v.updatePropertyWithValue("location", patch.location); else v.removeAllProperties("location"); }
  if (patch.start && patch.end) {
    v.removeAllProperties("duration");
    const set = (name, p, isDate) => {
      v.removeAllProperties(name);
      const prop = new ICAL.Property(name, v);
      if (isDate) prop.resetType("date"); else prop.setParameter("tzid", TZ);
      prop.setValue(ICAL.Time.fromData({ year: p.y, month: p.mo, day: p.d, hour: isDate ? 0 : p.h, minute: isDate ? 0 : p.mi, second: 0, isDate }));
      v.addProperty(prop);
    };
    set("dtstart", patch.start, !!patch.allDay);
    set("dtend", patch.allDay ? nextDay(patch.end) : patch.end, !!patch.allDay);
    if (!patch.allDay && !comp.getAllSubcomponents("vtimezone").some((z) => z.getFirstPropertyValue("tzid") === TZ)) comp.addSubcomponent(new ICAL.Component(ICAL.parse(WARSAW.join("\r\n"))));
  }
  v.updatePropertyWithValue("sequence", (+v.getFirstPropertyValue("sequence") || 0) + 1);
  v.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(), true));
  const res = await dav(env, "PUT", ref.href, { body: comp.toString(), type: "text/calendar; charset=utf-8", headers: etag ? { "if-match": etag } : {} });
  if (res.status === 412) throw new Error("the event changed in the meantime; list the calendar again");
  if (res.status !== 201 && res.status !== 204) throw new Error(`iCloud refused to save the change (${res.status})`);
  return { etag: strong(res.headers.get("etag")) };
}

export async function removeEvent(env, ref) {
  const res = await dav(env, "DELETE", ref.href);
  if (res.status === 404) return false;
  if (res.status !== 204 && res.status !== 200) throw new Error(`iCloud refused to delete the event (${res.status})`);
  return true;
}
