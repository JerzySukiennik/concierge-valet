"""Dev helper: send a message to the local Valet worker and print the thread, tasks and spend."""
import json
import os
import pathlib
import sys
import time
import urllib.request

API = os.environ.get("VALET_API", "http://127.0.0.1:8790")
VARS = pathlib.Path(__file__).resolve().parent.parent / "worker" / ".dev.vars"
TOKEN = next(line.split("=", 1)[1].strip() for line in VARS.read_text().splitlines() if line.startswith("ACCESS_TOKEN="))


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers={"authorization": f"Bearer {TOKEN}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def show(d, since=0):
    for m in d["msgs"]:
        if m["id"] <= since:
            continue
        data = m.get("data") or {}
        extra = ""
        if data.get("files"):
            extra += " files=" + ", ".join(f"{f['name']} ({f['size']} B, {f['mime']})" for f in data["files"])
        if data.get("sources"):
            extra += f" sources={len(data['sources'])}"
        if data.get("sky"):
            extra += f" sky={data['sky']['min']}..{data['sky']['max']} hours={len(data['sky']['hours'])}"
        if data.get("videos"):
            extra += f" videos={len(data['videos'])}"
        if data.get("title"):
            t = data["title"]
            extra += f" title={t['name']} ({t['year']}) {t['type']} watch={bool(t['watch'])} trailer={t['trailer']}"
        if data.get("titles"):
            extra += f" titles={len(data['titles'])}"
        if data.get("image"):
            i = data["image"]
            extra += f" image={i['name']} {i['w']}x{i['h']} {i['size']} B id={i['id']}"
        if m.get("reply_to"):
            extra += f" reply_to={m['reply_to']}"
        print(f"#{m['id']} {m['who']}/{m.get('agent') or '-'} [{m['kind']}]{extra}\n   {m['text']}")
    for t in d["tasks"]:
        print(f"task #{t['id']} {t['status']} step={t['step']!r} agent={t['agent']} usd={t['usd']:.4f} title={t['title']!r}")
    print("spend", {k: round(v, 4) for k, v in d["spend"].items()}, "status", d["status"], "facts", [f["text"] for f in d["facts"]], "sched", len(d["sched"]))


if __name__ == "__main__":
    text = sys.argv[1] if len(sys.argv) > 1 else ""
    wait = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    before = call("/api/boot")
    since = max([m["id"] for m in before["msgs"]] or [0])
    if text:
        call("/api/message", {"text": text})
    deadline = time.time() + wait
    d = before
    while time.time() < deadline:
        time.sleep(2)
        d = call("/api/boot")
        replied = [m for m in d["msgs"] if m["id"] > since and m["who"] != "me"]
        running = [t for t in d["tasks"] if t["status"] == "running"]
        if (replied or not text) and d["status"]["state"] in ("idle", "happy", "error") and not (len(sys.argv) > 3 and running):
            break
    show(d, since if text else 0)
