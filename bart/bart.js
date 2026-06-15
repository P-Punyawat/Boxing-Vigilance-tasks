// ============================================================
//  BART — Balloon Analogue Risk Task
// ============================================================

'use strict';

// ============================================================
//  Configuration
// ============================================================

const CONFIG = {
  reward: 0.50,   // $ per pump
  maxPumps: 128,    // pre-determined pop range is [1, maxPumps]

  // Paste your deployed Apps Script URL here to enable automatic sheet submission.
  // Leave empty ('') to disable — CSV download will still work.
  sheetUrl: 'https://script.google.com/macros/s/AKfycbwO3gf4P2AfJadqalq4vgIc3ljNo1OHSvsOvUmlur0FMGm_qphbOwa4BzJYIKAw0GemSQ/exec',

  practice: { count: 2 },
  test: { count: 30 },

  timing: {
    pumpDelay: 150,   // ms — delay between pump click and re-enabling buttons
    intermission: 1500,  // ms — cash-in or popped graphic duration
    iti: 1000,  // ms — blank screen between balloons
  },
};

// ============================================================
//  Balloon colors
// ============================================================

const COLORS = [
  { fill: '#e74c3c', dark: '#c0392b' },
  { fill: '#e67e22', dark: '#d35400' },
  { fill: '#f1c40f', dark: '#f39c12' },
  { fill: '#2ecc71', dark: '#27ae60' },
  { fill: '#3498db', dark: '#2980b9' },
  { fill: '#9b59b6', dark: '#8e44ad' },
  { fill: '#e91e63', dark: '#c2185b' },
  { fill: '#1abc9c', dark: '#16a085' },
];

// ============================================================
//  Session state
// ============================================================

let participantId = '';
let sessionSeed = null;
let sessionId = '';
let practiceData = [];
let testData = [];
let audioCtx = null;

// ============================================================
//  Utilities
// ============================================================

// Mulberry32 seeded PRNG
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function seedFromString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

let rng = Math.random;

function randomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function fmt(n) {
  return '$' + n.toFixed(2);
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function randomColor() {
  return COLORS[Math.floor(rng() * COLORS.length)];
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  Audio (Web Audio API — no external files needed)
// ============================================================

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone(freq, startOffset, duration, type = 'sine', vol = 0.12) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = type;
    const t = ctx.currentTime + startOffset;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration);
  } catch (_) { }
}

function playChing() {
  // Quick two-note ding
  playTone(1320, 0, 0.09, 'sine', 0.12);
  playTone(1760, 0.07, 0.08, 'sine', 0.08);
}

function playPop() {
  // Burst of white noise
  try {
    const ctx = getAudioCtx();
    const frames = Math.floor(ctx.sampleRate * 0.14);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) * 0.5;
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.6;
    src.start();
  } catch (_) { }
}

function playCashIn() {
  // Short ascending melody: C E G C
  [523, 659, 784, 1047].forEach((f, i) => {
    playTone(f, i * 0.09, 0.16, 'triangle', 0.11);
  });
}

// ============================================================
//  SVG helpers
// ============================================================

function balloonSVG(color) {
  const { fill, dark } = color;
  return `
    <svg width="200" height="270" viewBox="0 0 200 270"
         xmlns="http://www.w3.org/2000/svg">
      <!-- Shadow -->
      <ellipse cx="103" cy="196" rx="50" ry="8" fill="rgba(0,0,0,0.18)"/>
      <!-- Body -->
      <ellipse cx="100" cy="98" rx="78" ry="84" fill="${fill}"/>
      <!-- Specular highlight -->
      <ellipse cx="72" cy="64" rx="22" ry="28"
               fill="rgba(255,255,255,0.27)"
               transform="rotate(-20,72,64)"/>
      <!-- Knot -->
      <path d="M93,182 Q100,194 107,182"
            stroke="${dark}" stroke-width="3.5"
            fill="none" stroke-linecap="round"/>
      <!-- String -->
      <path d="M100,194 Q83,224 103,252"
            stroke="#999" stroke-width="1.8" fill="none"/>
    </svg>`;
}

function poppedSVG() {
  return `
    <svg width="200" height="270" viewBox="0 0 200 270"
         xmlns="http://www.w3.org/2000/svg">
      <text x="100" y="148" text-anchor="middle" font-size="96">💥</text>
    </svg>`;
}

