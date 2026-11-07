// Home Assistant devices on the mirror.
// This file holds the shared pieces (live store, tiles, device popup, Home card) and the
// Home button widget. widgets/homeassistant/ha_tile/ha_tile.js places single device tiles.
(() => {
  // Lucide icons (lucide-static 0.460.0, ISC licence: https://lucide.dev/license): inner SVG of each 24x24 icon
  const P = {
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    snow: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    fan: '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/>',
    drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    auto: '<path d="M10 9a3 3 0 1 0 0 6"/><path d="M2 12h1"/><path d="M14 21V3"/><path d="M10 4V3"/><path d="M10 21v-1"/><path d="m3.64 18.36.7-.7"/><path d="m4.34 6.34-.7-.7"/><path d="M14 12h8"/><path d="m17 4-3 3"/><path d="m14 17 3 3"/><path d="m21 15-3-3 3-3"/>',
    fanauto: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    tv: '<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    speaker: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    next: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    prev: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
    vol: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    mute: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    run: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
    react: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    light: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    filter: '<path d="M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 8h12"/><path d="M18.3 17.7a2.5 2.5 0 0 1-3.16 3.83 2.53 2.53 0 0 1-1.14-2V12"/><path d="M6.6 15.6A2 2 0 1 0 10 17v-5"/>',
    fan1: '<path d="M2 20h.01"/><path d="M7 20v-4"/>',
    fan2: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/>',
    fan3: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/>',
    fan4: '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
    'move-up': '<path d="M8 6L12 2L16 6"/><path d="M12 2V22"/>',
    'move-up-right': '<path d="M13 5H19V11"/><path d="M19 5L5 19"/>',
    'move-right': '<path d="M18 8L22 12L18 16"/><path d="M2 12H22"/>',
    'move-down-right': '<path d="M19 13V19H13"/><path d="M5 5L19 19"/>',
    'move-down': '<path d="M8 18L12 22L16 18"/><path d="M12 2V22"/>',
    'move-left': '<path d="M6 8L2 12L6 16"/><path d="M2 12H22"/>',
    'move-down-left': '<path d="M11 19H5V13"/><path d="M19 5L5 19"/>',
    'chevrons-up': '<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>',
    'chevrons-down': '<path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/>',
    'unfold-vertical': '<path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/>',
    'move-vertical': '<path d="M12 2v20"/><path d="m8 18 4 4 4-4"/><path d="m8 6 4-4 4 4"/>',
    'arrow-left-right': '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    'move-horizontal': '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>',
    'unfold-horizontal': '<path d="M16 12h6"/><path d="M8 12H2"/><path d="M12 2v2"/><path d="M12 8v2"/><path d="M12 14v2"/><path d="M12 20v2"/><path d="m19 15 3-3-3-3"/><path d="m5 9-3 3 3 3"/>',
  };
  const icon = (n, cls = '') => `<svg class="ha-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HEB = /[֐-׿]/;
  const textAttrs = s => HEB.test(s) ? ' dir="rtl"' : '';
  const domainOf = e => e.split('.', 1)[0];
  // "fixedMiddleTop" / "fan_only" / "heat_cool" → readable
  const MODE_LABEL = { heat_cool: 'Auto', fan_only: 'Fan', dry: 'Dry', cool: 'Cool', heat: 'Heat', off: 'Off', auto: 'Auto' };
  const pretty = s => MODE_LABEL[s] || String(s).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
  const MODE_ICON = { cool: 'snow', heat: 'flame', fan_only: 'fan', dry: 'drop', heat_cool: 'auto', auto: 'auto' };

  // media_player supported_features bits
  const MF = { PAUSE: 1, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256, SELECT_SOURCE: 2048, PLAY: 16384 };

  // ── Live store ─────────────────────────────────────────────────────────────
  // Server sends ha_state (everything) on connect and ha_delta (changed entities) after.
  // Taps update the UI at once (optimistic); HA's confirmation or a timeout settles it.
  const HA = {
    devices: [], states: {}, hidden: new Set(), connected: false, ready: false,
    _confirmed: {}, _pending: {}, _subs: new Map(), _modelSubs: new Set(), _dirty: new Set(),

    device(key) { return this.devices.find(d => d.entity === key || d.id === key); },
    visibleDevices() { return this.devices.filter(d => !this.hidden.has(d.id)); },
    st(e) { return this.states[e] || { s: 'unavailable', a: {} }; },

    on(entity, fn) {
      if (!this._subs.has(entity)) this._subs.set(entity, new Set());
      this._subs.get(entity).add(fn);
      return () => this._subs.get(entity)?.delete(fn);
    },
    onModel(fn) { this._modelSubs.add(fn); return () => this._modelSubs.delete(fn); },

    _notify(entities) {
      // Asleep: nothing is painted, so remember what changed and redraw on wake
      if (document.body.classList.contains('sleeping')) { entities.forEach(e => this._dirty.add(e)); return; }
      for (const e of entities) this._subs.get(e)?.forEach(fn => fn(this.st(e)));
    },
    wake() {
      if (this._modelDirty) { this._modelDirty = false; this._modelSubs.forEach(fn => fn()); }
      const d = [...this._dirty]; this._dirty.clear(); this._notify(d);
    },

    setModel(data) {
      if (!data) return;
      this.devices = data.devices || [];
      this.states = { ...(data.states || {}) };
      this._confirmed = { ...this.states };
      this.hidden = new Set(data.hidden || []);
      HAUI.displaySwitch = data.display || null;
      this.connected = !!data.connected;
      this.ready = true;
      if (document.body.classList.contains('sleeping')) { this._modelDirty = true; return; }
      this._modelSubs.forEach(fn => fn());
    },
    applyDelta(data) {
      if ('connected' in data) { this.connected = data.connected; this._modelSubs.forEach(fn => fn()); }
      const changed = Object.keys(data.states || {});
      for (const e of changed) {
        this._confirmed[e] = data.states[e];
        this.states[e] = data.states[e];
        clearTimeout(this._pending[e]); delete this._pending[e];
      }
      this._notify(changed);
    },

    // Run a service; `optimistic` is a state patch shown until HA confirms (or reverted)
    async call(entity, service, data = {}, optimistic = null) {
      if (optimistic) {
        const cur = this.st(entity);
        this.states[entity] = { s: optimistic.s ?? cur.s, a: { ...cur.a, ...(optimistic.a || {}) }, pending: true };
        this._notify([entity]);
      }
      const revert = () => {
        delete this._pending[entity];
        if (this._confirmed[entity]) this.states[entity] = this._confirmed[entity];
        this._notify([entity]);
      };
      try {
        const r = await fetch('/api/homeassistant/call', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: entity, service, data }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
        // HA usually reports the new state within a second; if nothing changes, show the truth
        if (optimistic) { clearTimeout(this._pending[entity]); this._pending[entity] = setTimeout(revert, 5000); }
        return true;
      } catch (err) {
        console.warn('[HA]', entity, service, err.message);
        revert();
        HAUI.flashError(entity);
        return false;
      }
    },
  };
  window.HA = HA;
  WS.on('ha_state', d => HA.setModel(d));
  WS.on('ha_delta', d => HA.applyDelta(d));

  // ── Tile (same markup on the mirror and in the Home card) ──────────────────
  function tileState(dev) {
    const e = dev.entity, d = domainOf(e), st = HA.st(e), a = st.a || {};
    const off = st.s === 'off' || st.s === 'unavailable' || st.s === 'standby';
    const t = { icon: 'plug', main: '', sub: '', on: !off, action: null, unavailable: st.s === 'unavailable', warn: false, art: null };
    if (d === 'climate') {
      t.icon = MODE_ICON[st.s] || 'snow';
      t.main = a.temperature != null ? `${a.temperature}°` : '';
      t.sub = `${st.s === 'off' ? 'Off' : pretty(st.s)}${a.current_temperature != null ? ` · ${a.current_temperature}° now` : ''}`;
      t.mode = st.s;
      t.action = 'power';
      t.warn = dev.extras.some(([x]) => domainOf(x) === 'binary_sensor' && HA.st(x).s === 'on');
    } else if (d === 'media_player') {
      t.icon = a.device_class === 'tv' ? 'tv' : 'speaker';
      t.on = !['off', 'unavailable', 'standby'].includes(st.s);
      const what = [a.media_title, a.media_artist].filter(Boolean).join(' · ') || a.app_name;
      t.sub = st.s === 'playing' || st.s === 'paused' ? (what || pretty(st.s)) : pretty(st.s);
      t.playing = st.s === 'playing';
      const f = a.supported_features || 0;
      t.action = (st.s === 'playing' || st.s === 'paused') && (f & (MF.PAUSE | MF.PLAY)) ? 'playpause'
        : (f & (t.on ? MF.TURN_OFF : MF.TURN_ON)) ? 'power' : null;
      if (a.pic && t.on) t.art = `/api/homeassistant/art/${encodeURIComponent(e)}?v=${a.pic}`;
    } else if (d === 'switch') {
      t.icon = 'plug'; t.sub = st.s === 'on' ? 'On' : pretty(st.s); t.action = 'toggle';
    } else {  // script / automation
      t.icon = 'run'; t.on = false; t.sub = 'Tap to run'; t.action = 'run';
    }
    if (t.unavailable) { t.sub = 'Unavailable'; t.action = null; }
    return t;
  }

  function tileHTML(dev) {
    return `<div class="ha-tile" data-entity="${esc(dev.entity)}">
      <div class="ha-tile-art"></div>
      <div class="ha-tile-top">
        <span class="ha-tile-icon"></span>
        <button class="ha-tile-btn" aria-label="Power"></button>
      </div>
      <div class="ha-tile-main"></div>
      <div class="ha-tile-name"${textAttrs(dev.name)}>${esc(dev.name)}</div>
      <div class="ha-tile-sub"></div>
      <span class="ha-tile-warn" hidden>${icon('warn')}</span>
      <span class="ha-tile-hold"></span>
    </div>`;
  }

  // Patch an existing tile in place: only what changed, never the whole widget
  function updateTile(el, dev) {
    const t = tileState(dev);
    const set = (sel, html) => { const n = el.querySelector(sel); if (n._v !== html) { n._v = html; n.innerHTML = html; } };
    el.classList.toggle('on', t.on);
    el.classList.toggle('unavailable', t.unavailable);
    el.classList.toggle('pending', !!HA.st(dev.entity).pending);
    el.dataset.mode = t.mode || '';
    set('.ha-tile-icon', icon(t.icon));
    set('.ha-tile-main', esc(t.main));
    set('.ha-tile-sub', esc(t.sub));
    el.querySelector('.ha-tile-sub').dir = HEB.test(t.sub) ? 'rtl' : '';
    const btn = el.querySelector('.ha-tile-btn');
    btn.hidden = !t.action || t.action === 'toggle' || t.action === 'run';
    set('.ha-tile-btn', t.action === 'playpause' ? icon(t.playing ? 'pause' : 'play') : icon('power'));
    el.querySelector('.ha-tile-warn').hidden = !t.warn;
    const art = el.querySelector('.ha-tile-art');
    if (art._src !== t.art) { art._src = t.art; art.style.backgroundImage = t.art ? `url("${t.art}")` : ''; }
  }

  const isDisplaySwitch = e => e === HAUI.displaySwitch;

  // Tap on a tile: the round button does the quick action; the body opens the controls
  // (switches toggle and scripts run straight away — they have nothing more to show)
  function bindTile(el, dev, { onOpen } = {}) {
    const quick = () => {
      const t = tileState(dev), e = dev.entity, d = domainOf(e), st = HA.st(e);
      if (t.action === 'power') {
        if (d === 'climate') {
          // Back on in the last mode HA remembers (turn_on); off is a mode in HA
          if (st.s === 'off') HA.call(e, 'turn_on', {}, { s: 'cool' });
          else HA.call(e, 'turn_off', {}, { s: 'off' });
        } else HA.call(e, t.on ? 'turn_off' : 'turn_on', {}, { s: t.on ? 'off' : 'on' });
      } else if (t.action === 'playpause') HA.call(e, 'media_play_pause', {}, { s: t.playing ? 'paused' : 'playing' });
      else if (t.action === 'toggle') HA.call(e, st.s === 'on' ? 'turn_off' : 'turn_on', {}, { s: st.s === 'on' ? 'off' : 'on' });
      else if (t.action === 'run') {
        HA.call(e, d === 'automation' ? 'trigger' : 'turn_on').then(ok => ok && HAUI.flashDone(el));
      }
    };
    el.querySelector('.ha-tile-btn').addEventListener('click', ev => { ev.stopPropagation(); quick(); });
    // The mirror's own power socket: hold to switch off, so a stray touch can't blank the screen
    if (isDisplaySwitch(dev.entity)) {
      holdToConfirm(el, () => HA.st(dev.entity).s === 'on', quick);
      el.addEventListener('click', () => { if (HA.st(dev.entity).s !== 'on') quick(); });
      return;
    }
    el.addEventListener('click', () => {
      const d = domainOf(dev.entity);
      if (d === 'switch' || d === 'script' || d === 'automation') quick();
      else if (!tileState(dev).unavailable) (onOpen || (() => HAUI.openDevice(dev)))();
    });
  }

  // Press and hold (0.8 s) to fire; `when()` false = a plain tap is fine
  function holdToConfirm(el, when, fire) {
    let timer = null, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('holding'); };
    el.addEventListener('pointerdown', () => {
      if (!when()) return;
      el.classList.add('holding');
      timer = setTimeout(() => { cancel(); fired = true; fire(); }, 800);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, cancel));
    // The click that ends a completed hold must not also count as a tap (it would undo the hold)
    el.addEventListener('click', ev => { if (fired) { fired = false; ev.stopImmediatePropagation(); } }, true);
  }

  // ── Modal (shared #modal-overlay, same open/close pattern as weather/calendar) ──
  const modal = () => document.getElementById('modal-overlay');
  const card = () => document.getElementById('modal-card');
  let _closeModal = null, _unsubs = [];

  function openModal(className, render) {
    const m = modal(), c = card();
    if (!m || !c) return;
    _unsubs.forEach(u => u()); _unsubs = [];
    c.className = className;
    render(c);
    if (_closeModal) return;  // already open (Home card → device): just swap the content
    document.body.classList.add('modal-open');
    m.classList.add('open');
    const close = evt => {
      if (evt && evt.type === 'click' && evt.target !== m) return;
      closeModal();
    };
    _closeModal = () => {
      m.removeEventListener('click', close);
      document.body.classList.remove('modal-open');
      m.classList.remove('open');
      setTimeout(() => { if (!_closeModal) c.className = ''; }, 300);
    };
    setTimeout(() => m.addEventListener('click', close), 10);
  }
  function closeModal() {
    _unsubs.forEach(u => u()); _unsubs = [];
    const f = _closeModal; _closeModal = null; f?.();
  }

  // ── Device controls popup ──────────────────────────────────────────────────
  function openDevice(dev, { back = null } = {}) {
    openModal('ha-card ha-detail', c => {
      const draw = () => drawDevice(c, dev, back);
      draw();
      const redraw = () => { if (!c._busy) draw(); else c._stale = true; };
      _unsubs.push(HA.on(dev.entity, redraw), ...dev.extras.map(([x]) => HA.on(x, redraw)));
    });
  }

  // ── Option pictures: fan speed → level bars, swing → airflow from the vent. null = no picture (keep the word) ──
  const FAN_LEVEL = { quiet: 1, low: 1, medium_low: 2, medium: 2, medium_high: 3, high: 3, strong: 4, turbo: 4 };
  const fanPic = v => /auto/i.test(v) ? P.fanauto : P['fan' + FAN_LEVEL[String(v).toLowerCase()]] || null;
  // Slowest → fastest, auto (and unknown speeds) last
  const byLevel = list => [...list].sort((x, y) => (FAN_LEVEL[x.toLowerCase()] || 9) - (FAN_LEVEL[y.toLowerCase()] || 9));
  // Airflow direction: arrow = fixed, double arrow / chevrons = sweep. Vertical blows out sideways, horizontal from above.
  const SWING_V = { stopped: 'pause', fixedtop: 'move-up', fixedmiddletop: 'move-up-right', fixedmiddle: 'move-right',
    fixedmiddlebottom: 'move-down-right', fixedbottom: 'move-down', rangetop: 'chevrons-up', rangemiddle: 'unfold-vertical',
    rangebottom: 'chevrons-down', rangefull: 'move-vertical' };
  const SWING_H = { stopped: 'pause', fixedleft: 'move-left', fixedcenterleft: 'move-down-left', fixedcenter: 'move-down',
    fixedcenterright: 'move-down-right', fixedright: 'move-right', fixedleftright: 'arrow-left-right',
    rangefull: 'move-horizontal', rangecenter: 'unfold-horizontal' };
  const swingPic = (v, horizontal) => P[(horizontal ? SWING_H : SWING_V)[String(v).toLowerCase()]] || null;
  // Section title with the current value: the chips are pictures, so say what's selected
  const label = (title, v) => `<div class="ha-label">${esc(title)}${v ? ` <b>· ${esc(pretty(v))}</b>` : ''}</div>`;

  // Icon-only chip when the value has a picture; the word stays as its accessible name and tooltip
  function picChips(list, current, attr, picFn, extra = '') {
    return `<div class="ha-chips">${list.map(v => {
      const pic = picFn(v), word = esc(pretty(v));
      return `<button class="ha-chip${pic ? ' pic' : ''}${v === current ? ' active' : ''}" ${extra}data-${attr}="${esc(v)}" aria-label="${word}" title="${word}">${pic
        ? `<svg class="ha-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pic}</svg>`
        : `<span>${word}</span>`}</button>`;
    }).join('')}</div>`;
  }

  function chips(list, current, attr, labelFn = pretty, iconFn = null) {
    return `<div class="ha-chips">${list.map(v => `
      <button class="ha-chip${v === current ? ' active' : ''}" data-${attr}="${esc(v)}">${iconFn ? icon(iconFn(v) || 'power') : ''}<span>${esc(labelFn(v))}</span></button>`).join('')}</div>`;
  }

  function drawDevice(c, dev, back) {
    const e = dev.entity, d = domainOf(e), st = HA.st(e), a = st.a || {};
    const head = `<div class="ha-head">
      ${back ? `<button class="ha-icon-btn" data-act="back">${icon('back')}</button>` : ''}
      <div class="ha-head-title"><div${textAttrs(dev.name)}>${esc(dev.name)}</div><span>${esc(dev.area)}</span></div>
      ${d === 'climate' ? `<button class="ha-icon-btn ha-power${st.s !== 'off' ? ' on' : ''}" data-mode="${esc(st.s)}" data-act="power" aria-label="Power">${icon('power')}</button>` : ''}
      <button class="ha-icon-btn" data-act="close">${icon('close')}</button>
    </div>`;
    let body = '';
    if (d === 'climate') {
      const on = st.s !== 'off', ex = extrasHTML(dev);
      body = `
        <div class="ha-thermo${on ? '' : ' off'}" data-mode="${esc(st.s)}">
          <button class="ha-round" data-act="temp-" aria-label="Lower">${icon('minus')}</button>
          <div class="ha-temp"><b>${a.temperature ?? '–'}°</b><span>${a.current_temperature != null ? `${a.current_temperature}° in the room` : ''}</span></div>
          <button class="ha-round" data-act="temp+" aria-label="Raise">${icon('plus')}</button>
        </div>
        ${label('Mode', st.s)}${picChips((a.hvac_modes || []).filter(m => m !== 'off'), st.s, 'hvac', v => P[MODE_ICON[v]] || null)}
        <div class="ha-settings${on ? '' : ' off'}">
          ${a.fan_modes?.length ? label('Fan', a.fan_mode) + picChips(byLevel(a.fan_modes), a.fan_mode, 'fan', fanPic) : ''}
          ${a.swing_modes?.length ? label('Swing', a.swing_mode) + picChips(a.swing_modes, a.swing_mode, 'swing', v => swingPic(v, false)) : ''}
          ${ex.settings}
        </div>
        ${ex.rest}`;
    } else if (d === 'media_player') {
      const f = a.supported_features || 0, on = !['off', 'unavailable', 'standby'].includes(st.s);
      const art = a.pic && on ? `/api/homeassistant/art/${encodeURIComponent(e)}?v=${a.pic}` : null;
      const what = [a.media_title, a.media_artist].filter(Boolean);
      body = `
        <div class="ha-media">
          <div class="ha-media-art"${art ? ` style="background-image:url('${art}')"` : ''}>${art ? '' : icon(a.device_class === 'tv' ? 'tv' : 'speaker')}</div>
          <div class="ha-media-text"><b${textAttrs(what[0] || '')}>${esc(what[0] || pretty(st.s))}</b><span${textAttrs(what[1] || '')}>${esc(what[1] || a.app_name || '')}</span></div>
        </div>
        ${on && (f & (MF.PREV | MF.NEXT | MF.PAUSE | MF.PLAY)) ? `<div class="ha-transport">
          ${f & MF.PREV ? `<button class="ha-round" data-act="prev">${icon('prev')}</button>` : ''}
          ${f & (MF.PAUSE | MF.PLAY) ? `<button class="ha-round big" data-act="playpause">${icon(st.s === 'playing' ? 'pause' : 'play')}</button>` : ''}
          ${f & MF.NEXT ? `<button class="ha-round" data-act="next">${icon('next')}</button>` : ''}
        </div>` : ''}
        ${on && (f & MF.VOLUME_SET) ? `<div class="ha-volume">
          ${f & MF.VOLUME_MUTE ? `<button class="ha-icon-btn" data-act="mute">${icon(a.is_volume_muted ? 'mute' : 'vol')}</button>` : icon('vol')}
          <input type="range" min="0" max="100" value="${Math.round((a.volume_level ?? 0) * 100)}" class="ha-range" data-act="volume">
        </div>` : ''}
        ${on && (f & MF.SELECT_SOURCE) && a.source_list?.length ? `<div class="ha-label">Source</div>${chips(a.source_list, a.source, 'source', s => s)}` : ''}
        ${f & (on ? MF.TURN_OFF : MF.TURN_ON) ? `<button class="ha-wide${on ? '' : ' primary'}" data-act="power">${icon('power')}<span>${on ? 'Turn off' : 'Turn on'}</span></button>` : ''}`;
    }
    // data-mode colours the whole popup (chips, temperature) by the AC's mode
    c.innerHTML = head + `<div class="ha-detail-body"${d === 'climate' && st.s !== 'off' ? ` data-mode="${esc(st.s)}"` : ''}>${body}</div>`;
    c.classList.toggle('pending', !!st.pending);
    bindDevice(c, dev, back);
  }

  // The device's other entities (AC: horizontal swing, Timer, Climate React, unit light, filter), grouped:
  // `settings` = option pickers (shown with fan/swing), `rest` = switches, then filter care at the bottom
  const EXTRA_ICON = [[/timer/i, 'timer'], [/react/i, 'react'], [/light/i, 'light']];
  function extrasHTML(dev) {
    const onOff = x => domainOf(x) === 'select' && (HA.st(x).a?.options || []).length === 2 && HA.st(x).a.options.includes('on');
    const rank = x => ({ select: onOff(x) ? 1 : 0, switch: 1, binary_sensor: 2, button: 3 }[domainOf(x)] ?? 4);
    const html = ([x, name]) => {
      const d = domainOf(x), st = HA.st(x), a = st.a || {};
      if (d === 'switch' || onOff(x)) {
        const ic = EXTRA_ICON.find(([re]) => re.test(x) || re.test(name))?.[1];
        return `<label class="ha-row"><span class="ha-row-l">${ic ? icon(ic) : ''}<span>${esc(name)}</span></span>
          <input type="checkbox" class="ha-switch" data-extra="${esc(x)}"${st.s === 'on' ? ' checked' : ''}${st.s === 'unavailable' ? ' disabled' : ''}></label>`;
      }
      if (d === 'select') return /swing/i.test(x)
        ? label(name, st.s) + picChips(a.options || [], st.s, 'option', v => swingPic(v, /horizontal/i.test(x)), `data-select="${esc(x)}" `)
        : label(name) + chips(a.options || [], st.s, 'option', pretty).replace(/data-option=/g, `data-select="${esc(x)}" data-option=`);
      if (d === 'binary_sensor') return st.s === 'on' ? `<div class="ha-row warn">${icon('warn')}<span>${esc(name)}</span></div>` : '';
      if (d === 'button') return `<button class="ha-wide hold" data-press="${esc(x)}"><span class="ha-hold-fill"></span>${icon('filter')}<span>Hold to ${esc(name.toLowerCase())}</span></button>`;
      return '';
    };
    const sorted = [...dev.extras].sort((p, q) => rank(p[0]) - rank(q[0]));
    const rest = sorted.filter(([x]) => rank(x) > 0).map(html).join('');
    return { settings: sorted.filter(([x]) => rank(x) === 0).map(html).join(''), rest: rest ? `<div class="ha-extras">${rest}</div>` : '' };
  }

  function bindDevice(c, dev, back) {
    const e = dev.entity, st = () => HA.st(e);
    c.querySelector('[data-act="close"]').onclick = closeModal;
    const b = c.querySelector('[data-act="back"]'); if (b) b.onclick = back;

    // Temperature: show each tap at once, send once the taps stop
    let tempTimer = null;
    const nudge = dir => {
      const a = st().a, step = a.target_temp_step || 1;
      const t = Math.min(a.max_temp ?? 30, Math.max(a.min_temp ?? 16, (c._temp ?? a.temperature ?? 24) + dir * step));
      c._temp = t; c._busy = true;
      c.querySelector('.ha-temp b').textContent = `${t}°`;
      clearTimeout(tempTimer);
      tempTimer = setTimeout(async () => {
        c._temp = null;
        await HA.call(e, 'set_temperature', { temperature: t }, { a: { temperature: t } });
        c._busy = false; if (c._stale) { c._stale = false; drawDevice(c, dev, back); }
      }, 700);
    };
    c.querySelector('[data-act="temp-"]')?.addEventListener('click', () => nudge(-1));
    c.querySelector('[data-act="temp+"]')?.addEventListener('click', () => nudge(1));

    c.querySelectorAll('[data-hvac]').forEach(x => x.onclick = () => {
      const m = x.dataset.hvac;
      HA.call(e, 'set_hvac_mode', { hvac_mode: m }, { s: m });
    });
    c.querySelectorAll('[data-fan]').forEach(x => x.onclick = () => HA.call(e, 'set_fan_mode', { fan_mode: x.dataset.fan }, { a: { fan_mode: x.dataset.fan } }));
    c.querySelectorAll('[data-swing]').forEach(x => x.onclick = () => HA.call(e, 'set_swing_mode', { swing_mode: x.dataset.swing }, { a: { swing_mode: x.dataset.swing } }));
    c.querySelectorAll('[data-source]').forEach(x => x.onclick = () => HA.call(e, 'select_source', { source: x.dataset.source }, { a: { source: x.dataset.source } }));
    c.querySelectorAll('[data-select]').forEach(x => x.onclick = () => HA.call(x.dataset.select, 'select_option', { option: x.dataset.option }, { s: x.dataset.option }));
    c.querySelectorAll('[data-extra]').forEach(x => x.onchange = () => {
      const id = x.dataset.extra, on = x.checked;
      if (domainOf(id) === 'select') HA.call(id, 'select_option', { option: on ? 'on' : 'off' }, { s: on ? 'on' : 'off' });
      else HA.call(id, on ? 'turn_on' : 'turn_off', {}, { s: on ? 'on' : 'off' });
    });
    c.querySelectorAll('[data-press]').forEach(x => holdToConfirm(x, () => true, () =>
      HA.call(x.dataset.press, 'press').then(ok => ok && HAUI.flashDone(x))));

    const act = (name, fn) => c.querySelector(`[data-act="${name}"]`)?.addEventListener('click', fn);
    act('prev', () => HA.call(e, 'media_previous_track'));
    act('next', () => HA.call(e, 'media_next_track'));
    act('playpause', () => HA.call(e, 'media_play_pause', {}, { s: st().s === 'playing' ? 'paused' : 'playing' }));
    act('mute', () => HA.call(e, 'volume_mute', { is_volume_muted: !st().a.is_volume_muted }, { a: { is_volume_muted: !st().a.is_volume_muted } }));
    act('power', () => {
      if (domainOf(e) === 'climate') {
        const off = st().s === 'off';
        return HA.call(e, off ? 'turn_on' : 'turn_off', {}, { s: off ? 'cool' : 'off' });
      }
      const on = !['off', 'unavailable', 'standby'].includes(st().s);
      HA.call(e, on ? 'turn_off' : 'turn_on', {}, { s: on ? 'off' : 'on' });
    });
    const vol = c.querySelector('[data-act="volume"]');
    if (vol) {
      let vt = null;
      vol.addEventListener('pointerdown', () => { c._busy = true; });
      vol.addEventListener('input', () => {
        clearTimeout(vt);
        vt = setTimeout(() => HA.call(e, 'volume_set', { volume_level: vol.value / 100 }, { a: { volume_level: vol.value / 100 } }), 250);
      });
      vol.addEventListener('change', () => setTimeout(() => {
        c._busy = false; if (c._stale) { c._stale = false; drawDevice(c, dev, back); }
      }, 600));
    }
  }

  // ── Home card: every device, by room ───────────────────────────────────────
  function openHome() {
    openModal('ha-card ha-home-card', c => {
      const draw = () => {
        const devs = HA.visibleDevices();
        const areas = [...new Set(devs.map(d => d.area))];
        c.innerHTML = `<div class="ha-head">
            <div class="ha-head-title"><div>Home</div><span>${HA.connected ? `${devs.length} devices` : 'Home Assistant offline'}</span></div>
            <button class="ha-icon-btn" data-act="close">${icon('close')}</button>
          </div>
          <div class="ha-home-body">${devs.length ? areas.map(area => `
            <div class="ha-area"${textAttrs(area)}>${esc(area)}</div>
            <div class="ha-grid">${devs.filter(d => d.area === area).map(tileHTML).join('')}</div>`).join('')
            : `<div class="ha-empty">${HA.ready ? 'No devices — set up Home Assistant in the phone control panel' : 'Connecting to Home Assistant…'}</div>`}
          </div>`;
        c.querySelector('[data-act="close"]').onclick = closeModal;
        _unsubs.forEach(u => u()); _unsubs = [unModel];
        c.querySelectorAll('.ha-tile').forEach(el => {
          const dev = HA.device(el.dataset.entity);
          updateTile(el, dev);
          bindTile(el, dev, { onOpen: () => openDevice(dev, { back: openHome }) });
          _unsubs.push(HA.on(dev.entity, () => updateTile(el, dev)),
            ...dev.extras.map(([x]) => HA.on(x, () => updateTile(el, dev))));
        });
      };
      const unModel = HA.onModel(draw);
      draw();
    });
  }

  const HAUI = {
    icon, tileHTML, updateTile, bindTile, openDevice, openHome, closeModal,
    displaySwitch: null,  // the device powering the mirror: hold-to-confirm to switch off
    flashError(entity) {
      document.querySelectorAll(`.ha-tile[data-entity="${CSS.escape(entity)}"]`).forEach(el => {
        el.classList.remove('error'); void el.offsetWidth; el.classList.add('error');
      });
    },
    flashDone(el) {
      el.classList.add('done');
      setTimeout(() => el.classList.remove('done'), 1200);
    },
  };
  window.HAUI = HAUI;

  // ── Home button widget ─────────────────────────────────────────────────────
  class HaHomeWidget {
    constructor(containerId) {
      this.el = document.getElementById(containerId);
      this.el.innerHTML = `<button class="ha-home-btn">${icon('home')}<span class="ha-home-label">Home</span><span class="ha-home-sum"></span></button>`;
      this._sum = this.el.querySelector('.ha-home-sum');
      this.el.querySelector('button').addEventListener('click', e => { e.stopPropagation(); openHome(); });
      const refresh = () => this._summary();
      HA.onModel(() => {
        this._unsubs?.forEach(u => u());
        this._unsubs = HA.devices.map(d => HA.on(d.entity, refresh));
        refresh();
      });
    }
    // "2 on" — how many visible devices are running right now
    _summary() {
      const n = HA.visibleDevices().filter(d => ['climate', 'media_player', 'switch'].includes(domainOf(d.entity)) && tileState(d).on).length;
      const txt = !HA.connected && HA.ready ? 'offline' : n ? `${n} on` : '';
      if (this._sum.textContent !== txt) this._sum.textContent = txt;
    }
  }
  window.WidgetClasses = window.WidgetClasses || {};
  window.WidgetClasses['ha_home'] = HaHomeWidget;
})();
