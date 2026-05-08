// app.js — board-agnostic top-level wiring.
//
// Picks an active board from the registry, instantiates that board's source,
// builds status pills + tab switcher from the board's manifest, and pumps
// data through the bus into the active blueprint. Adding a new board is
// purely a matter of registering a new manifest (no edits here).

const MAX_CONSOLE_LINES = 500;
const DISCONNECT_TIMEOUT_MS = 2000;

Chart.defaults.color = '#888';
Chart.defaults.borderColor = '#2a2a2a';

// -----------------------------------------------------------------------------
// Active board — for now, just take the first registered manifest. Future:
// a board picker / URL param / saved preference.
// -----------------------------------------------------------------------------

const boardIds = Object.keys(BOARD_REGISTRY);
if (boardIds.length === 0) {
  throw new Error('No board manifests registered — load one before app.js');
}
const manifest = BOARD_REGISTRY[boardIds[0]];
document.title = `${manifest.name} Dashboard`;

// -----------------------------------------------------------------------------
// Core: source + databus + viewport
// -----------------------------------------------------------------------------

const source = createSource(manifest.source);
const bus = new DataBus();
const chartGrid = document.getElementById('chartGrid');
const viewport = new Viewport(chartGrid, { connection: source, bus });

// Resolve the manifest's blueprint id list against the registry.
const boardBlueprints = manifest.blueprints
  .map((id) => ({ id, blueprint: BLUEPRINT_REGISTRY[id] }))
  .filter((entry) => entry.blueprint);

let activeBlueprintKey = boardBlueprints.length > 0 ? boardBlueprints[0].id : null;

// -----------------------------------------------------------------------------
// DOM refs
// -----------------------------------------------------------------------------

const connectBtn = document.getElementById('connectBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetZoomBtn = document.getElementById('resetZoomBtn');
const clearBtn = document.getElementById('clearBtn');
const consoleEl = document.getElementById('console');
const tabContainer = document.getElementById('tabSwitcher');
const statusContainer = document.getElementById('statusPills');

let paused = false;

// -----------------------------------------------------------------------------
// Status pills — generated from manifest.components, wired to manifest.messages
// -----------------------------------------------------------------------------

const statusDots = {};

function buildStatusPills() {
  statusContainer.innerHTML = '';
  for (const comp of manifest.components) {
    const pill = document.createElement('div');
    pill.className = 'status-pill';
    const dot = document.createElement('span');
    dot.className = 'dot dot-gray';
    pill.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = comp.name;
    pill.appendChild(label);
    statusContainer.appendChild(pill);
    statusDots[comp.id] = dot;
  }
}

function setDot(dot, state) {
  if (!dot) return;
  dot.className = 'dot ' + (state === 'on' ? 'dot-green' : state === 'off' ? 'dot-red' : 'dot-gray');
}

function wireComponentStatus() {
  for (const comp of manifest.components) {
    const dot = statusDots[comp.id];
    if (!dot) continue;
    const fromMsg = comp.from.msg;

    if (comp.from.alwaysOn) {
      bus.subscribe(fromMsg, () => setDot(dot, 'on'));
      continue;
    }

    const msgSchema = manifest.messages[fromMsg];
    if (!msgSchema) {
      console.warn(`Component '${comp.id}' references unknown message ${fromMsg}`);
      continue;
    }
    const fieldIdx = msgSchema.fields.indexOf(comp.from.field);
    if (fieldIdx < 0) {
      console.warn(`Component '${comp.id}' references unknown field ${comp.from.field} on ${fromMsg}`);
      continue;
    }
    // parts[0] is the prefix; field i is at parts[i+1].
    const partsIndex = fieldIdx + 1;
    bus.subscribe(fromMsg, (parts) => {
      setDot(dot, parts[partsIndex] === '1' ? 'on' : 'off');
    });
  }
}

function setAllDotsGray() {
  for (const id of Object.keys(statusDots)) setDot(statusDots[id], 'gray');
}

// -----------------------------------------------------------------------------
// Source -> bus + console
// -----------------------------------------------------------------------------

source.onLine((line) => {
  bus.dispatch(line);
  appendConsole(line);
});

source.onStatus((status) => {
  if (status === 'connected') {
    connectBtn.textContent = 'Disconnect';
  } else {
    connectBtn.textContent = 'Connect';
    setAllDotsGray();
  }
});

// Quiet pills back to gray-ish ('off' = red) if data stalls.
setInterval(() => {
  if (!source.isConnected()) return;
  if (Date.now() - source.lastDataTime() > DISCONNECT_TIMEOUT_MS) {
    for (const id of Object.keys(statusDots)) setDot(statusDots[id], 'off');
  }
}, 500);

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
  const entry = boardBlueprints.find((b) => b.id === key);
  if (!entry) return;
  activeBlueprintKey = key;
  viewport.loadBlueprint(entry.blueprint);
  paused = false;
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.classList.remove('active');
  for (const btn of tabContainer.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.blueprint === key);
  }
}

