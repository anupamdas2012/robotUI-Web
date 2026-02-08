// Web Serial Dashboard for Pico 2 Motor Control

const MAX_POINTS = 200;
const MAX_CONSOLE_LINES = 500;
const DISCONNECT_TIMEOUT_MS = 2000;

// State
let port = null;
let reader = null;
let lastDataTime = 0;
let disconnectTimer = null;
let lineBuf = '';

// Chart data arrays
const data = {
  rpmL: [], rpmR: [],
  tofDist: [],
  heading: [], pitch: [], roll: [],
  loopAvg: [], loopMax: [],
  labels: []
};
let sampleIndex = 0;

// DOM elements
const connectBtn = document.getElementById('connectBtn');
const clearBtn = document.getElementById('clearBtn');
const consoleEl = document.getElementById('console');
const dotMotors = document.getElementById('dotMotors');
const dotIMU = document.getElementById('dotIMU');
const dotToF = document.getElementById('dotToF');

// Current value displays
const valRpmL = document.getElementById('valRpmL');
const valRpmR = document.getElementById('valRpmR');
const valToF = document.getElementById('valToF');
const valHeading = document.getElementById('valHeading');
const valPitch = document.getElementById('valPitch');
const valRoll = document.getElementById('valRoll');
const valLoopAvg = document.getElementById('valLoopAvg');
const valLoopMax = document.getElementById('valLoopMax');

// Chart.js defaults for dark theme
Chart.defaults.color = '#888';
Chart.defaults.borderColor = '#2a2a3e';

function createChart(canvasId, datasets, yLabel) {
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: {
      labels: [],
      datasets: datasets.map(ds => ({
        label: ds.label,
        data: [],
        borderColor: ds.color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2
      }))
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: true,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 12 } } },
      scales: {
        x: { display: false },
        y: { title: { display: !!yLabel, text: yLabel, font: { size: 11 } }, beginAtZero: false }
      }
    }
  });
}

const chartRPM = createChart('chartRPM', [
  { label: 'Left', color: '#4cc9f0' },
  { label: 'Right', color: '#f72585' }
], 'RPM');

const chartToF = createChart('chartToF', [
  { label: 'Distance', color: '#4ade80' }
], 'mm');

const chartIMU = createChart('chartIMU', [
  { label: 'Heading', color: '#f59e0b' },
  { label: 'Pitch', color: '#4cc9f0' },
  { label: 'Roll', color: '#f72585' }
], 'degrees');

const chartLoop = createChart('chartLoop', [
  { label: 'Avg', color: '#8b5cf6' },
  { label: 'Max', color: '#ef4444' }
], 'us');

function pushData(arr, val) {
  arr.push(val);
  if (arr.length > MAX_POINTS) arr.shift();
}

function updateChart(chart, ...dataArrays) {
  chart.data.labels = data.labels.slice(-MAX_POINTS);
  dataArrays.forEach((arr, i) => {
    chart.data.datasets[i].data = arr.slice(-MAX_POINTS);
  });
  chart.update('none');
}

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
  if (!line.startsWith('$')) {
    appendConsole(line);
    return;
  }

  appendConsole(line);
  lastDataTime = Date.now();

  const parts = line.split(',');
  const type = parts[0];

  if (type === '$STA') {
    const imuConn = parts[1] === '1';
    const tofConn = parts[2] === '1';
    setDot(dotMotors, 'on');
    setDot(dotIMU, imuConn ? 'on' : 'off');
    setDot(dotToF, tofConn ? 'on' : 'off');
  } else if (type === '$MOT') {
    const rpmL = parseFloat(parts[1]);
    const rpmR = parseFloat(parts[2]);
    const loopAvg = parseInt(parts[5]);
    const loopMax = parseInt(parts[6]);

    sampleIndex++;
    pushData(data.labels, sampleIndex);
    pushData(data.rpmL, rpmL);
    pushData(data.rpmR, rpmR);
    pushData(data.loopAvg, loopAvg);
    pushData(data.loopMax, loopMax);

    valRpmL.textContent = 'L: ' + rpmL.toFixed(1);
    valRpmR.textContent = 'R: ' + rpmR.toFixed(1);
    valLoopAvg.textContent = 'Avg: ' + loopAvg + 'us';
    valLoopMax.textContent = 'Max: ' + loopMax + 'us';

    updateChart(chartRPM, data.rpmL, data.rpmR);
    updateChart(chartLoop, data.loopAvg, data.loopMax);
  } else if (type === '$IMU') {
    const h = parseFloat(parts[1]);
    const p = parseFloat(parts[2]);
    const r = parseFloat(parts[3]);

    pushData(data.heading, h);
    pushData(data.pitch, p);
    pushData(data.roll, r);

    valHeading.textContent = 'H: ' + h.toFixed(1);
    valPitch.textContent = 'P: ' + p.toFixed(1);
    valRoll.textContent = 'R: ' + r.toFixed(1);

    updateChart(chartIMU, data.heading, data.pitch, data.roll);
  } else if (type === '$TOF') {
    const dist = parseInt(parts[1]);
    const valid = parts[2] === '1';

    if (valid) {
      pushData(data.tofDist, dist);
      valToF.textContent = dist + ' mm';
    } else {
      pushData(data.tofDist, null);
      valToF.textContent = '-- mm';
    }

    updateChart(chartToF, data.tofDist);
  }
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
  const inputDone = port.readable.pipeTo(decoder.writable);
  const inputStream = decoder.readable;
  reader = inputStream.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        lineBuf += value;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop(); // keep incomplete line in buffer
        for (const line of lines) {
          const trimmed = line.replace(/\r$/, '');
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

connectBtn.addEventListener('click', () => {
  if (port) disconnect();
  else connect();
});

clearBtn.addEventListener('click', () => {
  consoleEl.textContent = '';
});

// Console dialog toggle
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

// Drag to reposition console dialog
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
