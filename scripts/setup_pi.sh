#!/bin/bash
# One-time Pi setup: autostart on boot + 4am daily reboot + desktop shortcut
# Run once: bash scripts/setup_pi.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
START_SCRIPT="$SCRIPT_DIR/start.sh"

# ── 1. Autostart on boot ─────────────────────────────────────────────────────
# Pi OS Bookworm switched from LXDE to Wayfire/labwc — the old LXDE-only
# method no longer works. We set up ALL methods so it works on any version.

# 1a. XDG autostart (works on most desktop environments)
XDG_AUTO_DIR="$HOME/.config/autostart"
mkdir -p "$XDG_AUTO_DIR"
cat > "$XDG_AUTO_DIR/magicmirror.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=MagicMirror
Exec=bash $START_SCRIPT
X-GNOME-Autostart-enabled=true
EOF
echo "[autostart] XDG autostart entry created"

# 1b. labwc autostart (Pi OS Bookworm with labwc compositor)
LABWC_DIR="$HOME/.config/labwc"
if [ -d "$LABWC_DIR" ] || command -v labwc &>/dev/null; then
  mkdir -p "$LABWC_DIR"
  LABWC_FILE="$LABWC_DIR/autostart"
  if grep -qF "start.sh" "$LABWC_FILE" 2>/dev/null; then
    echo "[autostart] labwc already configured — skipping."
  else
    echo "bash $START_SCRIPT &" >> "$LABWC_FILE"
    echo "[autostart] Added to labwc autostart"
  fi
fi

# 1c. LXDE autostart (legacy Pi OS — Bullseye and older)
LXDE_DIR="$HOME/.config/lxsession/LXDE-pi"
if [ -d "$LXDE_DIR" ] || [ -d "/usr/share/lxsession" ]; then
  mkdir -p "$LXDE_DIR"
  LXDE_FILE="$LXDE_DIR/autostart"
  if grep -qF "start.sh" "$LXDE_FILE" 2>/dev/null; then
    echo "[autostart] LXDE already configured — skipping."
  else
    echo "@$START_SCRIPT" >> "$LXDE_FILE"
    echo "[autostart] Added to LXDE autostart"
  fi
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
Exec=$START_SCRIPT
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

# ── 5. Force HDMI output (fix: display off during boot → no signal) ──────────
# If the display is powered off when the Pi boots, the GPU sees no EDID
# and disables video output. These settings force HDMI on regardless.
BOOT_CFG="/boot/firmware/config.txt"
[ ! -f "$BOOT_CFG" ] && BOOT_CFG="/boot/config.txt"   # older Pi OS path

if grep -q "hdmi_force_hotplug" "$BOOT_CFG" 2>/dev/null; then
  echo "[hdmi] hdmi_force_hotplug already set — skipping."
else
  sudo tee -a "$BOOT_CFG" > /dev/null <<HDMI

# ── MagicMirror: force HDMI even if display is off at boot ──
hdmi_force_hotplug=1
hdmi_group=2
hdmi_mode=82
config_hdmi_boost=4
HDMI
  echo "[hdmi] Added HDMI force-hotplug settings to $BOOT_CFG"
fi

# ── 5b. Force HDMI output on KMS (Pi 4/5 Bookworm/Bullseye) ─────────────────
CMD_LINE="/boot/firmware/cmdline.txt"
[ ! -f "$CMD_LINE" ] && CMD_LINE="/boot/cmdline.txt"

if [ -f "$CMD_LINE" ]; then
  if grep -q "vc4.force_hotplug" "$CMD_LINE" 2>/dev/null; then
    echo "[hdmi-kms] vc4.force_hotplug already set in $CMD_LINE — skipping."
  else
    # Append to the end of the first line without adding a new line
    sudo sed -i '1 s/$/ vc4.force_hotplug=1 video=HDMI-A-1:1920x1080@60D video=HDMI-A-2:1920x1080@60D/' "$CMD_LINE"
    echo "[hdmi-kms] Added vc4.force_hotplug and video modes to $CMD_LINE"
  fi
fi

# ── 6. Shell alias: type "mirror" to start from any terminal ─────────────────
ALIAS_LINE="alias mirror='bash \"$START_SCRIPT\"'"
if grep -qF "alias mirror=" "$HOME/.bashrc" 2>/dev/null; then
  # Update existing alias to current path
  sed -i "s|^alias mirror=.*|$ALIAS_LINE|" "$HOME/.bashrc"
  echo "[alias] Updated 'mirror' alias in ~/.bashrc"
else
  echo "" >> "$HOME/.bashrc"
  echo "# MagicMirror shortcut" >> "$HOME/.bashrc"
  echo "$ALIAS_LINE" >> "$HOME/.bashrc"
  echo "[alias] Added 'mirror' alias to ~/.bashrc"
fi

# ── 7. Color emoji font (Pi OS ships none, so Chromium draws emoji as boxes) ─
if fc-list | grep -qi "Noto Color Emoji"; then
  echo "[emoji] Noto Color Emoji already installed — skipping."
else
  sudo apt-get install -y fonts-noto-color-emoji && fc-cache -f
  echo "[emoji] Installed Noto Color Emoji"
fi

echo ""
echo "Setup complete!"
echo "  • MagicMirror starts automatically on boot"
echo "  • System reboots daily at 04:00 AM"
echo "  • Desktop shortcut: ~/Desktop/MagicMirror.desktop"
echo "  • HDMI forced on (display can be off during boot)"
echo "  • Shell alias: type 'mirror' to start"
echo "  • Color emoji font installed"
echo ""
echo "Reboot to apply all changes:  sudo reboot"
