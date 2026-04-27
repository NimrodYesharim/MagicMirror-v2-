class NewsWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._articleTimer = null;
    this._articleIdx   = 0;
    this._articleData  = [];
  }

  render(data) {
    const headlines = data?.headlines || [];
    if (!headlines.length) { this.el.innerHTML = ''; return; }
    if (this._articleTimer) { clearInterval(this._articleTimer); this._articleTimer = null; }

    const h = this.el.clientHeight;
    if (h >= 480)      this._renderArticle(headlines);
    else if (h >= 180) this._renderStack(headlines);
    else               this._renderTicker(headlines);
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

  // ── Stack mode (2 articles visible, touch-scrollable, 8 s auto-advance) ──────
  _renderStack(headlines) {
    const items = headlines.slice(0, 10);
    this.el.innerHTML = `
      <div class="news-stack-outer">
        <div class="news-stack">
          ${items.map(h => `
            <div class="news-stack-item">
              ${h.source ? `<span class="news-src">${this._esc(h.source)}</span>` : ''}
              <span class="news-stack-title">${this._esc(h.title)}</span>
            </div>`).join('')}
        </div>
      </div>`;

    const outer = this.el.querySelector('.news-stack-outer');
    const stack = this.el.querySelector('.news-stack');
    if (!outer || !stack) return;

    // Size each item to half the outer so 2 are visible at once
    const sizeItems = () => {
      const itemH = outer.clientHeight / 2;
      if (itemH > 0) stack.querySelectorAll('.news-stack-item').forEach(el => { el.style.height = itemH + 'px'; });
    };
    requestAnimationFrame(sizeItems);

    let idx = 0;
    const advance = () => {
      idx = (idx + 1) % items.length;
      const itemH = outer.clientHeight / 2;
      outer.scrollTo({ top: idx * itemH, behavior: 'smooth' });
    };
    this._articleTimer = setInterval(advance, 8000);
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
      const n    = this._articleData.length;
      const dots = document.getElementById('na-dots');
      if (dots) dots.innerHTML = Array.from({length: Math.min(n, 10)}, (_, i) =>
        `<span class="na-dot${i === idx % 10 ? ' active' : ''}"></span>`).join('');
      card.style.opacity = '1';
    }, 500);
  }

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['news'] = NewsWidget;
