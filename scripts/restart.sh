#!/bin/bash
# Restart the mirror (server + kiosk Chromium) — safe to run over SSH.
# Usage: bash scripts/restart.sh
cd "$(dirname "$0")/.." || exit 1

# Stop by PID so this script's own command line can never match a kill pattern
for pat in 'uvicorn server.main' 'chromium-browser' 'bash scripts/start.sh'; do
  for pid in $(pgrep -f "$pat"); do
    [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill "$pid" 2>/dev/null
  done
done
sleep 2

# Fresh browser profile: drops the service-worker cache so new JS/CSS load
rm -rf /tmp/kiosk-profile

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export PATH="$HOME/.local/bin:$PATH"   # uvicorn is a user install on the Pi
setsid nohup bash scripts/start.sh > /tmp/mirror-start.log 2>&1 < /dev/null &
echo "Mirror restarting (log: /tmp/mirror-start.log)"
