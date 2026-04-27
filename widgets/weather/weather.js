// OWM icon code → local weather-icons filename
const WX_ICONS = {
  '01d':'wi-day-sunny',      '01n':'wi-night-clear',
  '02d':'wi-day-cloudy',     '02n':'wi-night-alt-partly-cloudy',
  '03d':'wi-cloud',          '03n':'wi-cloud',
  '04d':'wi-cloudy',         '04n':'wi-cloudy',
  '09d':'wi-day-showers',    '09n':'wi-night-alt-showers',
  '10d':'wi-day-rain',       '10n':'wi-night-alt-rain',
  '11d':'wi-day-thunderstorm','11n':'wi-night-alt-thunderstorm',
  '13d':'wi-day-snow',       '13n':'wi-night-alt-snow',
  '50d':'wi-day-fog',        '50n':'wi-night-fog',
};

function wxIcon(code, size = 'sm') {
  const name = WX_ICONS[code] || 'wi-cloud';
  const sunny = code === '01d';
  const night = code?.endsWith('n');
  const cls   = sunny ? 'wx-ico sunny' : night ? 'wx-ico night' : 'wx-ico';
  return `<img src="/icons/weather/${name}.png" class="${cls} ico-${size}" alt="${code}">`;
}

class WeatherWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._showSkeleton();
  }

  _showSkeleton() {
    this.el.innerHTML = `
      <div class="widget-skeleton-weather">
        <div class="skeleton-block sk-line"></div>
        <div class="skeleton-block sk-mid"></div>
        <div class="skeleton-block sk-tall"></div>
      </div>`;
  }

  render(data) {
    const { current: c, hourly, forecast } = data;
    const deg = c.units === 'imperial' ? '°F' : '°';

    // Find global min/max for the forecast to scale the temp bars
    const allMin = Math.min(...forecast.map(d => d.temp_min));
    const allMax = Math.max(...forecast.map(d => d.temp_max));
    const range  = allMax - allMin || 1;

    const hourlyHTML = (hourly || []).map((h, i) => `
      <div class="hour-col">
        <span class="hour-lbl${i === 0 ? ' now' : ''}">${this._esc(h.hour)}</span>
        ${wxIcon(h.icon, 'sm')}
        <span class="hour-temp">${h.temp}${deg}</span>
      </div>`).join('');

    const forecastHTML = (forecast || []).map((day, i) => {
      // Calculate relative position and width
      const left = ((day.temp_min - allMin) / range) * 100;
      const right = ((day.temp_max - allMin) / range) * 100;
      const width = Math.max(5, right - left); // At least 5% width

      // Relative colors: Blue (-5) -> Yellow (15) -> Red (35)
      const getColor = (t) => {
        if (t <= -5) return '#00b3ff';
        if (t >= 35) return '#ff3b30';
        if (t < 15) {
          // Interpolate Blue to Yellow
          const r = (t + 5) / 20;
          return `rgb(${Math.round(0 + 255*r)}, ${Math.round(179 + 59*r)}, ${Math.round(255 - 255*r)})`;
        } else {
          // Interpolate Yellow to Red
          const r = (t - 15) / 20;
          return `rgb(255, ${Math.round(238 - 179*r)}, ${Math.round(0 + 48*r)})`;
        }
      };

      const color1 = getColor(day.temp_min);
      const color2 = getColor(day.temp_max);
      const barStyle = `left:${left}%; width:${width}%; background:linear-gradient(90deg, ${color1}, ${color2})`;

      return `
      <div class="fcast-row${i === 0 ? ' today' : ''}">
        <span class="fcast-name">${this._esc(day.day)}</span>
        ${wxIcon(day.icon, 'md')}
        <span class="fcast-lo">${day.temp_min}${deg}</span>
        <div class="fcast-line-wrap">
          <div class="fcast-line-fill" style="${barStyle}"></div>
        </div>
        <span class="fcast-hi">${day.temp_max}${deg}</span>
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="wx-header">
        <div class="wx-title-row">
          <span class="wx-today-lbl">Today</span>
          <span class="wx-desc">${this._esc(c.description)}</span>
        </div>
        <div class="wx-sun-row">
          <div class="sun-badge">
            <img src="/icons/weather/wi-sunrise.png" class="wx-ico ico-xs" alt="Sunrise">
            <span>${c.sunrise}</span>
          </div>
          <div class="sun-badge">
            <img src="/icons/weather/wi-sunset.png" class="wx-ico ico-xs" alt="Sunset">
            <span>${c.sunset}</span>
          </div>
        </div>
      </div>

      <div class="wx-hourly-strip">${hourlyHTML}</div>
      <div class="wx-divider"></div>
      <div class="wx-forecast-list">${forecastHTML}</div>`;

    this._initHourlyScroll();
    this._initForecastScroll();
  }

  _initForecastScroll() {
    const list = this.el.querySelector('.wx-forecast-list');
    if (!list) return;

    let active = false, startY = 0, scrollTop = 0;
    let velY = 0, lastY = 0, lastT = 0, rafId = null;

    const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

    const coast = () => {
      velY *= 0.90;
      list.scrollTop -= velY * 16;
      if (Math.abs(velY) > 0.15) rafId = requestAnimationFrame(coast);
      else rafId = null;
    };

    list.addEventListener('pointerdown', e => {
      stop();
      active = true;
      startY = lastY = e.clientY;
      scrollTop = list.scrollTop;
      lastT = Date.now();
      velY = 0;
      list.setPointerCapture(e.pointerId);
    });

    list.addEventListener('pointermove', e => {
      if (!active) return;
      const now = Date.now(), dt = now - lastT || 1;
      velY   = (lastY - e.clientY) / dt;
      lastY  = e.clientY;
      lastT  = now;
      list.scrollTop = scrollTop + (startY - e.clientY);
    });

    list.addEventListener('pointerup', () => {
      active = false;
      if (Math.abs(velY) > 0.2) rafId = requestAnimationFrame(coast);
    });

    list.addEventListener('pointercancel', () => { active = false; velY = 0; });
  }

  _initHourlyScroll() {
    const strip = this.el.querySelector('.wx-hourly-strip');
    if (!strip) return;

    let active = false, startX = 0, scrollLeft = 0;
    let velX = 0, lastX = 0, lastT = 0, rafId = null;

    const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

    const coast = () => {
      velX *= 0.90;
      strip.scrollLeft -= velX * 16;
      if (Math.abs(velX) > 0.15) rafId = requestAnimationFrame(coast);
      else rafId = null;
    };

    strip.addEventListener('pointerdown', e => {
      stop();
      active = true;
      startX = lastX = e.clientX;
      scrollLeft = strip.scrollLeft;
      lastT = Date.now();
      velX = 0;
      strip.setPointerCapture(e.pointerId);
    });

    strip.addEventListener('pointermove', e => {
      if (!active) return;
      const now = Date.now();
      const dt  = now - lastT || 1;
      velX = (lastX - e.clientX) / dt;   // px/ms, positive = scrolling right
      lastX = e.clientX;
      lastT = now;
      strip.scrollLeft = scrollLeft + (startX - e.clientX);
    });

    strip.addEventListener('pointerup', () => {
      active = false;
      if (Math.abs(velX) > 0.2) rafId = requestAnimationFrame(coast);
    });

    strip.addEventListener('pointercancel', () => { active = false; velX = 0; });
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['weather'] = WeatherWidget;
