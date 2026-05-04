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
//   plot.resetZoom()              // unzoom + resume live tail
//   plot.onZoomChanged(cb)        // cb({xMin, xMax}) when user zooms/pans
//   plot.setVisibleRange(min,max) // programmatic zoom (no event re-emit)

class Plot {
  constructor({ id, title, container, series, maxPoints = 200 }) {
    this.id = id;
    this.title = title;
    this.series = series;
    this.maxPoints = maxPoints;
    this.paused = false;
    this._zoomListeners = [];
    this._suppressZoomEvent = false;

    // One buffer per series + one shared X-axis (sample index) buffer.
    this.buffers = series.map(() => []);
    this.xBuffer = [];
    this.sampleIndex = 0;

    this._buildDom(container);
    this._buildChart();
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
    this.valueElements = this.series.map((s) => {
      const span = document.createElement('span');
      span.style.color = s.color;
      span.textContent = this._formatValue(s, null);
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
          legend: {
            display: this.series.length > 1,
            labels: { boxWidth: 12 },
          },
          zoom: {
            // Zoom/pan are gated on paused state — see _setInteractionEnabled.
            // Live mode tracks the tail; analysis only happens while paused.
            pan: {
              enabled: false,
              mode: 'x',
              onPanComplete: ({ chart }) => this._emitZoomEvent(chart),
            },
            zoom: {
              wheel: { enabled: false },
              pinch: { enabled: false },
              mode: 'x',
              onZoomComplete: ({ chart }) => this._emitZoomEvent(chart),
            },
          },
        },
        scales: {
          x: { display: false, type: 'linear' },
          y: { beginAtZero: false },
        },
        onDoubleClick: () => this.resetZoom(),
      },
    });

    // Chart.js doesn't have a native onDoubleClick; wire it on the canvas.
    this.canvas.addEventListener('dblclick', () => this.resetZoom());
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
    this._suppressZoomEvent = false;
    // emit=false used for bulk resets where the caller is touching every plot
    // already; otherwise siblings would receive the just-reset range as a new
    // fixed window, defeating the point.
    if (emit) this._emitZoomEvent(this.chart);
  }

  onZoomChanged(cb) {
    this._zoomListeners.push(cb);
  }

  setVisibleRange(xMin, xMax) {
    this._suppressZoomEvent = true;
    if (xMin == null || xMax == null) {
      this.chart.resetZoom('none');
    } else {
      this.chart.zoomScale('x', { min: xMin, max: xMax }, 'none');
    }
    this._suppressZoomEvent = false;
  }

  _emitZoomEvent(chart) {
    if (this._suppressZoomEvent) return;
    const xScale = chart.scales.x;
    const xMin = xScale ? xScale.min : null;
    const xMax = xScale ? xScale.max : null;
    for (const cb of this._zoomListeners) cb({ xMin, xMax, source: this });
  }
}
