#!/bin/bash
# Keeps the iPhone app alive past the 7 days a free signing profile lasts: when under 3 days remain and the phone is in reach and unlocked, it asks for a fresh profile, rebuilds and reinstalls. Usage: ios/refresh.sh [--force]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APP="$ROOT/.build/ios/Build/Products/Release-iphoneos/Valet.app"
DIR="$HOME/.valet-ios"
mkdir -p "$DIR"
say() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$DIR/refresh.log"; }

hours_left() {
  local until
  until="$(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null | plutil -extract ExpirationDate raw - 2>/dev/null)" || true
  [ -n "$until" ] || { echo 0; return; }
  python3 -I -c "import sys, datetime as d; end = d.datetime.strptime(sys.argv[1], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=d.timezone.utc); print(max(0, int((end - d.datetime.now(d.timezone.utc)).total_seconds() // 3600)))" "$until"
}

phone() {
  local list
  list="$(mktemp)"
  xcrun devicectl list devices --json-output "$list" >/dev/null 2>&1 || true
  python3 -I -c "import json,sys; d=json.load(open(sys.argv[1]))['result']['devices']; print(next((x['hardwareProperties']['udid'] for x in d if x.get('hardwareProperties',{}).get('deviceType')=='iPhone' and x.get('connectionProperties',{}).get('pairingState')=='paired'), ''))" "$list" 2>/dev/null
  rm -f "$list"
}

LEFT="$(hours_left)"
if [ "${1:-}" != "--force" ] && [ "$LEFT" -gt 72 ]; then exit 0; fi
UDID="$(phone)"
if [ -z "$UDID" ] || ! xcrun devicectl device info details --device "$UDID" --timeout 25 >/dev/null 2>&1; then
  say "phone not in reach, $LEFT h left on the profile"
  exit 0
fi
STATE="$(mktemp)"
xcrun devicectl device info lockState --device "$UDID" --json-output "$STATE" >/dev/null 2>&1 || true
LOCKED="$(python3 -I -c "import json,sys; print('yes' if json.load(open(sys.argv[1])).get('result',{}).get('passcodeRequired', True) else 'no')" "$STATE" 2>/dev/null || echo yes)"
rm -f "$STATE"
if [ "$LOCKED" = "yes" ]; then
  say "phone locked, $LEFT h left on the profile"
  exit 0
fi
for store in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
  [ -d "$store" ] || continue
  for file in "$store"/*.mobileprovision; do
    [ -f "$file" ] || continue
    if security cms -D -i "$file" 2>/dev/null | grep -q "fun.gzowo.valet.ios"; then rm -f "$file"; fi
  done
done
if "$HERE/build.sh" device >> "$DIR/refresh.log" 2>&1; then say "renewed, $(hours_left) h left on the profile"; else say "renewal failed, $LEFT h left on the profile"; exit 1; fi
