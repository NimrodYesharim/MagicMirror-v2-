#!/bin/bash
# Restart the mirror (server + kiosk Chromium) — safe to run over SSH.
# Usage: bash scripts/restart.sh
#        MIRROR_DEBUG=1 bash scripts/restart.sh   # + Chromium DevTools on 127.0.0.1:9222 (profiling)
cd "$(dirname "$0")/.." || exit 1

# Stop by PID so this script's own command line can never match a kill pattern.
# start.sh first: its uvicorn loop would otherwise respawn the server we're about to kill.
# No $PPID guard — when /api/restart-kiosk runs this, the parent is the uvicorn to stop.
for pat in 'scripts/start.sh' 'uvicorn server.main' 'chromium-browser'; do
  for pid in $(pgrep -f "$pat"); do
    [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null
  done
done
sleep 2

# Drop only the service worker (older versions served cached JS after updates).
# The rest of the profile stays: it holds the GPU shader cache, which saves ~0.3 s
# of shader compiling the first time each kind of popup is drawn.
rm -rf "$HOME/.cache/mirror-kiosk/Default/Service Worker" /tmp/kiosk-profile

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export PATH="$HOME/.local/bin:$PATH"   # uvicorn is a user install on the Pi
setsid nohup bash scripts/start.sh > /tmp/mirror-start.log 2>&1 < /dev/null &
echo "Mirror restarting (log: /tmp/mirror-start.log)"
