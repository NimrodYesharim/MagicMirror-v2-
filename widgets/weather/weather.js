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
  const night  = code?.endsWith('n');
  const cls    = sunny ? 'wx-ico sunny' : night ? 'wx-ico night' : 'wx-ico';
  return `<img src="/icons/weather/${name}.png" class="${cls} ico-${size}" alt="${code}">`;
}

class WeatherWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this.data = null;
    this._currentMetric = 'conditions';
    this._tempMode = 'actual';
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
      const left = ((day.temp_min - allMin) / range) * 100;
      const right = ((day.temp_max - allMin) / range) * 100;
      const width = Math.max(5, right - left);
      const color1 = getColor(day.temp_min), color2 = getColor(day.temp_max);
      const barStyle = `left:${left}%; width:${width}%; background:linear-gradient(90deg, ${color1}, ${color2})`;
      
      let dotHTML = '';
      if (isToday) {
        const currentTemp = parseFloat(c.temp);
        const clampedTemp = Math.max(allMin, Math.min(allMax, currentTemp));
        const dotLeft = ((clampedTemp - allMin) / range) * 100;
        dotHTML = `<div class="fcast-cur-dot" style="left:${dotLeft.toFixed(1)}%"></div>`;
      }
      return `
      <div class="fcast-row${isToday ? ' today' : ''}" data-idx="${i}">
        <span class="fcast-name">${this._esc(day.day === 'Today' ? 'Today' : day.day.slice(0, 3))}</span>
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

  // ── Event handling ────────────────────────────────────────────────────────

  _initEvents() {
    let activeF = false, startY = 0, scrollTop = 0, velY = 0, lastY = 0, lastT = 0;
    let rafIdF = null, hasMovedF = false, targetRow = null, touchX = 0, touchY = 0;
    const stopF = () => { if (rafIdF) { cancelAnimationFrame(rafIdF); rafIdF = null; } };
    const coastF = (list) => {
      velY *= 0.90; list.scrollTop -= velY * 16;
      if (Math.abs(velY) > 0.15) rafIdF = requestAnimationFrame(() => coastF(list));
      else rafIdF = null;
    };
    this.el.addEventListener('pointerdown', e => {
      const list  = e.target.closest('.wx-forecast-list');
      const strip = e.target.closest('.wx-hourly-strip');
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
          const idx = parseInt(targetRow.dataset.idx);
          const day = this.data.forecast[idx];
          if (day) this._showWeatherDetail(day, this.data.current, touchX, touchY);
        } else if (list && Math.abs(velY) > 0.2) rafIdF = requestAnimationFrame(() => coastF(list));
        targetRow = null;
      }
    });
    this.el.addEventListener('pointercancel', () => { activeF = false; targetRow = null; });
  }

  _initHourlyScroll(strip, downEvent) {
    let active = true, startX = downEvent.clientX, scrollLeft = strip.scrollLeft;
    let velX = 0, lastX = downEvent.clientX, lastT = Date.now(), rafId = null;
    const stop  = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };
    const coast = () => {
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
      active = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (Math.abs(velX) > 0.2) rafId = requestAnimationFrame(coast);
    };
    stop(); strip.setPointerCapture(downEvent.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── Modal dispatcher ──────────────────────────────────────────────────────

  _showWeatherDetail(day, current, x, y) {
    const modal = document.getElementById('modal-overlay');
    const card  = document.getElementById('modal-card');
    if (!modal || !card) return;
    if (x !== undefined && y !== undefined) {
      card.style.setProperty('--origin-x', `${x - window.innerWidth / 2}px`);
      card.style.setProperty('--origin-y', `${y - window.innerHeight / 2}px`);
    }

    const isToday = day.day === 'Today';
    if (isToday && this.data?.hourly) {
      card.classList.add('wx-today-card');
      this._currentMetric = 'conditions';
      this._tempMode = 'actual';
      card.innerHTML = this._buildTodayDetail(day, current, this.data.hourly);
      this._initTodayDetailEvents(card, day, current, this.data.hourly);
    } else {
      card.classList.remove('wx-today-card');
      card.innerHTML = this._buildForecastDetail(day, current);
    }

    document.body.classList.add('modal-open');
    modal.classList.add('open');
    const close = (evt) => {
      if (evt.target === modal || (evt.type === 'keydown' && evt.key === 'Escape')) {
        document.body.classList.remove('modal-open');
        modal.classList.remove('open');
        card.classList.remove('wx-today-card');
        window.removeEventListener('keydown', close);
        modal.removeEventListener('click', close);
      }
    };
    setTimeout(() => {
      modal.addEventListener('click', close);
      window.addEventListener('keydown', close);
    }, 10);
  }

  // ── Today detail panel ────────────────────────────────────────────────────

  _buildTodayDetail(day, current, hourly) {
    const deg    = current.units === 'imperial' ? '°F' : '°';
    const unit   = current.units === 'imperial' ? 'mph' : 'm/s';
    const uviVal = current.uvi != null ? parseFloat(current.uvi).toFixed(1) : '-';
    const m0     = this._getMetrics()[0];
    const chartHTML = this._buildTempChart(day, current, hourly, 'actual');

    return `
      <div class="wx-modal-content">
        <div class="wx-modal-header">
          ${wxIcon(current.icon, 'lg')}
          <div class="wx-modal-title-group">
            <div class="wx-modal-day">Today</div>
            <div class="wx-modal-desc">${this._esc(current.description)}</div>
          </div>
          <button class="wx-td-close" data-action="close" style="margin-left:auto">✕</button>
        </div>

        <div class="wx-modal-temps">
          <div class="wx-modal-temp-item"><span class="label">High</span><span class="value">${day.temp_max}${deg}</span></div>
          <div class="wx-modal-temp-item"><span class="label">Low</span><span class="value">${day.temp_min}${deg}</span></div>
        </div>

        <div class="wx-modal-grid">
          <div class="wx-modal-stat active" data-metric="conditions"><img src="/icons/weather/wi-thermometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Feels Like</span><span class="value">${current.feels_like}${deg}</span></div></div>
          <div class="wx-modal-stat" data-metric="humidity"><img src="/icons/weather/wi-humidity.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Humidity</span><span class="value">${current.humidity}%</span></div></div>
          <div class="wx-modal-stat" data-metric="wind"><img src="/icons/weather/wi-strong-wind.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Wind</span><span class="value">${current.wind_speed} <small>${unit}</small></span></div></div>
          <div class="wx-modal-stat" data-metric="pressure"><img src="/icons/weather/wi-barometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Pressure</span><span class="value">${day.pressure} <small>hPa</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-cloud.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Clouds</span><span class="value">${day.clouds}%</span></div></div>
          <div class="wx-modal-stat" data-metric="rain"><img src="/icons/weather/wi-raindrops.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Precip.</span><span class="value">${day.rain} <small>mm</small></span></div></div>
          <div class="wx-modal-stat" data-metric="uvi"><img src="/icons/weather/wi-day-sunny.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">UV Index</span><span class="value">${uviVal}</span></div></div>
        </div>

        <div class="wx-today-graph-section">
          <div class="wx-today-graph-hdr">
            <div class="wx-td-title" data-role="metric-title">
              <span class="wx-td-title-icon">${m0.icon}</span>
              <span class="wx-td-title-label">${m0.label}</span>
            </div>
            <div class="wx-td-metric-rel">
              <button class="wx-td-metric-btn" data-action="toggle-metric">
                <span class="wx-metric-btn-icon">${m0.icon}</span>
                <span class="wx-td-metric-chevron">▾</span>
              </button>
              <div class="wx-td-metric-dropdown">
                ${this._buildMetricOptions('conditions')}
              </div>
            </div>
          </div>
          <div class="wx-td-chart-wrap" data-metric="conditions">
            ${chartHTML}
          </div>
        </div>
      </div>`;
  }

  _buildCalStrip(nowLocal, forecast) {
    const DOW_SHORT  = ['S','M','T','W','T','F','S'];
    const DOW_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    const todayDow   = nowLocal.getUTCDay();
    const todayDate  = nowLocal.getUTCDate();
    const month      = nowLocal.getUTCMonth();
    const year       = nowLocal.getUTCFullYear();
    const fullStr    = `${DOW_FULL[todayDow]}, ${todayDate} ${MONTH_FULL[month]} ${year}`;

    // 8 days: today + next 7 (matches forecast length)
    const days = (forecast || []).slice(0, 8).map((_, i) => {
      const d = new Date(nowLocal.getTime() + i * 86400000);
      return { dow: DOW_SHORT[d.getUTCDay()], date: d.getUTCDate(), isToday: i === 0 };
    });

    return `
      <div class="wx-td-calendar">
        <div class="wx-cal-dow-row">${days.map(d => `<div class="wx-cal-dow">${d.dow}</div>`).join('')}</div>
        <div class="wx-cal-date-row">${days.map(d =>
          `<div class="wx-cal-date${d.isToday ? ' today' : ''}">${d.date}</div>`).join('')}
        </div>
      </div>
      <div class="wx-td-full-date">${fullStr}</div>`;
  }

  _buildHourStrip(hourly, deg) {
    return `<div class="wx-td-hour-strip">${
      hourly.slice(0, 13).map((h, i) => `
        <div class="wx-td-hour-col">
          <span class="wx-td-hour-lbl${i === 0 ? ' now' : ''}">${this._esc(h.hour)}</span>
          ${wxIcon(h.icon, 'sm')}
          <span class="wx-td-hour-temp">${h.temp}${deg}</span>
        </div>`).join('')
    }</div>`;
  }

  _getMetrics() {
    const svg = (path) =>
      `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    return [
      { key: 'conditions', label: 'Conditions',   sub: 'Temperature · Feels Like',
        icon: svg('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>') },
      { key: 'uvi',        label: 'UV Index',     sub: '',
        icon: svg('<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>') },
      { key: 'wind',       label: 'Wind',         sub: '',
        icon: svg('<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>') },
      { key: 'rain',       label: 'Precipitation',sub: '',
        icon: svg('<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>') },
      { key: 'humidity',   label: 'Humidity',     sub: '',
        icon: svg('<path d="M2 12c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1c.6-.5 1.2-1 2.5-1s1.9.5 2.5 1c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1"/><path d="M2 7c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1c.6-.5 1.2-1 2.5-1s1.9.5 2.5 1c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1"/><path d="M2 17c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1c.6-.5 1.2-1 2.5-1s1.9.5 2.5 1c.6.5 1.2 1 2.5 1s1.9-.5 2.5-1"/>') },
      { key: 'visibility', label: 'Visibility',   sub: '',
        icon: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>') },
      { key: 'pressure',   label: 'Pressure',     sub: '',
        icon: svg('<path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2Z"/><path d="M12 6v2"/><path d="M6 12H8"/><path d="M16 12h2"/><polyline points="12,12 15,9"/>') },
    ];
  }

  _buildMetricOptions(active) {
    return this._getMetrics().map(m => `
      <div class="wx-td-metric-opt${m.key === active ? ' active' : ''}" data-metric="${m.key}">
        <span class="wx-td-opt-check">${m.key === active ? '✓' : ''}</span>
        <span class="wx-td-opt-icon">${m.icon}</span>
        <div class="wx-td-opt-text">
          <div class="wx-td-opt-label">${m.label}</div>
          ${m.sub ? `<div class="wx-td-opt-sub">${m.sub}</div>` : ''}
        </div>
      </div>`).join('');
  }

  // ── Temperature SVG chart ─────────────────────────────────────────────────

  _buildTempChart(day, current, hourly, mode) {
    const tzOffsetSec = current.tz_offset || 0;
    const nowLocal    = new Date(Date.now() + tzOffsetSec * 1000);
    const curH        = nowLocal.getUTCHours();
    const curM        = nowLocal.getUTCMinutes();
    const nowDecimal  = curH + curM / 60;
    const timeStr     = `${String(curH).padStart(2,'0')}:${String(curM).padStart(2,'0')}`;

    const pts = this._build24hTempPoints(day, current, hourly, mode);

    const W=600, H=220, L=10, R=52, T=44, B=44;
    const cW = W - L - R, cH = H - T - B;

    const vals    = pts.map(p => p.val);
    const rawMin  = Math.min(...vals), rawMax = Math.max(...vals);
    const pad     = (rawMax - rawMin) * 0.18 || 2;
    const vMin    = rawMin - pad, vMax = rawMax + pad * 1.4, vRange = vMax - vMin;

    const xH = h  => L + (h  / 24)    * cW;
    const yV = v  => T + cH - ((v - vMin) / vRange) * cH;

    const bezier = (xy) => {
      if (xy.length < 2) return '';
      let d = `M${xy[0].x},${xy[0].y}`;
      for (let i = 1; i < xy.length; i++) {
        const [p, n] = [xy[i-1], xy[i]];
        const t = 0.38;
        d += ` C${p.x+(n.x-p.x)*t},${p.y} ${n.x-(n.x-p.x)*t},${n.y} ${n.x},${n.y}`;
      }
      return d;
    };

    const allXY  = pts.map(p => ({ x: xH(p.h), y: yV(p.val), val: p.val }));
    const nowX   = xH(nowDecimal);

    // Split at nowX, interpolate junction
    const pastXY   = allXY.filter(p => p.x <= nowX);
    const futureXY = allXY.filter(p => p.x >= nowX);

    if (pastXY.length && futureXY.length && pastXY[pastXY.length-1].x < nowX) {
      const a = pastXY[pastXY.length-1], b = futureXY[0];
      const t = (nowX - a.x) / ((b.x - a.x) || 1);
      const jy  = a.y + (b.y - a.y) * t;
      const jv  = a.val + (b.val - a.val) * t;
      pastXY.push({ x: nowX, y: jy, val: jv });
      futureXY.unshift({ x: nowX, y: jy, val: jv });
    }

    const pastPath   = bezier(pastXY);
    const futurePath = bezier(futureXY);
    const areaY      = T + cH;
    const futureArea = futurePath.length >= 4
      ? `${futurePath} L${futureXY[futureXY.length-1].x},${areaY} L${futureXY[0].x},${areaY} Z`
      : '';

    // H/L from future portion
    const hiPt = futureXY.reduce((a, p) => (!a || p.val > a.val) ? p : a, null);
    const loPt = futureXY.reduce((a, p) => (!a || p.val < a.val) ? p : a, null);

    // Y-axis grid & labels
    const vStep   = this._niceStep((rawMax - rawMin + pad * 2.4) / 5);
    const vStart  = Math.ceil(vMin / vStep) * vStep;
    const yGrids  = [];
    for (let v = vStart; v <= vMax + 0.01; v += vStep) {
      const y = yV(v);
      if (y > T - 8 && y < T + cH + 8) yGrids.push({ v: Math.round(v), y });
    }

    const xTicks = [0, 6, 12, 18];

    const deg = current.units === 'imperial' ? '°F' : '°';

    this._pendingPoints = allXY.map((p, i) => ({
      svgX: p.x, svgY: p.y, val: p.val,
      timeLabel: `${String(pts[i]?.h ?? i).padStart(2,'0')}:00`,
      formatVal: v => `${Math.round(v)}${deg}`,
    }));

    return `<svg viewBox="0 0 ${W} ${H}" class="wx-td-svg">
      <defs>
        <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="rgba(215,150,0,0.88)"/>
          <stop offset="42%"  stop-color="rgba(105,175,30,0.72)"/>
          <stop offset="100%" stop-color="rgba(18,128,152,0.44)"/>
        </linearGradient>
      </defs>

      ${yGrids.map(g =>
        `<line x1="${L}" y1="${g.y}" x2="${W-R}" y2="${g.y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`
      ).join('')}
      ${xTicks.map(h =>
        `<line x1="${xH(h)}" y1="${T}" x2="${xH(h)}" y2="${T+cH}" stroke="rgba(255,255,255,0.07)" stroke-width="1" stroke-dasharray="3,3"/>`
      ).join('')}

      ${futureArea ? `<path d="${futureArea}" fill="url(#tGrad)"/>` : ''}

      ${pastPath   ? `<path d="${pastPath}"   fill="none" stroke="rgba(100,175,100,0.45)" stroke-width="2"   stroke-dasharray="5,4" stroke-linecap="round"/>` : ''}
      ${futurePath ? `<path d="${futurePath}" fill="none" stroke="#FFB800"               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}

      <line x1="${nowX}" y1="${T-10}" x2="${nowX}" y2="${T+cH}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>
      <text x="${nowX}" y="${T-14}" text-anchor="middle" class="wx-chart-now-label">${timeStr}</text>

      ${hiPt ? `
        <text x="${hiPt.x}" y="${hiPt.y - 13}" text-anchor="middle" class="wx-chart-hl-label">H</text>
        <circle cx="${hiPt.x}" cy="${hiPt.y}" r="4.5" fill="white" opacity="0.9"/>` : ''}
      ${loPt && loPt !== hiPt ? `
        <text x="${loPt.x}" y="${loPt.y + 18}" text-anchor="middle" class="wx-chart-hl-label">L</text>
        <circle cx="${loPt.x}" cy="${loPt.y}" r="4.5" fill="white" opacity="0.9"/>` : ''}

      <line x1="${L}" y1="${T+cH}" x2="${W-R}" y2="${T+cH}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>

      ${yGrids.map(g =>
        `<text x="${W-R+8}" y="${g.y+4}" class="wx-chart-axis-label">${g.v}°</text>`
      ).join('')}
      ${xTicks.map(h =>
        `<text x="${xH(h)}" y="${T+cH+22}" text-anchor="middle" class="wx-chart-axis-label">${h || '0'}</text>`
      ).join('')}
    </svg>`;
  }

  _build24hTempPoints(day, current, hourly, mode) {
    const tzOffsetSec = current.tz_offset || 0;
    const nowLocal    = new Date(Date.now() + tzOffsetSec * 1000);
    const curH        = nowLocal.getUTCHours();
    const curM        = nowLocal.getUTCMinutes();
    const nowDecimal  = curH + curM / 60;

    const curTemp  = mode === 'feels' ? (current.feels_like ?? current.temp) : current.temp;
    const dayMin   = day.temp_min;
    const lowHour  = 5;
    const pts      = [];

    // Synthetic past: hour 0 → curH-1
    for (let h = 0; h < curH; h++) {
      let val;
      if (h <= lowHour) {
        val = dayMin;
      } else {
        val = dayMin + (curTemp - dayMin) * (h - lowHour) / Math.max(1, nowDecimal - lowHour);
      }
      pts.push({ h, val, isPast: true });
    }

    // Current + future from hourly data
    const limit = Math.min(hourly.length, 24 - curH + 1);
    for (let i = 0; i < limit; i++) {
      const h  = curH + i;
      if (h > 23) break;
      const hd = hourly[i];
      const val = mode === 'feels' ? (hd.feels_like ?? hd.temp) : hd.temp;
      pts.push({ h, val, isPast: false });
    }

    return pts;
  }

  // ── UV Index SVG chart ────────────────────────────────────────────────────

  _buildUVChart(hourly, current) {
    const W=600, H=220, L=10, R=52, T=40, B=44;
    const cW = W - L - R, cH = H - T - B;

    const tzOffsetSec = current?.tz_offset || 0;
    const nowLocal    = new Date(Date.now() + tzOffsetSec * 1000);
    const curH        = nowLocal.getUTCHours();
    const limit       = Math.min(hourly.length, 25);

    const uvis    = hourly.slice(0, limit).map(h => h.uvi || 0);
    const maxUVI  = Math.max(...uvis, 1);
    const vMax    = Math.ceil(maxUVI * 1.25);

    const xD = i => L + (i / 24) * cW;
    const yV = v => T + cH - (v / vMax) * cH;

    const uvPts = uvis.map((v, i) => ({ x: xD(i), y: yV(v), v }));

    const bezier = (xy) => {
      if (xy.length < 2) return '';
      let d = `M${xy[0].x},${xy[0].y}`;
      for (let i = 1; i < xy.length; i++) {
        const [p, n] = [xy[i-1], xy[i]];
        const t = 0.38;
        d += ` C${p.x+(n.x-p.x)*t},${p.y} ${n.x-(n.x-p.x)*t},${n.y} ${n.x},${n.y}`;
      }
      return d;
    };

    const linePath = bezier(uvPts);
    const areaPath = `${linePath} L${uvPts[uvPts.length-1].x},${T+cH} L${uvPts[0].x},${T+cH} Z`;

    const UV_CATS = [
      { val: 0,  label: 'Low'       },
      { val: 3,  label: 'Moderate'  },
      { val: 6,  label: 'High'      },
      { val: 8,  label: 'Very High' },
      { val: 11, label: 'Extreme'   },
    ];

    const catLines = UV_CATS.filter(c => c.val <= vMax).map(c => {
      const y = yV(c.val);
      return `<text x="${L+4}" y="${y-4}" class="wx-chart-cat-label">${c.label}</text>
        <line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
    }).join('');

    const xTicks = [0, 6, 12, 18].map(off => {
      const label = off === 0 ? 'Now' : `${String((curH + off) % 24).padStart(2,'0')}`;
      return `<text x="${xD(off).toFixed(1)}" y="${T+cH+22}" text-anchor="middle" class="wx-chart-axis-label">${label}</text>`;
    }).join('');

    const yStep = vMax <= 5 ? 1 : vMax <= 8 ? 2 : 3;
    const yLbls = [];
    for (let v = 0; v <= vMax; v += yStep)
      yLbls.push(`<text x="${W-R+8}" y="${yV(v)+4}" class="wx-chart-axis-label">${v}</text>`);

    this._pendingPoints = uvPts.map((p, i) => ({
      svgX: p.x, svgY: p.y, val: p.v,
      timeLabel: `${String((curH + i) % 24).padStart(2,'0')}:00`,
      formatVal: v => `UVI ${v.toFixed(1)}`,
    }));

    // Current UV annotation
    const nowUVI   = hourly[0]?.uvi ?? 0;
    const uvLevel  = UV_CATS.slice().reverse().find(c => nowUVI >= c.val)?.label ?? 'Low';

    return `
      <div class="wx-td-uvi-header">
        <span class="wx-td-uvi-val">${nowUVI}</span>
        <span class="wx-td-uvi-level">${uvLevel}</span>
      </div>
      <div class="wx-td-uvi-sub">World Health Organization UVI</div>
      <svg viewBox="0 0 ${W} ${H}" class="wx-td-svg">
        <defs>
          <linearGradient id="uvGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="rgba(255,40,0,0.9)"/>
            <stop offset="25%"  stop-color="rgba(255,130,0,0.82)"/>
            <stop offset="55%"  stop-color="rgba(205,210,0,0.72)"/>
            <stop offset="100%" stop-color="rgba(48,200,48,0.48)"/>
          </linearGradient>
          <linearGradient id="uvStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#FF2800"/>
            <stop offset="50%"  stop-color="#FFB800"/>
            <stop offset="100%" stop-color="#32C832"/>
          </linearGradient>
        </defs>
        ${catLines}
        <path d="${areaPath}" fill="url(#uvGrad)"/>
        <path d="${linePath}" fill="none" stroke="url(#uvStroke)" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="${L}" y1="${T+cH}" x2="${W-R}" y2="${T+cH}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>
        ${yLbls.join('')}
        ${xTicks}
      </svg>`;
  }

  // ── Precipitation SVG chart ───────────────────────────────────────────────

  _buildPrecipSection(hourly, maxPop) {
    return `
      <div class="wx-td-precip">
        <h3 class="wx-td-precip-title">Chance of Precipitation</h3>
        <p class="wx-td-precip-sub">Today's chance: ${maxPop}%</p>
        ${this._buildPrecipChart(hourly)}
      </div>`;
  }

  _buildPrecipChart(hourly, current) {
    const W=600, H=170, L=10, R=55, T=10, B=40;
    const cW = W - L - R, cH = H - T - B;

    const tzOffsetSec = current?.tz_offset || 0;
    const nowLocal    = new Date(Date.now() + tzOffsetSec * 1000);
    const curH        = nowLocal.getUTCHours();
    const limit       = Math.min(hourly.length, 25);

    const hours = hourly.slice(0, limit);
    const slotW = cW / 24;
    const barW  = slotW * 0.65;
    const xD = i => L + (i / 24) * cW;

    this._pendingPoints = hours.map((h, i) => {
      const pop = h.pop || 0;
      const cx  = xD(i) + slotW / 2;
      const cy  = T + cH - (pop / 100) * cH;
      return { svgX: cx, svgY: cy, val: pop, timeLabel: `${String((curH + i) % 24).padStart(2,'0')}:00`, formatVal: v => `${Math.round(v)}%` };
    });

    const bars = hours.map((h, i) => {
      const pop = h.pop || 0;
      if (!pop) return '';
      const bH = (pop / 100) * cH;
      const x  = xD(i) + (slotW - barW) / 2;
      const y  = T + cH - bH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="url(#precip_hatch)" rx="2"/>`;
    }).join('');

    const yLbls = [0, 20, 40, 60, 80, 100].map(v => {
      const y = T + cH - (v / 100) * cH;
      return { v, y };
    });

    const xTicks = [0, 6, 12, 18].map(off => {
      const label = off === 0 ? 'Now' : `${String((curH + off) % 24).padStart(2,'0')}`;
      return `<text x="${xD(off).toFixed(1)}" y="${T+cH+22}" text-anchor="middle" class="wx-chart-axis-label">${label}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" class="wx-td-svg">
      <defs>
        <pattern id="precip_hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(140,155,180,0.65)" stroke-width="3.5"/>
        </pattern>
      </defs>
      ${yLbls.map(g =>
        `<line x1="${L}" y1="${g.y}" x2="${W-R}" y2="${g.y}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`
      ).join('')}
      ${bars}
      <line x1="${L}" y1="${T+cH}" x2="${W-R}" y2="${T+cH}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>
      ${yLbls.map(g =>
        `<text x="${W-R+8}" y="${g.y+4}" class="wx-chart-axis-label">${g.v}%</text>`
      ).join('')}
      ${xTicks}
    </svg>`;
  }

  // ── Today detail interactivity ────────────────────────────────────────────

  _initTodayDetailEvents(card, day, current, hourly) {
    this._attachChartInteractivity(card);

    const ddClose = () => {
      const dd  = card.querySelector('.wx-td-metric-dropdown');
      const rel = card.querySelector('.wx-td-metric-rel');
      if (!dd || !dd.classList.contains('dd-open')) return;
      dd.classList.remove('dd-open');
      dd.classList.add('dd-closing');
      rel?.classList.remove('dd-open');
      const done = () => { dd.classList.remove('dd-closing'); dd.removeEventListener('transitionend', done); };
      dd.addEventListener('transitionend', done);
    };

    const ddOpen = () => {
      const dd  = card.querySelector('.wx-td-metric-dropdown');
      const rel = card.querySelector('.wx-td-metric-rel');
      if (!dd) return;
      dd.classList.remove('dd-closing');
      dd.classList.add('dd-open');
      rel?.classList.add('dd-open');
    };

    card.addEventListener('click', e => {
      if (e.target.dataset.action === 'close') {
        const modal = document.getElementById('modal-overlay');
        document.body.classList.remove('modal-open');
        modal?.classList.remove('open');
        card.classList.remove('wx-today-card');
        return;
      }

      // Toggle dropdown open/close
      if (e.target.closest('[data-action="toggle-metric"]')) {
        const dd = card.querySelector('.wx-td-metric-dropdown');
        if (dd?.classList.contains('dd-open')) ddClose(); else ddOpen();
        e.stopPropagation();
        return;
      }

      // Close dropdown on outside click
      const dd = card.querySelector('.wx-td-metric-dropdown');
      if (dd?.classList.contains('dd-open') && !e.target.closest('.wx-td-metric-dropdown')) {
        ddClose();
      }

      // Select metric from dropdown item
      const metricOpt = e.target.closest('.wx-td-metric-opt');
      if (metricOpt) {
        ddClose();
        this._switchMetric(card, metricOpt.dataset.metric, day, current, hourly);
        return;
      }

      // Select metric by tapping a stat box
      const statBox = e.target.closest('.wx-modal-stat[data-metric]');
      if (statBox) {
        ddClose();
        this._switchMetric(card, statBox.dataset.metric, day, current, hourly);
      }
    });
  }

  _switchMetric(card, metric, day, current, hourly) {
    this._currentMetric = metric;
    const m = this._getMetrics().find(x => x.key === metric);

    // Dropdown checkmarks
    card.querySelectorAll('.wx-td-metric-opt').forEach(opt => {
      const active = opt.dataset.metric === metric;
      opt.classList.toggle('active', active);
      const check = opt.querySelector('.wx-td-opt-check');
      if (check) check.textContent = active ? '✓' : '';
    });

    // Stat box highlights
    card.querySelectorAll('.wx-modal-stat[data-metric]').forEach(s => {
      s.classList.toggle('active', s.dataset.metric === metric);
    });

    // Topbar title
    const ti = card.querySelector('[data-role="metric-title"] .wx-td-title-icon');
    const tl = card.querySelector('[data-role="metric-title"] .wx-td-title-label');
    if (ti && m) ti.innerHTML  = m.icon;
    if (tl && m) tl.textContent = m.label;

    // Button icon
    const bi = card.querySelector('.wx-metric-btn-icon');
    if (bi && m) bi.innerHTML = m.icon;

    // Chart
    const wrap = card.querySelector('.wx-td-chart-wrap');
    if (!wrap) return;
    wrap.dataset.metric = metric;

    if      (metric === 'conditions') wrap.innerHTML = this._buildTempChart(day, current, hourly, 'actual');
    else if (metric === 'uvi')        wrap.innerHTML = this._buildUVChart(hourly, current);
    else if (metric === 'wind')       wrap.innerHTML = this._buildWindChart(hourly, current);
    else if (metric === 'rain')       wrap.innerHTML = this._buildPrecipChart(hourly, current);
    else if (metric === 'humidity')   wrap.innerHTML = this._buildHumidityChart(hourly, current);
    else if (metric === 'visibility') wrap.innerHTML = this._buildVisibilityChart(hourly, current);
    else if (metric === 'pressure')   wrap.innerHTML = this._buildPressureChart(hourly, current);

    this._attachChartInteractivity(card);
  }

  // ── Generic hourly area chart ─────────────────────────────────────────────

  _buildGenericChart(hourly, getter, formatVal, gradStops, strokeColor, current, tickCount = 5, zeroBase = true) {
    const W=600, H=220, L=10, R=52, T=40, B=44;
    const cW = W - L - R, cH = H - T - B;

    const tzOffsetSec = current?.tz_offset || 0;
    const nowLocal    = new Date(Date.now() + tzOffsetSec * 1000);
    const curH        = nowLocal.getUTCHours();
    const limit       = Math.min(hourly.length, 25);

    const vals   = hourly.slice(0, limit).map(getter);
    const rawMax = Math.max(...vals, 0.1);
    const rawMin = zeroBase ? Math.min(...vals, 0) : Math.min(...vals);
    const pad    = (rawMax - rawMin) * 0.15 || 1;
    const vMin   = rawMin - pad, vMax = rawMax + pad * 1.5, vRange = vMax - vMin;

    const xD = i => L + (i / 24) * cW;
    const yV = v => T + cH - ((v - vMin) / vRange) * cH;

    const pts = vals.map((v, i) => ({ x: xD(i), y: yV(v), v }));

    const bezier = (xy) => {
      if (xy.length < 2) return '';
      let d = `M${xy[0].x},${xy[0].y}`;
      for (let i = 1; i < xy.length; i++) {
        const [p, n] = [xy[i-1], xy[i]];
        const t = 0.38;
        d += ` C${p.x+(n.x-p.x)*t},${p.y} ${n.x-(n.x-p.x)*t},${n.y} ${n.x},${n.y}`;
      }
      return d;
    };

    const linePath = bezier(pts);
    const areaPath = `${linePath} L${pts[pts.length-1].x},${T+cH} L${pts[0].x},${T+cH} Z`;

    const vStep  = this._niceStep((vMax - vMin) / tickCount);
    const vStart = Math.ceil(vMin / vStep) * vStep;
    const yGrids = [];
    for (let v = vStart; v <= vMax + 0.01; v += vStep) {
      const y = yV(v);
      if (y > T - 8 && y < T + cH + 8) yGrids.push({ v: Math.round(v * 10) / 10, y });
    }
    const xTicks = [0, 6, 12, 18].map(off => {
      const label = off === 0 ? 'Now' : `${String((curH + off) % 24).padStart(2,'0')}`;
      return `<text x="${xD(off).toFixed(1)}" y="${T+cH+22}" text-anchor="middle" class="wx-chart-axis-label">${label}</text>`;
    }).join('');

    this._pendingPoints = pts.map((p, i) => ({
      svgX: p.x, svgY: p.y, val: p.v,
      timeLabel: `${String((curH + i) % 24).padStart(2,'0')}:00`,
      formatVal,
    }));

    return `<svg viewBox="0 0 ${W} ${H}" class="wx-td-svg">
      <defs>
        <linearGradient id="genGrad" x1="0" y1="0" x2="0" y2="1">
          ${gradStops}
        </linearGradient>
      </defs>
      ${yGrids.map(g => `<line x1="${L}" y1="${g.y}" x2="${W-R}" y2="${g.y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`).join('')}
      <path d="${areaPath}" fill="url(#genGrad)"/>
      <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round"/>
      <line x1="${L}" y1="${T+cH}" x2="${W-R}" y2="${T+cH}" stroke="rgba(255,255,255,0.13)" stroke-width="1"/>
      ${yGrids.map(g => `<text x="${W-R+8}" y="${g.y+4}" class="wx-chart-axis-label">${g.v}</text>`).join('')}
      ${xTicks}
    </svg>`;
  }

  _buildHumidityChart(hourly, current) {
    return this._buildGenericChart(
      hourly, h => h.humidity || 0, v => `${Math.round(v)}%`,
      `<stop offset="0%" stop-color="rgba(0,140,255,0.85)"/>
       <stop offset="100%" stop-color="rgba(0,80,200,0.25)"/>`,
      '#4db8ff', current
    );
  }

  _buildWindChart(hourly, current) {
    const unit = current.units === 'imperial' ? 'mph' : 'm/s';
    return this._buildGenericChart(
      hourly, h => h.wind_speed || 0, v => `${v.toFixed(1)} ${unit}`,
      `<stop offset="0%" stop-color="rgba(180,180,220,0.75)"/>
       <stop offset="100%" stop-color="rgba(100,100,160,0.2)"/>`,
      '#c8c8e8', current
    );
  }

  _buildVisibilityChart(hourly, current) {
    return this._buildGenericChart(
      hourly, h => h.visibility ?? 10, v => `${v.toFixed(1)} km`,
      `<stop offset="0%" stop-color="rgba(100,210,255,0.8)"/>
       <stop offset="100%" stop-color="rgba(50,150,220,0.2)"/>`,
      '#64d2ff', current
    );
  }

  _buildPressureChart(hourly, current) {
    return this._buildGenericChart(
      hourly, h => h.pressure || 1013, v => `${Math.round(v)} hPa`,
      `<stop offset="0%" stop-color="rgba(200,140,255,0.75)"/>
       <stop offset="100%" stop-color="rgba(130,70,220,0.2)"/>`,
      '#d4a0ff', current, 3, false
    );
  }

  // ── Chart touch interactivity ─────────────────────────────────────────────

  _attachChartInteractivity(card) {
    const wrap = card.querySelector('.wx-td-chart-wrap');
    if (!wrap) return;
    const svg = wrap.querySelector('svg');
    if (!svg) return;
    const points = this._pendingPoints;
    if (!points || !points.length) return;

    const ns = 'http://www.w3.org/2000/svg';
    const W = 600;

    // Parse viewBox to get chart geometry
    const vb  = (svg.getAttribute('viewBox') || '0 0 600 220').split(' ').map(Number);
    const svgH = vb[3];
    const L = 10, T = 40, B = 44, R = 52;
    const cH = svgH - T - B;

    const cursor = document.createElementNS(ns, 'line');
    cursor.setAttribute('y1', T); cursor.setAttribute('y2', T + cH);
    cursor.setAttribute('stroke', 'rgba(255,255,255,0.65)');
    cursor.setAttribute('stroke-width', '1.5');
    cursor.style.display = 'none';
    svg.appendChild(cursor);

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '5'); dot.setAttribute('fill', '#fff');
    dot.setAttribute('stroke', 'rgba(0,0,0,0.4)'); dot.setAttribute('stroke-width', '2.5');
    dot.style.display = 'none';
    svg.appendChild(dot);

    wrap.style.position = 'relative';
    
    let htmlTip = wrap.querySelector('.wx-chart-html-tip');
    if (!htmlTip) {
      htmlTip = document.createElement('div');
      htmlTip.className = 'wx-chart-html-tip';
      htmlTip.style.cssText = `
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -100%);
        opacity: 0;
        transition: opacity 0.2s, top 0.05s linear, left 0.05s linear;
        z-index: 10;
      `;
      wrap.appendChild(htmlTip);
    }
    
    const tipValHtml = document.createElement('div');
    tipValHtml.style.cssText = 'font-size: 15px; font-weight: 600; font-family: SFPro, -apple-system, sans-serif; white-space: nowrap;';
    const tipTimeHtml = document.createElement('div');
    tipTimeHtml.style.cssText = 'font-size: 11px; color: rgba(255,255,255,0.6); font-family: SFPro, -apple-system, sans-serif; margin-top: 1px; white-space: nowrap;';
    htmlTip.innerHTML = '';
    htmlTip.append(tipValHtml, tipTimeHtml);

    const overlay = document.createElementNS(ns, 'rect');
    overlay.setAttribute('x', L); overlay.setAttribute('y', T);
    overlay.setAttribute('width', W - L - R); overlay.setAttribute('height', cH);
    overlay.setAttribute('fill', 'transparent');
    overlay.style.touchAction = 'none'; // Prevents page scrolling when touching graph
    svg.appendChild(overlay);

    const show = (clientX) => {
      const rect   = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const svgX   = (clientX - rect.left) * (W / rect.width);
      const pt     = points.reduce((b, p) => Math.abs(p.svgX - svgX) < Math.abs(b.svgX - svgX) ? p : b);
      const valStr  = pt.formatVal(pt.val);
      const timeStr = pt.timeLabel;

      cursor.setAttribute('x1', pt.svgX); cursor.setAttribute('x2', pt.svgX);
      cursor.style.display = '';
      dot.setAttribute('cx', pt.svgX); dot.setAttribute('cy', pt.svgY);
      dot.style.display = '';

      // Calculate DOM coordinates relative to wrap
      const domX = (pt.svgX / W) * rect.width + (rect.left - wrapRect.left);
      const domY = (pt.svgY / svgH) * rect.height + (rect.top - wrapRect.top);

      htmlTip.style.left = `${domX}px`;
      htmlTip.style.top  = `${domY - 14}px`;
      
      tipValHtml.textContent = valStr;
      tipTimeHtml.textContent = timeStr;
      htmlTip.style.opacity = '1';
      htmlTip.classList.add('active');
    };

    const hide = () => { 
      cursor.style.display = 'none'; 
      dot.style.display = 'none'; 
      htmlTip.style.opacity = '0'; 
      htmlTip.classList.remove('active');
    };

    let isScrubbing = false;
    overlay.addEventListener('pointerdown', e => { 
      isScrubbing = true;
      overlay.setPointerCapture(e.pointerId); 
      show(e.clientX); 
      e.stopPropagation(); 
    });
    overlay.addEventListener('pointermove', e => { 
      if (isScrubbing) show(e.clientX); 
      e.stopPropagation(); 
    });
    const stopScrubbing = e => { 
      isScrubbing = false; 
      hide(); 
      if (e) e.stopPropagation(); 
    };
    overlay.addEventListener('pointerup', stopScrubbing);
    overlay.addEventListener('pointerleave', stopScrubbing);
    overlay.addEventListener('pointercancel', stopScrubbing);
  }

  // ── Forecast (non-today) detail panel ─────────────────────────────────────

  _buildForecastDetail(day, current) {
    const deg    = current.units === 'imperial' ? '°F' : '°';
    const unit   = current.units === 'imperial' ? 'mph' : 'm/s';
    const uviVal = day.uvi != null ? parseFloat(day.uvi).toFixed(1) : '-';
    return `
      <div class="wx-modal-content">
        <div class="wx-modal-header">
          ${wxIcon(day.icon, 'lg')}
          <div class="wx-modal-title-group">
            <div class="wx-modal-day">${this._esc(day.day)} <span class="wx-modal-date">${this._esc(day.date)}</span></div>
            <div class="wx-modal-desc">${this._esc(day.description)}</div>
          </div>
        </div>
        <div class="wx-modal-temps">
          <div class="wx-modal-temp-item"><span class="label">High</span><span class="value">${day.temp_max}${deg}</span></div>
          <div class="wx-modal-temp-item"><span class="label">Low</span><span class="value">${day.temp_min}${deg}</span></div>
        </div>
        <div class="wx-modal-grid">
          <div class="wx-modal-stat"><img src="/icons/weather/wi-thermometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Feels Like</span><span class="value">${day.feels_like}${deg}</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-humidity.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Humidity</span><span class="value">${day.humidity}%</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-strong-wind.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Wind</span><span class="value">${day.wind_speed} <small>${unit}</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-barometer.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Pressure</span><span class="value">${day.pressure} <small>hPa</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-cloud.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Clouds</span><span class="value">${day.clouds}%</span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-raindrops.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">Precip.</span><span class="value">${day.rain} <small>mm</small></span></div></div>
          <div class="wx-modal-stat"><img src="/icons/weather/wi-day-sunny.png" class="wx-ico ico-xs"><div class="stat-info"><span class="label">UV Index</span><span class="value">${uviVal}</span></div></div>
        </div>
      </div>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _niceStep(rough) {
    return [1,2,3,5,10,15,20].find(s => s >= rough) ?? 20;
  }

  _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['weather'] = WeatherWidget;
