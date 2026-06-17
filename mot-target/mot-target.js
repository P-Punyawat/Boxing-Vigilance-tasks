// ============================================================
//  MOT Capacity — Multi-Object Tracking
//  2-Down / 1-Up staircase on target count (1–6 of 10 circles)
// ============================================================
'use strict';

// ============================================================
//  Configuration
// ============================================================

const IS_EEG = !!window.eeg;

const CONFIG = {
  sheetUrl: 'https://script.google.com/macros/s/AKfycbwO3gf4P2AfJadqalq4vgIc3ljNo1OHSvsOvUmlur0FMGm_qphbOwa4BzJYIKAw0GemSQ/exec',

  arena: { w: 700, h: 480 },
  circle: { r: 20 },   // slightly smaller to fit 10 circles
  minGap: 12,

  timing: {
    init: 2000,
    cue: 2000,
    track: 5000,
    response: 5000,
    feedback: 900,
    iti: 500,
  },

  speed: { fixed: 260 },   // px/s — normalised for r=20 vs MOT-speed's r=22 at 300 px/s

  test: {
    totalObjects: 10,
    startTargets: 3,
    minTargets: 1,
    maxTargets: 6,
  },

  practice: {
    sequence: [1, 1, 2, 2, 3, 3, 4, 4],
    totalObjects: 8,
    speed: 200,
  },

  staircase: {
    correctNeeded: 2,   // 2-down rule
    reversalStop: 8,   // stop after 8 reversals (adaptive mode)
    maxTrials: 40,
    floorFailStop: 3,   // stop after 3 consecutive fails at 1-target floor
  },
};

// ============================================================
//  Session state
// ============================================================

let participantId = '';
let sessionSeed = null;
let sessionId = '';
let testMode = IS_EEG ? 'fixed' : 'adaptive';   // EEG: full 40 trials; Browser: adaptive short
let practiceData = [];
let testData = [];

let SC = {
  targetCount: CONFIG.test.startTargets,
  consecutiveCorrect: 0,
  prevDirection: null,
  reversalCount: 0,
  reversalTargets: [],
  consecutiveFloor: 0,
};

// ============================================================
//  DOM
// ============================================================

const app = document.getElementById('app');
function render(html) { app.innerHTML = html; }

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

function rand(a, b) { return rng() * (b - a) + a; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
//  Audio (Web Audio API — no external files needed)
// ============================================================

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, startOffset, duration, type = 'sine', vol = 0.10) {
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

function playTick() {
  playTone(800, 0, 0.05, 'sine', 0.09);
}

function playChing() {
  playTone(1320, 0, 0.09, 'sine', 0.12);
  playTone(1760, 0.07, 0.08, 'sine', 0.08);
}

// ============================================================
//  EEG guard functions — no-ops in browser, active in Electron
// ============================================================

function sendTrigger(code) {
  if (window.eeg) window.eeg.sendTrigger(code);
}

function submitData(d) {
  const headers = ['participant_id', 'seed', 'block', 'trial_num', 'num_targets',
    'speed_px_s', 'correct', 'reversal_count', 'selected_ids', 'target_ids'];
  const values = [
    sessionId, sessionSeed, d.block, d.trialNum, d.numTargets,
    Math.round(d.speed), d.correct ? 1 : 0, d.reversalCount ?? '',
    (d.selectedIds || []).join(';'), (d.targetIds || []).join(';'),
  ];
  if (window.eeg) {
    window.eeg.saveRow('MOT_Capacity', sessionId, headers, values);
  } else {
    submitToSheet(d);
  }
}

// ============================================================
//  Physics helpers
// ============================================================

function spawnObjects(count, speed) {
  const { w, h } = CONFIG.arena;
  const r = CONFIG.circle.r;
  const minD = 2 * r + CONFIG.minGap;
  const objs = [];
  let tries = 0;

  while (objs.length < count) {
    if (++tries > 30000) break;
    const x = rand(r + 15, w - r - 15);
    const y = rand(r + 15, h - r - 15);
    if (objs.some(o => Math.hypot(x - o.x, y - o.y) < minD)) continue;
    const angle = rand(0, Math.PI * 2);
    objs.push({
      id: objs.length, x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      isTarget: false, selected: false
    });
  }
  return objs;
}

function assignTargets(objs, n) {
  const ids = shuffle(objs.map(o => o.id)).slice(0, n);
  objs.forEach(o => { o.isTarget = ids.includes(o.id); });
}

function stepPhysics(objs, dt) {
  const { w, h } = CONFIG.arena;
  const r = CONFIG.circle.r;

  for (const o of objs) {
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (o.x - r < 0) { o.x = r; o.vx = Math.abs(o.vx); }
    if (o.x + r > w) { o.x = w - r; o.vx = -Math.abs(o.vx); }
    if (o.y - r < 0) { o.y = r; o.vy = Math.abs(o.vy); }
    if (o.y + r > h) { o.y = h - r; o.vy = -Math.abs(o.vy); }
  }

  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i], b = objs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const minD = 2 * r;
      if (d >= minD || d < 0.001) continue;

      const nx = dx / d, ny = dy / d;
      const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rv > 0) {
        a.vx -= rv * nx; a.vy -= rv * ny;
        b.vx += rv * nx; b.vy += rv * ny;
      }
      const pen = (minD - d) * 0.5;
      a.x -= nx * pen; a.y -= ny * pen;
      b.x += nx * pen; b.y += ny * pen;
    }
  }
}

