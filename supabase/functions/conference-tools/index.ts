// Edge Function backing the Conference tab's "Add Details" button, its
// per-row Edit/Delete actions, and the daily auto-refresh cron job.
//
// Request modes (all POST, JSON body):
//   { mode: "extract", url }
//     -> fetches the page, asks Gemini to pull out fields, returns { fields }
//   { mode: "add", fields }
//     -> appends a row to the Google Sheet
//   { mode: "update", match, fields }
//     -> finds the row whose current values equal `match` and overwrites it with `fields`
//   { mode: "delete", match }
//     -> finds the row whose current values equal `match` and deletes it
//   { mode: "refresh_all" }
//     -> re-extracts every conference row's link; fills in blank fields
//        directly, and records a conference_pending_changes row (for human
//        review in the app) for any field that already had a value but now
//        differs. Triggered by the pg_cron job in supabase_setup.sql, not by
//        the client.
// `fields`/`match` shape: { name, date, deadline, location, abstract, link }
//
// Deploy:
//   supabase functions deploy conference-tools
//
// Required secrets (Project Settings -> Edge Functions -> Secrets, or `supabase secrets set`):
//   GEMINI_API_KEY      - free key from https://aistudio.google.com/apikey
//   APPS_SCRIPT_URL     - the /exec URL from the Google Apps Script Web App deployment
//                         (see google-apps-script/conference-sheet-writer.gs in this repo)
//   APPS_SCRIPT_SECRET  - same random string used as SHARED_SECRET in that Apps Script
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the
// platform for every Edge Function — no setup needed for those two.)

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET = Deno.env.get("APPS_SCRIPT_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Same Google Sheet the app's Conference tab reads from (index.html's
// SHEET_ID / CONFERENCE_SHEET_GID) — keep these two in sync if that sheet
// ever moves.
const SHEET_ID = "1ZIs0bbHxkwpo1nUvDcLr-oRei1mUOlaOJISOoeNI6Pc";
const CONFERENCE_SHEET_GID = "1232290898";
// Tried in order until one responds successfully. Model availability and
// free-tier quotas vary by project/key and change over time (older names get
// retired, newer ones have tighter initial quotas), so we don't hardcode a
// single model — "-latest" aliases are Google's own moving pointer to
// whatever they currently recommend, which is the most future-proof choice.
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIELD_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "Official conference/event name" },
    date: { type: "STRING", description: 'Full conference date(s) as written on the page, e.g. "September 2-3, 2026". Empty string if the page has no specific date — do NOT use a bare year (e.g. from the event\'s own name/title) as a substitute.' },
    deadline: { type: "STRING", description: "Registration deadline date, written exactly as it appears. Empty string if not mentioned." },
    location: { type: "STRING", description: "Venue, city, or address. Empty string if not mentioned." },
    abstract: { type: "STRING", description: "Abstract submission deadline date, written exactly as it appears. Empty string if not mentioned." },
  },
  required: ["name", "date", "deadline", "location", "abstract"],
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractFromUrl(url: string) {
  if (!GEMINI_API_KEY) throw new Error("Extraction is not configured (missing GEMINI_API_KEY secret)");

  const pageRes = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ConferenceDetailsBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!pageRes.ok) throw new Error(`Could not fetch the page (HTTP ${pageRes.status})`);
  const html = await pageRes.text();
  const text = stripHtml(html).slice(0, 30000);
  if (!text) throw new Error("The page had no readable text content");

  const prompt = `You are extracting structured conference/event details from the text content of a webpage.
Read the text below and extract these fields as JSON:
- name: the official conference/event name
- date: the full conference date(s), written exactly as they appear on the page (empty string if the page doesn't give a specific date — do not use a bare year from the event's own name/title as a substitute)
- deadline: the registration deadline date, written exactly as it appears (empty string if not mentioned)
- location: the venue, city, or address (empty string if not mentioned)
- abstract: the abstract submission deadline date, written exactly as it appears (empty string if not mentioned)

Page text:
"""
${text}
"""`;

  let rawText: string | undefined;
  let lastError: Error | undefined;
  for (const model of GEMINI_MODELS) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: FIELD_SCHEMA,
          },
        }),
      },
    );
    if (geminiRes.ok) {
      const geminiJson = await geminiRes.json();
      rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      lastError = undefined;
      break;
    }
    const errText = await geminiRes.text();
    lastError = new Error(`Extraction failed (Gemini HTTP ${geminiRes.status}, model ${model}): ${errText.slice(0, 300)}`);
    // Worth trying the next model on a quota error (429) or an unavailable
    // model (404) — both are model-specific. Anything else (bad key, bad
    // request) will fail identically for every model, so stop there.
    if (geminiRes.status !== 429 && geminiRes.status !== 404) break;
  }
  if (lastError) throw lastError;
  if (!rawText) throw new Error("Extraction returned no data");
  const fields = JSON.parse(rawText);
  return {
    name: fields.name || "",
    date: fields.date || "",
    deadline: fields.deadline || "",
    location: fields.location || "",
    abstract: fields.abstract || "",
    link: url,
  };
}

