// Google Apps Script — adds/updates/deletes rows in the "upcoming Conference"
// and "Lab Presentation" tabs of the team sheet. This is what the Conference
// tab (Add Details / per-row Edit / Delete) and the Lab Presentations tab
// (Add Presentation / Edit / Delete / Upload PPT / Undo) write through to,
// via the conference-tools and lab-presentation-tools Supabase Edge Functions
// respectively. One deployment of this script serves both.
//
// SETUP (one time, in the Google account that owns the Sheet):
//   1. Open the Sheet -> Extensions -> Apps Script.
//   2. Delete the default boilerplate and paste this whole file in.
//   3. Replace SHARED_SECRET below with a long random string of your choice
//      (e.g. generate one at https://www.uuidgenerator.net/). Keep it secret.
//   4. Set LAB_PRES_SHEET_GID below to the "Lab Presentation" tab's gid (open
//      that tab in the Sheet and copy the number after #gid= in the URL bar).
//   5. Save the project (any name is fine).
//   6. Deploy -> New deployment -> gear icon -> select type "Web app".
//        - Execute as: Me
//        - Who has access: Anyone
//      Click Deploy, then authorize the script when prompted (it needs
//      permission to edit this spreadsheet).
//   7. Copy the "Web app URL" it gives you (ends in /exec).
//   8. In the Supabase project, set these Edge Function secrets (shared by
//      both conference-tools and lab-presentation-tools):
//        APPS_SCRIPT_URL    = <the /exec URL from step 7>
//        APPS_SCRIPT_SECRET = <the same string you put in SHARED_SECRET below>
//
// The "Lab Presentation" tab needs these column headers in row 1 (any order,
// case-insensitive): ID, Topic, Date, Presenter, Status, Remarks, Link, File.
// The ID column holds the presentation's Supabase id — it's what Edit/Delete
// use to find the right row again, so don't remove or hand-edit it.
//
// If you ever edit and redeploy this script, use "Manage deployments" -> the
// pencil icon on the existing deployment -> Version: "New version" -> Deploy.
// That updates the code in place without changing the URL. Choosing "New
// deployment" instead gives you a different URL, which would need updating
// in both Supabase Edge Function secrets above.

var SHEET_GID = 1232290898; // "upcoming Conference" tab (matches CONFERENCE_SHEET_GID in the app)
var LAB_PRES_SHEET_GID = 0; // TODO: replace with the "Lab Presentation" tab's gid
var SHARED_SECRET = 'REPLACE_WITH_A_RANDOM_SECRET';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return _json({ ok: false, error: 'Unauthorized' });
    }

    var action = body.action || 'add';

    if (action === 'lp_add' || action === 'lp_update' || action === 'lp_delete') {
      var lpSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetById(LAB_PRES_SHEET_GID);
      if (!lpSheet) {
        return _json({ ok: false, error: 'Lab Presentation sheet tab not found (check LAB_PRES_SHEET_GID)' });
      }
      if (action === 'lp_add') return _lpAddRow(lpSheet, body.fields || {});
      if (action === 'lp_update') return _lpUpdateRow(lpSheet, body.match || {}, body.fields || {});
      return _lpDeleteRow(lpSheet, body.match || {});
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetById(SHEET_GID);
    if (!sheet) {
      return _json({ ok: false, error: 'Sheet tab not found (check SHEET_GID)' });
    }

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

// Loose-equality normalizer: collapses runs of whitespace and lowercases, so
// rows typed by hand directly into the sheet (extra spaces, different
// capitalization, etc.) still match what the app has cached, instead of
// requiring byte-for-byte identical strings.
function _norm(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// There's no ID column, so edit/delete identify a row by conference name
// (the client already treats the name as the row's identity — it's how
// every edit/delete/pending-change action locates a row before calling
// this). Matching used to require every field (date, deadline, location,
// abstract, link) to be byte-identical to the sheet's live cells too, which
// meant ANY single field drifting out of sync with the client's cache — a
// date-typed cell read back as a JS Date instead of the plain string the
// client cached, a stray whitespace/newline difference from the CSV export,
// etc. — broke the lookup for the whole row, even when only one unrelated
// field was being edited. Name-only matching removes that whole class of
// false "row not found" errors.
function _findRow(sheet, headers, match) {
  var nameCol = -1;
  for (var h = 0; h < headers.length; h++) {
    if (headers[h] === 'conference name' || headers[h] === 'conference') { nameCol = h; break; }
  }
  if (nameCol === -1) return -1;
  var wantedName = _norm(match.name);
  if (!wantedName) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (_norm(data[i][nameCol]) === wantedName) return i + 2; // +2: 1-based, and data starts after the header row
  }
  return -1;
}

var ROW_NOT_FOUND_ERROR = 'Matching conference row not found by name — it may have been renamed or removed. Try Refresh and try again.';

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

// ---- Lab Presentation tab ----
// Unlike the Conference tab, every row here has a stable Supabase id, so
// rows are matched by ID rather than by name — immune to topic/presenter
// edits ever breaking the lookup.

function _lpFieldsToRow(headers, fields) {
  var fieldByHeader = {
    'id': fields.id || '',
    'topic': fields.topic || '',
    'date': fields.date || '',
    'presenter': fields.presenter || '',
    'status': fields.status || '',
    'remarks': fields.remarks || '',
    'link': fields.link || '',
    'file': fields.file || ''
  };
  return headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(fieldByHeader, h) ? fieldByHeader[h] : '';
  });
}

function _lpFindRowById(sheet, headers, id) {
  var idCol = headers.indexOf('id');
  if (idCol === -1 || !id) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) return i + 2; // +2: 1-based, and data starts after the header row
  }
  return -1;
}

function _lpAddRow(sheet, fields) {
  var headers = _headers(sheet);
  sheet.appendRow(_lpFieldsToRow(headers, fields));
  return _json({ ok: true });
}

var LP_ROW_NOT_FOUND_ERROR = 'Matching presentation row not found by id — it may have been removed from the sheet directly.';

function _lpUpdateRow(sheet, match, fields) {
  var headers = _headers(sheet);
  var rowNum = _lpFindRowById(sheet, headers, match.id);
  if (rowNum === -1) return _json({ ok: false, error: LP_ROW_NOT_FOUND_ERROR });
  sheet.getRange(rowNum, 1, 1, headers.length).setValues([_lpFieldsToRow(headers, fields)]);
  return _json({ ok: true });
}

function _lpDeleteRow(sheet, match) {
  var headers = _headers(sheet);
  var rowNum = _lpFindRowById(sheet, headers, match.id);
  if (rowNum === -1) return _json({ ok: false, error: LP_ROW_NOT_FOUND_ERROR });
  sheet.deleteRow(rowNum);
  return _json({ ok: true });
}