// ============================================================
//  Canvas drawing
// ============================================================

function drawArena(ctx, objs, phase, hoveredId) {
  const { w, h } = CONFIG.arena;
  const r = CONFIG.circle.r;

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  for (const o of objs) {
    const hov = (phase === 'response') && o.id === hoveredId;

    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
    if (phase === 'cue' && o.isTarget) ctx.fillStyle = 'rgba(231,76,60,0.55)';
    else if (phase === 'response' && o.selected) ctx.fillStyle = 'rgba(58,157,229,0.55)';
    else if (phase === 'response' && hov) ctx.fillStyle = 'rgba(255,255,255,0.08)';
    else if (phase === 'feedback' && o.isTarget && o.selected) ctx.fillStyle = 'rgba(76,175,80,0.55)';
    else if (phase === 'feedback' && o.isTarget && !o.selected) ctx.fillStyle = 'rgba(244,67,54,0.55)';
    else if (phase === 'feedback' && !o.isTarget && o.selected) ctx.fillStyle = 'rgba(255,193,7,0.45)';
    else ctx.fillStyle = '#242424';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
    if (phase === 'cue' && o.isTarget) { ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 3; }
    else if (phase === 'response' && o.selected) { ctx.strokeStyle = '#3a9de5'; ctx.lineWidth = 3; }
    else if (phase === 'response' && hov) { ctx.strokeStyle = '#999'; ctx.lineWidth = 2; }
    else if (phase === 'feedback' && o.isTarget && o.selected) { ctx.strokeStyle = '#4CAF50'; ctx.lineWidth = 3; }
    else if (phase === 'feedback' && o.isTarget && !o.selected) { ctx.strokeStyle = '#f44336'; ctx.lineWidth = 3; }
    else if (phase === 'feedback' && !o.isTarget && o.selected) { ctx.strokeStyle = '#FFC107'; ctx.lineWidth = 2; }
    else { ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 1.5; }
    ctx.stroke();
  }

  if (phase === 'feedback') {
    const allCorrect = objs.every(o =>
      (o.isTarget && o.selected) || (!o.isTarget && !o.selected));
    ctx.font = 'bold 40px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = allCorrect ? 'rgba(76,175,80,0.9)' : 'rgba(244,67,54,0.9)';
    ctx.fillText(allCorrect ? 'CORRECT' : 'INCORRECT', w / 2, h / 2);
  }
}

// ============================================================
//  Trial runner
// ============================================================

const PHASE_LABELS = {
  init: 'INITIALIZING',
  cue: 'MEMORIZE TARGETS',
  track: 'TRACKING',
  response: 'SELECT TARGETS',
  feedback: 'RESULT',
};

