// ============================================================
//  SART — Sustained Attention to Response Task
//  Robertson et al. (1997)
// ============================================================

'use strict';

// ============================================================
//  Configuration
// ============================================================

const CONFIG = {
  digits: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  noGo: 3,
  digitDuration: 250,   // ms — digit display time

  // Paste your deployed Apps Script URL here to enable automatic sheet submission.
  // Leave empty ('') to disable — CSV download will still work.
  sheetUrl: 'https://script.google.com/macros/s/AKfycbykUJMtozfiF57pzhtjo2ex5OEsifqpXrjNRT1G6AmWX0ls3Ekv6p3LKBXlwnUPVUAvsg/exec',

  practice: {
    repsPerDigit: 2,              // each digit appears this many times
    fontSizes: [72, 94],       // pt — randomly selected per trial
    isis: [1000, 2000],   // ms mask duration — randomly selected per trial
  },

  test: {
    fontSizes: [48, 72, 94, 100, 120],    // pt
    isis: [1000, 1500, 2000],         // ms
    // Full factorial: each digit × each fontSize × each isi = 1 trial
    // 9 × 5 × 3 = 135 trials
  },
};

// ============================================================
//  Session state
// ============================================================

let participantId = '';
let practiceData = [];
let testData = [];

// ============================================================
//  Utilities
// ============================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sd(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.map(x => (x - m) ** 2).reduce((a, b) => a + b, 0) / (arr.length - 1));
}

// ============================================================
//  Trial generation
// ============================================================

function generatePracticeTrials() {
  const trials = [];
  CONFIG.digits.forEach(digit => {
    for (let i = 0; i < CONFIG.practice.repsPerDigit; i++) {
      trials.push({
        digit,
        fontSize: randomFrom(CONFIG.practice.fontSizes),
        isi: randomFrom(CONFIG.practice.isis),
        isNogo: digit === CONFIG.noGo,
      });
    }
  });
  return shuffle(trials);
}

function generateTestTrials() {
  // Full factorial: each (digit × fontSize × isi) appears exactly once → 135 trials
  const trials = [];
  CONFIG.digits.forEach(digit => {
    CONFIG.test.fontSizes.forEach(fontSize => {
      CONFIG.test.isis.forEach(isi => {
        trials.push({
          digit,
          fontSize,
          isi,
          isNogo: digit === CONFIG.noGo,
        });
      });
    });
  });
  return shuffle(trials);
}

// ============================================================
//  DOM helpers
// ============================================================

const app = document.getElementById('app');

function render(html) {
  app.innerHTML = html;
}

// Mask SVG — X inside circle (scaled to ~1.4× largest font to stay consistent)
function maskSVG(size = 160) {
  const r = 44;
  const cx = 50;
  const cy = 50;
  const pad = 28;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 100 100"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="${cx}" cy="${cy}" r="${r}"
              stroke="#ffffff" stroke-width="4" fill="none"/>
      <line x1="${pad}" y1="${pad}" x2="${100 - pad}" y2="${100 - pad}"
            stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
      <line x1="${100 - pad}" y1="${pad}" x2="${pad}" y2="${100 - pad}"
            stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
}

// ============================================================
//  Screen: Welcome / instructions
// ============================================================

