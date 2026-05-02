import json
import time
import httpx
import yaml
import asyncio
import calendar
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone, timedelta

CONFIG_PATH   = Path("widgets/weather/weather.yaml")
OBSERVED_PATH = Path("config/weather_observed.json")

# Strictly using One Call API 3.0
ONE_CALL_API  = "https://api.openweathermap.org/data/3.0/onecall"
GEO_API       = "http://api.openweathermap.org/geo/1.0/direct"


class WeatherService:
    def __init__(self):
        self.config: dict = {}
        self._cache: Optional[dict] = None
        self._last_fetch: float = 0
        self.interval_seconds: float = 900
        
        self._lat: Optional[float] = None
        self._lon: Optional[float] = None
        self._geo_city: Optional[str] = None

        self._observed_date: Optional[str] = None
        self._observed_min: Optional[float] = None
        self._observed_max: Optional[float] = None
        self._load_observed()

    def _load_observed(self):
        try:
            if OBSERVED_PATH.exists():
                d = json.loads(OBSERVED_PATH.read_text(encoding="utf-8"))
                self._observed_date = d.get("date")
                self._observed_min  = d.get("min")
                self._observed_max  = d.get("max")
        except Exception: pass

    def _save_observed(self):
        try:
            OBSERVED_PATH.write_text(json.dumps({
                "date": self._observed_date, "min": self._observed_min, "max": self._observed_max,
            }), encoding="utf-8")
        except Exception: pass

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        calls = self.config.get("calls_per_day", 96)
        self.interval_seconds = 86400 / max(1, calls)
        await self._do_fetch()

    async def fetch(self) -> Optional[dict]:
        if time.time() - self._last_fetch < self.interval_seconds:
            return None
        return await self._do_fetch()

    async def force_fetch(self) -> Optional[dict]:
        return await self._do_fetch()

    def get_cached(self) -> Optional[dict]:
        return self._cache

    async def _get_coords(self, city: str, key: str) -> tuple[Optional[float], Optional[float]]:
        if self._geo_city == city and self._lat is not None:
            return self._lat, self._lon
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(GEO_API, params={"q": city, "limit": 1, "appid": key})
                if r.status_code == 200 and (data := r.json()):
                    self._lat, self._lon, self._geo_city = data[0]["lat"], data[0]["lon"], city
                    return self._lat, self._lon
        except Exception: pass
        return None, None

    async def _do_fetch(self) -> Optional[dict]:
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        key   = self.config.get("api_key", "")
        city  = self.config.get("city", "")
        units = self.config.get("units", "metric")
        lang  = self.config.get("language", "en")
        days_limit = self.config.get("forecast_days", 8)

        lat, lon = await self._get_coords(city, key)
        if lat is None: return None

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(ONE_CALL_API, params={
                    "lat": lat, "lon": lon, "appid": key, "units": units, "lang": lang,
                    "exclude": "minutely,alerts"
                })
                if r.status_code != 200: return None
                data = self._parse_onecall(r.json(), days_limit, units)
                self._cache, self._last_fetch = data, time.time()
                return data
        except Exception: return None

    def _parse_onecall(self, resp: dict, days_limit: int, units: str) -> dict:
        curr = resp.get("current", {})
        tz_offset = resp.get("timezone_offset", 0)
        local_tz  = timezone(timedelta(seconds=tz_offset))

        def _fmt_ts(ts):
            return datetime.fromtimestamp(ts, tz=local_tz).strftime("%H:%M")

        # Hourly (Next 48h)
        hourly = []
        for i, h in enumerate(resp.get("hourly", [])[:49]):
            dt_h = datetime.fromtimestamp(h["dt"], tz=local_tz)
            hourly.append({
                "hour": "Now" if i == 0 else dt_h.strftime("%H"),
                "icon": h["weather"][0]["icon"],
                "temp": round(h["temp"]),
                "uvi":  h.get("uvi", 0),
            })

        # Observed min/max tracking
        cur_temp = curr.get("temp", 0)
        local_date = datetime.now(local_tz).date().isoformat()
        if self._observed_date != local_date:
            self._observed_date, self._observed_min, self._observed_max = local_date, cur_temp, cur_temp
        else:
            self._observed_min = min(self._observed_min, cur_temp)
            self._observed_max = max(self._observed_max, cur_temp)
        self._save_observed()

        # Daily Forecast
        forecast = []
        for i, d in enumerate(resp.get("daily", [])[:days_limit]):
            is_today = i == 0
            dt = datetime.fromtimestamp(d["dt"], tz=local_tz)
            t_min, t_max = d["temp"]["min"], d["temp"]["max"]
            if is_today:
                t_min, t_max = min(t_min, self._observed_min), max(t_max, self._observed_max)

            day_name = "Today" if is_today else calendar.day_name[dt.weekday()]

            forecast.append({
                "day":         day_name,
                "date":        dt.strftime("%d/%m"),
                "temp_max":    round(t_max),
                "temp_min":    round(t_min),
                "icon":        d["weather"][0]["icon"],
                "description": d["weather"][0]["description"].capitalize(),
                "uvi":         d.get("uvi", 0),
                "feels_like":  round(d["feels_like"]["day"]),
                "humidity":    d.get("humidity"),
                "pressure":    d.get("pressure"),
                "wind_speed":  round(d.get("wind_speed", 0), 1),
                "clouds":      d.get("clouds"),
                "rain":        round(d.get("rain", 0) + d.get("snow", 0), 1),
            })

        return {
            "current": {
                "temp": round(cur_temp), "feels_like": round(curr.get("feels_like", 0)),
                "humidity": curr.get("humidity"), "description": curr["weather"][0]["description"].capitalize(),
                "icon": curr["weather"][0]["icon"], "wind_speed": round(curr.get("wind_speed", 0), 1),
                "sunrise": _fmt_ts(curr.get("sunrise", 0)), "sunset": _fmt_ts(curr.get("sunset", 0)),
                "uvi": curr.get("uvi", 0), "units": units, "tz_offset": tz_offset,
            },
            "hourly": hourly,
            "forecast": forecast,
        }

async def register(app, ws_manager):
    service = WeatherService()
    await service.initialize()
    ws_manager.register_state_provider("weather", service.get_cached)
    async def _loop():
        while True:
            await asyncio.sleep(60)
            try:
                if (data := await service.fetch()): await ws_manager.broadcast({"type": "weather", "data": data})
            except Exception: pass
    asyncio.create_task(_loop())
    if not hasattr(app.state, "widgets"): app.state.widgets = {}
    app.state.widgets["weather"] = service
