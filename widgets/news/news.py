import time
import httpx
import yaml
import asyncio
from pathlib import Path
from typing import Optional

CONFIG_PATH       = Path("widgets/news/news.yaml")
NEWS_HEADLINES    = "https://newsapi.org/v2/top-headlines"
NEWS_EVERYTHING   = "https://newsapi.org/v2/everything"


class NewsService:
    def __init__(self):
        self.config: dict = {}
        self._cache: Optional[dict] = None
        self._last_fetch: float = 0
        self.interval_seconds: float = 1800

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        if not self.config.get("enabled", True):
            return
        calls_per_day = self.config.get("calls_per_day", 100)
        self.interval_seconds = 86400 / max(1, calls_per_day)
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
        key     = self.config.get("api_key", "")
        country = self.config.get("country", "il")
        lang    = self.config.get("language", "he")
        q       = self.config.get("q", "").strip()
        n       = self.config.get("max_articles", 8)

        if not key:
            return None
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                if q:
                    # Use /everything for keyword search (supports language filter)
                    r = await client.get(NEWS_EVERYTHING, params={
                        "q": q, "language": lang,
                        "sortBy": "publishedAt",
                        "pageSize": n, "apiKey": key,
                    })
                else:
                    # Use /top-headlines with country
                    r = await client.get(NEWS_HEADLINES, params={
                        "country": country,
                        "pageSize": n, "apiKey": key,
                    })
            r.raise_for_status()
            articles = r.json().get("articles", [])
            headlines = [
                {"title": a["title"], "source": a.get("source", {}).get("name", ""),
                 "desc": (a.get("description") or "").strip(),
                 "date": a.get("publishedAt")}
                for a in articles if a.get("title") and a["title"] != "[Removed]"
            ]
            self._cache = {"headlines": headlines, "country": country}
            self._last_fetch = time.time()
            return self._cache
        except Exception as e:
            print(f"News fetch error: {e}")
            return None


async def register(app, ws_manager):
    service = NewsService()
    await service.initialize()

    ws_manager.register_state_provider("news", service.get_cached)

    async def _loop():
        while True:
            await asyncio.sleep(60)
            try:
                data = await service.fetch()
                if data:
                    await ws_manager.broadcast({"type": "news", "data": data})
            except Exception as e:
                print(f"News loop error: {e}")

    asyncio.create_task(_loop())
    
    if not hasattr(app.state, "widgets"):
        app.state.widgets = {}
    app.state.widgets["news"] = service
