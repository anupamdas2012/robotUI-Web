// Connection — Web Serial port lifecycle + line-based pub/sub.
//
// One instance owns the port. Anyone who cares about incoming lines or
// connection state subscribes here; views never touch the port directly.
//
// API:
//   connection.connect()                — opens picker, starts read loop
//   connection.disconnect()              — closes port, ends read loop
//   connection.send(text)                — write to the port (e.g. "STOP\n")
//   connection.isConnected()             — true if a port is open
//   connection.lastDataTime()            — ms since last byte arrived
//   connection.onLine(cb) -> unsub       — cb(line) for every \n-terminated line
//   connection.onStatus(cb) -> unsub     — cb('connected' | 'disconnected')

class Connection {
  constructor() {
    this._port = null;
    this._reader = null;
    this._writer = null;
    this._lineBuf = '';
    this._lineSubs = [];
    this._statusSubs = [];
    this._lastDataTime = 0;
  }

  isConnected() {
    return this._port !== null;
  }

  lastDataTime() {
    return this._lastDataTime;
  }

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
      await this._port.open({ baudRate: 115200 });
      this._lastDataTime = Date.now();
      this._emitStatus('connected');
      this._readLoop();
    } catch (e) {
      console.error('Connection failed:', e);
      this._port = null;
    }
  }

  async disconnect() {
    try {
      if (this._reader) {
        await this._reader.cancel();
        this._reader = null;
      }
      if (this._writer) {
        try { this._writer.releaseLock(); } catch (_) {}
        this._writer = null;
      }
      if (this._port) {
        await this._port.close();
        this._port = null;
      }
    } catch (e) {
      console.error('Disconnect error:', e);
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
      console.error('Read error:', e);
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
