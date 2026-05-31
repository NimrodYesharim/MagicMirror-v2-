/* MagicMirror Settings Logic */

// Native-input modal — triggers the system on-screen keyboard on touch devices
function promptModal(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:#1c1c1e;border:1px solid #333;border-radius:16px;padding:28px 28px 20px;width:min(460px,90vw);display:flex;flex-direction:column;gap:16px">
        <div style="font-size:17px;font-weight:600;color:#eee">${message}</div>
        <input id="pm-input" type="text" value="${defaultValue.replace(/"/g,'&quot;')}"
          style="width:100%;background:#111;border:1.5px solid #444;border-radius:10px;color:#fff;font-size:18px;padding:14px 16px;outline:none;box-sizing:border-box">
        <div style="display:flex;gap:12px;justify-content:flex-end">
          <button id="pm-cancel" style="padding:12px 22px;border-radius:10px;border:1.5px solid #444;background:transparent;color:#aaa;font-size:16px;cursor:pointer">Cancel</button>
          <button id="pm-ok" style="padding:12px 22px;border-radius:10px;border:none;background:#3a7eff;color:#fff;font-size:16px;font-weight:600;cursor:pointer">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#pm-input');
    const ok = () => { document.body.removeChild(overlay); resolve(input.value); };
    const cancel = () => { document.body.removeChild(overlay); resolve(null); };
    overlay.querySelector('#pm-ok').addEventListener('click', ok);
    overlay.querySelector('#pm-cancel').addEventListener('click', cancel);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); });
    // Focus after paint so the keyboard has time to appear
    requestAnimationFrame(() => input.focus());
  });
}

function iconPickerModal(currentIcon, iconOptions) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)';
    
    let filteredIcons = [...iconOptions];
    
    overlay.innerHTML = `
      <div class="modal-card" style="background:#141414;border:1px solid #333;border-radius:24px;width:min(600px,95vw);height:min(700px,85vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
        <div style="padding:24px 24px 16px;display:flex;flex-direction:column;gap:16px;border-bottom:1px solid #222">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:20px;font-weight:700;color:#fff">Select Icon</div>
            <button id="ip-close" style="background:none;border:none;color:#888;font-size:28px;cursor:pointer;line-height:1">&times;</button>
          </div>
          <input id="ip-search" type="text" placeholder="Search icons..." 
            style="width:100%;background:#0a0a0a;border:1.5px solid #333;border-radius:12px;color:#fff;font-size:16px;padding:12px 16px;outline:none">
        </div>
        <div id="ip-grid" style="flex:1;overflow-y:auto;padding:24px;display:grid;grid-template-columns:repeat(auto-fill, minmax(80px, 1fr));gap:16px;align-content:start">
        </div>
      </div>`;
      
    document.body.appendChild(overlay);
    
    const grid = overlay.querySelector('#ip-grid');
    const search = overlay.querySelector('#ip-search');
    
    const renderGrid = (icons) => {
      grid.innerHTML = icons.map(ico => {
        const isSelected = ico === currentIcon;
        return `
          <div class="ip-item${isSelected ? ' active' : ''}" data-icon="${ico}">
            <div class="external-icon" style="-webkit-mask-image:url('/widgets/hue/icons/${ico}.svg');mask-image:url('/widgets/hue/icons/${ico}.svg');-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center"></div>
            <div style="font-size:11px;text-align:center;word-break:break-all;line-height:1.2">${ico.replace(/^(room|zone|bulb)-/, '')}</div>
          </div>
        `;
      }).join('');
      
      grid.querySelectorAll('.ip-item').forEach(item => {
        item.onclick = () => {
          document.body.removeChild(overlay);
          resolve(item.dataset.icon);
        };
      });
    };
    
    renderGrid(filteredIcons);
    
    search.oninput = (e) => {
      const q = e.target.value.toLowerCase();
      filteredIcons = iconOptions.filter(ico => ico.toLowerCase().includes(q));
      renderGrid(filteredIcons);
    };
    
    overlay.querySelector('#ip-close').onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
    
    search.focus();
  });
}

