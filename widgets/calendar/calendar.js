class CalendarWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this.events = [];
    this._showSkeleton();
    this._initEvents();
  }

  _initEvents() {
    const el = this.el;
    let active = false, startX = 0, startY = 0, scrollTop = 0;
    let velY = 0, lastY = 0, lastT = 0, rafId = null;
    let hasMoved = false;
    let targetRow = null;
    let touchX = 0, touchY = 0;
    let snapRafId = null;

    const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };
    const stopSnap = () => { if (snapRafId) { cancelAnimationFrame(snapRafId); snapRafId = null; } };

    const updateDateCols = () => {
      const containerTop = el.getBoundingClientRect().top;
      el.querySelectorAll('.cal-day-group').forEach(g => {
        const dateCol = g.querySelector('.cal-date-col');
        if (!dateCol) return;
        const gRect = g.getBoundingClientRect();
        const scrolledPast = containerTop - gRect.top;

        // Clear previous no-sep marker in this group
        g.querySelectorAll('.cal-event-row.no-sep').forEach(r => r.classList.remove('no-sep'));

        if (scrolledPast <= 0) { dateCol.style.transform = ''; return; }

        // Max translation: date col center aligns with last event row center
        const lastRow = g.querySelector('.cal-event-row:last-child');
        let max;
        if (lastRow) {
          const lrRect = lastRow.getBoundingClientRect();
          max = Math.max(0, (lrRect.top + lrRect.height / 2) - gRect.top - dateCol.offsetHeight / 2);
        } else {
          max = Math.max(0, gRect.height - dateCol.offsetHeight);
        }

        dateCol.style.transform = `translateY(${Math.min(scrolledPast, max)}px)`;

        // Hide the top separator of the first event row at the widget's top edge
        const rows = [...g.querySelectorAll('.cal-event-row')];
        const firstVisible = rows.find(r => r.getBoundingClientRect().top >= containerTop - 1);
        if (firstVisible) firstVisible.classList.add('no-sep');
      });
    };

    const snapToRow = () => {
      const containerTop = el.getBoundingClientRect().top;
      const st = el.scrollTop;
      const targets = [];
      el.querySelectorAll('.cal-day-group').forEach(g => {
        targets.push(st + g.getBoundingClientRect().top - containerTop);
        g.querySelectorAll('.cal-event-row').forEach((row, i) => {
          if (i === 0) return;
          targets.push(st + row.getBoundingClientRect().top - containerTop);
        });
      });
      if (!targets.length) return;
      const target = targets.reduce((best, t) => Math.abs(t - st) < Math.abs(best - st) ? t : best, targets[0]);
      if (Math.abs(target - st) < 1) return;
      const from = st, delta = target - from;
      const duration = Math.min(250, Math.abs(delta) * 0.8);
      const t0 = performance.now();
      const easeOut = t => 1 - (1 - t) ** 3;
      const animate = now => {
        const t = Math.min(1, (now - t0) / duration);
        el.scrollTop = from + delta * easeOut(t);
        updateDateCols();
        snapRafId = t < 1 ? requestAnimationFrame(animate) : null;
      };
      snapRafId = requestAnimationFrame(animate);
    };

    const coast = () => {
      velY *= 0.90;
      el.scrollTop -= velY * 16;
      updateDateCols();
      if (Math.abs(velY) > 0.15) rafId = requestAnimationFrame(coast);
      else { rafId = null; snapToRow(); }
    };

    el.addEventListener('pointerdown', e => {
      stop(); stopSnap();
      active = true;
      hasMoved = false;
      targetRow = e.target.closest('.cal-event-row');
      startX = touchX = e.clientX;
      startY = lastY = touchY = e.clientY;
      scrollTop = el.scrollTop;
      lastT = Date.now(); velY = 0;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', e => {
      if (!active) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > 10 || dy > 10) hasMoved = true;

      const now = Date.now(), dt = now - lastT || 1;
      velY = (lastY - e.clientY) / dt;
      lastY = e.clientY; lastT = now;
      el.scrollTop = scrollTop + (startY - e.clientY);
      updateDateCols();
    });

    el.addEventListener('pointerup', e => {
      if (!active) return;
      active = false;
      el.releasePointerCapture(e.pointerId);

      if (!hasMoved && targetRow) {
        // It's a tap!
        const id = targetRow.dataset.id;
        const event = this.events.find(ev => ev.id === id);
        if (event) this._showEventDetail(event, touchX, touchY);
      } else if (Math.abs(velY) > 0.2) {
        rafId = requestAnimationFrame(coast);
      } else {
        snapToRow();
      }
      targetRow = null;
    });

    el.addEventListener('pointercancel', e => {
      active = false;
      velY = 0;
      el.releasePointerCapture(e.pointerId);
    });
  }

  _showEventDetail(e, x, y) {
    const modal = document.getElementById('modal-overlay');
    const card = document.getElementById('modal-card');
    if (!modal || !card) return;

    // Set animation origin relative to screen center
    if (x !== undefined && y !== undefined) {
      const vx = (x - window.innerWidth / 2);
      const vy = (y - window.innerHeight / 2);
      card.style.setProperty('--origin-x', `${vx}px`);
      card.style.setProperty('--origin-y', `${vy}px`);
    }

    const isRtl = e.is_hebrew;
    const rtlClass = isRtl ? ' rtl' : '';
    const timeStr = e.all_day ? 'All Day' : this._timeRange(e.start, e.end);
    const dateStr = this._dateInfo(e.start).num + ' ' + this._dateInfo(e.start).day;

    card.innerHTML = `
      <div class="cal-modal-content${rtlClass}">
        <div class="cal-modal-header">
          <div class="cal-modal-color" style="background:${e.color}"></div>
          <div class="cal-modal-title">${this._esc(e.title)}</div>
        </div>
        <div class="cal-modal-meta">
          <div class="cal-modal-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            <span>${this._esc(e.calendar_name)}</span>
          </div>
          <div class="cal-modal-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            <span>${dateStr}</span>
          </div>
          <div class="cal-modal-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${timeStr}</span>
          </div>
          ${e.location ? `
          <div class="cal-modal-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${this._esc(e.location)}</span>
          </div>` : ''}
        </div>
        ${e.description ? `<div class="cal-modal-description">${this._esc(e.description).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
    `;

    document.body.classList.add('modal-open');
    modal.classList.add('open');

    const close = (evt) => {
      if (evt.target === modal || (evt.type === 'keydown' && evt.key === 'Escape')) {
        document.body.classList.remove('modal-open');
        modal.classList.remove('open');
        window.removeEventListener('keydown', close);
        modal.removeEventListener('click', close);
      }
    };
    // Use timeout to avoid immediate closure if the click bubbles
    setTimeout(() => {
        modal.addEventListener('click', close);
        window.addEventListener('keydown', close);
    }, 10);
  }

  _showSkeleton() {
    this.el.innerHTML = `
      <div class="widget-skeleton-calendar">
        ${[1,2,3,4].map(() => '<div class="skeleton-block sk-row"></div>').join('')}
      </div>`;
  }

  render(data) {
    this.events = data.events || [];
    if (!this.events.length) {
      this.el.innerHTML = `<div class="cal-empty">No upcoming events</div>`;
      return;
    }
    // Group by start date — no fake entries for intermediate days
    const byDay = new Map();
    for (const e of this.events) {
      const key = (e.start || '').slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    this.el.innerHTML = sorted.map(([date, group]) => this._dayHTML(date, group)).join('');
    this._initMarquees();
  }

  // Phase 3a: Differential update — patch text content if structure unchanged
  update(data) {
    const newEvents = data.events || [];
    // If event list structure changed (different IDs or count), full re-render
    const oldIds = this.events.map(e => e.id).join(',');
    const newIds = newEvents.map(e => e.id).join(',');
    if (oldIds !== newIds) {
      this.render(data);
      return;
    }
    // Structure same — patch mutable fields in-place
    this.events = newEvents;
    for (const e of newEvents) {
      const row = this.el.querySelector(`.cal-event-row[data-id="${e.id}"]`);
      if (!row) continue;
      const titleEl = row.querySelector('.cal-title span');
      if (titleEl) titleEl.textContent = e.title;
      const timePart = row.querySelector('.cal-time-part');
      if (timePart) timePart.textContent = e.all_day ? 'All Day' : this._timeRange(e.start, e.end);
    }
  }

  _initMarquees() {
    setTimeout(() => {
      // Batch all reads first, then all writes — avoids layout thrash per element
      const overflows = [];
      this.el.querySelectorAll('.cal-title, .cal-loc-part').forEach(el => {
        const span = el.querySelector('span');
        if (!span) return;
        const diff = span.offsetWidth - el.offsetWidth;
        if (diff > 0) overflows.push({ el, span, diff });
      });
      for (const { el, span, diff } of overflows) {
        const isRtl = el.classList.contains('rtl') || el.closest('.rtl');
        const dur = Math.max(3, diff / 25);
        el.classList.add('marquee');
        span.style.setProperty('--dist', `-${diff}px`);
        span.style.setProperty('--dur', `${dur}s`);
        span.classList.add(isRtl ? 'animate-marquee-rtl' : 'animate-marquee-ltr');
      }
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
      return `<div class="cal-event-row${isMulti ? ' cal-event-multi' : ''}" data-id="${e.id}">
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
