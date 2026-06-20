// Combined Data Collector - Google Apps Script
// Handles SART, BART, MOT Speed, and MOT Capacity.
//
// Setup (one-time):
//   1. Go to sheets.google.com -> create a New spreadsheet
//      (name it e.g. "Cognitive Task Data")
//   2. Inside that sheet: Extensions -> Apps Script
//   3. Select ALL code (Ctrl+A / Cmd+A), delete it, paste this file
//   4. Deploy -> New deployment  (or Manage deployments -> Edit to update an existing one)
//        Type: Web app
//        Execute as: Me
//        Who has access: Anyone
//   5. Copy the single Web App URL
//   6. Paste it into CONFIG.sheetUrl in sart/sart.js, bart/bart.js,
//      mot-speed/mot-speed.js, and mot-target/mot-target.js
//
// Each task writes to its own tab. Tabs and headers are created automatically.
//
// Normative stats:
//   GET <WEB_APP_URL>?action=norms  →  returns norms.json payload
//   Run locally:  node compute-norms.js <WEB_APP_URL>

var HEADERS = {
  'SART Data': [
    'timestamp', 'participant_id', 'seed', 'block', 'trial_num',
    'digit', 'is_nogo', 'font_size_pt', 'isi_ms',
    'responded', 'rt_ms', 'outcome'
  ],
  'BART Data': [
    'timestamp', 'participant_id', 'seed', 'block', 'balloon_num',
    'pop_point', 'pumps', 'popped', 'earnings', 'permanent_bank_after'
  ],
  'MOT Speed Data': [
    'timestamp', 'participant_id', 'seed', 'block', 'trial_num',
    'num_targets', 'speed_px_s', 'correct', 'reversal_count',
    'selected_ids', 'target_ids'
  ],
  'MOT Capacity Data': [
    'timestamp', 'participant_id', 'seed', 'block', 'trial_num',
    'num_targets', 'speed_px_s', 'correct', 'reversal_count',
    'selected_ids', 'target_ids'
  ]
};

