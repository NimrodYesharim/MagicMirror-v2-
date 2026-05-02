"""
Template widget backend.
Copy to widgets/<name>/<name>.py and rename throughout.

Framework contract:
  register(app, ws_manager) — called once at startup by server/main.py.
  Must:
    1. Instantiate the service.
    2. Register a state provider so new WS clients get cached data immediately.
    3. Start a background poll loop that broadcasts when data changes.
    4. Store the service in app.state.widgets['<name>'].
"""
import asyncio
import yaml
from pathlib import Path
from typing import Optional

CONFIG_PATH = Path("widgets/mywidget/mywidget.yaml")


class MyWidgetService:
    def __init__(self):
        self._cache: Optional[dict] = None

    def get_cached(self) -> Optional[dict]:
        return self._cache

    async def initialize(self):
        pass  # load config, authenticate, etc.

    async def force_fetch(self) -> Optional[dict]:
        """Fetch fresh data, update cache, return the data."""
        self._cache = {"example": True}
        return self._cache

    async def _poll_loop(self, ws_manager):
        while True:
            await asyncio.sleep(900)
            try:
                data = await self.force_fetch()
                if data:
                    await ws_manager.broadcast({"type": "mywidget", "data": data})
            except Exception as e:
                print(f"[mywidget] Poll error: {e}")


async def register(app, ws_manager):
    svc = MyWidgetService()
    await svc.initialize()
    ws_manager.register_state_provider("mywidget", svc.get_cached)
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["mywidget"] = svc
    asyncio.create_task(svc._poll_loop(ws_manager))
