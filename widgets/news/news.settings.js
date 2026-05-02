window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['news'] = {
  label: 'News',

  section(cfg, H) {
    const c = cfg || {};
    const { field, checkField, groupWrap, sectionWrap } = H;
    return sectionWrap('News', `
      ${groupWrap('Status', checkField('Enabled', 'enabled', c.enabled !== false))}
      ${groupWrap('API Configuration', `
        ${field('NewsAPI Key', 'api_key', c.api_key)}
        ${field('Search query', 'q', c.q || '')}
        ${field('Country', 'country', c.country || 'il')}
      `)}
      ${groupWrap('Display', `
        ${field('Max articles', 'max_articles', c.max_articles ?? 8, 'number')}
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
      await H.doSave('news', updated);
    };
  },
};
