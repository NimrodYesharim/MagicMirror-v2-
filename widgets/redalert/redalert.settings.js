window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['redalert'] = {
  label: 'Red Alert',

  section(cfg, H) {
    const c = cfg || {};
    const { field, checkField, groupWrap, sectionWrap, esc } = H;
    return sectionWrap('Red Alert', `
      ${groupWrap('Status', checkField('Enabled', 'enabled', c.enabled !== false))}
      ${groupWrap('Test', `
        <div class="field">
          <label>Alert Overlay</label>
          <button id="btn-test-alert" class="secondary-btn">Flash Mirror Overlay (3s)</button>
        </div>
      `)}
      ${groupWrap('Configuration', `
        ${field('Poll interval (s)', 'poll_interval', c.poll_interval ?? 10, 'number')}
        <div class="field">
          <label>Watch Areas (one per line)</label>
          <textarea name="watch_areas" rows="8">${esc((c.watch_areas || []).join('\n'))}</textarea>
        </div>
      `)}`);
  },

  onMount(sectionEl, cfg, H) {
    H.bindPickers();
    const testBtn = sectionEl.querySelector('#btn-test-alert');
    if (testBtn) {
      testBtn.onclick = async () => {
        testBtn.disabled = true; testBtn.textContent = 'Flashing…';
        try {
          await fetch('/api/redalert/test', { method: 'POST' });
          H.showToast('Alert test triggered — check mirror');
        } catch (e) { H.showToast(`Error: ${e.message}`, true); }
        setTimeout(() => { testBtn.disabled = false; testBtn.textContent = 'Flash Mirror Overlay (3s)'; }, 3500);
      };
    }
    const btn = sectionEl.querySelector('#save-btn');
    if (!btn) return;
    btn.onclick = async () => {
      const updated = { ...cfg };
      sectionEl.querySelectorAll('[name]').forEach(el => {
        if (el.name === 'watch_areas') {
          updated.watch_areas = el.value.split('\n').map(s => s.trim()).filter(Boolean);
        } else {
          updated[el.name] = el.type === 'checkbox' ? el.checked
            : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
        }
      });
      await H.doSave('redalert', updated);
    };
  },
};
