import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const CRM_API_URL = "https://functions.yandexcloud.net/d4ebvaiffdtsos840t16";
const ALLOWED_ORIGINS = new Set(["https://admin.kotomatika.ru"]);

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://admin.kotomatika.ru";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);

  let input: { sessionToken?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: "Некорректный JSON" }, 400, origin);
  }

  const sessionToken = String(input.sessionToken || "").trim();
  if (!sessionToken) return json({ ok: false, error: "Не хватает sessionToken" }, 400, origin);

  let crm: any;
  try {
    const r = await fetch(CRM_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ action: "bootstrap", sessionToken }),
    });
    crm = await r.json().catch(() => null);
    if (!r.ok || !crm?.ok) return json({ ok: false, error: "CRM-сессия недействительна" }, 401, origin);
  } catch {
    return json({ ok: false, error: "Не удалось проверить CRM-сессию" }, 502, origin);
  }

  const leadIds = Array.isArray(crm.leads)
    ? crm.leads.map((x: any) => String(x?.id || "").trim()).filter(Boolean)
    : [];

  if (!leadIds.length) return json({ ok: true, states: [] }, 200, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("crm_trial_sync_state")
    .select("lead_id, state, reason, scheduled_at, started_at, completed_at, attendance_status, changed_at")
    .in("lead_id", leadIds);

  if (error) {
    return json({ ok: false, error: "Не удалось получить статусы пробных из Mathroom", details: error.message }, 500, origin);
  }

  return json({
    ok: true,
    states: (data || []).map((row: any) => ({
      leadId: row.lead_id,
      state: row.state,
      reason: row.reason,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      attendanceStatus: row.attendance_status,
      changedAt: row.changed_at,
    })),
  }, 200, origin);
});
