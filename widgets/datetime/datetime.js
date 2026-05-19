class DateTimeWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._showSec = false;
    this._timeEl  = null;
    this._dateEl  = null;
    this._lastMin = -1;
    this._lastDay = -1;
  }

  init() {
    this.el.innerHTML = `
      <div class="dt-time" id="dt-time">--:--</div>
      <div class="dt-date" id="dt-date"></div>
    `;
    this._timeEl = document.getElementById('dt-time');
    this._dateEl = document.getElementById('dt-date');
    this._tick();
    setInterval(() => this._tick(), 1000);
  }

  setShowSeconds(val) {
    this._showSec = !!val;
    this._lastMin = -1; // force redraw on next tick
  }

  _tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const min = now.getHours() * 60 + now.getMinutes();

    if (this._showSec) {
      const ss = String(now.getSeconds()).padStart(2, '0');
      this._timeEl.innerHTML = `${hh}:${mm}<span class="dt-secs">:${ss}</span>`;
    } else if (min !== this._lastMin) {
      this._lastMin = min;
      this._timeEl.textContent = `${hh}:${mm}`;
    }

    const day = now.getDate();
    if (day !== this._lastDay) {
      this._lastDay = day;
      const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const months = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
      this._dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    }
  }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['datetime'] = DateTimeWidget;