function runTrial({ numTargets, speed, totalObjects, isPractice, trialNum, totalTrials }, onComplete) {
  const overlay = document.createElement('div');
  overlay.className = 'mot-overlay';
  document.body.appendChild(overlay);

  overlay.innerHTML = `
    <div class="mot-top">
      <div class="mot-phase" id="mot-phase">${PHASE_LABELS.init}</div>
      <div class="mot-trial">
        ${trialNum}&thinsp;/&thinsp;${totalTrials}
        ${isPractice ? '<span class="practice-tag">practice</span>' : ''}
      </div>
      <button id="btn-save-now" class="save-now-btn">Save data</button>
    </div>
    <div class="mot-arena">
      <canvas id="arena" width="${CONFIG.arena.w}" height="${CONFIG.arena.h}"></canvas>
    </div>
    <div class="mot-bottom">
      <div class="mot-selection" id="mot-sel"></div>
      <div class="mot-timer-wrap"><div class="mot-timer" id="mot-timer"></div></div>
      <button class="btn confirm-btn" id="btn-confirm" disabled style="display:none">Confirm</button>
    </div>
  `;

  document.getElementById('btn-save-now').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-now');
    if (!btn || btn.disabled) return;

    const allData = [...practiceData, ...testData];
    if (!allData.length) {
      btn.textContent = 'No data yet';
      setTimeout(() => { const b = document.getElementById('btn-save-now'); if (b) b.textContent = 'Save data'; }, 2000);
      return;
    }

    btn.textContent = `Saving ${allData.length} rows…`;
    btn.disabled = true;

    try {
      const rows = allData.map(d => [
        participantId, d.block, d.trialNum, d.numTargets, Math.round(d.speed),
        d.correct ? 1 : 0, d.reversalCount ?? '',
        (d.selectedIds || []).join(';'), (d.targetIds || []).join(';'),
      ]);
      const body = new FormData();
      body.append('sheet', 'MOT Capacity Data');
      body.append('payload', JSON.stringify(rows));
      const res = await fetch(CONFIG.sheetUrl, { method: 'POST', body });
      const json = await res.json();
      btn.textContent = json.status === 'ok' ? `Saved ${json.n} ✓` : `Error: ${json.message}`;
    } catch (err) {
      btn.textContent = 'Failed — see console';
      console.error('[MOT Target] save failed:', err);
    }

    setTimeout(() => {
      const b = document.getElementById('btn-save-now');
      if (b) { b.textContent = 'Save data'; b.disabled = false; }
    }, 3000);
  });

  const canvas = document.getElementById('arena');
  const ctx = canvas.getContext('2d');
  const phaseEl = document.getElementById('mot-phase');
  const selEl = document.getElementById('mot-sel');
  const timerEl = document.getElementById('mot-timer');
  const confirmBtn = document.getElementById('btn-confirm');

  const objs = spawnObjects(totalObjects, speed);
  assignTargets(objs, numTargets);

  let phase = 'init';
  let phaseStart = performance.now();
  let animId = null;
  let hoveredId = -1;
  let selected = new Set();
  let finished = false;

  const DUR = {
    init: CONFIG.timing.init, cue: CONFIG.timing.cue,
    track: CONFIG.timing.track, response: CONFIG.timing.response,
  };

  function canvasXY(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (CONFIG.arena.w / rect.width),
      y: (e.clientY - rect.top) * (CONFIG.arena.h / rect.height),
    };
  }

  function circleAt(x, y) {
    const r = CONFIG.circle.r;
    return objs.find(o => Math.hypot(x - o.x, y - o.y) <= r) ?? null;
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(animId);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('click', onCanvasClick);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    confirmBtn.removeEventListener('click', onConfirm);

    const selectedIds = [...selected];
    const targetIds = objs.filter(o => o.isTarget).map(o => o.id);
    const correct = selectedIds.length === numTargets &&
      selectedIds.every(id => targetIds.includes(id));

    sendTrigger(TRIG.MOT_CONFIRM);
    sendTrigger(correct ? TRIG.MOT_CORRECT : TRIG.MOT_INCORRECT);

    objs.forEach(o => { o.selected = selected.has(o.id); });
    phase = 'feedback';
    phaseEl.textContent = PHASE_LABELS.feedback;
    confirmBtn.style.display = 'none';
    selEl.textContent = '';
    timerEl.style.width = '0%';
    drawArena(ctx, objs, 'feedback', -1);

    setTimeout(() => {
      overlay.remove();
      onComplete({ correct, selectedIds, targetIds, speed });
    }, CONFIG.timing.feedback + CONFIG.timing.iti);
  }

  const PHASE_TRIGS = { cue: TRIG.MOT_CUE, track: TRIG.MOT_TRACK, response: TRIG.MOT_RESPONSE };

  function setPhase(p) {
    sendTrigger(PHASE_TRIGS[p]);
    phase = p;
    phaseStart = performance.now();
    phaseEl.textContent = PHASE_LABELS[p];

    if (p === 'response') {
      selected.clear();
      selEl.textContent = `0 / ${numTargets} selected`;
      confirmBtn.style.display = 'inline-block';
      confirmBtn.disabled = true;
      timerEl.style.background = '#e67e22';
    } else {
      confirmBtn.style.display = 'none';
      selEl.textContent = '';
      timerEl.style.background = '#3a7bd5';
    }
  }

  function onMouseMove(e) {
    if (phase !== 'response') return;
    const { x, y } = canvasXY(e);
    const o = circleAt(x, y);
    hoveredId = o ? o.id : -1;
    canvas.style.cursor = o ? 'pointer' : 'default';
  }

  function onCanvasClick(e) {
    if (phase !== 'response') return;
    const { x, y } = canvasXY(e);
    const o = circleAt(x, y);
    if (!o) return;
    playTick();
    if (selected.has(o.id)) { selected.delete(o.id); o.selected = false; }
    else { selected.add(o.id); o.selected = true; }
    selEl.textContent = `${selected.size} / ${numTargets} selected`;
    confirmBtn.disabled = selected.size !== numTargets;
  }

  function onTouchMove(e) {
    if (phase !== 'response') return;
    e.preventDefault();
    const touch = e.touches[0];
    const { x, y } = canvasXY(touch);
    const o = circleAt(x, y);
    hoveredId = o ? o.id : -1;
  }

  function onTouchEnd(e) {
    if (phase !== 'response') return;
    e.preventDefault();
    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const { x, y } = canvasXY(touch);
    const o = circleAt(x, y);
    if (!o) return;
    playTick();
    if (selected.has(o.id)) { selected.delete(o.id); o.selected = false; }
    else { selected.add(o.id); o.selected = true; }
    selEl.textContent = `${selected.size} / ${numTargets} selected`;
    confirmBtn.disabled = selected.size !== numTargets;
  }

  function onConfirm() { playChing(); finish(); }

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  confirmBtn.addEventListener('click', onConfirm);

  let lastTs = null;

  function loop(ts) {
    if (finished) return;
    const dt = lastTs === null ? 0 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    const elapsed = ts - phaseStart;

    if (phase === 'init' && elapsed >= DUR.init) setPhase('cue');
    else if (phase === 'cue' && elapsed >= DUR.cue) setPhase('track');
    else if (phase === 'track' && elapsed >= DUR.track) setPhase('response');
    else if (phase === 'response' && elapsed >= DUR.response) { finish(); return; }

    if (phase === 'track') stepPhysics(objs, dt);

    if (phase === 'track' || phase === 'response') {
      const pct = Math.max(0, 1 - elapsed / DUR[phase]) * 100;
      timerEl.style.width = pct + '%';
    } else {
      timerEl.style.width = '100%';
    }

    drawArena(ctx, objs, phase, hoveredId);
    animId = requestAnimationFrame(loop);
  }

  sendTrigger(TRIG.MOT_INIT);
  animId = requestAnimationFrame(loop);
}