async function callAppsScript(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) throw new Error("Sheet write-back is not configured (missing APPS_SCRIPT_URL secret)");
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: APPS_SCRIPT_SECRET }),
    redirect: "follow",
  });
  const rawText = await res.text();
  let json: { ok?: boolean; error?: string } | null = null;
  try {
    json = JSON.parse(rawText);
  } catch (_) {
    // Not JSON — most likely Apps Script returned an HTML page (e.g. a
    // Google sign-in/permission wall) instead of running the script.
  }
  if (!json || !json.ok) {
    const detail = (json && json.error) || `Apps Script returned HTTP ${res.status}, non-JSON body: ${rawText.slice(0, 300)}`;
    throw new Error(`Sheet write failed (${detail})`);
  }
}

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---- Daily auto-refresh (mode: "refresh_all") ----

type ConferenceRow = { name: string; date: string; deadline: string; location: string; abstract: string; link: string };
const DIFF_FIELDS: (keyof ConferenceRow)[] = ["date", "deadline", "location", "abstract"];
const FIELD_ALIASES: Record<keyof ConferenceRow, string[]> = {
  name: ["conference name", "conference"],
  date: ["date", "conference date"],
  deadline: ["deadline", "registration deadline"],
  location: ["location"],
  abstract: ["abstraction submission", "abstract submission"],
  link: ["link"],
};

// Quote-aware CSV -> array of string[] rows (no header mapping), matching
// the same parser used client-side in index.html.
function parseCSVRows(csv: string): string[][] {
  const rows: string[][] = [];
  (csv || "").split("\n").forEach((line) => {
    if (line.replace(/[\s,]/g, "") === "") {
      rows.push([]);
      return;
    }
    const row: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) {
        row.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    row.push(cur.trim());
    rows.push(row);
  });
  return rows;
}

function extractConferenceRows(csv: string): ConferenceRow[] {
  const rows = parseCSVRows(csv);
  const fieldNames = Object.keys(FIELD_ALIASES) as (keyof ConferenceRow)[];
  let headerIdx = -1;
  let cols: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const lower = rows[i].map((h) => (h || "").trim().toLowerCase());
    const c: Record<string, number> = {};
    let matches = 0;
    for (const f of fieldNames) {
      let idx = -1;
      for (const alias of FIELD_ALIASES[f]) {
        const j = lower.findIndex((h) => h === alias || h.startsWith(alias + " "));
        if (j !== -1) {
          idx = j;
          break;
        }
      }
      c[f] = idx;
      if (idx !== -1) matches++;
    }
    if (matches >= 3) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const out: ConferenceRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const obj: Partial<ConferenceRow> = {};
    let any = false;
    for (const f of fieldNames) {
      const idx = cols[f];
      const v = idx >= 0 ? (row[idx] || "").trim() : "";
      obj[f] = v;
      if (v) any = true;
    }
    if (any) out.push(obj as ConferenceRow);
  }
  return out;
}

// Same loose-equality rule as the Apps Script's row matching, so a value
// that only differs by whitespace/case isn't treated as a real change.
function norm(v: string): string {
  return String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function pendingChangeExists(name: string, field: string, newValue: string): Promise<boolean> {
  const params = new URLSearchParams({
    select: "id",
    conference_name: `eq.${name}`,
    field: `eq.${field}`,
    new_value: `eq.${newValue}`,
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/conference_pending_changes?${params.toString()}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) return false; // fail open — worst case is a duplicate pending row
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function insertPendingChange(row: {
  conference_name: string;
  conference_link: string;
  field: string;
  old_value: string;
  new_value: string;
}) {
  await fetch(`${SUPABASE_URL}/rest/v1/conference_pending_changes`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
}

async function refreshAll() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("refresh_all is not configured (missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — should be auto-provided)");
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${CONFERENCE_SHEET_GID}`;
  const csv = await fetch(csvUrl).then((r) => r.text());
  const rows = extractConferenceRows(csv);

  let filled = 0;
  let flagged = 0;
  let errors = 0;

  for (const row of rows) {
    if (!row.link) continue;

    let fresh: ConferenceRow;
    try {
      fresh = await extractFromUrl(row.link);
    } catch (_err) {
      errors++;
      continue; // one bad/unreachable link shouldn't stop the whole run
    }

    const toFill: Partial<ConferenceRow> = {};
    let hasFill = false;
    for (const f of DIFF_FIELDS) {
      const oldVal = row[f];
      const newVal = fresh[f];
      if (!oldVal && newVal) {
        toFill[f] = newVal;
        hasFill = true;
      } else if (oldVal && newVal && norm(oldVal) !== norm(newVal)) {
        try {
          const already = await pendingChangeExists(row.name, f, newVal);
          if (!already) {
            await insertPendingChange({
              conference_name: row.name,
              conference_link: row.link,
              field: f,
              old_value: oldVal,
              new_value: newVal,
            });
            flagged++;
          }
        } catch (_err) {
          errors++;
        }
      }
    }

    if (hasFill) {
      try {
        await callAppsScript({ action: "update", match: row, fields: { ...row, ...toFill } });
        filled++;
      } catch (_err) {
        errors++;
      }
    }

    // Be gentle on Gemini's free-tier RPM and on the target sites themselves.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { checked: rows.length, filled, flagged, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const body = await req.json();

    if (body.mode === "extract") {
      const fields = await extractFromUrl(body.url);
      return jsonResponse({ ok: true, fields });
    }

    if (body.mode === "add" || body.mode === "update" || body.mode === "delete") {
      await callAppsScript({ action: body.mode, fields: body.fields, match: body.match });
      return jsonResponse({ ok: true });
    }

    if (body.mode === "refresh_all") {
      const summary = await refreshAll();
      return jsonResponse({ ok: true, summary });
    }

    return jsonResponse({ ok: false, error: "Unknown mode" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
