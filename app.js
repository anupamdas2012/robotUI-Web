// app.js — top-level wiring.
//
// Responsibilities:
//   - Instantiate the connection, databus, and viewport
//   - Pump connection lines into the databus + console
//   - Maintain status pill state from $STA
//   - Handle Connect/Pause/Reset buttons and the blueprint tab switcher
//   - Spacebar shortcut for pause

const MAX_CONSOLE_LINES = 500;
const DISCONNECT_TIMEOUT_MS = 2000;

Chart.defaults.color = '#888';
Chart.defaults.borderColor = '#2a2a2a';

// -----------------------------------------------------------------------------
// Core: connection + databus + viewport
// -----------------------------------------------------------------------------

const connection = new Connection();
const bus = new DataBus();
const chartGrid = document.getElementById('chartGrid');
const viewport = new Viewport(chartGrid, { connection, bus });

// Available blueprints. Add new entries here when introducing new pages.
const BLUEPRINTS = {
  telemetry: TELEMETRY_BLUEPRINT,
  'pid-tuning': PID_TUNING_BLUEPRINT,
};

let activeBlueprintKey = 'telemetry';

// -----------------------------------------------------------------------------
// DOM refs
// -----------------------------------------------------------------------------

const connectBtn = document.getElementById('connectBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetZoomBtn = document.getElementById('resetZoomBtn');
const clearBtn = document.getElementById('clearBtn');
const consoleEl = document.getElementById('console');
const dotMotors = document.getElementById('dotMotors');
const dotIMU = document.getElementById('dotIMU');
const dotToF = document.getElementById('dotToF');
const tabContainer = document.getElementById('tabSwitcher');

let paused = false;

// -----------------------------------------------------------------------------
// Connection -> bus + console + status
// -----------------------------------------------------------------------------

connection.onLine((line) => {
  bus.dispatch(line);
  appendConsole(line);
});

connection.onStatus((status) => {
  if (status === 'connected') {
    connectBtn.textContent = 'Disconnect';
  } else {
    connectBtn.textContent = 'Connect';
    setDot(dotMotors, 'gray');
    setDot(dotIMU, 'gray');
    setDot(dotToF, 'gray');
  }
});

// $STA drives the status pills regardless of which blueprint is active.
bus.subscribe('$STA', (parts) => {
  setDot(dotMotors, 'on');
  setDot(dotIMU, parts[1] === '1' ? 'on' : 'off');
  setDot(dotToF, parts[2] === '1' ? 'on' : 'off');
});

// Quiet pills back to 'off' if the data stream stalls.
setInterval(() => {
  if (!connection.isConnected()) return;
  if (Date.now() - connection.lastDataTime() > DISCONNECT_TIMEOUT_MS) {
    setDot(dotMotors, 'off');
    setDot(dotIMU, 'off');
    setDot(dotToF, 'off');
  }
}, 500);

function setDot(el, state) {
  if (!el) return;
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

// -----------------------------------------------------------------------------
// Blueprint switcher
// -----------------------------------------------------------------------------

function loadBlueprint(key) {
  const bp = BLUEPRINTS[key];
  if (!bp) return;
  activeBlueprintKey = key;
  viewport.loadBlueprint(bp);
  // Reset pause when switching pages — new views start in live mode.
  paused = false;
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.classList.remove('active');
  // Refresh tab-active styling.
  for (const btn of tabContainer.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.blueprint === key);
  }
}

function buildTabs() {
  tabContainer.innerHTML = '';
  for (const [key, bp] of Object.entries(BLUEPRINTS)) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (key === activeBlueprintKey ? ' active' : '');
    btn.dataset.blueprint = key;
    btn.textContent = bp.name;
    btn.addEventListener('click', () => loadBlueprint(key));
    tabContainer.appendChild(btn);
  }
}

// -----------------------------------------------------------------------------
// Buttons
// -----------------------------------------------------------------------------

connectBtn.addEventListener('click', () => {
  if (connection.isConnected()) connection.disconnect();
  else connection.connect();
});

pauseBtn.addEventListener('click', () => setPaused(!paused));
resetZoomBtn.addEventListener('click', () => viewport.resetAllZoom());
clearBtn.addEventListener('click', () => { consoleEl.textContent = ''; });

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  e.preventDefault();
  setPaused(!paused);
});

function setPaused(next) {
  paused = next;
  viewport.setPaused(paused);
  if (!paused) viewport.resetAllZoom();
  pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  pauseBtn.classList.toggle('active', paused);
}

// -----------------------------------------------------------------------------
// Console dialog (toggle + drag, unchanged behavior)
// -----------------------------------------------------------------------------

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

document.addEventListener('mouseup', () => { isDragging = false; });

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

buildTabs();
loadBlueprint(activeBlueprintKey);