const CFG = {};
let activeSection = 'weather';
let activeTemplate = '';
let editorTemplates = {};

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  if (window._settingsBooted) return;
  window._settingsBooted = true;
  
  // Force hard refresh when going back to mirror
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) {
    backBtn.onclick = (e) => {
      e.preventDefault();
      location.href = '/?refresh=' + Date.now();
    };
  }
  
  try {
    await loadAll();
    if (document.getElementById('settings-nav')) {
      buildNav();
      showSection('general');
    }
  } catch (e) {
    console.error("Settings Boot Error:", e);
  }
})();

async function loadAll() {
  // Discover widgets and load their settings scripts first
  let manifests = [];
  try {
    const r = await fetch('/api/widgets');
    if (r.ok) manifests = await r.json();
  } catch {}
  window._settingsManifests = manifests;

  const widgetKeys = manifests.map(m => m.name);
  const keys = [...widgetKeys, 'display', 'layout'];

  await Promise.all(keys.map(async k => {
    try {
      const r = await fetch(`/api/config/${k}`);
      CFG[k] = r.ok ? await r.json() : {};
    } catch { CFG[k] = {}; }
  }));

  if (CFG.layout && CFG.layout.templates) {
    editorTemplates = JSON.parse(JSON.stringify(CFG.layout.templates));
    activeTemplate  = CFG.layout.current || Object.keys(editorTemplates)[0] || '';
  } else {
    editorTemplates = {};
    activeTemplate = '';
  }

  await _loadWidgetSettingsScripts(manifests);

  // Merge manifest labels into WIDGET_META for the layout editor
  manifests.forEach(m => {
    if (!WIDGET_META[m.name]) {
      WIDGET_META[m.name] = { label: m.label || m.name, color: '#2a2a2a' };
    }
  });
}

async function _loadWidgetSettingsScripts(manifests) {
  await Promise.all(
    manifests
      .filter(m => m.settingsOrder != null)
      .map(m => new Promise(resolve => {
        if (window.WidgetSettings && window.WidgetSettings[m.name]) { resolve(); return; }
        const s = document.createElement('script');
        s.src = `/widgets/${m.name}/${m.name}.settings.js`;
        s.onload = resolve;
        s.onerror = () => { console.warn(`No settings script for widget: ${m.name}`); resolve(); };
        document.head.appendChild(s);
      }))
  );
}

// ── Navigation ────────────────────────────────────────────────────────────────
function buildNav() {
  const nav = document.getElementById('settings-nav');
  if (!nav) return;
  
  nav.innerHTML = `
    <button class="nav-btn active" data-section="general">General</button>
    <button class="nav-btn" data-section="widgets">Widgets Configuration</button>
    <button class="nav-btn" data-section="layout">Layout Editor</button>
    <button class="nav-btn" data-section="system">System</button>
  `;
  
  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const section = btn.dataset.section;
      if (section === 'widgets') {
        const ms = (window._settingsManifests || [])
          .filter(m => m.settingsOrder != null)
          .sort((a, b) => (a.settingsOrder || 999) - (b.settingsOrder || 999));
        showSection(ms.length ? ms[0].name : 'general');
      } else {
        showSection(section);
      }
    };
  });
}

function _makeHelpers() {
  return {
    field, checkField, selectField, groupWrap, sectionWrap, esc,
    promptModal, iconPickerModal,
    bindPickers, bindRemoveBtns, bindCollapsibles,
    doSave, showToast,
  };
}

function showSection(key) {
  const content = document.getElementById('settings-content');
  if (!content) return;

  const manifests = (window._settingsManifests || []).filter(m => m.settingsOrder != null);
  const widgetNames = manifests.map(m => m.name);
  const isWidget = widgetNames.includes(key);

  let subNavHTML = '';
  if (isWidget) {
    const sorted = [...manifests].sort((a, b) => (a.settingsOrder || 999) - (b.settingsOrder || 999));
    subNavHTML = `<div class="sub-nav">` +
      sorted.map(m => `<button class="sub-nav-btn${key === m.name ? ' active' : ''}" data-widget="${esc(m.name)}">${esc(m.label)}</button>`).join('') +
      `</div>`;
  }

  content.innerHTML = subNavHTML + '<div id="section-inner"></div>';
  const inner = document.getElementById('section-inner');

  if (key === 'layout') {
    layoutSection(inner);
  } else if (key === 'system') {
    inner.innerHTML = '<div class="loading">Loading…</div>';
    _loadSystemSection(inner);
  } else if (key === 'general') {
    inner.innerHTML = generalSection();
    bindGeneralSave();
  } else if (isWidget) {
    _showWidgetSection(key, inner);
  }

  if (isWidget) {
    content.querySelectorAll('.sub-nav-btn').forEach(btn => {
      btn.onclick = () => showSection(btn.dataset.widget);
    });
  }
}

