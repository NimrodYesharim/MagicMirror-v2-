// ── State ─────────────────────────────────────────────────────────────────────
let _wsConnected = false;
let _svcStatus   = { weather: false, calendar: false, hue: false, news: false };
let _layout      = null;       // full layout config from server
let _editLayout  = null;       // working copy being edited
let _editTpl     = null;       // template key being edited
let _selWidget   = null;       // selected widget key in layout editor
let _configs     = {};         // cached configs per section
let _saveHandler = null;       // current detail-panel save function
let _sysInfo     = {};         // loaded from /api/system/info

// ── DOM refs ──────────────────────────────────────────────────────────────────
const app         = document.getElementById('app');
const statusDot   = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const logOutput   = document.getElementById('log-output');

// ── Helpers ───────────────────────────────────────────────────────────────────
function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isErr ? 'rgba(120,20,20,0.95)' : 'rgba(50,50,52,0.95)';
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Action Sheet ──────────────────────────────────────────────────────────────
function actionSheet(title, msg, actions) {
  return new Promise(resolve => {
    const overlay = document.getElementById('action-sheet-overlay');
    const group   = document.getElementById('as-main-group');
    let html = '';
    if (title || msg) html += `<div class="as-title-row">${title ? `<div class="as-title">${esc(title)}</div>` : ''}${msg ? `<div class="as-msg">${esc(msg)}</div>` : ''}</div>`;
    actions.forEach(a => {
      html += `<button class="as-btn${a.danger ? ' destructive' : ''}" data-val="${esc(a.value || a.label)}">${esc(a.label)}</button>`;
    });
    group.innerHTML = html;
    overlay.classList.add('show');
    function handle(e) {
      const btn = e.target.closest('.as-btn');
      if (!btn) return;
      close(btn.dataset.val || null);
    }
    function close(val) {
      overlay.removeEventListener('click', handle);
      overlay.classList.remove('show');
      resolve(val);
    }
    overlay.addEventListener('click', handle);
    document.getElementById('as-cancel-btn').onclick = () => close(null);
  });
}

function confirm(title, msg, destructiveLabel = 'Confirm') {
  return actionSheet(title, msg, [{ label: destructiveLabel, danger: true, value: 'ok' }]).then(v => v === 'ok');
}

// ── Input prompt (native) ─────────────────────────────────────────────────────
function promptVal(msg, defaultVal = '') {
  return new Promise(resolve => {
    const v = window.prompt(msg, defaultVal);
    resolve(v);
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
let _activeTab = 'dashboard';
let _inDetail  = false;

const TAB_TITLES = { dashboard: 'Dashboard', layout: 'Layout', settings: 'Settings', logs: 'Logs' };

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (_inDetail) popDetail();
    const page = btn.dataset.page;
    if (page === _activeTab && !_inDetail) return;
    switchTab(page);
  });
});

function switchTab(page) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active', 'slide-out'));
  const target = document.getElementById(`p-${page}`);
  if (target) target.classList.add('active');
  _activeTab = page;
  document.getElementById('nav-page-title').textContent = TAB_TITLES[page] || page;
  if (page === 'layout') initLayoutEditor();
}

// Set initial title
document.getElementById('nav-page-title').textContent = TAB_TITLES[_activeTab];

function pushDetail(title, renderFn, saveFn) {
  _inDetail = true;
  _saveHandler = saveFn || null;
  const panel = document.getElementById('settings-panel');
  const body  = document.getElementById('settings-panel-body');
  body.innerHTML = '';
  renderFn(body);
  // slide out current page
  document.querySelectorAll('.page.active').forEach(p => p.classList.add('slide-out'));
  panel.classList.add('active');
  // update navbar
  app.classList.add('detail-mode');
  document.getElementById('nav-page-title').textContent = title;
  document.getElementById('nav-back-label').textContent = _activeTab.charAt(0).toUpperCase() + _activeTab.slice(1);
  const saveBtn = document.getElementById('nav-save-btn');
  saveBtn.style.display = _saveHandler ? '' : 'none';
}

function popDetail() {
  _inDetail = false;
  _saveHandler = null;
  const panel = document.getElementById('settings-panel');
  panel.classList.remove('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('slide-out'));
  app.classList.remove('detail-mode');
  document.getElementById('nav-page-title').textContent = TAB_TITLES[_activeTab] || _activeTab;
}

document.getElementById('nav-back').addEventListener('click', () => {
  if (_inDetail) popDetail();
});

document.getElementById('nav-save-btn').addEventListener('click', () => {
  if (_saveHandler) _saveHandler();
});

// ── Status ────────────────────────────────────────────────────────────────────
function updateStatus() {
  if (!_wsConnected) {
    statusDot.className = 'red';
    statusLabel.textContent = 'Offline';
    return;
  }
  const vals  = Object.values(_svcStatus);
  const count = vals.filter(Boolean).length;
  if (count === 0)           { statusDot.className = 'orange'; statusLabel.textContent = 'No data'; }
  else if (count < vals.length) { statusDot.className = 'yellow'; statusLabel.textContent = `${count}/${vals.length}`; }
  else                       { statusDot.className = 'green';  statusLabel.textContent = 'Online'; }
}

async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return;
    _svcStatus = await r.json();
    updateStatus();
    renderServices();
  } catch {}
}

// ── Services ──────────────────────────────────────────────────────────────────
const SVC_META = {
  weather:  { label: 'Weather',    color: '#0A84FF' },
  calendar: { label: 'Calendar',   color: '#FF453A' },
  hue:      { label: 'Hue Lights', color: '#FFD60A' },
  news:     { label: 'News',       color: '#FF9F0A' },
};

function renderServices() {
  const el = document.getElementById('services-list');
  if (!el) return;
  el.innerHTML = Object.entries(SVC_META).map(([k, m]) => {
    const ok = _svcStatus[k];
    return `<div class="row" style="cursor:default">
      <div class="row-body"><div class="row-label">${m.label}</div></div>
      <div class="row-right" style="display:flex;align-items:center;gap:8px">
        <span style="font-size:14px;color:${ok ? 'var(--green)' : 'var(--label3)'}">${ok ? 'Active' : 'No data'}</span>
        <span class="svc-dot ${ok ? 'ok' : 'err'}"></span>
      </div>
    </div>`;
  }).join('');
}

