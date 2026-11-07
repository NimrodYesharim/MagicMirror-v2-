// One Home Assistant device, placed anywhere on the mirror.
// Layout key `ha_tile:<entity_id>` → app.js creates one of these per key (manifest "multi").
// Store, tile markup and popup are shared with the Home card (../ha_home/ha_home.js).
class HaTileWidget {
  constructor(containerId, entity) {
    this.el = document.getElementById(containerId);
    this.entity = entity;
    this._unsubs = [];
    this.el.innerHTML = `<div class="ha-tile unavailable"><div class="ha-tile-name">…</div></div>`;
    this._unModel = HA.onModel(() => this._mount());
    if (HA.ready) this._mount();
  }

  // (Re)build when the device list arrives or changes; state changes only patch the tile
  _mount() {
    this._unsubs.forEach(u => u());
    const dev = HA.device(this.entity);
    if (!dev) {
      this.el.innerHTML = `<div class="ha-tile unavailable"><div class="ha-tile-name">${HA.ready ? 'Device not found' : '…'}</div><div class="ha-tile-sub">${this.entity}</div></div>`;
      this._unsubs = [];
      return;
    }
    this.el.innerHTML = HAUI.tileHTML(dev);
    const tile = this.el.firstElementChild;
    const update = () => HAUI.updateTile(tile, dev);
    update();
    HAUI.bindTile(tile, dev);
    this._unsubs = [HA.on(dev.entity, update), ...dev.extras.map(([x]) => HA.on(x, update))];
  }

  destroy() { this._unModel(); this._unsubs.forEach(u => u()); }
}
window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['ha_tile'] = HaTileWidget;
