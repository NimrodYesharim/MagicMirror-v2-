import yaml
import asyncio
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

CONFIG_PATH = Path("widgets/calendar/calendar.yaml")
TOKEN_PATH = Path("widgets/calendar/token.json")
CREDS_PATH = Path("widgets/calendar/credentials.json")
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

_executor = ThreadPoolExecutor(max_workers=1)


def _is_hebrew(text: str) -> bool:
    try:
        return any("\u0590" <= ch <= "\u05FF" for ch in text)
    except Exception:
        return False


class CalendarService:
    def __init__(self):
        self.config: dict = {}
        self._cache: Optional[dict] = None
        self._creds = None

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        loop = asyncio.get_running_loop()
        self._creds = await loop.run_in_executor(_executor, self._load_creds)
        if self._creds:
            await self.fetch()

    def _load_creds(self):
        try:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request

            if not TOKEN_PATH.exists():
                print("Calendar: token.json not found. Run: python setup_calendar.py")
                return None

            creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                TOKEN_PATH.write_text(creds.to_json())
            return creds
        except Exception as e:
            print(f"Calendar credential error: {e}")
            return None

    async def fetch(self) -> Optional[dict]:
        if not self._creds:
            return None
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(_executor, self._fetch_sync)
        if result:
            self._cache = result
        return result

    def _fetch_sync(self) -> Optional[dict]:
        try:
            from googleapiclient.discovery import build

            service = build("calendar", "v3", credentials=self._creds)
            now = datetime.now(timezone.utc)
            max_events = self.config.get("max_events", 20)
            time_min = now.isoformat()
            time_max = (now + timedelta(days=365)).isoformat()  # wide window; capped by max_events

            cal_configs = {c["id"]: c for c in self.config.get("calendars", [])}
            events = []

            for cal_id, cal_cfg in cal_configs.items():
                try:
                    result = (
                        service.events()
                        .list(
                            calendarId=cal_id,
                            timeMin=time_min,
                            timeMax=time_max,
                            singleEvents=True,
                            orderBy="startTime",
                            maxResults=max_events,
                        )
                        .execute()
                    )
                    for e in result.get("items", []):
                        start = e.get("start", {})
                        end = e.get("end", {})
                        title = e.get("summary", "")
                        is_heb = self.config.get("hebrew", False) and _is_hebrew(title)
                        loc = (e.get("location") or "").strip() or None

                        events.append({
                            "id": e["id"],
                            "title": title,
                            "is_hebrew": is_heb,
                            "start": start.get("dateTime") or start.get("date"),
                            "end": end.get("dateTime") or end.get("date"),
                            "all_day": "date" in start,
                            "location": loc,
                            "color": cal_cfg.get("color", "#FFFFFF"),
                            "calendar_id": cal_id,
                        })
                except Exception as e:
                    print(f"Calendar fetch error for {cal_id}: {e}")

            events.sort(key=lambda e: e["start"])
            return {"events": events[:max_events]}
        except Exception as e:
            print(f"Calendar service error: {e}")
            return None

    def get_cached(self) -> Optional[dict]:
        return self._cache

    def list_all_calendars(self) -> Optional[list]:
        """Return all calendars accessible with current credentials."""
        if not self._creds:
            return None
        try:
            from googleapiclient.discovery import build
            service = build("calendar", "v3", credentials=self._creds)
            result  = service.calendarList().list().execute()
            return [
                {
                    "id":    c["id"],
                    "name":  c.get("summary", c["id"]),
                    "color": c.get("backgroundColor", "#3a7eff"),
                }
                for c in result.get("items", [])
            ]
        except Exception as e:
            return None


async def register(app, ws_manager):
    service = CalendarService()
    await service.initialize()

    ws_manager.register_state_provider("calendar", service.get_cached)

    async def _loop():
        while True:
            cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {} if CONFIG_PATH.exists() else {}
            await asyncio.sleep(cfg.get("refresh_minutes", 5) * 60)
            try:
                data = await service.fetch()
                if data:
                    await ws_manager.broadcast({"type": "calendar", "data": data})
            except Exception as e:
                print(f"Calendar loop error: {e}")

    asyncio.create_task(_loop())
    
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["calendar"] = service
