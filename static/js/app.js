// ── Widget instances ──────────────────────────────────────────────────────────
const widgets = {};

window.activeWidgets.forEach(w => {
  if (window.WidgetClasses[w]) {
    widgets[w] = new window.WidgetClasses[w](`widget-${w}`);
  } else {
    // Fallback if class wasn't registered properly
    console.warn(`Widget class for ${w} not found in window.WidgetClasses`);
  }
});

// DateTime runs on its own — no server data needed
if (widgets.datetime && typeof widgets.datetime.init === 'function') {
  widgets.datetime.init();
}

// ── Bootstrap: use prefetched data when available, fall back to REST ─────────
async function _tryFetchJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

(async () => {
  // Phase 2a: Use server-injected config + widget data if available
  const prefetchedConfig = window.__CONFIG__ || null;
  const prefetchedData   = window.__PREFETCH__ || {};

  let layout, display;

  if (prefetchedConfig) {
    layout  = prefetchedConfig.layout;
    display = prefetchedConfig.display;
  } else {
    // Fallback to REST
    const results = await Promise.all([
      _tryFetchJson('/api/config/layout'),
      _tryFetchJson('/api/config/display'),
    ]);
    layout  = results[0];
    display = results[1];
  }

  if (layout)  applyLayout(layout);
  if (display) applyDisplay(display);
  _reveal();

  // Render widgets from prefetched data first, then fill gaps via REST
  const restNeeded = [];
  for (const w of window.activeWidgets) {
    if (prefetchedData[w] && widgets[w] && typeof widgets[w].render === 'function') {
      widgets[w].render(prefetchedData[w]);
      widgets[w]._rendered = true;
      widgets[w]._lastDataJson = JSON.stringify(prefetchedData[w]);
    } else if (w !== 'datetime') {
      restNeeded.push(w);
    }
  }

  // Fetch any missing widget data via REST in parallel
  if (restNeeded.length) {
    const results = await Promise.all(
      restNeeded.map(w => _tryFetchJson(`/api/data/${w}`).then(data => ({ widget: w, data })))
    );
    for (const { widget, data } of results) {
      if (data && widgets[widget] && typeof widgets[widget].render === 'function') {
        // Phase 4d: Skip render if widget is hidden in current layout
        if (_isWidgetHidden(widget)) continue;
        widgets[widget].render(data);
        widgets[widget]._rendered = true;
        widgets[widget]._lastDataJson = JSON.stringify(data);
      }
    }
  }
})();

// ── Layout management ─────────────────────────────────────────────────────────
let _layoutTemplates = {};
let _templateKeys    = [];
let _currentIdx      = 0;

function applyLayout(layout) {
  if (!layout) return;
  _layoutTemplates = layout.templates || {};
  _templateKeys    = Object.keys(_layoutTemplates);

  // Start from saved current
  const savedCurrent = layout.current || 'default';
  _currentIdx = _templateKeys.indexOf(savedCurrent);
  if (_currentIdx < 0) _currentIdx = 0;

  _applyTemplate(_currentIdx);
}

function _applyTemplate(idx) {
  const key      = _templateKeys[idx];
  const template = _layoutTemplates[key];
  if (!template) return;

  document.getElementById('layout-label').textContent = template.label || key;
  if (widgets.datetime) {
      widgets.datetime.setShowSeconds(template.show_seconds === true);
  }

  // Apply template-specific scale if set
  if (template.ui_scale) {
    _displayConfig.ui_scale = template.ui_scale;
  }
  initWidgetScale();

  for (const [name, pos] of Object.entries(template.widgets || {})) {
    const el = document.getElementById(`widget-${name}`);
    if (!el) continue;
    el.style.gridRow    = pos.row;
    el.style.gridColumn = pos.column;
    // Hide widget if positioned at 1/1 (sentinel for "hidden in this layout")
    const hidden = (pos.row === '1 / 1');
    el.style.visibility = hidden ? 'hidden' : 'visible';
  }
}

// Phase 4d: Check if a widget is hidden in the current layout template
function _isWidgetHidden(name) {
  const key = _templateKeys[_currentIdx];
  const template = _layoutTemplates[key];
  if (!template?.widgets?.[name]) return false;
  return template.widgets[name].row === '1 / 1';
}

// ── Display config ─────────────────────────────────────────────────────────────
let _displayConfig = {};

function applyDisplay(display) {
  if (!display) return;
  _displayConfig = display;
  const ring = document.getElementById('ring-overlay');
  const bw   = display.ring_light?.border_width ?? 120;
  const op   = display.ring_light?.opacity       ?? 0.92;
  const W    = display.screen?.width  ?? 1080;
  const H    = display.screen?.height ?? 1920;
  Object.assign(ring.style, {
    width: `${W}px`, height: `${H}px`,
    top: '0', left: '0',
    border: `${bw}px solid rgba(255,255,255,${op})`,
    boxSizing: 'border-box',
  });
  const gfx = display.graphics || 'high';
  document.body.classList.remove('gfx-high', 'gfx-mid', 'gfx-low');
  document.body.classList.add(`gfx-${gfx}`);
  document.body.style.cursor = display.show_cursor ? 'default' : 'none';
}

// ── Reveal mirror after layout is ready ───────────────────────────────────────
let _revealed = false;
function _reveal() {
  if (_revealed) return;
  _revealed = true;
  document.getElementById('mirror').style.opacity      = '1';
  document.getElementById('menu-toggle').style.opacity = '1';
}

// Fallback: show mirror after 4 s even if WS never delivers config
setTimeout(_reveal, 4000);

