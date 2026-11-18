#!/bin/zsh
# Concierge Valet link: installs the WhatsApp link as a background service of this Mac. Code goes to ~/.valet-link/app, the WhatsApp session and the message store stay in ~/.valet-link, and the service talks to the production agent.
set -e
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
DIR="$HOME/.valet-link"
NODE="$(command -v node)"
LABEL="fun.gzowo.valet.link"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
[ -x "$NODE" ] || { echo "node not found"; exit 1; }
[ -d node_modules/baileys ] || npm install --no-audit --no-fund
mkdir -p "$DIR/app" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
rsync -a --delete --exclude install.sh ./ "$DIR/app/"
( umask 077; grep '^ACCESS_TOKEN=' "$ROOT/worker/.prod.vars" | cut -d= -f2 > "$DIR/token" )
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/app/link.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>VALET_LINK_OPEN</key><string>0</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DIR/link.log</string>
  <key>StandardErrorPath</key><string>$DIR/link.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $LABEL"
