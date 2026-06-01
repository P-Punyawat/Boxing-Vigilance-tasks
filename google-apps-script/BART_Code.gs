// BART Data Collector - Google Apps Script
//
// Setup: same as SART_Code.gs — attach to a Google Sheet via
// Extensions -> Apps Script, then deploy as a Web App.
// Paste the deployment URL into CONFIG.sheetUrl in bart/bart.js

var SHEET_NAME = 'BART Data';

var HEADERS = [
  'timestamp',
  'participant_id',
  'block',
  'balloon_num',
  'pop_point',
  'pumps',
  'popped',
  'earnings',
  'permanent_bank_after'
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

function testSheet() {
  var mockRows = [
    ['P_TEST', 'practice', 1, 42,  12, 0, '0.60', '0.60'],
    ['P_TEST', 'practice', 2, 90,  90, 1, '0.00', '0.60'],
    ['P_TEST', 'test',     1, 55,  30, 0, '1.50', '2.10'],
    ['P_TEST', 'test',     2, 10,  10, 1, '0.00', '2.10']
  ];
  var e = { parameter: { payload: JSON.stringify(mockRows) } };
  Logger.log(doPost(e).getContent());
}
