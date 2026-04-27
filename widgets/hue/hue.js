class HueWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._modes    = {};   // gl_id -> 'bri' | 'color' | 'temp'
    this._cardData = {};
    this._timers   = {};
    this._activeScene = null;
    this._rendered = false;
    this._showSkeleton();
  }

  _showSkeleton() {
    this.el.innerHTML = `<div class="widget-skeleton-hue">
      <div class="skeleton-block sk-col"></div>
      <div class="skeleton-block sk-rest"></div>
    </div>`;
  }

  render(data) {
    const { master, rooms, scenes } = data;
    const activeRooms = [];
    if (master?.id) activeRooms.push({ ...master, _isMaster: true });
    activeRooms.push(...(rooms || []).filter(r => r.id));
    const undiscovered = (rooms || []).filter(r => !r.id).map(r => r.name);
    for (const r of activeRooms) this._cardData[r.id] = r;

    const undiscHtml = undiscovered.length
      ? undiscovered.map(n => `<div class="room-card room-undisc"><div class="card-header"><div class="card-titles"><div class="card-zone">${this._esc(n)}</div></div></div><div class="undisc-label">Not found on bridge</div></div>`).join('')
      : '';

    this.el.innerHTML = `
      <div class="hue-scenes">${scenes.map(s => this._sceneHTML(s)).join('')}</div>
      <div class="hue-rooms">${activeRooms.map(r => this._cardHTML(r)).join('')}${undiscHtml}</div>`;

    this._bindAll();
    this._rendered = true;
    requestAnimationFrame(() => {
      this._sizeSliders();
      this._refreshAllBadges();
      this._fitCards();
    });
    this._initRoomResize();
  }

  _fitCards() {
    const rooms = this.el.querySelector('.hue-rooms');
    if (!rooms) return;
    const cRight = rooms.getBoundingClientRect().right;
    rooms.querySelectorAll('.room-card').forEach(card => {
      const r = card.getBoundingClientRect();
      card.style.display = r.right > cRight + 2 ? 'none' : '';
    });
  }

  _initRoomResize() {
    if (this._roomRO) this._roomRO.disconnect();
    const rooms = this.el.querySelector('.hue-rooms');
    if (!rooms) return;
    this._roomRO = new ResizeObserver(() => { this._sizeSliders(); this._fitCards(); });
    this._roomRO.observe(rooms);
  }

  _refreshAllBadges() {
    this.el.querySelectorAll('.big-slider.track-bri').forEach(s => {
      const badge = s.closest('.slider-track-wrap')?.querySelector('.slider-badge');
      if (badge) this._refreshBadge(s, badge);
    });
  }

  _sizeSliders() {
    this.el.querySelectorAll('.slider-track-wrap').forEach(wrap => {
      const h = wrap.clientHeight;
      if (!h) return;
      wrap.querySelectorAll('.big-slider').forEach(s => { s.style.width = h + 'px'; });
    });
  }

  update(data) {
    const { master, rooms } = data;
    const all = [];
    if (master?.id) all.push(master);
    all.push(...(rooms || []).filter(r => r.id));
    for (const r of all) {
      this._cardData[r.id] = r;
      const card = this.el.querySelector(`.room-card[data-id="${r.id}"]`);
      if (card) this._syncCard(card, r);
    }
  }

  // ── Scenes ─────────────────────────────────────────────────────────────────

  _sceneHTML(s) {
    const active = this._activeScene === s.id;
    return `
      <div class="scene-item">
        <button class="scene-btn${active ? ' active' : ''}"
          style="--g:${s.gradient || 'conic-gradient(#444,#444)'}"
          data-scene-id="${s.id}" title="${this._esc(s.name)}"></button>
        <div class="scene-name">${this._esc(s.name)}</div>
      </div>`;
  }

  // ── Card ───────────────────────────────────────────────────────────────────

  _cardHTML(r) {
    const id        = r.id;
    const mode      = this._modes[id] || 'bri';
    const borderCol = this._lightColor(r);

    return `
      <div class="room-card${r.on ? ' on' : ''}" data-id="${id}"
           data-mirek-min="${r.mirek_min ?? 153}"
           data-mirek-max="${r.mirek_max ?? 500}"
           style="--border-col:${borderCol}">

        <div class="card-header">
          <div class="card-icon">${_hueIcon(r.icon)}</div>
          <div class="card-titles">
            <div class="card-zone">${this._esc(r.name)}</div>
          </div>
        </div>

        <div class="card-sliders-wrap">
          ${this._slidersHTML(id, mode, r)}
        </div>

        <div class="card-mode-btns">
          <button class="mode-btn bri-btn${mode === 'bri'   ? ' active' : ''}" data-id="${id}" data-mode="bri"   title="Brightness"></button>
          <button class="mode-btn color-btn${mode === 'color' ? ' active' : ''}" data-id="${id}" data-mode="color" title="Color"></button>
          <button class="mode-btn temp-btn${mode === 'temp'  ? ' active' : ''}" data-id="${id}" data-mode="temp"  title="Temperature"></button>
        </div>

        <div class="card-toggle-wrap">
          <label class="ios-toggle" data-id="${id}">
            <input type="checkbox" class="toggle-input" data-id="${id}" ${r.on ? 'checked' : ''}>
            <span class="ios-track"><span class="ios-knob"></span></span>
          </label>
        </div>
      </div>`;
  }

  _slidersHTML(id, mode, r) {
    if (mode === 'color') {
      return `
        <div class="sliders-double">
          ${this._oneSlidersHTML(id, 'sat', r)}
          ${this._oneSlidersHTML(id, 'hue', r)}
        </div>`;
    }
    return `
      <div class="sliders-single">
        ${this._oneSlidersHTML(id, mode, r)}
      </div>`;
  }

  _oneSlidersHTML(id, type, r) {
    const { min, max, val, extraClass } = this._sliderConf(type, r);
    const pct      = (val - min) / (max - min);
    const badgePct = Math.round(pct * 100);
    const thumbCol = this._thumbColor(type, val, min, max, r);

    const wrapStyle = (type === 'sat')
      ? `style="--sat-top:hsl(${r.hue_deg ?? 0},100%,50%)"`
      : '';

    return `
      <div class="slider-col">
        <div class="slider-track-wrap" ${wrapStyle}>
          <input type="range" class="big-slider ${extraClass}"
            data-id="${id}" data-type="${type}"
            min="${min}" max="${max}" value="${val}"
            style="--thumb-color:${thumbCol}"
            ${r.on ? '' : 'disabled'}>
          ${type === 'bri' ? `<div class="slider-badge" style="top:50%">${badgePct}%</div>` : ''}
        </div>
      </div>`;
  }

  _thumbColor(type, val, min, max, r) {
    const pct = Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
    if (type === 'hue') return `hsl(${val},100%,58%)`;
    if (type === 'sat') return `hsl(${r.hue_deg ?? 0},${val}%,55%)`;
    if (type === 'temp') {
      // 5-stop gradient matching the track: warm→amber→cream→light-blue→cool
      const stops = [[255,140,0],[255,203,107],[255,248,238],[200,232,255],[119,182,255]];
      const seg = pct * 4;
      const i = Math.min(Math.floor(seg), 3);
      const t = seg - i;
      const [r1,g1,b1] = stops[i], [r2,g2,b2] = stops[i+1];
      return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
    }
    return '#888';
  }

  _sliderConf(type, r) {
    if (type === 'hue') {
      return { min: 0, max: 360, val: r.hue_deg ?? 180, extraClass: 'track-hue' };
    }
    if (type === 'sat') {
      return { min: 0, max: 100, val: r.sat_pct ?? 80, extraClass: 'track-sat' };
    }
    if (type === 'temp') {
      // Inverted: slider value 0 = warm (max mirek), max = cool (min mirek)
      // So cool is at top (high slider value) and warm at bottom (low slider value)
      const miMin = r.mirek_min ?? 153;
      const miMax = r.mirek_max ?? 500;
      const invVal = miMax - (r.mirek ?? 300);  // 0=warm, range=cool
      return { min: 0, max: miMax - miMin, val: invVal, extraClass: 'track-temp' };
    }
    // bri
    return { min: 1, max: 100, val: r.brightness ?? 50, extraClass: 'track-bri' };
  }

  _lightColor(r) {
    if (!r.on) return '#1e1e1e';
    const bri = (r.brightness ?? 50) / 100;
    if (r.hue_deg != null && r.sat_pct != null) {
      return `hsl(${r.hue_deg}, ${r.sat_pct}%, ${Math.max(25, Math.round(bri * 60))}%)`;
    }
    if (r.mirek != null) {
      const pct = (r.mirek - 153) / (500 - 153);
      return `hsl(${Math.round(38 * pct)}, ${Math.round(80 * pct)}%, ${Math.max(18, Math.round(bri * 45))}%)`;
    }
    return `hsl(0,0%,${Math.max(18, Math.round(bri * 40))}%)`;
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  _syncCard(card, r) {
    const id = r.id;
    card.classList.toggle('on', r.on);
    card.style.setProperty('--border-col', this._lightColor(r));

    const toggle = card.querySelector('.toggle-input');
    if (toggle && !toggle.matches(':active')) toggle.checked = r.on;

    const mode = this._modes[id] || 'bri';
    card.querySelectorAll('.big-slider').forEach(s => {
      if (document.activeElement === s) return;
      s.disabled = !r.on;
      const type = s.dataset.type;
      const { min, max, val } = this._sliderConf(type, r);
      s.min = min; s.max = max; s.value = val;
      this._updateThumbColor(s, type, val, r);
      const col = s.closest('.slider-col');
      if (col) {
        const badge = col.querySelector('.slider-badge');
        if (badge) this._refreshBadge(s, badge);
        if (type === 'sat') this._setSatGradient(s, r.hue_deg ?? 0);
      }
    });
  }

  _refreshBadge(slider, badge) {
    const pct = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    badge.textContent = `${Math.round(pct * 100)}%`;
    const wrap = badge.closest('.slider-track-wrap');
    const wrapH = wrap ? wrap.clientHeight : 0;
    if (wrapH > 0) {
      // thumb radius = half the input's height (= thumb size; width is the full track length)
      const thumbR = slider.clientHeight / 2;
      const top = thumbR + (1 - pct) * Math.max(0, wrapH - 2 * thumbR);
      badge.style.top = top + 'px';
      badge.style.transform = 'translate(-50%, -50%)';
    }
  }

  _updateThumbColor(slider, type, val, r) {
    const min = Number(slider.min), max = Number(slider.max);
    slider.style.setProperty('--thumb-color', this._thumbColor(type, val, min, max, r));
  }

  _setSatGradient(slider, hueDeg) {
    const wrap = slider.closest('.slider-track-wrap');
    if (wrap) wrap.style.setProperty('--sat-top', `hsl(${hueDeg},100%,50%)`);
  }

  // ── Binding ────────────────────────────────────────────────────────────────

  _bindAll() {
    // Scenes
    this.el.querySelectorAll('.scene-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeScene = btn.dataset.sceneId;
        this.el.querySelectorAll('.scene-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._api(`/api/hue/scene/${btn.dataset.sceneId}/activate`, 'POST');
      });
    });

    // Toggle switches
    this.el.querySelectorAll('.toggle-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const id   = inp.dataset.id;
        const isOn = inp.checked;
        const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
        if (card) {
          card.classList.toggle('on', isOn);
          card.style.setProperty('--border-col',
            isOn ? this._lightColor({ ...(this._cardData[id] || {}), on: true }) : '#1e1e1e');
          card.querySelectorAll('.big-slider').forEach(s => s.disabled = !isOn);
        }
        this._api(`/api/hue/room/${id}/power`, 'PUT', { on: isOn });
      });
    });

    // Mode buttons
    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const clicked = btn.dataset.mode;
        this._modes[id] = clicked;
        this._switchMode(id, clicked);
      });
    });

    // Sliders
    this.el.querySelectorAll('.big-slider').forEach(s => {
      s.addEventListener('input', () => {
        const id   = s.dataset.id;
        const r    = this._cardData[id];
        if (!r?.on) { s.value = s.defaultValue; return; }
        const type = s.dataset.type;
        const val  = Number(s.value);
        this._updateThumbColor(s, type, val, r);
        const col  = s.closest('.slider-col');
        if (col) {
          const badge = col.querySelector('.slider-badge');
          if (badge) this._refreshBadge(s, badge);
        }
        clearTimeout(this._timers[id]);
        this._timers[id] = setTimeout(() => this._sendSlider(id, type, val, s), 200);
      });
    });
  }

  _switchMode(id, newMode) {
    const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
    if (!card) return;

    card.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === newMode));

    const r = {
      ...(this._cardData[id] || {}),
      mirek_min: Number(card.dataset.mirekMin) || 153,
      mirek_max: Number(card.dataset.mirekMax) || 500,
    };
    const wrap = card.querySelector('.card-sliders-wrap');
    if (wrap) {
      wrap.innerHTML = this._slidersHTML(id, newMode, r);
      // Re-bind new sliders
      wrap.querySelectorAll('.big-slider').forEach(s => {
        const type0 = s.dataset.type;
        this._updateThumbColor(s, type0, Number(s.value), r);
        if (type0 === 'sat') this._setSatGradient(s, r.hue_deg ?? 0);
        s.addEventListener('input', () => {
          const rr = this._cardData[id];
          if (!rr?.on) { s.value = s.defaultValue; return; }
          const val = Number(s.value);
          this._updateThumbColor(s, s.dataset.type, val, rr);
          const col = s.closest('.slider-col');
          if (col) {
            const badge = col.querySelector('.slider-badge');
            if (badge) this._refreshBadge(s, badge);
          }
          clearTimeout(this._timers[id]);
          this._timers[id] = setTimeout(() => this._sendSlider(id, s.dataset.type, val, s), 200);
        });
      });
      requestAnimationFrame(() => { this._sizeSliders(); this._refreshAllBadges(); });
    }
  }

  _sendSlider(id, type, val, sliderEl) {
    const r = this._cardData[id] || {};
    if (type === 'bri') {
      this._api(`/api/hue/room/${id}/brightness`, 'PUT', { brightness: val });
    } else if (type === 'temp') {
      // Un-invert: mirek = max - val
      const miMax = Number(sliderEl?.max ?? 500) + (r.mirek_min ?? 153);
      const mirek = miMax - val;
      this._api(`/api/hue/room/${id}/color_temp`, 'PUT', { mirek });
    } else if (type === 'hue' || type === 'sat') {
      const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
      const hSlider = card?.querySelector('.big-slider[data-type="hue"]');
      const sSlider = card?.querySelector('.big-slider[data-type="sat"]');
      const hue = hSlider ? Number(hSlider.value) : (r.hue_deg ?? 0);
      const sat = sSlider ? Number(sSlider.value) : (r.sat_pct ?? 80);
      // Update sat gradient to reflect new hue live
      if (type === 'hue' && sSlider) this._setSatGradient(sSlider, hue);
      this._api(`/api/hue/room/${id}/color`, 'PUT', { hue_deg: hue, sat_pct: sat });
    }
  }

  async _api(path, method, body) {
    try {
      await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body:    body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { console.error('[Hue]', e); }
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function _hueIcon(type) {
  const map = {
    bedroom: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12V7a1 1 0 011-1h16a1 1 0 011 1v5"/><path d="M3 12h18v5H3z"/><path d="M3 17v2M21 17v2"/><rect x="7" y="8" width="4" height="4" rx="1"/></svg>`,
    ceiling:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="4" rx="2"/><line x1="12" y1="10" x2="12" y2="18"/><line x1="7" y1="18" x2="17" y2="18"/></svg>`,
    spots:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" stroke-dasharray="2 3"/></svg>`,
    desk:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="14" width="20" height="3" rx="1"/><line x1="6" y1="17" x2="6" y2="21"/><line x1="18" y1="17" x2="18" y2="21"/><path d="M9 14V8a3 3 0 016 0v6"/></svg>`,
    default:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M9 12v7a3 3 0 006 0v-7"/></svg>`,
  };
  return map[type] || map.default;
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['hue'] = HueWidget;