function _showWidgetSection(widgetName, inner) {
  const ws = window.WidgetSettings && window.WidgetSettings[widgetName];
  if (!ws) {
    inner.innerHTML = `<div class="loading">No settings registered for "${esc(widgetName)}".</div>`;
    return;
  }
  const H = _makeHelpers();
  inner.innerHTML = ws.section(CFG[widgetName] || {}, H);
  if (typeof ws.onMount === 'function') ws.onMount(inner, CFG[widgetName] || {}, H);
}

// ── Form Helpers ──────────────────────────────────────────────────────────────
function esc(s) { 
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); 
}

function field(label, name, value, type = 'text', hint = '') {
  if (type === 'number') return pickerField(label, name, value, hint);
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <input type="${type}" name="${esc(name)}" value="${esc(String(value ?? ''))}">
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </div>`;
}

function pickerField(label, name, value, hint = '') {
  const val = Number(value ?? 0);
  return `
    <div class="field picker-field" data-name="${esc(name)}">
      <label>${esc(label)}</label>
      <div class="picker-wrap">
        <button class="picker-btn minus">−</button>
        <input type="number" name="${esc(name)}" value="${val}" class="picker-input">
        <button class="picker-btn plus">+</button>
      </div>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </div>`;
}

function checkField(label, name, checked) {
  return `
    <label class="toggle-row">
      <span>${esc(label)}</span>
      <div class="ios-switch">
        <input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}>
        <span class="ios-switch-track"><span class="ios-switch-knob"></span></span>
      </div>
    </label>`;
}

function selectField(label, name, value, options) {
  const opts = options.map(o => `<option value="${esc(o.v)}" ${o.v == value ? 'selected' : ''}>${esc(o.l)}</option>`).join('');
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <div class="select-wrap">
        <select name="${esc(name)}">${opts}</select>
      </div>
    </div>`;
}

function sectionWrap(title, bodyHTML) {
  return `
    <div class="section-header"><h2>${esc(title)}</h2></div>
    <div class="section-body">
      ${bodyHTML}
      <div class="save-row">
        <button id="save-btn" class="save-btn">Save Changes</button>
      </div>
    </div>`;
}

function groupWrap(title, bodyHTML, collapsible = false) {
  return `
    <div class="field-group${collapsible ? ' collapsible' : ''}">
      <h3>${esc(title)}</h3>
      <div class="group-inner">${bodyHTML}</div>
    </div>`;
}

// Helper to bind collapsible toggles after DOM insertion
function bindCollapsibles(container) {
  container.querySelectorAll('.field-group.collapsible h3').forEach(h3 => {
    h3.onclick = () => {
      h3.parentElement.classList.toggle('collapsed');
    };
  });
}

// ── Section HTML Generators ───────────────────────────────────────────────────

function generalSection() {
  const d = CFG.display || {};
  const s = d.screen || {};
  const rl = d.ring_light || {};
  const l = CFG.layout || {};
  
  return sectionWrap('General', `
    ${groupWrap('Display & Mirror', `
      ${field('Screen Width (px)', 'display.screen.width', s.width ?? 1080, 'number')}
      ${field('Screen Height (px)', 'display.screen.height', s.height ?? 1920, 'number')}
      ${checkField('Show Cursor', 'display.show_cursor', d.show_cursor === true)}
      ${checkField('Show Sleep Button', 'display.sleep_button', d.sleep_button !== false)}
      ${checkField('Show Ring Light Button', 'display.ring_light_button', d.ring_light_button !== false)}
      ${selectField('Graphics Quality', 'display.graphics', d.graphics || 'high', [
        {v:'high', l:'High – Full blur & effects (Windows / desktop)'},
        {v:'mid',  l:'Mid – Reduced blur (balanced)'},
        {v:'low',  l:'Low – No blur effects (Raspberry Pi)'},
      ])}
    `)}
    ${groupWrap('Ring Light', `
      ${field('Border Width (px)', 'display.ring_light.border_width', rl.border_width ?? 120, 'number')}
      ${field('Opacity (0–1)', 'display.ring_light.opacity', rl.opacity ?? 0.92, 'number')}
    `)}
    ${groupWrap('Server', `
      ${field('Port', 'display.port', d.port ?? 8000, 'number', 'Changing the port restarts the server and redirects this page')}
    `)}
    ${groupWrap('Current Layout', `
      ${selectField('Active Template', 'layout.current', l.current || 'default',
        Object.keys(editorTemplates).map(k => ({ v: k, l: editorTemplates[k]?.label || k }))
      )}
    `)}
  `);
}






