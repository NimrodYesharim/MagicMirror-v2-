// Home Assistant devices on the mirror.
// This file holds the shared pieces (live store, tiles, device popup, Home card) and the
// Home button widget. widgets/homeassistant/ha_tile/ha_tile.js places single device tiles.
(() => {
  // ── Icons (24×24, stroke) ──────────────────────────────────────────────────
  const P = {
    power:  '<path d="M12 3v8"/><path d="M6.3 7.2a8 8 0 1 0 11.4 0"/>',
    snow:   '<path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    flame:  '<path d="M12 22c4 0 7-2.7 7-7 0-4-3-6.5-4-10-2 2-3 4-3 6-1.5-1-2-2.5-2-4-2.5 2-5 5-5 8 0 4.3 3 7 7 7Z"/>',
    fan:    '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7 2 0 3 2 2 4l-4 4M14 12c4 0 7 1 7 4 0 2-2 3-4 2l-4-4M12 14c0 4-1 7-4 7-2 0-3-2-2-4l4-4M10 12c-4 0-7-1-7-4 0-2 2-3 4-2l4 4"/>',
    drop:   '<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12Z"/>',
    auto:   '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    tv:     '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8"/>',
    speaker:'<rect x="5" y="2" width="14" height="20" rx="3"/><circle cx="12" cy="14" r="3.5"/><circle cx="12" cy="6.5" r="1"/>',
    plug:   '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4"/>',
    play:   '<path d="M7 4v16l13-8Z"/>',
    pause:  '<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>',
    next:   '<path d="M5 4v16l10-8ZM18 4v16"/>',
    prev:   '<path d="M19 4v16L9 12ZM6 4v16"/>',
    vol:    '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute:   '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6M22 9l-5 6"/>',
    run:    '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5Z"/>',
    home:   '<path d="M3 11 12 3l9 8"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    minus:  '<path d="M5 12h14"/>',
    plus:   '<path d="M12 5v14M5 12h14"/>',
    back:   '<path d="m15 5-7 7 7 7"/>',
    close:  '<path d="M6 6l12 12M18 6 6 18"/>',
    warn:   '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.5"/>',
    check:  '<path d="m5 12 5 5 9-10"/>',
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

  function chips(list, current, attr, labelFn = pretty, iconFn = null) {
    return `<div class="ha-chips">${list.map(v => `
      <button class="ha-chip${v === current ? ' active' : ''}" data-${attr}="${esc(v)}">${iconFn ? icon(iconFn(v) || 'power') : ''}<span>${esc(labelFn(v))}</span></button>`).join('')}</div>`;
  }

  function drawDevice(c, dev, back) {
    const e = dev.entity, d = domainOf(e), st = HA.st(e), a = st.a || {};
    const head = `<div class="ha-head">
      ${back ? `<button class="ha-icon-btn" data-act="back">${icon('back')}</button>` : ''}
      <div class="ha-head-title"><div${textAttrs(dev.name)}>${esc(dev.name)}</div><span>${esc(dev.area)}</span></div>
      <button class="ha-icon-btn" data-act="close">${icon('close')}</button>
    </div>`;
    let body = '';
    if (d === 'climate') {
      const on = st.s !== 'off';
      body = `
        <div class="ha-thermo${on ? '' : ' off'}" data-mode="${esc(st.s)}">
          <button class="ha-round" data-act="temp-" aria-label="Lower">${icon('minus')}</button>
          <div class="ha-temp"><b>${a.temperature ?? '–'}°</b><span>${a.current_temperature != null ? `${a.current_temperature}° in the room` : ''}</span></div>
          <button class="ha-round" data-act="temp+" aria-label="Raise">${icon('plus')}</button>
        </div>
        <div class="ha-label">Mode</div>${chips([...(a.hvac_modes || [])].sort((x, y) => (y === 'off') - (x === 'off')), st.s, 'hvac', pretty, v => v === 'off' ? 'power' : MODE_ICON[v])}
        ${a.fan_modes?.length ? `<div class="ha-label">Fan</div>${chips(a.fan_modes, a.fan_mode, 'fan')}` : ''}
        ${a.swing_modes?.length ? `<div class="ha-label">Swing</div>${chips(a.swing_modes, a.swing_mode, 'swing')}` : ''}
        ${extrasHTML(dev)}`;
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

  // The device's other entities (AC: Climate React, timer, horizontal swing, unit light, filter)
  function extrasHTML(dev) {
    const rows = dev.extras.map(([x, label]) => {
      const d = domainOf(x), st = HA.st(x), a = st.a || {};
      if (d === 'switch' || (d === 'select' && a.options?.length === 2 && a.options.includes('on'))) {
        return `<label class="ha-row"><span>${esc(label)}</span>
          <input type="checkbox" class="ha-switch" data-extra="${esc(x)}"${st.s === 'on' ? ' checked' : ''}${st.s === 'unavailable' ? ' disabled' : ''}></label>`;
      }
      if (d === 'select') return `<div class="ha-label">${esc(label)}</div>${chips(a.options || [], st.s, 'option', pretty).replace(/data-option=/g, `data-select="${esc(x)}" data-option=`)}`;
      if (d === 'binary_sensor') return st.s === 'on' ? `<div class="ha-row warn">${icon('warn')}<span>${esc(label)}</span></div>` : '';
      if (d === 'button') return `<button class="ha-wide hold" data-press="${esc(x)}"><span class="ha-hold-fill"></span><span>Hold to ${esc(label.toLowerCase())}</span></button>`;
      return '';
    }).join('');
    return rows ? `<div class="ha-extras">${rows}</div>` : '';
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