// ── Layout Quick Switcher (dashboard) ─────────────────────────────────────────
function renderLayoutQuick(layout) {
  if (!layout) return;
  _layout = layout;
  const el = document.getElementById('layout-quick');
  if (!el) return;
  const current   = layout.current || '';
  const templates = layout.templates || {};
  el.innerHTML = Object.keys(templates).map(key => {
    const label = templates[key]?.label || key;
    const active = key === current;
    return `<button style="
      padding: 7px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
      border: 0.5px solid ${active ? 'var(--blue)' : 'var(--sep)'};
      background: ${active ? 'var(--blue)' : 'var(--bg3)'};
      color: ${active ? '#fff' : 'var(--label2)'};
      cursor: pointer;
      transition: background 0.15s;
    " data-key="${esc(key)}">${esc(label)}</button>`;
  }).join('');
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key     = btn.dataset.key;
      const updated = { ..._layout, current: key };
      try {
        const r = await fetch('/api/config/layout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        });
        if (r.ok) {
          _layout = updated;
          renderLayoutQuick(_layout);
          logLine({ time: now(), level: 'INFO', msg: `Layout → ${key}` });
        }
      } catch (e) { logLine({ time: now(), level: 'ERROR', msg: e.message }); }
    });
  });
}

// ── Quick Actions ─────────────────────────────────────────────────────────────
async function doAction(url, method = 'POST', label = '') {
  logLine({ time: now(), level: 'INFO', msg: label || url });
  try {
    const r = await fetch(url, { method });
    if (!r.ok) logLine({ time: now(), level: 'ERROR', msg: `${url} → ${r.status}` });
    return r.ok;
  } catch (e) {
    logLine({ time: now(), level: 'ERROR', msg: e.message });
    return false;
  }
}

document.getElementById('btn-refresh').addEventListener('click', async () => {
  showToast('Refreshing…');
  await doAction('/api/refresh', 'POST', 'Refreshing data…');
  await pollStatus();
  showToast('Done');
});

document.getElementById('btn-hard-reload').addEventListener('click', async () => {
  showToast('Reloading mirror…');
  await doAction('/api/refresh', 'POST');
  await doAction('/api/hard-reload', 'POST', 'Hard reload mirror');
});

// Both restarts take this process down too; WS 'open' below announces when it's back
let _awaitingRestart = false;
document.getElementById('btn-restart').addEventListener('click', async () => {
  const ok = await confirm('Restart Mirror?', 'Restarts the server. The mirror shows a black "Restarting…" screen and comes back in a few seconds.', 'Restart');
  if (ok) {
    _awaitingRestart = true;
    showToast('Restarting…');
    doAction('/api/restart', 'POST', 'Restarting mirror…');
  }
});

document.getElementById('btn-restart-kiosk').addEventListener('click', async () => {
  const ok = await confirm('Restart Kiosk?', 'Restarts the server and the browser. Use this if the mirror screen is frozen.', 'Restart');
  if (ok) {
    _awaitingRestart = true;
    showToast('Restarting kiosk…');
    doAction('/api/restart-kiosk', 'POST', 'Restarting kiosk…');
  }
});

document.getElementById('btn-reboot').addEventListener('click', async () => {
  const ok = await confirm('End Mirror Process?', 'The kiosk window and server process will be closed. The mirror display will go offline.', 'End Process');
  if (ok) {
    showToast('Ending process…');
    doAction('/api/reboot', 'POST', 'Ending mirror process…');
  }
});

document.getElementById('btn-system-reboot').addEventListener('click', async () => {
  const ok = await confirm('Reboot Pi?', 'The Raspberry Pi will restart. The mirror will come back online after reboot.', 'Reboot');
  if (ok) {
    showToast('Rebooting…');
    doAction('/api/system-reboot', 'POST', 'Rebooting Pi…');
  }
});

document.getElementById('btn-shutdown').addEventListener('click', async () => {
  const ok = await confirm('Shut Down Pi?', 'You will need to physically power it back on.', 'Shut Down');
  if (ok) {
    showToast('Shutting down…');
    doAction('/api/shutdown', 'POST', 'Shutting down Pi…');
  }
});

// ── Layout Editor ─────────────────────────────────────────────────────────────
const WIDGET_COLORS = {
  datetime: '#0A84FF', weather: '#FF9F0A', calendar: '#BF5AF2',
  hue: '#FFD60A', news: '#30D158', redalert: '#FF453A',
};
const WIDGET_NAMES = {
  datetime: 'Date & Time', weather: 'Weather', calendar: 'Calendar',
  hue: 'Hue', news: 'News', redalert: 'Red Alert',
};

function parsePos(posStr) {
  if (!posStr) return [1, 2];
  const [a, b] = String(posStr).split('/').map(s => parseInt(s.trim(), 10));
  return [isNaN(a) ? 1 : a, isNaN(b) ? 2 : b];
}

function isHidden(w) {
  const r = parsePos(w.row);
  const c = parsePos(w.column);
  return r[0] === r[1] || c[0] === c[1] || (r[0] === 1 && r[1] === 1) || (c[0] === 1 && c[1] === 1);
}

function initLayoutEditor() {
  if (!_layout) {
    fetch('/api/config/layout').then(r => r.ok ? r.json() : null).then(d => {
      if (d) { _layout = d; _startEdit(); }
    }).catch(() => {});
  } else {
    _startEdit();
  }
}

function _startEdit() {
  _editLayout = JSON.parse(JSON.stringify(_layout));
  _editTpl    = _editLayout.current || Object.keys(_editLayout.templates || {})[0] || '';
  _selWidget  = null;
  renderTemplateScroll();
  renderLayoutPreview();
  renderWidgetList();
  hideEditPanel();
}

