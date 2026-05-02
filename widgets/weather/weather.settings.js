window.WidgetSettings = window.WidgetSettings || {};
window.WidgetSettings['weather'] = {
  label: 'Weather',

  section(cfg, H) {
    const c = cfg || {};
    const { field, selectField, groupWrap, sectionWrap } = H;
    return sectionWrap('Weather', `
      ${groupWrap('API Configuration', `
        ${field('OpenWeatherMap API Key', 'api_key', c.api_key, 'text', 'Get a free key at openweathermap.org')}
        ${field('City', 'city', c.city)}
        ${selectField('Units', 'units', c.units || 'metric', [
          {v:'metric', l:'Metric (°C)'}, {v:'imperial', l:'Imperial (°F)'}
        ])}
        ${field('Language', 'language', c.language || 'en', 'text', 'ISO code: en, he, de…')}
      `)}
      ${groupWrap('Limits', `
        ${field('API calls per day', 'calls_per_day', c.calls_per_day ?? 96, 'number')}
        ${field('Forecast days', 'forecast_days', c.forecast_days ?? 8, 'number', 'Maximum 8 days (depends on API key)')}
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
      await H.doSave('weather', updated);
    };
  },
};
