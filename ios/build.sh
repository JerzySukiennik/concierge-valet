#!/bin/bash
# Concierge Valet for iPhone: generates the Xcode project and builds it. Usage: ios/build.sh mac|sim|build|install|device
# mac = Catalyst build for checks on this Mac, sim = simulator build, build = signed iPhone build, install = copy the last build to the paired iPhone, device = both.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MODE="${1:-mac}"
DERIVED="$ROOT/.build/ios"
APP="$DERIVED/Build/Products/Release-iphoneos/Valet.app"
cd "$HERE"
mkdir -p Local
if [ -f "$ROOT/worker/.prod.vars" ]; then
  /usr/libexec/PlistBuddy -c "Clear dict" Local/Pairing.plist >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Add :token string $(grep '^ACCESS_TOKEN=' "$ROOT/worker/.prod.vars" | cut -d= -f2)" Local/Pairing.plist >/dev/null
fi
xcodegen generate --quiet

find_phone() {
  local list
  list="$(mktemp)"
  xcrun devicectl list devices --json-output "$list" >/dev/null 2>&1 || true
  python3 -I -c "import json,sys; d=json.load(open(sys.argv[1]))['result']['devices']; print(next((x['hardwareProperties']['udid'] for x in d if x.get('hardwareProperties',{}).get('deviceType')=='iPhone' and x.get('connectionProperties',{}).get('pairingState')=='paired'), ''))" "$list"
  rm -f "$list"
}

build_phone() {
  local team
  team="$(security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject -nameopt multiline | awk -F'= ' '/organizationalUnitName/{print $2}')"
  nice -n 10 xcodebuild -project Valet.xcodeproj -scheme Valet -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" -allowProvisioningUpdates DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic \
    CURRENT_PROJECT_VERSION="$(git -C "$ROOT" rev-list --count HEAD)" -jobs 2 -quiet build
  echo "$APP"
}

install_phone() {
  local udid
  udid="$(find_phone)"
  if [ -z "$udid" ]; then echo "No paired iPhone in reach: unlock it on the same Wi-Fi or plug it in" >&2; exit 1; fi
  xcrun devicectl device install app --device "$udid" "$APP"
  echo "installed on $udid"
}

case "$MODE" in
  mac)
    nice -n 10 xcodebuild -project Valet.xcodeproj -scheme Valet -configuration Debug \
      -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath "$DERIVED" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual \
      DEVELOPMENT_TEAM= -jobs 2 -quiet build
    echo "$DERIVED/Build/Products/Debug-maccatalyst/Valet.app"
    ;;
  sim)
    nice -n 10 xcodebuild -project Valet.xcodeproj -scheme Valet -configuration Debug \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" CODE_SIGNING_ALLOWED=NO -jobs 2 -quiet build
    echo "$DERIVED/Build/Products/Debug-iphonesimulator/Valet.app"
    ;;
  build) build_phone ;;
  install) install_phone ;;
  device) build_phone; install_phone ;;
  *) echo "Usage: ios/build.sh mac|sim|build|install|device" >&2; exit 1 ;;
esac
