#!/bin/bash
# One-time Pi setup: autostart on boot + 4am daily reboot + desktop shortcut
# Run once: bash setup_pi.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Autostart on boot ─────────────────────────────────────────────────────
AUTOSTART_DIR="$HOME/.config/lxsession/LXDE-pi"
AUTOSTART_FILE="$AUTOSTART_DIR/autostart"

mkdir -p "$AUTOSTART_DIR"

if grep -qF "start.sh" "$AUTOSTART_FILE" 2>/dev/null; then
  echo "[autostart] Already configured — skipping."
else
  echo "@$SCRIPT_DIR/start.sh" >> "$AUTOSTART_FILE"
  echo "[autostart] Added: @$SCRIPT_DIR/start.sh"
fi

# ── 2. 4am daily system reboot (fresh state every morning) ──────────────────
CRON_TAG="# MagicMirror-reboot"
if crontab -l 2>/dev/null | grep -q "MagicMirror-reboot"; then
  echo "[cron] 4am reboot already configured — skipping."
else
  (crontab -l 2>/dev/null; echo "$CRON_TAG"; echo "0 4 * * * sudo /sbin/reboot") | crontab -
  echo "[cron] Added: daily reboot at 04:00"
fi

# ── 3. Desktop shortcut ──────────────────────────────────────────────────────
DESKTOP_DIR="$HOME/Desktop"
mkdir -p "$DESKTOP_DIR"

cat > "$DESKTOP_DIR/MagicMirror.desktop" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=MagicMirror
Comment=Start MagicMirror kiosk
Exec=$SCRIPT_DIR/start.sh
Terminal=false
Categories=Utility;
EOF
chmod +x "$DESKTOP_DIR/MagicMirror.desktop"
echo "[desktop] Created: $DESKTOP_DIR/MagicMirror.desktop"

# ── 4. Ensure /dev/shm is large enough for Chromium ─────────────────────────
# Pi defaults to 64MB — Chromium needs at least 256MB
SHM_LINE="tmpfs /dev/shm tmpfs defaults,noexec,nosuid,size=256m 0 0"
if grep -q "^tmpfs /dev/shm" /etc/fstab 2>/dev/null; then
  echo "[fstab] /dev/shm entry already exists — verify size is >=256m manually."
else
  echo "$SHM_LINE" | sudo tee -a /etc/fstab > /dev/null
  echo "[fstab] Set /dev/shm to 256MB (takes effect after reboot)"
fi

echo ""
echo "Setup complete!"
echo "  • MagicMirror starts automatically on boot"
echo "  • System reboots daily at 04:00 AM"
echo "  • Desktop shortcut: ~/Desktop/MagicMirror.desktop"
echo ""
echo "Reboot to apply all changes:  sudo reboot"
