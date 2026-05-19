# MagicMirror v2

A smart mirror running on a Raspberry Pi with a 1080×1920 portrait touchscreen. Apple/iOS-inspired dark UI served by a Python FastAPI backend over WebSocket.

---

## Features

- **DateTime** — clock with optional seconds display per layout
- **Weather** — current conditions, hourly strip, 7-day forecast (OpenWeatherMap)
- **Calendar** — upcoming Google Calendar events with color-coded borders
- **Hue** — Philips Hue room controls: toggle, brightness, color temp, full color, scenes
- **News** — rolling headline ticker with source badges (NewsAPI)
- **Red Alert** — real-time rocket alert overlay (Israel-specific, pikud-haoref.co.il)
- **Settings page** at `/settings` — form-based config editor + drag-and-drop layout editor
- **Control panel** at `http://<pi-ip>:8001` — iPhone-optimized remote control (HTTP, no cert required)

---

## Hardware

| Part | Spec |
|------|------|
| Computer | Raspberry Pi 4 (4 GB) |
| Display | 1080×1920 portrait monitor |
| Touch | IR touch frame |
| Mirror | Two-way mirror glass |
| Lights | Philips Hue bulbs (optional) |

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure widgets

Edit the YAML files in `config/`:

| File | Purpose |
|------|---------|
| `config/weather.yaml` | OpenWeatherMap API key, city, units |
| `config/calendar.yaml` | Google Calendar IDs, colors, Hebrew toggle |
| `config/hue.yaml` | Philips Hue bridge IP, rooms/scenes |
| `config/news.yaml` | NewsAPI key, country, category |
| `config/redalert.yaml` | Poll interval, enabled flag |
| `config/layout.yaml` | CSS grid position for each widget per template |
| `config/display.yaml` | Screen dimensions, ring light config, ports |

### 3. One-time Google Calendar auth

```bash
python setup_calendar.py
```

Opens a browser for OAuth. Credentials are saved to `config/token.json`.

### 4. One-time Philips Hue pairing

Press the link button on the Hue bridge, then:

```bash
curl -X POST http://localhost:8000/api/hue/pair
```

### 5. Copy fonts

```bash
cp "Magic Mirror/Assets/fonts/"*.ttf static/fonts/
cp "Magic Mirror/Assets/fonts/"*.otf static/fonts/
```

---

## Running

```bash
# Development (hot reload, HTTP only)
uvicorn server.main:app --reload --port 8000

# Production (kiosk mode, HTTPS)
bash scripts/start.sh
```

### Pi autostart

Add to `~/.config/lxsession/LXDE-pi/autostart`:

```
@/home/pi/MagicMirror\(v2\)/scripts/start.sh
```

---

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 8000 | HTTPS | Mirror display + full API (requires cert trust) |
| 8001 | HTTP | Control panel (iPhone-friendly, no cert needed) |
| 8080 | HTTP | Cert download + redirect to HTTPS |

Ports are configurable in `config/display.yaml`:

```yaml
port: 8000
http_port: 8080
control_port: 8001
```

---

## Control panel (iPhone)

Open `http://<pi-ip>:8001` in Safari. No certificate required.

The control panel provides:
- **Dashboard** — service status, quick actions (refresh, reload, restart, shutdown), layout switcher
- **Logs** — live server logs with filter, all entries from startup
- **Setup** — iPhone HTTPS trust guide, server info

### iPhone HTTPS trust (for the mirror itself)

If you want to view the mirror at `https://<pi-ip>:8000` on iPhone without a browser warning:

1. Open `http://<pi-ip>:8080/cert.crt` in Safari → tap **Allow**
2. Go to **Settings → General → VPN & Device Management** → tap *MagicMirror* → **Install**
3. Go to **Settings → General → About → Certificate Trust Settings** → enable *MagicMirror*

The Setup tab in the control panel shows the exact URL and step-by-step instructions.

---

## Architecture