function doPost(e) {
  try {
    var sheetName = e.parameter.sheet;
    var rows      = JSON.parse(e.parameter.payload);

    if (!sheetName || !HEADERS[sheetName]) {
      throw new Error('Unknown sheet: ' + sheetName);
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var sheet   = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
      var headers = HEADERS[sheetName];

      if (sheet.getLastRow() === 0) {
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }

      var timestamp = new Date().toISOString();
      for (var i = 0; i < rows.length; i++) {
        sheet.appendRow([timestamp].concat(rows[i]));
      }
    } finally {
      lock.releaseLock();
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', sheet: sheetName, n: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Run inside the Apps Script editor to verify all tabs get created correctly.
function testSheet() {
  var sartRows = [
    ['20260101T120000_P_TEST', 123456789, 'test', 1, 5, 0, 72,  1000, 1, 312, 'hit'],
    ['20260101T120000_P_TEST', 123456789, 'test', 2, 3, 1, 94,  1500, 0, '',  'correct_rejection']
  ];
  var bartRows = [
    ['20260101T120000_P_TEST', 123456789, 'test', 1, 42, 12, 0, '0.60', '0.60'],
    ['20260101T120000_P_TEST', 123456789, 'test', 2, 10, 10, 1, '0.00', '0.60']
  ];
  var motSpeedRows = [
    ['20260101T120000_P_TEST', 123456789, 'practice', 1, 4, 200, 1, '', '2;3', '0;1;2;3'],
    ['20260101T120000_P_TEST', 123456789, 'test',     2, 4, 300, 0,  0, '1;2', '0;1;2;3']
  ];
  var motCapRows = [
    ['20260101T120000_P_TEST', 123456789, 'practice', 1, 3, 200, 1, '', '0;4;7', '0;4;7'],
    ['20260101T120000_P_TEST', 123456789, 'test',     2, 4, 280, 1,  0, '1;3;5;8', '1;3;5;8']
  ];

  var e1 = { parameter: { sheet: 'SART Data',         payload: JSON.stringify(sartRows)     } };
  var e2 = { parameter: { sheet: 'BART Data',         payload: JSON.stringify(bartRows)     } };
  var e3 = { parameter: { sheet: 'MOT Speed Data',    payload: JSON.stringify(motSpeedRows) } };
  var e4 = { parameter: { sheet: 'MOT Capacity Data', payload: JSON.stringify(motCapRows)   } };

  Logger.log('SART:         ' + doPost(e1).getContent());
  Logger.log('BART:         ' + doPost(e2).getContent());
  Logger.log('MOT Speed:    ' + doPost(e3).getContent());
  Logger.log('MOT Capacity: ' + doPost(e4).getContent());
}

// ============================================================
//  Normative stats endpoint
//  GET <WEB_APP_URL>?action=norms
// ============================================================

function doGet(e) {
  if ((e.parameter.action || '') !== 'norms') {
    return ContentService
      .createTextOutput(JSON.stringify({ error: 'use ?action=norms' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    var result = _computeNorms();
    return ContentService
      .createTextOutput(JSON.stringify(result, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Normative participants have an ID suffix of first-3-of-firstname + first-3-of-surname (6 alpha chars).
function _isNormative(participantId) {
  return /[A-Za-z]{6}$/.test(String(participantId));
}

function _sheetRows(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function _mean(arr) {
  if (!arr.length) return null;
  return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

function _sd(arr) {
  if (arr.length < 2) return null;
  var m = _mean(arr);
  return Math.sqrt(arr.reduce(function(s, x) { return s + (x - m) * (x - m); }, 0) / (arr.length - 1));
}

function _median(arr) {
  if (!arr.length) return null;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function _groupBy(rows, key) {
  var groups = {};
  rows.forEach(function(r) {
    var k = String(r[key]);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  return groups;
}

function _computeNorms() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- SART: commission_rate and rt_cv ---
  var sartRows = _sheetRows(ss, 'SART Data')
    .filter(function(r) { return _isNormative(r['participant_id']) && String(r['block']) === 'test'; });

  var commRates = [], rtCVs = [];
  var sartByPid = _groupBy(sartRows, 'participant_id');
  Object.keys(sartByPid).forEach(function(pid) {
    var trials = sartByPid[pid];
    var noGoTrials = trials.filter(function(t) { return Number(t['is_nogo']) === 1; });
    var commissions = noGoTrials.filter(function(t) { return Number(t['responded']) === 1; });
    if (noGoTrials.length) commRates.push(commissions.length / noGoTrials.length);

    var hitRTs = trials
      .filter(function(t) { return Number(t['is_nogo']) === 0 && Number(t['responded']) === 1 && t['rt_ms'] !== ''; })
      .map(function(t) { return Number(t['rt_ms']); });
    var mRT = _mean(hitRTs), sRT = _sd(hitRTs);
    if (mRT && sRT !== null) rtCVs.push(sRT / mRT);
  });

  // --- BART: adj_avg_pumps (non-popped test balloons) ---
  var bartRows = _sheetRows(ss, 'BART Data')
    .filter(function(r) { return _isNormative(r['participant_id']) && String(r['block']) === 'test'; });

  var adjAvgPumpsArr = [];
  var bartByPid = _groupBy(bartRows, 'participant_id');
  Object.keys(bartByPid).forEach(function(pid) {
    var nonPopped = bartByPid[pid].filter(function(r) { return Number(r['popped']) === 0; });
    var avg = _mean(nonPopped.map(function(r) { return Number(r['pumps']); }));
    if (avg !== null) adjAvgPumpsArr.push(avg);
  });

  // --- MOT Capacity: k_value and accuracy ---
  // k_value = median of last 4 reversal targets.
  // Reversal detection: reversal_count is recorded BEFORE the staircase update for that trial,
  // so when trial[i+1].reversal_count > trial[i].reversal_count, the reversal was triggered by
  // trial[i], and the reversal target = trial[i].num_targets.
  var motRows = _sheetRows(ss, 'MOT Capacity Data')
    .filter(function(r) { return _isNormative(r['participant_id']) && String(r['block']) === 'test'; });

  var kValues = [], accuracies = [];
  var motByPid = _groupBy(motRows, 'participant_id');
  Object.keys(motByPid).forEach(function(pid) {
    var trials = motByPid[pid].slice().sort(function(a, b) {
      return Number(a['trial_num']) - Number(b['trial_num']);
    });

    var reversalTargets = [];
    for (var i = 0; i < trials.length - 1; i++) {
      var revNow  = Number(trials[i]['reversal_count'])     || 0;
      var revNext = Number(trials[i + 1]['reversal_count']) || 0;
      if (revNext > revNow) reversalTargets.push(Number(trials[i]['num_targets']));
    }

    var kVal = reversalTargets.length
      ? _median(reversalTargets.length >= 4 ? reversalTargets.slice(-4) : reversalTargets)
      : null;
    if (kVal !== null) kValues.push(kVal);

    var nCorrect = trials.filter(function(t) { return Number(t['correct']) === 1; }).length;
    if (trials.length) accuracies.push(nCorrect / trials.length);
  });

  var n = {
    sart: Object.keys(sartByPid).length,
    bart: Object.keys(bartByPid).length,
    mot:  Object.keys(motByPid).length,
  };

  return {
    _note: 'Auto-computed from normative sample (n=' + JSON.stringify(n) + '). Lower/higher_is_better preserved.',
    _n: n,
    sart: {
      commission_rate: { mean: _mean(commRates),      sd: _sd(commRates),      lower_is_better: true  },
      rt_cv:           { mean: _mean(rtCVs),           sd: _sd(rtCVs),           lower_is_better: true  },
    },
    bart: {
      adj_avg_pumps:   { mean: _mean(adjAvgPumpsArr), sd: _sd(adjAvgPumpsArr), lower_is_better: false },
    },
    mot: {
      k_value:         { mean: _mean(kValues),         sd: _sd(kValues),         lower_is_better: false },
      accuracy:        { mean: _mean(accuracies),       sd: _sd(accuracies),       lower_is_better: false },
    },
  };
}

// Run this inside the Apps Script editor to verify norms computation locally.
function testNorms() {
  Logger.log(JSON.stringify(_computeNorms(), null, 2));
}
