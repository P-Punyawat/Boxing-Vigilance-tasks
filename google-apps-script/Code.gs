// SART Data Collector - Google Apps Script
//
// Setup (one-time):
//   1. Go to sheets.google.com -> create a New spreadsheet
//      (name it e.g. "SART Data Collection")
//   2. Inside that sheet: Extensions -> Apps Script
//   3. Select ALL code in the editor (Ctrl+A / Cmd+A), delete it,
//      then paste this entire file
//   4. Deploy -> New deployment
//        Type: Web app
//        Execute as: Me
//        Who has access: Anyone
//   5. Copy the Web App URL
//   6. Paste it into CONFIG.sheetUrl in sart/sart.js
//
// The script will auto-create a "SART Data" tab with headers
// on the first submission. No manual column setup needed.

var SHEET_NAME = 'SART Data';

var HEADERS = [
  'timestamp',
  'participant_id',
  'block',
  'trial_num',
  'digit',
  'is_nogo',
  'font_size_pt',
  'isi_ms',
  'responded',
  'rt_ms',
  'outcome'
];

function doPost(e) {
  try {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var rows      = JSON.parse(e.parameter.payload);
    var timestamp = new Date().toISOString();

    for (var i = 0; i < rows.length; i++) {
      sheet.appendRow([timestamp].concat(rows[i]));
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', n: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Run this inside the Apps Script editor to test before going live.
// It writes 4 dummy rows - check your sheet to confirm it worked.
function testSheet() {
  var mockRows = [
    ['P_TEST', 'practice', 1, 5, 0, 72,  1000, 1, 342,  'hit'],
    ['P_TEST', 'practice', 2, 3, 1, 94,  2000, 0, '',   'correct_rejection'],
    ['P_TEST', 'test',     1, 7, 0, 100, 1500, 1, 289,  'hit'],
    ['P_TEST', 'test',     2, 3, 1, 48,  1000, 1, 198,  'commission']
  ];
  var e = { parameter: { payload: JSON.stringify(mockRows) } };
  Logger.log(doPost(e).getContent());
}
