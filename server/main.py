import asyncio
import json as _json
import yaml
import importlib
import pkgutil
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Query
from fastapi.responses import Response as _Response
import io as _io
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server.ws_manager import WSManager

import time as _time
import uvicorn as _uvicorn
_start_time = _time.time()

import server.log_capture as _log_capture
_log_capture.setup()

ws_manager = WSManager()


async def _http_redirect_server():
    """Plain HTTP server: serves /cert.crt for install, redirects everything else to HTTPS."""
    display = yaml.safe_load(Path("config/display.yaml").read_text(encoding="utf-8")) or {}
    https_port = display.get("port", 8000)
    http_port  = display.get("http_port", 8080)
    cert_path  = Path("config/ssl/cert.pem")

    async def handle(reader, writer):
        try:
            raw = await asyncio.wait_for(reader.read(4096), timeout=5)
            text = raw.decode("utf-8", errors="replace")
            path, host = "/", "localhost"
            for i, line in enumerate(text.split("\r\n")):
                if i == 0:
                    parts = line.split(" ")
                    if len(parts) >= 2:
                        path = parts[1].split("?")[0]
                elif line.lower().startswith("host:"):
                    host = line[5:].strip().split(":")[0]

            if path in ("/cert.crt", "/cert.pem") and cert_path.exists():
                body = cert_path.read_bytes()
                writer.write(
                    f"HTTP/1.1 200 OK\r\nContent-Type: application/x-x509-ca-cert\r\n"
                    f"Content-Disposition: attachment; filename=magicmirror.crt\r\n"
                    f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body
                )
            else:
                location = f"https://{host}:{https_port}{path}"
                writer.write(
                    f"HTTP/1.1 301 Moved Permanently\r\nLocation: {location}\r\n"
                    f"Content-Length: 0\r\nConnection: close\r\n\r\n".encode()
                )
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    try:
        server = await asyncio.start_server(handle, "0.0.0.0", http_port)
        print(f"HTTP server on port {http_port} (cert install + HTTPS redirect)")
        async with server:
            await server.serve_forever()
    except Exception as e:
        print(f"HTTP redirect server failed to start: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.widgets = {}
    base_dir = Path("widgets")
    if base_dir.exists():
        for item in base_dir.iterdir():
            if item.is_dir() and (item / f"{item.name}.py").exists():
                try:
                    mod = importlib.import_module(f"widgets.{item.name}.{item.name}")
                    if hasattr(mod, "register"):
                        print(f"Registering widget: {item.name}")
                        await mod.register(app, ws_manager)
                except Exception as e:
                    print(f"Failed to load widget {item.name}: {e}")

    asyncio.create_task(_http_redirect_server())
    asyncio.create_task(_start_control_server())
    yield


app = FastAPI(lifespan=lifespan, redirect_slashes=False)


@app.get("/")
async def root():
    return RedirectResponse(url="/mirror", status_code=302)


@app.get("/mirror")
async def mirror_page():
    return FileResponse('static/index.html')


@app.get("/api/widgets")
async def list_widgets():
    """Return a list of widget manifest objects sorted by settingsOrder."""
    base_dir = Path("widgets")
    widgets = []
    if base_dir.exists():
        for item in sorted(base_dir.iterdir(), key=lambda p: p.name):
            if item.name.startswith("_") or not item.is_dir():
                continue
            if not (item / f"{item.name}.js").exists():
                continue
            manifest_path = item / "manifest.json"
            if manifest_path.exists():
                try:
                    manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
                except Exception:
                    manifest = {}
            else:
                manifest = {}
            manifest.setdefault("name", item.name)
            manifest.setdefault("label", item.name.capitalize())
            manifest.setdefault("wsType", item.name)
            manifest.setdefault("containerAttrs", {})
            manifest.setdefault("settingsOrder", 999)
            widgets.append(manifest)
    widgets.sort(key=lambda m: (m.get("settingsOrder") or 999, m.get("name", "")))
    return widgets


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        layout  = yaml.safe_load(Path("config/layout.yaml").read_text(encoding='utf-8'))
        display = yaml.safe_load(Path("config/display.yaml").read_text(encoding='utf-8'))
        await ws.send_json({"type": "config", "data": {"layout": layout, "display": display}})

        from server.log_capture import get_log_buffer
        stored = get_log_buffer()
        if stored:
            await ws.send_json({"type": "log_history", "data": stored})

        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        ws_manager.disconnect(ws)


# ── Hue endpoints ─────────────────────────────────────────────────────────────

class PowerBody(BaseModel):      on: bool
class BrightnessBody(BaseModel): brightness: float
class ColorTempBody(BaseModel):  mirek: int
class ColorBody(BaseModel):      hue_deg: float; sat_pct: float


@app.post("/api/hue/pair")
async def hue_pair(request: Request):
    hue = request.app.state.widgets.get("hue")
    return await hue.pair() if hue else {"ok": False}

@app.put("/api/hue/room/{gl_id}/power")
async def hue_power(gl_id: str, body: PowerBody, request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue: await hue.set_power(gl_id, body.on)
    return {"ok": True}

@app.put("/api/hue/room/{gl_id}/brightness")
async def hue_brightness(gl_id: str, body: BrightnessBody, request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue: await hue.set_brightness(gl_id, body.brightness)
    return {"ok": True}

@app.put("/api/hue/room/{gl_id}/color_temp")
async def hue_color_temp(gl_id: str, body: ColorTempBody, request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue: await hue.set_color_temp(gl_id, body.mirek)
    return {"ok": True}

@app.put("/api/hue/room/{gl_id}/color")
async def hue_color(gl_id: str, body: ColorBody, request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue: await hue.set_color(gl_id, body.hue_deg, body.sat_pct)
    return {"ok": True}

@app.get("/api/hue/resources")
async def hue_resources(request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue: raise HTTPException(status_code=503, detail="Hue disabled")
    try:
        return await hue.list_resources()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.get("/api/hue/scenes-list")
async def hue_scenes_list(request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue: raise HTTPException(status_code=503, detail="Hue disabled")
    try:
        return await hue.list_scenes()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.get("/api/hue/lights")
async def hue_lights(request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue: raise HTTPException(status_code=503, detail="Hue disabled")
    try:
        return await hue.list_lights()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

class CreateZoneBody(BaseModel):
    name: str
    light_ids: list

@app.post("/api/hue/zone")
async def hue_create_zone(body: CreateZoneBody, request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue: raise HTTPException(status_code=503, detail="Hue disabled")
    try:
        result = await hue.create_zone(body.name, body.light_ids)
        await hue._discover()
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.delete("/api/hue/zone/{zone_id}")
async def hue_delete_zone(zone_id: str, request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue: raise HTTPException(status_code=503, detail="Hue disabled")
    try:
        result = await hue.delete_zone(zone_id)
        await hue._discover()
        return result
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/api/hue/discover")
async def hue_discover(request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue:
        await hue._discover()
        state = hue.get_cached_state()
        if state:
            await ws_manager.broadcast({"type": "hue_state", "data": state})
    return {"ok": True}

@app.post("/api/hue/scene/{scene_id}/activate")
async def hue_scene(scene_id: str, request: Request):
    hue = request.app.state.widgets.get("hue")
    if hue:
        await hue.activate_scene(scene_id)
        # Fetch updated state immediately after activation and broadcast
        state = await hue.fetch_state()
        await ws_manager.broadcast({"type": "hue_state", "data": state})
    return {"ok": True}

@app.get("/api/hue/icons")
async def hue_icons():
    icon_dir = Path("widgets/hue/icons")
    if not icon_dir.exists():
        return []
    return sorted([f.stem for f in icon_dir.glob("*.svg")])


import logging

# ── Log capturing for WebSocket dashboard ────────────────────────────────────
class WSLogHandler(logging.Handler):
    def emit(self, record):
        if record.levelno < logging.WARNING:
            return  # Don't spam mirror browser with INFO-level access logs
        try:
            msg = self.format(record)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    ws_manager.broadcast({"type": "log", "data": {"msg": msg, "level": record.levelname}}),
                    loop
                )
        except Exception:
            pass

logger = logging.getLogger()
logger.setLevel(logging.INFO)
ws_handler = WSLogHandler()
ws_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
logger.addHandler(ws_handler)

@app.get("/api/system/info")
async def system_info():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        ip = "127.0.0.1"
    uptime_s = int(_time.time() - _start_time)
    uptime = f"{uptime_s // 3600}h {(uptime_s % 3600) // 60}m {uptime_s % 60}s"
    display = yaml.safe_load(Path("config/display.yaml").read_text(encoding="utf-8")) or {}
    return {"ip": ip, "uptime": uptime, "port": display.get("port", 8000),
            "http_port": display.get("http_port", 8080),
            "control_port": display.get("control_port", 8001),
            "started": _start_time}

@app.get("/api/qr")
async def generate_qr(url: str = Query(...)):
    import qrcode, qrcode.image.svg
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(url, image_factory=factory, border=1)
    buf = _io.BytesIO()
    img.save(buf)
    return _Response(content=buf.getvalue(), media_type="image/svg+xml")

@app.post("/api/hard-reload")
async def hard_reload():
    await ws_manager.broadcast({"type": "hard_reload"})
    return {"ok": True}

@app.post("/api/reboot")
async def reboot_server():
    import os
    os._exit(0)

@app.post("/api/shutdown")
async def shutdown_pi():
    import subprocess, asyncio
    async def _do():
        await asyncio.sleep(0.5)
        subprocess.run(["sudo", "shutdown", "-h", "now"])
    asyncio.create_task(_do())
    return {"ok": True}

@app.get("/api/status")
async def get_status(request: Request):
    status = {}
    if request.app.state.widgets.get("weather"):
        status["weather"] = request.app.state.widgets["weather"].get_cached() is not None
    if request.app.state.widgets.get("calendar"):
        status["calendar"] = request.app.state.widgets["calendar"].get_cached() is not None
    if request.app.state.widgets.get("hue"):
        status["hue"] = request.app.state.widgets["hue"].get_cached_state() is not None
    if request.app.state.widgets.get("news"):
        status["news"] = request.app.state.widgets["news"].get_cached() is not None
    return status

@app.get("/api/logs")
async def get_logs():
    from server.log_capture import get_log_buffer
    return {"logs": get_log_buffer()}

@app.get("/api/ssl-debug")
async def ssl_debug():
    import sys
    base = Path(__file__).resolve().parent.parent
    cert = base / "config/ssl/cert.pem"
    key  = base / "config/ssl/key.pem"
    return {
        "file": str(Path(__file__).resolve()),
        "base": str(base),
        "cert_path": str(cert),
        "cert_exists": cert.exists(),
        "key_exists": key.exists(),
        "python": sys.executable,
    }

@app.post("/api/restart")
async def restart_server():
    import sys, os, subprocess
    base = Path(__file__).resolve().parent.parent
    display = yaml.safe_load((base / "config/display.yaml").read_text(encoding="utf-8")) or {}
    port = display.get("port", 8000)
    cert = base / "config/ssl/cert.pem"
    key  = base / "config/ssl/key.pem"
    cmd = [sys.executable, "-m", "uvicorn", "server.main:app",
           "--host", "0.0.0.0", "--port", str(port)]
    if cert.exists() and key.exists():
        cmd += ["--ssl-certfile", str(cert), "--ssl-keyfile", str(key)]
    subprocess.Popen(cmd, cwd=str(base))
    os._exit(0)

@app.post("/api/redalert/test")
async def redalert_test(request: Request):
    cfg = yaml.safe_load(Path("widgets/redalert/redalert.yaml").read_text(encoding="utf-8")) or {} if Path("widgets/redalert/redalert.yaml").exists() else {}
    test_areas = cfg.get("watch_areas", ["Test Location"])
    async def _flash():
        await ws_manager.broadcast({"type": "red_alert", "data": {
            "active": True, "areas": test_areas, "title": "צבע אדום", "desc": "Test"
        }})
        await asyncio.sleep(5)
        await ws_manager.broadcast({"type": "red_alert", "data": {"active": False}})
    asyncio.create_task(_flash())
    return {"ok": True}

@app.get("/api/redalert/areas")
async def redalert_areas():
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"Referer": "https://www.oref.org.il/"}) as client:
            r = await client.get("https://www.oref.org.il/Shared/Ajax/GetDistricts.aspx?lang=HE")
        items = r.json() if r.status_code == 200 else []
        return sorted({str(d.get("label", "")).strip() for d in items if d.get("label")})
    except Exception as e:
        print(f"Oref areas error: {e}")
        return []

# ── Global refresh ────────────────────────────────────────────────────────────

@app.post("/api/refresh")
async def refresh_all(request: Request):
    tasks = []
    if request.app.state.widgets.get("hue"):
        tasks.append((request.app.state.widgets["hue"].fetch_state(), "hue_state"))
    if request.app.state.widgets.get("weather"):
        tasks.append((request.app.state.widgets["weather"].force_fetch(), "weather"))
    if request.app.state.widgets.get("calendar"):
        tasks.append((request.app.state.widgets["calendar"].fetch(), "calendar"))
    if request.app.state.widgets.get("news"):
        tasks.append((request.app.state.widgets["news"].force_fetch(), "news"))

    for coro, label in tasks:
        try:
            data = await coro
            if data:
                await ws_manager.broadcast({"type": label, "data": data})
        except Exception as e:
            print(f"Refresh {label} error: {e}")
    return {"ok": True}


# ── Settings page & config API ────────────────────────────────────────────────

def _get_config_path(widget: str) -> Path:
    if widget in ('display', 'layout'):
        return Path(f'config/{widget}.yaml')
    return Path(f'widgets/{widget}/{widget}.yaml')

@app.get('/cert.crt')
async def get_cert():
    cert = Path('config/ssl/cert.pem')
    if not cert.exists():
        raise HTTPException(status_code=404, detail='No certificate found. Run start.sh first.')
    return FileResponse(str(cert), media_type='application/x-x509-ca-cert',
                        filename='magicmirror.crt')

@app.get('/settings')
async def settings_page():
    return FileResponse('static/settings.html')

@app.get('/control')
async def control_page():
    return FileResponse('static/control.html')

@app.get('/api/calendar/auth-url')
async def calendar_auth_url():
    creds_path = Path('widgets/calendar/credentials.json')
    if not creds_path.exists():
        raise HTTPException(status_code=400, detail='widgets/calendar/credentials.json not found.')
    import os
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
    from google_auth_oauthlib.flow import InstalledAppFlow
    _oauth_flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), ["https://www.googleapis.com/auth/calendar.readonly"])
    _oauth_flow.redirect_uri = 'http://localhost:8000/api/calendar/callback'
    auth_url, _ = _oauth_flow.authorization_url(access_type='offline', prompt='consent', include_granted_scopes='true')
    # Use global _oauth_flow? For simplicity we just return the URL, but the flow needs to be preserved.
    # In practice we need to store it somewhere.
    app.state._oauth_flow = _oauth_flow
    return {'url': auth_url}

@app.get('/api/calendar/callback')
async def calendar_callback(request: Request, code: str, state: str = None):
    _oauth_flow = getattr(request.app.state, "_oauth_flow", None)
    if not _oauth_flow:
        raise HTTPException(status_code=400, detail='No pending OAuth flow.')
    import os
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
    _oauth_flow.fetch_token(code=code)
    creds = _oauth_flow.credentials
    Path('widgets/calendar/token.json').write_text(creds.to_json(), encoding='utf-8')
    request.app.state._oauth_flow = None
    return HTMLResponse('''<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center;padding:40px;background:#141414;border-radius:20px;border:1px solid #242424}
h2{font-size:24px;margin-bottom:12px}p{color:#888;font-size:16px}</style></head>
<body><div class="card"><h2>✓ Calendar Connected</h2><p>Authentication successful. This window will close automatically.</p></div>
<script>window.opener&&window.opener.postMessage("calendar_auth_done","*");setTimeout(()=>window.close(),2000);</script>
</body></html>''')

@app.get('/api/calendar/list-all')
async def calendar_list_all(request: Request):
    calendar = request.app.state.widgets.get("calendar")
    if not calendar: raise HTTPException(status_code=503, detail='Calendar not initialized')
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=1) as ex:
        result = await loop.run_in_executor(ex, calendar.list_all_calendars)
    if result is None:
        raise HTTPException(status_code=503, detail='Calendar not authenticated or unavailable')
    return result

@app.get('/api/data/weather')
async def get_weather_data(request: Request):
    weather = request.app.state.widgets.get("weather")
    if not weather or weather.get_cached() is None:
        raise HTTPException(status_code=503, detail='No data yet')
    return weather.get_cached()

@app.get('/api/data/calendar')
async def get_calendar_data(request: Request):
    calendar = request.app.state.widgets.get("calendar")
    if not calendar or calendar.get_cached() is None:
        raise HTTPException(status_code=503, detail='No data yet')
    return calendar.get_cached()

@app.get('/api/data/hue')
async def get_hue_data(request: Request):
    hue = request.app.state.widgets.get("hue")
    if not hue or hue.get_cached_state() is None:
        raise HTTPException(status_code=503, detail='No data yet')
    return hue.get_cached_state()

@app.get('/api/data/news')
async def get_news_data(request: Request):
    news = request.app.state.widgets.get("news")
    if not news or news.get_cached() is None:
        raise HTTPException(status_code=503, detail='No data yet')
    return news.get_cached()

def _read_config_safe(path: Path) -> str:
    try:
        return path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return path.read_text(encoding='cp1252')

@app.get('/api/config/{widget}')
async def get_config(widget: str):
    path = _get_config_path(widget)
    if not path.exists():
        raise HTTPException(status_code=404, detail='Config not found')
    return yaml.safe_load(_read_config_safe(path)) or {}

@app.post('/api/config/{widget}')
async def save_config(widget: str, request: Request):
    path = _get_config_path(widget)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = await request.json()
    path.write_text(yaml.dump(body, allow_unicode=True, default_flow_style=False), encoding='utf-8')
    
    # Notify widget of config change
    if widget in request.app.state.widgets:
        svc = request.app.state.widgets[widget]
        if widget == 'hue':
            await svc._discover()
            state = svc.get_cached_state()
            if state:
                await ws_manager.broadcast({"type": "hue_state", "data": state})
        elif hasattr(svc, "force_fetch"):
            data = await svc.force_fetch()
            if data:
                await ws_manager.broadcast({"type": widget, "data": data})
        elif hasattr(svc, "fetch"):
            data = await svc.fetch()
            if data:
                await ws_manager.broadcast({"type": widget, "data": data})

    if widget == 'layout' or widget == 'display':
        layout  = yaml.safe_load(Path("config/layout.yaml").read_text(encoding='utf-8'))
        display = yaml.safe_load(Path("config/display.yaml").read_text(encoding='utf-8'))
        await ws_manager.broadcast({"type": "config", "data": {"layout": layout, "display": display}})
        
    return {'ok': True}


# ── Control panel — separate HTTP server (same process, shared state) ────────

_control_app = FastAPI(redirect_slashes=False)
# Mount the main app state
_control_app.state = app.state

@_control_app.get("/")
async def _ctrl_index():
    return FileResponse('static/control.html')

@_control_app.websocket("/ws")
async def _ctrl_ws(ws: WebSocket):
    # This just uses the same ws_endpoint logic but we can manually dispatch it.
    await ws_endpoint(ws)

@_control_app.get("/api/status")
async def _ctrl_status(request: Request):
    return await get_status(request)

@_control_app.get("/api/logs")
async def _ctrl_logs():
    return await get_logs()

@_control_app.get("/api/config/{widget}")
async def _ctrl_get_config(widget: str):
    return await get_config(widget)

@_control_app.post("/api/config/{widget}")
async def _ctrl_save_config(widget: str, request: Request):
    return await save_config(widget, request)

@_control_app.post("/api/refresh")
async def _ctrl_refresh(request: Request):
    return await refresh_all(request)

@_control_app.post("/api/hard-reload")
async def _ctrl_hard_reload():
    return await hard_reload()

@_control_app.post("/api/redalert/test")
async def _ctrl_redalert_test(request: Request):
    return await redalert_test(request)

@_control_app.get("/api/redalert/areas")
async def _ctrl_redalert_areas():
    return await redalert_areas()

@_control_app.post("/api/reboot")
async def _ctrl_reboot():
    return await reboot_server()

@_control_app.post("/api/shutdown")
async def _ctrl_shutdown():
    return await shutdown_pi()

@_control_app.get("/api/calendar/list-all")
async def _ctrl_calendar_list_all(request: Request):
    return await calendar_list_all(request)

@_control_app.get("/api/hue/resources")
async def _ctrl_hue_resources(request: Request):
    return await hue_resources(request)

@_control_app.get("/api/hue/scenes-list")
async def _ctrl_hue_scenes_list(request: Request):
    return await hue_scenes_list(request)

@_control_app.get("/api/hue/lights")
async def _ctrl_hue_lights(request: Request):
    return await hue_lights(request)

@_control_app.get("/api/hue/icons")
async def _ctrl_hue_icons():
    return await hue_icons()

@_control_app.post("/api/hue/pair")
async def _ctrl_hue_pair(request: Request):
    return await hue_pair(request)

@_control_app.post("/api/hue/discover")
async def _ctrl_hue_discover(request: Request):
    return await hue_discover(request)

@_control_app.post("/api/hue/zone")
async def _ctrl_hue_create_zone(body: CreateZoneBody, request: Request):
    return await hue_create_zone(body, request)

@_control_app.delete("/api/hue/zone/{zone_id}")
async def _ctrl_hue_delete_zone(zone_id: str, request: Request):
    return await hue_delete_zone(zone_id, request)

@_control_app.get("/api/system/info")
async def _ctrl_system_info():
    return await system_info()

@_control_app.get("/api/qr")
async def _ctrl_generate_qr(url: str = Query(...)):
    return await generate_qr(url)

_control_app.mount("/widgets", StaticFiles(directory="widgets"), name="ctrl-widgets")
_control_app.mount("/icons/weather", StaticFiles(directory="widgets/weather/weather_icons/icons"), name="ctrl-wi")
_control_app.mount("/", StaticFiles(directory="static", html=False), name="ctrl-static")


async def _start_control_server():
    display      = yaml.safe_load(Path("config/display.yaml").read_text(encoding="utf-8")) or {}
    control_port = display.get("control_port", 8001)
    config = _uvicorn.Config(_control_app, host="0.0.0.0", port=control_port, log_level="warning")
    server = _uvicorn.Server(config)
    server.install_signal_handlers = lambda: None
    try:
        print(f"Control panel on http://0.0.0.0:{control_port}")
        await server.serve()
    except Exception as e:
        print(f"Control server error: {e}")


# ── Static files (must be last) ───────────────────────────────────────────────

app.mount("/widgets", StaticFiles(directory="widgets"), name="widgets")
app.mount("/icons/weather", StaticFiles(directory="widgets/weather/weather_icons/icons"), name="wi-icons")
app.mount("/", StaticFiles(directory="static", html=True), name="static")
