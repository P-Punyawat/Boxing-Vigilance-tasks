// ============================================================
//  MOT Capacity — Multi-Object Tracking
//  2-Down / 1-Up staircase on target count (1–6 of 10 circles)
// ============================================================
'use strict';

// ============================================================
//  Configuration
// ============================================================

const CONFIG = {
  sheetUrl: 'https://script.google.com/macros/s/AKfycbykUJMtozfiF57pzhtjo2ex5OEsifqpXrjNRT1G6AmWX0ls3Ekv6p3LKBXlwnUPVUAvsg/exec',

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
let testMode = 'fixed';   // 'fixed' | 'adaptive'
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

function rand(a, b) { return Math.random() * (b - a) + a; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function sd(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.map(x => (x - m) ** 2).reduce((a, b) => a + b, 0) / (arr.length - 1));
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
    confirmBtn.removeEventListener('click', finish);

    const selectedIds = [...selected];
    const targetIds = objs.filter(o => o.isTarget).map(o => o.id);
    const correct = selectedIds.length === numTargets &&
      selectedIds.every(id => targetIds.includes(id));

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

  function setPhase(p) {
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
    if (selected.has(o.id)) { selected.delete(o.id); o.selected = false; }
    else                    { selected.add(o.id);    o.selected = true;  }
    selEl.textContent = `${selected.size} / ${numTargets} selected`;
    confirmBtn.disabled = selected.size !== numTargets;
  }

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  confirmBtn.addEventListener('click', finish);

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
      </div>

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

  document.getElementById('btn-start').addEventListener('click', () => {
    participantId = document.getElementById('pid').value.trim() || 'anonymous';
    testMode = document.querySelector('input[name="ver"]:checked').value;
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

function computeMOTCapacityAdvanced(data) {
  const test = data.filter(d => d.block === 'test');
  if (!test.length) return null;

  const nC    = test.filter(d => d.correct).length;
  const acc   = nC / test.length;
  const mid   = Math.floor(test.length / 2);
  const h1Acc = mid > 0 ? test.slice(0, mid).filter(d => d.correct).length / mid : null;
  const h2Acc = (test.length - mid) > 0 ? test.slice(mid).filter(d => d.correct).length / (test.length - mid) : null;

  const revTargets = SC.reversalTargets;
  const revMean    = revTargets.length ? mean(revTargets) : null;
  const revSd      = sd(revTargets);
  const revCv      = (revMean && revSd) ? revSd / revMean : null;

  return { acc, h1Acc, h2Acc, revMean, revSd, revCv };
}

function showResults(data) {
  const kValue = computeKValue();
  const adv    = computeMOTCapacityAdvanced(data) || {};
  const test   = data.filter(d => d.block === 'test');
  const nCorrect = test.filter(d => d.correct).length;
  const pct    = test.length ? (nCorrect / test.length * 100).toFixed(1) : '—';
  const modeLabel = testMode === 'adaptive'
    ? `Adaptive · ${SC.reversalCount} reversals`
    : `Fixed · ${test.length} trials`;

  const kClass   = kValue >= 4 ? 'color-good' : kValue >= 2.5 ? 'color-warn' : 'color-bad';
  const accClass = adv.acc >= 0.75 ? 'color-good' : adv.acc >= 0.55 ? 'color-warn' : 'color-bad';

  // Validity flags
  const flags = [];
  if (adv.acc !== undefined && adv.acc < 0.20)
    flags.push('⚠ Accuracy < 20% — participant may not have understood the task.');
  if (kValue >= CONFIG.test.maxTargets)
    flags.push('⚠ K-value at ceiling — tracking capacity limit not found; consider higher max targets.');
  if (kValue <= CONFIG.test.minTargets + 0.1)
    flags.push('⚠ K-value at floor — very poor tracking performance or engagement issue.');
  if (adv.h1Acc !== null && adv.h2Acc !== null && (adv.h1Acc - adv.h2Acc) > 0.20)
    flags.push(`⚠ Fatigue effect: accuracy dropped ${((adv.h1Acc - adv.h2Acc) * 100).toFixed(0)}% in the second half.`);

  const flagHtml = flags.map(f => `<div class="validity-flag">${f}</div>`).join('');

  const submitRow = CONFIG.sheetUrl
    ? `<div id="submit-status" class="submit-status"><span class="status-pending">Submitting&#8230;</span></div>`
    : '';

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center;font-size:1.3rem">Test Complete</h1>
      <p class="task-subtitle">Participant: ${escapeHtml(participantId)}</p>

      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);max-width:560px">
        <div class="stat-box ${kClass}">
          <div class="stat-value">${kValue.toFixed(1)}</div>
          <div class="stat-label">K-Value<div class="stat-sub">tracking capacity (objects)</div></div>
        </div>
        <div class="stat-box ${accClass}">
          <div class="stat-value">${pct}%</div>
          <div class="stat-label">Accuracy<div class="stat-sub">${nCorrect} / ${test.length} trials</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${SC.reversalCount}</div>
          <div class="stat-label">Reversals<div class="stat-sub">${modeLabel}</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${adv.h1Acc !== null ? (adv.h1Acc * 100).toFixed(0) + '%' : '—'}</div>
          <div class="stat-label">Block 1 Acc<div class="stat-sub">first half</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${adv.h2Acc !== null ? (adv.h2Acc * 100).toFixed(0) + '%' : '—'}</div>
          <div class="stat-label">Block 2 Acc<div class="stat-sub">second half</div></div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${adv.revCv !== null ? adv.revCv.toFixed(2) : '—'}</div>
          <div class="stat-label">Reversal CV<div class="stat-sub">staircase stability</div></div>
        </div>
      </div>

      <div class="secondary-metrics">
        <div class="metric-pill">Reversal targets <strong>${adv.revMean !== null ? adv.revMean.toFixed(1) : '—'}</strong></div>
        <div class="metric-pill">Rev. SD <strong>${adv.revSd !== null ? adv.revSd.toFixed(1) : '—'}</strong></div>
        <div class="metric-pill">Current target count <strong>${SC.targetCount}</strong></div>
        <div class="metric-pill">Mode <strong>${testMode}</strong></div>
      </div>

      ${flagHtml}

      <div class="radar-section">
        <canvas id="radar-canvas" width="260" height="260"></canvas>
        <div class="radar-legend">
          <span class="legend-you">▪ You</span>
          <span class="legend-ref">▪ Reference</span>
        </div>
      </div>

      ${submitRow}

      <div class="btn-group">
        <button class="btn" id="btn-dl">Download CSV</button>
        <button class="btn btn-outline" id="btn-restart">Restart</button>
        <a class="btn btn-outline" href="../">Task Selection</a>
      </div>
    </div>
  `);

  // Radar dimensions
  const kRange    = CONFIG.test.maxTargets - CONFIG.test.minTargets;
  const kNorm     = kRange > 0 ? Math.min(1, Math.max(0, (kValue - CONFIG.test.minTargets) / kRange)) : 0.5;
  const accNorm   = adv.acc ?? 0;
  const h1Norm    = adv.h1Acc ?? 0;
  const h2Norm    = adv.h2Acc ?? 0;
  const stabilNorm = adv.revCv !== null ? Math.max(0, 1 - adv.revCv) : 0.5;
  const effNorm   = testMode === 'adaptive'
    ? Math.max(0, 1 - (test.length / CONFIG.staircase.maxTrials))
    : accNorm;

  const labels = ['K-Value', 'Accuracy', 'Block 1', 'Block 2', 'Stability', 'Efficiency'];
  const you    = [kNorm, accNorm, h1Norm, h2Norm, stabilNorm, effNorm];
  const ref    = [0.40, 0.72, 0.72, 0.68, 0.60, 0.55];

  requestAnimationFrame(() => {
    const canvas = document.getElementById('radar-canvas');
    if (canvas) drawRadar(canvas, labels, you, ref);
  });

  document.getElementById('btn-dl').addEventListener('click', () => exportCSV([...practiceData, ...testData]));
  document.getElementById('btn-restart').addEventListener('click', () => { practiceData = []; testData = []; showWelcome(); });

  if (CONFIG.sheetUrl) {
    submitToSheet([...practiceData, ...testData]).then(() => {
      const el = document.getElementById('submit-status');
      if (el) el.innerHTML = '<span class="status-ok">Data sent ✓</span>';
    });
  }
}

// ============================================================
//  Data export
// ============================================================

function exportCSV(data) {
  const headers = ['participant_id', 'block', 'trial_num', 'num_targets', 'speed_px_s',
    'correct', 'reversal_count', 'selected_ids', 'target_ids'];
  const rows = data.map(d => [
    participantId, d.block, d.trialNum, d.numTargets, Math.round(d.speed),
    d.correct ? 1 : 0, d.reversalCount ?? '',
    '"' + (d.selectedIds || []).join(';') + '"',
    '"' + (d.targetIds || []).join(';') + '"',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MOT_Capacity_${participantId}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function submitToSheet(data) {
  if (!CONFIG.sheetUrl) return;
  const rows = data.map(d => [
    participantId, d.block, d.trialNum, d.numTargets, Math.round(d.speed),
    d.correct ? 1 : 0, d.reversalCount ?? '',
    (d.selectedIds || []).join(';'), (d.targetIds || []).join(';'),
  ]);
  try {
    const body = new FormData();
    body.append('sheet', 'MOT Capacity Data');
    body.append('payload', JSON.stringify(rows));
    await fetch(CONFIG.sheetUrl, { method: 'POST', mode: 'no-cors', body });
  } catch (_) { }
}

// ============================================================
//  Radar / Spider chart
// ============================================================

function drawRadar(canvas, labels, you, ref) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 36;
  const N = labels.length;
  const step = (2 * Math.PI) / N;
  const startAngle = -Math.PI / 2;

  ctx.clearRect(0, 0, W, H);

  for (let r = 1; r <= 4; r++) {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = startAngle + i * step;
      const x = cx + Math.cos(a) * R * (r / 4);
      const y = cy + Math.sin(a) * R * (r / 4);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (let i = 0; i < N; i++) {
    const a = startAngle + i * step;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const polygon = (vals, strokeColor, fillColor) => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = startAngle + i * step;
      const r = R * Math.max(0, Math.min(1, vals[i]));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  polygon(ref, '#444', 'rgba(80,80,80,0.15)');
  polygon(you, '#3a9de5', 'rgba(58,157,229,0.18)');

  ctx.fillStyle = '#777';
  ctx.font = '10px Courier New, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < N; i++) {
    const a = startAngle + i * step;
    const lx = cx + Math.cos(a) * (R + 22);
    const ly = cy + Math.sin(a) * (R + 22);
    ctx.fillText(labels[i], lx, ly);
  }
}

// ============================================================
//  Boot
// ============================================================

window.addEventListener('load', showWelcome);