// ── Bindings & Interactions ──────────────────────────────────────────────────

function bindPickers() {
  document.querySelectorAll('.picker-field').forEach(f => {
    const input = f.querySelector('.picker-input');
    const minus = f.querySelector('.minus');
    const plus = f.querySelector('.plus');
    if (minus) {
      minus.onclick = (e) => {
        e.preventDefault();
        input.value = Number(input.value) - 1;
        input.dispatchEvent(new Event('change'));
      };
    }
    if (plus) {
      plus.onclick = (e) => {
        e.preventDefault();
        input.value = Number(input.value) + 1;
        input.dispatchEvent(new Event('change'));
      };
    }
  });
}


function bindGeneralSave() {
  bindPickers();
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.onclick = async () => {
    const oldPort = CFG.display?.port ?? 8000;
    const dUp = JSON.parse(JSON.stringify(CFG.display || {}));
    const lUp = JSON.parse(JSON.stringify(CFG.layout || {}));
    document.querySelectorAll('.section-body [name]').forEach(el => {
      const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      if (el.name.startsWith('display.')) {
        const ks = el.name.replace('display.', '').split('.');
        let o = dUp;
        for (let i = 0; i < ks.length - 1; i++) {
          o[ks[i]] = o[ks[i]] || {};
          o = o[ks[i]];
        }
        o[ks[ks.length - 1]] = v;
      } else if (el.name.startsWith('layout.')) {
        lUp[el.name.replace('layout.', '')] = v;
      }
    });
    const newPort = dUp.port ?? 8000;
    await Promise.all([doSave('display', dUp), doSave('layout', lUp)]);
    if (newPort !== oldPort) {
      showToast(`Restarting server on port ${newPort}…`);
      setTimeout(async () => {
        try { await fetch('/api/restart', { method: 'POST' }); } catch {}
        setTimeout(() => {
          window.location.href = `http://${window.location.hostname}:${newPort}/settings`;
        }, 1800);
      }, 400);
    }
  };
}

// ── Layout Editor ─────────────────────────────────────────────────────────────

const WIDGET_META = {
  datetime: { label: 'Clock',    color: '#1a2a4a' },
  weather:  { label: 'Weather',  color: '#1a3a2a' },
  calendar: { label: 'Calendar', color: '#3a3a1a' },
  hue:      { label: 'Hue Cards', color: '#3a1a3a' },
  hue_scenes: { label: 'Hue Scenes', color: '#5a1a5a' },
  news:     { label: 'Ticker',   color: '#1a2a3a' },
};
const GRID_COLS = 12, GRID_ROWS = 24;

function _parseSpan(val) {
  const parts = String(val).split('/').map(x => parseInt(x.trim()));
  return { s: parts[0] || 1, e: parts[1] || (parts[0] || 1) + 1 };
}

function _isHidden(pos) {
  return !pos || String(pos.row).replace(/\s/g, '') === '1/1';
}

