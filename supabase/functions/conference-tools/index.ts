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
    name: { type: "STRING", description: "Official conference/event name, only if explicitly stated" },
    date: { type: "STRING", description: 'Full conference date(s) as written on the page, e.g. "September 2-3, 2026". Empty string if not explicitly stated — do NOT use a bare year (e.g. from the event\'s own name/title) as a substitute.' },
    deadline: { type: "STRING", description: "Registration deadline date, written exactly as it appears. Empty string unless explicitly stated." },
    location: { type: "STRING", description: "Venue, city, or address. Empty string unless explicitly stated." },
    abstract: { type: "STRING", description: "Abstract submission deadline date, written exactly as it appears. Empty string unless explicitly stated." },
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

// LinkedIn rewrites every outbound link shared in a post into a
// linkedin.com/safety/go/?url=... wrapper, which blocks non-browser
// requests outright (a plain fetch gets a 404) — pull the real target out
// of the `url` query param instead of trying to fetch the wrapper itself.
function unwrapKnownRedirectors(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("linkedin.com") && u.pathname.startsWith("/safety/go") && u.searchParams.has("url")) {
      return u.searchParams.get("url") as string;
    }
  } catch (_) {
    // not a valid URL — let the caller's fetch surface the real error
  }
  return url;
}

// Shortlinks (lnkd.in, bit.ly, etc.) often serve a near-empty interstitial
// page with a single outbound link rather than a real HTTP redirect —
// there's nothing in a page like that for the model to extract from. Find
// that one link so it can be followed instead.
// Redirector/tracking domains to skip even when they're a "different host"
// from the stub page — otherwise the shortener's own nav/logo link (e.g.
// LinkedIn's header logo pointing at linkedin.com) gets picked up as if it
// were the real destination, since it technically isn't on the stub's host.
const REDIRECTOR_CHROME_HOSTS = ["linkedin.com", "licdn.com", "lnkd.in"];
function isChromeHost(host: string): boolean {
  return REDIRECTOR_CHROME_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function firstOutboundLink(html: string, fromUrl: string): string | null {
  const fromHost = new URL(fromUrl).hostname;
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const href of hrefs) {
    try {
      const abs = new URL(href, fromUrl).toString();
      if (!/^https?:\/\//i.test(abs)) continue;
      const host = new URL(abs).hostname;
      if (host === fromHost || isChromeHost(host)) continue;
      return abs;
    } catch (_) {
      continue;
    }
  }
  return null;
}

async function fetchPage(url: string): Promise<{ html: string; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ConferenceDetailsBot/1.0)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Could not fetch the page (HTTP ${res.status})`);
  const html = await res.text();
  return { html, text: stripHtml(html).slice(0, 30000) };
}

// Conference sites routinely split the fields we need across several pages
// (dates on the homepage, deadlines on a "Registration" page, abstract
// deadline on an "About Conference" page, etc.) — a single page is often
// missing something that's genuinely on the site, just not on that page.
// These path keywords are how such pages are conventionally named/linked.
const RELEVANT_LINK_KEYWORDS = [
  "about", "conference", "registration", "register", "abstract",
  "date", "venue", "schedule", "important", "call-for", "submission", "deadline",
];
const MAX_CRAWL_PAGES = 4; // additional pages beyond the one the user pasted
const MAX_TOTAL_TEXT = 60000;

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const baseHost = new URL(baseUrl).hostname;
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    try {
      const abs = new URL(href, baseUrl).toString().split("#")[0];
      if (!/^https?:\/\//i.test(abs)) continue;
      if (new URL(abs).hostname !== baseHost) continue;
      if (abs === baseUrl || seen.has(abs)) continue;
      seen.add(abs);
      links.push(abs);
    } catch (_) {
      continue;
    }
  }
  return links;
}

function relevantLinkScore(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  let score = 0;
  for (const kw of RELEVANT_LINK_KEYWORDS) if (path.includes(kw)) score++;
  return score;
}

// Fetches a handful of the most relevant same-site pages (by URL keyword
// match) linked from the start page, and concatenates all their text
// together so the model sees the whole site's info in one shot, not just
// whatever happens to be on the one page the link pointed at.
async function crawlForText(startUrl: string, startHtml: string, startText: string): Promise<string> {
  let combined = `--- Page: ${startUrl} ---\n${startText}`;

  const links = extractInternalLinks(startHtml, startUrl)
    .map((link) => ({ link, score: relevantLinkScore(link) }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CRAWL_PAGES);

  for (const { link } of links) {
    if (combined.length >= MAX_TOTAL_TEXT) break;
    try {
      const page = await fetchPage(link);
      if (page.text) combined += `\n\n--- Page: ${link} ---\n${page.text}`;
    } catch (_) {
      // a page that fails to fetch just gets skipped, not fatal
    }
  }
  return combined.slice(0, MAX_TOTAL_TEXT);
}

async function extractFromUrl(url: string) {
  if (!GEMINI_API_KEY) throw new Error("Extraction is not configured (missing GEMINI_API_KEY secret)");

  let effectiveUrl = unwrapKnownRedirectors(url);
  let { html, text } = await fetchPage(effectiveUrl);

  // Thin stub/interstitial page — follow its one outbound link instead of
  // trying to extract anything from it.
  if (text.length < 400) {
    const nextUrl = firstOutboundLink(html, effectiveUrl);
    if (nextUrl) {
      try {
        const next = await fetchPage(nextUrl);
        if (next.text.length > text.length) {
          effectiveUrl = nextUrl;
          html = next.html;
          text = next.text;
        }
      } catch (_) {
        // couldn't follow it — fall back to whatever the stub page had
      }
    }
  }
  if (!text) throw new Error("The page had no readable text content");

  const siteText = await crawlForText(effectiveUrl, html, text);

  const prompt = `You are extracting structured conference/event details from the text content of a conference website. The text below may span several pages of the same site (each marked with "--- Page: <url> ---") — the fields you need are often split across pages (e.g. dates on the homepage, a deadline on a Registration page, an abstract deadline on an About page), so read ALL of it before answering, not just the first page.

Accuracy matters far more than filling every field: only report a value when that specific piece of information is explicitly and unambiguously stated somewhere in the text. If you are not certain, or a field simply isn't mentioned anywhere, return an empty string for it — never guess, infer, or substitute a plausible-looking but unconfirmed value (e.g. a bare year pulled from the event's own name is not a conference date).