function renderTemplateScroll() {
  const scroll = document.getElementById('layout-template-scroll');
  if (!scroll || !_editLayout) return;
  const templates = _editLayout.templates || {};
  let html = '';
  Object.keys(templates).forEach(key => {
    const label  = templates[key]?.label || key;
    const active = key === _editTpl;
    html += `<button class="tpl-pill${active ? ' active' : ''}" data-tpl="${esc(key)}">${esc(label)}</button>`;
  });
  html += `<button class="tpl-pill add-pill" id="btn-add-tpl">+ New</button>`;
  scroll.innerHTML = html;
  scroll.querySelectorAll('.tpl-pill[data-tpl]').forEach(btn => {
    btn.addEventListener('click', () => {
      _editTpl = btn.dataset.tpl;
      _selWidget = null;
      renderTemplateScroll();
      renderLayoutPreview();
      renderWidgetList();
      hideEditPanel();
    });
  });
  document.getElementById('btn-add-tpl').onclick = addTemplate;

  // Template options bindings
  const tpl = templates[_editTpl];
  if (tpl) {
    const ssTog = document.getElementById('show-seconds-toggle');
    if (ssTog) {
      ssTog.checked = tpl.show_seconds === true;
      ssTog.onchange = () => { tpl.show_seconds = ssTog.checked; };
    }
    const scaleSel = document.getElementById('tpl-scale');
    if (scaleSel) {
      scaleSel.value = String(tpl.ui_scale ?? 360);
      scaleSel.onchange = () => { tpl.ui_scale = parseInt(scaleSel.value, 10); };
    }
  }
}

function getTplWidgets() {
  if (!_editLayout || !_editTpl) return {};
  return (_editLayout.templates[_editTpl] || {}).widgets || {};
}

function renderLayoutPreview() {
  const preview = document.getElementById('layout-preview');
  if (!preview) return;
  const widgets = getTplWidgets();
  const W = 156, H = 312;
  const cw = W / 12, rh = H / 24;
  // remove old widget elements (keep ::before grid lines)
  preview.querySelectorAll('.preview-widget').forEach(e => e.remove());
  Object.entries(WIDGET_NAMES).forEach(([key]) => {
    const pos = widgets[key] || {};
    const [rs, re] = parsePos(pos.row    || '1/2');
    const [cs, ce] = parsePos(pos.column || '1/2');
    const hidden = isHidden(pos);
    const left   = (cs - 1) * cw;
    const top    = (rs - 1) * rh;
    const width  = Math.max((ce - cs) * cw - 1, 4);
    const height = Math.max((re - rs) * rh - 1, 4);
    const div = document.createElement('div');
    div.className = `preview-widget${hidden ? ' hidden' : ''}${_selWidget === key ? ' selected' : ''}`;
    div.dataset.w = key;
    div.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    if (width > 28 && height > 10) div.textContent = key.substring(0, 3).toUpperCase();
    div.addEventListener('click', () => selectWidget(key));
    preview.appendChild(div);
  });
}

function renderWidgetList() {
  const list = document.getElementById('layout-widget-list');
  if (!list) return;
  const widgets = getTplWidgets();
  list.innerHTML = Object.entries(WIDGET_NAMES).map(([key, name]) => {
    const pos    = widgets[key] || {};
    const hidden = isHidden(pos);
    const color  = WIDGET_COLORS[key] || '#888';
    const sel    = _selWidget === key;
    return `<div class="widget-row${sel ? ' selected' : ''}" data-wkey="${esc(key)}">
      <span class="widget-color-dot" style="background:${color}"></span>
      <span class="widget-row-name" style="color:var(--label${sel ? '' : '2'})">${esc(name)}</span>
      <label class="ios-toggle" style="transform:scale(0.72);transform-origin:right center">
        <input type="checkbox" data-wtoggle="${esc(key)}"${hidden ? '' : ' checked'}>
        <span class="ios-toggle-track"></span>
      </label>
    </div>`;
  }).join('');

  list.querySelectorAll('.widget-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.ios-toggle')) return;
      selectWidget(row.dataset.wkey);
    });
  });

  list.querySelectorAll('[data-wtoggle]').forEach(chk => {
    chk.addEventListener('change', () => {
      const key     = chk.dataset.wtoggle;
      const widgets = getTplWidgets();
      if (!widgets[key]) widgets[key] = { row: '1/5', column: '1/13' };
      if (chk.checked) {
        if (isHidden(widgets[key])) {
          widgets[key].row    = '1/5';
          widgets[key].column = '1/13';
        }
      } else {
        widgets[key].row    = '1/1';
        widgets[key].column = '1/1';
      }
      renderLayoutPreview();
    });
  });
}

function selectWidget(key) {
  _selWidget = key;
  renderLayoutPreview();
  renderWidgetList();
  showEditPanel(key);
}

