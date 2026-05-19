import httpx
import yaml
import asyncio
from pathlib import Path
from typing import Optional

CONFIG_PATH = Path("widgets/redalert/redalert.yaml")
ALERT_URL   = "https://www.oref.org.il/WarningMessages/alert/alerts.json"


class RedAlertService:
    def __init__(self):
        self.config: dict = {}
        self._active = False
        self._last_alert_time: float = 0

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}

    async def poll(self) -> Optional[dict]:
        if not self.config.get("enabled", True):
            return None
        try:
            async with httpx.AsyncClient(timeout=5.0, headers={
                "Referer": "https://www.oref.org.il/",
                "X-Requested-With": "XMLHttpRequest",
            }) as client:
                r = await client.get(ALERT_URL)

            if r.status_code != 200 or not r.text.strip():
                return self._clear_if_needed()

            data = r.json()
            areas = data.get("data", [])
            watch = self.config.get("watch_areas", [])

            # Alert if any watched area is in the active alert list
            hit = any(area in areas for area in watch)

            if hit:
                import time
                self._last_alert_time = time.time()
                self._active = True
                return {"active": True, "areas": areas, "title": data.get("title", ""), "desc": data.get("desc", "")}

            return self._clear_if_needed()

        except Exception:
            # Network error — don't clear active alert if it was recently set
            return None

    def _clear_if_needed(self):
        import time
        flash_dur = self.config.get("flash_duration", 60)
        if self._active and time.time() - self._last_alert_time > flash_dur:
            self._active = False
            return {"active": False}
        return None


async def register(app, ws_manager):
    service = RedAlertService()
    await service.initialize()

    # RedAlert does not have a cached state to send on connect
    ws_manager.register_state_provider("red_alert", lambda: None)

    async def _loop():
        while True:
            cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {} if CONFIG_PATH.exists() else {}
            await asyncio.sleep(cfg.get("poll_interval", 3))
            try:
                result = await service.poll()
                if result is not None:
                    await ws_manager.broadcast({"type": "red_alert", "data": result})
            except Exception as e:
                print(f"Alert loop error: {e}")

    asyncio.create_task(_loop())
    
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["redalert"] = service