// ============================================================
//  Staircase (2-Down / 1-Up on target count)
// ============================================================

function updateStaircase(correct) {
  if (correct) {
    SC.consecutiveCorrect++;
    SC.consecutiveFloor = 0;
    if (SC.consecutiveCorrect >= CONFIG.staircase.correctNeeded) {
      SC.consecutiveCorrect = 0;
      if (SC.targetCount < CONFIG.test.maxTargets) {
        if (SC.prevDirection === 'down') {
          SC.reversalCount++;
          SC.reversalTargets.push(SC.targetCount);
        }
        SC.prevDirection = 'up';
        SC.targetCount++;
      }
    }
  } else {
    SC.consecutiveCorrect = 0;
    if (SC.targetCount > CONFIG.test.minTargets) {
      if (SC.prevDirection === 'up') {
        SC.reversalCount++;
        SC.reversalTargets.push(SC.targetCount);
      }
      SC.prevDirection = 'down';
      SC.targetCount--;
    } else {
      SC.consecutiveFloor++;
    }
  }
}

function shouldStop() {
  if (testMode === 'adaptive') {
    return SC.reversalCount >= CONFIG.staircase.reversalStop ||
      SC.consecutiveFloor >= CONFIG.staircase.floorFailStop ||
      testData.length >= CONFIG.staircase.maxTrials;
  }
  return testData.length >= CONFIG.staircase.maxTrials;
}

