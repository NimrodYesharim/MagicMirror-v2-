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
    if (!this.el) return;
    this.el.innerHTML = `<div class="widget-skeleton-hue">
      <div class="skeleton-block sk-col"></div>
      <div class="skeleton-block sk-rest"></div>
    </div>`;
  }

  render(data) {
    if (!this.el) return;
    if (!data) { console.warn('[Hue] Render called without data'); return; }
    
    try {
      const { master, rooms } = data;
      const activeRooms = [];
      
      if (master && master.id) {
        activeRooms.push({ ...master, _isMaster: true });
        this._cardData[master.id] = master;
      }
      
      if (rooms && Array.isArray(rooms)) {
        rooms.forEach(r => {
          if (r && r.id) {
            activeRooms.push(r);
            this._cardData[r.id] = r;
          }
        });
      }

      const undiscovered = (rooms && Array.isArray(rooms)) 
        ? rooms.filter(r => r && !r.id).map(r => r.name) 
        : [];

      const undiscHtml = undiscovered.length
        ? undiscovered.map(n => `<div class="room-card room-undisc"><div class="card-header"><div class="card-titles"><div class="card-zone">${this._esc(n)}</div></div></div><div class="undisc-label">Not found on bridge</div></div>`).join('')
        : '';

      this.el.innerHTML = `<div class="hue-rooms">${activeRooms.map(r => this._cardHTML(r)).join('')}${undiscHtml}</div>`;

      this._bindAll();
      this._observeSliders();
      
      this._rendered = true;
      requestAnimationFrame(() => {
        this._refreshAllBadges();
        this._fitCards();
      });
      this._initRoomResize();
    } catch (err) {
      console.error('[Hue] Render error:', err);
    }
  }

  _observeSliders() {
    if (this._sliderRO) {
      this._sliderRO.disconnect();
    }
    this._sliderRO = new ResizeObserver(entries => {
      for (const entry of entries) {
        const wrap = entry.target;
        const h = entry.contentRect.height;
        if (h > 0) {
          wrap.querySelectorAll('.big-slider').forEach(s => {
            s.style.width = h + 'px';
          });
          const badge = wrap.querySelector('.slider-badge');
          const slider = wrap.querySelector('.big-slider');
          if (badge && slider) this._refreshBadge(slider, badge);
        }
      }
    });
    this.el.querySelectorAll('.slider-track-wrap').forEach(wrap => {
      this._sliderRO.observe(wrap);
    });
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

  // Called by app.js after a layout switch, so cards fit before the fade-in
  relayout() {
    if (!this.el.querySelector('.hue-rooms')) return;
    this._sizeSliders(); this._refreshAllBadges(); this._fitCards();
  }

  _initRoomResize() {
    if (this._roomRO) this._roomRO.disconnect();
    const rooms = this.el.querySelector('.hue-rooms');
    if (!rooms) return;
    this._roomRO = new ResizeObserver(() => {
      clearTimeout(this._roTimer);
      this._roTimer = setTimeout(() => { this._sizeSliders(); this._refreshAllBadges(); this._fitCards(); }, 100);
    });
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
    if (!data) return;
    try {
      const { master, rooms } = data;
      const all = [];
      if (master && master.id) all.push(master);
      if (rooms && Array.isArray(rooms)) {
        all.push(...rooms.filter(r => r && r.id));
      }
      
      for (const r of all) {
        const old = this._cardData[r.id] || {};
        this._cardData[r.id] = { ...old, ...r };
        
        const card = this.el.querySelector(`.room-card[data-id="${r.id}"]`);
        if (card) {
          if (this._timers[`block_${r.id}`]) continue;
          this._syncCard(card, this._cardData[r.id]);
          card.style.setProperty('--room-color', this._getMainColor(this._cardData[r.id]));
        }
      }
      // Re-measure sliders in case on/off state changed card layout
      requestAnimationFrame(() => { this._sizeSliders(); this._refreshAllBadges(); });
    } catch (err) {
      console.error('[Hue] Update error:', err);
    }
  }



  _getMainColor(r) {
    if (!r.on) return '#444';
    if (r.light_colors && Array.isArray(r.light_colors) && r.light_colors.length) return r.light_colors[0];
    const bri = (r.brightness ?? 50) / 100;
    const l = Math.max(40, Math.min(80, Math.round(bri * 50 + 25)));
    if (r.hue_deg != null && r.sat_pct != null) {
      return `hsl(${r.hue_deg},${r.sat_pct}%,${l}%)`;
    }
    if (r.mirek != null) {
      const pct = (r.mirek - 153) / (500 - 153);
      const h = Math.round(38 * pct);
      const s = Math.round(80 * pct);
      return `hsl(${h},${s}%,${l}%)`;
    }
    return '#fff';
  }

  _cardHTML(r) {
    if (!r) return '';
    const id        = r.id;
    const mode      = this._modes[id] || 'bri';
    const gradient  = this._borderGradient(r);
    const mainCol   = this._getMainColor(r);

    return `
      <div class="room-card${r.on ? ' on' : ''}" data-id="${id}"
           data-mirek-min="${r.mirek_min ?? 153}"
           data-mirek-max="${r.mirek_max ?? 500}"
           style="--border-gradient:${gradient}; --room-color:${mainCol}">
        <div class="card-header">
          <div class="card-icon">${_hueIcon(r.icon)}</div>
          <div class="card-titles"><div class="card-zone">${this._esc(r.name)}</div></div>
        </div>
        <div class="card-sliders-wrap">${this._slidersHTML(id, mode, r)}</div>
        <div class="card-mode-btns">
          <button class="mode-btn bri-btn${mode === 'bri' ? ' active' : ''}" data-id="${id}" data-mode="bri"></button>
          <button class="mode-btn color-btn${mode === 'color' ? ' active' : ''}" data-id="${id}" data-mode="color"></button>
          <button class="mode-btn temp-btn${mode === 'temp' ? ' active' : ''}" data-id="${id}" data-mode="temp"></button>
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
      return `<div class="sliders-double">${this._oneSlidersHTML(id, 'sat', r)}${this._oneSlidersHTML(id, 'hue', r)}</div>`;
    }
    return `<div class="sliders-single">${this._oneSlidersHTML(id, mode, r)}</div>`;
  }

  _oneSlidersHTML(id, type, r) {
    const { min, max, val, extraClass } = this._sliderConf(type, r);
    const pct = (val - min) / (max - min || 1);
    const badgePct = Math.round(pct * 100);
    const thumbCol = this._thumbColor(type, val, min, max, r);
    const wrapStyle = (type === 'sat') ? `style="--sat-top:hsl(${r.hue_deg ?? 0},100%,50%)"` : '';

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
    const bri = (r.brightness ?? 50) / 100;
    const l = Math.max(40, Math.min(80, Math.round(bri * 40 + 30)));
    if (type === 'hue') return `hsl(${val},100%,${l}%)`;
    if (type === 'sat') return `hsl(${r.hue_deg ?? 0},${val}%,${l}%)`;
    if (type === 'temp') {
      const pct = Math.max(0, Math.min(1, (val - min) / (max - min || 1)));
      const stops = [[255,140,0],[255,203,107],[255,248,238],[200,232,255],[119,182,255]];
      const seg = pct * 4;
      const i = Math.min(Math.floor(seg), 3);
      const t = seg - i;
      const [r1,g1,b1] = stops[i], [r2,g2,b2] = stops[i+1];
      return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
    }
    return `hsl(0,0%,${l}%)`;
  }

  _sliderConf(type, r) {
    if (type === 'hue') return { min: 0, max: 360, val: r.hue_deg ?? 0, extraClass: 'track-hue' };
    if (type === 'sat') return { min: 0, max: 100, val: r.sat_pct ?? 100, extraClass: 'track-sat' };
    if (type === 'temp') {
      const miMin = r.mirek_min ?? 153, miMax = r.mirek_max ?? 500;
      return { min: 0, max: miMax - miMin, val: miMax - (r.mirek ?? 300), extraClass: 'track-temp' };
    }
    return { min: 1, max: 100, val: r.brightness ?? 50, extraClass: 'track-bri' };
  }

  _borderGradient(r) {
    if (!r.on) return 'linear-gradient(to bottom, #1e1e1e, #1e1e1e)';
    const colors = r.light_colors;
    if (colors && Array.isArray(colors) && colors.length > 1) {
      const stops = colors.map((c, i) => `${c} ${Math.round(i * 100 / (colors.length - 1))}%`);
      return `linear-gradient(to bottom, ${stops.join(', ')})`;
    }
    const c = (colors && colors.length === 1) ? colors[0] : this._getMainColor(r);
    return `linear-gradient(to bottom, ${c}, ${c})`;
  }

  _syncCard(card, r) {
    card.classList.toggle('on', r.on);
    card.style.setProperty('--border-gradient', this._borderGradient(r));
    const toggle = card.querySelector('.toggle-input');
    if (toggle && !toggle.matches(':active')) toggle.checked = r.on;

    card.querySelectorAll('.big-slider').forEach(s => {
      if (s === document.activeElement) return;
      s.disabled = !r.on;
      const { min, max, val } = this._sliderConf(s.dataset.type, r);
      s.min = min; s.max = max; s.value = val;
      s.style.setProperty('--thumb-color', this._thumbColor(s.dataset.type, val, min, max, r));
      const wrap = s.closest('.slider-track-wrap');
      if (s.dataset.type === 'sat' && wrap) wrap.style.setProperty('--sat-top', `hsl(${r.hue_deg ?? 0},100%,50%)`);
      const badge = wrap?.querySelector('.slider-badge');
      if (badge) this._refreshBadge(s, badge);
    });
  }

  _refreshBadge(slider, badge) {
    const pct = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min) || 1);
    badge.textContent = `${Math.round(pct * 100)}%`;
    const wrapH = badge.closest('.slider-track-wrap')?.clientHeight || 0;
    if (wrapH > 0) {
      const thumbR = slider.clientHeight / 2;
      const badgeR = (badge.offsetHeight || 0) / 2;
      const raw = thumbR + (1 - pct) * (wrapH - 2 * thumbR);
      badge.style.top = Math.max(badgeR, Math.min(wrapH - badgeR, raw)) + 'px';
    }
  }



  _bindAll() {
    this.el.querySelectorAll('.toggle-input').forEach(inp => {
      inp.onchange = () => {
        const id = inp.dataset.id, isOn = inp.checked;
        const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
        
        // Optimistic update
        if (card) {
          card.classList.toggle('on', isOn);
          
          // Update the local data so syncCard uses the right values
          if (this._cardData[id]) {
            this._cardData[id].on = isOn;
            // Temporarily set brightness to 0 visually if turning off
            const oldBri = this._cardData[id].brightness;
            if (!isOn) this._cardData[id].brightness = 1;
            
            this._syncCard(card, this._cardData[id]);
            
            // Restore actual brightness in data so next ON toggle or refresh uses correct value
            if (!isOn) this._cardData[id].brightness = oldBri;
          }
          
          // Ensure sliders are disabled/enabled
          card.querySelectorAll('.big-slider').forEach(s => s.disabled = !isOn);
          // Re-measure slider dimensions since card layout may have changed
          requestAnimationFrame(() => { this._sizeSliders(); this._refreshAllBadges(); });
        }
        
        this._api(`/api/hue/room/${id}/power`, 'PUT', { on: isOn });
      };
    });

    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id, mode = btn.dataset.mode;
        this._modes[id] = mode;
        this._switchMode(id, mode);
      };
    });

    this.el.querySelectorAll('.big-slider').forEach(s => this._bindSlider(s));
  }

  _bindSlider(s) {
    s.oninput = () => {
      const id = s.dataset.id, r = this._cardData[id];
      if (!r?.on) return;
      
      clearTimeout(this._timers[`block_${id}`]);
      this._timers[`block_${id}`] = setTimeout(() => delete this._timers[`block_${id}`], 2000);

      const type = s.dataset.type, val = Number(s.value);
      const { min, max } = this._sliderConf(type, r);
      s.style.setProperty('--thumb-color', this._thumbColor(type, val, min, max, r));

      const card = s.closest('.room-card');
      if (type === 'hue' || type === 'sat') {
        const hV = Number(card.querySelector('.big-slider[data-type="hue"]')?.value ?? r.hue_deg ?? 0);
        const sV = Number(card.querySelector('.big-slider[data-type="sat"]')?.value ?? r.sat_pct ?? 100);
        card.style.setProperty('--room-color', `hsl(${hV},${sV}%,50%)`);
        if (type === 'hue') {
          const satSlider = card.querySelector('.big-slider[data-type="sat"]');
          if (satSlider) {
             satSlider.closest('.slider-track-wrap').style.setProperty('--sat-top', `hsl(${val},100%,50%)`);
             satSlider.style.setProperty('--thumb-color', this._thumbColor('sat', Number(satSlider.value), 0, 100, { ...r, hue_deg: val }));
          }
        }
      }

      const badge = s.closest('.slider-track-wrap')?.querySelector('.slider-badge');
      if (badge) this._refreshBadge(s, badge);

      clearTimeout(this._timers[id]);
      this._timers[id] = setTimeout(() => this._sendSlider(id, type, val, s), 150);
    };
  }

  _switchMode(id, mode) {
    const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
    if (!card) return;
    card.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const wrap = card.querySelector('.card-sliders-wrap');
    if (wrap) {
      wrap.innerHTML = this._slidersHTML(id, mode, this._cardData[id]);
      wrap.querySelectorAll('.big-slider').forEach(s => this._bindSlider(s));
      this._observeSliders();
      requestAnimationFrame(() => { this._refreshAllBadges(); });
    }
  }

  _sendSlider(id, type, val, sliderEl) {
    const r = this._cardData[id] || {};
    if (type === 'bri') this._api(`/api/hue/room/${id}/brightness`, 'PUT', { brightness: val });
    else if (type === 'temp') this._api(`/api/hue/room/${id}/color_temp`, 'PUT', { mirek: (Number(sliderEl.max) + (r.mirek_min||153)) - val });
    else {
      const card = this.el.querySelector(`.room-card[data-id="${id}"]`);
      const hV = Number(card?.querySelector('.big-slider[data-type="hue"]')?.value ?? r.hue_deg ?? 0);
      const sV = Number(card?.querySelector('.big-slider[data-type="sat"]')?.value ?? r.sat_pct ?? 100);
      this._api(`/api/hue/room/${id}/color`, 'PUT', { hue_deg: hV, sat_pct: sV });
    }
  }

  async _api(path, method, body) {
    try {
      await fetch(path, { method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { console.error('[Hue]', e); }
  }

  _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

function _hueIcon(iconName) {
  const icons = {
    'default': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
    'bedroom': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/></svg>`,
    'livingroom': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v10H3zM5 7V5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2M4 18v3M20 18v3"/></svg>`,
    'kitchen': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13V3M6 13a2 2 0 1 1-4 0M6 13a2 2 0 1 0 4 0M18 5V3M18 5a2 2 0 1 1-4 0M18 5a2 2 0 1 0 4 0M12 19v3M12 19a2 2 0 1 1-4 0M12 19a2 2 0 1 0 4 0"/></svg>`,
    'bathroom': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.67 3 4 3.67 4 4.5V17a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V4.5c0-.83-.67-1.5-1.5-1.5a1.5 1.5 0 0 0-1 .5L15 6M6 14h12"/></svg>`,
    'office': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    'dining': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2h1c2.21 0 4 1.79 4 4v3h2V6c0-2.21 1.79-4 4-4h1c2.21 0 4 1.79 4 4v3h2V6c0-2.21 1.79-4 4-4h1M3 22v-7c0-1.1.9-2 2-2h14a2 2 0 0 1 2 2v7"/></svg>`,
    'hallway': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 11h.01"/></svg>`,
    'studio': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8"/></svg>`,
    'balcony': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v11M20 10v11M4 14h16M4 18h16M8 10a4 4 0 0 1 8 0"/></svg>`,
    'ceiling': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5"/><circle cx="12" cy="15" r="4"/><path d="m9 15 6 0"/></svg>`,
    'spots': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="m19 5-2 2M5 19-2 2M5 5 2 2M19 19-2 2"/></svg>`,
    'desk': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M6 21v-7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7M9 12V5a3 3 0 0 1 6 0v7"/></svg>`
  };
  if (icons[iconName]) return icons[iconName];
  return `<div class="external-icon" style="-webkit-mask-image: url('/widgets/hue/icons/${iconName}.svg'); mask-image: url('/widgets/hue/icons/${iconName}.svg');"></div>`;
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['hue'] = HueWidget;
