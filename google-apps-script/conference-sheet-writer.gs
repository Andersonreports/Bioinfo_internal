// Google Apps Script — appends a row to the "upcoming Conference" tab of the
// team sheet. This is what the "Add Details" button on the Conference tab
// writes through to (via the conference-tools Supabase Edge Function).
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

    var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var fieldByHeader = {
      'conference name': body.name || '',
      'date': body.date || '',
      'conference date': body.date || '',
      'deadline': body.deadline || '',
      'registration deadline': body.deadline || '',
      'location': body.location || '',
      'abstraction submission': body.abstract || '',
      'abstract submission': body.abstract || '',
      'link': body.link || ''
    };

    var row = headerRow.map(function (h) {
      var key = String(h || '').trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(fieldByHeader, key) ? fieldByHeader[key] : '';
    });

    sheet.appendRow(row);
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