function showEditPanel(key) {
  const panel   = document.getElementById('widget-edit-panel');
  const widgets = getTplWidgets();
  const pos     = widgets[key] || { row: '1/5', column: '1/13' };
  const [rs, re] = parsePos(pos.row    || '1/5');
  const [cs, ce] = parsePos(pos.column || '1/13');
  document.getElementById('ep-title').textContent = WIDGET_NAMES[key] || key;
  document.getElementById('ep-color-dot').style.background = WIDGET_COLORS[key] || '#888';
  setSlider('ep-row-start', 'ep-rs-val', rs, 1,  24);
  setSlider('ep-row-end',   'ep-re-val', re, 2,  25);
  setSlider('ep-col-start', 'ep-cs-val', cs, 1,  12);
  setSlider('ep-col-end',   'ep-ce-val', ce, 2,  13);
  panel.classList.add('visible');
  // scroll panel into view
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function setSlider(inputId, valId, value, min, max) {
  const input = document.getElementById(inputId);
  const val   = document.getElementById(valId);
  input.min   = min;
  input.max   = max;
  input.value = value;
  val.textContent = value;
  input.oninput = () => {
    val.textContent = input.value;
    commitWidgetEdit();
  };
}

function commitWidgetEdit() {
  if (!_selWidget || !_editTpl) return;
  const rs = parseInt(document.getElementById('ep-row-start').value, 10);
  const re = parseInt(document.getElementById('ep-row-end').value,   10);
  const cs = parseInt(document.getElementById('ep-col-start').value, 10);
  const ce = parseInt(document.getElementById('ep-col-end').value,   10);
  const widgets = getTplWidgets();
  if (!widgets[_selWidget]) widgets[_selWidget] = {};
  widgets[_selWidget].row    = `${rs}/${Math.max(re, rs + 1)}`;
  widgets[_selWidget].column = `${cs}/${Math.max(ce, cs + 1)}`;
  renderLayoutPreview();
}

function hideEditPanel() {
  document.getElementById('widget-edit-panel').classList.remove('visible');
}

// Template management
async function addTemplate() {
  const name = await promptVal('Template name:');
  if (!name) return;
  const key = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  if (!key || _editLayout.templates[key]) { showToast('Invalid or duplicate name', true); return; }
  _editLayout.templates[key] = {
    label: name,
    widgets: JSON.parse(JSON.stringify(getTplWidgets())),
  };
  _editTpl = key;
  renderTemplateScroll();
  renderLayoutPreview();
  renderWidgetList();
}

document.getElementById('btn-tpl-rename').addEventListener('click', async () => {
  const tpl  = _editLayout?.templates?.[_editTpl];
  if (!tpl) return;
  const name = await promptVal('New name:', tpl.label);
  if (!name) return;
  tpl.label = name;
  renderTemplateScroll();
});

document.getElementById('btn-tpl-default').addEventListener('click', () => {
  if (!_editLayout || !_editTpl) return;
  _editLayout.current = _editTpl;
  showToast(`Default → ${_editLayout.templates[_editTpl]?.label || _editTpl}`);
});

document.getElementById('btn-tpl-delete').addEventListener('click', async () => {
  const keys = Object.keys(_editLayout?.templates || {});
  if (keys.length <= 1) { showToast('Cannot delete last template', true); return; }
  const ok = await confirm('Delete Template?', `"${_editLayout.templates[_editTpl]?.label || _editTpl}" will be removed.`, 'Delete');
  if (!ok) return;
  delete _editLayout.templates[_editTpl];
  _editTpl = Object.keys(_editLayout.templates)[0];
  if (_editLayout.current === _editTpl) _editLayout.current = _editTpl;
  renderTemplateScroll();
  renderLayoutPreview();
  renderWidgetList();
  hideEditPanel();
});

document.getElementById('btn-layout-save').addEventListener('click', async () => {
  if (!_editLayout) return;
  try {
    const r = await fetch('/api/config/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_editLayout),
    });
    if (r.ok) {
      _layout = JSON.parse(JSON.stringify(_editLayout));
      renderLayoutQuick(_layout);
      logLine({ time: now(), level: 'INFO', msg: 'Layout saved' });
      showToast('Layout saved');
    } else {
      showToast('Save failed', true);
    }
  } catch (e) {
    showToast(e.message, true);
  }
});

document.getElementById('btn-layout-discard').addEventListener('click', () => {
  _startEdit();
  showToast('Changes discarded');
});

// ── Settings ──────────────────────────────────────────────────────────────────
document.querySelectorAll('#p-settings [data-section]').forEach(row => {
  row.addEventListener('click', () => openSettings(row.dataset.section));
});

async function openSettings(section) {
  // load config if needed
  const apiSections = ['weather', 'calendar', 'news', 'hue', 'display', 'redalert'];
  if (apiSections.includes(section) && !_configs[section]) {
    try {
      const r = await fetch(`/api/config/${section}`);
      if (r.ok) _configs[section] = await r.json();
    } catch {}
  }

  const renderers = {
    weather:     renderWeatherSettings,
    calendar:    renderCalendarSettings,
    news:        renderNewsSettings,
    hue:         renderHueSettings,
    display:     renderDisplaySettings,
    redalert:    renderRedalertSettings,
    setup:       renderSetupSection,
    'server-info': renderServerInfoSection,
  };

  const titles = {
    weather: 'Weather', calendar: 'Calendar', news: 'News',
    hue: 'Hue Lights', display: 'Display', redalert: 'Red Alert',
    setup: 'Certificate', 'server-info': 'Server Info',
  };

  const hasSave = ['weather','calendar','news','hue','display','redalert'].includes(section);

  pushDetail(
    titles[section] || section,
    body => renderers[section]?.(body, _configs[section] || {}),
    hasSave ? () => saveSettings(section) : null
  );

  // update summary values
  updateSettingsSummaries();
}

function updateSettingsSummaries() {
  const sums = {
    weather:  _configs.weather?.city || '',
    calendar: `${(_configs.calendar?.calendars || []).length} cal`,
    news:     _configs.news?.country || '',
    hue:      _configs.hue?.bridge_ip || '',
    redalert: _configs.redalert?.enabled ? 'On' : 'Off',
  };
  Object.entries(sums).forEach(([k, v]) => {
    const el = document.getElementById(`sval-${k}`);
    if (el) el.textContent = v;
  });
}


function collectForm(container) {
  const data = {};
  container.querySelectorAll('[data-field]').forEach(el => {
    const key = el.dataset.field;
    if (el.type === 'checkbox') data[key] = el.checked;
    else if (el.type === 'number' || el.dataset.type === 'number') data[key] = Number(el.value);
    else data[key] = el.value;
  });
  return data;
}

// Form builders
function buildRow(label, inputHtml, sublabel = '') {
  return `<div class="row">
    <div class="row-body"><div class="row-label">${esc(label)}</div>${sublabel ? `<div class="row-sublabel">${sublabel}</div>` : ''}</div>
    ${inputHtml}
  </div>`;
}

function textField(key, value, placeholder = '', type = 'text') {
  return `<input class="row-input" type="${type}" data-field="${esc(key)}" value="${esc(value || '')}" placeholder="${esc(placeholder)}">`;
}