function layoutSection(inner) {
  const tplKeys = Object.keys(editorTemplates);
  if (!activeTemplate || !editorTemplates[activeTemplate]) activeTemplate = tplKeys[0] || '';

  inner.innerHTML = `
    <div class="layout-toolbar">
      <div class="inline-field">
        <label>Template</label>
        <select id="tpl-select">
          ${tplKeys.map(k => `<option value="${k}"${k===activeTemplate?' selected':''}>${editorTemplates[k]?.label||k}</option>`).join('')}
        </select>
      </div>
      <button id="btn-add-tpl" class="secondary-btn" style="padding:8px 14px;font-size:13px;min-height:0">+ Add</button>
      <button id="btn-ren-tpl" class="secondary-btn" style="padding:8px 14px;font-size:13px;min-height:0">Rename</button>
      <button id="btn-del-tpl" class="secondary-btn" style="padding:8px 14px;font-size:13px;min-height:0">Delete</button>
      <button id="btn-default-tpl" class="secondary-btn" style="padding:8px 14px;font-size:13px;min-height:0">Make Default</button>
      <div class="inline-field">
        <label>Show seconds</label>
        <div class="ios-switch">
          <input type="checkbox" id="show-seconds-toggle">
          <span class="ios-switch-track"><span class="ios-switch-knob"></span></span>
        </div>
      </div>
      <div class="inline-field">
        <label>UI Scale</label>
        <select id="tpl-scale">
          <option value="240">Large</option>
          <option value="360">Normal</option>
          <option value="480">Small</option>
        </select>
      </div>
    </div>
    <div class="layout-editor-wrap">
      <div class="layout-left">
        <div class="field-group">
          <h3>Widgets</h3>
          <div class="group-inner" id="widget-toggles">
            ${Object.entries(WIDGET_META).map(([k,m]) => `
              <label class="widget-toggle" data-key="${k}">
                <input type="checkbox" class="wt-cb" data-key="${k}">
                <span class="wt-swatch" style="background:${m.color}"></span>
                ${m.label}
              </label>`).join('')}
          </div>
        </div>
        <div class="save-row" style="padding-top:16px;border-top:1px solid #242424;margin-top:auto">
          <button id="btn-save-layout" class="save-btn" style="width:100%">Save Layout</button>
        </div>
      </div>
      <div class="layout-right">
        <div class="grid-legend">12 × 24 — drag to move · corner handle to resize</div>
        <div id="grid-editor-container" style="width:100%">
          <div id="grid-editor" style="position:relative;background:#111;border:1px solid #2a2a2a;overflow:hidden"></div>
        </div>
      </div>
    </div>`;

  document.getElementById('tpl-select').onchange = e => { activeTemplate = e.target.value; _rebuildGrid(); };

  document.getElementById('btn-add-tpl')?.addEventListener('click', async () => {
    const name = await promptModal('New layout name');
    if (!name || !name.trim()) return;
    const key = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (editorTemplates[key]) { showToast('Template already exists', true); return; }
    editorTemplates[key] = JSON.parse(JSON.stringify(editorTemplates[activeTemplate] || {}));
    editorTemplates[key].label = name.trim();
    activeTemplate = key;
    layoutSection(document.getElementById('section-inner'));
  });

  document.getElementById('btn-ren-tpl')?.addEventListener('click', async () => {
    const cur = editorTemplates[activeTemplate]?.label || activeTemplate;
    const name = await promptModal('Rename layout', cur);
    if (!name || !name.trim() || name.trim() === cur) return;
    editorTemplates[activeTemplate].label = name.trim();
    await doSave('layout', { ...CFG.layout, current: activeTemplate, templates: editorTemplates });
    layoutSection(document.getElementById('section-inner'));
  });

  document.getElementById('btn-del-tpl')?.addEventListener('click', async () => {
    if (Object.keys(editorTemplates).length <= 1) { showToast('Cannot delete the last template', true); return; }
    if (!confirm(`Delete template "${editorTemplates[activeTemplate]?.label || activeTemplate}"?`)) return;
    delete editorTemplates[activeTemplate];
    activeTemplate = Object.keys(editorTemplates)[0];
    await doSave('layout', { ...CFG.layout, current: activeTemplate, templates: editorTemplates });
    layoutSection(document.getElementById('section-inner'));
  });

  document.getElementById('btn-default-tpl')?.addEventListener('click', async () => {
    await doSave('layout', { ...CFG.layout, current: activeTemplate, templates: editorTemplates });
    CFG.layout = { ...CFG.layout, current: activeTemplate };
    showToast(`"${editorTemplates[activeTemplate]?.label || activeTemplate}" is now the default layout`);
  });

  document.getElementById('btn-save-layout').onclick = async () => {
    await doSave('layout', { ...CFG.layout, current: activeTemplate, templates: editorTemplates });
  };

  requestAnimationFrame(() => {
    const toolbar = document.querySelector('.layout-toolbar');
    const wrap    = document.querySelector('.layout-editor-wrap');
    const content = document.getElementById('settings-content');
    if (toolbar && wrap && content) {
      wrap.style.height = (content.clientHeight - toolbar.offsetHeight) + 'px';
    }
    _rebuildGrid();
  });
}

