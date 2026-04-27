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

const CFG = {};
let activeSection = 'weather';
let activeTemplate = '';
let editorTemplates = {};

// ── Boot ──────────────────────────────────────────────────────────────────────
(async () => {
  if (window._settingsBooted) return;
  window._settingsBooted = true;
  
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
  const keys = ['weather', 'calendar', 'news', 'hue', 'redalert', 'display', 'layout'];
  await Promise.all(keys.map(async k => {
    try {
      const r = await fetch(`/api/config/${k}`);
      if (r.ok) {
        CFG[k] = await r.json();
      } else {
        CFG[k] = {};
      }
    } catch (e) {
      CFG[k] = {};
    }
  }));
  
  if (CFG.layout && CFG.layout.templates) {
    editorTemplates = JSON.parse(JSON.stringify(CFG.layout.templates));
    activeTemplate  = CFG.layout.current || Object.keys(editorTemplates)[0] || '';
  } else {
    editorTemplates = {};
    activeTemplate = '';
  }
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
      showSection(section === 'widgets' ? 'weather' : section);
    };
  });
}

function showSection(key) {
  const content = document.getElementById('settings-content');
  if (!content) return;
  
  const isWidget = ['weather', 'calendar', 'news', 'hue', 'redalert'].includes(key);
  let subNavHTML = '';
  
  if (isWidget) {
    subNavHTML = `
      <div class="sub-nav">
        <button class="sub-nav-btn${key==='weather'?' active':''}" data-widget="weather">Weather</button>
        <button class="sub-nav-btn${key==='calendar'?' active':''}" data-widget="calendar">Calendar</button>
        <button class="sub-nav-btn${key==='news'?' active':''}" data-widget="news">News</button>
        <button class="sub-nav-btn${key==='hue'?' active':''}" data-widget="hue">Hue</button>
        <button class="sub-nav-btn${key==='redalert'?' active':''}" data-widget="redalert">Alerts</button>
      </div>`;
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
  } else if (key === 'weather') {
    inner.innerHTML = weatherSection();
    bindSimpleSave('weather');
  } else if (key === 'calendar') {
    inner.innerHTML = calendarSection();
    bindCalendarSave();
  } else if (key === 'news') {
    inner.innerHTML = newsSection();
    bindSimpleSave('news');
  } else if (key === 'hue') {
    inner.innerHTML = hueSection();
    bindHueSave();
  } else if (key === 'redalert') {
    inner.innerHTML = redalertSection();
    bindRedalertSave();
  }

  if (isWidget) {
    content.querySelectorAll('.sub-nav-btn').forEach(btn => {
      btn.onclick = () => showSection(btn.dataset.widget);
    });
  }
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

function groupWrap(title, bodyHTML) {
  return `
    <div class="field-group">
      <h3>${esc(title)}</h3>
      <div class="group-inner">${bodyHTML}</div>
    </div>`;
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
      ${checkField('Show Sleep Button', 'display.sleep_button', d.sleep_button !== false)}
      ${checkField('Show Ring Light Button', 'display.ring_light_button', d.ring_light_button !== false)}
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

function weatherSection() {
  const c = CFG.weather || {};
  return sectionWrap('Weather', `
    ${groupWrap('API Configuration', `
      ${field('OpenWeatherMap API Key', 'api_key', c.api_key, 'text', 'Get a free key at openweathermap.org')}
      ${field('City', 'city', c.city)}
      ${selectField('Units', 'units', c.units || 'metric', [
        {v:'metric', l:'Metric (°C)'}, {v:'imperial', l:'Imperial (°F)'}
      ])}
      ${field('Language', 'language', c.language || 'en', 'text', 'ISO code: en, he, de…')}
    `)}
    ${groupWrap('Limits', `
      ${field('API calls per day', 'calls_per_day', c.calls_per_day ?? 96, 'number')}
      ${field('Forecast days', 'forecast_days', c.forecast_days ?? 8, 'number')}
    `)}`);
}

function calendarSection() {
  const c = CFG.calendar || {};
  const cals = (c.calendars || []).map((cal) => `
    <div class="cal-row">
      <input type="text" class="cal-id" value="${esc(cal.id || '')}" placeholder="calendar@gmail.com">
      <input type="color" class="cal-color" value="${esc(cal.color || '#ffffff')}">
      <button class="cal-remove icon-btn">×</button>
    </div>`).join('');

  return sectionWrap('Calendar', `
    ${groupWrap('Settings', `
      ${field('Max events to show', 'max_events', c.max_events ?? 20, 'number', 'Next N upcoming events across all calendars')}
      ${field('Refresh (minutes)', 'refresh_minutes', c.refresh_minutes ?? 5, 'number')}
      ${checkField('Hebrew RTL support', 'hebrew', c.hebrew)}
    `)}
    ${groupWrap('Calendars', `
      <div id="cals-list" style="margin-bottom:12px">${cals}</div>
      <button id="add-cal" class="link-btn">+ Add Calendar</button>
    `)}
    ${groupWrap('Authentication', `
      <div class="field">
        <label>Google Calendar API</label>
        <button id="btn-setup-cal" class="secondary-btn">Connect Google Calendar</button>
        <span id="cal-auth-status" class="hint"></span>
      </div>
    `)}`);
}

function newsSection() {
  const c = CFG.news || {};
  return sectionWrap('News', `
    ${groupWrap('Status', checkField('Enabled', 'enabled', c.enabled !== false))}
    ${groupWrap('API Configuration', `
      ${field('NewsAPI Key', 'api_key', c.api_key)}
      ${field('Search query', 'q', c.q || '')}
      ${field('Country', 'country', c.country || 'il')}
    `)}
    ${groupWrap('Display', `
      ${field('Max articles', 'max_articles', c.max_articles ?? 8, 'number')}
    `)}`);
}

function hueSection() {
  const c = CFG.hue || {};
  return `
    <div class="section-header"><h2>Hue Lights</h2></div>
    <div class="section-body">
      ${groupWrap('Bridge', `
        ${field('Bridge IP', 'bridge_ip', c.bridge_ip || '')}
        ${field('Poll Interval (s)', 'poll_interval', c.poll_interval ?? 10, 'number')}
        <div class="pair-row">
          <button id="btn-pair" class="secondary-btn">Pair with Bridge</button>
          <span id="pair-status" class="hint"></span>
        </div>
      `)}
      <div id="hue-bridge-content">
        <div class="bridge-status">Loading bridge resources…</div>
      </div>
      <div class="save-row">
        <button id="save-btn" class="save-btn">Save</button>
        <button id="btn-discover" class="secondary-btn">Re-discover</button>
      </div>
    </div>`;
}

function redalertSection() {
  const c = CFG.redalert || {};
  return sectionWrap('Red Alert', `
    ${groupWrap('Status', checkField('Enabled', 'enabled', c.enabled !== false))}
    ${groupWrap('Test', `
      <div class="field">
        <label>Alert Overlay</label>
        <button id="btn-test-alert" class="secondary-btn">Flash Mirror Overlay (3s)</button>
      </div>
    `)}
    ${groupWrap('Configuration', `
      ${field('Poll interval (s)', 'poll_interval', c.poll_interval ?? 3, 'number')}
      <div class="field">
        <label>Watch Areas (one per line)</label>
        <textarea name="watch_areas" rows="8">${esc((c.watch_areas || []).join('\n'))}</textarea>
      </div>
    `)}`);
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

function bindSimpleSave(widget) {
  bindPickers();
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.onclick = async () => {
    const updated = { ...CFG[widget] };
    document.querySelectorAll('.section-body [name]').forEach(el => {
      const val = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      updated[el.name] = val;
    });
    await doSave(widget, updated);
  };
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

function bindCalendarSave() {
  bindPickers();
  bindRemoveBtns('.cal-remove', '.cal-row');
  const add = document.getElementById('add-cal');
  if (add) {
    add.onclick = () => {
      const list = document.getElementById('cals-list');
      const row = document.createElement('div');
      row.className = 'cal-row';
      row.innerHTML = `
        <input type="text" class="cal-id" value="">
        <input type="color" class="cal-color" value="#ffffff">
        <button class="cal-remove icon-btn">×</button>`;
      list.appendChild(row);
      bindRemoveBtns('.cal-remove', '.cal-row');
    };
  }
  const setup = document.getElementById('btn-setup-cal');
  const authStatus = document.getElementById('cal-auth-status');
  if (setup) {
    setup.onclick = async () => {
      setup.disabled = true;
      setup.textContent = 'Opening…';
      if (authStatus) authStatus.textContent = '';
      try {
        const r = await fetch('/api/calendar/auth-url');
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.detail || 'Failed to get auth URL');
        }
        const { url } = await r.json();
        const popup = window.open(url, 'google-auth', 'width=520,height=700,left=200,top=100');
        if (!popup) {
          if (authStatus) authStatus.textContent = 'Popup blocked — allow popups for this page.';
          setup.disabled = false;
          setup.textContent = 'Connect Google Calendar';
          return;
        }
        const onMsg = (e) => {
          if (e.data === 'calendar_auth_done') {
            window.removeEventListener('message', onMsg);
            clearInterval(pollClosed);
            showToast('Google Calendar connected!');
            if (authStatus) authStatus.textContent = 'Connected ✓';
            setup.disabled = false;
            setup.textContent = 'Re-connect Google Calendar';
          }
        };
        window.addEventListener('message', onMsg);
        const pollClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollClosed);
            window.removeEventListener('message', onMsg);
            setup.disabled = false;
            setup.textContent = 'Connect Google Calendar';
          }
        }, 800);
      } catch (e) {
        if (authStatus) authStatus.textContent = `Error: ${e.message}`;
        showToast(`Error: ${e.message}`, true);
        setup.disabled = false;
        setup.textContent = 'Connect Google Calendar';
      }
    };
  }
  
  const save = document.getElementById('save-btn');
  if (save) {
    save.onclick = async () => {
      const updated = { ...CFG.calendar };
      document.querySelectorAll('.section-body [name]').forEach(el => {
        updated[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      });
      updated.calendars = [...document.querySelectorAll('.cal-row')].map(r => ({
        id: r.querySelector('.cal-id').value,
        color: r.querySelector('.cal-color').value
      })).filter(x => x.id);
      await doSave('calendar', updated);
    };
  }
}

