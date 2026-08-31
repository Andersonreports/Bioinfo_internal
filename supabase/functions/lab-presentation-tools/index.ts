// Edge Function backing the Lab Presentations tab's Add/Edit/Delete/Upload
// actions — mirrors every change made in Supabase's `presentations` table
// out to the "Lab Presentation" tab of the team Google Sheet, the same way
// conference-tools keeps the Conference tab in sync.
//
// Request modes (all POST, JSON body):
//   { mode: "add", fields }
//     -> appends a row to the Lab Presentation sheet tab
//   { mode: "update", match: { id }, fields }
//     -> finds the row with this id and overwrites it with `fields`
//   { mode: "delete", match: { id } }
//     -> finds the row with this id and deletes it
// `fields` shape: { id, topic, date, presenter, status, remarks, link, file }
// (`id` is the presentation's Supabase UUID — written into an ID column so
// rows can be matched reliably even after the topic/presenter are edited.)
//
// Deploy:
//   supabase functions deploy lab-presentation-tools
//
// Reuses the same secrets already configured for conference-tools — no new
// ones needed:
//   APPS_SCRIPT_URL     - the /exec URL from the Google Apps Script Web App deployment
//                         (see google-apps-script/conference-sheet-writer.gs in this repo)
//   APPS_SCRIPT_SECRET  - same random string used as SHARED_SECRET in that Apps Script

const APPS_SCRIPT_URL = Deno.env.get("APPS_SCRIPT_URL") ?? "";
const APPS_SCRIPT_SECRET = Deno.env.get("APPS_SCRIPT_SECRET") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
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
    return { kind: "non-json", status: res.status, raw: rawText };
  }
}

async function callAppsScript(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) throw new Error("Sheet write-back is not configured (missing APPS_SCRIPT_URL secret)");

  let result = await callAppsScriptOnce(payload);
  // Only "update"/"delete" are safe to retry on a delivery failure — they're
  // idempotent via the id lookup, but retrying "add" could append a
  // duplicate row if the first attempt actually ran server-side and only
  // failed to deliver its response.
  const canRetry = payload.action === "lp_update" || payload.action === "lp_delete";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const body = await req.json();

    if (body.mode === "add") {
      await callAppsScript({ action: "lp_add", fields: body.fields });
      return jsonResponse({ ok: true });
    }
    if (body.mode === "update") {
      await callAppsScript({ action: "lp_update", match: body.match, fields: body.fields });
      return jsonResponse({ ok: true });
    }
    if (body.mode === "delete") {
      await callAppsScript({ action: "lp_delete", match: body.match });
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: "Unknown mode" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