function selectField(key, value, options) {
  const opts = options.map(o => `<option value="${esc(o.v)}"${o.v == value ? ' selected' : ''}>${esc(o.l)}</option>`).join('');
  return `<select class="row-input" data-field="${esc(key)}">${opts}</select>`;
}

function toggleField(key, checked) {
  return `<label class="ios-toggle"><input type="checkbox" data-field="${esc(key)}"${checked ? ' checked' : ''}><span class="ios-toggle-track"></span></label>`;
}

function renderWeatherSettings(body, cfg) {
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">API</div>
    <div class="card">
      ${buildRow('API Key', textField('api_key', cfg.api_key, 'OpenWeatherMap key', 'password'))}
      ${buildRow('City', textField('city', cfg.city, 'e.g. Tel Aviv'))}
    </div>
    <div class="sec-header">Units & Language</div>
    <div class="card">
      ${buildRow('Units', selectField('units', cfg.units, [{v:'metric',l:'Celsius (°C)'},{v:'imperial',l:'Fahrenheit (°F)'}]))}
      ${buildRow('Language', textField('language', cfg.language, 'e.g. he, en'), 'ISO 639-1 code')}
    </div>
    <div class="sec-header">Rate Limiting</div>
    <div class="card">
      ${buildRow('Calls / Day', `<input class="row-input" type="number" data-field="calls_per_day" data-type="number" value="${esc(cfg.calls_per_day || 48)}" min="1" max="1000">`)}
    </div>
    <div class="sec-footer">Interval = 86400 ÷ calls_per_day seconds.</div>
  `;
}

function renderCalendarSettings(body, cfg) {
  const cals = (cfg.calendars || []);
  const calRows = cals.map((c, i) => `
    <div class="row">
      <span class="cal-color-dot" style="background:${esc(c.color || '#888')}"></span>
      <div class="row-body">
        <div class="row-label">${esc(c.name || c.id)}</div>
        <div class="row-sublabel">${esc(c.id)}</div>
      </div>
      <button style="color:var(--red);font-size:13px;padding:4px 8px;flex-shrink:0" data-rmcal="${i}">Remove</button>
    </div>`).join('');
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">Calendars</div>
    <div class="card" id="cal-list">
      ${calRows || '<div class="row" style="cursor:default"><div class="row-body"><div class="row-label" style="color:var(--label3)">No calendars added</div></div></div>'}
      <div class="row tap action-row" id="btn-detect-cals"><div class="row-body"><div class="row-label" style="color:var(--blue)">Detect from Google…</div></div></div>
      <div class="row tap action-row" id="btn-add-cal"><div class="row-body"><div class="row-label" style="color:var(--blue)">Add Manually…</div></div></div>
    </div>
    <div class="sec-header">Options</div>
    <div class="card">
      ${buildRow('Max Events', `<input class="row-input" type="number" data-field="max_results" data-type="number" value="${esc(cfg.max_results || 10)}" min="1" max="50">`)}
      ${buildRow('Refresh (min)', `<input class="row-input" type="number" data-field="refresh_interval_minutes" data-type="number" value="${esc(cfg.refresh_interval_minutes || 5)}" min="1">`)}
      ${buildRow('Hebrew RTL', toggleField('hebrew', cfg.hebrew))}
    </div>
  `;
  body.querySelectorAll('[data-rmcal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.rmcal, 10);
      _configs.calendar.calendars.splice(i, 1);
      renderCalendarSettings(body, _configs.calendar);
    });
  });
  body.querySelector('#btn-detect-cals')?.addEventListener('click', async () => {
    showToast('Fetching calendars…');
    try {
      const r    = await fetch('/api/calendar/list-all');
      if (!r.ok) { showToast(r.status === 503 ? 'Not authenticated — connect Google Calendar first' : 'Fetch failed', true); return; }
      const list = await r.json(); // [{id, name, color}]
      if (!list.length) { showToast('No calendars found', true); return; }
      // Show action sheet to pick which ones to add
      const existing = new Set((cfg.calendars || []).map(c => c.id));
      const toAdd    = list.filter(c => !existing.has(c.id));
      if (!toAdd.length) { showToast('All calendars already added'); return; }
      const choice = await actionSheet(
        'Detected Calendars',
        'Tap to add all, or add individually below.',
        [
          { label: `Add all ${toAdd.length} calendars`, value: 'all' },
          ...toAdd.map(c => ({ label: c.name, value: c.id })),
        ]
      );
      if (!choice) return;
      if (!_configs.calendar.calendars) _configs.calendar.calendars = [];
      if (choice === 'all') {
        toAdd.forEach(c => _configs.calendar.calendars.push(c));
        showToast(`Added ${toAdd.length} calendars`);
      } else {
        const cal = toAdd.find(c => c.id === choice);
        if (cal) { _configs.calendar.calendars.push(cal); showToast(`Added: ${cal.name}`); }
      }
      renderCalendarSettings(body, _configs.calendar);
    } catch (e) { showToast(e.message, true); }
  });
  body.querySelector('#btn-add-cal')?.addEventListener('click', async () => {
    const id    = await promptVal('Calendar ID (from Google Calendar):');
    if (!id) return;
    const name  = await promptVal('Display name:', id);
    const color = await promptVal('Color (hex):', '#3a7eff');
    if (!_configs.calendar.calendars) _configs.calendar.calendars = [];
    _configs.calendar.calendars.push({ id, name: name || id, color: color || '#3a7eff' });
    renderCalendarSettings(body, _configs.calendar);
  });
}