function _rebuildGrid() {
  const container = document.getElementById('grid-editor-container');
  const grid      = document.getElementById('grid-editor');
  if (!container || !grid) return;
  const tpl = editorTemplates[activeTemplate];
  if (!tpl) return;

  // Cell sizing — fill available width, maintain mirror aspect ratio (90:80 per cell)
  const availW = container.clientWidth - 2;
  const CELL_W = Math.max(28, Math.floor(availW / GRID_COLS));
  const CELL_H = Math.max(18, Math.round(CELL_W * (80 / 90)));
  grid.style.width  = GRID_COLS * CELL_W + 'px';
  grid.style.height = GRID_ROWS * CELL_H + 'px';

  // Grid lines
  let html = '';
  for (let c = 1; c < GRID_COLS; c++)
    html += `<div style="position:absolute;left:${c*CELL_W}px;top:0;width:1px;height:100%;background:rgba(255,255,255,0.05);pointer-events:none"></div>`;
  for (let r = 1; r < GRID_ROWS; r++)
    html += `<div style="position:absolute;top:${r*CELL_H}px;left:0;height:1px;width:100%;background:rgba(255,255,255,0.05);pointer-events:none"></div>`;

  // Widget boxes
  for (const [key, pos] of Object.entries(tpl.widgets || {})) {
    if (_isHidden(pos)) continue;
    const m = WIDGET_META[key] || { label: key, color: '#333' };
    const { s: cs, e: ce } = _parseSpan(pos.column);
    const { s: rs, e: re } = _parseSpan(pos.row);
    html += `<div class="gw-box" data-key="${key}"
      style="position:absolute;left:${(cs-1)*CELL_W}px;top:${(rs-1)*CELL_H}px;width:${(ce-cs)*CELL_W}px;height:${(re-rs)*CELL_H}px;background:${m.color}cc;border:1px solid ${m.color}80">
      <span class="gw-label">${m.label}</span>
      <div class="gw-resize"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.8" stroke-linecap="round"><line x1="11" y1="1" x2="1" y2="11"/><polyline points="11,6 11,11 6,11"/></svg></div>
    </div>`;
  }
  grid.innerHTML = html;

  // Show-seconds toggle
  const ssTog = document.getElementById('show-seconds-toggle');
  if (ssTog) {
    ssTog.checked = tpl.show_seconds === true;
    ssTog.onchange = () => { editorTemplates[activeTemplate].show_seconds = ssTog.checked; };
  }

  // UI Scale select
  const scaleSel = document.getElementById('tpl-scale');
  if (scaleSel) {
    scaleSel.value = String(tpl.ui_scale ?? 360);
    scaleSel.onchange = () => {
      editorTemplates[activeTemplate].ui_scale = parseInt(scaleSel.value);
    };
  }

  // Widget visibility toggles
  document.querySelectorAll('.wt-cb').forEach(cb => {
    const key = cb.dataset.key;
    cb.checked = !_isHidden(tpl.widgets?.[key]);
    cb.onchange = () => {
      const t = editorTemplates[activeTemplate];
      if (!t) return;
      t.widgets[key] = cb.checked
        ? { row: '1 / 5', column: '1 / 13' }
        : { row: '1 / 1', column: '1 / 1' };
      _rebuildGrid();
    };
  });

  _bindDragResize(grid, CELL_W, CELL_H);
}

