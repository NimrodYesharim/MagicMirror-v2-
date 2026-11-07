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

  // Widgets measure themselves when they render: let their CSS land first
  await window.widgetCssReady;

  // Park prefetched data; applyLayout renders only the widgets the layout shows (hidden ones wait)
  const restNeeded = [];
  for (const w of window.activeWidgets) {
    if (prefetchedData[w] && widgets[w]) widgets[w]._pendingData = prefetchedData[w];
    else if (w !== 'datetime' && window.widgetManifests?.[w]?.wsType !== null) restNeeded.push(w);
  }
  if (display) applyDisplay(display);
  if (layout)  applyLayout(layout);
  else         _flushPending();

  // Reveal once fonts are in, so text doesn't visibly reflow from the fallback font
  document.body.offsetHeight;  // layout now so the fonts the widgets use start loading
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
  _reveal();

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

  _syncInstances();
  _applyTemplate(_currentIdx);
}

// Widgets placed more than once ("multi" manifest): layout key `base:arg`, e.g. `ha_tile:climate.slvn`.
// One container + instance per key used in any template; ones no template uses are removed.
function _syncInstances() {
  const keys = new Set();
  for (const t of Object.values(_layoutTemplates)) {
    for (const k of Object.keys(t?.widgets || {})) if (k.includes(':')) keys.add(k);
  }
  const mirror = document.getElementById('mirror');
  for (const key of keys) {
    if (widgets[key]) continue;
    const i = key.indexOf(':'), base = key.slice(0, i), arg = key.slice(i + 1);
    const m = window.widgetManifests?.[base], Cls = window.WidgetClasses[base];
    if (!m?.multi || !Cls) continue;
    const div = document.createElement('div');
    div.id = `widget-${key}`;
    div.className = 'widget';
    Object.entries(m.containerAttrs || {}).forEach(([k, v]) => div.setAttribute(k, v));
    mirror.appendChild(div);
    widgets[key] = new Cls(div.id, arg);
    window.activeWidgets.push(key);
    _scaleRo?.observe(div);
  }
  for (const key of window.activeWidgets.filter(k => k.includes(':') && !keys.has(k))) {
    widgets[key]?.destroy?.();
    delete widgets[key];
    document.getElementById(`widget-${key}`)?.remove();
    window.activeWidgets.splice(window.activeWidgets.indexOf(key), 1);
  }
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
    // 1/1 = "hidden in this layout": display:none so it costs no layout, paint or animation
    el.style.display = (pos.row === '1 / 1') ? 'none' : '';
  }
  // Opt-in widgets (placed tiles, the Home button) show only in templates that place them
  for (const w of window.activeWidgets) {
    if (_optIn(w) && !template.widgets?.[w]) document.getElementById(`widget-${w}`).style.display = 'none';
  }

  // Scale after positions are set, so --wu matches the new cells in the same frame
  initWidgetScale();
  _flushPending();
}

// Render data parked while a widget was hidden (or the display asleep), visible widgets only
function _flushPending() {
  if (_sleeping) return;
  for (const w of window.activeWidgets) {
    const widget = widgets[w];
    if (!widget || !widget._pendingData || _isWidgetHidden(w)) continue;
    const data = widget._pendingData;
    widget._pendingData = null;
    if (widget._rendered && typeof widget.update === 'function') widget.update(data);
    else if (typeof widget.render === 'function') { widget.render(data); widget._rendered = true; }
  }
}

// Not shown unless a template places it: `base:arg` instances and manifests with "optIn"
function _optIn(name) {
  return name.includes(':') || !!window.widgetManifests?.[name]?.optIn;
}

// Phase 4d: Check if a widget is hidden in the current layout template
function _isWidgetHidden(name) {
  const key = _templateKeys[_currentIdx];
  const template = _layoutTemplates[key];
  if (!template?.widgets?.[name]) return _optIn(name);
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
  if (!window.__CONFIG__) _reveal(); // with injected config the bootstrap reveals, after fonts
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

// ── Restart (from the radial menu or the phone) ───────────────────────────────
// Server broadcasts 'restarting' then exits; start.sh respawns it. Black overlay until then.
// Polls instead of waiting for ws.js to reconnect: its doubling backoff would add seconds.
let _restarting = false;
function showRestartOverlay() {
  if (_restarting) return;
  _restarting = true;
  closeMenu();
  document.getElementById('restart-overlay').classList.remove('hidden');
  const text = document.getElementById('restart-text');
  const t0 = Date.now();
  let wasDown = false;  // the old server answers for ~0.5 s after the broadcast — wait for it to go away
  const poll = async () => {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (r.ok && wasDown) return location.reload();
    } catch { wasDown = true; }
    if (Date.now() - t0 > 60000) text.textContent = 'Still restarting — check the control app';
    setTimeout(poll, 1000);
  };
  setTimeout(poll, 1000);
}
WS.on('restarting', showRestartOverlay);

const btnRestart   = document.getElementById('btn-restart');
const restartLabel = document.getElementById('restart-label');
let _restartArmed = null;  // first tap arms for 3 s so a stray touch on the IR frame can't restart
btnRestart.addEventListener('click', () => {
  if (!_restartArmed) {
    restartLabel.hidden = false;
    btnRestart.classList.add('active');
    _restartArmed = setTimeout(() => {
      _restartArmed = null;
      restartLabel.hidden = true;
      btnRestart.classList.remove('active');
    }, 3000);
    return;
  }
  clearTimeout(_restartArmed);
  showRestartOverlay();  // show now; don't depend on the broadcast making it back
  fetch('/api/restart', { method: 'POST' }).catch(() => {});
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
  // Waking: draw the latest data now, while the display spends ~3 s powering up
  if (!on) { _flushPending(); window.HA?.wake(); }
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

// Wake on first contact: the IR frame's taps jitter, so Chromium often never turns them into a click
sleepOverlay.addEventListener('pointerdown', () => {
  if (!_sleeping) return;
  setSleep(false);
  // Keep the (black) overlay until the touch ends, so the rest of this tap can't press a widget.
  // The display needs ~3 s to power up, so this costs nothing visible.
  sleepOverlay.classList.remove('hidden');
  const release = () => { if (!_sleeping) sleepOverlay.classList.add('hidden'); };
  sleepOverlay.addEventListener('click', release, { once: true });
  setTimeout(release, 700);  // no click arrives when the tap jittered
});

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
    _applyTemplate(_currentIdx);  // also renders widgets that just became visible

    // Widgets that fit content to their size do it now instead of after their debounced observers
    for (const w of window.activeWidgets) if (!_isWidgetHidden(w)) widgets[w]?.relayout?.();

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
  hue_scenes: { cols: 1.5, rows: 8 },
  ha_home:  { cols: 2, rows: 2 },
  ha_tile:  { cols: 2, rows: 8 },   // per placed device (`ha_tile:<entity>`): one Hue room card
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
    const ref = WIDGET_REFS[w] || WIDGET_REFS[w.split(':')[0]];
    if (ref) {
      const W_ref = ref.cols * colWidth;
      const H_ref = ref.rows * rowHeight;

      let ratio = 1.0;
      if (W_ref > 0 && H_ref > 0 && W_cur > 0 && H_cur > 0) {
        // Height-driven like Hue, so a tile as tall as the Hue widget gets exactly its sizes
        if (w === 'hue' || w === 'hue_scenes' || w.startsWith('ha_tile:')) {
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
