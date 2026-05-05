// WebSerialSource — implements the Source interface over Web Serial.
//
// A "Source" is anything that connects to a device, emits parsed lines or
// messages, and accepts outbound commands. The viewport / app.js talk to a
// Source only through the interface methods below; new transports
// (WebSocket, BLE, MQTT, ...) drop in as new files alongside this one.
//
// Source interface (all sources implement these):
//   connect()                   — open / pair / start receiving
//   disconnect()                 — tear down
//   send(text)                   — write a command back to the device
//   isConnected()                — bool
//   lastDataTime()               — ms timestamp of most recent inbound byte
//   onLine(cb) -> unsub          — cb(line) for every \n-terminated line
//   onStatus(cb) -> unsub        — cb('connected' | 'disconnected')
//
// Constructor config (passed by board manifest):
//   { type: 'web-serial', baudRate: number }

class WebSerialSource {
  constructor(config) {
    this.config = Object.assign({ baudRate: 115200 }, config || {});
    this._port = null;
    this._reader = null;
    this._writer = null;
    this._lineBuf = '';
    this._lineSubs = [];
    this._statusSubs = [];
    this._lastDataTime = 0;
  }

  isConnected() { return this._port !== null; }
  lastDataTime() { return this._lastDataTime; }

  onLine(cb) {
    this._lineSubs.push(cb);
    return () => {
      const i = this._lineSubs.indexOf(cb);
      if (i >= 0) this._lineSubs.splice(i, 1);
    };
  }

  onStatus(cb) {
    this._statusSubs.push(cb);
    return () => {
      const i = this._statusSubs.indexOf(cb);
      if (i >= 0) this._statusSubs.splice(i, 1);
    };
  }

  async connect() {
    try {
      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: this.config.baudRate });
      this._lastDataTime = Date.now();
      this._emitStatus('connected');
      this._readLoop();
    } catch (e) {
      console.error('WebSerialSource connect failed:', e);
      this._port = null;
    }
  }

  async disconnect() {
    try {
      if (this._reader) { await this._reader.cancel(); this._reader = null; }
      if (this._writer) {
        try { this._writer.releaseLock(); } catch (_) {}
        this._writer = null;
      }
      if (this._port) { await this._port.close(); this._port = null; }
    } catch (e) {
      console.error('WebSerialSource disconnect error:', e);
    }
    this._emitStatus('disconnected');
  }

  async send(text) {
    if (!this._port) return;
    if (!this._writer) this._writer = this._port.writable.getWriter();
    const encoder = new TextEncoder();
    await this._writer.write(encoder.encode(text));
  }

  async _readLoop() {
    const decoder = new TextDecoderStream();
    this._port.readable.pipeTo(decoder.writable).catch(() => {});
    this._reader = decoder.readable.getReader();
    try {
      while (true) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (!value) continue;
        this._lastDataTime = Date.now();
        this._lineBuf += value;
        const lines = this._lineBuf.split('\n');
        this._lineBuf = lines.pop();
        for (const raw of lines) {
          const trimmed = raw.replace(/\r$/, '');
          if (trimmed.length > 0) this._emitLine(trimmed);
        }
      }
    } catch (e) {
      console.error('WebSerialSource read error:', e);
    }
    this._reader = null;
  }

  _emitLine(line) {
    for (const cb of this._lineSubs) {
      try { cb(line); } catch (e) { console.error(e); }
    }
  }

  _emitStatus(s) {
    for (const cb of this._statusSubs) {
      try { cb(s); } catch (e) { console.error(e); }
    }
  }
}

// -----------------------------------------------------------------------------
// Source factory — given a manifest's `source` config, return an instance of
// the matching source class. Add new branches when introducing new transports.
// -----------------------------------------------------------------------------

function createSource(config) {
  switch (config.type) {
    case 'web-serial':
      return new WebSerialSource(config);
    default:
      throw new Error(`Unknown source type: ${config.type}`);
  }
}
