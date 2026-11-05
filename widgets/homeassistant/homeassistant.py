"""
Home Assistant integration (backend + settings only: no <name>.js, so it never renders on the mirror).

Config: widgets/homeassistant/homeassistant.yaml (edited from /settings)
  url: http://homeassistant.local:8123
  token: <long-lived access token>   # HA profile → Security → Long-lived access tokens
  display_switch: switch.mirror_display   # the entity that powers the mirror's display
"""
import asyncio
import socket
import httpx
import yaml
from pathlib import Path

CONFIG_PATH = Path("widgets/homeassistant/homeassistant.yaml")
# Entity domains that can power a display on/off via homeassistant.turn_on/turn_off
TOGGLE_DOMAINS = ("switch", "light", "input_boolean", "fan")


class HomeAssistantService:
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
        """Find Home Assistant servers on this machine's /24 subnet (and localhost) by probing `port`."""
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # UDP connect sends nothing; just picks the LAN interface
            prefix = s.getsockname()[0].rsplit(".", 1)[0]
        # shortcut: assumes a /24 LAN, upgrade to netmask-based ranges if the network is larger
        hosts = ["127.0.0.1"] + [f"{prefix}.{i}" for i in range(1, 255)]

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
            return {"host": "localhost" if host == "127.0.0.1" else host, "port": port,
                    "name": "This mirror" if host == "127.0.0.1" else "Home Assistant"}

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
            return True
        except Exception as e:
            print(f"[homeassistant] Display {'on' if on else 'off'} ({entity}) failed: {e}")
            return False


async def register(app, ws_manager):
    app.state.widgets["homeassistant"] = HomeAssistantService()
