/**
 * Template settings — copy to widgets/<name>/<name>.settings.js and rename.
 *
 * H helpers available in section() and onMount():
 *   field(label, name, value, type?, hint?)  — text/number input
 *   checkField(label, name, checked)         — iOS toggle
 *   selectField(label, name, value, options) — dropdown; options = [{v, l}]
 *   groupWrap(title, html, collapsible?)     — card group
 *   sectionWrap(title, html)                 — full section with Save button
 *   esc(str)                                 — HTML-escape a string
 *   promptModal(message, defaultValue?)      — async text prompt
 *   iconPickerModal(current, options)        — async icon picker
 *   bindPickers()                            — wire +/− buttons on number fields
 *   bindRemoveBtns(btnSel, rowSel)           — wire delete buttons on list rows
 *   bindCollapsibles(container)              — wire collapsible group toggles
 *   doSave(widgetName, dataObj)              — POST to /api/config/<name>
 *   showToast(message, isError?)             — brief notification
 */
window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['mywidget'] = {
  label: 'My Widget',

  section(cfg, H) {
    const c = cfg || {};
    const { field, groupWrap, sectionWrap } = H;
    return sectionWrap('My Widget', `
      ${groupWrap('Configuration', `
        ${field('Example field', 'example_key', c.example_key || '', 'text', 'Hint text here')}
      `)}`);
  },

  onMount(sectionEl, cfg, H) {
    H.bindPickers();
    const btn = sectionEl.querySelector('#save-btn');
    if (!btn) return;
    btn.onclick = async () => {
      const updated = { ...cfg };
      sectionEl.querySelectorAll('[name]').forEach(el => {
        updated[el.name] = el.type === 'checkbox' ? el.checked
          : (el.type === 'number' || el.classList.contains('picker-input') ? Number(el.value) : el.value);
      });
      await H.doSave('mywidget', updated);
    };
  },
};