function _bindDragResize(grid, CELL_W, CELL_H) {
  grid.querySelectorAll('.gw-box').forEach(box => {
    let mode = null, startX, startY, origL, origT, origW, origH;

    box.addEventListener('pointerdown', e => {
      mode = e.target.classList.contains('gw-resize') ? 'resize' : 'drag';
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      origL = box.offsetLeft; origT = box.offsetTop;
      origW = box.offsetWidth; origH = box.offsetHeight;
      box.setPointerCapture(e.pointerId);
      box.classList.add('dragging');
    });

    box.addEventListener('pointermove', e => {
      if (!mode) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const maxL = GRID_COLS * CELL_W, maxT = GRID_ROWS * CELL_H;
      if (mode === 'drag') {
        box.style.left = Math.max(0, Math.min(maxL - origW, origL + dx)) + 'px';
        box.style.top  = Math.max(0, Math.min(maxT - origH, origT + dy)) + 'px';
      } else {
        box.style.width  = Math.max(4 * CELL_W, Math.min(maxL - origL, origW + dx)) + 'px';
        box.style.height = Math.max(1 * CELL_H, Math.min(maxT - origT, origH + dy)) + 'px';
      }
    });

    box.addEventListener('pointerup', () => {
      if (!mode) return;
      box.classList.remove('dragging');
      // Snap to grid
      const cs = Math.max(1, Math.round(box.offsetLeft / CELL_W) + 1);
      const rs = Math.max(1, Math.round(box.offsetTop  / CELL_H) + 1);
      const ce = Math.min(GRID_COLS + 1, Math.max(cs + 4, Math.round((box.offsetLeft + box.offsetWidth)  / CELL_W) + 1));
      const re = Math.min(GRID_ROWS + 1, Math.max(rs + 1, Math.round((box.offsetTop  + box.offsetHeight) / CELL_H) + 1));
      box.style.left   = (cs-1)*CELL_W + 'px'; box.style.top    = (rs-1)*CELL_H + 'px';
      box.style.width  = (ce-cs)*CELL_W + 'px'; box.style.height = (re-rs)*CELL_H + 'px';
      const key = box.dataset.key;
      if (editorTemplates[activeTemplate]?.widgets?.[key])
        editorTemplates[activeTemplate].widgets[key] = { row: `${rs} / ${re}`, column: `${cs} / ${ce}` };
      mode = null;
    });

    box.addEventListener('pointercancel', () => { mode = null; box.classList.remove('dragging'); });
  });
}

// ── Shared Helpers ────────────────────────────────────────────────────────────

function bindRemoveBtns(btnSelector, rowSelector) {
  document.querySelectorAll(btnSelector).forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const row = btn.closest(rowSelector);
      if (row) row.remove();
    };
  });
}

