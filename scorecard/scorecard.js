'use strict';

// ============================================================
//  Scorecard — Cognitive Readiness Index
// ============================================================

const WEIGHTS = { attention: 0.40, tracking: 0.40, risk: 0.20 };

// ---- Normal CDF (Abramowitz & Stegun 26.2.17, error < 7.5e-8) ----
function normCDF(z) {
  const b = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (b[0] + t * (b[1] + t * (b[2] + t * (b[3] + t * b[4]))));
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const p = 1 - phi * poly;
  return z >= 0 ? p : 1 - p;
}

function toPercentile(value, mean, sd, lowerIsBetter) {
  const z = (value - mean) / sd;
  const p = normCDF(lowerIsBetter ? -z : z) * 100;
  return Math.max(1, Math.min(99, Math.round(p)));
}

// ---- Raw estimates used before normative data is collected ----
// Maps each metric to a 0-100 score based on task-appropriate reference ranges.
function rawAttention(sart) {
  if (!sart) return null;
  const commP = 100 * (1 - Math.min(sart.commissionRate / 0.20, 1));
  const cvP   = 100 * (1 - Math.min((sart.rtCV || 0) / 0.40, 1));
  return Math.round((commP + cvP) / 2);
}

function rawTracking(mot) {
  if (!mot) return null;
  return Math.round(((mot.kValue / 6) * 100 + mot.accuracy * 100) / 2);
}

function rawRisk(bart) {
  if (!bart) return null;
  return Math.round(Math.min((bart.adjAvgPumps || 0) / 64, 1) * 100);
}

// ---- LocalStorage helpers ----
function getURLParam(key) {
  return new URLSearchParams(window.location.search).get(key) || '';
}

function loadTaskData(pid) {
  const get = key => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  };
  return {
    sart: get(`cri_sart_${pid}`),
    bart: get(`cri_bart_${pid}`),
    mot:  get(`cri_mot_${pid}`),
  };
}

// ---- Score computation ----
function computeScores(data, norms) {
  const { sart, bart, mot } = data;

  const normsReady = norms &&
    norms.sart?.commission_rate?.mean !== null &&
    norms.mot?.k_value?.mean !== null &&
    norms.bart?.adj_avg_pumps?.mean !== null;

  let attention = null, tracking = null, risk = null;

  if (normsReady) {
    if (sart) {
      const cP  = toPercentile(sart.commissionRate, norms.sart.commission_rate.mean, norms.sart.commission_rate.sd, true);
      const cvP = toPercentile(sart.rtCV || 0,      norms.sart.rt_cv.mean,           norms.sart.rt_cv.sd,           true);
      attention = Math.round((cP + cvP) / 2);
    }
    if (mot) {
      const kP   = toPercentile(mot.kValue,   norms.mot.k_value.mean,  norms.mot.k_value.sd,  false);
      const accP = toPercentile(mot.accuracy,  norms.mot.accuracy.mean, norms.mot.accuracy.sd, false);
      tracking = Math.round((kP + accP) / 2);
    }
    if (bart) {
      risk = toPercentile(bart.adjAvgPumps, norms.bart.adj_avg_pumps.mean, norms.bart.adj_avg_pumps.sd, false);
    }
  } else {
    attention = rawAttention(sart);
    tracking  = rawTracking(mot);
    risk      = rawRisk(bart);
  }

  const allDone = attention !== null && tracking !== null && risk !== null;
  const cri = allDone
    ? Math.round(WEIGHTS.attention * attention + WEIGHTS.tracking * tracking + WEIGHTS.risk * risk)
    : null;

  return { attention, tracking, risk, cri, usingNorms: normsReady, allDone };
}

