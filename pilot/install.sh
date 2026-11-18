#!/bin/zsh
# Concierge Valet pilot: installs the hub as a background service of this Mac. Code goes to ~/.valet-pilot/app, the socket and the log stay in ~/.valet-pilot, and the service talks to the production agent.
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIR="$HOME/.valet-pilot"
NODE="$(command -v node)"
LABEL="fun.gzowo.valet.pilot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
[ -x "$NODE" ] || { echo "node not found"; exit 1; }
mkdir -p "$DIR/app" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
cp hub.mjs "$DIR/app/hub.mjs"
PY="$(command -v python3 || true)"
if [ -x "$PY" ]; then
  [ -x "$DIR/venv/bin/pip" ] || "$PY" -m venv "$DIR/venv"
  "$DIR/venv/bin/pip" install -q -U yt-dlp || echo "yt-dlp not updated"
fi
( umask 077; grep '^ACCESS_TOKEN=' "$ROOT/worker/.prod.vars" | cut -d= -f2 > "$DIR/token" )
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/app/hub.mjs</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DIR/hub.log</string>
  <key>StandardErrorPath</key><string>$DIR/hub.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $LABEL"
