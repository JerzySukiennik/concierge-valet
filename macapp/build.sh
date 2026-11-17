#!/bin/zsh
# Concierge Valet for macOS: builds the app from the Swift shell and the bundled desktop interface, installs it to /Applications and stores the pairing key from worker/.prod.vars.
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
APP="build/Concierge Valet.app"
ARCH="$(uname -m)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
swiftc -O -swift-version 5 -target "$ARCH-apple-macosx14.0" Sources/*.swift -o "$APP/Contents/MacOS/ConciergeValet"
cp Info.plist "$APP/Contents/Info.plist"
cp -R "$ROOT/mac" "$ROOT/avatar.js" "$ROOT/avatar.css" "$ROOT/icons" "$APP/Contents/Resources/web/"
if [ -x "$CHROME" ]; then
  nice -n 10 "$CHROME" --headless=new --hide-scrollbars --disable-gpu --default-background-color=00000000 --force-device-scale-factor=1 --window-size=1024,1024 --screenshot="$PWD/build/icon-1024.png" "file://$PWD/icon.html" >/dev/null 2>&1 || true
fi
if [ -f build/icon-1024.png ]; then
  mkdir -p build/AppIcon.iconset
  for s in 16 32 128 256 512; do
    sips -z $s $s build/icon-1024.png --out "build/AppIcon.iconset/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) build/icon-1024.png --out "build/AppIcon.iconset/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
fi
SIGN_ID="$(security find-identity -p codesigning 2>/dev/null | grep -o '"[^"]*Local Signing"' | head -1 | tr -d '"')"
codesign -s "${SIGN_ID:--}" --force --deep --identifier fun.gzowo.valet "$APP"
if [ "${NO_INSTALL:-}" != "" ]; then echo "built: $PWD/$APP"; exit 0; fi
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
pkill -x ConciergeValet 2>/dev/null || true
sleep 0.5
rm -rf "$DEST/Concierge Valet.app"
ditto "$APP" "$DEST/Concierge Valet.app"
if [ -f "$ROOT/worker/.prod.vars" ]; then
  defaults write fun.gzowo.valet token "$(grep '^ACCESS_TOKEN=' "$ROOT/worker/.prod.vars" | cut -d= -f2)"
fi
echo "installed: $DEST/Concierge Valet.app"
