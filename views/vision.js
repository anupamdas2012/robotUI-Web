// Vision view — embedded MJPEG stream from the robot's camera.
//
// Plain <img> tag pointing at e.g. http://192.168.1.220:81/stream. Browsers
// natively render multipart/x-mixed-replace MJPEG streams as a continuously
// updating image element — no canvas, no decode work, no MediaPipe (yet).
//
// Stream URL resolution order:
//   1. spec.config.streamUrl  (per-view override)
//   2. CONFIG.cameraStreamUrl (per-environment, in config.js)
//   3. ''                     (status flips to "NO URL")
//
// Status chip in the header reflects the connection state. <img>'s onload
// fires once when the first frame decodes (= stream is live); onerror fires
// on TCP/HTTP/DNS failure. After an error we auto-retry every 3 s until the
// stream comes back.
//
// Reuses .chart-card / .chart-header / .current-values so chrome and theme
// rules apply without per-class work — the TET corner brackets, ALL-CAPS
// title, hatched paused state etc. all flow through.

class Vision {
  constructor(spec, container, ctx) {
    this.spec = spec;
    this.id = spec.id;
    this.title = spec.title || 'Camera';
    this.streamUrl =
      (spec.config && spec.config.streamUrl) ||
      (typeof CONFIG !== 'undefined' && CONFIG.cameraStreamUrl) ||
      '';

    this._retryTimer = null;
    this._destroyed = false;

    this._buildDom(container);
    this._attachStream();
  }

  _buildDom(container) {
    const card = document.createElement('div');
    card.className = 'chart-card vision-card';
    card.dataset.viewId = this.id;

    const header = document.createElement('div');
    header.className = 'chart-header';

    const h2 = document.createElement('h2');
    h2.textContent = this.title;
    header.appendChild(h2);

    const values = document.createElement('div');
    values.className = 'current-values';

    this.statusChip = document.createElement('span');
    this.statusChip.className = 'vision-status';
    this.statusChip.dataset.state = 'connecting';
    this.statusChip.textContent = 'connecting';
    values.appendChild(this.statusChip);

    header.appendChild(values);

    const frame = document.createElement('div');
    frame.className = 'vision-frame';

    this.img = document.createElement('img');
    this.img.alt = 'Camera stream';
    this.img.className = 'vision-stream';
    frame.appendChild(this.img);

    card.appendChild(header);
    card.appendChild(frame);
    container.appendChild(card);
    this.cardElement = card;
  }

  _attachStream() {
    if (!this.streamUrl) {
      this._setStatus('no url', 'offline');
      return;
    }
    this._setStatus('connecting', 'connecting');

    this.img.onload = () => this._setStatus('live', 'live');
    this.img.onerror = () => {
      this._setStatus('offline', 'offline');
      this._scheduleRetry();
    };

    // Cache-buster forces a fresh GET — important when retrying after error.
    this.img.src = this.streamUrl + (this.streamUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
  }

  _setStatus(text, state) {
    this.statusChip.textContent = text;
    this.statusChip.dataset.state = state;
  }

  _scheduleRetry() {
    if (this._retryTimer || this._destroyed) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._destroyed) this._attachStream();
    }, 3000);
  }

  destroy() {
    this._destroyed = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this.img) {
      this.img.onload = null;
      this.img.onerror = null;
      // Setting src to '' aborts the in-flight HTTP connection in all major
      // browsers — important so the ESP32 frees its single MJPEG client slot.
      this.img.src = '';
    }
    if (this.cardElement && this.cardElement.parentNode) {
      this.cardElement.parentNode.removeChild(this.cardElement);
    }
    this.cardElement = null;
    this.img = null;
    this.statusChip = null;
  }

  // Vision doesn't participate in pause / zoom / hover sync — the viewport
  // checks each method with typeof, so we don't need stubs. Add them later
  // if we want pause to e.g. freeze the stream by clearing src.
}

registerViewType('vision', (spec, container, ctx) => new Vision(spec, container, ctx));
