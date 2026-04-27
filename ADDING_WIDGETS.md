# Adding a New Widget to MagicMirror v2

This guide shows how to add a new widget from scratch. Follow these steps in order.

---

## 1. Create the service (backend)

Create `server/services/mywidget.py`:

```python
import yaml
import httpx
import asyncio
from pathlib import Path
from typing import Optional

CONFIG_PATH = Path("config/mywidget.yaml")


class MyWidgetService:
    def __init__(self):
        self.config: dict = {}
        self._cache: Optional[dict] = None
        self._interval: float = 300  # seconds between fetches

    async def initialize(self):
        self.config = yaml.safe_load(CONFIG_PATH.read_text(encoding='utf-8')) or {}
        self._interval = self.config.get("refresh_seconds", 300)
        await self._do_fetch()

    async def fetch(self) -> Optional[dict]:
        """Called by the background loop. Returns data or None if too soon."""
        return await self._do_fetch()

    def get_cached(self) -> Optional[dict]:
        return self._cache

    async def _do_fetch(self) -> Optional[dict]:
        try:
            # --- fetch your data here ---
            data = {"example_key": "example_value"}
            self._cache = data
            return data
        except Exception as e:
            print(f"MyWidget fetch error: {e}")
            return None
```

**Rules:**
- Always use `encoding='utf-8'` when reading YAML (required for Hebrew config on Windows).
- Return `None` on error — never raise. The loop handles `None` gracefully.
- Store fetched data in `self._cache` so new WebSocket clients get it immediately.

---

## 2. Create the config file

Create `config/mywidget.yaml`:

```yaml
enabled: true
refresh_seconds: 300
# add widget-specific keys here
```

---

## 3. Register in the server

Edit `server/main.py`:

**Import** (top of file):
```python
from server.services.mywidget import MyWidgetService
```

**Instantiate** (after other service instances):
```python
my_widget = MyWidgetService()
```

**Initialize** (inside `lifespan`):
```python
await my_widget.initialize()
asyncio.create_task(_mywidget_loop())
```

**Background loop** (after other loops):
```python
async def _mywidget_loop():
    while True:
        await asyncio.sleep(my_widget.config.get("refresh_seconds", 300))
        try:
            data = await my_widget.fetch()
            if data:
                await ws_manager.broadcast({"type": "my_widget", "data": data})
        except Exception as e:
            print(f"MyWidget loop error: {e}")
```

**Send cached state on WebSocket connect** (inside `ws_endpoint`, after existing sends):
```python
if my_widget.get_cached():
    await ws.send_json({"type": "my_widget", "data": my_widget.get_cached()})
```

**Add to config API** (in `_CONFIG_PATHS` dict):
```python
'mywidget': Path('config/mywidget.yaml'),
```

---

## 4. Create the frontend widget class

Create `static/js/widgets/mywidget.js`:

```javascript
class MyWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._showSkeleton();
  }

  _showSkeleton() {
    this.el.innerHTML = `<div style="padding:24px;display:flex;flex-direction:column;gap:16px">
      <div class="skeleton-block" style="height:40px"></div>
      <div class="skeleton-block" style="height:80px"></div>
    </div>`;
  }

  render(data) {
    this.el.innerHTML = `
      <div class="mw-content">
        <div class="mw-value">${data.example_key}</div>
      </div>`;
  }

  _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
```

**Rules:**
- Always show a skeleton immediately in the constructor.
- `render(data)` receives the same object your service returns from `_do_fetch`.
- Use `_esc()` on any user-supplied or API-supplied strings.

---

## 5. Create the widget CSS

Create `static/css/widgets/mywidget.css`:

```css
#widget-mywidget {
  display: flex;
  flex-direction: column;
  padding: 20px 40px;
  border-top: 1px solid #1a1a1a;
}

.mw-content {
  /* your styles */
}

.mw-value {
  font-size: 28px;
  font-weight: 300;
  color: #ccc;
}
```

**Grid slot:** The widget element is positioned by `config/layout.yaml`. Its `id` must match `widget-{name}`.

---

## 6. Register in HTML

Edit `static/index.html` — add the widget div and script/style links:

```html
<!-- In <head> -->
<link rel="stylesheet" href="/css/widgets/mywidget.css">

<!-- In <body> #mirror div -->
<div id="widget-mywidget" class="widget"></div>

<!-- Before </body>, after other widget scripts -->
<script src="/js/widgets/mywidget.js"></script>
```

---

## 7. Register in app.js

Edit `static/js/app.js`:

```javascript
// In the widgets object:
const widgets = {
  ...
  mywidget: new MyWidget('widget-mywidget'),
};

// In WebSocket handlers:
WS.on('my_widget', data => widgets.mywidget.render(data));
```

---

## 8. Add to layout config

Edit `config/layout.yaml` — add your widget to every template. Use `row: "1 / 1"` to hide it in templates where it should not appear:

```yaml
templates:
  default:
    widgets:
      ...
      mywidget: { row: "22 / 25", column: "1 / 13" }

  night:
    widgets:
      ...
      mywidget: { row: "1 / 1", column: "1 / 1" }   # hidden in night mode
```

---

## 9. Add to settings page (optional)

Edit `static/js/settings.js`:

1. Add a nav button in `static/settings.html`.
2. Add a section renderer function (e.g. `mywidgetSection()`).
3. Add a `case 'mywidget'` in `showSection()`.
4. Add to `WIDGET_META` for the visual layout editor:
   ```javascript
   const WIDGET_META = {
     ...
     mywidget: { label: 'My Widget', color: '#2a1a3a' },
   };
   ```

---

## Data flow summary

```
Server starts
  └─ MyWidgetService.initialize() → first fetch → stores in _cache

Browser connects via WebSocket
  └─ Server sends cached data immediately
  └─ Widget renders skeleton → fills with data

Background loop
  └─ Fetches every refresh_seconds
  └─ Broadcasts {"type": "my_widget", "data": {...}} to all clients
  └─ Widget.render(data) called → updates UI
```

---

## Checklist

- [ ] `server/services/mywidget.py` — service class
- [ ] `config/mywidget.yaml` — config file
- [ ] `server/main.py` — import, instantiate, initialize, loop, WS send, config path
- [ ] `static/js/widgets/mywidget.js` — widget class
- [ ] `static/css/widgets/mywidget.css` — styles
- [ ] `static/index.html` — div + script + link
- [ ] `static/js/app.js` — widget instance + WS handler
- [ ] `config/layout.yaml` — grid position in each template
