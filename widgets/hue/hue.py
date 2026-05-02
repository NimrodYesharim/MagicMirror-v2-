import math
import colorsys
import httpx
import yaml
import asyncio
from pathlib import Path
from typing import Optional

CONFIG_PATH = Path("widgets/hue/hue.yaml")
MIREK_MIN = 153
MIREK_MAX = 500


def _read_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        content = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        content = path.read_text(encoding='cp1252')
    return yaml.safe_load(content) or {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    return name.replace('\u2019', "'").replace('\u2018', "'").lower().strip()


def _xy_to_rgb(x: float, y: float, bri: float = 1.0) -> tuple:
    if y == 0:
        return (0, 0, 0)
    Y = bri
    X = (Y / y) * x
    Z = (Y / y) * (1.0 - x - y)
    r =  X * 1.656492 - Y * 0.354851 - Z * 0.255038
    g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152
    b =  X * 0.051713 - Y * 0.121364 + Z * 1.011530
    r, g, b = max(0.0, r), max(0.0, g), max(0.0, b)

    def _gamma(v):
        return 12.92 * v if v <= 0.0031308 else 1.055 * pow(v, 1.0 / 2.4) - 0.055

    r, g, b = _gamma(r), _gamma(g), _gamma(b)
    mx = max(r, g, b, 1.0)
    return (int(r / mx * 255), int(g / mx * 255), int(b / mx * 255))


def _mirek_to_rgb(mirek: int) -> tuple:
    if not mirek or mirek <= 0: return (255, 255, 255)
    kelvin = 1_000_000 / mirek
    t = kelvin / 100
    if t < 1: t = 1
    if t <= 66:
        r = 255
        g = max(0, min(255, int(99.4708025861 * math.log(t) - 161.1195681661)))
        b = 0 if t <= 19 else max(0, min(255, int(138.5177312231 * math.log(t - 10) - 305.0447927307)))
    else:
        r = max(0, min(255, int(329.698727446 * pow(t - 60, -0.1332047592))))
        g = max(0, min(255, int(288.1221695283 * pow(t - 60, -0.0755148492))))
        b = 255
    return (r, g, b)


def _colors_to_gradient(colors: list) -> str:
    unique = []
    seen = set()
    for c in colors:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    if not unique:
        return "conic-gradient(#444, #444)"
    def _hex(c): return f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"
    if len(unique) == 1:
        h = _hex(unique[0])
        return f"conic-gradient(from 0deg, {h}, {h})"
    stops = [f"{_hex(c)} {round(i * 100 / (len(unique) - 1))}%" for i, c in enumerate(unique)]
    stops.append(_hex(unique[0]))
    return f"conic-gradient(from 0deg, {', '.join(stops)})"


def _xy_to_hs(x: float, y: float) -> tuple:
    r, g, b = _xy_to_rgb(x, y, 1.0)
    h, s, _ = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return round(h * 360, 1), round(s * 100, 1)


def _hs_to_xy(hue_deg: float, sat_pct: float) -> tuple:
    r, g, b = colorsys.hsv_to_rgb(hue_deg / 360, sat_pct / 100, 1.0)

    def _linear(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = _linear(r), _linear(g), _linear(b)
    X = r * 0.664511 + g * 0.154324 + b * 0.162028
    Y = r * 0.283881 + g * 0.668433 + b * 0.047685
    Z = r * 0.000088 + g * 0.072310 + b * 0.986039
    total = X + Y + Z
    if total == 0:
        return (0.3127, 0.3290)
    return (round(X / total, 4), round(Y / total, 4))


# ── Service ───────────────────────────────────────────────────────────────────

class HueService:
    def __init__(self):
        self.config: dict = {}
        self._cached_state: Optional[dict] = None
        self._client: Optional[httpx.AsyncClient] = None
        self._room_to_light_ids: dict = {}  # room_id -> [light_id, ...]

    async def initialize(self):
        self.config = _read_yaml(CONFIG_PATH)
        self._client = httpx.AsyncClient(verify=False, timeout=10.0)
        if not self.config.get("username"):
            print("Hue: no username. POST /api/hue/pair after pressing bridge link button.")
            return
        await self._discover()

    def _headers(self): return {"hue-application-key": self.config["username"]}
    def _url(self, path): return f"https://{self.config['bridge_ip']}/clip/v2{path}"

    async def _get(self, path):
        r = await self._client.get(self._url(path), headers=self._headers())
        r.raise_for_status()
        return r.json()

    async def _put(self, path, body):
        r = await self._client.put(self._url(path), json=body, headers=self._headers())
        r.raise_for_status()
        return r.json()

    async def _discover(self):
        try:
            self.reload_config()
            rooms = (await self._get("/resource/room"))["data"]
            zones = (await self._get("/resource/zone"))["data"]
            scenes = (await self._get("/resource/scene"))["data"]
            gl_data = (await self._get("/resource/grouped_light"))["data"]

            # Build room_id → [light_id] map (rooms via device children, zones directly)
            devices = (await self._get("/resource/device"))["data"]
            device_to_lights = {
                dev["id"]: [s["rid"] for s in dev.get("services", []) if s["rtype"] == "light"]
                for dev in devices
            }
            for g in rooms:
                device_ids = [c["rid"] for c in g.get("children", []) if c.get("rtype") == "device"]
                self._room_to_light_ids[g["id"]] = [
                    lid for did in device_ids for lid in device_to_lights.get(did, [])
                ]
            for g in zones:
                self._room_to_light_ids[g["id"]] = [
                    c["rid"] for c in g.get("children", []) if c.get("rtype") == "light"
                ]

            by_id = {}
            rid_to_name = {}
            for g in rooms + zones:
                gl_id = next((s["rid"] for s in g.get("services", []) if s["rtype"] == "grouped_light"), None)
                by_id[g["id"]] = {"room_id": g["id"], "grouped_light_id": gl_id}
                rid_to_name[g["id"]] = g["metadata"]["name"]

            sid_to_room = {
                s["id"]: rid_to_name.get(s.get("group", {}).get("rid"), "")
                for s in scenes
            }

            master = self.config.get("master", {})
            m_rid = master.get("room_id")
            if m_rid in by_id:
                master.update(by_id[m_rid])

            # Only update rooms that ALREADY exist in the config
            for cr in self.config.get("rooms", []):
                rid = cr.get("room_id")
                if rid in by_id:
                    cr.update(by_id[rid])

            scenes_by_id = {}
            for s in scenes:
                colors = []
                for action in s.get("actions", []):
                    # ... (color extraction code) ...
                    a = action.get("action", {})
                    bri = a.get("dimming", {}).get("brightness", 100) / 100
                    if "color" in a:
                        xy = a["color"].get("xy", {})
                        colors.append(_xy_to_rgb(xy.get("x", 0), xy.get("y", 0), bri))
                    elif "color_temperature" in a:
                        colors.append(_mirek_to_rgb(a["color_temperature"].get("mirek", 300)))
                scenes_by_id[s["id"]] = {"gradient": _colors_to_gradient(colors)}

            for cs in self.config.get("scenes", []):
                sid = cs.get("scene_id")
                if sid in scenes_by_id:
                    cs["_gradient"] = scenes_by_id[sid]["gradient"]
                    cs["_room"] = sid_to_room.get(sid, "")

            print("Hue: discovery complete.")

            light_data = (await self._get("/resource/light"))["data"]
            light_by_id = {l["id"]: l for l in light_data}
            gl_by_id = {gl["id"]: gl for gl in gl_data}
            self._cached_state = self._build_state(gl_by_id, light_by_id)
        except Exception as e:
            print(f"Hue discovery error: {e}")

    def reload_config(self):
        self.config = _read_yaml(CONFIG_PATH)

    async def fetch_state(self) -> dict:
        gl_resp, light_resp = await asyncio.gather(
            self._get("/resource/grouped_light"),
            self._get("/resource/light"),
        )
        gl_by_id    = {gl["id"]: gl for gl in gl_resp["data"]}
        light_by_id = {l["id"]:  l  for l  in light_resp["data"]}
        self._cached_state = self._build_state(gl_by_id, light_by_id)
        return self._cached_state

    def _build_state(self, gl_by_id: dict, light_by_id: dict = None) -> dict:
        if light_by_id is None:
            light_by_id = {}

        def _light_color_hex(light: dict) -> str:
            if not light.get("on", {}).get("on", False):
                return None
            xy = light.get("color", {}).get("xy")
            if xy:
                r, g, b = _xy_to_rgb(xy["x"], xy["y"], 1.0)
                return f"#{r:02x}{g:02x}{b:02x}"
            mirek = light.get("color_temperature", {}).get("mirek")
            if mirek:
                r, g, b = _mirek_to_rgb(mirek)
                return f"#{r:02x}{g:02x}{b:02x}"
            return "#ffffff"

        def _room(cr):
            gl_id = cr.get("grouped_light_id")
            if not gl_id:
                return None
            gl = gl_by_id.get(gl_id, {})
            xy = gl.get("color", {}).get("xy")
            hue_deg, sat_pct = (_xy_to_hs(xy["x"], xy["y"]) if xy else (None, None))
            room_id = cr.get("room_id")
            light_ids = self._room_to_light_ids.get(room_id, [])
            light_colors = [
                c for lid in light_ids
                if lid in light_by_id
                if (c := _light_color_hex(light_by_id[lid])) is not None
            ]
            return {
                "id": gl_id,
                "room_id": room_id,
                "name": cr["name"],
                "icon": cr.get("icon", "default"),
                "on": gl.get("on", {}).get("on", False),
                "brightness": round(gl.get("dimming", {}).get("brightness", 0), 1),
                "mirek": gl.get("color_temperature", {}).get("mirek"),
                "mirek_min": MIREK_MIN,
                "mirek_max": MIREK_MAX,
                "hue_deg": hue_deg,
                "sat_pct": sat_pct,
                "light_colors": light_colors,
            }

        master = self.config.get("master")
        return {
            "master": _room(master) if master else None,
            "rooms": [s for cr in self.config.get("rooms", []) if (s := _room(cr))],
            "scenes": [
                {"id": s["scene_id"], "name": s["name"],
                 "gradient": s.get("_gradient", "conic-gradient(#444,#444)"),
                 "room": s.get("_room", "")}
                for s in self.config.get("scenes", []) if s.get("scene_id")
            ],
        }

    def get_cached_state(self): return self._cached_state

    async def list_scenes(self) -> list:
        """Return all scenes from the bridge with gradient and which room/zone they belong to."""
        scenes   = (await self._get("/resource/scene"))["data"]
        rooms    = (await self._get("/resource/room"))["data"]
        zones    = (await self._get("/resource/zone"))["data"]
        id_to_name = {g["id"]: g["metadata"]["name"] for g in rooms + zones}
        result = []
        for s in scenes:
            colors = []
            for action in s.get("actions", []):
                a = action.get("action", {})
                bri = a.get("dimming", {}).get("brightness", 100) / 100
                if "color" in a:
                    xy = a["color"].get("xy", {})
                    colors.append(_xy_to_rgb(xy.get("x", 0), xy.get("y", 0), bri))
                elif "color_temperature" in a:
                    colors.append(_mirek_to_rgb(a["color_temperature"].get("mirek", 300)))
            group_rid = s.get("group", {}).get("rid")
            result.append({
                "id":       s["id"],
                "name":     s["metadata"]["name"],
                "room":     id_to_name.get(group_rid, ""),
                "gradient": _colors_to_gradient(colors),
            })
        return result

    async def list_lights(self) -> list:
        """Return all individual lights from the bridge."""
        lights = (await self._get("/resource/light"))["data"]
        return [
            {"id": l["id"], "name": l["metadata"]["name"],
             "on": l.get("on", {}).get("on", False),
             "brightness": round(l.get("dimming", {}).get("brightness", 0), 1)}
            for l in lights
        ]

    async def create_zone(self, name: str, light_ids: list) -> dict:
        """Create a new zone from selected light IDs."""
        body = {
            "type": "zone",
            "metadata": {"name": name, "archetype": "other"},
            "children": [{"rid": lid, "rtype": "light"} for lid in light_ids],
        }
        r = await self._client.post(self._url("/resource/zone"), json=body, headers=self._headers())
        r.raise_for_status()
        return r.json()

    async def delete_zone(self, zone_id: str) -> dict:
        """Delete a zone from the bridge."""
        r = await self._client.delete(self._url(f"/resource/zone/{zone_id}"), headers=self._headers())
        r.raise_for_status()
        return r.json()

    async def list_resources(self) -> dict:
        """Return all rooms and zones from the bridge with their grouped_light IDs."""
        rooms = (await self._get("/resource/room"))["data"]
        zones = (await self._get("/resource/zone"))["data"]
        gl_data = (await self._get("/resource/grouped_light"))["data"]
        gl_by_id = {gl["id"]: gl for gl in gl_data}

        def _entry(g, kind):
            gl_id = next((s["rid"] for s in g.get("services", []) if s["rtype"] == "grouped_light"), None)
            return {
                "name": g["metadata"]["name"],
                "room_id": g["id"],
                "grouped_light_id": gl_id or "",
                "kind": kind,
                "on": gl_by_id.get(gl_id, {}).get("on", {}).get("on", False) if gl_id else False,
            }

        return {
            "rooms": [_entry(g, "room") for g in rooms],
            "zones": [_entry(g, "zone") for g in zones],
        }

    async def set_power(self, gl_id, on): await self._put(f"/resource/grouped_light/{gl_id}", {"on": {"on": on}})
    async def set_brightness(self, gl_id, bri): await self._put(f"/resource/grouped_light/{gl_id}", {"on": {"on": bri > 0}, "dimming": {"brightness": max(1.0, bri)}})
    async def set_color_temp(self, gl_id, mirek): await self._put(f"/resource/grouped_light/{gl_id}", {"color_temperature": {"mirek": mirek}})
    async def set_color(self, gl_id, hue_deg, sat_pct):
        x, y = _hs_to_xy(hue_deg, sat_pct)
        await self._put(f"/resource/grouped_light/{gl_id}", {"color": {"xy": {"x": x, "y": y}}})
    async def activate_scene(self, scene_id): await self._put(f"/resource/scene/{scene_id}", {"recall": {"action": "active"}})

    async def pair(self) -> dict:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as c:
            r = await c.post(f"http://{self.config['bridge_ip']}/api", json={"devicetype": "magic-mirror#rpi"})
            data = r.json()
            if isinstance(data, list) and "success" in data[0]:
                username = data[0]["success"]["username"]
                self.config["username"] = username
                CONFIG_PATH.write_text(yaml.dump(self.config, allow_unicode=True, default_flow_style=False), encoding='utf-8')
                await self._discover()
                return {"ok": True, "username": username}
            return {"ok": False, "error": data}


async def register(app, ws_manager):
    service = HueService()
    await service.initialize()

    ws_manager.register_state_provider("hue_state", service.get_cached_state)

    async def _loop():
        while True:
            await asyncio.sleep(service.config.get("poll_interval", 10))
            try:
                state = await service.fetch_state()
                await ws_manager.broadcast({"type": "hue_state", "data": state})
            except Exception as e:
                print(f"Hue loop error: {e}")

    asyncio.create_task(_loop())
    
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["hue"] = service
