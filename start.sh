#!/bin/bash
# MagicMirror startup script
# Add to Pi autostart: ~/.config/lxsession/LXDE-pi/autostart
#   @/home/pi/MagicMirror\(v2\)/start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LAN_IP" ] && LAN_IP="127.0.0.1"

# Wait for network (up to 30s) before starting
for i in $(seq 1 15); do
  curl -sf --max-time 2 http://1.1.1.1 >/dev/null 2>&1 && break
  sleep 2
done

# Read port from config (default 8000)
PORT=$(python3 -c "import yaml; d=yaml.safe_load(open('config/display.yaml')); print(d.get('port',8000))" 2>/dev/null || echo 8000)

# ── Auto-generate SSL cert if missing ────────────────────────────────────────
# Required for iPhone/HTTPS-only devices. Run once; cert valid for 10 years.
if [ ! -f config/ssl/cert.pem ] || [ ! -f config/ssl/key.pem ]; then
  echo "No SSL cert found — generating self-signed cert..."
  mkdir -p config/ssl

  openssl req -x509 -newkey rsa:4096 \
    -keyout config/ssl/key.pem \
    -out    config/ssl/cert.pem \
    -days   3650 -nodes \
    -subj   "/CN=magicmirror.local" \
    -addext "subjectAltName=IP:${LAN_IP},IP:127.0.0.1,DNS:localhost" \
    2>/dev/null

  echo "Certificate generated for IP: $LAN_IP"
  echo "To trust on iPhone: open https://$LAN_IP:$PORT/cert.crt in Safari"
fi

# ── Trust cert in Chromium's NSS store (fixes WSS with self-signed cert) ─────
if command -v certutil &>/dev/null; then
  NSS_DB="$HOME/.pki/nssdb"
  mkdir -p "$NSS_DB"
  certutil -N --empty-password -d "sql:$NSS_DB" 2>/dev/null || true
  certutil -D -n "magicmirror" -d "sql:$NSS_DB" 2>/dev/null || true
  certutil -A -n "magicmirror" -t "CT,," -i "config/ssl/cert.pem" -d "sql:$NSS_DB" 2>/dev/null \
    && echo "Cert trusted in Chromium NSS store" \
    || echo "certutil failed — relying on --ignore-certificate-errors"
fi

# ── Start FastAPI over HTTPS (always) ────────────────────────────────────────
uvicorn server.main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --ssl-keyfile config/ssl/key.pem \
  --ssl-certfile config/ssl/cert.pem &
SERVER_PID=$!

echo "Waiting for server on port $PORT..."
until curl -sk "https://localhost:$PORT" > /dev/null; do
  sleep 0.5
done
HTTP_PORT=$(python3 -c "import yaml; d=yaml.safe_load(open('config/display.yaml')); print(d.get('http_port',8080))" 2>/dev/null || echo 8080)
CTRL_PORT=$(python3 -c "import yaml; d=yaml.safe_load(open('config/display.yaml')); print(d.get('control_port',8001))" 2>/dev/null || echo 8001)
echo "Server ready — https://localhost:$PORT"
echo "Control panel (iPhone): http://$LAN_IP:$CTRL_PORT"
echo "To install cert on iPhone: http://$LAN_IP:$HTTP_PORT/cert.crt"

# ── Disable screen blanking ───────────────────────────────────────────────────
export DISPLAY="${DISPLAY:-:0}"
xset s off
xset -dpms
xset s noblank

# ── Launch Chromium in kiosk mode ─────────────────────────────────────────────
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --no-first-run \
  --window-position=0,0 \
  --window-size=1080,1920 \
  --force-device-scale-factor=1 \
  --touch-events=enabled \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --ignore-certificate-errors \
  --allow-insecure-localhost \
  --user-data-dir=/tmp/kiosk-profile \
  "https://localhost:$PORT"

kill $SERVER_PID
