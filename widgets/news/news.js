class NewsWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._articleTimer = null;
    this._articleIdx   = 0;
    this._articleData  = [];
    this._lastData     = null;
    this._lastMode     = null;
    this._popupFontSize = 15;
    this._trackObserver = null;

    new ResizeObserver(() => {
      if (!this._lastData) return;
      const mode = this._getMode();
      if (mode !== this._lastMode) {
        this.render(this._lastData);
      }
    }).observe(this.el);
  }

  _getMode() {
    const h = this.el.clientHeight;
    const twoRows = window.innerHeight / 12; // 2 of 24 grid rows
    return h <= twoRows ? 'wide' : 'article';
  }

  _isRTL(text) {
    const rtlChars = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
    return rtlChars.test(text);
  }

  render(data) {
    const headlines = data?.headlines || [];
    if (!headlines.length) { this.el.innerHTML = ''; return; }
    if (this._articleTimer) { clearInterval(this._articleTimer); this._articleTimer = null; }

    const isRtl = headlines.some(h => this._isRTL(h.title));
    this.el.classList.toggle('rtl', isRtl);

    this._lastData = data;
    const mode = this._getMode();
    this._lastMode = mode;

    if (mode === 'article') this._renderArticle(headlines);
    else this._renderWide(headlines);
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Wide mode ────────────────────────────────────────────────────────────────
  _renderWide(headlines) {
    if (!headlines || !headlines.length) return;

    // Repeat short lists so we always have enough items to exceed viewport width
    let displayHeadlines = [...headlines];
    while (displayHeadlines.length < 8) {
      displayHeadlines = displayHeadlines.concat(headlines);
    }

    const items = displayHeadlines.map((h, i) => {
      const src = h.source ? `<span class="news-wide-src">${this._esc(h.source)}</span>` : '';
      const originalIdx = i % headlines.length;
      return `
        <div class="news-wide-item" data-idx="${originalIdx}">
          ${src}
          <span class="news-wide-title">${this._esc(h.title)}</span>
        </div>`;
    }).join('<span class="news-wide-sep"></span>');

    this.el.innerHTML = `
      <div class="news-wide-outer">
        <div class="news-wide-track" id="news-wide-track">
          ${items}<span class="news-wide-sep"></span>${items}<span class="news-wide-sep"></span>
        </div>
      </div>`;

    if (this._trackObserver) {
      this._trackObserver.disconnect();
      this._trackObserver = null;
    }

    const track = this.el.querySelector('#news-wide-track');
    if (track) {
      // Use ResizeObserver on the track itself to ensure correct duration calculation
      // when container size adjusts, fonts load, or styles apply.
      this._trackObserver = new ResizeObserver(() => {
        const speed = 70; // 70 pixels per second constant speed
        const scrollW = track.scrollWidth;
        if (scrollW > 0) {
          track.style.animationDuration = `${(scrollW / 2) / speed}s`;
        }
      });
      this._trackObserver.observe(track);

      track.addEventListener('click', e => {
        const item = e.target.closest('.news-wide-item');
        if (!item) return;
        const idx = parseInt(item.dataset.idx, 10);
        if (!isNaN(idx)) this._openPopup(headlines, idx);
      });
    }
  }

  // ── Article mode ──────────────────────────────────────────────────────────────
  _renderArticle(headlines) {
    this._articleData = headlines;
    this._articleIdx  = 0;
    this.el.innerHTML = `
      <div class="news-article-card" id="news-article">
        <div class="news-article-header">
          <div class="news-article-src"  id="na-src"></div>
          <div class="news-article-date" id="na-date"></div>
        </div>
        <div class="news-article-title" id="na-title"></div>
        <div class="news-article-desc"  id="na-desc"></div>
        <div class="news-article-dots"  id="na-dots"></div>
      </div>`;
    this._showArticle(0);

    const startTimer = () => {
      clearInterval(this._articleTimer);
      this._articleTimer = setInterval(() => {
        this._articleIdx = (this._articleIdx + 1) % headlines.length;
        this._showArticle(this._articleIdx);
      }, 30000);
    };
    startTimer();

    const card = document.getElementById('news-article');
    let startX = 0;
    card.style.touchAction = 'pan-y'; // Prevent browser swipe gestures from interfering
    
    card.addEventListener('pointerdown', e => { 
      startX = e.clientX; 
      try { card.setPointerCapture(e.pointerId); } catch(err) {}
    });
    
    const handleUp = e => {
      try { card.releasePointerCapture(e.pointerId); } catch(err) {}
      const dx = e.clientX - startX;
      if (Math.abs(dx) < 40) {
        this._openPopup(this._articleData, this._articleIdx);
        return;
      }
      const n = headlines.length;
      this._articleIdx = (this._articleIdx + (dx < 0 ? 1 : -1) + n) % n;
      this._showArticle(this._articleIdx);
      startTimer();
    };
    
    card.addEventListener('pointerup', handleUp);
    card.addEventListener('pointercancel', e => {
      try { card.releasePointerCapture(e.pointerId); } catch(err) {}
    });
  }

  _showArticle(idx) {
    const card = document.getElementById('news-article');
    if (!card) return;
    card.style.opacity    = '0';
    card.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      const h = this._articleData[idx];
      const isRtl = this._isRTL(h.title || '');
      card.dir = isRtl ? 'rtl' : 'ltr';
      card.classList.toggle('rtl', isRtl);

      document.getElementById('na-src').textContent   = h.source || '';
      document.getElementById('na-title').textContent = h.title  || '';
      document.getElementById('na-desc').textContent  = h.desc   || '';
      const dateEl = document.getElementById('na-date');
      if (dateEl) dateEl.textContent = h.date ? this._formatDate(h.date) : '';
      const n    = this._articleData.length;
      const dots = document.getElementById('na-dots');
      if (dots) dots.innerHTML = Array.from({length: n}, (_, i) =>
        `<span class="na-dot${i === idx ? ' active' : ''}"></span>`).join('');
      card.style.opacity = '1';
    }, 500);
  }

  // ── Article popup reader ───────────────────────────────────────────────────────
  _openPopup(headlines, startIdx) {
    let idx = startIdx;
    let fontSize = this._popupFontSize;

    const overlay = document.createElement('div');
    overlay.className = 'news-popup-overlay';

    const popupCard = document.createElement('div');
    popupCard.className = 'news-popup-card';

    const navEl = document.createElement('div');
    navEl.className = 'news-popup-nav';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'news-popup-nav-btn';
    prevBtn.innerHTML = `<svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 1.5 2 8l6.5 6.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const nextBtn = document.createElement('button');
    nextBtn.className = 'news-popup-nav-btn';
    nextBtn.innerHTML = `<svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5 8 8l-6.5 6.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    navEl.append(nextBtn, prevBtn);
    popupCard.appendChild(navEl);

    // Scrollable content
    const content = document.createElement('div');
    content.className = 'news-popup-content';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'news-popup-img';
    const img = document.createElement('img');
    img.alt = '';
    imgWrap.appendChild(img);
    content.appendChild(imgWrap);

    const body = document.createElement('div');
    body.className = 'news-popup-body';

    const headerRow = document.createElement('div');
    headerRow.className = 'news-popup-header';
    const srcEl  = document.createElement('div');
    srcEl.className  = 'news-popup-src';
    const dateEl = document.createElement('div');
    dateEl.className = 'news-popup-date';
    headerRow.append(srcEl, dateEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'news-popup-title';

    const descEl = document.createElement('div');
    descEl.className = 'news-popup-desc';

    body.append(headerRow, titleEl, descEl);
    content.appendChild(body);

    // Footer: dots + font size controls
    const footer = document.createElement('div');
    footer.className = 'news-popup-footer';

    const dotsEl = document.createElement('div');
    dotsEl.className = 'news-popup-dots';

    const sizeCtrl = document.createElement('div');
    sizeCtrl.className = 'news-popup-size';
    const minusBtn = document.createElement('button');
    minusBtn.className = 'news-popup-size-btn';
    minusBtn.textContent = '−';
    const plusBtn = document.createElement('button');
    plusBtn.className = 'news-popup-size-btn';
    plusBtn.textContent = '+';
    sizeCtrl.append(minusBtn, plusBtn);

    footer.append(dotsEl, sizeCtrl);
    popupCard.append(content, footer);
    overlay.appendChild(popupCard);
    document.body.appendChild(overlay);

    const applyFontSize = () => {
      body.style.setProperty('--popup-fs', `${fontSize}px`);
    };

    const showArticle = (i) => {
      const a = headlines[i];
      const isRtl = this._isRTL(a.title || '');
      popupCard.dir = isRtl ? 'rtl' : 'ltr';
      popupCard.classList.toggle('rtl', isRtl);

      if (a.urlToImage) {
        img.src = a.urlToImage;
        img.onerror = () => { imgWrap.style.display = 'none'; };
        imgWrap.style.display = '';
      } else {
        imgWrap.style.display = 'none';
      }

      srcEl.textContent  = a.source || '';
      dateEl.textContent = a.date ? this._formatDate(a.date) : '';
      titleEl.textContent = a.title || '';

      const bodyText = (a.content && a.content.length > (a.desc || '').length)
        ? a.content : (a.desc || '');
      descEl.textContent = bodyText;

      dotsEl.innerHTML = headlines.map((_, j) =>
        `<span class="news-popup-dot${j === i ? ' active' : ''}"></span>`
      ).join('');

      content.scrollTop = 0;
    };

    showArticle(idx);
    applyFontSize();
    requestAnimationFrame(() => overlay.classList.add('news-popup-in'));

    // Swipe left/right to navigate between articles
    let touchStartX = 0, touchStartY = 0;
    popupCard.addEventListener('touchstart', e => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    popupCard.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
        idx = (idx + (dx < 0 ? 1 : -1) + headlines.length) % headlines.length;
        showArticle(idx);
      }
    }, { passive: true });

    // Article navigation buttons
    prevBtn.addEventListener('click', e => {
      e.stopPropagation();
      idx = (idx + 1) % headlines.length;
      showArticle(idx);
    });
    nextBtn.addEventListener('click', e => {
      e.stopPropagation();
      idx = (idx - 1 + headlines.length) % headlines.length;
      showArticle(idx);
    });

    // Font size controls
    minusBtn.addEventListener('click', e => {
      e.stopPropagation();
      fontSize = Math.max(11, fontSize - 2);
      this._popupFontSize = fontSize;
      applyFontSize();
    });
    plusBtn.addEventListener('click', e => {
      e.stopPropagation();
      fontSize = Math.min(28, fontSize + 2);
      this._popupFontSize = fontSize;
      applyFontSize();
    });

    // Close on backdrop tap or Escape
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => {
      overlay.classList.remove('news-popup-in');
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
      document.removeEventListener('keydown', onKey);
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['news'] = NewsWidget;
