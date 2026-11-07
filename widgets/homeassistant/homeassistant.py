"""
Home Assistant integration (backend + settings only: no <name>.js, so it never renders on the mirror).

Config: widgets/homeassistant/homeassistant.yaml (edited from /settings)
  url: http://homeassistant.local:8123
  token: <long-lived access token>   # HA profile → Security → Long-lived access tokens
  display_switch: switch.mirror_display   # the entity that powers the mirror's display
"""
import asyncio
import socket
import time
import httpx
import yaml
from pathlib import Path

CONFIG_PATH = Path("widgets/homeassistant/homeassistant.yaml")
# Entity domains that can power a display on/off via homeassistant.turn_on/turn_off
TOGGLE_DOMAINS = ("switch", "light", "input_boolean", "fan")
POLL_SECONDS = 5


class HomeAssistantService:
    def __init__(self):
        self._display_on = None   # last known state of the display device (None = unknown)
        self._hold_until = 0.0    # ignore polls right after we switched it (HA state lags the command)

    def get_cached(self):
        return None if self._display_on is None else {"on": self._display_on}

    async def _poll_loop(self, ws_manager):
        """Follow the display device so an off from HA (automation, app) puts the mirror to sleep."""
        while True:
            await asyncio.sleep(POLL_SECONDS)
            entity = self.config.get("display_switch")
            if not entity or time.monotonic() < self._hold_until:
                continue
            try:
                on = (await self._request("GET", f"/api/states/{entity}"))["state"] == "on"
            except Exception:
                continue  # HA unreachable: keep the mirror as it is
            if on != self._display_on:
                self._display_on = on
                await ws_manager.broadcast({"type": "display_power", "data": {"on": on}})

    @property
    def config(self) -> dict:
        # Read per call so settings changes apply without a restart (tiny file, rare calls)
        return (yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}) if CONFIG_PATH.exists() else {}

    async def _request(self, method: str, path: str, json=None):
        cfg = self.config
        url, token = cfg.get("url"), cfg.get("token")
        if not (url and token):
            raise RuntimeError("Home Assistant URL/token not configured")
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.request(method, f"{url.rstrip('/')}{path}",
                                headers={"Authorization": f"Bearer {token}"}, json=json)
            r.raise_for_status()
            return r.json()

    async def status(self) -> dict:
        cfg = self.config
        if not (cfg.get("url") and cfg.get("token")):
            return {"state": "unconfigured"}
        try:
            info = await self._request("GET", "/api/config")
            return {"state": "ok", "name": info.get("location_name"), "version": info.get("version")}
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                return {"state": "unauthorized"}
            return {"state": "unreachable", "detail": f"HTTP {e.response.status_code}"}
        except Exception as e:
            return {"state": "unreachable", "detail": type(e).__name__}

    async def scan(self, port: int = 8123) -> list[dict]:
        """Find Home Assistant servers on this machine's /24 subnet by probing `port`."""
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # UDP connect sends nothing; just picks the LAN interface
            own_ip = s.getsockname()[0]
        prefix = own_ip.rsplit(".", 1)[0]
        # shortcut: assumes a /24 LAN, upgrade to netmask-based ranges if the network is larger
        # This machine is found by its LAN IP (not localhost), so it's listed once and matches saved URLs
        hosts = [f"{prefix}.{i}" for i in range(1, 255)]

        async def probe(host):
            try:
                _, w = await asyncio.wait_for(asyncio.open_connection(host, port), 0.8)
                w.close()
            except Exception:
                return None
            # Port is open — confirm it's HA (its PWA manifest names it) and get a display name
            try:
                async with httpx.AsyncClient(timeout=2.0) as c:
                    m = (await c.get(f"http://{host}:{port}/manifest.json")).json()
                if "Home Assistant" not in (m.get("name", "") + m.get("short_name", "")):
                    return None
            except Exception:
                return None
            return {"host": host, "port": port, "name": "This mirror" if host == own_ip else "Home Assistant"}

        return [r for r in await asyncio.gather(*(probe(h) for h in hosts)) if r]

    async def list_entities(self) -> list[dict]:
        states = await self._request("GET", "/api/states")
        return sorted(
            ({"entity_id": s["entity_id"], "name": s.get("attributes", {}).get("friendly_name") or s["entity_id"]}
             for s in states if s["entity_id"].split(".")[0] in TOGGLE_DOMAINS),
            key=lambda e: e["name"].lower())

    async def set_display(self, on: bool) -> bool:
        entity = self.config.get("display_switch")
        if not entity:
            print("[homeassistant] No mirror display device selected in settings")
            return False
        try:
            await self._request("POST", f"/api/services/homeassistant/{'turn_on' if on else 'turn_off'}",
                                json={"entity_id": entity})
            self._display_on = on
            self._hold_until = time.monotonic() + 5
            return True
        except Exception as e:
            print(f"[homeassistant] Display {'on' if on else 'off'} ({entity}) failed: {e}")
            return False


async def register(app, ws_manager):
    svc = HomeAssistantService()
    app.state.widgets["homeassistant"] = svc
    ws_manager.register_state_provider("display_power", svc.get_cached)
    asyncio.create_task(svc._poll_loop(ws_manager))
