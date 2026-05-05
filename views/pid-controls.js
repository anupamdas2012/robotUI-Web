// PidControls view — kP/kI/kD sliders + setpoint, Apply / Stop buttons.
//
// Sends commands over the connection. Doesn't subscribe to any data
// streams; it's a pure control surface. The Pico firmware doesn't
// implement PID yet — this view is a working demonstration of the
// view system and a placeholder for when it does.

class PidControls {
  constructor(spec, container, ctx) {
    this.spec = spec;
    this.connection = ctx ? ctx.connection : null;
    this.config = Object.assign(
      { kP: 0.5, kI: 0.1, kD: 0.05, setpoint: 50 },
      spec.config || {}
    );
    this._buildDom(container);
  }

  _buildDom(container) {
    const card = document.createElement('div');
    card.className = 'chart-card pid-controls';
    card.dataset.plotId = this.spec.id;

    const header = document.createElement('div');
    header.className = 'chart-header';
    const h2 = document.createElement('h2');
    h2.textContent = this.spec.title || 'PID Controls';
    header.appendChild(h2);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pid-body';
    card.appendChild(body);

    this._slider(body, 'kP', this.config.kP, 0, 5,    0.01);
    this._slider(body, 'kI', this.config.kI, 0, 2,    0.01);
    this._slider(body, 'kD', this.config.kD, 0, 1,    0.001);
    this._slider(body, 'Setpoint (RPM)', this.config.setpoint, -200, 200, 1, 'setpoint');

    const actions = document.createElement('div');
    actions.className = 'pid-actions';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'topbar-btn';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => this._sendApply());
    const stopBtn = document.createElement('button');
    stopBtn.className = 'topbar-btn';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', () => this._sendStop());
    actions.appendChild(applyBtn);
    actions.appendChild(stopBtn);
    body.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'pid-status';
    status.textContent = '';
    body.appendChild(status);
    this.statusEl = status;

    container.appendChild(card);
    this.cardElement = card;
  }

  _slider(parent, label, initialValue, min, max, step, key) {
    const k = key || label;
    const row = document.createElement('div');
    row.className = 'pid-slider';

    const labelEl = document.createElement('span');
    labelEl.className = 'pid-label';
    labelEl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(initialValue);

    const valueEl = document.createElement('span');
    valueEl.className = 'pid-value';
    valueEl.textContent = String(initialValue);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      this.config[k] = v;
      valueEl.textContent = step >= 1 ? String(v | 0) : v.toFixed(3);
    });

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueEl);
    parent.appendChild(row);
  }

  async _sendApply() {
    if (!this.connection || !this.connection.isConnected()) {
      this._setStatus('not connected');
      return;
    }
    const { kP, kI, kD, setpoint } = this.config;
    const cmd = `PID:${kP},${kI},${kD},${setpoint}\n`;
    await this.connection.send(cmd);
    this._setStatus(`sent: ${cmd.trim()}`);
  }

  async _sendStop() {
    if (!this.connection || !this.connection.isConnected()) {
      this._setStatus('not connected');
      return;
    }
    await this.connection.send('STOP\n');
    this._setStatus('sent: STOP');
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
    setTimeout(() => {
      if (this.statusEl) this.statusEl.textContent = '';
    }, 2000);
  }

  destroy() {
    if (this.cardElement && this.cardElement.parentNode) {
      this.cardElement.parentNode.removeChild(this.cardElement);
    }
    this.cardElement = null;
    this.statusEl = null;
  }
}

registerViewType('pid-controls', (spec, container, ctx) => new PidControls(spec, container, ctx));
