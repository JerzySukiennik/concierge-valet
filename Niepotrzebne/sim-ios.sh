#!/bin/sh
# Screenshot of the iPhone app in the simulator against the local server. Usage: Niepotrzebne/sim-ios.sh name [OPEN] [JUMP] [light|dark]
# Needs a booted simulator with the sim build installed (ios/build.sh sim) and the local worker on port 8790. OPEN: panel, pending, search, cover, type, tasks, files, memory, reminders, settings. JUMP: a message id. With OPEN=settings, DEEP=agent:valet, editor:kurier or watch opens that screen directly.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/Niepotrzebne/shots/ios"
mkdir -p "$OUT"
xcrun simctl terminate booted fun.gzowo.valet.ios >/dev/null 2>&1
xcrun simctl ui booted appearance "${4:-light}" >/dev/null 2>&1
export SIMCTL_CHILD_VALET_API=http://127.0.0.1:8790
export SIMCTL_CHILD_VALET_TOKEN="$(grep '^ACCESS_TOKEN=' "$ROOT/worker/.dev.vars" | cut -d= -f2)"
[ -n "$2" ] && export SIMCTL_CHILD_VALET_OPEN="$2"
[ -n "$3" ] && export SIMCTL_CHILD_VALET_JUMP="$3"
[ -n "${DEEP:-}" ] && export SIMCTL_CHILD_VALET_DEEP="$DEEP"
xcrun simctl launch booted fun.gzowo.valet.ios >/dev/null
sleep "${WAIT:-20}"
xcrun simctl io booted screenshot "$OUT/$1.png" >/dev/null 2>&1
sips -Z 1300 "$OUT/$1.png" --out "$OUT/$1.png" >/dev/null
echo "$OUT/$1.png"