// ============================================================
//  DOM
// ============================================================

const app = document.getElementById('app');

function render(html) {
  app.innerHTML = html;
}

// ============================================================
//  Screen: Welcome
// ============================================================

function showWelcome() {
  render(`
    <a class="back-link" href="../">&#8592; Back</a>
    <div class="screen instructions">
      <h1>BART</h1>
      <p class="task-subtitle">Balloon Analogue Risk Task</p>

      <h2>Instructions</h2>
      <p>
        You will see a series of balloons, one at a time.
        For each balloon you have two choices:
      </p>

      <div class="rule-box">
        <p>
          <strong>PUMP <span class="key-hint">Space</span></strong> &mdash;
          Inflate the balloon and add <strong>$0.05</strong> to your
          temporary earnings. The balloon might pop!
        </p>
        <p style="margin-top:0.6rem">
          <strong>COLLECT <span class="key-hint">Enter</span></strong> &mdash;
          Bank your temporary earnings permanently and move to the next balloon.
        </p>
      </div>

      <p>
        If the balloon <strong>pops</strong>, you lose all temporary earnings
        for that balloon. Each balloon has a different breaking point —
        you won't know in advance.
      </p>

      <ul>
        <li>2 practice balloons come first.</li>
        <li>The main task has 30 balloons.</li>
        <li>Try to earn as much as possible!</li>
      </ul>

      <div class="input-group">
        <label for="pid">Participant ID</label>
        <input type="text" id="pid" placeholder="e.g. P001"
               autocomplete="off" maxlength="32">
      </div>

      <div style="text-align:center">
        <button class="btn" id="btn-start">Begin Practice</button>
      </div>
    </div>
  `);

  document.getElementById('btn-start').addEventListener('click', () => {
    participantId = document.getElementById('pid').value.trim() || 'anonymous';
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const datetimePrefix = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    sessionId = `${datetimePrefix}_${participantId}`;
    sessionSeed = seedFromString(sessionId);
    rng = mulberry32(sessionSeed);
    runBlock(CONFIG.practice.count, true, data => {
      practiceData = data;
      showPracticeFeedback(data);
    });
  });

  document.getElementById('pid').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-start').click();
  });
}

// ============================================================
//  Screen: Practice feedback
// ============================================================

function showPracticeFeedback(data) {
  const earned = data.filter(d => !d.popped).reduce((s, d) => s + d.earnings, 0);
  const pops = data.filter(d => d.popped).length;

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center;font-size:1.3rem">Practice Complete</h1>
      <p class="task-subtitle">Here's how you did</p>

      <div class="stats-grid">
        <div class="stat-box color-neutral">
          <div class="stat-value">${fmt(earned)}</div>
          <div class="stat-label">Practice Earnings<div class="stat-sub">(does not count)</div></div>
        </div>
        <div class="stat-box ${pops === 0 ? 'color-good' : 'color-warn'}">
          <div class="stat-value">${pops}&thinsp;/&thinsp;${data.length}</div>
          <div class="stat-label">Balloons Popped</div>
        </div>
      </div>

      <div style="text-align:center">
        <button class="btn" id="btn-main">Start Main Task</button>
        <button class="btn btn-outline" id="btn-redo">Redo Practice</button>
      </div>
    </div>
  `);

  document.getElementById('btn-main').addEventListener('click', () => {
    runBlock(CONFIG.test.count, false, data => {
      testData = data;
      showResults(data);
    });
  });

  document.getElementById('btn-redo').addEventListener('click', () => {
    runBlock(CONFIG.practice.count, true, data => {
      practiceData = data;
      showPracticeFeedback(data);
    });
  });
}

// ============================================================
//  Screen: Results
// ============================================================

function showResults(data) {
  const nonPopped = data.filter(d => !d.popped);
  const popped = data.filter(d => d.popped);
  const adjAvg = mean(nonPopped.map(d => d.pumps));
  const totalEarned = data.reduce((s, d) => s + d.earnings, 0);

  const popClass = popped.length <= 5 ? 'color-good'
    : popped.length <= 12 ? 'color-warn'
      : 'color-bad';

  const submitRow = CONFIG.sheetUrl
    ? `<div id="submit-status" class="submit-status">
         <span class="status-pending">Submitting data&#8230;</span>
       </div>`
    : '';

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center;font-size:1.3rem">Task Complete</h1>
      <p class="task-subtitle">Participant: ${escapeHtml(participantId)}</p>

      <div class="stats-grid">
        <div class="stat-box color-neutral">
          <div class="stat-value">${fmt(totalEarned)}</div>
          <div class="stat-label">Total Earnings</div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${adjAvg !== null ? adjAvg.toFixed(1) : '&#8212;'}</div>
          <div class="stat-label">Adj. Avg Pumps<div class="stat-sub">non-popped balloons only</div></div>
        </div>
        <div class="stat-box ${popClass}">
          <div class="stat-value">${popped.length}</div>
          <div class="stat-label">Explosions<div class="stat-sub">out of ${data.length}</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${nonPopped.length}</div>
          <div class="stat-label">Successful<div class="stat-sub">balloons collected</div></div>
        </div>
      </div>

      ${submitRow}

      <div class="btn-group">
        <button class="btn" id="btn-download">Download CSV</button>
        <button class="btn btn-outline" id="btn-restart">Restart</button>
        <a class="btn btn-outline" href="../">Task Selection</a>
      </div>
    </div>
  `);

  document.getElementById('btn-download').addEventListener('click', () => {
    exportCSV([...practiceData, ...testData]);
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    practiceData = [];
    testData = [];
    showWelcome();
  });

}

