window.WidgetSettings = window.WidgetSettings || {};
(() => {
  const LOCAL_URL = 'http://localhost:8123';
  const DOMAIN_LABELS = { switch: 'Switches', light: 'Lights', input_boolean: 'Toggles', fan: 'Fans' };
  const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const SCAN_LABEL = 'Scan network for Home Assistant';

  function parseUrl(url) {
    const m = /^https?:\/\/([^/:]+)(?::(\d+))?/.exec(url || '');
    if (!m) return { mode: 'local', host: '', port: '8123' };
    const local = ['localhost', '127.0.0.1'].includes(m[1]);
    return { mode: local ? 'local' : 'network', host: local ? '' : m[1], port: m[2] || '8123' };
  }

  window.WidgetSettings['homeassistant'] = {
    label: 'Home Assistant',

    section(cfg, H) {
      const { field, groupWrap, sectionWrap } = H;
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'Next'];
      return sectionWrap('Home Assistant', `
        ${groupWrap('Status', `
          <div class="ha-status">
            <span class="light-dot" id="ha-dot"></span>
            <span id="ha-status-text">Checking…</span>
            <button class="secondary-btn" id="ha-check">Check</button>
          </div>`)}
        ${groupWrap('Server', `
          <div class="ha-chips">
            <button class="sub-nav-btn" data-mode="local">This mirror (localhost)</button>
            <button class="sub-nav-btn" data-mode="network">Another device (IP)</button>
          </div>
          <div id="ha-network" hidden>
            <button class="secondary-btn" id="ha-scan">${SCAN_LABEL}</button>
            <div class="ha-list" id="ha-found"></div>
            <div class="ha-hint">Or enter the IP — tap a part, then use the keypad</div>
            <div class="ha-ip" id="ha-ip"></div>
            <div class="ha-keypad" id="ha-keypad">
              ${keys.map(k => `<button class="secondary-btn" data-key="${k}">${k}</button>`).join('')}
            </div>
          </div>`)}
        ${groupWrap('Access Token', field('Long-lived access token', 'token', cfg.token, 'password',
          'HA → Profile → Security → Long-lived access tokens'))}
        ${groupWrap('Mirror Display Device', `<div id="ha-devices"></div>`)}
      `);
    },

    onMount(el, cfg, H) {
      const $ = s => el.querySelector(s);
      const p = parseUrl(cfg.url);
      let mode = p.mode;
      let host = p.host;                       // IP or hostname of a network server
      let segs = [...(IPV4.test(host) ? host.split('.') : ['', '', '', '']), p.port];  // 4 octets + port
      let active = 0;                          // keypad target segment
      let found = host && !IPV4.test(host) ? [{ host, port: p.port, name: 'Current server' }] : [];
      let entities = [], domain = '', picked = cfg.display_switch || '';

      const url = () => mode === 'local' ? LOCAL_URL : `http://${host}:${segs[4] || 8123}`;
      const collect = () => ({ ...cfg, url: url(), token: $('[name=token]').value.trim(), display_switch: picked });

      // ── Server choice ──
      const renderMode = () => {
        el.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        $('#ha-network').hidden = mode !== 'network';
      };
      const renderIp = () => {
        $('#ha-ip').innerHTML = segs.map((s, i) => `${i === 4 ? ':' : i ? '.' : ''}` +
          `<button class="ha-seg${i === active ? ' active' : ''}" data-seg="${i}">${H.esc(s) || '–'}</button>`).join('');
      };
      const renderFound = () => {
        $('#ha-found').innerHTML = found.map(f => `
          <button class="ha-row${f.host === host ? ' active' : ''}" data-host="${H.esc(f.host)}" data-port="${f.port}">
            <span>${H.esc(f.name)}</span><span class="ha-row-sub">${H.esc(f.host)}:${f.port}</span>
          </button>`).join('');
      };

      el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
        mode = b.dataset.mode; renderMode();
        if (mode === 'network' && !scanned) scan();
      });
      $('#ha-ip').onclick = e => {
        const b = e.target.closest('[data-seg]');
        if (b) { active = Number(b.dataset.seg); renderIp(); }
      };
      $('#ha-keypad').onclick = e => {
        const k = e.target.dataset.key;
        if (k == null) return;
        const isPort = active === 4;
        if (k === '⌫') segs[active] = segs[active].slice(0, -1);
        else if (k === 'Next') active = (active + 1) % 5;
        else {
          const next = String(Number(segs[active] + k));  // Number() drops leading zeros
          if (Number(next) <= (isPort ? 65535 : 255)) segs[active] = next;
          if (!isPort && segs[active].length === 3) active++;  // full octet → jump to the next one
        }
        if (segs.slice(0, 4).every(s => s !== '')) host = segs.slice(0, 4).join('.');
        renderIp(); renderFound();
      };
      $('#ha-found').onclick = e => {
        const b = e.target.closest('[data-host]');
        if (!b) return;
        if (b.dataset.host === 'localhost') { mode = 'local'; renderMode(); return; }
        host = b.dataset.host;
        segs = [...(IPV4.test(host) ? host.split('.') : ['', '', '', '']), b.dataset.port];
        renderIp(); renderFound();
      };
      let scanned = false;
      const scan = async () => {
        scanned = true;
        const b = $('#ha-scan');
        b.disabled = true; b.textContent = 'Scanning…';
        let err = '';
        try {
          const r = await fetch('/api/homeassistant/scan', { method: 'POST' });
          if (r.ok) found = await r.json();
          else { found = []; err = `Scan failed (HTTP ${r.status}). Restart the mirror server to load the Home Assistant update.`; }
        } catch { found = []; err = 'Scan failed: mirror server not responding'; }
        b.disabled = false; b.textContent = SCAN_LABEL;
        if (err) { $('#ha-found').innerHTML = `<div class="bridge-status">${H.esc(err)}</div>`; return; }
        // Nothing chosen yet and exactly one server found → pick it for the user
        const remote = found.filter(f => f.host !== 'localhost');
        if (!host && remote.length === 1) { host = remote[0].host; segs = [...host.split('.'), String(remote[0].port)]; renderIp(); }
        if (found.length) renderFound();
        else $('#ha-found').innerHTML = '<div class="bridge-status">No Home Assistant found on this network</div>';
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
        unconfigured: () => ['Not set up: choose a server, enter the token, then Save', ''],
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
        if (mode === 'network' && !host) { H.showToast('Pick a server or enter its IP first', true); return; }
        await H.doSave('homeassistant', Object.assign(cfg, collect()));
        refresh();  // server/token may have changed
      };

      renderMode(); renderIp(); renderFound(); refresh();
      if (mode === 'network') scan();  // show what's on the network without a tap
    },
  };
})();
