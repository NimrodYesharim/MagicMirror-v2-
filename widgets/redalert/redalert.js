const RedAlert = (() => {
  const overlay = document.getElementById('alert-overlay');
  let _active = false;

  function handle(data) {
    if (data.active) {
      if (!_active) {
        _active = true;
        overlay.classList.remove('hidden');
        overlay.classList.add('flashing');
        if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
      }
      // Update content on every active broadcast (handles new areas)
      overlay.innerHTML = _buildHTML(data.areas || [], data.title || 'צבע אדום');
    } else if (_active) {
      _active = false;
      overlay.classList.remove('flashing');
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    }
  }

  function _buildHTML(areas, title) {
    const areaItems = areas.length
      ? areas.map(a => `<div class="alert-area">${_esc(a)}</div>`).join('')
      : '';
    return `
      <div class="alert-modal">
        <div class="alert-title">${_esc(title)}</div>
        ${areaItems ? `<div class="alert-areas">${areaItems}</div>` : ''}
      </div>`;
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { handle };
})();
