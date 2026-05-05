// DataBus — pub/sub fanout, keyed by a $-prefix.
//
// Views subscribe to one or more prefixes; when a matching line arrives
// they're handed the parsed parts array. Subscribers should always tear
// down via the returned unsubscribe handle to avoid orphan callbacks
// firing into destroyed charts.
//
// API:
//   bus.subscribe(prefix, cb) -> unsub   — cb(partsArray)
//   bus.dispatch(line)                    — feed a single $-line in
//   bus.dispatchParts(prefix, parts)      — pre-split fast path

class DataBus {
  constructor() {
    this._subs = {};
  }

  subscribe(prefix, cb) {
    if (!this._subs[prefix]) this._subs[prefix] = [];
    this._subs[prefix].push(cb);
    return () => {
      const arr = this._subs[prefix];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  }

  dispatch(line) {
    if (!line || line[0] !== '$') return;
    const parts = line.split(',');
    this.dispatchParts(parts[0], parts);
  }

  dispatchParts(prefix, parts) {
    const arr = this._subs[prefix];
    if (!arr) return;
    for (let i = 0; i < arr.length; i += 1) {
      try { arr[i](parts); } catch (e) { console.error(e); }
    }
  }
}
