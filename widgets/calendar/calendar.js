class CalendarWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._showSkeleton();
  }

  _showSkeleton() {
    this.el.innerHTML = `
      <div class="widget-skeleton-calendar">
        ${[1,2,3,4].map(() => '<div class="skeleton-block sk-row"></div>').join('')}
      </div>`;
  }

  render(data) {
    const events = data.events || [];
    if (!events.length) {
      this.el.innerHTML = `<div class="cal-empty">No upcoming events</div>`;
      return;
    }
    // Group by start date — no fake entries for intermediate days
    const byDay = new Map();
    for (const e of events) {
      const key = (e.start || '').slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    this.el.innerHTML = sorted.map(([date, group]) => this._dayHTML(date, group)).join('');
    this._initMarquees();
    this._initScroll();
  }

  _initScroll() {
    const el = this.el;
    let active = false, startY = 0, scrollTop = 0;
    let velY = 0, lastY = 0, lastT = 0, rafId = null;
    const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };
    const coast = () => {
      velY *= 0.90;
      el.scrollTop -= velY * 16;
      if (Math.abs(velY) > 0.15) rafId = requestAnimationFrame(coast);
      else rafId = null;
    };
    el.addEventListener('pointerdown', e => {
      stop();
      active = true;
      startY = lastY = e.clientY;
      scrollTop = el.scrollTop;
      lastT = Date.now(); velY = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', e => {
      if (!active) return;
      const now = Date.now(), dt = now - lastT || 1;
      velY = (lastY - e.clientY) / dt;
      lastY = e.clientY; lastT = now;
      el.scrollTop = scrollTop + (startY - e.clientY);
    });
    el.addEventListener('pointerup', () => {
      active = false;
      if (Math.abs(velY) > 0.2) rafId = requestAnimationFrame(coast);
    });
    el.addEventListener('pointercancel', () => { active = false; velY = 0; });
  }

  _initMarquees() {
    // Wait for layout to settle before measuring widths
    setTimeout(() => {
      this.el.querySelectorAll('.cal-title, .cal-loc-part').forEach(el => {
        const span = el.querySelector('span');
        if (!span) return;
        const diff = span.offsetWidth - el.offsetWidth;
        if (diff > 0) {
          const isRtl = el.classList.contains('rtl') || el.closest('.rtl');
          el.classList.add('marquee');
          const dur = Math.max(3, diff / 25); // Speed: 25px/s
          span.style.setProperty('--dist', `-${diff}px`);
          span.style.setProperty('--dur', `${dur}s`);
          span.classList.add(isRtl ? 'animate-marquee-rtl' : 'animate-marquee-ltr');
        }
      });
    }, 120);
  }

  _dayHTML(date, group) {
    const dateInfo = this._dateInfo(date);

    // If the first all-day event spans multiple days, show the range in the date column
    const firstMulti = group.find(e => e.all_day && this._spanDays(e).length > 1);
    const dateNum = firstMulti
      ? this._rangeStr(this._spanDays(firstMulti)[0],
          this._spanDays(firstMulti)[this._spanDays(firstMulti).length - 1])
      : dateInfo.num;

    const eventsHTML = group.map(e => {
      const isMulti  = e.all_day && this._spanDays(e).length > 1;
      const timeStr  = e.all_day ? 'All Day' : this._timeRange(e.start, e.end);
      const locRaw   = e.location && String(e.location).trim();
      const rtlClass = e.is_hebrew ? ' rtl' : '';
      const lang     = e.is_hebrew ? ' lang="he"' : '';
      const locRtl   = locRaw && this._isHebrew(locRaw) ? ' rtl' : '';
      const locHTML  = locRaw
        ? `<span class="cal-meta-sep"> | </span><span class="cal-loc-part${locRtl}"><span>${this._esc(locRaw)}</span></span>`
        : '';
      return `<div class="cal-event-row${isMulti ? ' cal-event-multi' : ''}">
        <div class="cal-border" style="background:${e.color}"></div>
        <div class="cal-event-content">
          <div class="cal-title${rtlClass}"${lang}><span>${this._esc(e.title)}</span></div>
          <div class="cal-meta"><span class="cal-time-part">${timeStr}</span>${locHTML}</div>
        </div>
      </div>`;
    }).join('');

    return `<div class="cal-day-group${firstMulti ? ' cal-day-multi' : ''}">
      <div class="cal-date-col">
        <div class="cal-date-num${firstMulti ? ' cal-date-range' : ''}">${dateNum}</div>
        <div class="cal-date-day">${dateInfo.day}</div>
      </div>
      <div class="cal-events-col">${eventsHTML}</div>
    </div>`;
  }

  // Returns all ISO dates covered by the event (inclusive, all-day end is exclusive in Google)
  _spanDays(e) {
    const start = (e.start || '').slice(0, 10);
    if (!e.all_day || !e.end) return [start];
    const endD = new Date((e.end || '').slice(0, 10) + 'T12:00:00');
    endD.setDate(endD.getDate() - 1); // Google end is exclusive → make inclusive
    const days = [], cur = new Date(start + 'T12:00:00');
    while (cur <= endD && days.length < 60) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  _rangeStr(s, end) {
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d1 = new Date(s   + 'T12:00:00');
    const d2 = new Date(end + 'T12:00:00');
    return d1.getMonth() === d2.getMonth()
      ? `${d1.getDate()}–${d2.getDate()} ${mo[d1.getMonth()]}`
      : `${d1.getDate()} ${mo[d1.getMonth()]} – ${d2.getDate()} ${mo[d2.getMonth()]}`;
  }

  _isHebrew(s) {
    return /[\u0590-\u05FF]/.test(String(s));
  }

  _dateInfo(isoStart) {
    // Accept "YYYY-MM-DD" or full ISO; force noon to avoid DST shifts
    const s = isoStart.length === 10 ? isoStart + 'T12:00:00' : isoStart;
    const d = new Date(s);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return {
      num: `${d.getDate()} ${months[d.getMonth()]}`,
      day: days[d.getDay()],
    };
  }

  _timeRange(start, end) {
    const fmt = iso => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    return end ? `${fmt(start)} - ${fmt(end)}` : fmt(start);
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['calendar'] = CalendarWidget;
