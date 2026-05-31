class HueScenesWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this._activeScene = null;
    this._rendered = false;
    this._lastScenes = [];
    this._showSkeleton();
  }

  _showSkeleton() {
    if (!this.el) return;
    this.el.innerHTML = `<div class="widget-skeleton-hue-scenes">
      <div class="skeleton-block sk-scenes"></div>
    </div>`;
  }

  render(data) {
    if (!this.el) return;
    if (!data) { console.warn('[HueScenes] Render called without data'); return; }

    try {
      const { scenes } = data;
      const scenesArr = (scenes && Array.isArray(scenes)) ? scenes : [];
      this._lastScenes = scenesArr;

      const sceneItemsHtml = scenesArr.map(s => this._sceneHTML(s)).join('');
      const triplicatedScenes = sceneItemsHtml ? `${sceneItemsHtml}${sceneItemsHtml}${sceneItemsHtml}` : '';

      this.el.innerHTML = `
        <div class="hue-scenes-outer">
          <div class="hue-scenes" id="hue-scenes-list">
            ${triplicatedScenes}
          </div>
        </div>`;

      this._bindAll();
      if (sceneItemsHtml) this._initInfiniteScroll();
      this._rendered = true;
    } catch (err) {
      console.error('[HueScenes] Render error:', err);
    }
  }

  update(data) {
    if (!data || !data.scenes) return;
    const currentIds = (this._lastScenes || []).map(s => s.id).join(',');
    const newIds = data.scenes.map(s => s.id).join(',');
    if (currentIds !== newIds) {
      this.render(data);
    }
  }

  _sceneHTML(s) {
    if (!s) return '';
    const active = this._activeScene === s.id;
    const roomLabel = s.room ? `<div class="scene-room">${this._esc(s.room)}</div>` : '';
    return `
      <div class="scene-item">
        <button class="scene-btn${active ? ' active' : ''}"
          style="--g:${s.gradient || 'conic-gradient(#444,#444)'}"
          data-scene-id="${s.id}" title="${this._esc(s.name)}"></button>
        <div class="scene-name">${this._esc(s.name)}</div>
        ${roomLabel}
      </div>`;
  }

  _initInfiniteScroll() {
    const list = this.el.querySelector('#hue-scenes-list');
    if (!list) return;

    requestAnimationFrame(() => {
      if (list.scrollHeight > 0) {
        list.scrollTop = list.scrollHeight / 3;
      }
    });

    list.onscroll = () => {
      const h = list.scrollHeight / 3;
      if (h <= 0) return;
      if (list.scrollTop < 10) {
        list.scrollTop += h;
      } else if (list.scrollTop > h * 2 - 10) {
        list.scrollTop -= h;
      }
    };
  }

  _bindAll() {
    this.el.querySelectorAll('.scene-btn').forEach(btn => {
      btn.onclick = () => {
        this._activeScene = btn.dataset.sceneId;
        this.el.querySelectorAll('.scene-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._api(`/api/hue/scene/${btn.dataset.sceneId}/activate`, 'POST');
        
        // Cancel the active state shortly after activation
        setTimeout(() => {
          if (this._activeScene === btn.dataset.sceneId) {
            this._activeScene = null;
            btn.classList.remove('active');
          }
        }, 3000);
      };
    });
  }

  async _api(path, method, body) {
    try {
      await fetch(path, { method, headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { console.error('[HueScenes]', e); }
  }

  _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['hue_scenes'] = HueScenesWidget;