Extract these fields as JSON:
- name: the official conference/event name
- date: the full conference date(s), written exactly as they appear on the page (empty string if the page doesn't give a specific date)
- deadline: the registration deadline date, written exactly as it appears (empty string if not mentioned)
- location: the venue, city, or address (empty string if not mentioned)
- abstract: the abstract submission deadline date, written exactly as it appears (empty string if not mentioned)

Site text:
"""
${siteText}
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
    link: effectiveUrl,
  };
}

type AppsScriptResult = { kind: "json"; ok: boolean; error?: string } | { kind: "non-json"; status: number; raw: string };

async function callAppsScriptOnce(payload: Record<string, unknown>): Promise<AppsScriptResult> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: APPS_SCRIPT_SECRET }),
    redirect: "follow",
  });
  const rawText = await res.text();
  try {
    const parsed = JSON.parse(rawText);
    return { kind: "json", ok: !!parsed.ok, error: parsed.error };
  } catch (_) {
    // Not JSON — most likely a transient Google Drive/Docs error page
    // ("Sorry, unable to open the file at present") rather than anything
    // Apps Script itself returned.
    return { kind: "non-json", status: res.status, raw: rawText };
  }
}

async function callAppsScript(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) throw new Error("Sheet write-back is not configured (missing APPS_SCRIPT_URL secret)");

  let result = await callAppsScriptOnce(payload);
  // A non-JSON response is usually just a transient delivery failure on
  // Google's side — one retry after a short pause reliably clears it.
  // Only safe to retry "update"/"delete" though: they're idempotent via the
  // name lookup, but retrying "add" could append a duplicate row if the
  // first attempt actually ran server-side and only failed to deliver its
  // response (an observed failure mode, not a hypothetical one).
  const canRetry = payload.action === "update" || payload.action === "delete";
  if (result.kind === "non-json" && canRetry) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    result = await callAppsScriptOnce(payload);
  }

  if (result.kind === "non-json") {
    throw new Error(`Sheet write failed (Apps Script returned HTTP ${result.status}, non-JSON body: ${result.raw.slice(0, 300)})`);
  }
  if (!result.ok) {
    throw new Error(`Sheet write failed (${result.error || "unknown error"})`);
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

// These 5 rows were typed straight into the sheet by hand, before this
// feature existed — trust whatever's already in their filled fields and
// never flag a "change" for them (AI re-extraction noise like an en-dash vs
// a hyphen, or a shortened address, isn't a real change worth a review
// prompt). Blank fields on these rows still get auto-filled as normal.
// Remove a name from this list once you're ready for it to get full
// change-flagging like everything else.
const SKIP_CHANGE_FLAGGING = new Set([
  "genomics india conference 2026",
  "11th international cell & gene therapy conference (cgtcon 2026)",
  "12th annual conference of the society for mitochondrial research and medicine (smrm 2026)",
  "ishg 2027 - international conference on human genomics to precision medicine",
  "iamg 2026 - society for indian academy of medical genetics",
]);
const FIELD_ALIASES: Record<keyof ConferenceRow, string[]> = {
  name: ["conference name", "conference"],
  date: ["date", "conference date"],
  deadline: ["deadline", "registration deadline"],
  location: ["location"],
  abstract: ["abstraction submission", "abstract submission"],
  link: ["link"],
};

// Quote-aware CSV -> array of string[] rows (no header mapping), matching
// the same parser used client-side in index.html. Handles the RFC4180
// escaped-quote rule ("" inside a quoted field -> a literal ") — a
// toggle-only parser silently drops those quote characters instead, which
// breaks exact-value matching for any cell that contains one.
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
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
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
      } else if (oldVal && newVal && norm(oldVal) !== norm(newVal) && !SKIP_CHANGE_FLAGGING.has(norm(row.name))) {
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