function buildTabs() {
  tabContainer.innerHTML = '';
  for (const entry of boardBlueprints) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (entry.id === activeBlueprintKey ? ' active' : '');
    btn.dataset.blueprint = entry.id;
    btn.textContent = entry.blueprint.name;
    btn.addEventListener('click', () => loadBlueprint(entry.id));
    tabContainer.appendChild(btn);
  }
}

// -----------------------------------------------------------------------------
// Buttons + keyboard shortcuts
// -----------------------------------------------------------------------------

connectBtn.addEventListener('click', () => {
  if (source.isConnected()) source.disconnect();
  else source.connect();
});

pauseBtn.addEventListener('click', () => setPaused(!paused));
resetZoomBtn.addEventListener('click', () => viewport.resetAllZoom());
clearBtn.addEventListener('click', () => { consoleEl.textContent = ''; });

// Theme + gradient are configured in config.js and applied by the inline
// <head> script before render. setTheme(id) and the data-gradient attr can
// still be set at runtime (e.g. from devtools) without persisting.

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

// Custom resize for the console dialog (we disabled native `resize: both`
// to get a larger custom cursor + larger hit zone).
const consoleResizeHandle = document.getElementById('consoleResizeHandle');
let resizeStart = null;

consoleResizeHandle.addEventListener('pointerdown', (e) => {
  const rect = consoleDialog.getBoundingClientRect();
  resizeStart = {
    startX: e.clientX,
    startY: e.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
  };
  consoleResizeHandle.setPointerCapture(e.pointerId);
  e.preventDefault();
});

consoleResizeHandle.addEventListener('pointermove', (e) => {
  if (!resizeStart) return;
  const dx = e.clientX - resizeStart.startX;
  const dy = e.clientY - resizeStart.startY;
  const w = Math.max(300, resizeStart.startWidth + dx);
  const h = Math.max(180, resizeStart.startHeight + dy);
  consoleDialog.style.width = w + 'px';
  consoleDialog.style.height = h + 'px';
});

consoleResizeHandle.addEventListener('pointerup', (e) => {
  if (!resizeStart) return;
  resizeStart = null;
  try { consoleResizeHandle.releasePointerCapture(e.pointerId); } catch (_) {}
});

// -----------------------------------------------------------------------------
// Right-side dock — independently toggleable panels (Camera, Teleop, ...)
// mounted outside the blueprint viewport so their state persists across
// Telemetry / PID Tuning swaps. Each panel lazy-mounts its view on open
// and destroys on close (releases ESP32 stream slot, clears any timers).
// Each pill toggles its own body[data-<key>] attribute and persists the
// state to localStorage.
// -----------------------------------------------------------------------------

const DOCK_PANELS = [
  {
    key: 'camera',
    bodyAttr: 'data-camera',
    storageKey: 'cameraOpen',
    pillId: 'cameraPill',
    panelId: 'cameraPanel',
    instance: null,
    factory: (panel) => new Vision(
      { type: 'vision', id: 'camera_dock', title: 'Camera' },
      panel,
      { connection: source, bus }
    ),
  },
  {
    key: 'teleop',
    bodyAttr: 'data-teleop',
    storageKey: 'teleopOpen',
    pillId: 'teleopPill',
    panelId: 'teleopPanel',
    instance: null,
    factory: (panel) => new Teleop(
      { type: 'teleop', id: 'teleop_dock', title: 'Drive' },
      panel,
      { connection: source, bus }
    ),
  },
];

function setDockOpen(panel, open) {
  const panelEl = document.getElementById(panel.panelId);
  const pillEl = document.getElementById(panel.pillId);
  if (open) {
    document.body.setAttribute(panel.bodyAttr, 'open');
    panelEl.setAttribute('aria-hidden', 'false');
    pillEl.classList.add('active');
    if (!panel.instance) panel.instance = panel.factory(panelEl);
  } else {
    document.body.removeAttribute(panel.bodyAttr);
    panelEl.setAttribute('aria-hidden', 'true');
    pillEl.classList.remove('active');
    if (panel.instance) {
      panel.instance.destroy();
      panel.instance = null;
    }
  }
  localStorage.setItem(panel.storageKey, open ? '1' : '0');
}

for (const panel of DOCK_PANELS) {
  const pillEl = document.getElementById(panel.pillId);
  pillEl.addEventListener('click', () => {
    const isOpen = document.body.getAttribute(panel.bodyAttr) === 'open';
    setDockOpen(panel, !isOpen);
  });
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

buildStatusPills();
wireComponentStatus();
buildTabs();
if (activeBlueprintKey) loadBlueprint(activeBlueprintKey);

// Dock panels start closed every session. Their toggle state is still
// written to localStorage (in setDockOpen) so persistence is one-line away
// if we ever want it as opt-in. For now, parity with Serial Console.
for (const panel of DOCK_PANELS) {
  localStorage.removeItem(panel.storageKey);
}