function computeKValue() {
  if (testMode === 'adaptive') {
    const rev = SC.reversalTargets;
    if (rev.length >= 4) return median(rev.slice(-4));
    return rev.length ? median(rev) : SC.targetCount;
  }
  const last15 = testData.slice(-15).map(d => d.numTargets);
  return last15.length ? mean(last15) : SC.targetCount;
}

// ============================================================
//  Block runners
// ============================================================

function runPractice(onComplete) {
  const seq = CONFIG.practice.sequence;
  const data = [];
  let idx = 0;
  sendTrigger(TRIG.BLOCK_PRACTICE);

  function next() {
    if (idx >= seq.length) { onComplete(data); return; }
    runTrial({
      numTargets: seq[idx],
      speed: CONFIG.practice.speed,
      totalObjects: CONFIG.practice.totalObjects,
      isPractice: true,
      trialNum: idx + 1,
      totalTrials: seq.length,
    }, result => {
      data.push({
        block: 'practice', trialNum: idx + 1,
        numTargets: seq[idx], speed: CONFIG.practice.speed, ...result
      });
      submitData(data[data.length - 1]);
      idx++;
      next();
    });
  }
  next();
}

function runTest(onComplete) {
  SC = {
    targetCount: CONFIG.test.startTargets,
    consecutiveCorrect: 0,
    prevDirection: null,
    reversalCount: 0,
    reversalTargets: [],
    consecutiveFloor: 0,
  };
  testData = [];
  sendTrigger(TRIG.BLOCK_TEST);

  function next() {
    if (shouldStop()) { onComplete(testData); return; }
    const numTargets = SC.targetCount;
    const trialNum = testData.length + 1;

    runTrial({
      numTargets,
      speed: CONFIG.speed.fixed,
      totalObjects: CONFIG.test.totalObjects,
      isPractice: false,
      trialNum,
      totalTrials: CONFIG.staircase.maxTrials,
    }, result => {
      testData.push({
        block: 'test', trialNum, numTargets,
        speed: CONFIG.speed.fixed, reversalCount: SC.reversalCount, ...result,
      });
      submitData(testData[testData.length - 1]);
      updateStaircase(result.correct);
      next();
    });
  }
  next();
}

// ============================================================
//  Screens
// ============================================================