function bindRedalertSave() {
  bindPickers();
  const testBtn = document.getElementById('btn-test-alert');
  if (testBtn) {
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Flashing…';
      try {
        await fetch('/api/redalert/test', { method: 'POST' });
        showToast('Alert test triggered — check mirror');
      } catch (e) {
        showToast(`Error: ${e.message}`, true);
      }
      setTimeout(() => { testBtn.disabled = false; testBtn.textContent = 'Flash Mirror Overlay (3s)'; }, 3500);
    };
  }
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.onclick = async () => {
    const updated = { ...CFG.redalert };
    document.querySelectorAll('.section-body [name]').forEach(el => {
      if (el.name === 'watch_areas') {
        updated.watch_areas = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      } else {
        updated[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      }
    });
    await doSave('redalert', updated);
  };
}

function bindHueSave() {
  bindPickers();
  _hueLoadBridge();

  // Tap on Bridge IP → prompt keyboard
  const ipInput = document.querySelector('[name="bridge_ip"]');
  if (ipInput) {
    ipInput.addEventListener('focus', async e => {
      e.preventDefault();
      ipInput.blur();
      const val = await promptModal('Bridge IP address', ipInput.value);
      if (val !== null) ipInput.value = val.trim();
    });
  }

  // Pair
  const btnPair = document.getElementById('btn-pair');
  const pairStatus = document.getElementById('pair-status');
  if (btnPair) {
    btnPair.onclick = async () => {
      btnPair.disabled = true;
      if (pairStatus) pairStatus.textContent = 'Press link button on bridge…';
      let secs = 30;
      const cd = setInterval(() => { secs--; if (pairStatus) pairStatus.textContent = `Pairing… ${secs}s`; if (secs<=0) clearInterval(cd); }, 1000);
      try {
        const r = await fetch('/api/hue/pair', { method: 'POST' });
        clearInterval(cd);
        if (pairStatus) pairStatus.textContent = r.ok ? 'Paired! Reloading…' : 'Pairing failed';
        if (r.ok) { await loadAll(); await _hueLoadBridge(); }
      } catch (e) { clearInterval(cd); if (pairStatus) pairStatus.textContent = `Error: ${e.message}`; }
      finally { btnPair.disabled = false; }
    };
  }

  // Re-discover
  document.getElementById('btn-discover')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Discovering…';
    try {
      await fetch('/api/hue/discover', { method: 'POST' });
      await loadAll();
      await _hueLoadBridge();
      showToast('Discovery complete');
    } catch (err) { showToast(`Error: ${err.message}`, true); }
    finally { btn.disabled = false; btn.textContent = 'Re-discover'; }
  });

  // Save
  const btn = document.getElementById('save-btn');
  if (!btn) return;
  btn.onclick = async () => {
    const updated = { ...CFG.hue };
    const ipEl   = document.querySelector('[name="bridge_ip"]');
    const pollEl = document.querySelector('[name="poll_interval"]');
    if (ipEl)   updated.bridge_ip    = ipEl.value;
    if (pollEl) updated.poll_interval = Number(pollEl.value);

    const masterName = (CFG.hue?.master?.name || '').toLowerCase();
    const selectedRooms = [];
    document.querySelectorAll('#hue-bridge-content .bridge-item').forEach(item => {
      if (!item.querySelector('.room-enabled')?.checked) return;
      const name = item.dataset.roomName;
      const icon = item.querySelector('.room-icon')?.value || 'default';
      if (name.toLowerCase() === masterName) {
        updated.master = { ...(updated.master || {}), icon };
      } else {
        const existing = (CFG.hue?.rooms || []).find(r => r.name === name);
        selectedRooms.push({ ...(existing || {}), name, icon });
      }
    });
    updated.rooms = selectedRooms;

    const selectedScenes = [];
    document.querySelectorAll('#hue-bridge-content .scene-card').forEach(item => {
      if (!item.querySelector('.scene-enabled')?.checked) return;
      const name = item.dataset.sceneName;
      const id   = item.dataset.sceneId;
      const existing = (CFG.hue?.scenes || []).find(s => s.scene_id === id);
      selectedScenes.push({ ...(existing || {}), name, scene_id: id });
    });
    updated.scenes = selectedScenes;

    await doSave('hue', updated);
  };
}

