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
  // Run after this whole script has loaded: the layout/scale `let`s below aren't initialized yet
  await null;
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

  // Scale comes from display.yaml only. Template ui_scale used to be written into
  // _displayConfig here, so it only applied after a layout switch and then leaked
  // into every other layout — proportions changed each time you switched.

  for (const [name, pos] of Object.entries(template.widgets || {})) {
    const el = document.getElementById(`widget-${name}`);
    if (!el) continue;
    el.style.gridRow    = pos.row;
    el.style.gridColumn = pos.column;
    // Hide widget if positioned at 1/1 (sentinel for "hidden in this layout")
    const hidden = (pos.row === '1 / 1');
    el.style.visibility = hidden ? 'hidden' : 'visible';
  }

  // Scale after positions are set, so --wu matches the new cells in the same frame
  initWidgetScale();
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
  if (_scaleRo) applyAllScales();  // display.ui_scale may have changed
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
  document.body.classList.toggle('show-cursor', !!display.show_cursor);
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
    if (_isWidgetHidden(w) || _sleeping) {
      widget._pendingData = data;
      return;
    }

    // Route to update() for subsequent pushes (diff-aware), render() for first
    if (widget._rendered && typeof widget.update === 'function') {
      widget.update(data);
    } else if (typeof widget.render === 'function') {
      widget.render(data);
      widget._rendered = true;
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

let _sleeping = false;

// Local sleep state only. While asleep nothing is painted and WS data is parked in _pendingData.
function applySleep(on) {
  if (on === _sleeping) return;
  _sleeping = on;
  document.body.classList.toggle('sleeping', on);
  sleepOverlay.classList.toggle('hidden', !on);
  btnSleep.classList.toggle('active', on);
  if (on) return;
  // Waking: draw the latest data now, while the display spends ~3 s powering up
  for (const w of window.activeWidgets) {
    const widget = widgets[w];
    if (!widget || !widget._pendingData || _isWidgetHidden(w)) continue;
    const data = widget._pendingData;
    widget._pendingData = null;
    if (widget._rendered && typeof widget.update === 'function') widget.update(data);
    else if (typeof widget.render === 'function') { widget.render(data); widget._rendered = true; }
  }
}

// Display switched from Home Assistant (automation, app): follow it; a tap on the overlay wakes it
WS.on('display_power', ({ on }) => applySleep(!on));

function setSleep(on) {
  applySleep(on);
  // Black overlay stays as fallback if Home Assistant is unreachable
  fetch('/api/display/power', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: !on }),
  }).catch(() => {});
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

  for (const w of window.activeWidgets) {
    if (!_isWidgetHidden(w)) {
      const widget = widgets[w];
      if (widget) {
        widget._rendered = false;
        widget._pendingData = null;
        if (typeof widget._showSkeleton === 'function') {
          widget._showSkeleton();
        }
      }
    }
  }

  try {
    await fetch('/api/refresh', { method: 'POST' });
  } finally {
    setTimeout(() => btnRefresh.classList.remove('active'), 800);
  }
});

// ── Layout switcher ───────────────────────────────────────────────────────────
document.getElementById('btn-layout').addEventListener('click', () => {
  const mirror = document.getElementById('mirror');
  mirror.style.opacity = '0';

  setTimeout(() => {
    // Child transitions would animate the resize (the "shrink to top-left") — off while hidden
    document.body.classList.add('layout-switching');
    _currentIdx = (_currentIdx + 1) % _templateKeys.length;
    _applyTemplate(_currentIdx);

    // Phase 4d: Render any widgets that were hidden and now visible
    for (const w of window.activeWidgets) {
      const widget = widgets[w];
      if (!widget || _isWidgetHidden(w)) continue;

      if (widget._pendingData) {
        if (typeof widget.render === 'function') {
          widget.render(widget._pendingData);
          widget._rendered = true;
        }
        widget._pendingData = null;
      } else if (!widget._rendered && typeof widget._showSkeleton === 'function') {
        widget._showSkeleton();
      }
    }

    // Widgets that fit content to their size do it now instead of after their debounced observers
    for (const w of window.activeWidgets) widgets[w]?.relayout?.();

    // Two frames: the new layout is painted (hidden) before the fade-in starts
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mirror.style.opacity = '1';
      // Dropping the class restyles every widget element (~100 ms on the Pi). Do it once the
      // fade (a compositor animation, immune to main-thread stalls) is done, not as it starts.
      setTimeout(() => document.body.classList.remove('layout-switching'), 300);
    }));
  }, 220); // Matches the new fast opacity transition duration
});

// ── Widget scale (fonts, icons, padding) track grid cell size ─────────────────
// Phase 3c: Debounced ResizeObserver — avoids rapid-fire --wu recalculations
const WIDGET_REFS = {
  datetime: { cols: 6, rows: 3 },
  news:     { cols: 12, rows: 1 },
  weather:  { cols: 6, rows: 9 },
  calendar: { cols: 6, rows: 9 },
  hue:      { cols: 7, rows: 8 },
  hue_scenes: { cols: 1.5, rows: 8 }
};

let _scaleRafId = null;
let _scaleRo = null;

// Writing --wu restyles everything under el, even with the same value: skip no-op writes
function _setWu(el, px) {
  const v = `${px}px`;
  if (el.style.getPropertyValue('--wu') !== v) el.style.setProperty('--wu', v);
}

function applyAllScales() {
  const scale = _displayConfig.ui_scale ?? 360;
  const mirror = document.getElementById('mirror') || document.body;
  const mw = mirror.clientWidth;
  const mh = mirror.clientHeight;
  const mm = Math.max(1, Math.min(mw, mh));
  const globalWu = mm / scale;
  
  const colWidth = mw / 12;
  const rowHeight = 80;

  // Read every widget size before writing any --wu: one layout pass instead of one per widget
  const sizes = window.activeWidgets.map(w => {
    const el = document.getElementById(`widget-${w}`);
    return el && [w, el, el.clientWidth, el.clientHeight];
  }).filter(Boolean);

  _setWu(document.documentElement, globalWu);

  sizes.forEach(([w, widgetEl, W_cur, H_cur]) => {
    const ref = WIDGET_REFS[w];
    if (ref) {
      const W_ref = ref.cols * colWidth;
      const H_ref = ref.rows * rowHeight;

      let ratio = 1.0;
      if (W_ref > 0 && H_ref > 0 && W_cur > 0 && H_cur > 0) {
        if (w === 'hue' || w === 'hue_scenes') {
          ratio = H_cur / H_ref;
        } else {
          ratio = Math.min(W_cur / W_ref, H_cur / H_ref);
        }
      }
      const localWu = ratio * globalWu;
      _setWu(widgetEl, localWu);
    } else {
      _setWu(widgetEl, globalWu);
    }
  });
}

function initWidgetScale() {
  const mirror = document.getElementById('mirror') || document.body;
  applyAllScales();

  if (!_scaleRo) {
    _scaleRo = new ResizeObserver(() => {
      if (_scaleRafId) return;
      _scaleRafId = requestAnimationFrame(() => {
        _scaleRafId = null;
        applyAllScales();
      });
    });
    
    _scaleRo.observe(mirror);
    window.activeWidgets.forEach(w => {
      const el = document.getElementById(`widget-${w}`);
      if (el) _scaleRo.observe(el);
    });
  }
}
initWidgetScale();

// ── Start WebSocket ───────────────────────────────────────────────────────────
WS.start();