function renderNewsSettings(body, cfg) {
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">API</div>
    <div class="card">
      ${buildRow('API Key', textField('api_key', cfg.api_key, 'NewsAPI key', 'password'))}
    </div>
    <div class="sec-header">Content</div>
    <div class="card">
      ${buildRow('Query', textField('q', cfg.q, 'e.g. technology'))}
      ${buildRow('Country', textField('country', cfg.country, 'e.g. us, il'), 'ISO 3166-1 alpha-2')}
      ${buildRow('Language', textField('language', cfg.language, 'e.g. he, en'))}
      ${buildRow('Max Articles', `<input class="row-input" type="number" data-field="max_articles" data-type="number" value="${esc(cfg.max_articles || 7)}" min="1" max="50">`)}
    </div>
    <div class="sec-header">Rate Limiting</div>
    <div class="card">
      ${buildRow('Calls / Day', `<input class="row-input" type="number" data-field="calls_per_day" data-type="number" value="${esc(cfg.calls_per_day || 100)}" min="1" max="100">`)}
    </div>
    <div class="sec-footer">Free plan maximum is 100 requests/day (one every 14.4 min).</div>
  `;
}

function renderHueSettings(body, cfg) {
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">Bridge</div>
    <div class="card">
      ${buildRow('Bridge IP', textField('bridge_ip', cfg.bridge_ip, '192.168.x.x'))}
      ${buildRow('Poll Interval (s)', `<input class="row-input" type="number" data-field="poll_interval" data-type="number" value="${esc(cfg.poll_interval || 3)}" min="1" max="60">`)}
    </div>
    <div class="sec-header">Pairing</div>
    <div class="card">
      <div class="row tap action-row" id="btn-hue-pair">
        <div class="row-body"><div class="row-label">Pair Bridge</div><div class="row-sublabel">Press link button on bridge first</div></div>
        <div class="row-chev"><svg viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg></div>
      </div>
      <div class="row tap action-row" id="btn-hue-discover">
        <div class="row-body"><div class="row-label">Re-discover Rooms</div></div>
        <div class="row-chev"><svg viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg></div>
      </div>
    </div>
    <div class="sec-footer">Username is auto-filled during pairing and stored in hue.yaml.</div>
  `;
  body.querySelector('#btn-hue-pair')?.addEventListener('click', async () => {
    showToast('Pairing…');
    try {
      const r = await fetch('/api/hue/pair', { method: 'POST' });
      const d = await r.json();
      if (r.ok) showToast('Paired! ' + (d.username || ''));
      else showToast(d.detail || 'Pair failed', true);
    } catch (e) { showToast(e.message, true); }
  });
  body.querySelector('#btn-hue-discover')?.addEventListener('click', async () => {
    showToast('Discovering…');
    try {
      const r = await fetch('/api/hue/discover', { method: 'POST' });
      if (r.ok) showToast('Discovery complete');
      else showToast('Discovery failed', true);
    } catch (e) { showToast(e.message, true); }
  });
}

function renderDisplaySettings(body, cfg) {
  const scr = cfg.screen || {};
  const rl  = cfg.ring_light || {};
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">Server Ports</div>
    <div class="card">
      ${buildRow('Main (HTTPS)', `<input class="row-input" type="number" data-field="port" data-type="number" value="${esc(cfg.port || 8000)}">`)}
      ${buildRow('HTTP Redirect', `<input class="row-input" type="number" data-field="http_port" data-type="number" value="${esc(cfg.http_port || 8080)}">`)}
      ${buildRow('Control Panel', `<input class="row-input" type="number" data-field="control_port" data-type="number" value="${esc(cfg.control_port || 8001)}">`)}
    </div>
    <div class="sec-header">Screen</div>
    <div class="card">
      ${buildRow('Width (px)', `<input class="row-input" type="number" data-field="screen_width" data-type="number" value="${esc(scr.width || 1080)}">`)}
      ${buildRow('Height (px)', `<input class="row-input" type="number" data-field="screen_height" data-type="number" value="${esc(scr.height || 1920)}">`)}
    </div>
    <div class="sec-header">Ring Light</div>
    <div class="card">
      ${buildRow('Border Width (px)', `<input class="row-input" type="number" data-field="ring_border_width" data-type="number" value="${esc(rl.border_width || 120)}">`)}
      ${buildRow('Opacity', `<input class="row-input" type="number" data-field="ring_opacity" data-type="number" step="0.1" min="0" max="1" value="${esc(rl.opacity ?? 1)}">`)}
    </div>
    <div class="sec-header">Buttons & Pointer</div>
    <div class="card">
      ${buildRow('Ring Light Button', toggleField('ring_light_button', cfg.ring_light_button !== false))}
      ${buildRow('Sleep Button', toggleField('sleep_button', cfg.sleep_button !== false))}
      ${buildRow('Show Cursor', toggleField('show_cursor', cfg.show_cursor))}
    </div>
    <div class="sec-header">Rendering</div>
    <div class="card">
      ${buildRow('Graphics Quality', selectField('graphics', cfg.graphics || 'high', [{v:'high',l:'High (Blur)'},{v:'mid',l:'Mid (Optimized)'},{v:'low',l:'Low (Pi)'}]))}
    </div>
  `;
}

// Override collectForm for display (nested keys)
const _origCollect = collectForm;
async function saveSettings(section) {
  const body = document.getElementById('settings-panel-body');
  let data;
  if (section === 'display') {
    const raw    = _origCollect(body);
    const cfg    = _configs.display || {};
    data = {
      ...cfg,
      port:         raw.port,
      http_port:    raw.http_port,
      control_port: raw.control_port,
      screen: { width: raw.screen_width, height: raw.screen_height },
      ring_light: { border_width: raw.ring_border_width, opacity: raw.ring_opacity },
      ring_light_button: raw.ring_light_button,
      sleep_button:      raw.sleep_button,
      show_cursor:       raw.show_cursor,
      graphics:          raw.graphics,
    };
  } else if (section === 'calendar') {
    const raw = _origCollect(body);
    data = {
      ..._configs.calendar,
      max_results: raw.max_results,
      refresh_interval_minutes: raw.refresh_interval_minutes,
      hebrew: raw.hebrew,
    };
  } else if (section === 'redalert') {
    const raw = _origCollect(body);
    data = {
      ..._configs.redalert,
      enabled:       raw.enabled,
      poll_interval: raw.poll_interval,
      watch_areas:   _raSelectedAreas,
    };
  } else {
    data = { ..._configs[section], ..._origCollect(body) };
  }
  _configs[section] = data;
  try {
    const r = await fetch(`/api/config/${section}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (r.ok) {
      showToast('Saved');
      updateSettingsSummaries();
      popDetail();
    } else {
      showToast('Save failed', true);
    }
  } catch (e) {
    showToast(e.message, true);
  }
}

