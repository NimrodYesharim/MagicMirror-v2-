"""
Home Assistant integration: settings, display power, and device control for the mirror.

Config: widgets/homeassistant/homeassistant.yaml (edited from /settings or the phone control panel)
  url: http://homeassistant.local:8123
  token: <long-lived access token>   # HA profile → Security → Long-lived access tokens
  display_switch: switch.mirror_display   # the entity that powers the mirror's display
  hidden_devices: []                      # device ids left out of the Home card

Live state comes over HA's WebSocket API (one connection, pushed changes), trimmed to the
fields the mirror UI uses and batched before it is broadcast as `ha_state` / `ha_delta`.
"""
from __future__ import annotations  # `str | None` on the Pi's Python 3.9

import asyncio
import json
import socket
import time
import httpx
import websockets
import yaml
from pathlib import Path

CONFIG_PATH = Path("widgets/homeassistant/homeassistant.yaml")
# Entity domains that can power a display on/off via homeassistant.turn_on/turn_off
TOGGLE_DOMAINS = ("switch", "light", "input_boolean", "fan")

# A device's main control, best first. Its other entities become extras in the device's popup.
PRIMARY_DOMAINS = ("climate", "media_player", "switch", "script", "automation")
EXTRA_DOMAINS = ("switch", "select", "button", "binary_sensor")
SKIP_PLATFORMS = ("hue",)   # Hue lights/scenes have their own widget; lights come later

# Attributes the UI reads, per domain (everything else is dropped before broadcasting)
ATTRS = {
    "climate": ("current_temperature", "temperature", "min_temp", "max_temp", "target_temp_step",
                "hvac_modes", "fan_modes", "swing_modes", "fan_mode", "swing_mode", "hvac_action"),
    "media_player": ("media_title", "media_artist", "app_name", "volume_level", "is_volume_muted",
                     "source", "source_list", "supported_features", "device_class"),
    "select": ("options",),
    "binary_sensor": ("device_class",),
}

# What the mirror may ask HA to do: domain → service → allowed data keys.
# The mirror's API has no login, so this (plus "entity must be a known device") is the guard.
SERVICES = {
    "climate": {"turn_on": (), "turn_off": (), "set_temperature": ("temperature",),
                "set_hvac_mode": ("hvac_mode",), "set_fan_mode": ("fan_mode",),
                "set_swing_mode": ("swing_mode",)},
    "media_player": {"turn_on": (), "turn_off": (), "media_play_pause": (), "media_next_track": (),
                     "media_previous_track": (), "volume_set": ("volume_level",),
                     "volume_mute": ("is_volume_muted",), "select_source": ("source",)},
    "switch": {"turn_on": (), "turn_off": (), "toggle": ()},
    "select": {"select_option": ("option",)},
    "button": {"press": ()},
    "script": {"turn_on": ()},
    "automation": {"trigger": ()},
}

BATCH_SECONDS = 0.25


def validate_call(entity_id: str, service: str, data: dict, known: set) -> str | None:
    """Return why a service call is refused, or None if it's allowed."""
    if entity_id not in known:
        return "unknown entity"
    domain = entity_id.split(".", 1)[0]
    allowed = SERVICES.get(domain, {}).get(service)
    if allowed is None:
        return f"{domain}.{service} not allowed"
    extra = set(data) - set(allowed)
    if extra:
        return f"data not allowed: {', '.join(sorted(extra))}"
    return None


def trim(state: dict) -> dict:
    domain = state["entity_id"].split(".", 1)[0]
    a = state.get("attributes", {})
    out = {"s": state["state"], "a": {k: a[k] for k in ATTRS.get(domain, ()) if k in a}}
    if domain == "media_player" and a.get("entity_picture"):
        # The picture URL carries an access token: send only a cache key, the art endpoint proxies it
        out["a"]["pic"] = str(hash(a["entity_picture"]) & 0xFFFFFFFF)
    return out