// ============================================================
//  Block runner
// ============================================================

function runBlock(count, isPractice, onComplete) {
  const blockData = [];
  let idx = 0;
  let permanentBank = 0;

  function next() {
    if (idx >= count) {
      onComplete(blockData);
      return;
    }

    runBalloon({
      num: idx + 1,
      total: count,
      popPoint: randomInt(1, CONFIG.maxPumps),
      color: randomColor(),
      isPractice,
      permanentBank,
    }, result => {
      const earnings = result.popped ? 0 : result.pumps * CONFIG.reward;
      if (!result.popped) permanentBank += earnings;

      blockData.push({
        block: isPractice ? 'practice' : 'test',
        balloonNum: idx + 1,
        popPoint: result.popPoint,
        pumps: result.pumps,
        popped: result.popped,
        earnings,
        permanentBank,
      });
      submitToSheet(blockData[blockData.length - 1]);
      idx++;
      next();
    });
  }

  next();
}

// ============================================================
//  Single balloon
// ============================================================

function runBalloon({ num, total, popPoint, color, isPractice, permanentBank }, onComplete) {
  let pumps = 0;
  let busy = false;   // debounce — prevents double-clicks and key spam

  // Full-viewport overlay
  const overlay = document.createElement('div');
  overlay.className = 'balloon-overlay';
  document.body.appendChild(overlay);
  app.innerHTML = '';

  // ---- Helpers ----

  function tempEarnings() { return pumps * CONFIG.reward; }

  function disableAll() {
    ['btn-pump', 'btn-collect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }

  function updateUI() {
    const scaleEl = document.getElementById('b-scale');
    const tempEl = document.getElementById('b-temp');
    const colBtn = document.getElementById('btn-collect');
    if (scaleEl) {
      const s = 0.3 + (pumps / CONFIG.maxPumps) * 2.2;
      scaleEl.style.transform = `scale(${s})`;
    }
    if (tempEl) tempEl.textContent = fmt(tempEarnings());
    if (colBtn) {
      colBtn.textContent = `Collect ${fmt(tempEarnings())}`;
      colBtn.disabled = pumps === 0;
    }
  }

  function finish(popped) {
    document.removeEventListener('keydown', keyHandler);
    overlay.remove();
    onComplete({ pumps, popped, popPoint });
  }

  // ---- Pump action ----

  function doPump() {
    if (busy) return;
    busy = true;
    disableAll();
    pumps++;

    if (pumps >= popPoint) {
      // Balloon pops
      playPop();
      flashScreen();
      const scaleEl = document.getElementById('b-scale');
      if (scaleEl) scaleEl.innerHTML = poppedSVG();

      setTimeout(() => showIntermission(overlay, true, 0, () => finish(true)), 0);

    } else {
      // Successful pump — animate and re-enable
      playChing();
      updateUI();

      setTimeout(() => {
        busy = false;
        const p = document.getElementById('btn-pump');
        const c = document.getElementById('btn-collect');
        if (p) p.disabled = false;
        if (c) c.disabled = false;
      }, CONFIG.timing.pumpDelay);
    }
  }

  // ---- Collect action ----

  function doCollect() {
    if (busy || pumps === 0) return;
    busy = true;
    disableAll();
    playCashIn();
    showIntermission(overlay, false, tempEarnings(), () => finish(false));
  }

  // ---- Keyboard shortcuts ----

  function keyHandler(e) {
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); doPump(); }
    if (e.code === 'Enter' && !e.repeat) { e.preventDefault(); doCollect(); }
  }

  // ---- Render overlay ----

  overlay.innerHTML = `
    <div class="b-header">
      <div class="b-bank">
        <div class="b-bank-label">Total Earned</div>
        <div class="b-bank-value">${fmt(permanentBank)}</div>
      </div>
      <div class="b-counter">
        ${num}&thinsp;/&thinsp;${total}
        ${isPractice ? '<span class="practice-tag">practice</span>' : ''}
      </div>
      <div class="b-bank">
        <div class="b-bank-label">This Balloon</div>
        <div class="b-bank-value" id="b-temp">${fmt(0)}</div>
      </div>
    </div>

    <div class="b-stage">
      <div class="b-balloon-wrap">
        <div id="b-scale"
             style="transform:scale(0.3);
                    transform-origin:center bottom;
                    transition:transform 0.12s ease-out;">
          ${balloonSVG(color)}
        </div>
      </div>
    </div>

    <div class="b-controls">
      <button class="bart-btn pump-btn"    id="btn-pump">PUMP</button>
      <button class="bart-btn collect-btn" id="btn-collect" disabled>
        Collect ${fmt(0)}
      </button>
    </div>
  `;

  document.getElementById('btn-pump').addEventListener('click', doPump);
  document.getElementById('btn-collect').addEventListener('click', doCollect);
  document.addEventListener('keydown', keyHandler);
}