function showWelcome() {
  render(`
    <a class="back-link" href="../">← Back</a>
    <div class="screen instructions">
      <h1>SART</h1>
      <p class="task-subtitle">Sustained Attention to Response Task &mdash; Robertson et al., 1997</p>

      <h2>Instructions</h2>
      <p>
        You will see a series of single digits (1–9) appear one at a time in
        rapid succession. After each digit, a brief mask appears before the next digit.
      </p>

      <div class="rule-box">
        <p>
          <strong>Press <span class="key-hint">Space</span></strong>
          as quickly as possible for <strong>every digit</strong> you see
          — <em>except</em> the digit <span class="highlight">3</span>.
        </p>
        <p style="margin-top:0.5rem">
          When you see <span class="highlight">3</span>,
          <strong>do NOT press anything</strong>.
        </p>
      </div>

      <p>
        You may respond while the digit is visible
        <em>or</em> shortly after it disappears, but be as fast and accurate as possible.
        The digits appear too quickly to read carefully — rely on your first impression.
      </p>

      <ul>
        <li>Digits will vary in size — this is intentional.</li>
        <li>One practice round (18 trials) comes first, with feedback.</li>
        <li>The main task has 135 trials (~3.5 minutes).</li>
      </ul>

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
    const raw = document.getElementById('pid').value.trim();
    participantId = raw || 'anonymous';
    showCountdown('Practice', () => {
      runBlock(generatePracticeTrials(), true, data => {
        practiceData = data;
        showPracticeFeedback(data);
      });
    });
  });

  document.getElementById('pid').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-start').click();
  });
}

// ============================================================
//  Screen: Countdown
// ============================================================

function showCountdown(label, onDone) {
  let count = 3;

  render(`
    <div class="screen countdown-wrap">
      <div class="countdown-number" id="cd-num">${count}</div>
      <div class="countdown-label">${label} starts in…</div>
    </div>
  `);

  const tick = setInterval(() => {
    count--;
    const el = document.getElementById('cd-num');
    if (count <= 0) {
      clearInterval(tick);
      onDone();
    } else if (el) {
      el.textContent = count;
    }
  }, 1000);
}

// ============================================================
//  Screen: Practice feedback
// ============================================================

function showPracticeFeedback(data) {
  const s = analyzeData(data);
  const commClass = s.commissionErrors === 0 ? 'color-good'
    : s.commissionErrors <= 1 ? 'color-warn'
      : 'color-bad';
  const omClass = s.omissionErrors === 0 ? 'color-good'
    : s.omissionErrors <= 2 ? 'color-warn'
      : 'color-bad';

  const alerts = [];
  if (s.commissionErrors > 0) {
    alerts.push(`<p class="alert-text error">
      You pressed on <strong>${s.commissionErrors}</strong> presentation${s.commissionErrors > 1 ? 's' : ''} of
      the digit 3. Remember: <strong>withhold</strong> your response for 3.
    </p>`);
  }
  if (s.omissionErrors > 2) {
    alerts.push(`<p class="alert-text warn">
      You missed ${s.omissionErrors} digit${s.omissionErrors > 1 ? 's' : ''}.
      Try to respond to every digit except 3.
    </p>`);
  }
  if (s.commissionErrors === 0 && s.omissionErrors <= 1) {
    alerts.push(`<p class="alert-text good">Great job! You're ready for the main task.</p>`);
  }

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center; font-size:1.3rem">Practice Complete</h1>
      <p class="task-subtitle">Here's how you did on the practice round</p>

      <div class="stats-grid">
        <div class="stat-box color-neutral">
          <div class="stat-value">${(s.correct / data.length * 100).toFixed(0)}%</div>
          <div class="stat-label">Overall Accuracy</div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${s.meanRT !== null ? Math.round(s.meanRT) + 'ms' : '—'}</div>
          <div class="stat-label">Mean Response Time<div class="stat-sub">correct Go trials</div></div>
        </div>
        <div class="stat-box ${commClass}">
          <div class="stat-value">${s.commissionErrors}</div>
          <div class="stat-label">Commission Errors<div class="stat-sub">pressed on 3</div></div>
        </div>
        <div class="stat-box ${omClass}">
          <div class="stat-value">${s.omissionErrors}</div>
          <div class="stat-label">Omission Errors<div class="stat-sub">missed a digit</div></div>
        </div>
      </div>

      ${alerts.join('')}

      <div style="text-align:center">
        <button class="btn" id="btn-main">Start Main Task</button>
        <button class="btn btn-outline" id="btn-redo">Redo Practice</button>
      </div>
    </div>
  `);

  document.getElementById('btn-main').addEventListener('click', () => {
    showCountdown('Main task', () => {
      runBlock(generateTestTrials(), false, data => {
        testData = data;
        showResults(data);
      });
    });
  });

  document.getElementById('btn-redo').addEventListener('click', () => {
    showCountdown('Practice', () => {
      runBlock(generatePracticeTrials(), true, data => {
        practiceData = data;
        showPracticeFeedback(data);
      });
    });
  });
}

// ============================================================
//  Screen: Results
// ============================================================

function showResults(data) {
  const s = analyzeData(data);
  const commPct = (s.commissionErrors / s.noGoTrials * 100).toFixed(1);
  const omPct = (s.omissionErrors / s.goTrials * 100).toFixed(1);

  const commClass = s.commissionErrors <= 2 ? 'color-good'
    : s.commissionErrors <= 5 ? 'color-warn'
      : 'color-bad';
  const omClass = s.omissionErrors <= 4 ? 'color-good'
    : s.omissionErrors <= 10 ? 'color-warn'
      : 'color-bad';

  const submitRow = CONFIG.sheetUrl
    ? `<div id="submit-status" class="submit-status">
         <span class="status-pending">Submitting data&#8230;</span>
       </div>`
    : '';

  render(`
    <div class="screen instructions">
      <h1 style="text-align:center; font-size:1.3rem">Task Complete</h1>
      <p class="task-subtitle">Participant: ${escapeHtml(participantId)}</p>

      <div class="stats-grid">
        <div class="stat-box color-neutral">
          <div class="stat-value">${(s.correct / data.length * 100).toFixed(1)}%</div>
          <div class="stat-label">Overall Accuracy</div>
        </div>
        <div class="stat-box color-neutral">
          <div class="stat-value">${s.meanRT !== null ? Math.round(s.meanRT) + 'ms' : '—'}</div>
          <div class="stat-label">Mean RT<div class="stat-sub">correct Go · SD ${s.sdRT !== null ? Math.round(s.sdRT) : '—'}ms</div></div>
        </div>
        <div class="stat-box ${commClass}">
          <div class="stat-value">${s.commissionErrors}</div>
          <div class="stat-label">Commission Errors<div class="stat-sub">pressed on 3 · ${commPct}% of No-Go</div></div>
        </div>
        <div class="stat-box ${omClass}">
          <div class="stat-value">${s.omissionErrors}</div>
          <div class="stat-label">Omission Errors<div class="stat-sub">missed digit · ${omPct}% of Go</div></div>
        </div>
      </div>

      <p class="result-meta">
        Total trials: ${data.length} &nbsp;|&nbsp;
        Go: ${s.goTrials} &nbsp;|&nbsp;
        No-Go: ${s.noGoTrials} (${(s.noGoTrials / data.length * 100).toFixed(1)}%)
      </p>

      ${submitRow}

      <div class="btn-group">
        <button class="btn" id="btn-download">Download CSV</button>
        <button class="btn btn-outline" id="btn-restart">Restart</button>
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

  if (CONFIG.sheetUrl) {
    submitToSheet([...practiceData, ...testData]).then(ok => {
      const el = document.getElementById('submit-status');
      if (!el) return;
      el.innerHTML = '<span class="status-ok">Data sent to sheet ✓</span>';
    });
  }
}