async function doSave(key, data) {
  try {
    const r = await fetch(`/api/config/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (r.ok) {
      CFG[key] = data;
      showToast('Saved successfully!');
    } else {
      showToast('Error saving configuration', true);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, true);
  }
}

async function _loadSystemSection(inner) {
  try {
    const r = await fetch('/api/system/info');
    const d = await r.json();
    inner.innerHTML = `
      <div class="section-header"><h2>System</h2></div>
      <div class="section-body">
        ${groupWrap('Live Info', `
          <div class="toggle-row" style="cursor:default"><span>IPv4 Address</span><span style="color:#fff;font-weight:600">${esc(d.ip)}</span></div>
          <div class="toggle-row" style="cursor:default"><span>Uptime</span><span style="color:#fff;font-weight:600">${esc(d.uptime)}</span></div>
          <div class="toggle-row" style="cursor:default"><span>Port</span><span style="color:#fff;font-weight:600">${esc(String(d.port))}</span></div>
        `)}
        ${groupWrap('iPhone Setup', (() => {
          const certUrl    = `http://${esc(d.ip)}:${esc(String(d.http_port || 8080))}/cert.crt`;
          const controlUrl = `https://${esc(d.ip)}:${esc(String(d.control_port || 8001))}`;
          const qr = url => `<div class="qr-setup-box"><img class="qr-setup-img" src="/api/qr?url=${encodeURIComponent(url)}" alt="QR code" loading="lazy"></div>`;
          return `
          <div class="field">
            <ul class="setup-step-list">
              <li class="setup-step">
                <div class="setup-step-head">
                  <span class="setup-step-num">1</span>
                  <span class="setup-step-text">In <strong>Settings → Safari</strong>, turn off <em>"No secure connection warning"</em>.</span>
                </div>
              </li>
              <li class="setup-step">
                <div class="setup-step-head">
                  <span class="setup-step-num">2</span>
                  <span class="setup-step-text">Scan the QR or open the URL in <strong>Safari</strong> to download &amp; install the certificate.</span>
                </div>
                ${qr(certUrl)}
                <div style="background:#111;border-radius:10px;padding:12px 14px;font-family:monospace;font-size:13px;color:#4cd964;word-break:break-all">${certUrl}</div>
                <span class="hint">After opening: <strong>Settings → General → VPN &amp; Device Management</strong> → tap <em>MagicMirror</em> → <strong>Install</strong>.</span>
              </li>
              <li class="setup-step">
                <div class="setup-step-head">
                  <span class="setup-step-num">3</span>
                  <span class="setup-step-text">Go to <strong>Settings → General → About → Certificate Trust Settings</strong> and enable <em>MagicMirror</em>.</span>
                </div>
              </li>
              <li class="setup-step">
                <div class="setup-step-head">
                  <span class="setup-step-num">4</span>
                  <span class="setup-step-text">Scan the QR or open the control panel URL in Safari, then tap <strong>Share → Add to Home Screen</strong>.</span>
                </div>
                ${qr(controlUrl)}
                <div style="background:#111;border-radius:10px;padding:12px 14px;font-family:monospace;font-size:13px;color:#4cd964;word-break:break-all">${controlUrl}</div>
              </li>
            </ul>
          </div>
          `;
        })())}
        ${groupWrap('Mirror Actions', `
          <div class="field">
            <label>Hard Reload</label>
            <button id="btn-hard-reload" class="secondary-btn">Force Reload Mirror (bypass cache)</button>
            <span class="hint">Clears widget data and re-fetches all assets on the mirror display.</span>
          </div>
          <div class="field">
            <label>End Mirror Process</label>
            <button id="btn-end-process" class="secondary-btn" style="color:#FF9F0A;border-color:#FF9F0A55">End Process</button>
            <span class="hint">Closes the kiosk window and exits the server. The mirror goes offline.</span>
          </div>
          <div class="field">
            <label>Reboot Pi</label>
            <button id="btn-system-reboot" class="secondary-btn" style="color:#BF5AF2;border-color:#BF5AF255">Reboot</button>
            <span class="hint">Restarts the Raspberry Pi. The mirror will come back online after reboot.</span>
          </div>
          <div class="field">
            <label>Shut Down Pi</label>
            <button id="btn-shutdown" class="secondary-btn" style="color:#FF453A;border-color:#FF453A55">Shut Down</button>
            <span class="hint">Powers off the Raspberry Pi. Requires physical power-on to restart.</span>
          </div>
        `)}
      </div>`;
    document.getElementById('btn-hard-reload')?.addEventListener('click', async () => {
      await fetch('/api/refresh', { method: 'POST' });
      await fetch('/api/hard-reload', { method: 'POST' });
      showToast('Hard reload sent to mirror');
    });
    document.getElementById('btn-end-process')?.addEventListener('click', async () => {
      if (!confirm('End the mirror process? The kiosk window will close and the display will go offline.')) return;
      showToast('Ending process…');
      try { await fetch('/api/reboot', { method: 'POST' }); } catch {}
    });
    document.getElementById('btn-system-reboot')?.addEventListener('click', async () => {
      if (!confirm('Reboot the Raspberry Pi? The mirror will come back online after reboot.')) return;
      showToast('Rebooting…');
      try { await fetch('/api/system-reboot', { method: 'POST' }); } catch {}
    });
    document.getElementById('btn-shutdown')?.addEventListener('click', async () => {
      if (!confirm('Shut down the Raspberry Pi? You will need to physically power it back on.')) return;
      showToast('Shutting down…');
      try { await fetch('/api/shutdown', { method: 'POST' }); } catch {}
    });
  } catch (e) {
    inner.innerHTML = `<div class="loading">Error: ${esc(e.message)}</div>`;
  }
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = isError ? 'error visible' : 'visible';
  setTimeout(() => t.classList.remove('visible'), 3000);
}