// ============================================================
//  Intermission (cash-in or popped graphic)
// ============================================================

function showIntermission(overlay, popped, amount, onDone) {
  overlay.innerHTML = popped
    ? `<div class="intermission">
         <div class="intermission-icon">&#128165;</div>
         <div class="intermission-title pop-title">POPPED!</div>
         <div class="intermission-sub">Lost temporary earnings</div>
       </div>`
    : `<div class="intermission">
         <div class="intermission-icon">&#128176;</div>
         <div class="intermission-title cash-title">+${fmt(amount)}</div>
         <div class="intermission-sub">Added to your total</div>
       </div>`;

  setTimeout(() => {
    overlay.innerHTML = '';           // blank ITI screen
    setTimeout(onDone, CONFIG.timing.iti);
  }, CONFIG.timing.intermission);
}

function flashScreen() {
  const f = document.createElement('div');
  f.className = 'flash-overlay';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 300);
}

// ============================================================
//  Google Sheets submission
// ============================================================

function submitToSheet(d) {
  if (!CONFIG.sheetUrl) return;
  const row = [
    sessionId, sessionSeed,
    d.block, d.balloonNum, d.popPoint, d.pumps,
    d.popped ? 1 : 0, d.earnings.toFixed(2), d.permanentBank.toFixed(2),
  ];
  const body = new FormData();
  body.append('sheet', 'BART Data');
  body.append('payload', JSON.stringify([row]));
  fetch(CONFIG.sheetUrl, { method: 'POST', mode: 'no-cors', body }).catch(() => { });
}

// ============================================================
//  CSV export
// ============================================================

function exportCSV(data) {
  const headers = [
    'participant_id', 'seed', 'block', 'balloon_num', 'pop_point',
    'pumps', 'popped', 'earnings', 'permanent_bank_after',
  ];

  const rows = data.map(d => [
    sessionId, sessionSeed,
    d.block,
    d.balloonNum,
    d.popPoint,
    d.pumps,
    d.popped ? 1 : 0,
    d.earnings.toFixed(2),
    d.permanentBank.toFixed(2),
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BART_${sessionId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
//  Boot
// ============================================================

window.addEventListener('load', showWelcome);