// ============================================================
//  Block runner
// ============================================================

function runBlock(trials, isPractice, onComplete) {
  const blockData = [];
  let idx = 0;

  // Full-viewport overlay — sits on top of #app
  const overlay = document.createElement('div');
  overlay.className = 'trial-overlay';
  document.body.appendChild(overlay);
  app.innerHTML = '';

  function next() {
    if (idx >= trials.length) {
      overlay.remove();
      onComplete(blockData);
      return;
    }
    runTrial(trials[idx], idx, trials.length, isPractice, overlay, result => {
      blockData.push({
        ...trials[idx],
        block: isPractice ? 'practice' : 'test',
        trialNum: idx + 1,
        ...result,
      });
      idx++;
      next();
    });
  }

  next();
}

// ============================================================
//  Single trial
// ============================================================

function runTrial(trial, index, total, isPractice, container, onComplete) {
  const progressPct = (index / total * 100).toFixed(2);
  const trialLabel = `${index + 1} / ${total}`;

  let responded = false;
  let rt = null;

  // --- Show digit ---
  container.innerHTML = `
    <div class="digit-stimulus" style="font-size:${trial.fontSize}pt"
         aria-live="off">${trial.digit}</div>
    <div class="trial-counter">${trialLabel}</div>
    <div class="progress-bar" style="width:${progressPct}%"></div>
  `;

  const trialStart = performance.now();

  const onKey = e => {
    if ((e.code === 'Space' || e.key === ' ') && !responded) {
      responded = true;
      rt = performance.now() - trialStart;
    }
  };
  document.addEventListener('keydown', onKey);

  // --- After digit duration → show mask ---
  const digitTimer = setTimeout(() => {
    container.innerHTML = `
      <div class="mask-stimulus">${maskSVG(160)}</div>
      <div class="trial-counter">${trialLabel}</div>
      <div class="progress-bar" style="width:${progressPct}%"></div>
    `;

    // --- After ISI → end trial ---
    const maskTimer = setTimeout(() => {
      document.removeEventListener('keydown', onKey);

      let outcome;
      if (trial.isNogo) {
        outcome = responded ? 'commission' : 'correct_rejection';
      } else {
        outcome = responded ? 'hit' : 'omission';
      }

      onComplete({
        responded,
        rt: responded ? Math.round(rt) : null,
        outcome,
      });
    }, trial.isi);

  }, CONFIG.digitDuration);
}

