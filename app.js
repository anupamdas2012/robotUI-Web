// Web Serial Dashboard for Pico 2 Motor Control
//
// Architecture:
//   - Plot   (plot.js)   owns one card: DOM, Chart.js, ring buffer, pause, zoom
//   - app.js                wires connection + parser + blueprint + sync
//
// Adding a metric is a one-entry change to BLUEPRINT plus a one-line route in
// ROUTES.

const MAX_POINTS = 200;
const MAX_CONSOLE_LINES = 500;
const DISCONNECT_TIMEOUT_MS = 2000;

// Chart.js defaults for dark theme.
Chart.defaults.color = '#888';
Chart.defaults.borderColor = '#2a2a2a';

// =============================================================================
// Blueprint — declarative plot definitions
// =============================================================================

const BLUEPRINT = [
  {
    id: 'rpm',
    title: 'Motor RPM',
    series: [
      { label: 'L', color: '#4cc9f0' },
      { label: 'R', color: '#f72585' },
    ],
  },
  {
    id: 'tof',
    title: 'ToF Distance',
    series: [
      {
        label: 'Distance',
        color: '#4ade80',
        format: (label, v) => (v == null ? `${label}: --` : `${v.toFixed(0)} mm`),
      },
    ],
  },
  {
    id: 'imu',
    title: 'IMU Orientation',
    series: [
      { label: 'H', color: '#f59e0b' },
      { label: 'P', color: '#4cc9f0' },
      { label: 'R', color: '#f72585' },
    ],
  },
  {
    id: 'loop',
    title: 'Loop Timing (µs)',
    series: [
      { label: 'Avg', color: '#8b5cf6', format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v|0}us`) },
      { label: 'Max', color: '#ef4444', format: (label, v) => (v == null ? `${label}: --` : `${label}: ${v|0}us`) },
    ],
  },
];

// =============================================================================
// Plot instantiation + cross-plot zoom sync
// =============================================================================

const chartGrid = document.getElementById('chartGrid');
const plots = {};
for (const spec of BLUEPRINT) {
  plots[spec.id] = new Plot({
    id: spec.id,
    title: spec.title,
    series: spec.series,
    container: chartGrid,
    maxPoints: MAX_POINTS,
  });
}

// When the user zooms or pans one plot, mirror the X range on every sibling.
for (const id of Object.keys(plots)) {
  plots[id].onZoomChanged(({ xMin, xMax, source }) => {
    for (const otherId of Object.keys(plots)) {
      if (otherId === id) continue;
      plots[otherId].setVisibleRange(xMin, xMax);
    }
  });
}

// =============================================================================
// Routes — map a $-prefix message to plot.push() calls
// =============================================================================

const ROUTES = {
  $MOT: (parts) => {
    plots.rpm.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    plots.loop.push([parseInt(parts[5], 10), parseInt(parts[6], 10)]);
  },
  $IMU: (parts) => {
    plots.imu.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
  },
  $TOF: (parts) => {
    const valid = parts[2] === '1';
    plots.tof.push([valid ? parseInt(parts[1], 10) : null]);
  },
  $STA: (parts) => {
    setDot(dotMotors, 'on');
    setDot(dotIMU, parts[1] === '1' ? 'on' : 'off');
    setDot(dotToF, parts[2] === '1' ? 'on' : 'off');
  },
};

// =============================================================================
// Serial connection + line parser
// =============================================================================

let port = null;
let reader = null;
let lastDataTime = 0;
let disconnectTimer = null;
let lineBuf = '';
let paused = false;

const connectBtn = document.getElementById('connectBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetZoomBtn = document.getElementById('resetZoomBtn');
const clearBtn = document.getElementById('clearBtn');
const consoleEl = document.getElementById('console');
const dotMotors = document.getElementById('dotMotors');
const dotIMU = document.getElementById('dotIMU');
const dotToF = document.getElementById('dotToF');

function setDot(el, state) {
  el.className = 'dot ' + (state === 'on' ? 'dot-green' : state === 'off' ? 'dot-red' : 'dot-gray');
}

function appendConsole(line) {
  consoleEl.textContent += line + '\n';
  const lines = consoleEl.textContent.split('\n');
  if (lines.length > MAX_CONSOLE_LINES) {
    consoleEl.textContent = lines.slice(-MAX_CONSOLE_LINES).join('\n');
  }
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function parseLine(line) {
  appendConsole(line);
  if (!line.startsWith('$')) return;

  lastDataTime = Date.now();
  const parts = line.split(',');
  const route = ROUTES[parts[0]];
  if (route) route(parts);
}

async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    connectBtn.textContent = 'Disconnect';
    lastDataTime = Date.now();
    startDisconnectWatcher();
    readLoop();
  } catch (e) {
    console.error('Connection failed:', e);
  }
}

async function disconnect() {
  try {
    if (reader) {
      await reader.cancel();
      reader = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
  } catch (e) {
    console.error('Disconnect error:', e);
  }
  connectBtn.textContent = 'Connect';
  stopDisconnectWatcher();
  setDot(dotMotors, 'gray');
  setDot(dotIMU, 'gray');
  setDot(dotToF, 'gray');
}

async function readLoop() {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  reader = decoder.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        lineBuf += value;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop();
        for (const raw of lines) {
          const trimmed = raw.replace(/\r$/, '');
          if (trimmed.length > 0) parseLine(trimmed);
        }
      }
    }
  } catch (e) {
    console.error('Read error:', e);
  }
  reader = null;
}

function startDisconnectWatcher() {
  disconnectTimer = setInterval(() => {
    if (Date.now() - lastDataTime > DISCONNECT_TIMEOUT_MS) {
      setDot(dotMotors, 'off');
      setDot(dotIMU, 'off');
      setDot(dotToF, 'off');
    }
  }, 500);
}

function stopDisconnectWatcher() {
  if (disconnectTimer) {
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
}

// =============================================================================
// Pause + reset zoom
// =============================================================================

function setPaused(next) {
  paused = next;
  for (const id of Object.keys(plots)) plots[id].setPaused(paused);
  // On resume, clear any zoom so charts return to following the live tail.
  // Without this, new data plots off-screen of the locked zoom range.
  if (!paused) resetAllZoom();
  pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  pauseBtn.classList.toggle('active', paused);
}

function resetAllZoom() {
  // Bulk reset — pass emit:false so plots don't sync each other's
  // just-reset range as a new fixed window.
  for (const id of Object.keys(plots)) plots[id].resetZoom({ emit: false });
}

pauseBtn.addEventListener('click', () => setPaused(!paused));
resetZoomBtn.addEventListener('click', resetAllZoom);

// Spacebar toggles pause when not focused on an input or button.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  e.preventDefault();
  setPaused(!paused);
});

connectBtn.addEventListener('click', () => {
  if (port) disconnect();
  else connect();
});

clearBtn.addEventListener('click', () => {
  consoleEl.textContent = '';
});

// =============================================================================
// Console dialog (unchanged behavior — toggle, drag to reposition)
// =============================================================================

const consolePill = document.getElementById('consolePill');
const consoleDialog = document.getElementById('consoleDialog');
const consoleCloseBtn = document.getElementById('consoleCloseBtn');

consolePill.addEventListener('click', () => {
  consoleDialog.classList.toggle('hidden');
  consolePill.classList.toggle('active');
});

consoleCloseBtn.addEventListener('click', () => {
  consoleDialog.classList.add('hidden');
  consolePill.classList.remove('active');
});

const consoleHeader = consoleDialog.querySelector('.console-dialog-header');
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDragging = false;

consoleHeader.addEventListener('mousedown', (e) => {
  if (e.target.closest('button')) return;
  isDragging = true;
  dragOffsetX = e.clientX - consoleDialog.offsetLeft;
  dragOffsetY = e.clientY - consoleDialog.offsetTop;
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  consoleDialog.style.left = (e.clientX - dragOffsetX) + 'px';
  consoleDialog.style.top = (e.clientY - dragOffsetY) + 'px';
  consoleDialog.style.right = 'auto';
  consoleDialog.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => {
  isDragging = false;
});
