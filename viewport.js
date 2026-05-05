// Viewport — owns the active blueprint and the views it spawned.
//
// loadBlueprint() tears down whatever's currently mounted, builds the
// new views from spec, hands each view a connection + bus reference,
// and wires cross-view sync (zoom + hover) for views that opt into it.
//
// API:
//   vp.loadBlueprint(blueprint)
//   vp.setPaused(bool)
//   vp.resetAllZoom()
//   vp.activeViews()         — for debugging

const VIEW_REGISTRY = {};

function registerViewType(type, factory) {
  VIEW_REGISTRY[type] = factory;
}

class Viewport {
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;             // { connection, bus }
    this._views = [];
  }

  activeViews() { return this._views.slice(); }

  loadBlueprint(blueprint) {
    this._destroyAll();
    this.container.dataset.layout = blueprint.layout || 'grid';
    for (const spec of blueprint.views) {
      const factory = VIEW_REGISTRY[spec.type];
      if (!factory) {
        console.warn(`Unknown view type: ${spec.type}`);
        continue;
      }
      const view = factory(spec, this.container, this.ctx);
      this._views.push(view);
    }
    this._wireSync();
  }

  setPaused(paused) {
    for (const v of this._views) {
      if (typeof v.setPaused === 'function') v.setPaused(paused);
    }
  }

  resetAllZoom() {
    for (const v of this._views) {
      if (typeof v.resetZoom === 'function') v.resetZoom({ emit: false });
    }
  }

  _wireSync() {
    // Cross-view zoom sync: any zoomable view's range mirrors to siblings.
    for (const v of this._views) {
      if (typeof v.onZoomChanged !== 'function') continue;
      v.onZoomChanged(({ xMin, xMax, source }) => {
        for (const other of this._views) {
          if (other === source) continue;
          if (typeof other.setVisibleRange === 'function') {
            other.setVisibleRange(xMin, xMax);
          }
        }
      });
    }
    // Cross-view hover sync.
    for (const v of this._views) {
      if (typeof v.onHoverChanged !== 'function') continue;
      v.onHoverChanged(({ x }) => {
        for (const other of this._views) {
          if (typeof other.setHoverX === 'function') other.setHoverX(x);
        }
      });
    }
  }

  _destroyAll() {
    for (const v of this._views) {
      try { v.destroy(); } catch (e) { console.error(e); }
    }
    this._views = [];
    this.container.innerHTML = '';
  }
}
