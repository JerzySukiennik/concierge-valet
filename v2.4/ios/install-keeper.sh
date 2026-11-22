#!/bin/zsh
# Installs the keeper of the iPhone app on this Mac: a copy of the app's sources in ~/.valet-ios/src and a background job that runs ios/refresh.sh every three hours, so the app is renewed before its 7-day profile runs out.
set -e
cd "$(dirname "$0")"
DIR="$HOME/.valet-ios"
LABEL="fun.gzowo.valet.ios.keeper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$DIR/src/ios" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
rsync -a --delete --exclude Valet.xcodeproj --exclude Info.plist ./ "$DIR/src/ios/"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/src/ios/refresh.sh</string></array>
  <key>StartInterval</key><integer>10800</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>LowPriorityIO</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>$DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$DIR/launchd.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "keeper installed: $PLIST"