async function _hueLoadBridge() {
  const wrap = document.getElementById('hue-bridge-content');
  if (!wrap) return;
  wrap.innerHTML = '<div class="bridge-status">Loading…</div>';
  try {
    const [resR, scenesR, lightsR] = await Promise.all([
      fetch('/api/hue/resources'),
      fetch('/api/hue/scenes-list'),
      fetch('/api/hue/lights'),
    ]);
    if (!resR.ok) throw new Error('Bridge unreachable — check IP and pairing');
    const { rooms } = await resR.json();
    const scenes    = scenesR.ok ? await scenesR.json() : [];
    const lights    = lightsR.ok ? await lightsR.json() : [];

    const cfg = CFG.hue || {};
    const masterName = (cfg.master?.name || '').toLowerCase();
    const enabledRooms  = new Set([masterName, ...(cfg.rooms || []).map(r => r.name.toLowerCase())].filter(Boolean));
    const enabledScenes = new Set((cfg.scenes || []).map(s => s.name.toLowerCase()));
    const iconOpts = ['default','bedroom','ceiling','spots','desk'];
    const iconFor  = name => {
      const lc = name.toLowerCase();
      if (lc === masterName) return cfg.master?.icon || 'default';
      return (cfg.rooms || []).find(r => r.name.toLowerCase() === lc)?.icon || 'default';
    };

    const roomsHtml = rooms.length ? rooms.map(r => `
      <div class="bridge-item" data-room-name="${esc(r.name)}">
        <input type="checkbox" class="room-enabled" ${enabledRooms.has(r.name.toLowerCase()) ? 'checked' : ''}>
        <div class="bridge-name">${esc(r.name)}</div>
        <div class="bridge-kind">${esc(r.kind || 'room')}</div>
        <select class="room-icon">
          ${iconOpts.map(ico => `<option value="${ico}"${iconFor(r.name)===ico?' selected':''}>${ico}</option>`).join('')}
        </select>
      </div>`).join('')
      : '<div class="bridge-status">No rooms found on bridge</div>';

    const scenesHtml = scenes.length ? scenes.map(s => `
      <div class="scene-card" data-scene-id="${esc(s.id)}" data-scene-name="${esc(s.name)}">
        <input type="checkbox" class="scene-enabled" ${enabledScenes.has(s.name.toLowerCase()) ? 'checked' : ''}>
        <div class="scene-swatch" style="background:${s.gradient}"></div>
        <div class="scene-name">${esc(s.name)}</div>
        <div class="scene-room">${esc(s.room)}</div>
      </div>`).join('')
      : '<div class="bridge-status">No scenes found</div>';

    const lightsHtml = lights.length ? lights.map(l => `
      <div class="light-item" data-light-id="${esc(l.id)}">
        <input type="checkbox" class="light-select">
        <div class="light-dot${l.on ? ' on' : ''}"></div>
        <div class="light-name">${esc(l.name)}</div>
      </div>`).join('')
      : '<div class="bridge-status">No lights found</div>';

    wrap.innerHTML = `
      ${groupWrap('Rooms & Zones', roomsHtml)}
      ${groupWrap('Scenes', scenesHtml)}
      ${groupWrap('Create Zone', `
        <div class="create-zone-panel">
          <h4>Select lights then name the zone</h4>
          ${lightsHtml}
          <div style="display:flex;gap:12px;margin-top:16px;align-items:center">
            <input type="text" id="zone-name" placeholder="Zone name…"
              style="flex:1;background:#1a1a1a;border:1.5px solid #2a2a2e;border-radius:10px;color:#fff;font-size:16px;padding:12px 14px;outline:none">
            <button id="btn-create-zone" class="secondary-btn">Create</button>
          </div>
        </div>
      `)}`;

    document.getElementById('btn-create-zone')?.addEventListener('click', async () => {
      const nameEl = document.getElementById('zone-name');
      const name = nameEl?.value?.trim();
      if (!name) { showToast('Enter a zone name', true); return; }
      const ids = [...wrap.querySelectorAll('.light-select:checked')]
        .map(cb => cb.closest('[data-light-id]')?.dataset.lightId).filter(Boolean);
      if (!ids.length) { showToast('Select at least one light', true); return; }
      const btn = document.getElementById('btn-create-zone');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await fetch('/api/hue/zone', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, light_ids: ids }),
        });
        if (r.ok) { showToast(`Zone "${name}" created`); await _hueLoadBridge(); }
        else showToast('Failed to create zone', true);
      } catch (e) { showToast(`Error: ${e.message}`, true); }
      finally { btn.disabled = false; btn.textContent = 'Create'; }
    });

  } catch (e) {
    wrap.innerHTML = `<div class="bridge-status">Error: ${esc(e.message)}</div>`;
  }
}

