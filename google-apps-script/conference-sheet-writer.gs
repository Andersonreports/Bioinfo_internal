// Google Apps Script — adds/updates/deletes rows in the "upcoming Conference"
// tab of the team sheet. This is what the "Add Details" button (and its
// per-row Edit/Delete actions) on the Conference tab writes through to, via
// the conference-tools Supabase Edge Function.
//
// SETUP (one time, in the Google account that owns the Sheet):
//   1. Open the Sheet -> Extensions -> Apps Script.
//   2. Delete the default boilerplate and paste this whole file in.
//   3. Replace SHARED_SECRET below with a long random string of your choice
//      (e.g. generate one at https://www.uuidgenerator.net/). Keep it secret.
//   4. Save the project (any name is fine).
//   5. Deploy -> New deployment -> gear icon -> select type "Web app".
//        - Execute as: Me
//        - Who has access: Anyone
//      Click Deploy, then authorize the script when prompted (it needs
//      permission to edit this spreadsheet).
//   6. Copy the "Web app URL" it gives you (ends in /exec).
//   7. In the Supabase project, set these Edge Function secrets:
//        APPS_SCRIPT_URL    = <the /exec URL from step 6>
//        APPS_SCRIPT_SECRET = <the same string you put in SHARED_SECRET below>
//
// If you ever edit and redeploy this script, choose "New deployment" again
// (not "Manage deployments" -> edit) or the URL can change.

var SHEET_GID = 1232290898; // "upcoming Conference" tab (matches CONFERENCE_SHEET_GID in the app)
var SHARED_SECRET = 'REPLACE_WITH_A_RANDOM_SECRET';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return _json({ ok: false, error: 'Unauthorized' });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetById(SHEET_GID);
    if (!sheet) {
      return _json({ ok: false, error: 'Sheet tab not found (check SHEET_GID)' });
    }

    var action = body.action || 'add';
    if (action === 'add') return _addRow(sheet, body.fields || {});
    if (action === 'update') return _updateRow(sheet, body.match || {}, body.fields || {});
    if (action === 'delete') return _deleteRow(sheet, body.match || {});
    return _json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// Lowercased, trimmed header names for the sheet's first row.
function _headers(sheet) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headerRow.map(function (h) { return String(h || '').trim().toLowerCase(); });
}

// Maps our field names (name/date/deadline/location/abstract/link) onto
// whatever the sheet's actual column headers are, so column reordering or
// renaming (e.g. "Deadline" -> "Registration Deadline") doesn't break this.
function _fieldsToRow(headers, fields) {
  var fieldByHeader = {
    'conference name': fields.name || '',
    'date': fields.date || '',
    'conference date': fields.date || '',
    'deadline': fields.deadline || '',
    'registration deadline': fields.deadline || '',
    'location': fields.location || '',
    'abstraction submission': fields.abstract || '',
    'abstract submission': fields.abstract || '',
    'link': fields.link || ''
  };
  return headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(fieldByHeader, h) ? fieldByHeader[h] : '';
  });
}

function _addRow(sheet, fields) {
  var headers = _headers(sheet);
  sheet.appendRow(_fieldsToRow(headers, fields));
  return _json({ ok: true });
}

// There's no ID column, so edit/delete identify a row by matching every
// field's current value exactly (the client sends the row's own last-loaded
// values as `match`). Returns the 1-based sheet row number, or -1.
function _findRow(sheet, headers, match) {
  var wanted = _fieldsToRow(headers, match);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var same = true;
    for (var c = 0; c < headers.length; c++) {
      if (String(data[i][c] || '').trim() !== String(wanted[c] || '').trim()) { same = false; break; }
    }
    if (same) return i + 2; // +2: 1-based, and data starts after the header row
  }
  return -1;
}

var ROW_NOT_FOUND_ERROR = 'Matching conference row not found — it may have already changed. Try Refresh and try again.';

function _updateRow(sheet, match, fields) {
  var headers = _headers(sheet);
  var rowNum = _findRow(sheet, headers, match);
  if (rowNum === -1) return _json({ ok: false, error: ROW_NOT_FOUND_ERROR });
  sheet.getRange(rowNum, 1, 1, headers.length).setValues([_fieldsToRow(headers, fields)]);
  return _json({ ok: true });
}

function _deleteRow(sheet, match) {
  var headers = _headers(sheet);
  var rowNum = _findRow(sheet, headers, match);
  if (rowNum === -1) return _json({ ok: false, error: ROW_NOT_FOUND_ERROR });
  sheet.deleteRow(rowNum);
  return _json({ ok: true });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