function showWelcome() {
  render(`
    <a class="back-link" href="../">&#8592; Back</a>
    <div class="screen instructions">
      <h1>MOT &mdash; Capacity</h1>
      <p class="task-subtitle">Multi-Object Tracking &mdash; Target Capacity &mdash; Pylyshyn &amp; Storm, 1988</p>

      <div class="task-demo">
        <canvas id="mot-cap-demo" class="demo-canvas" width="540" height="160"></canvas>
      </div>

      <h2>How it works</h2>
      <p>Ten identical circles appear in a bounding arena. A subset flashes red — those are your <strong>targets</strong>. Once highlights disappear all circles look the same and start moving. Track your targets for 5 seconds, then click the ones you were following.</p>

      <div class="rule-box">
        <p><strong>Phase 1 &mdash; Init (2 s):</strong> 10 static circles appear.</p>
        <p><strong>Phase 2 &mdash; Cue (2 s):</strong> Targets flash red &mdash; memorize them.</p>
        <p><strong>Phase 3 &mdash; Track (5 s):</strong> All circles move identically &mdash; track your targets.</p>
        <p><strong>Phase 4 &mdash; Respond (5 s):</strong> Motion freezes &mdash; click the targets.</p>
      </div>

      <p>The number of targets adapts automatically: get 2 correct in a row → +1 target. Any mistake → &minus;1 target. The task homes in on your tracking <strong>capacity (K-value)</strong>: how many objects you can follow simultaneously.</p>

      <ul>
        <li>Targets range from 1 to 6 (out of 10 circles).</li>
        <li>Speed stays fixed throughout; only the target count changes.</li>
      </ul>

      ${IS_EEG ? `
      <h2>Test version</h2>
      <div class="version-choice">
        <label class="radio-label">
          <input type="radio" name="ver" value="fixed" checked>
          Full — 40 trials (K-value = avg target count of last 15 trials)
        </label>
        <label class="radio-label">
          <input type="radio" name="ver" value="adaptive">
          Short — stops after 8 reversals or 3 floor fails (~20 trials; K-value = median of last 4 reversal counts)
        </label>
      </div>` : ''}

      <h2>Practice</h2>
      <p>8 practice trials (1 → 4 targets, 8 circles) run first at a slower speed so you can learn the task.</p>

      <div class="input-group">
        <label for="pid">Participant ID</label>
        <input type="text" id="pid" placeholder="e.g. P001" autocomplete="off" maxlength="32">
      </div>

      <div style="text-align:center">
        <button class="btn" id="btn-start">Begin Practice</button>
      </div>
    </div>
  `);

  // --- MOT demo animation ---
  let _demoAnimId = null;
  {
    const canvas = document.getElementById('mot-cap-demo');
    const ctx    = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const DR = 13, DGAP = 8, DN = 6, DT = 2, DSPEED = 110;
    const DMIN = 2 * DR + DGAP;

    const demoPhases    = ['init', 'cue', 'track', 'response', 'feedback'];
    const demoDurations = { init: 1500, cue: 2000, track: 3000, response: 1500, feedback: 1200 };
    const demoLabels    = {
      init: 'CIRCLES APPEAR', cue: 'MEMORISE TARGETS',
      track: 'TRACK — DON\'T LOSE THEM', response: 'SELECT YOUR TARGETS', feedback: 'CORRECT!',
    };

    function demoSpawn() {
      const objs = [];
      let tries = 0;
      while (objs.length < DN) {
        if (++tries > 8000) break;
        const x = DR + 8 + Math.random() * (W - 2 * DR - 16);
        const y = DR + 8 + Math.random() * (H - 2 * DR - 16);
        if (objs.some(o => Math.hypot(x - o.x, y - o.y) < DMIN)) continue;
        const a = Math.random() * Math.PI * 2;
        objs.push({ id: objs.length, x, y, vx: Math.cos(a) * DSPEED, vy: Math.sin(a) * DSPEED, isTarget: false, selected: false });
      }
      const ids = [...objs].sort(() => Math.random() - 0.5).slice(0, DT).map(o => o.id);
      objs.forEach(o => { o.isTarget = ids.includes(o.id); });
      return objs;
    }

    function demoStep(objs, dt) {
      for (const o of objs) {
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x - DR < 0)  { o.x = DR;     o.vx =  Math.abs(o.vx); }
        if (o.x + DR > W)  { o.x = W - DR;  o.vx = -Math.abs(o.vx); }
        if (o.y - DR < 0)  { o.y = DR;      o.vy =  Math.abs(o.vy); }
        if (o.y + DR > H)  { o.y = H - DR;  o.vy = -Math.abs(o.vy); }
      }
      for (let i = 0; i < objs.length; i++) {
        for (let j = i + 1; j < objs.length; j++) {
          const a = objs[i], b = objs[j];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d >= 2 * DR || d < 0.001) continue;
          const nx = dx / d, ny = dy / d;
          const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rv > 0) { a.vx -= rv * nx; a.vy -= rv * ny; b.vx += rv * nx; b.vy += rv * ny; }
          const pen = (2 * DR - d) * 0.5;
          a.x -= nx * pen; a.y -= ny * pen; b.x += nx * pen; b.y += ny * pen;
        }
      }
    }

    function demoDraw(objs, phase) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, W, H);
      for (const o of objs) {
        ctx.beginPath(); ctx.arc(o.x, o.y, DR, 0, Math.PI * 2);
        if      (phase === 'cue'      && o.isTarget)  ctx.fillStyle = 'rgba(231,76,60,0.50)';
        else if (phase === 'response' && o.isTarget)  ctx.fillStyle = 'rgba(58,157,229,0.50)';
        else if (phase === 'feedback' && o.isTarget)  ctx.fillStyle = 'rgba(76,175,80,0.55)';
        else                                           ctx.fillStyle = '#222';
        ctx.fill();
        ctx.beginPath(); ctx.arc(o.x, o.y, DR, 0, Math.PI * 2);
        if      (phase === 'cue'      && o.isTarget)  { ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 2; }
        else if (phase === 'response' && o.isTarget)  { ctx.strokeStyle = '#3a9de5'; ctx.lineWidth = 2; }
        else if (phase === 'feedback' && o.isTarget)  { ctx.strokeStyle = '#4CAF50'; ctx.lineWidth = 2; }
        else                                           { ctx.strokeStyle = '#4a4a4a'; ctx.lineWidth = 1; }
        ctx.stroke();
      }
      // Phase label
      ctx.font = 'bold 9px Courier New';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = phase === 'feedback' ? '#4CAF50' : '#555';
      ctx.fillText(demoLabels[phase] || '', W / 2, H - 4);
    }

    let demoPhase = 'init', demoPhaseStart = performance.now();
    let demoObjs = demoSpawn(), demoLastTs = null;

    const demoLoop = ts => {
      const dt      = demoLastTs === null ? 0 : Math.min((ts - demoLastTs) / 1000, 0.05);
      demoLastTs    = ts;
      const elapsed = ts - demoPhaseStart;

      if (elapsed >= demoDurations[demoPhase]) {
        const idx = demoPhases.indexOf(demoPhase);
        if (idx >= demoPhases.length - 1) {
          demoObjs = demoSpawn(); demoPhase = 'init';
        } else {
          demoPhase = demoPhases[idx + 1];
          // Auto-select targets entering response phase so demo shows correct answer
          if (demoPhase === 'response') demoObjs.forEach(o => { o.selected = o.isTarget; });
        }
        demoPhaseStart = ts;
      }

      if (demoPhase === 'track') demoStep(demoObjs, dt);
      demoDraw(demoObjs, demoPhase);
      _demoAnimId = requestAnimationFrame(demoLoop);
    };
    _demoAnimId = requestAnimationFrame(demoLoop);
  }

  document.getElementById('btn-start').addEventListener('click', () => {
    cancelAnimationFrame(_demoAnimId);
    participantId = document.getElementById('pid').value.trim() || 'anonymous';
    if (IS_EEG) testMode = document.querySelector('input[name="ver"]:checked').value;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const datetimePrefix = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    sessionId = `${datetimePrefix}_${participantId}`;
    sessionSeed = seedFromString(sessionId);
    rng = mulberry32(sessionSeed);
    practiceData = [];
    testData = [];
    runPractice(data => { practiceData = data; showPracticeFeedback(data); });
  });

  document.getElementById('pid').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-start').click();
  });
}

