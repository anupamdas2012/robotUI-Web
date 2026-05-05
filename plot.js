// Plot — one chart card with a circular buffer per series.
//
// Constructor:
//   new Plot({
//     id:        string                              // DOM id-friendly slug
//     title:     string                              // header text
//     container: HTMLElement                         // where to append the card
//     series:    [{ label, color, format? }, ...]   // one entry per stream of floats
//     maxPoints: number = 200                        // ring-buffer size
//   })
//
// API:
//   plot.push([v0, v1, ...])     // one value per series (null OK to skip a sample)
//   plot.clear()                  // reset buffers + redraw
//   plot.setPaused(bool)          // freeze view; buffers keep filling
//   plot.resetZoom({emit?})       // unzoom + restore Y auto-fit
//   plot.onZoomChanged(cb)        // cb({xMin, xMax}) when user zooms/pans
//   plot.setVisibleRange(min,max) // programmatic zoom (no event re-emit)
//   plot.onHoverChanged(cb)       // cb({x}) when mouse moves over canvas
//   plot.setHoverX(x)             // draw shared crosshair at data-space X (null clears)

// -----------------------------------------------------------------------------
// Crosshair plugin — draws a vertical dashed line at chart._hoverX (data space)
// across the chart area whenever it's set. Registered globally so every Chart
// instance picks it up.
// -----------------------------------------------------------------------------

const crosshairPlugin = {
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

if (typeof Chart !== 'undefined') {
  Chart.register(crosshairPlugin);
}

class Plot {
  constructor({ id, title, container, series, maxPoints = 200 }) {
    this.id = id;
    this.title = title;
    this.series = series;
    this.maxPoints = maxPoints;
    this.paused = false;
    this._zoomListeners = [];
    this._hoverListeners = [];
    this._suppressZoomEvent = false;

    this.buffers = series.map(() => []);
    this.xBuffer = [];
    this.sampleIndex = 0;

    this._buildDom(container);
    this._buildChart();
    this._setupHoverSync();
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
          // Built-in legend disabled — the value chips in the card header
          // are the legend (clickable, with clear visible/hidden state).
          legend: { display: false },
          zoom: {
            // Zoom/pan are gated on paused state — see _setInteractionEnabled.
            // Live mode tracks the tail; analysis only happens while paused.
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

    this.canvas.addEventListener('dblclick', () => this.resetZoom());
  }

  _setupHoverSync() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const xScale = this.chart.scales.x;
      if (!xScale) {
        this._emitHoverEvent(null);
        return;
      }
      const dataX = xScale.getValueForPixel(px);
      if (dataX == null || !Number.isFinite(dataX)) {
        this._emitHoverEvent(null);
      } else {
        this._emitHoverEvent(dataX);
      }
    });
    this.canvas.addEventListener('mouseleave', () => {
      this._emitHoverEvent(null);
    });
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
    this.chart.data.labels = this.xBuffer.slice();
    for (let i = 0; i < this.series.length; i += 1) {
      this.chart.data.datasets[i].data = this.buffers[i].slice();
    }
    this.chart.update('none');
  }

  clear() {
    this.buffers = this.series.map(() => []);
    this.xBuffer = [];
    this.sampleIndex = 0;
    this._redraw();
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.cardElement.classList.toggle('paused', paused);
    this._setInteractionEnabled(paused);
    if (!paused) this._redraw();
  }

  _setInteractionEnabled(enabled) {
    const z = this.chart.options.plugins.zoom;
    z.zoom.wheel.enabled = enabled;
    z.zoom.pinch.enabled = enabled;
    z.pan.enabled = enabled;
    this.chart.update('none');
  }

  resetZoom({ emit = true } = {}) {
    this._suppressZoomEvent = true;
    this.chart.resetZoom('none');
    // Restore Y auto-fit so live updates use Chart.js's default scaling.
    this.chart.options.scales.y.min = undefined;
    this.chart.options.scales.y.max = undefined;
    this.chart.update('none');
    this._suppressZoomEvent = false;
    if (emit) this._emitZoomEvent(this.chart);
  }

  onZoomChanged(cb) {
    this._zoomListeners.push(cb);
  }

  setVisibleRange(xMin, xMax) {
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

  // -- Series visibility (chip click toggles) --------------------------------
  _toggleSeries(seriesIndex) {
    const visible = this.chart.isDatasetVisible(seriesIndex);
    this.chart.setDatasetVisibility(seriesIndex, !visible);
    this.valueElements[seriesIndex].classList.toggle('muted', visible);
    // Refit Y if we're zoomed — hiding/showing series should affect the fit.
    if (this.paused) this._refitYToVisibleX();
    this.chart.update('none');
  }

  // -- Y auto-fit to current X window ----------------------------------------
  // After a zoom/pan that narrows the X axis, refit Y to only the points that
  // are visible. Without this, Y stays scaled for the full buffer and a quiet
  // slice of an otherwise-spiky signal looks like a flat line.
  _refitYToVisibleX() {
    if (!this.paused) return;
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

    // Range-collapse safety: if the slice is flat, expand by 1% of the value
    // (or ±1, whichever is bigger) so the line doesn't render on the axis.
    const range = yMax - yMin;
    const margin = range > 0
      ? range * 0.1
      : Math.max(1, Math.abs(yMin) * 0.01);

    this.chart.options.scales.y.min = yMin - margin;
    this.chart.options.scales.y.max = yMax + margin;
    this.chart.update('none');
  }

  // -- Hover crosshair sync --------------------------------------------------
  onHoverChanged(cb) {
    this._hoverListeners.push(cb);
  }

  _emitHoverEvent(x) {
    for (const cb of this._hoverListeners) cb({ x, source: this });
  }

  setHoverX(x) {
    if (this.chart._hoverX === x) return;
    this.chart._hoverX = x;
    this.chart.update('none');
  }

  _emitZoomEvent(chart) {
    if (this._suppressZoomEvent) return;
    const xScale = chart.scales.x;
    const xMin = xScale ? xScale.min : null;
    const xMax = xScale ? xScale.max : null;
    for (const cb of this._zoomListeners) cb({ xMin, xMax, source: this });
  }
}
