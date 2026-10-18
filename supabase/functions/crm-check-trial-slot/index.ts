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
function parseTrial(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (ru) {
    const [, dd, mm, yyyy, hh, min] = ru;
    // CRM calendar is Moscow time (UTC+3).
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh) - 3, Number(min)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function clock(d: Date) {
  return d.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);

  let input: { sessionToken?: string; teacherKey?: string; trialAt?: string; leadId?: string };
  try { input = await req.json(); }
  catch { return json({ ok: false, error: "Некорректный JSON" }, 400, origin); }

  const sessionToken = String(input.sessionToken || "").trim();
  const teacherKey = String(input.teacherKey || "").trim();
  const trialAt = parseTrial(input.trialAt);
  const leadId = String(input.leadId || "").trim();

  if (!sessionToken) return json({ ok: false, error: "CRM-сессия не найдена" }, 401, origin);
  if (!teacherKey || teacherKey === "Не назначен") return json({ ok: false, error: "Сначала назначьте преподавателя" }, 409, origin);
  if (!trialAt) return json({ ok: false, error: "Укажите корректные дату и время пробного" }, 409, origin);

  try {
    const r = await fetch(CRM_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ action: "bootstrap", sessionToken }),
    });
    const crm = await r.json().catch(() => null);
    if (!r.ok || !crm?.ok) return json({ ok: false, error: "CRM-сессия недействительна" }, 401, origin);
  } catch {
    return json({ ok: false, error: "Не удалось проверить CRM-сессию" }, 502, origin);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: teacher, error: teacherError } = await supabase
    .from("teachers")
    .select("id, display_name, access_enabled")
    .eq("crm_teacher_key", teacherKey)
    .maybeSingle();

  if (teacherError) return json({ ok: false, error: "Не удалось проверить преподавателя", details: teacherError.message }, 500, origin);
  if (!teacher) return json({ ok: false, error: `Преподаватель «${teacherKey}» ещё не создан в Mathroom` }, 409, origin);
  if (teacher.access_enabled === false) return json({ ok: false, error: `У преподавателя «${teacherKey}» отключён доступ Mathroom` }, 409, origin);

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, scheduled_at, started_at, duration_minutes, status, crm_event_key, students(name)")
    .eq("teacher_id", teacher.id)
    .in("status", ["assigned", "in_progress"])
    .limit(1000);

  if (error) return json({ ok: false, error: "Не удалось проверить расписание преподавателя", details: error.message }, 500, origin);

  const wantedStart = trialAt.getTime();
  const wantedEnd = wantedStart + 60 * 60 * 1000;
  const ownEventKey = leadId ? `crm-trial:${leadId}` : "";

  const conflict = (lessons || []).find((lesson: any) => {
    if (ownEventKey && String(lesson.crm_event_key || "") === ownEventKey) return false;
    const rawStart = lesson.scheduled_at || lesson.started_at;
    if (!rawStart) return false;
    const start = new Date(rawStart).getTime();
    if (!Number.isFinite(start)) return false;
    const duration = Math.max(15, Number(lesson.duration_minutes || 60));
    return start < wantedEnd && start + duration * 60 * 1000 > wantedStart;
  });

  if (!conflict) return json({ ok: true, available: true, teacher: teacher.display_name }, 200, origin);

  const rawStart = conflict.scheduled_at || conflict.started_at;
  const startDate = new Date(rawStart);
  const duration = Math.max(15, Number(conflict.duration_minutes || 60));
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
  const relation = Array.isArray(conflict.students) ? conflict.students[0] : conflict.students;
  const busyStudent = String(relation?.name || "своим учеником");

  return json({
    ok: false,
    available: false,
    code: "teacher_schedule_conflict",
    error: `У преподавателя «${teacher.display_name || teacherKey}» в это время уже идёт/запланирован урок с учеником «${busyStudent}» (${clock(startDate)}–${clock(endDate)}). Выберите другое время пробного.`,
    conflictStudent: busyStudent,
    conflictStartsAt: rawStart,
    conflictDurationMinutes: duration,
  }, 409, origin);
});
