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

var HEADERS = {
  'SART Data': [
    'timestamp', 'participant_id', 'block', 'trial_num',
    'digit', 'is_nogo', 'font_size_pt', 'isi_ms',
    'responded', 'rt_ms', 'outcome'
  ],
  'BART Data': [
    'timestamp', 'participant_id', 'block', 'balloon_num',
    'pop_point', 'pumps', 'popped', 'earnings', 'permanent_bank_after'
  ],
  'MOT Speed Data': [
    'timestamp', 'participant_id', 'block', 'trial_num',
    'num_targets', 'speed_px_s', 'correct', 'reversal_count',
    'selected_ids', 'target_ids'
  ],
  'MOT Capacity Data': [
    'timestamp', 'participant_id', 'block', 'trial_num',
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

    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var sheet     = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    var headers   = HEADERS[sheetName];

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var timestamp = new Date().toISOString();
    for (var i = 0; i < rows.length; i++) {
      sheet.appendRow([timestamp].concat(rows[i]));
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
    ['P_TEST', 'test', 1, 5, 0, 72,  1000, 1, 312, 'hit'],
    ['P_TEST', 'test', 2, 3, 1, 94,  1500, 0, '',  'correct_rejection']
  ];
  var bartRows = [
    ['P_TEST', 'test', 1, 42, 12, 0, '0.60', '0.60'],
    ['P_TEST', 'test', 2, 10, 10, 1, '0.00', '0.60']
  ];
  var motSpeedRows = [
    ['P_TEST', 'practice', 1, 4, 200, 1, '', '2;3', '0;1;2;3'],
    ['P_TEST', 'test',     2, 4, 300, 0,  0, '1;2', '0;1;2;3']
  ];
  var motCapRows = [
    ['P_TEST', 'practice', 1, 3, 200, 1, '', '0;4;7', '0;4;7'],
    ['P_TEST', 'test',     2, 4, 280, 1,  0, '1;3;5;8', '1;3;5;8']
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