// ── WebSocket handlers ────────────────────────────────────────────────────────
WS.on('config', ({ layout, display }) => {
  applyLayout(layout);
  applyDisplay(display);
  _reveal(); // no-op if already revealed by REST bootstrap
});

// Dynamic websocket dispatcher — driven by manifest wsType
window.activeWidgets.forEach(w => {
  const manifest = (window.widgetManifests || {})[w] || {};
  // wsType: null means no WS subscription (e.g. datetime)
  if (manifest.wsType === null) return;
  const wsType = manifest.wsType !== undefined ? manifest.wsType : w;

  WS.on(wsType, data => {
    const widget = widgets[w];
    if (!widget) return;

    // Phase 4d: Skip rendering for hidden widgets — store data for later
    if (_isWidgetHidden(w)) {
      widget._pendingData = data;
      return;
    }

    // Phase 3a: Skip if data hasn't changed (avoids redundant DOM rebuilds)
    const newJson = JSON.stringify(data);
    if (widget._lastDataJson === newJson) return;
    widget._lastDataJson = newJson;

    if (!widget._rendered) {
      if (typeof widget.render === 'function') {
        widget.render(data);
        widget._rendered = true;
      }
    } else {
      if (typeof widget.update === 'function') {
        widget.update(data);
      } else if (typeof widget.render === 'function') {
        widget.render(data);
      }
    }
  });
});

WS.on('hard_reload', () => {
  location.reload();
});

// ── Radial menu toggle ────────────────────────────────────────────────────────
const menuToggle = document.getElementById('menu-toggle');
const radialMenu = document.getElementById('radial-menu');

function openMenu() {
  radialMenu.classList.add('open');
  menuToggle.classList.add('open');
}

function closeMenu() {
  // Remove stagger delay so all items collapse simultaneously
  radialMenu.querySelectorAll('.radial-item').forEach(el => {
    el.style.transitionDelay = '0ms';
  });
  radialMenu.classList.remove('open');
  menuToggle.classList.remove('open');
  // Restore CSS-variable delays after collapse finishes
  setTimeout(() => {
    radialMenu.querySelectorAll('.radial-item').forEach(el => {
      el.style.transitionDelay = '';
    });
  }, 300);
}

function toggleMenu() { radialMenu.classList.contains('open') ? closeMenu() : openMenu(); }

menuToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
// Clicks inside the radial menu don't bubble to document — menu stays open
radialMenu.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeMenu);

// ── Sleep overlay ─────────────────────────────────────────────────────────────
const sleepOverlay = document.getElementById('sleep-overlay');
const btnSleep     = document.getElementById('btn-sleep');

function setSleep(on) {
  sleepOverlay.classList.toggle('hidden', !on);
  btnSleep.classList.toggle('active', on);
}

btnSleep.addEventListener('click', () => setSleep(sleepOverlay.classList.contains('hidden')));

// Tap the dark area to wake
sleepOverlay.addEventListener('click', () => setSleep(false));

// ── Ring light ────────────────────────────────────────────────────────────────
const ringOverlay = document.getElementById('ring-overlay');
const btnRing     = document.getElementById('btn-ring');

btnRing.addEventListener('click', () => {
  const on = ringOverlay.classList.contains('hidden');
  ringOverlay.classList.toggle('hidden', !on);
  btnRing.classList.toggle('active', on);
});

// ── Refresh button ────────────────────────────────────────────────────────────
const btnRefresh = document.getElementById('btn-refresh');
btnRefresh.addEventListener('click', async () => {
  btnRefresh.classList.add('active');
  try {
    await fetch('/api/refresh', { method: 'POST' });
  } finally {
    setTimeout(() => btnRefresh.classList.remove('active'), 800);
  }
});

// ── Layout switcher ───────────────────────────────────────────────────────────
document.getElementById('btn-layout').addEventListener('click', () => {
  _currentIdx = (_currentIdx + 1) % _templateKeys.length;
  _applyTemplate(_currentIdx);

  // Phase 4d: Render any widgets that were hidden and now visible
  for (const w of window.activeWidgets) {
    const widget = widgets[w];
    if (!widget || !widget._pendingData) continue;
    if (!_isWidgetHidden(w)) {
      if (typeof widget.render === 'function') {
        widget.render(widget._pendingData);
        widget._rendered = true;
        widget._lastDataJson = JSON.stringify(widget._pendingData);
      }
      widget._pendingData = null;
    }
  }
});

// ── Widget scale (fonts, icons, padding) track grid cell size ─────────────────
// Phase 3c: Debounced ResizeObserver — avoids rapid-fire --wu recalculations
let _scaleRafId = null;
function initWidgetScale() {
  const setWu = (el) => {
    const w = el.clientWidth;
    const h = el.dataset.wuBase ? parseInt(el.dataset.wuBase) : el.clientHeight;
    const m = Math.max(1, Math.min(w, h));
    const scale = _displayConfig.ui_scale ?? 360;
    el.style.setProperty('--wu', `${m / scale}px`);
  };
  const ro = new ResizeObserver(entries => {
    if (_scaleRafId) return; // Debounce: one rAF at a time
    _scaleRafId = requestAnimationFrame(() => {
      _scaleRafId = null;
      for (const entry of entries) setWu(entry.target);
    });
  });
  document.querySelectorAll('#mirror > .widget').forEach((el) => {
    setWu(el);
    ro.observe(el);
  });
}
initWidgetScale();

// ── Start WebSocket ───────────────────────────────────────────────────────────
WS.start();
