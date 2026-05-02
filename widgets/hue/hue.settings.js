window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['hue'] = {
  label: 'Hue Lights',

  section(cfg, H) {
    const c = cfg || {};
    const { field, groupWrap } = H;
    return `
      <div class="section-header"><h2>Hue Lights</h2></div>
      <div class="section-body" id="hue-settings-body">
        ${groupWrap('Bridge', `
          ${field('Bridge IP', 'bridge_ip', c.bridge_ip || '')}
          ${field('Poll Interval (s)', 'poll_interval', c.poll_interval ?? 10, 'number')}
          <div class="pair-row">
            <button id="btn-pair" class="secondary-btn">Pair with Bridge</button>
            <span id="pair-status" class="hint"></span>
          </div>
        `, true)}
        <div id="hue-bridge-content">
          <div class="bridge-status">Loading bridge resources…</div>
        </div>
        <div class="save-row">
          <button id="hue-save-btn" class="save-btn">Save</button>
          <button id="btn-discover" class="secondary-btn">Re-discover</button>
        </div>
      </div>`;
  },

  onMount(sectionEl, cfg, H) {
    H.bindPickers();
    H.bindCollapsibles(sectionEl);
    _hueLoadBridgeInner(sectionEl, cfg, H);

    const ipInput = sectionEl.querySelector('[name="bridge_ip"]');
    if (ipInput) {
      ipInput.addEventListener('focus', async e => {
        e.preventDefault(); ipInput.blur();
        const val = await H.promptModal('Bridge IP address', ipInput.value);
        if (val !== null) ipInput.value = val.trim();
      });
    }

    const btnPair = sectionEl.querySelector('#btn-pair');
    const pairStatus = sectionEl.querySelector('#pair-status');
    if (btnPair) {
      btnPair.onclick = async () => {
        btnPair.disabled = true;
        if (pairStatus) pairStatus.textContent = 'Press link button on bridge…';
        let secs = 30;
        const cd = setInterval(() => { secs--; if (pairStatus) pairStatus.textContent = `Pairing… ${secs}s`; if (secs <= 0) clearInterval(cd); }, 1000);
        try {
          const r = await fetch('/api/hue/pair', { method: 'POST' });
          clearInterval(cd);
          if (pairStatus) pairStatus.textContent = r.ok ? 'Paired! Reloading…' : 'Pairing failed';
          if (r.ok) {
            const fresh = await fetch('/api/config/hue').then(res => res.ok ? res.json() : cfg);
            Object.assign(cfg, fresh);
            _hueLoadBridgeInner(sectionEl, cfg, H);
          }
        } catch (e) { clearInterval(cd); if (pairStatus) pairStatus.textContent = `Error: ${e.message}`; }
        finally { btnPair.disabled = false; }
      };
    }

    sectionEl.querySelector('#btn-discover')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Discovering…';
      try {
        await fetch('/api/hue/discover', { method: 'POST' });
        const fresh = await fetch('/api/config/hue').then(res => res.ok ? res.json() : cfg);
        Object.assign(cfg, fresh);
        _hueLoadBridgeInner(sectionEl, cfg, H);
        H.showToast('Discovery complete');
      } catch (err) { H.showToast(`Error: ${err.message}`, true); }
      finally { btn.disabled = false; btn.textContent = 'Re-discover'; }
    });

    const saveBtn = sectionEl.querySelector('#hue-save-btn');
    if (!saveBtn) return;
    saveBtn.onclick = async () => {
      const updated = { ...cfg };
      const ipEl   = sectionEl.querySelector('[name="bridge_ip"]');
      const pollEl = sectionEl.querySelector('[name="poll_interval"]');
      if (ipEl)   updated.bridge_ip     = ipEl.value;
      if (pollEl) updated.poll_interval = Number(pollEl.value);

      const masterName = (cfg?.master?.name || '').toLowerCase();
      const selectedRooms = [];
      sectionEl.querySelectorAll('#hue-rooms-list .bridge-item').forEach(item => {
        if (!item.querySelector('.room-enabled')?.checked) return;
        const name  = item.dataset.roomName;
        const roomId = item.dataset.roomId;
        const glId  = item.dataset.groupedLightId;
        const icon  = item.querySelector('.icon-pick-btn')?.dataset.icon || 'default';
        if (name.toLowerCase() === masterName) {
          updated.master = { ...(updated.master || {}), name, icon, room_id: roomId, grouped_light_id: glId };
        } else {
          selectedRooms.push({ name, icon, room_id: roomId, grouped_light_id: glId });
        }
      });
      updated.rooms = selectedRooms;

      const selectedScenes = [];
      sectionEl.querySelectorAll('#hue-scenes-list .scene-card').forEach(item => {
        if (!item.querySelector('.scene-enabled')?.checked) return;
        const name = item.dataset.sceneName;
        const id   = item.dataset.sceneId;
        const existing = (cfg?.scenes || []).find(s => s.scene_id === id);
        selectedScenes.push({ ...(existing || {}), name, scene_id: id });
      });
      updated.scenes = selectedScenes;

      await H.doSave('hue', updated);
    };
  },
};

