window.WidgetSettings = window.WidgetSettings || {};
(() => {
  const DOMAIN_LABELS = { switch: 'Switches', light: 'Lights', input_boolean: 'Toggles', fan: 'Fans' };
  const SCAN_LABEL = 'Scan again';

  window.WidgetSettings['homeassistant'] = {
    label: 'Home Assistant',

    // Everything Home Assistant in one tab: status on top, the rest in collapsible sections.
    // Server + token start folded once they're set (rarely changed); devices stay open.
    section(cfg, H) {
      const { field, groupWrap, sectionWrap } = H;
      const setUp = !!(cfg.url && cfg.token);
      const fold = (title, body, folded) =>
        groupWrap(title, body, true).replace('field-group collapsible', `field-group collapsible${folded ? ' collapsed' : ''}`);
      return sectionWrap('Home Assistant', `
        ${groupWrap('Status', `
          <div class="ha-status">
            <span class="light-dot" id="ha-dot"></span>
            <span id="ha-status-text">Checking…</span>
            <button class="secondary-btn" id="ha-check">Check</button>
          </div>`)}
        ${fold('Server', `
          <div class="ha-list" id="ha-found"></div>
          <button class="secondary-btn" id="ha-scan">${SCAN_LABEL}</button>`, setUp)}
        ${fold('Access Token', field('Long-lived access token', 'token', cfg.token, 'password',
          'HA → Profile → Security → Long-lived access tokens'), setUp)}
        ${fold('Mirror Display Device', `<div id="ha-devices"></div>`, !!cfg.display_switch)}
        ${fold('Devices on the Mirror', `
          <div class="ha-hint">Shown in the Home card. To put one device anywhere on the mirror, add a device tile in the phone control panel → Layout.</div>
          <div id="ha-home-devs"></div>`, false)}
      `);
    },

    onMount(el, cfg, H) {
      const $ = s => el.querySelector(s);
      // Servers come only from the network scan; the saved one stays listed even if a scan misses it
      const cur = /^https?:\/\/([^/:]+)(?::(\d+))?/.exec(cfg.url || '');
      let host = cur ? cur[1].replace('127.0.0.1', 'localhost') : '';
      let port = cur?.[2] || '8123';
      const saved = host ? [{ host, port, name: 'Current server' }] : [];
      let found = saved;
      let entities = [], domain = '', picked = cfg.display_switch || '';

      const toggles = () => [...el.querySelectorAll('[data-hadev]')];
      const collect = () => ({
        ...cfg, url: `http://${host}:${port}`, token: $('[name=token]').value.trim(), display_switch: picked,
        // Device list not loaded (HA offline): keep the saved choice
        hidden_devices: toggles().length ? toggles().filter(t => !t.checked).map(t => t.dataset.hadev) : (cfg.hidden_devices || []),
      });

      // ── Devices in the Home card (one switch each, by room) ──
      const renderHomeDevices = async () => {
        let d = null;
        try { const r = await fetch('/api/homeassistant/devices'); if (r.ok) d = await r.json(); } catch {}
        const devs = d?.devices || [];
        if (!devs.length) { $('#ha-home-devs').innerHTML = '<div class="bridge-status">Available once Home Assistant is connected</div>'; return; }
        const hidden = new Set(cfg.hidden_devices || []);
        $('#ha-home-devs').innerHTML = [...new Set(devs.map(x => x.area))].map(area => `
          <div class="ha-area-title">${H.esc(area)}</div>
          ${devs.filter(x => x.area === area).map(x => `
            <label class="ha-row ha-dev-row"><span>${H.esc(x.name)}</span><span class="ha-row-sub">${H.esc(x.entity)}</span>
              <input type="checkbox" data-hadev="${H.esc(x.id)}"${hidden.has(x.id) ? '' : ' checked'}></label>`).join('')}`).join('');
      };

      // ── Server choice ──
      const renderFound = () => {
        $('#ha-found').innerHTML = found.map(f => `
          <button class="ha-row${f.host === host ? ' active' : ''}" data-host="${H.esc(f.host)}" data-port="${f.port}">
            <span>${H.esc(f.name)}</span><span class="ha-row-sub">${H.esc(f.host)}:${f.port}</span>
          </button>`).join('') || '<div class="bridge-status">No Home Assistant found on this network</div>';
      };
      $('#ha-found').onclick = e => {
        const b = e.target.closest('[data-host]');
        if (!b) return;
        host = b.dataset.host; port = b.dataset.port;
        renderFound();
      };
      const scan = async () => {
        const b = $('#ha-scan');
        b.disabled = true; b.textContent = 'Scanning…';
        $('#ha-found').innerHTML = found.length ? $('#ha-found').innerHTML : '<div class="bridge-status">Looking for Home Assistant…</div>';
        let err = '';
        try {
          const r = await fetch('/api/homeassistant/scan', { method: 'POST' });
          if (r.ok) {
            const res = await r.json();
            found = [...res, ...saved.filter(s => !res.some(f => f.host === s.host))];
          } else err = `Scan failed (HTTP ${r.status})`;
        } catch { err = 'Scan failed: mirror server not responding'; }
        b.disabled = false; b.textContent = SCAN_LABEL;
        if (err) { $('#ha-found').innerHTML = `<div class="bridge-status">${H.esc(err)}</div>`; return; }
        if (!host && found.length === 1) { host = found[0].host; port = String(found[0].port); }  // only one → pick it
        renderFound();
      };
      $('#ha-scan').onclick = scan;

      // ── Status + device picker (device list only when HA is reachable) ──
      const renderDevices = () => {
        const domains = [...new Set(entities.map(e => e.entity_id.split('.')[0]))];
        const shown = entities.filter(e => !domain || e.entity_id.startsWith(domain + '.'));
        $('#ha-devices').innerHTML = `
          <div class="ha-chips">${['', ...domains].map(d => `
            <button class="sub-nav-btn${domain === d ? ' active' : ''}" data-domain="${d}">${d ? DOMAIN_LABELS[d] || d : 'All'}</button>`).join('')}
          </div>
          <div class="ha-list">${shown.map(e => `
            <button class="ha-row${e.entity_id === picked ? ' active' : ''}" data-entity="${H.esc(e.entity_id)}">
              <span>${H.esc(e.name)}</span><span class="ha-row-sub">${H.esc(e.entity_id)}</span>
            </button>`).join('') || '<div class="bridge-status">No devices in this group</div>'}
          </div>`;
      };
      $('#ha-devices').onclick = async e => {
        const d = e.target.closest('[data-domain]');
        if (d) { domain = d.dataset.domain; renderDevices(); return; }
        const r = e.target.closest('[data-entity]');
        if (!r) return;
        picked = r.dataset.entity;
        renderDevices();
        await H.doSave('homeassistant', Object.assign(cfg, { display_switch: picked }));  // tap = saved
      };

      const STATUS = {
        ok:           s => [`Connected to ${s.name || 'Home Assistant'}${s.version ? ` (${s.version})` : ''}`, 'var(--success)'],
        unauthorized: () => ['Server found, but the access token was rejected', 'var(--danger)'],
        unreachable:  s => [`Can't reach Home Assistant${s.detail ? ` (${s.detail})` : ''}`, 'var(--danger)'],
        unconfigured: () => ['Not set up: pick a server, enter the token, then Save', ''],
      };
      const refresh = async () => {
        $('#ha-status-text').textContent = 'Checking…';
        let s;
        try {
          const r = await fetch('/api/homeassistant/status');
          s = r.ok ? await r.json() : { state: 'unreachable', detail: `mirror server needs a restart, HTTP ${r.status}` };
        }
        catch { s = { state: 'unreachable', detail: 'mirror server not responding' }; }
        const [text, color] = (STATUS[s.state] || STATUS.unreachable)(s);
        $('#ha-status-text').textContent = text;
        $('#ha-dot').style.background = color;

        entities = [];
        if (s.state === 'ok') {
          try { const r = await fetch('/api/homeassistant/entities'); if (r.ok) entities = await r.json(); } catch {}
        }
        if (s.state === 'ok' && entities.length) renderDevices();
        else $('#ha-devices').innerHTML = `<div class="bridge-status">${s.state === 'ok'
          ? 'No switchable devices found in Home Assistant' : 'Available once Home Assistant is connected'}</div>`;
      };
      $('#ha-check').onclick = refresh;

      $('#save-btn').onclick = async () => {
        if (!host) { H.showToast('Pick a Home Assistant server first', true); return; }
        await H.doSave('homeassistant', Object.assign(cfg, collect()));
        refresh();  // server/token may have changed
      };

      H.bindCollapsibles(el);
      renderFound(); refresh(); scan(); renderHomeDevices();
    },
  };
})();