// ── Layout Editor ─────────────────────────────────────────────────────────────

const WIDGET_META = {
  datetime: { label: 'Clock',    color: '#1a2a4a' },
  weather:  { label: 'Weather',  color: '#1a3a2a' },
  calendar: { label: 'Calendar', color: '#3a3a1a' },
  hue:      { label: 'Hue',      color: '#3a1a3a' },
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
        box.style.height = Math.max(2 * CELL_H, Math.min(maxT - origT, origH + dy)) + 'px';
      }
    });

    box.addEventListener('pointerup', () => {
      if (!mode) return;
      box.classList.remove('dragging');
      // Snap to grid
      const cs = Math.max(1, Math.round(box.offsetLeft / CELL_W) + 1);
      const rs = Math.max(1, Math.round(box.offsetTop  / CELL_H) + 1);
      const ce = Math.min(GRID_COLS + 1, Math.max(cs + 4, Math.round((box.offsetLeft + box.offsetWidth)  / CELL_W) + 1));
      const re = Math.min(GRID_ROWS + 1, Math.max(rs + 2, Math.round((box.offsetTop  + box.offsetHeight) / CELL_H) + 1));
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
        ${groupWrap('iPhone / HTTPS Trust', `
          <div class="field">
            <label>Install Certificate on iPhone</label>
            <div style="background:#111;border-radius:10px;padding:14px 16px;font-family:monospace;font-size:15px;color:#4cd964;word-break:break-all">
              https://${esc(d.ip)}:${esc(String(d.port))}/cert.crt
            </div>
            <span class="hint">Open this URL in Safari on your iPhone → "Profile Downloaded" → Install → Settings → General → About → Certificate Trust Settings → enable MagicMirror.</span>
          </div>
        `)}
        ${groupWrap('Mirror Actions', `
          <div class="field">
            <label>Hard Reload</label>
            <button id="btn-hard-reload" class="secondary-btn">Force Reload Mirror (bypass cache)</button>
            <span class="hint">Clears widget data and re-fetches all assets on the mirror display.</span>
          </div>
        `)}
      </div>`;
    document.getElementById('btn-hard-reload')?.addEventListener('click', async () => {
      await fetch('/api/refresh', { method: 'POST' });
      await fetch('/api/hard-reload', { method: 'POST' });
      showToast('Hard reload sent to mirror');
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