let _raSelectedAreas = [];

function renderRedalertSettings(body, cfg) {
  _raSelectedAreas = [...(cfg.watch_areas || cfg.watched_areas || [])];

  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">Red Alert</div>
    <div class="card">
      ${buildRow('Enabled', toggleField('enabled', cfg.enabled))}
      ${buildRow('Poll Interval (s)', `<input class="row-input" type="number" data-field="poll_interval" data-type="number" value="${esc(cfg.poll_interval || 3)}" min="1">`)}
    </div>
    <div class="sec-header">Watched Areas</div>
    <div class="card" style="padding:12px 16px">
      <div id="ra-areas-wrap" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>
    </div>
    <div class="sec-header">Test</div>
    <div class="card">
      <div class="row tap action-row" id="btn-redalert-test">
        <div class="row-body"><div class="row-label">Test Alert Overlay</div></div>
        <div class="row-chev"><svg viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg></div>
      </div>
    </div>
  `;

  function renderChips() {
    const wrap = body.querySelector('#ra-areas-wrap');
    if (!wrap) return;
    wrap.innerHTML = _raSelectedAreas.map(a =>
      `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--fill-secondary);border-radius:20px;padding:4px 10px 4px 12px;font-size:14px;color:var(--label);direction:rtl">
        ${esc(a)}
        <button data-area="${esc(a)}" style="background:none;border:none;color:var(--label-tertiary);cursor:pointer;padding:0;font-size:16px;line-height:1;margin-left:2px">×</button>
      </span>`
    ).join('') +
    `<button id="btn-ra-add" style="display:inline-flex;align-items:center;gap:4px;background:var(--fill-secondary);border-radius:20px;padding:4px 12px;font-size:14px;color:var(--blue);border:none;cursor:pointer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add
    </button>`;

    wrap.querySelectorAll('[data-area]').forEach(btn => {
      btn.addEventListener('click', () => {
        _raSelectedAreas = _raSelectedAreas.filter(a => a !== btn.dataset.area);
        renderChips();
      });
    });
    wrap.querySelector('#btn-ra-add')?.addEventListener('click', openAreaPicker);
  }

  async function openAreaPicker() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg-grouped);z-index:9999;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)';
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--sep)">
        <button id="rp-cancel" style="background:none;border:none;color:var(--blue);font-size:17px;cursor:pointer;padding:4px 0;min-width:60px">Cancel</button>
        <span style="flex:1;text-align:center;font-weight:600;font-size:17px;color:var(--label)">Select Areas</span>
        <button id="rp-done" style="background:none;border:none;color:var(--blue);font-weight:600;font-size:17px;cursor:pointer;padding:4px 0;min-width:60px;text-align:right">Done</button>
      </div>
      <div style="padding:10px 16px">
        <div style="background:var(--fill-tertiary);border-radius:10px;display:flex;align-items:center;gap:8px;padding:7px 12px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--label-tertiary)" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input id="rp-search" type="text" placeholder="Search…" autocomplete="off"
            style="flex:1;background:none;border:none;outline:none;font-size:16px;color:var(--label)">
        </div>
      </div>
      <div id="rp-list" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 16px 32px"></div>
    `;
    document.body.appendChild(overlay);

    const pickerSelected = new Set(_raSelectedAreas);
    let allAreas = [];

    function renderList(q = '') {
      const list = overlay.querySelector('#rp-list');
      const matches = q
        ? allAreas.filter(a => a.toLowerCase().includes(q.toLowerCase()))
        : allAreas;
      if (!matches.length) {
        list.innerHTML = `<div style="text-align:center;color:var(--label-tertiary);padding:40px 0">${allAreas.length ? 'No results' : 'Failed to load'}</div>`;
        return;
      }
      list.innerHTML = `<div class="card" style="overflow:hidden">` +
        matches.map(area =>
          `<div class="row" data-area="${esc(area)}" style="cursor:pointer">
            <div class="row-body"><div class="row-label" style="direction:rtl;text-align:right">${esc(area)}</div></div>
            <div style="width:24px;display:flex;align-items:center;justify-content:center;color:var(--blue)">
              ${pickerSelected.has(area) ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
            </div>
          </div>`
        ).join('') + `</div>`;
      list.querySelectorAll('[data-area]').forEach(row => {
        row.addEventListener('click', () => {
          const a = row.dataset.area;
          if (pickerSelected.has(a)) pickerSelected.delete(a); else pickerSelected.add(a);
          renderList(overlay.querySelector('#rp-search').value);
        });
      });
    }

    overlay.querySelector('#rp-list').innerHTML = `<div style="text-align:center;color:var(--label-tertiary);padding:40px 0">Loading…</div>`;
    try {
      const r = await fetch('/api/redalert/areas');
      allAreas = await r.json();
    } catch (_) { allAreas = []; }
    renderList();
    setTimeout(() => overlay.querySelector('#rp-search').focus(), 100);
    overlay.querySelector('#rp-search').addEventListener('input', e => renderList(e.target.value));
    overlay.querySelector('#rp-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#rp-done').addEventListener('click', () => {
      _raSelectedAreas = [...pickerSelected].sort((a, b) => a.localeCompare(b, 'he'));
      overlay.remove();
      renderChips();
    });
  }

  renderChips();
  body.querySelector('#btn-redalert-test')?.addEventListener('click', async () => {
    showToast('Testing alert…');
    await fetch('/api/redalert/test', { method: 'POST' });
  });
}

