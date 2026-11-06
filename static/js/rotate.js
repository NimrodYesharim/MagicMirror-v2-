// Portrait mirror on a landscape X screen, rotated by the browser (?rotate=right|left).
// On the Pi, `xrandr --rotate` makes X re-copy the whole screen on every frame, which
// halved the frame rate. start.sh now leaves X unrotated and asks for this mode instead:
// the page is rotated in CSS (html.rotate-*, main.css) and this shim maps viewport
// coordinates back to the 1080×1920 portrait page, so widget code works unchanged.
(function () {
  const rot = new URLSearchParams(location.search).get('rotate');
  if (rot !== 'right' && rot !== 'left') return;
  document.documentElement.classList.add('rotate-' + rot);

  const W = 1080, H = 1920;  // portrait page size (html/body in main.css)
  // landscape viewport point -> portrait page point, and back
  const toPage = rot === 'right' ? (x, y) => [y, H - x] : (x, y) => [W - y, x];
  const toView = rot === 'right' ? (x, y) => [H - y, x] : (x, y) => [y, W - x];

  const wrapGetters = (proto, pairs) => {
    for (const [xk, yk] of pairs) {
      const gx = Object.getOwnPropertyDescriptor(proto, xk)?.get;
      const gy = Object.getOwnPropertyDescriptor(proto, yk)?.get;
      if (!gx || !gy) continue;
      Object.defineProperty(proto, xk, { configurable: true, get() { return toPage(gx.call(this), gy.call(this))[0]; } });
      Object.defineProperty(proto, yk, { configurable: true, get() { return toPage(gx.call(this), gy.call(this))[1]; } });
    }
  };
  // Pointer/mouse events inherit from MouseEvent; touch points are Touch objects
  wrapGetters(MouseEvent.prototype, [['clientX', 'clientY'], ['pageX', 'pageY'], ['x', 'y']]);
  if (window.Touch) wrapGetters(Touch.prototype, [['clientX', 'clientY'], ['pageX', 'pageY']]);

  const rectToPage = r => {
    const [x1, y1] = toPage(r.left, r.top), [x2, y2] = toPage(r.right, r.bottom);
    return new DOMRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  };
  const gbcr = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { return rectToPage(gbcr.call(this)); };
  const rgbcr = Range.prototype.getBoundingClientRect;
  Range.prototype.getBoundingClientRect = function () { return rectToPage(rgbcr.call(this)); };

  const efp = Document.prototype.elementFromPoint;
  Document.prototype.elementFromPoint = function (x, y) { return efp.call(this, ...toView(x, y)); };

  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => W });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => H });
})();
