import time
import httpx
import yaml
import asyncio
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone, timedelta

CONFIG_PATH = Path("widgets/weather/weather.yaml")
OW_CURRENT  = "https://api.openweathermap.org/data/2.5/weather"
OW_FORECAST = "https://api.openweathermap.org/data/2.5/forecast"


class WeatherService:
    def __init__(self):
        self.config: dict = {}
        self._cache: Optional[dict] = None
        self._last_fetch: float = 0
        self.interval_seconds: float = 900

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        calls = self.config.get("calls_per_day", 96)
        self.interval_seconds = 86400 / calls
        await self._do_fetch()

    async def fetch(self) -> Optional[dict]:
        if time.time() - self._last_fetch < self.interval_seconds:
            return None
        return await self._do_fetch()

    async def force_fetch(self) -> Optional[dict]:
        return await self._do_fetch()

    def get_cached(self) -> Optional[dict]:
        return self._cache

    async def _do_fetch(self) -> Optional[dict]:
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        self.interval_seconds = 86400 / max(1, self.config.get("calls_per_day", 96))
        key   = self.config.get("api_key", "")
        city  = self.config.get("city", "")
        units = self.config.get("units", "metric")
        lang  = self.config.get("language", "en")
        params = {"q": city, "appid": key, "units": units, "lang": lang}

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                curr_r, fore_r = await asyncio.gather(
                    client.get(OW_CURRENT,  params=params),
                    client.get(OW_FORECAST, params=params),
                )
            curr_r.raise_for_status()
            fore_r.raise_for_status()
            curr = curr_r.json()
            fore = fore_r.json()

            # Sunrise / sunset in local time
            tz_offset = curr.get("timezone", 0)
            def _fmt_ts(ts):
                dt = datetime.fromtimestamp(ts, tz=timezone(timedelta(seconds=tz_offset)))
                return dt.strftime("%H:%M")

            # Hourly: interpolate 3h steps to 1h steps for next 24h
            base_hourly = [{
                "ts":   curr["dt"],
                "icon": curr["weather"][0]["icon"],
                "temp": curr["main"]["temp"],
            }]
            for item in fore["list"][:17]:  # 17 × 3 h = 51 h of anchor points
                base_hourly.append({
                    "ts":   item["dt"],
                    "icon": item["weather"][0]["icon"],
                    "temp": item["main"]["temp"],
                })

            hourly = []
            now_ts = curr["dt"]
            for i in range(49):  # Now + 48 h, one column per hour
                target_ts = now_ts + (i * 3600)
                p1, p2 = base_hourly[0], base_hourly[1]
                for j in range(len(base_hourly) - 1):
                    if base_hourly[j]["ts"] <= target_ts <= base_hourly[j + 1]["ts"]:
                        p1, p2 = base_hourly[j], base_hourly[j + 1]
                        break
                t_diff = p2["ts"] - p1["ts"]
                ratio  = 0.0 if t_diff == 0 else (target_ts - p1["ts"]) / t_diff
                interp_temp = p1["temp"] + (p2["temp"] - p1["temp"]) * ratio
                dt_h = datetime.fromtimestamp(target_ts, tz=timezone(timedelta(seconds=tz_offset)))
                hourly.append({
                    "hour": "Now" if i == 0 else dt_h.strftime("%H"),
                    "icon": p1["icon"] if ratio < 0.5 else p2["icon"],
                    "temp": round(interp_temp),
                })

            data = {
                "current": {
                    "temp":        round(curr["main"]["temp"]),
                    "feels_like":  round(curr["main"]["feels_like"]),
                    "humidity":    curr["main"]["humidity"],
                    "description": curr["weather"][0]["description"].capitalize(),
                    "icon":        curr["weather"][0]["icon"],
                    "wind_speed":  round(curr["wind"]["speed"], 1),
                    "sunrise":     _fmt_ts(curr["sys"]["sunrise"]),
                    "sunset":      _fmt_ts(curr["sys"]["sunset"]),
                    "units":       units,
                },
                "hourly":   hourly,
                "forecast": _parse_forecast(fore["list"], self.config.get("forecast_days", 8), curr),
            }
            self._cache = data
            self._last_fetch = time.time()
            return data
        except Exception as e:
            print(f"Weather fetch error: {e}")
            return None


def _parse_forecast(items: list, days: int, current: dict) -> list:
    by_day: dict = {}
    today_iso = datetime.now(timezone.utc).date().isoformat()

    for item in items:
        dt  = datetime.fromtimestamp(item["dt"], tz=timezone.utc)
        day = dt.date().isoformat()
        if day not in by_day:
            by_day[day] = {"items": [], "best": item}
        by_day[day]["items"].append(item)
        if abs(dt.hour - 12) < abs(
            datetime.fromtimestamp(by_day[day]["best"]["dt"], tz=timezone.utc).hour - 12
        ):
            by_day[day]["best"] = item

    result = []

    # Today: use current conditions + today's forecast items for hi/lo
    today_entries = by_day.get(today_iso, {}).get("items", [])
    if today_entries:
        today_max = max(x["main"]["temp"] for x in today_entries)
        today_min = min(x["main"]["temp"] for x in today_entries)
    else:
        today_max = current["main"].get("temp_max", current["main"]["temp"])
        today_min = current["main"].get("temp_min", current["main"]["temp"])
    result.append({
        "day":         "Today",
        "date":        datetime.now(timezone.utc).strftime("%d/%m"),
        "temp_max":    round(today_max),
        "temp_min":    round(today_min),
        "icon":        current["weather"][0]["icon"],
        "description": current["weather"][0]["description"].capitalize(),
    })

    # Future days
    future = sorted(d for d in by_day if d != today_iso)
    for day_iso in future[:days - 1]:
        day_items = by_day[day_iso]["items"]
        best = by_day[day_iso]["best"]
        dt   = datetime.fromisoformat(day_iso)
        result.append({
            "day":         dt.strftime("%a"),
            "date":        dt.strftime("%d/%m"),
            "temp_max":    round(max(x["main"]["temp"] for x in day_items)),
            "temp_min":    round(min(x["main"]["temp"] for x in day_items)),
            "icon":        best["weather"][0]["icon"],
            "description": best["weather"][0]["description"].capitalize(),
        })
    return result


async def register(app, ws_manager):
    service = WeatherService()
    await service.initialize()

    ws_manager.register_state_provider("weather", service.get_cached)

    async def _loop():
        while True:
            await asyncio.sleep(60)
            try:
                data = await service.fetch()
                if data:
                    await ws_manager.broadcast({"type": "weather", "data": data})
            except Exception as e:
                print(f"Weather loop error: {e}")

    asyncio.create_task(_loop())
    
    # Store the service globally so it can be accessed by the main app for refresh logic
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["weather"] = service