function showPracticeFeedback(data) {
  const nCorrect = data.filter(d => d.correct).length;
  const pct = Math.round(nCorrect / data.length * 100);
  const cls = pct >= 75 ? 'color-good' : pct >= 50 ? 'color-warn' : 'color-bad';

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center;font-size:1.3rem">Practice Complete</h1>
      <p class="task-subtitle">Here&rsquo;s how you did</p>

      <div class="stats-grid">
        <div class="stat-box ${cls}">
          <div class="stat-value">${pct}%</div>
          <div class="stat-label">Accuracy</div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${nCorrect}&thinsp;/&thinsp;${data.length}</div>
          <div class="stat-label">Correct Trials</div>
        </div>
      </div>

      <p style="text-align:center;color:#888;font-size:0.82rem;margin-top:1rem">
        The main test starts at 3 targets (of 10). Target count adapts after each trial.
      </p>

      <div style="text-align:center">
        <button class="btn" id="btn-main">Start Main Test</button>
        <button class="btn btn-outline" id="btn-redo">Redo Practice</button>
      </div>
    </div>
  `);

  document.getElementById('btn-main').addEventListener('click', () => {
    runTest(data => { testData = data; showResults(data); });
  });
  document.getElementById('btn-redo').addEventListener('click', () => {
    runPractice(data => { practiceData = data; showPracticeFeedback(data); });
  });
}

function showResults(data) {
  const kValue = computeKValue();
  const nCorrect = data.filter(d => d.correct).length;
  const pct = (nCorrect / data.length * 100).toFixed(1);

  try {
    localStorage.setItem(`cri_mot_${participantId}`, JSON.stringify({
      kValue,
      accuracy: nCorrect / data.length,
      completedAt: Date.now(),
    }));
  } catch (_) {}
  const modeLabel = testMode === 'adaptive'
    ? `Stopped at ${SC.reversalCount} reversals`
    : `Fixed 40-trial test`;

  const submitRow = CONFIG.sheetUrl
    ? `<div id="submit-status" class="submit-status"><span class="status-pending">Submitting&#8230;</span></div>`
    : '';

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center;font-size:1.3rem">Test Complete</h1>
      <p class="task-subtitle">Participant: ${escapeHtml(participantId)}</p>

      <div class="stats-grid">
        <div class="stat-box color-neutral">
          <div class="stat-value">${kValue.toFixed(1)}</div>
          <div class="stat-label">K-Value<div class="stat-sub">tracking capacity (objects)</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${pct}%</div>
          <div class="stat-label">Accuracy<div class="stat-sub">${nCorrect} / ${data.length} trials</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${data.length}</div>
          <div class="stat-label">Trials<div class="stat-sub">${modeLabel}</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${SC.reversalCount}</div>
          <div class="stat-label">Reversals</div>
        </div>
      </div>

      ${submitRow}

      <div class="btn-group">
        <button class="btn" id="btn-dl">Download CSV</button>
        <button class="btn btn-outline" id="btn-restart">Restart</button>
        <a class="btn btn-outline" href="../">Task Selection</a>
      </div>
      <p style="text-align:center;margin-top:1.2rem">
        <a href="../scorecard/?pid=${escapeHtml(participantId)}"
           style="color:#3a7bd5;font-size:0.8rem;text-decoration:none;letter-spacing:0.06em">
          View Performance Report →
        </a>
      </p>
    </div>
  `);

  document.getElementById('btn-dl').addEventListener('click', () => exportCSV([...practiceData, ...testData]));
  document.getElementById('btn-restart').addEventListener('click', () => { practiceData = []; testData = []; showWelcome(); });

}

// ============================================================
//  Data export
// ============================================================

function exportCSV(data) {
  const headers = ['participant_id', 'seed', 'block', 'trial_num', 'num_targets', 'speed_px_s',
    'correct', 'reversal_count', 'selected_ids', 'target_ids'];
  const rows = data.map(d => [
    sessionId, sessionSeed, d.block, d.trialNum, d.numTargets, Math.round(d.speed),
    d.correct ? 1 : 0, d.reversalCount ?? '',
    '"' + (d.selectedIds || []).join(';') + '"',
    '"' + (d.targetIds || []).join(';') + '"',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MOT_Capacity_${sessionId}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function submitToSheet(d) {
  if (!CONFIG.sheetUrl) return;
  const row = [
    sessionId, sessionSeed, d.block, d.trialNum, d.numTargets, Math.round(d.speed),
    d.correct ? 1 : 0, d.reversalCount ?? '',
    (d.selectedIds || []).join(';'), (d.targetIds || []).join(';'),
  ];
  const body = new FormData();
  body.append('sheet', 'MOT Capacity Data');
  body.append('payload', JSON.stringify([row]));
  fetch(CONFIG.sheetUrl, { method: 'POST', mode: 'no-cors', body }).catch(() => { });
}

// ============================================================
//  Boot
// ============================================================

window.addEventListener('load', showWelcome);
