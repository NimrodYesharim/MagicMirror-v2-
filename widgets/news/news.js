class NewsWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._articleTimer = null;
    this._articleIdx   = 0;
    this._articleData  = [];
    this._lastData     = null;
    this._lastMode     = null;

    new ResizeObserver(() => {
      if (!this._lastData) return;
      const mode = this._getMode();
      if (mode !== this._lastMode) this.render(this._lastData);
    }).observe(this.el);
  }

  _getMode() {
    const h = this.el.clientHeight;
    const w = this.el.clientWidth;
    if (w >= 600 && h < 180) return 'wide';
    if (h >= 480) return 'article';
    if (h >= 180) return 'stack';
    return 'ticker';
  }

  _isRTL(text) {
    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
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

    if (mode === 'wide')       this._renderWide(headlines);
    else if (mode === 'article')    this._renderArticle(headlines);
    else if (mode === 'stack') this._renderStack(headlines);
    else                       this._renderTicker(headlines);
  }

  _formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Wide mode (Full width, short height, infinite horizontal crawl) ────────
  _renderWide(headlines) {
    const items = headlines.map(h => {
      const src = h.source ? `<span class="news-wide-src">${this._esc(h.source)}</span>` : '';
      return `
        <div class="news-wide-item">
          ${src}
          <span class="news-wide-title">${this._esc(h.title)}</span>
        </div>`;
    }).join('<span class="news-wide-sep"></span>');

    this.el.innerHTML = `
      <div class="news-wide-outer">
        <div class="news-wide-track" id="news-wide-track">
          ${items}<span class="news-wide-sep"></span>${items}
        </div>
      </div>`;

    requestAnimationFrame(() => {
      const track = document.getElementById('news-wide-track');
      if (!track) return;
      // Adjust speed based on content length (pixels per second)
      const duration = Math.max(30, track.scrollWidth / 2 / 120);
      track.style.animationDuration = `${duration}s`;
    });
  }

  // ── Ticker mode (thin strip) ─────────────────────────────────────────────────
  _renderTicker(headlines) {
    const items = headlines.map(h => {
      const src = h.source ? `<span class="news-src">${this._esc(h.source)}</span>` : '';
      return `<span class="news-item">${src}<span class="news-title">${this._esc(h.title)}</span></span><span class="news-dot">·</span>`;
    }).join('');
    this.el.innerHTML = `
      <div class="news-ticker-wrap">
        <div class="news-label">NEWS</div>
        <div class="news-track-outer">
          <div class="news-track" id="news-track">${items}${items}</div>
        </div>
      </div>`;
    requestAnimationFrame(() => {
      const track = document.getElementById('news-track');
      if (!track) return;
      track.style.animationDuration = `${Math.max(20, track.scrollWidth / 2 / 80)}s`;
    });
  }

  // ── Stack mode (2 articles visible, auto-scrolling) ──────
  _renderStack(headlines) {
    this.el.innerHTML = `
      <div class="news-stack-outer">
        <div class="news-stack">
          ${headlines.map(h => `
            <div class="news-stack-item">
              ${h.source ? `<span class="news-src">${this._esc(h.source)}</span>` : ''}
              <span class="news-stack-title">${this._esc(h.title)}</span>
            </div>`).join('')}
        </div>
      </div>`;

    const outer = this.el.querySelector('.news-stack-outer');
    if (!outer) return;

    let idx = 0;
    const advance = () => {
      idx = (idx + 1) % headlines.length;
      const itemH = outer.clientHeight / 2;
      outer.scrollTo({ top: idx * itemH, behavior: 'smooth' });
    };
    this._articleTimer = setInterval(advance, 12000);
  }

  // ── Single-article mode (title + desc, 30s rotate) ──────────────────────────
  _renderArticle(headlines) {
    this._articleData = headlines;
    this._articleIdx  = 0;
    this.el.innerHTML = `
      <div class="news-article-card" id="news-article">
        <div class="news-article-src" id="na-src"></div>
        <div class="news-article-title" id="na-title"></div>
        <div class="news-article-desc"  id="na-desc"></div>
        <div class="news-article-dots"  id="na-dots"></div>
        <div class="news-article-date"  id="na-date"></div>
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
    card.addEventListener('pointerdown', e => { startX = e.clientX; card.setPointerCapture(e.pointerId); });
    card.addEventListener('pointerup', e => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) < 40) return;
      const n = headlines.length;
      this._articleIdx = (this._articleIdx + (dx < 0 ? 1 : -1) + n) % n;
      this._showArticle(this._articleIdx);
      startTimer();
    });
  }

  _showArticle(idx) {
    const card = document.getElementById('news-article');
    if (!card) return;
    card.style.opacity    = '0';
    card.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      const h = this._articleData[idx];
      document.getElementById('na-src').textContent   = h.source || '';
      document.getElementById('na-title').textContent = h.title  || '';
      document.getElementById('na-desc').textContent  = h.desc   || '';
      
      const dateEl = document.getElementById('na-date');
      if (dateEl && h.date) {
        dateEl.textContent = this._formatDate(h.date);
      }

      const n    = this._articleData.length;
      const dots = document.getElementById('na-dots');
      if (dots) dots.innerHTML = Array.from({length: n}, (_, i) =>
        `<span class="na-dot${i === idx ? ' active' : ''}"></span>`).join('');
      card.style.opacity = '1';
    }, 500);
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['news'] = NewsWidget;
