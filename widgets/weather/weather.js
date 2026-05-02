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
    this.data = null;
    this._showSkeleton();
    this._initEvents();
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
    this.data = data;
    const { current: c, hourly, forecast } = data;
    const deg = c.units === 'imperial' ? '°F' : '°';

    // Temperature color scale
    const getColor = (t) => {
      if (t <= -5) return '#00b3ff';
      if (t >= 35) return '#ff3b30';
      if (t < 15) {
        const r = (t + 5) / 20;
        return `rgb(${Math.round(255*r)}, ${Math.round(179 + 59*r)}, ${Math.round(255 - 255*r)})`;
      }
      const r = (t - 15) / 20;
      return `rgb(255, ${Math.round(238 - 179*r)}, ${Math.round(48*r)})`;
    };

    const allMin = Math.min(...forecast.map(d => d.temp_min));
    const allMax = Math.max(...forecast.map(d => d.temp_max));
    const range  = allMax - allMin || 1;

    const tzOffsetSec = c.tz_offset || 0;
    const nowLocal = new Date(Date.now() + tzOffsetSec * 1000);
    const todayFraction = (nowLocal.getUTCHours() * 3600 + nowLocal.getUTCMinutes() * 60 + nowLocal.getUTCSeconds()) / 86400;

    const hourlyHTML = (hourly || []).map((h, i) => `
      <div class="hour-col">
        <span class="hour-lbl${i === 0 ? ' now' : ''}">${this._esc(h.hour)}</span>
        ${wxIcon(h.icon, 'sm')}
        <span class="hour-temp">${h.temp}${deg}</span>
      </div>`).join('');

    const forecastHTML = (forecast || []).map((day, i) => {
      const isToday = i === 0;
      let barStyle, dotHTML = '';
      if (isToday) {
        const color1 = getColor(day.temp_min), color2 = getColor(day.temp_max);
        barStyle = `left:0%; width:100%; background:linear-gradient(90deg, ${color1}, ${color2})`;
        dotHTML = `<div class="fcast-cur-dot" style="left:${(todayFraction * 100).toFixed(1)}%"></div>`;
      } else {
        const left = ((day.temp_min - allMin) / range) * 100, right = ((day.temp_max - allMin) / range) * 100;
        const width = Math.max(5, right - left);
        const color1 = getColor(day.temp_min), color2 = getColor(day.temp_max);
        barStyle = `left:${left}%; width:${width}%; background:linear-gradient(90deg, ${color1}, ${color2})`;
      }
      return `
      <div class="fcast-row${isToday ? ' today' : ''}" data-idx="${i}">
        <span class="fcast-name">${this._esc(day.day)}</span>
        ${wxIcon(day.icon, 'md')}
        <span class="fcast-lo">${day.temp_min}${deg}</span>
        <div class="fcast-line-wrap">
          <div class="fcast-line-fill" style="${barStyle}"></div>
          ${dotHTML}
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
  }

  _initEvents() {
    let activeF = false, startY = 0, scrollTop = 0, velY = 0, lastY = 0, lastT = 0, rafIdF = null, hasMovedF = false, targetRow = null, touchX = 0, touchY = 0;
    const stopF = () => { if (rafIdF) { cancelAnimationFrame(rafIdF); rafIdF = null; } };
    const coastF = (list) => {
      velY *= 0.90; list.scrollTop -= velY * 16;
      if (Math.abs(velY) > 0.15) rafIdF = requestAnimationFrame(() => coastF(list));
      else rafIdF = null;
    };
    this.el.addEventListener('pointerdown', e => {
      const list = e.target.closest('.wx-forecast-list'), strip = e.target.closest('.wx-hourly-strip');
      if (list) {
        stopF(); activeF = true; hasMovedF = false; targetRow = e.target.closest('.fcast-row');
        touchX = e.clientX; startY = lastY = touchY = e.clientY; scrollTop = list.scrollTop;
        lastT = Date.now(); velY = 0; list.setPointerCapture(e.pointerId);
      } else if (strip) this._initHourlyScroll(strip, e);
    });
    this.el.addEventListener('pointermove', e => {
      if (activeF) {
        const list = e.target.closest('.wx-forecast-list'); if (!list) return;
        const dy = Math.abs(e.clientY - startY); if (dy > 5) hasMovedF = true;
        const now = Date.now(), dt = now - lastT || 1;
        velY = (lastY - e.clientY) / dt; lastY = e.clientY; lastT = now;
        list.scrollTop = scrollTop + (startY - e.clientY);
      }
    });
    this.el.addEventListener('pointerup', e => {
      if (activeF) {
        const list = e.target.closest('.wx-forecast-list'); activeF = false;
        if (list) list.releasePointerCapture(e.pointerId);
        if (!hasMovedF && targetRow && this.data) {
          const idx = parseInt(targetRow.dataset.idx), day = this.data.forecast[idx];
          if (day) this._showWeatherDetail(day, this.data.current, touchX, touchY);
        } else if (list && Math.abs(velY) > 0.2) rafIdF = requestAnimationFrame(() => coastF(list));
        targetRow = null;
      }
    });
    this.el.addEventListener('pointercancel', () => { activeF = false; targetRow = null; });
  }

  _showWeatherDetail(day, current, x, y) {
    const modal = document.getElementById('modal-overlay'), card = document.getElementById('modal-card');
    if (!modal || !card) return;
    if (x !== undefined && y !== undefined) {
      card.style.setProperty('--origin-x', `${x - window.innerWidth / 2}px`);
      card.style.setProperty('--origin-y', `${y - window.innerHeight / 2}px`);
    }
    const deg = current.units === 'imperial' ? '°F' : '°', isToday = day.day === 'Today';
    const stats = isToday ? { feels_like: current.feels_like, humidity: current.humidity, wind_speed: current.wind_speed, uvi: current.uvi, pressure: '-', clouds: '-', rain: '-' } : day;
    const uviVal = stats.uvi !== undefined && stats.uvi !== null ? parseFloat(stats.uvi).toFixed(1) : '-';

    let graphsHTML = '';
    if (isToday && this.data.hourly) {
      const hours = this.data.hourly.slice(0, 24);
      graphsHTML = `
        <div class="wx-modal-graphs">
          ${this._renderGraph("Temperature Change", hours, h => h.temp, "#ff3b30", "rgba(255,100,0,0.4)")}
          ${this._renderGraph("UV Index Change", hours, h => h.uvi, "#ffcc00", "rgba(255,200,0,0.4)")}
        </div>`;
    }

    card.innerHTML = `
      <div class="wx-modal-content">
        <div class="wx-modal-header">
          ${wxIcon(day.icon, 'lg')}
          <div class="wx-modal-title-group">
            <div class="wx-modal-day">${this._esc(day.day)} <span class="wx-modal-date">${day.date}</span></div>
            <div class="wx-modal-desc">${this._esc(day.description)}</div>
          </div>
        </div>
        <div class="wx-modal-temps">
          <div class="wx-modal-temp-item"><span class="label">High</span><span class="value">${day.temp_max}${deg}</span></div>
          <div class="wx-modal-temp-item"><span class="label">Low</span><span class="value">${day.temp_min}${deg}</span></div>
        </div>
        ${graphsHTML}
        <div class="wx-modal-grid">
          <div class="wx-modal-stat"><img src="/icons/weather/wi-thermometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Feels Like</span><span class="value">${stats.feels_like}${deg}</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-humidity.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Humidity</span><span class="value">${stats.humidity}%</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-strong-wind.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Wind</span><span class="value">${stats.wind_speed} <small>${current.units === 'imperial' ? 'mph' : 'm/s'}</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-barometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Pressure</span><span class="value">${stats.pressure} <small>hPa</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-cloud.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Clouds</span><span class="value">${stats.clouds}%</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-raindrops.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Precip.</span><span class="value">${stats.rain} <small>mm</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-day-sunny.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">UV Index</span><span class="value">${uviVal}</span></div></div>
        </div>
      </div>`;

    document.body.classList.add('modal-open');
    modal.classList.add('open');
    const close = (evt) => {
      if (evt.target === modal || (evt.type === 'keydown' && evt.key === 'Escape')) {
        document.body.classList.remove('modal-open'); modal.classList.remove('open');
        window.removeEventListener('keydown', close); modal.removeEventListener('click', close);
      }
    };
    setTimeout(() => { modal.addEventListener('click', close); window.addEventListener('keydown', close); }, 10);
  }

  _renderGraph(title, hours, valFn, strokeColor, fillColor) {
    const vals = hours.map(valFn), maxV = Math.max(...vals), minV = Math.min(...vals), range = maxV - minV || 1;
    const w = 520, h = 100, p = 20, step = (w - p * 2) / (hours.length - 1);
    
    // Smooth line calculation (Catmull-Rom or Simple Bezier)
    // We'll use a simplified version: Quadratic Curve through points
    let pathD = `M ${p},${h - p - ((vals[0] - minV) / range) * (h - p * 2)}`;
    for (let i = 0; i < hours.length - 1; i++) {
        const x1 = p + i * step, y1 = h - p - ((vals[i] - minV) / range) * (h - p * 2);
        const x2 = p + (i + 1) * step, y2 = h - p - ((vals[i + 1] - minV) / range) * (h - p * 2);
        const cx = (x1 + x2) / 2;
        pathD += ` Q ${x1},${y1} ${cx},${(y1 + y2) / 2} T ${x2},${y2}`;
    }

    const bars = hours.map((hour, i) => {
        const bw = step * 0.6, bh = ((valFn(hour) - minV) / range) * (h - p * 2) + 2;
        const bx = p + i * step - bw / 2, by = h - p - bh;
        return `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bw/2}" fill="${strokeColor}" opacity="0.15" />`;
    }).join('');

    const labels = hours.filter((_, i) => i % 6 === 0 || i === hours.length - 1).map(h_obj => {
        const x = p + (hours.indexOf(h_obj)) * step;
        return `<text x="${x}" y="${h - 2}" text-anchor="middle" class="graph-label">${h_obj.hour}</text>`;
    }).join('');

    return `
      <div class="wx-modal-graph-container">
        <div class="wx-graph-header">${title}</div>
        <svg viewBox="0 0 ${w} ${h}" class="wx-svg-graph">
          <path d="${pathD} L ${w-p},${h-p} L ${p},${h-p} Z" fill="${fillColor}" opacity="0.2" />
          ${bars}
          <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" />
          ${labels}
        </svg>
      </div>`;
  }

  _initHourlyScroll(strip, downEvent) {
    let active = true, startX = downEvent.clientX, scrollLeft = strip.scrollLeft, velX = 0, lastX = downEvent.clientX, lastT = Date.now(), rafId = null;
    const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }, coast = () => {
      velX *= 0.90; strip.scrollLeft -= velX * 16;
      if (Math.abs(velX) > 0.15) rafId = requestAnimationFrame(coast); else rafId = null;
    };
    const onMove = e => {
      if (!active) return;
      const now = Date.now(), dt = now - lastT || 1;
      velX = (lastX - e.clientX) / dt; lastX = e.clientX; lastT = now;
      strip.scrollLeft = scrollLeft + (startX - e.clientX);
    };
    const onUp = () => {
      active = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      if (Math.abs(velX) > 0.2) rafId = requestAnimationFrame(coast);
    };
    stop(); strip.setPointerCapture(downEvent.pointerId);
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  }
  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}
window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['weather'] = WeatherWidget;
