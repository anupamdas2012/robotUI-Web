// Teleop view — manual drive controls. Four cardinal buttons + a center
// joystick for analog 2D motion. Sends MOVE / STOP commands directly via
// the connection (no DataBus involvement; commands are outbound only).
//
// Both control types use a shared "command latch" — the latest desired
// (left, right) wheel speeds. A 100ms repeat timer re-sends the latched
// command so the Pico's 500ms UART watchdog stays satisfied while the
// operator holds. Releasing any control unlatches and sends one STOP.
//
// Spec config:
//   maxPwm: number = 100        // ceiling for analog joystick output
//   buttonPwm: number = 80      // discrete-button forward/back speed
//   turnPwm: number = 60        // discrete-button turn-in-place speed
//   sendIntervalMs: number = 100  // re-send cadence while latched

class Teleop {
  constructor(spec, container, ctx) {
    this.spec = spec;
    this.id = spec.id;
    this.title = spec.title || 'Teleop';
    this.connection = ctx ? ctx.connection : null;

    const cfg = spec.config || {};
    this.maxPwm = cfg.maxPwm || 100;
    this.buttonPwm = cfg.buttonPwm || 80;
    this.turnPwm = cfg.turnPwm || 60;
    this.sendIntervalMs = cfg.sendIntervalMs || 100;

    this._activeCmd = null;          // {left, right} or null
    this._sendTimer = null;
    this._joystickActive = false;
    this._joystickPointerId = null;
    this._unsubStatus = null;

    this._buildDom(container);
    this._wireControls();

    // Reflect connection state in the status chip — operator needs to know
    // whether button presses will actually reach the robot.
    if (this.connection && typeof this.connection.onStatus === 'function') {
      this._unsubStatus = this.connection.onStatus(() => this._refreshStatus());
    }
    this._refreshStatus();
  }

  // ---------------------------------------------------------------- DOM ----

  _buildDom(container) {
    const card = document.createElement('div');
    card.className = 'chart-card teleop-card';
    card.dataset.viewId = this.id;

    const header = document.createElement('div');
    header.className = 'chart-header';

    const h2 = document.createElement('h2');
    h2.textContent = this.title;
    header.appendChild(h2);

    const values = document.createElement('div');
    values.className = 'current-values';
    this.statusChip = document.createElement('span');
    this.statusChip.className = 'teleop-status';
    this.statusChip.dataset.state = 'idle';
    this.statusChip.textContent = 'idle';
    values.appendChild(this.statusChip);
    header.appendChild(values);

    const pad = document.createElement('div');
    pad.className = 'teleop-pad';

    this.btnFwd   = this._mkBtn('teleop-btn teleop-btn-fwd',   '▲', 'Forward');
    this.btnBack  = this._mkBtn('teleop-btn teleop-btn-back',  '▼', 'Back');
    this.btnLeft  = this._mkBtn('teleop-btn teleop-btn-left',  '◀', 'Turn left');
    this.btnRight = this._mkBtn('teleop-btn teleop-btn-right', '▶', 'Turn right');

    const joy = document.createElement('div');
    joy.className = 'teleop-joystick';

    const track = document.createElement('div');
    track.className = 'teleop-joy-track';

    const handle = document.createElement('div');
    handle.className = 'teleop-joy-handle';

    track.appendChild(handle);
    joy.appendChild(track);

    pad.appendChild(this.btnFwd);
    pad.appendChild(this.btnLeft);
    pad.appendChild(joy);
    pad.appendChild(this.btnRight);
    pad.appendChild(this.btnBack);

    card.appendChild(header);
    card.appendChild(pad);
    container.appendChild(card);

    this.cardElement = card;
    this.joyTrack = track;
    this.joyHandle = handle;
  }

  _mkBtn(className, glyph, title) {
    const b = document.createElement('button');
    b.className = className;
    b.textContent = glyph;
    b.title = title;
    b.type = 'button';
    return b;
  }

  // -------------------------------------------------------------- Wiring ----

  _wireControls() {
    // Discrete-direction buttons — press to latch, release to STOP.
    this._wireDirButton(this.btnFwd,    +this.buttonPwm, +this.buttonPwm);
    this._wireDirButton(this.btnBack,   -this.buttonPwm, -this.buttonPwm);
    this._wireDirButton(this.btnLeft,   -this.turnPwm,   +this.turnPwm);
    this._wireDirButton(this.btnRight,  +this.turnPwm,   -this.turnPwm);

    // Joystick — pointerdown on the track captures, pointermove updates,
    // pointerup releases and springs back.
    this.joyTrack.addEventListener('pointerdown', (e) => this._onJoyDown(e));
  }