async function _hueLoadBridgeInner(sectionEl, cfg, H) {
  const wrap = sectionEl.querySelector('#hue-bridge-content');
  if (!wrap) return;
  wrap.innerHTML = '<div class="bridge-status">Loading…</div>';
  try {
    const [resR, scenesR, lightsR, iconsR] = await Promise.all([
      fetch('/api/hue/resources'),
      fetch('/api/hue/scenes-list'),
      fetch('/api/hue/lights'),
      fetch('/api/hue/icons'),
    ]);
    if (!resR.ok) throw new Error('Bridge unreachable — check IP and pairing');
    const { rooms, zones } = await resR.json();
    let allRooms = [...(rooms || []), ...(zones || [])];
    const scenes   = scenesR.ok ? await scenesR.json() : [];
    const lights   = lightsR.ok ? await lightsR.json() : [];
    const iconOpts = iconsR.ok ? await iconsR.json() : ['default','bedroom','livingroom','kitchen','bathroom','office','dining','hallway','studio','balcony','ceiling','spots','desk'];

    const roomOrder = (cfg.rooms || []).map(r => (r.room_id || '').toLowerCase());
    allRooms.sort((a, b) => {
      const ia = roomOrder.indexOf((a.room_id || '').toLowerCase());
      const ib = roomOrder.indexOf((b.room_id || '').toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    const sceneOrder = (cfg.scenes || []).map(s => (s.scene_id || '').toLowerCase());
    scenes.sort((a, b) => {
      const ia = sceneOrder.indexOf((a.id || '').toLowerCase());
      const ib = sceneOrder.indexOf((b.id || '').toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    const masterName   = (cfg.master?.name || '').toLowerCase();
    const enabledRooms = new Set([masterName, ...(cfg.rooms || []).map(r => r.name.toLowerCase())].filter(Boolean));
    const enabledScenes = new Set((cfg.scenes || []).map(s => s.name.toLowerCase()));
    const iconFor = name => {
      const lc = name.toLowerCase();
      if (lc === masterName) return cfg.master?.icon || 'default';
      return (cfg.rooms || []).find(r => r.name.toLowerCase() === lc)?.icon || 'default';
    };

    const { esc, groupWrap } = H;
    const dragHandle = `<div class="drag-handle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="15" x2="16" y2="15"/></svg></div>`;

    const roomsHtml = allRooms.length ? allRooms.map(r => {
      const icon = iconFor(r.name);
      return `
        <div class="bridge-item" draggable="true" data-room-name="${esc(r.name)}" data-room-id="${esc(r.room_id)}" data-grouped-light-id="${esc(r.grouped_light_id)}">
          ${dragHandle}
          <input type="checkbox" class="room-enabled" ${enabledRooms.has(r.name.toLowerCase()) ? 'checked' : ''}>
          <div class="light-dot${r.on ? ' on' : ''}"></div>
          <div class="bridge-name">${esc(r.name)}</div>
          <div class="bridge-kind">${esc(r.kind || 'room')}</div>
          <button class="icon-pick-btn" data-icon="${esc(icon)}" title="${esc(icon)}">
            <div class="btn-icon" style="-webkit-mask-image:url('/widgets/hue/icons/${esc(icon)}.svg');mask-image:url('/widgets/hue/icons/${esc(icon)}.svg')"></div>
          </button>
          ${r.kind === 'zone' ? `<button class="zone-delete icon-btn" title="Delete Zone">×</button>` : ''}
        </div>`;
    }).join('') : '<div class="bridge-status">No rooms found on bridge</div>';

    const scenesHtml = scenes.length ? scenes.map(s => `
      <div class="scene-card" draggable="true" data-scene-id="${esc(s.id)}" data-scene-name="${esc(s.name)}">
        ${dragHandle}
        <input type="checkbox" class="scene-enabled" ${enabledScenes.has(s.name.toLowerCase()) ? 'checked' : ''}>
        <div class="scene-swatch" style="background:${s.gradient}"></div>
        <div class="scene-name">${esc(s.name)}</div>
        <div class="scene-room">${esc(s.room)}</div>
      </div>`).join('') : '<div class="bridge-status">No scenes found</div>';

    const lightsHtml = lights.length ? lights.map(l => `
      <div class="light-item" data-light-id="${esc(l.id)}">
        <input type="checkbox" class="light-select">
        <div class="light-dot${l.on ? ' on' : ''}"></div>
        <div class="light-name">${esc(l.name)}</div>
      </div>`).join('') : '<div class="bridge-status">No lights found</div>';

    wrap.innerHTML = `
      ${groupWrap('Rooms & Zones (drag handle to reorder)', `<div id="hue-rooms-list">${roomsHtml}</div>`, true)}
      ${groupWrap('Scenes (drag handle to reorder)', `<div id="hue-scenes-list">${scenesHtml}</div>`, true)}
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
      `, true)}`;

    H.bindCollapsibles(wrap);
    _bindSortableInner(wrap.querySelector('#hue-rooms-list'), '.bridge-item');
    _bindSortableInner(wrap.querySelector('#hue-scenes-list'), '.scene-card');

    wrap.querySelectorAll('.icon-pick-btn').forEach(btn => {
      btn.onclick = async e => {
        e.preventDefault();
        const icon = await H.iconPickerModal(btn.dataset.icon, iconOpts);
        if (icon) {
          btn.dataset.icon = icon;
          btn.querySelector('.btn-icon').style.webkitMaskImage = `url('/widgets/hue/icons/${icon}.svg')`;
          btn.querySelector('.btn-icon').style.maskImage = `url('/widgets/hue/icons/${icon}.svg')`;
          btn.title = icon;
        }
      };
    });

    wrap.querySelectorAll('.zone-delete').forEach(btn => {
      btn.onclick = async () => {
        const id   = btn.closest('[data-room-id]').dataset.roomId;
        const name = btn.closest('[data-room-name]').dataset.roomName;
        if (!confirm(`Delete zone "${name}"?`)) return;
        try {
          const r = await fetch(`/api/hue/zone/${id}`, { method: 'DELETE' });
          if (r.ok) { H.showToast(`Zone "${name}" deleted`); _hueLoadBridgeInner(sectionEl, cfg, H); }
          else H.showToast('Failed to delete zone', true);
        } catch (e) { H.showToast(`Error: ${e.message}`, true); }
      };
    });

    wrap.querySelector('#btn-create-zone')?.addEventListener('click', async () => {
      const nameEl = wrap.querySelector('#zone-name');
      const name   = nameEl?.value?.trim();
      if (!name) { H.showToast('Enter a zone name', true); return; }
      const ids = [...wrap.querySelectorAll('.light-select:checked')]
        .map(cb => cb.closest('[data-light-id]')?.dataset.lightId).filter(Boolean);
      if (!ids.length) { H.showToast('Select at least one light', true); return; }
      const btn = wrap.querySelector('#btn-create-zone');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await fetch('/api/hue/zone', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, light_ids: ids }),
        });
        if (r.ok) { H.showToast(`Zone "${name}" created`); _hueLoadBridgeInner(sectionEl, cfg, H); }
        else H.showToast('Failed to create zone', true);
      } catch (e) { H.showToast(`Error: ${e.message}`, true); }
      finally { btn.disabled = false; btn.textContent = 'Create'; }
    });

  } catch (e) {
    wrap.innerHTML = `<div class="bridge-status">Error: ${H.esc(e.message)}</div>`;
  }
}

function _bindSortableInner(container, selector) {
  if (!container) return;
  let dragEl = null;
  container.addEventListener('mousedown', e => {
    const handle = e.target.closest('.drag-handle');
    const item   = e.target.closest(selector);
    if (handle && item) item.draggable = true;
    else if (item) item.draggable = false;
  }, true);
  container.addEventListener('dragstart', e => {
    dragEl = e.target.closest(selector);
    if (!dragEl || !dragEl.draggable) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    container.classList.add('drag-active');
    setTimeout(() => dragEl.classList.add('sortable-ghost'), 0);
  });
  container.addEventListener('dragover', e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest(selector);
    if (target && target !== dragEl && target.parentNode === container) {
      const rect = target.getBoundingClientRect();
      const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
      container.insertBefore(dragEl, next ? target.nextSibling : target);
    }
  });
  container.addEventListener('dragend', () => {
    if (dragEl) { dragEl.classList.remove('sortable-ghost'); dragEl.draggable = false; }
    container.classList.remove('drag-active');
    dragEl = null;
  });
  container.addEventListener('mouseup', e => {
    const item = e.target.closest(selector);
    if (item) item.draggable = false;
  });
}