function renderSetupSection(body) {
  const d          = _sysInfo;
  const certUrl    = d.ip ? `http://${d.ip}:${d.http_port || 8080}/cert.crt` : null;
  const controlUrl = d.ip ? `https://${d.ip}:${d.control_port || 8001}` : null;

  function qrBlock(url) {
    if (!url) return '';
    return `<div class="qr-box"><img src="/api/qr?url=${encodeURIComponent(url)}" alt="QR code" class="qr-img" loading="lazy"></div>`;
  }

  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">iPhone Setup</div>
    <div class="card">
      <ul class="step-list">
        <li>
          <span class="step-num">1</span>
          <span>In <strong>Settings → Safari</strong>, turn off <em>"No secure connection warning"</em>.</span>
        </li>
        <li style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <span class="step-num">2</span>
            <span>Scan the QR or open the URL in <strong>Safari</strong> to download &amp; install the certificate.</span>
          </div>
          ${qrBlock(certUrl)}
          <div class="cert-url-box" id="cert-url-display">${certUrl ? esc(certUrl) : '—'}</div>
          <button id="btn-copy-cert" style="width:100%;padding:12px;border-radius:10px;background:var(--blue);color:#fff;font-size:15px;font-weight:600;cursor:pointer;border:none;">Copy URL</button>
          <div style="font-size:13px;color:var(--label3);padding:0 2px">Then: <strong>Settings → General → VPN &amp; Device Management</strong> → tap <em>MagicMirror</em> → <strong>Install</strong>.</div>
        </li>
        <li>
          <span class="step-num">3</span>
          <span>Go to <strong>Settings → General → About → Certificate Trust Settings</strong> and enable <em>MagicMirror</em>.</span>
        </li>
        <li style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <span class="step-num">4</span>
            <span>Scan the QR or open the control panel URL, then tap <strong>Share → Add to Home Screen</strong>.</span>
          </div>
          ${qrBlock(controlUrl)}
          <div class="cert-url-box">${controlUrl ? esc(controlUrl) : '—'}</div>
        </li>
      </ul>
    </div>
  `;
  body.querySelector('#btn-copy-cert')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(certUrl || '').catch(() => {});
    showToast('Copied!');
  });
}

function renderServerInfoSection(body) {
  const d = _sysInfo;
  body.innerHTML = `
    <div class="sec-header" style="margin-top:4px">Server</div>
    <div class="card">
      <div class="row" style="cursor:default"><div class="row-body"><div class="row-label">IP Address</div></div><div class="row-value">${esc(d.ip || '—')}</div></div>
      <div class="row" style="cursor:default"><div class="row-body"><div class="row-label">Port</div></div><div class="row-value">${esc(d.port || '—')}</div></div>
      <div class="row" style="cursor:default"><div class="row-body"><div class="row-label">Uptime</div></div><div class="row-value">${esc(d.uptime || '—')}</div></div>
    </div>
    <div class="sec-header">Mirror Link</div>
    <div class="card">
      <div class="row tap action-row" id="btn-open-mirror">
        <div class="row-body"><div class="row-label">Open Mirror</div></div>
        <div class="row-chev"><svg viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l6 6-6 6"/></svg></div>
      </div>
    </div>
  `;
  if (d.ip) {
    body.querySelector('#btn-open-mirror')?.addEventListener('click', () => {
      window.open(`https://${d.ip}:${d.port || 8000}`, '_blank');
    });
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────
function logLine(entry) {
  const line = document.createElement('span');
  line.className = 'log-line' + (entry.level === 'ERROR' ? ' log-error' : entry.level === 'WARNING' ? ' log-warn' : '');
  line.innerHTML = `<span class="log-time">${entry.time}</span>${esc(entry.msg)}\n`;
  logOutput.appendChild(line);
  logOutput.scrollTop = logOutput.scrollHeight;
  while (logOutput.children.length > 500) logOutput.removeChild(logOutput.firstChild);
}

document.getElementById('log-filter').addEventListener('input', function () {
  const q = this.value.trim().toLowerCase();
  logOutput.querySelectorAll('.log-line').forEach(l => {
    l.style.display = !q || l.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

async function loadLogs() {
  try {
    const r = await fetch('/api/logs');
    if (!r.ok) return;
    const { logs } = await r.json();
    logs.forEach(logLine);
    logOutput.scrollTop = logOutput.scrollHeight;
  } catch {}
}

// ── System info ───────────────────────────────────────────────────────────────
async function loadSystemInfo() {
  try {
    const r = await fetch('/api/system/info');
    if (!r.ok) return;
    _sysInfo = await r.json();
    const link = document.getElementById('nav-mirror-link');
    if (link && _sysInfo.ip) link.href = `https://${_sysInfo.ip}:${_sysInfo.port || 8000}`;
  } catch {}
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
WS.on('open', () => {
  _wsConnected = true;
  updateStatus();
  pollStatus();
  logLine({ time: now(), level: 'INFO', msg: 'Connected to server' });
  if (_awaitingRestart) { _awaitingRestart = false; showToast('Mirror is back'); }
});

WS.on('close', () => {
  _wsConnected = false;
  updateStatus();
  logLine({ time: now(), level: 'ERROR', msg: 'Disconnected from server' });
});

WS.on('config', ({ layout }) => {
  if (layout) {
    renderLayoutQuick(layout);
    if (!_editLayout) {
      _layout = layout;
    }
  }
});

WS.on('log', d => logLine({ time: now(), level: d.level || 'INFO', msg: d.msg }));

WS.on('log_history', entries => {
  const wasEmpty = logOutput.children.length === 0;
  entries.forEach(logLine);
  if (wasEmpty) logOutput.scrollTop = logOutput.scrollHeight;
});

// ── Init ──────────────────────────────────────────────────────────────────────
updateStatus();
renderServices();
loadLogs();
loadSystemInfo();
setInterval(pollStatus, 15000);

fetch('/api/config/layout')
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d) renderLayoutQuick(d); })
  .catch(() => {});

// Preload settings configs for summary values
['weather','calendar','news','hue','redalert'].forEach(s => {
  fetch(`/api/config/${s}`).then(r => r.ok ? r.json() : null).then(d => {
    if (d) { _configs[s] = d; updateSettingsSummaries(); }
  }).catch(() => {});
});

WS.start();
