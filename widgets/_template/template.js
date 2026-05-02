/**
 * Template — mirror display class.
 * Copy to widgets/<name>/<name>.js and rename throughout.
 *
 * Framework contract:
 *   render(data)  — called on first WS message and REST bootstrap.
 *   update(data)  — optional; called on subsequent WS messages if defined.
 *                   If absent, render() is called every time.
 *   _rendered     — set to true by the framework after first render().
 */
class MyWidget {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
  }

  render(data) {
    if (!this.el || !data) return;
    this.el.innerHTML = `<div class="mywidget-root">Hello from My Widget</div>`;
  }

  // update(data) { /* optional incremental update */ }
}

window.WidgetClasses = window.WidgetClasses || {};
window.WidgetClasses['mywidget'] = MyWidget;
