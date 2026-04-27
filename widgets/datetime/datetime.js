class DateTimeWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._showSec = false;
  }

  init() {
    this.el.innerHTML = `
      <div class="dt-time" id="dt-time">--:--</div>
      <div class="dt-date" id="dt-date"></div>
    `;
    this._tick();
    setInterval(() => this._tick(), 1000);
  }

  setShowSeconds(val) {
    this._showSec = !!val;
  }

  _tick() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    const timeEl = document.getElementById('dt-time');
    if (timeEl) {
      if (this._showSec) {
        timeEl.innerHTML = `${hh}:${mm}<span class="dt-secs">:${ss}</span>`;
      } else {
        timeEl.textContent = `${hh}:${mm}`;
      }
    }

    const dateEl = document.getElementById('dt-date');
    if (dateEl) {
      const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const months = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
      dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    }
  }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['datetime'] = DateTimeWidget;
