window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['calendar'] = {
  label: 'Calendar',

  section(cfg, H) {
    const c = cfg || {};
    const { field, checkField, groupWrap, sectionWrap } = H;
    return sectionWrap('Calendar', `
      ${groupWrap('Settings', `
        ${field('Max events to show', 'max_events', c.max_events ?? 20, 'number', 'Next N upcoming events across all calendars')}
        ${field('Refresh (minutes)', 'refresh_minutes', c.refresh_minutes ?? 5, 'number')}
        ${checkField('Hebrew RTL support', 'hebrew', c.hebrew)}
      `)}
      ${groupWrap('Calendars', `
        <div id="cals-list" style="margin-bottom:12px">
          <div class="hint">Loading calendars…</div>
        </div>
        <button id="btn-reload-cals" class="link-btn">↻ Reload from Google</button>
      `)}
      ${groupWrap('Authentication', `
        <div class="field">
          <label>Google Calendar API</label>
          <button id="btn-setup-cal" class="secondary-btn">Connect Google Calendar</button>
          <span id="cal-auth-status" class="hint"></span>
        </div>
      `)}`);
  },

  onMount(sectionEl, cfg, H) {
    H.bindPickers();

    const list    = sectionEl.querySelector('#cals-list');
    const cfgById = Object.fromEntries((cfg?.calendars || []).map(c => [c.id, c]));

    const renderCals = (available) => {
      if (!available?.length) {
        list.innerHTML = '<div class="hint">No calendars found. Make sure Google Calendar is connected.</div>';
        return;
      }
      list.innerHTML = available.map(cal => {
        const existing = cfgById[cal.id];
        const checked  = !!existing;
        const color    = existing?.color || cal.color || '#3a7eff';
        return `
          <div class="cal-row" data-id="${H.esc(cal.id)}" data-name="${H.esc(cal.name || cal.id)}">
            <input type="checkbox" class="cal-active"${checked ? ' checked' : ''}>
            <span class="cal-name">${H.esc(cal.name || cal.id)}</span>
            <input type="color" class="cal-color" value="${H.esc(color)}">
          </div>`;
      }).join('');
    };

    const loadCals = async () => {
      list.innerHTML = '<div class="hint">Loading…</div>';
      try {
        const r = await fetch('/api/calendar/list-all');
        if (!r.ok) throw new Error(r.status === 503
          ? 'Not authenticated — connect Google Calendar first.'
          : `HTTP ${r.status}`);
        renderCals(await r.json());
      } catch (e) {
        list.innerHTML = `<div class="hint" style="color:#ff6b6b">${H.esc(e.message)}</div>`;
      }
    };

    loadCals();
    sectionEl.querySelector('#btn-reload-cals').onclick = loadCals;

    const setup      = sectionEl.querySelector('#btn-setup-cal');
    const authStatus = sectionEl.querySelector('#cal-auth-status');
    if (setup) {
      setup.onclick = async () => {
        setup.disabled = true;
        setup.textContent = 'Opening…';
        if (authStatus) authStatus.textContent = '';
        try {
          const r = await fetch('/api/calendar/auth-url');
          if (!r.ok) { const err = await r.json(); throw new Error(err.detail || 'Failed to get auth URL'); }
          const { url } = await r.json();
          const popup = window.open(url, 'google-auth', 'width=520,height=700,left=200,top=100');
          if (!popup) {
            if (authStatus) authStatus.textContent = 'Popup blocked — allow popups for this page.';
            setup.disabled = false; setup.textContent = 'Connect Google Calendar'; return;
          }
          const onMsg = e => {
            if (e.data === 'calendar_auth_done') {
              window.removeEventListener('message', onMsg); clearInterval(pollClosed);
              H.showToast('Google Calendar connected!');
              if (authStatus) authStatus.textContent = 'Connected ✓';
              setup.disabled = false; setup.textContent = 'Re-connect Google Calendar';
              loadCals();
            }
          };
          window.addEventListener('message', onMsg);
          const pollClosed = setInterval(() => {
            if (popup.closed) {
              clearInterval(pollClosed); window.removeEventListener('message', onMsg);
              setup.disabled = false; setup.textContent = 'Connect Google Calendar';
            }
          }, 800);
        } catch (e) {
          if (authStatus) authStatus.textContent = `Error: ${e.message}`;
          H.showToast(`Error: ${e.message}`, true);
          setup.disabled = false; setup.textContent = 'Connect Google Calendar';
        }
      };
    }

    const save = sectionEl.querySelector('#save-btn');
    if (!save) return;
    save.onclick = async () => {
      const updated = { ...cfg };
      sectionEl.querySelectorAll('[name]').forEach(el => {
        updated[el.name] = el.type === 'checkbox' ? el.checked
          : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      });
      updated.calendars = [...sectionEl.querySelectorAll('.cal-row')]
        .filter(r => r.querySelector('.cal-active')?.checked)
        .map(r => ({
          id:    r.dataset.id,
          name:  r.dataset.name,
          color: r.querySelector('.cal-color').value,
        }));
      await H.doSave('calendar', updated);
    };
  },
};