```
server/main.py          — FastAPI app (HTTPS :8000) + control FastAPI app (HTTP :8001)
server/ws_manager.py    — broadcast helper (shared between both servers)
server/log_capture.py   — captures stdout/stderr into a rolling buffer
server/services/
  weather.py            — OpenWeatherMap (rate-limited cache)
  calendar.py           — Google Calendar OAuth (runs in thread pool)
  hue.py                — Philips Hue CLIP v2 (HTTPS, polling)
  news.py               — NewsAPI headlines
  redalert.py           — Pikud HaOref live alerts

scripts/
  start.sh              — launch server + Chromium kiosk (Linux)
  start.bat             — launch server + browser (Windows)
  setup_pi.sh           — one-time Pi setup (autostart, HDMI, alias)
  generate_certs.sh     — generate self-signed TLS certificate
  build.sh              — concatenate CSS/JS into bundles

static/
  index.html            — mirror shell
  control.html          — iPhone control panel
  sw.js                 — Service Worker for offline caching
  js/app.js             — mirror: widget instances, REST bootstrap, WS dispatch
  js/ws.js              — WebSocket client with exponential-backoff reconnect
  js/control.js         — control panel logic (status, actions, logs)
  js/widgets/           — one class per widget (skeleton → render pattern)

config/                 — YAML config files (edit here, never in code)
```

### Data flow

```
Server starts (HTTPS :8000, HTTP control :8001)
  └─ Each service: initialize() → first fetch → stores in _cache

Browser connects via WebSocket
  └─ Client first fetches config + widget data via REST (no WS dependency)
  └─ WS then provides live updates

Background loops
  └─ Each service polls on its own interval
  └─ Broadcasts {type, data} to ALL connected WebSocket clients
     (both mirror and control panel share the same ws_manager)
```

---

## Layout system

Widgets are positioned via `config/layout.yaml` using CSS grid coordinates on a **12-column × 24-row** grid (each row = 80px, total 1920px tall).

```yaml
current: default          # which template loads on startup
templates:
  default:
    widgets:
      datetime:  { row: "1 / 4",   column: "1 / 13" }
      weather:   { row: "4 / 13",  column: "1 / 13" }
      calendar:  { row: "13 / 20", column: "1 / 13" }
      hue:       { row: "20 / 25", column: "1 / 13" }
      news:      { row: "24 / 25", column: "1 / 13" }
```

Use `row: "1 / 1"` to hide a widget in a given template.

The visual editor at `/settings → Layout Editor` lets you drag and resize widgets. The **Make Default** button sets which template loads on startup.

---

## Settings page

Navigate to `https://<pi-ip>:8000/settings` in any browser (or `http://localhost:8000/settings` on the Pi).

- **General** — screen dimensions, ring light, layout defaults
- **Widgets** — edit YAML config for each widget (API keys, refresh intervals, etc.)
- **Layout Editor** — drag-and-drop grid editor; add/rename/delete templates, set default
- **System** — server info, iPhone cert trust guide, hard reload

Config is read/written via `GET/POST /api/config/{widget}`.

---

## API reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config/{widget}` | GET | Read widget YAML config as JSON |
| `/api/config/{widget}` | POST | Write widget YAML config |
| `/api/data/weather` | GET | Cached weather data |
| `/api/data/calendar` | GET | Cached calendar data |
| `/api/data/hue` | GET | Cached Hue state |
| `/api/data/news` | GET | Cached news headlines |
| `/api/status` | GET | Service health (which have cached data) |
| `/api/logs` | GET | Rolling log buffer from startup |
| `/api/refresh` | POST | Force-refresh all services |
| `/api/hard-reload` | POST | Broadcast hard_reload to all mirror clients |
| `/api/reboot` | POST | Restart the server process |
| `/api/shutdown` | POST | Shut down the Pi (`sudo shutdown -h now`) |
| `/api/system/info` | GET | IP, port, uptime |
| `WS /ws` | — | WebSocket stream (config, widget data, logs) |

---

## Adding a new widget

See [`ADDING_WIDGETS.md`](ADDING_WIDGETS.md) for a step-by-step guide.

---

## Design language

The UI follows Apple/iOS design principles:

- Pure black background (`#000`)
- SF Pro Display typeface (English) + Rubik (Hebrew/RTL)
- Frosted glass control bar (`backdrop-filter: blur(24px)`, `rgba(28,28,30,0.82)`)
- Opacity hierarchy: primary 0.9 → secondary 0.55 → tertiary 0.28 → separator 0.08
- No borders, no drop shadows on content — only on floating controls
