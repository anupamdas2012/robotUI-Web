// Plot view — one chart card. Now a "view" in the viewport sense:
// constructs DOM, subscribes to its routes on the bus, and cleans up via
// destroy(). All previous Plot behavior (pause, zoom, sync, Y-fit-to-X,
// hover crosshair, chip-as-legend) is preserved.

// -----------------------------------------------------------------------------
// Crosshair plugin — registered once globally, reads chart._hoverX.
// -----------------------------------------------------------------------------

const _crosshairPlugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const x = chart._hoverX;
    if (x == null) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const px = xScale.getPixelForValue(x);
    if (!Number.isFinite(px)) return;
    const area = chart.chartArea;
    if (px < area.left || px > area.right) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(230, 230, 230, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, area.top);
    ctx.lineTo(px, area.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

if (typeof Chart !== 'undefined' && !Chart._crosshairRegistered) {
  Chart.register(_crosshairPlugin);
  Chart._crosshairRegistered = true;
}

// -----------------------------------------------------------------------------
// Plot class
// -----------------------------------------------------------------------------

class Plot {
  constructor(spec, container, ctx) {
    this.spec = spec;
    this.id = spec.id;
    this.title = spec.title;
    this.series = spec.series;
    this.maxPoints = spec.maxPoints || 200;
    this.routes = spec.routes || [];
    this.bus = ctx ? ctx.bus : null;

    this.paused = false;
    this._zoomListeners = [];
    this._hoverListeners = [];
    this._suppressZoomEvent = false;
    this._unsubs = [];

    this.buffers = this.series.map(() => []);
    this.xBuffer = [];
    this.sampleIndex = 0;

    this._buildDom(container);
    this._buildChart();
    this._setupHoverSync();
    this._subscribeRoutes();
  }

  _buildDom(container) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.dataset.plotId = this.id;

    const header = document.createElement('div');
    header.className = 'chart-header';

    const h2 = document.createElement('h2');
    h2.textContent = this.title;
    header.appendChild(h2);

    const values = document.createElement('div');
    values.className = 'current-values';
    this.valueElements = this.series.map((s, i) => {
      const span = document.createElement('span');
      span.className = 'value-chip';
      span.style.color = s.color;
      span.textContent = this._formatValue(s, null);
      span.title = `Click to toggle ${s.label}`;
      span.addEventListener('click', () => this._toggleSeries(i));
      values.appendChild(span);
      return span;
    });
    header.appendChild(values);

    const canvas = document.createElement('canvas');
    canvas.id = `chart_${this.id}`;
    this.canvas = canvas;

    card.appendChild(header);
    card.appendChild(canvas);
    container.appendChild(card);
    this.cardElement = card;
  }

  _buildChart() {
    this.chart = new Chart(this.canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: this.series.map((s) => ({
          label: s.label,
          data: [],
          borderColor: s.color,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.2,
          spanGaps: false,
        })),
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          zoom: {
            pan: {
              enabled: false,
              mode: 'x',
              onPanComplete: ({ chart }) => {
                this._emitZoomEvent(chart);
                this._refitYToVisibleX();
              },
            },
            zoom: {
              wheel: { enabled: false },
              pinch: { enabled: false },
              mode: 'x',
              onZoomComplete: ({ chart }) => {
                this._emitZoomEvent(chart);
                this._refitYToVisibleX();
              },
            },
          },
        },
        scales: {
          x: { display: false, type: 'linear' },
          y: { beginAtZero: false },
        },
      },
    });

    this._dblclickHandler = () => this.resetZoom();
    this.canvas.addEventListener('dblclick', this._dblclickHandler);
  }

  _setupHoverSync() {
    this._mousemoveHandler = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const xScale = this.chart.scales.x;
      if (!xScale) { this._emitHoverEvent(null); return; }
      const dataX = xScale.getValueForPixel(px);
      this._emitHoverEvent(Number.isFinite(dataX) ? dataX : null);
    };
    this._mouseleaveHandler = () => this._emitHoverEvent(null);
    this.canvas.addEventListener('mousemove', this._mousemoveHandler);
    this.canvas.addEventListener('mouseleave', this._mouseleaveHandler);
  }

  _subscribeRoutes() {
    if (!this.bus) return;
    for (const route of this.routes) {
      const map = route.map;
      const unsub = this.bus.subscribe(route.prefix, (parts) => {
        try { this.push(map(parts)); } catch (e) { /* skip malformed */ }
      });
      this._unsubs.push(unsub);
    }
  }

  destroy() {
    for (const u of this._unsubs) u();
    this._unsubs = [];
    if (this.canvas) {
      this.canvas.removeEventListener('dblclick', this._dblclickHandler);
      this.canvas.removeEventListener('mousemove', this._mousemoveHandler);
      this.canvas.removeEventListener('mouseleave', this._mouseleaveHandler);
    }
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    if (this.cardElement && this.cardElement.parentNode) {
      this.cardElement.parentNode.removeChild(this.cardElement);
    }
    this.cardElement = null;
    this.canvas = null;
    this._zoomListeners = [];
    this._hoverListeners = [];
  }

  _formatValue(s, value) {
    if (s.format) return s.format(s.label, value);
    if (value == null || Number.isNaN(value)) return `${s.label}: --`;
    return `${s.label}: ${value.toFixed(1)}`;
  }

  push(values) {
    this.sampleIndex += 1;
    this.xBuffer.push(this.sampleIndex);
    if (this.xBuffer.length > this.maxPoints) this.xBuffer.shift();
    for (let i = 0; i < this.series.length; i += 1) {
      const v = values[i] != null ? values[i] : null;
      this.buffers[i].push(v);
      if (this.buffers[i].length > this.maxPoints) this.buffers[i].shift();
      this.valueElements[i].textContent = this._formatValue(this.series[i], v);
    }
    if (!this.paused) this._redraw();
  }

  _redraw() {
    if (!this.chart) return;
    this.chart.data.labels = this.xBuffer.slice();
    for (let i = 0; i < this.series.length; i += 1) {
      this.chart.data.datasets[i].data = this.buffers[i].slice();
    }
    this.chart.update('none');
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.cardElement.classList.toggle('paused', paused);
    this._setInteractionEnabled(paused);
    if (!paused) this._redraw();
  }

  _setInteractionEnabled(enabled) {
    if (!this.chart) return;
    const z = this.chart.options.plugins.zoom;
    z.zoom.wheel.enabled = enabled;
    z.zoom.pinch.enabled = enabled;
    z.pan.enabled = enabled;
    this.chart.update('none');
  }

  resetZoom({ emit = true } = {}) {
    if (!this.chart) return;
    this._suppressZoomEvent = true;
    this.chart.resetZoom('none');
    this.chart.options.scales.y.min = undefined;
    this.chart.options.scales.y.max = undefined;
    this.chart.update('none');
    this._suppressZoomEvent = false;
    if (emit) this._emitZoomEvent(this.chart);
  }

  onZoomChanged(cb) { this._zoomListeners.push(cb); }
  onHoverChanged(cb) { this._hoverListeners.push(cb); }

  setVisibleRange(xMin, xMax) {
    if (!this.chart) return;
    this._suppressZoomEvent = true;
    if (xMin == null || xMax == null) {
      this.chart.resetZoom('none');
      this.chart.options.scales.y.min = undefined;
      this.chart.options.scales.y.max = undefined;
      this.chart.update('none');
    } else {
      this.chart.zoomScale('x', { min: xMin, max: xMax }, 'none');
      this._refitYToVisibleX();
    }
    this._suppressZoomEvent = false;
  }

  setHoverX(x) {
    if (!this.chart) return;
    if (this.chart._hoverX === x) return;
    this.chart._hoverX = x;
    this.chart.update('none');
  }

  _toggleSeries(seriesIndex) {
    if (!this.chart) return;
    const visible = this.chart.isDatasetVisible(seriesIndex);
    this.chart.setDatasetVisibility(seriesIndex, !visible);
    this.valueElements[seriesIndex].classList.toggle('muted', visible);
    if (this.paused) this._refitYToVisibleX();
    this.chart.update('none');
  }

  _refitYToVisibleX() {
    if (!this.chart || !this.paused) return;
    const xScale = this.chart.scales.x;
    if (!xScale) return;
    const xMin = xScale.min;
    const xMax = xScale.max;
    if (xMin == null || xMax == null) return;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < this.xBuffer.length; i += 1) {
      const x = this.xBuffer[i];
      if (x < xMin || x > xMax) continue;
      for (let s = 0; s < this.buffers.length; s += 1) {
        if (!this.chart.isDatasetVisible(s)) continue;
        const v = this.buffers[s][i];
        if (v == null || !Number.isFinite(v)) continue;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
    const range = yMax - yMin;
    const margin = range > 0 ? range * 0.1 : Math.max(1, Math.abs(yMin) * 0.01);
    this.chart.options.scales.y.min = yMin - margin;
    this.chart.options.scales.y.max = yMax + margin;
    this.chart.update('none');
  }

  _emitHoverEvent(x) {
    for (const cb of this._hoverListeners) cb({ x, source: this });
  }

  _emitZoomEvent(chart) {
    if (this._suppressZoomEvent) return;
    const xScale = chart.scales.x;
    const xMin = xScale ? xScale.min : null;
    const xMax = xScale ? xScale.max : null;
    for (const cb of this._zoomListeners) cb({ xMin, xMax, source: this });
  }
}

// Register with the viewport's view registry.
registerViewType('plot', (spec, container, ctx) => new Plot(spec, container, ctx));
