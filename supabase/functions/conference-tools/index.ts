// Edge Function backing the Conference tab's "Add Details" button and its
// per-row Edit/Delete actions.
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

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET = Deno.env.get("APPS_SCRIPT_SECRET") ?? "";
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
    date: { type: "STRING", description: 'Conference date(s), written exactly as they appear on the page, e.g. "September 2-3, 2026"' },
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
- date: the conference date(s), written exactly as they appear on the page
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

    return jsonResponse({ ok: false, error: "Unknown mode" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