  _wireDirButton(btn, l, r) {
    const press = (e) => {
      e.preventDefault();
      btn.classList.add('active');
      this._latch(l, r);
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const release = (e) => {
      if (!btn.classList.contains('active')) return;
      btn.classList.remove('active');
      this._unlatch();
      try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  }

  _onJoyDown(e) {
    e.preventDefault();
    this._joystickActive = true;
    this._joystickPointerId = e.pointerId;
    try { this.joyTrack.setPointerCapture(e.pointerId); } catch (_) {}
    this.joyTrack.classList.add('active');

    const move = (ev) => {
      if (ev.pointerId !== this._joystickPointerId) return;
      this._onJoyMove(ev);
    };
    const up = (ev) => {
      if (ev.pointerId !== this._joystickPointerId) return;
      this.joyTrack.removeEventListener('pointermove', move);
      this.joyTrack.removeEventListener('pointerup', up);
      this.joyTrack.removeEventListener('pointercancel', up);
      try { this.joyTrack.releasePointerCapture(ev.pointerId); } catch (_) {}
      this._endJoy();
    };

    this.joyTrack.addEventListener('pointermove', move);
    this.joyTrack.addEventListener('pointerup', up);
    this.joyTrack.addEventListener('pointercancel', up);

    this._onJoyMove(e);
  }

  _onJoyMove(e) {
    const rect = this.joyTrack.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r  = rect.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > r) { dx = dx * r / dist; dy = dy * r / dist; }

    // Move the visual handle.
    this.joyHandle.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Normalize to [-1, 1] and convert to wheel speeds.
    const nx = dx / r;
    const ny = dy / r;
    if (Math.abs(nx) < 0.05 && Math.abs(ny) < 0.05) {
      this._unlatch();
      return;
    }
    const speed = -ny;            // up = forward
    const turn  =  nx;            // right = right-turn
    const left  = Math.round(Math.max(-255, Math.min(255, (speed + turn) * this.maxPwm)));
    const right = Math.round(Math.max(-255, Math.min(255, (speed - turn) * this.maxPwm)));
    this._latch(left, right);
  }

  _endJoy() {
    this._joystickActive = false;
    this._joystickPointerId = null;
    this.joyTrack.classList.remove('active');
    // Spring the handle back to center.
    this.joyHandle.style.transform = 'translate(-50%, -50%)';
    this._unlatch();
  }

  // ---------------------------------------------------- Command latching ----

  _latch(left, right) {
    const same = this._activeCmd && this._activeCmd.left === left && this._activeCmd.right === right;
    this._activeCmd = { left, right };
    this._refreshStatus();
    this._sendCmd();                                    // immediate edge
    if (!this._sendTimer) {
      this._sendTimer = setInterval(() => this._sendCmd(), this.sendIntervalMs);
    }
    if (same) return;                                   // nothing else to do
  }

  _unlatch() {
    if (!this._activeCmd && !this._sendTimer) return;
    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }
    this._activeCmd = null;
    this._refreshStatus();
    if (this.connection && this.connection.isConnected()) {
      this.connection.send('STOP\n');
    }
  }

  _sendCmd() {
    if (!this._activeCmd) return;
    if (!this.connection || !this.connection.isConnected()) return;
    const { left, right } = this._activeCmd;
    this.connection.send(`MOVE:${left},${right}\n`);
  }

  _refreshStatus() {
    if (!this.statusChip) return;
    if (!this.connection || !this.connection.isConnected()) {
      this.statusChip.dataset.state = 'offline';
      this.statusChip.textContent = 'offline';
      return;
    }
    if (this._activeCmd) {
      const { left, right } = this._activeCmd;
      this.statusChip.dataset.state = 'driving';
      this.statusChip.textContent = `${left} / ${right}`;
    } else {
      this.statusChip.dataset.state = 'idle';
      this.statusChip.textContent = 'idle';
    }
  }

  // ----------------------------------------------------------- Lifecycle ----

  destroy() {
    this._unlatch();
    if (this._unsubStatus) {
      this._unsubStatus();
      this._unsubStatus = null;
    }
    if (this.cardElement && this.cardElement.parentNode) {
      this.cardElement.parentNode.removeChild(this.cardElement);
    }
    this.cardElement = null;
    this.joyTrack = null;
    this.joyHandle = null;
    this.statusChip = null;
    this.btnFwd = this.btnBack = this.btnLeft = this.btnRight = null;
  }
}

registerViewType('teleop', (spec, container, ctx) => new Teleop(spec, container, ctx));