// ---- Radar chart (canvas) ----
function drawRadar(canvas, scores) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H * 0.52;
  const maxR = Math.min(W, H) * 0.33;
  const labelR = maxR + 28;
  const valueLabelR = maxR + 46;

  ctx.clearRect(0, 0, W, H);

  const toRad = d => d * Math.PI / 180;
  const pt = (angleDeg, r) => ({
    x: cx + r * Math.cos(toRad(angleDeg)),
    y: cy + r * Math.sin(toRad(angleDeg)),
  });

  const axes = [
    { label: 'Attention', angle: -90,  value: scores.attention },
    { label: 'Tracking',  angle: 30,   value: scores.tracking  },
    { label: 'Risk',      angle: 150,  value: scores.risk      },
  ];

  // Concentric grid triangles
  [25, 50, 75, 100].forEach(pct => {
    const r = (pct / 100) * maxR;
    ctx.beginPath();
    axes.forEach((ax, i) => {
      const p = pt(ax.angle, r);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.strokeStyle = pct === 100 ? '#383838' : '#242424';
    ctx.lineWidth = pct === 100 ? 1.5 : 1;
    ctx.stroke();
  });

  // Grid % labels on the Attention (top) axis
  [25, 50, 75].forEach(pct => {
    const p = pt(-90, (pct / 100) * maxR);
    ctx.fillStyle = '#383838';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pct + '%', p.x + 5, p.y);
  });

  // Axis lines
  axes.forEach(ax => {
    const end = pt(ax.angle, maxR);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Data polygon + dots (only for axes with data)
  const hasAny = axes.some(ax => ax.value !== null);
  if (hasAny) {
    // Build polygon points — use 0 for null values so shape always closes
    const polyPts = axes.map(ax => {
      const v = ax.value !== null ? ax.value : 0;
      return pt(ax.angle, (v / 100) * maxR);
    });

    ctx.beginPath();
    polyPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(58,123,213,0.18)';
    ctx.fill();
    ctx.strokeStyle = '#3a7bd5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots at data points
    axes.forEach(ax => {
      if (ax.value === null) return;
      const p = pt(ax.angle, (ax.value / 100) * maxR);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#3a7bd5';
      ctx.fill();
    });
  }

  // Axis labels and scores
  axes.forEach(ax => {
    const lp = pt(ax.angle, labelR);
    const vp = pt(ax.angle, valueLabelR);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 12px Courier New';
    ctx.fillStyle = ax.value !== null ? '#cccccc' : '#444';
    ctx.fillText(ax.label, lp.x, lp.y);

    ctx.font = '13px Courier New';
    ctx.fillStyle = ax.value !== null ? '#3a7bd5' : '#333';
    ctx.fillText(ax.value !== null ? ax.value + '%' : '—', vp.x, vp.y);
  });
}

// ---- UI helpers ----
function domainBar(label, subtitle, value) {
  const pct  = value !== null ? value : 0;
  const fill = value === null ? '#1e1e1e'
    : pct >= 75 ? '#4CAF50'
    : pct >= 50 ? '#FFC107'
    : pct >= 25 ? '#FF9800'
    :             '#f44336';
  return `
    <div class="domain-bar-row">
      <div class="domain-bar-label">
        <span>${label}</span>
        <span class="domain-bar-sub">${subtitle}</span>
      </div>
      <div class="domain-bar-track">
        <div class="domain-bar-fill" style="width:${pct}%;background:${fill}"></div>
      </div>
      <div class="domain-bar-value">${value !== null ? value + '%' : '—'}</div>
    </div>`;
}

function rawMetricsHTML(data) {
  const { sart, bart, mot } = data;
  return `
    <div class="raw-metrics">
      <div class="raw-section">
        <div class="raw-title">SART</div>
        <div class="raw-row">
          <span>Commission errors</span>
          <span>${sart ? (sart.commissionRate * 100).toFixed(1) + '%' : '—'}</span>
        </div>
        <div class="raw-row">
          <span>RT variability (CV)</span>
          <span>${sart?.rtCV != null ? (sart.rtCV * 100).toFixed(1) + '%' : '—'}</span>
        </div>
      </div>
      <div class="raw-section">
        <div class="raw-title">BART</div>
        <div class="raw-row">
          <span>Adj. avg pumps</span>
          <span>${bart ? (bart.adjAvgPumps || 0).toFixed(1) : '—'}</span>
        </div>
      </div>
      <div class="raw-section">
        <div class="raw-title">MOT Capacity</div>
        <div class="raw-row">
          <span>K-value</span>
          <span>${mot ? mot.kValue.toFixed(1) : '—'}</span>
        </div>
        <div class="raw-row">
          <span>Accuracy</span>
          <span>${mot ? (mot.accuracy * 100).toFixed(1) + '%' : '—'}</span>
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Main render ----
function renderScorecard(pid, data, scores) {
  const app = document.getElementById('app');

  const tasks = [
    { name: 'SART',         done: !!data.sart },
    { name: 'BART',         done: !!data.bart },
    { name: 'MOT Capacity', done: !!data.mot  },
  ];

  const criBlock = scores.cri !== null
    ? `<div class="cri-number">${scores.cri}</div>
       <div class="cri-label">Cognitive Readiness Index</div>`
    : `<div class="cri-number cri-pending">—</div>
       <div class="cri-label">Complete all three tasks to see your CRI</div>`;

  const badge = scores.usingNorms
    ? `<span class="badge badge-norms">vs. Normative population</span>`
    : `<span class="badge badge-pending">Raw estimates — normative baseline pending</span>`;

  app.innerHTML = `
    <a class="back-link" href="../">← Task Menu</a>
    <div class="screen scorecard-screen">
      <h1>Performance Report</h1>
      <p class="task-subtitle">Participant: ${escapeHtml(pid)}</p>

      <div class="cri-wrap">
        ${criBlock}
        ${badge}
      </div>

      <div class="radar-wrap">
        <canvas id="radar" width="380" height="300"></canvas>
      </div>

      <div class="domain-bars">
        ${domainBar('Attention', 'Inhibitory control &amp; consistency', scores.attention)}
        ${domainBar('Tracking',  'Visual tracking capacity',             scores.tracking)}
        ${domainBar('Risk',      'Risk appetite',                        scores.risk)}
      </div>

      <div class="task-checklist">
        ${tasks.map(t => `
          <div class="task-check ${t.done ? 'done' : 'pending'}">
            <span class="check-icon">${t.done ? '✓' : '○'}</span>
            ${t.name}
          </div>`).join('')}
      </div>

      ${scores.allDone ? rawMetricsHTML(data) : ''}

      <div class="btn-group">
        <a class="btn btn-outline" href="../">← Task Menu</a>
      </div>
    </div>`;

  drawRadar(document.getElementById('radar'), scores);
}

// ---- PID entry form (fallback if no ?pid=) ----
function renderPIDForm() {
  document.getElementById('app').innerHTML = `
    <div class="screen instructions" style="text-align:center; padding-top:3rem">
      <h1 style="font-size:1.4rem; letter-spacing:0.14em; text-transform:uppercase">
        Performance Report
      </h1>
      <p style="color:#666; font-size:0.8rem; margin-top:0.4rem; letter-spacing:0.08em">
        Enter your participant ID to view your results
      </p>
      <div class="input-group" style="margin-top:2rem">
        <label for="pid">Participant ID</label>
        <input type="text" id="pid" placeholder="e.g. P001" autocomplete="off" maxlength="32">
      </div>
      <div style="margin-top:1.5rem">
        <button class="btn" id="btn-go">View Report</button>
      </div>
    </div>`;

  document.getElementById('btn-go').addEventListener('click', () => {
    const val = document.getElementById('pid').value.trim();
    if (val) window.location.search = '?pid=' + encodeURIComponent(val);
  });
  document.getElementById('pid').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-go').click();
  });
}

// ---- Boot ----
async function boot() {
  const pid = getURLParam('pid');
  if (!pid) { renderPIDForm(); return; }

  const data = loadTaskData(pid);

  let norms = null;
  try {
    const res = await fetch('../norms.json');
    if (res.ok) norms = await res.json();
  } catch { /* norms unavailable — use raw estimates */ }

  const scores = computeScores(data, norms);
  renderScorecard(pid, data, scores);
}

window.addEventListener('load', boot);
