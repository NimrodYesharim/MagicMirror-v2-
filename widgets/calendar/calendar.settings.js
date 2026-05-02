window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['calendar'] = {
  label: 'Calendar',

  section(cfg, H) {
    const c = cfg || {};
    const { field, checkField, groupWrap, sectionWrap, esc } = H;
    const cals = (c.calendars || []).map(cal => `
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
  },

  onMount(sectionEl, cfg, H) {
    H.bindPickers();
    H.bindRemoveBtns('.cal-remove', '.cal-row');

    const add = sectionEl.querySelector('#add-cal');
    if (add) {
      add.onclick = () => {
        const list = sectionEl.querySelector('#cals-list');
        const row = document.createElement('div');
        row.className = 'cal-row';
        row.innerHTML = `
          <input type="text" class="cal-id" value="">
          <input type="color" class="cal-color" value="#ffffff">
          <button class="cal-remove icon-btn">×</button>`;
        list.appendChild(row);
        H.bindRemoveBtns('.cal-remove', '.cal-row');
      };
    }

    const setup = sectionEl.querySelector('#btn-setup-cal');
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
      updated.calendars = [...sectionEl.querySelectorAll('.cal-row')].map(r => ({
        id: r.querySelector('.cal-id').value,
        color: r.querySelector('.cal-color').value,
      })).filter(x => x.id);
      await H.doSave('calendar', updated);
    };
  },
};
