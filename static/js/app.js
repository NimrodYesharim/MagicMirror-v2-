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

// ── Bootstrap: load config + widget data via REST, don't wait for WS ─────────
async function _tryFetchJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

(async () => {
  const promises = [
    _tryFetchJson('/api/config/layout'),
    _tryFetchJson('/api/config/display'),
  ];
  
  // Dynamically fetch data for all active widgets that have a data endpoint
  // Note: Some widgets like datetime don't need data from the backend.
  window.activeWidgets.forEach(w => {
    promises.push(_tryFetchJson(`/api/data/${w}`).then(data => ({ widget: w, data })));
  });

  const results = await Promise.all(promises);
  const layout = results[0];
  const display = results[1];
  
  if (layout)  applyLayout(layout);
  if (display) applyDisplay(display);
  _reveal();
  
  for (let i = 2; i < results.length; i++) {
    const { widget, data } = results[i];
    if (data && widgets[widget] && typeof widgets[widget].render === 'function') {
      widgets[widget].render(data);
      if (widget === 'hue') widgets[widget]._rendered = true;
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

  for (const [name, pos] of Object.entries(template.widgets || {})) {
    const el = document.getElementById(`widget-${name}`);
    if (!el) continue;
    el.style.gridRow    = pos.row;
    el.style.gridColumn = pos.column;
    // Hide widget if positioned at 1/1 (sentinel for "hidden in this layout")
    el.style.visibility = (pos.row === '1 / 1') ? 'hidden' : 'visible';
  }
}

// ── Display config ─────────────────────────────────────────────────────────────
function applyDisplay(display) {
  if (!display) return;
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
}

// ── Reveal mirror after layout is ready ───────────────────────────────────────
let _revealed = false;
function _reveal() {
  if (_revealed) return;
  _revealed = true;
  document.getElementById('mirror').style.opacity         = '1';
  document.getElementById('controls').style.opacity       = '1';
  document.getElementById('layout-switcher').style.opacity = '1';
}

// Fallback: show mirror after 4 s even if WS never delivers config
setTimeout(_reveal, 4000);

// ── WebSocket handlers ────────────────────────────────────────────────────────
WS.on('config', ({ layout, display }) => {
  applyLayout(layout);
  applyDisplay(display);
  _reveal(); // no-op if already revealed by REST bootstrap
});

// Dynamic websocket dispatcher
window.activeWidgets.forEach(w => {
  let wsType = w;
  // Special mapping for hue and redalert based on existing WS logic
  if (w === 'hue') wsType = 'hue_state';
  if (w === 'redalert') wsType = 'red_alert';
  
  WS.on(wsType, data => {
    if (w === 'hue') {
      if (!widgets.hue._rendered) {
        widgets.hue.render(data);
      } else {
        widgets.hue.update(data);
      }
    } else if (w === 'redalert') {
      if (typeof RedAlert !== 'undefined') RedAlert.handle(data);
      else if (widgets.redalert) widgets.redalert.handle(data);
    } else if (widgets[w] && typeof widgets[w].render === 'function') {
      widgets[w].render(data);
    }
  });
});

WS.on('hard_reload', () => {
  location.reload();
});

// ── Sleep overlay ─────────────────────────────────────────────────────────────
const sleepOverlay = document.getElementById('sleep-overlay');
const btnSleep     = document.getElementById('btn-sleep');

function setSleep(on) {
  // The sleep overlay covers #mirror but NOT #controls or #layout-switcher
  // (those are fixed with z-index 500; sleep-overlay is z-index 1000 but
  //  we exclude controls by setting pointer-events differently)
  sleepOverlay.classList.toggle('hidden', !on);
  btnSleep.classList.toggle('active', on);
}

btnSleep.addEventListener('click', () => setSleep(sleepOverlay.classList.contains('hidden')));

// Tap the dark area (not controls) to wake
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
});

// ── Widget scale (fonts, icons, padding) track grid cell size ─────────────────
function initWidgetScale() {
  const setWu = (el) => {
    const w = el.clientWidth;
    const h = el.dataset.wuBase ? parseInt(el.dataset.wuBase) : el.clientHeight;
    const m = Math.max(1, Math.min(w, h));
    el.style.setProperty('--wu', `${m / 360}px`);
  };
  document.querySelectorAll('#mirror > .widget').forEach((el) => {
    setWu(el);
    new ResizeObserver(() => setWu(el)).observe(el);
  });
}
initWidgetScale();

// ── Start WebSocket ───────────────────────────────────────────────────────────
WS.start();