class HomeAssistantService:
    def __init__(self):
        self._display_on = None   # last known state of the display device (None = unknown)
        self._hold_until = 0.0    # ignore state right after we switched it (HA state lags the command)
        self._devices = []        # [{id, entity, name, area, extras: [[entity_id, label]]}]
        self._states = {}         # entity_id → trimmed state, for known entities only
        self._pictures = {}       # media_player entity_id → raw entity_picture path
        self._art = {}            # entity_id → (pic key, bytes, content type)
        self._pending = {}
        self._connected = False

    # ── Cached state for the mirror ──────────────────────────────────────────
    def get_cached(self):
        return None if self._display_on is None else {"on": self._display_on}

    def get_ha_state(self):
        if not self._devices:
            return None
        cfg = self.config
        return {"devices": self._devices, "states": self._states, "hidden": cfg.get("hidden_devices") or [],
                "display": cfg.get("display_switch"), "connected": self._connected}

    @property
    def known_entities(self) -> set:
        return set(self._states)

    @property
    def config(self) -> dict:
        # Read per call so settings changes apply without a restart (tiny file, rare calls)
        return (yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}) if CONFIG_PATH.exists() else {}

    # ── Live connection ──────────────────────────────────────────────────────
    async def _live_loop(self, ws_manager):
        delay = 2
        while True:
            cfg = self.config
            url, token = cfg.get("url"), cfg.get("token")
            if not (url and token):
                await asyncio.sleep(10)
                continue
            try:
                await self._run_connection(ws_manager, url, token)
                delay = 2
            except Exception as e:
                print(f"[homeassistant] live connection lost: {type(e).__name__}: {e}")
            if self._connected:
                self._connected = False
                await ws_manager.broadcast({"type": "ha_delta", "data": {"connected": False}})
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def _run_connection(self, ws_manager, url, token):
        ws_url = url.replace("http", "ws", 1).rstrip("/") + "/api/websocket"
        async with websockets.connect(ws_url, max_size=None, open_timeout=10) as ws:
            await ws.recv()  # auth_required
            await ws.send(json.dumps({"type": "auth", "access_token": token}))
            if json.loads(await ws.recv()).get("type") != "auth_ok":
                raise RuntimeError("token rejected")

            n = 0
            async def ask(msg_type):
                nonlocal n
                n += 1
                await ws.send(json.dumps({"id": n, "type": msg_type}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get("id") == n:
                        return m.get("result")

            areas = {a["area_id"]: a["name"] for a in await ask("config/area_registry/list")}
            devices = {d["id"]: d for d in await ask("config/device_registry/list")}
            entities = await ask("config/entity_registry/list")
            states = {s["entity_id"]: s for s in await ask("get_states")}
            self._build_model(areas, devices, entities, states)
            self._connected = True
            await ws_manager.broadcast({"type": "ha_state", "data": self.get_ha_state()})
            await self._sync_display(ws_manager)

            n += 1
            await ws.send(json.dumps({"id": n, "type": "subscribe_events", "event_type": "state_changed"}))
            flusher = asyncio.create_task(self._flush_loop(ws_manager, ws, (url, token)))
            try:
                async for raw in ws:   # ends when the flusher closes it after a settings change
                    m = json.loads(raw)
                    if m.get("type") != "event":
                        continue
                    new = m["event"]["data"].get("new_state")
                    if new and new["entity_id"] in self._states:
                        self._on_state(new)
            finally:
                flusher.cancel()

    def _build_model(self, areas, devices, entities, states):
        """Group entities into devices: one primary control each, the rest as extras."""
        by_device = {}
        for e in entities:
            eid = e["entity_id"]
            domain = eid.split(".", 1)[0]
            if (e.get("platform") in SKIP_PLATFORMS or e.get("disabled_by") or e.get("hidden_by")
                    or eid not in states or domain not in PRIMARY_DOMAINS + EXTRA_DOMAINS):
                continue
            key = e.get("device_id") or eid  # entities without a device stand alone
            by_device.setdefault(key, []).append(e)

        out = []
        for key, ents in by_device.items():
            primaries = [e for e in ents if e["entity_id"].split(".", 1)[0] in PRIMARY_DOMAINS
                         and not e.get("entity_category")]
            if not primaries:
                continue
            primaries.sort(key=lambda e: PRIMARY_DOMAINS.index(e["entity_id"].split(".", 1)[0]))
            main = primaries[0]
            dev = devices.get(main.get("device_id")) or {}
            area_id = main.get("area_id") or dev.get("area_id")
            name = (states[main["entity_id"]]["attributes"].get("friendly_name")
                    or dev.get("name_by_user") or dev.get("name") or main["entity_id"])
            def label(e):  # "סלון Horizontal swing" → "Horizontal swing"
                n = states[e["entity_id"]]["attributes"].get("friendly_name") or e["entity_id"]
                return n[len(name):].strip() if n.startswith(name) and len(n) > len(name) else n
            extras = [[e["entity_id"], label(e)] for e in ents if e is not main]
            out.append({"id": key, "entity": main["entity_id"], "name": name,
                        "area": areas.get(area_id, "Other"), "extras": extras})
        out.sort(key=lambda d: (d["area"] == "Other", d["area"].lower(), d["name"].lower()))

        self._devices = out
        wanted = {d["entity"] for d in out} | {x[0] for d in out for x in d["extras"]}
        self._states = {eid: trim(states[eid]) for eid in wanted}
        self._pictures = {eid: states[eid]["attributes"].get("entity_picture")
                          for eid in wanted if eid.startswith("media_player.")}
        if (ds := self.config.get("display_switch")) in states:
            self._display_on = states[ds]["state"] == "on"

    def _on_state(self, new):
        eid = new["entity_id"]
        t = trim(new)
        if eid in self._pictures:
            self._pictures[eid] = new["attributes"].get("entity_picture")
        if t != self._states.get(eid):   # e.g. media position ticks change nothing we send
            self._states[eid] = t
            self._pending[eid] = t

    async def _flush_loop(self, ws_manager, ws, server):
        hidden = self.config.get("hidden_devices") or []
        tick = 0
        while True:
            await asyncio.sleep(BATCH_SECONDS)
            tick += 1
            if tick % 20 == 0:  # every 5 s: pick up settings saved from the phone or /settings
                cfg = self.config
                if (cfg.get("url"), cfg.get("token")) != server:
                    await ws.close()  # reconnect with the new server/token
                    return
                if (cfg.get("hidden_devices") or []) != hidden:
                    hidden = cfg.get("hidden_devices") or []
                    await ws_manager.broadcast({"type": "ha_state", "data": self.get_ha_state()})
            if not self._pending:
                continue
            batch, self._pending = self._pending, {}
            await ws_manager.broadcast({"type": "ha_delta", "data": {"states": batch}})
            if self.config.get("display_switch") in batch:
                await self._sync_display(ws_manager)

    async def _sync_display(self, ws_manager):
        """Follow the display device so an off from HA (automation, app) puts the mirror to sleep."""
        st = self._states.get(self.config.get("display_switch"))
        if not st or st["s"] not in ("on", "off") or time.monotonic() < self._hold_until:
            return
        on = st["s"] == "on"
        if on != self._display_on:
            self._display_on = on
            await ws_manager.broadcast({"type": "display_power", "data": {"on": on}})

    # ── REST helpers ─────────────────────────────────────────────────────────
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

    async def call(self, entity_id: str, service: str, data: dict) -> None:
        """Run an allow-listed service on a known entity. Raises ValueError if refused."""
        why = validate_call(entity_id, service, data, self.known_entities)
        if why:
            raise ValueError(why)
        domain = entity_id.split(".", 1)[0]
        await self._request("POST", f"/api/services/{domain}/{service}", json={"entity_id": entity_id, **data})

    async def art(self, entity_id: str):
        """Album art / app icon for a media player, fetched with HA's tokenised URL and cached."""
        path = self._pictures.get(entity_id)
        if not path:
            return None
        key = self._states.get(entity_id, {}).get("a", {}).get("pic")
        hit = self._art.get(entity_id)
        if hit and hit[0] == key:
            return hit[1], hit[2]
        base = path if path.startswith("http") else self.config.get("url", "").rstrip("/") + path
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(base)
            r.raise_for_status()
        self._art[entity_id] = (key, r.content, r.headers.get("content-type", "image/jpeg"))
        return r.content, self._art[entity_id][2]

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
    ws_manager.register_state_provider("ha_state", svc.get_ha_state)
    asyncio.create_task(svc._live_loop(ws_manager))


if __name__ == "__main__":  # self-check: python -m widgets.homeassistant.homeassistant
    known = {"climate.slvn", "switch.mirror", "button.reset"}
    assert validate_call("climate.slvn", "set_temperature", {"temperature": 23}, known) is None
    assert validate_call("climate.slvn", "set_temperature", {"temperature": 23, "x": 1}, known)
    assert validate_call("climate.other", "turn_on", {}, known) == "unknown entity"
    assert validate_call("switch.mirror", "turn_off", {}, known) is None
    assert validate_call("button.reset", "press", {}, known) is None
    assert validate_call("switch.mirror", "reload", {}, known)
    assert trim({"entity_id": "media_player.tv", "state": "on",
                 "attributes": {"entity_picture": "/x?token=secret", "media_position": 5}})["a"].keys() == {"pic"}
    print("ok")