// ============================================================
//  Data analysis
// ============================================================

function analyzeData(data) {
  const goTrials = data.filter(t => !t.isNogo);
  const noGoTrials = data.filter(t => t.isNogo);

  const hits = data.filter(t => t.outcome === 'hit');
  const omissions = data.filter(t => t.outcome === 'omission');
  const commissions = data.filter(t => t.outcome === 'commission');
  const correctRejection = data.filter(t => t.outcome === 'correct_rejection');

  const rts = hits.map(t => t.rt).filter(v => v !== null);

  return {
    total: data.length,
    goTrials: goTrials.length,
    noGoTrials: noGoTrials.length,
    hits: hits.length,
    omissionErrors: omissions.length,
    commissionErrors: commissions.length,
    correctRejections: correctRejection.length,
    correct: hits.length + correctRejection.length,
    meanRT: mean(rts),
    sdRT: sd(rts),
  };
}

// ============================================================
//  CSV export
// ============================================================

function exportCSV(data) {
  const headers = [
    'participant_id', 'block', 'trial_num',
    'digit', 'is_nogo', 'font_size_pt', 'isi_ms',
    'responded', 'rt_ms', 'outcome',
  ];

  const rows = data.map(t => [
    participantId,
    t.block,
    t.trialNum,
    t.digit,
    t.isNogo ? 1 : 0,
    t.fontSize,
    t.isi,
    t.responded ? 1 : 0,
    t.rt !== null ? t.rt : '',
    t.outcome,
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  a.href = url;
  a.download = `SART_${participantId}_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
//  Google Sheets submission
// ============================================================

async function submitToSheet(allData) {
  if (!CONFIG.sheetUrl) return false;

  const rows = allData.map(t => [
    participantId,
    t.block,
    t.trialNum,
    t.digit,
    t.isNogo ? 1 : 0,
    t.fontSize,
    t.isi,
    t.responded ? 1 : 0,
    t.rt !== null ? t.rt : '',
    t.outcome,
  ]);

  try {
    const body = new FormData();
    body.append('sheet', 'SART Data');
    body.append('payload', JSON.stringify(rows));
    await fetch(CONFIG.sheetUrl, { method: 'POST', mode: 'no-cors', body });
  } catch (_) { }
  return true;
}

// ============================================================
//  Security helper
// ============================================================

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
//  Boot
// ============================================================

window.addEventListener('load', showWelcome);
