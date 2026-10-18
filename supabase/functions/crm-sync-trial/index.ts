import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const CRM_API_URL = "https://functions.yandexcloud.net/d4ebvaiffdtsos840t16";
const ALLOWED_ORIGINS = new Set([
  "https://admin.kotomatika.ru",
]);

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

function normalizeGrade(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 11 ? n : null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);

  let input: { sessionToken?: string; leadId?: string };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: "Некорректный JSON" }, 400, origin);
  }

  const sessionToken = String(input.sessionToken || "").trim();
  const leadId = String(input.leadId || "").trim();
  if (!sessionToken || !leadId) return json({ ok: false, error: "Не хватает sessionToken или leadId" }, 400, origin);

  // CRM остаётся единственным доверенным источником данных заявки.
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

  const lead = Array.isArray(crm.leads) ? crm.leads.find((x: any) => String(x?.id) === leadId) : null;
  if (!lead) return json({ ok: false, error: "Заявка не найдена в CRM" }, 404, origin);

  const teacherKey = String(lead.teacher_id || "").trim();
  const trialAt = lead.trial_at ? new Date(lead.trial_at) : null;
  const grade = normalizeGrade(lead.grade);
  const studentName = String(lead.student_name || "").trim();

  if (!teacherKey || teacherKey === "Не назначен") return json({ ok: false, error: "Сначала назначьте преподавателя" }, 409, origin);
  if (!trialAt || Number.isNaN(trialAt.getTime())) return json({ ok: false, error: "Сначала назначьте дату пробного урока" }, 409, origin);
  if (!grade) return json({ ok: false, error: "В заявке не указан корректный класс" }, 409, origin);
  if (!studentName) return json({ ok: false, error: "В заявке не указано имя ученика" }, 409, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: teacher, error: teacherError } = await supabase
    .from("teachers")
    .select("id, display_name, crm_teacher_key, access_enabled")
    .eq("crm_teacher_key", teacherKey)
    .maybeSingle();

  if (teacherError) return json({ ok: false, error: "Ошибка поиска преподавателя", details: teacherError.message }, 500, origin);
  if (!teacher) return json({ ok: false, error: `Преподаватель «${teacherKey}» ещё не создан в Mathroom` }, 409, origin);
  if (teacher.access_enabled === false) {
    return json({ ok: false, error: `У преподавателя «${teacherKey}» отключён доступ Mathroom` }, 409, origin);
  }

  const eventKey = `crm-trial:${leadId}`;
  const trialStartMs = trialAt.getTime();
  const trialEndMs = trialStartMs + 60 * 60 * 1000;

  // CRM may not put a trial on top of a lesson created by the teacher in Mathroom.
  // The same CRM trial is excluded so ordinary rescheduling remains idempotent.
  const { data: occupiedLessons, error: occupiedError } = await supabase
    .from("lessons")
    .select("id, scheduled_at, started_at, duration_minutes, status, crm_event_key, students(name)")
    .eq("teacher_id", teacher.id)
    .in("status", ["assigned", "in_progress"])
    .limit(1000);

  if (occupiedError) {
    return json({ ok: false, error: "Не удалось проверить занятость преподавателя", details: occupiedError.message }, 500, origin);
  }

  const conflict = (occupiedLessons || []).find((lesson: any) => {
    if (String(lesson.crm_event_key || "") === eventKey) return false;
    const rawStart = lesson.scheduled_at || lesson.started_at;
    if (!rawStart) return false;
    const start = new Date(rawStart).getTime();
    if (!Number.isFinite(start)) return false;
    const minutes = Math.max(15, Number(lesson.duration_minutes || 60));
    const end = start + minutes * 60 * 1000;
    return start < trialEndMs && end > trialStartMs;
  });

  if (conflict) {
    const rawStart = conflict.scheduled_at || conflict.started_at;
    const startDate = new Date(rawStart);
    const endDate = new Date(startDate.getTime() + Math.max(15, Number(conflict.duration_minutes || 60)) * 60 * 1000);
    const time = (d: Date) => d.toLocaleTimeString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    });
    const relation = Array.isArray(conflict.students) ? conflict.students[0] : conflict.students;
    const busyStudent = String(relation?.name || "своим учеником");
    return json({
      ok: false,
      code: "teacher_schedule_conflict",
      error: `У преподавателя «${teacher.display_name || teacherKey}» в это время уже есть урок с учеником «${busyStudent}» (${time(startDate)}–${time(endDate)}). Выберите другое время пробного.`,
      conflictLessonId: conflict.id,
      conflictStudent: busyStudent,
      conflictStartsAt: rawStart,
      conflictDurationMinutes: Math.max(15, Number(conflict.duration_minutes || 60)),
    }, 409, origin);
  }

  const studentPayload = {
    teacher_id: teacher.id,
    name: studentName,
    grade,
    notes: "Создано автоматически из КОТОМАТИКА CRM",
    active: true,
    crm_lead_id: leadId,
  };

  // Явно разделяем create/update вместо upsert(onConflict).
  // UNIQUE(crm_lead_id) остаётся страховкой от дублей, но больше не является
  // обязательным условием для обновления уже существующей записи.
  const { data: existingStudent, error: existingStudentError } = await supabase
    .from("students")
    .select("id, teacher_id")
    .eq("crm_lead_id", leadId)
    .maybeSingle();

  if (existingStudentError) {
    return json({ ok: false, error: "Не удалось проверить ученика в Mathroom", details: existingStudentError.message }, 500, origin);
  }

  // If the CRM teacher changed before the trial started, transfer the trial atomically.
  // We intentionally refuse automatic transfer once learning history exists: silently
  // moving historical lessons/materials between teacher cabinets would be unsafe.
  if (existingStudent && existingStudent.teacher_id !== teacher.id) {
    const { data: transfer, error: transferError } = await supabase.rpc("crm_transfer_unstarted_trial", {
      p_lead_id: leadId,
      p_new_teacher: teacher.id,
    });
    if (transferError) {
      const code = String(transferError.message || "");
      const message = code.includes("trial_already_started")
        ? "Пробный уже начат или завершён — преподавателя нельзя перенести автоматически"
        : code.includes("student_has_learning_history")
          ? "У ученика уже есть учебная история — автоматический перенос преподавателя заблокирован"
          : code.includes("target_teacher_unavailable")
            ? "Новый преподаватель недоступен в Mathroom"
            : "Не удалось безопасно перенести ученика к новому преподавателю";
      return json({ ok: false, error: message, details: transferError.message || "" }, 409, origin);
    }
    console.log("[crm-sync-trial] teacher transferred", { leadId, transfer });
  }

  const studentQuery = existingStudent
    ? supabase.from("students").update(studentPayload).eq("id", existingStudent.id)
    : supabase.from("students").insert(studentPayload);

  const { data: student, error: studentError } = await studentQuery
    .select("id, access_token, teacher_id, name, grade")
    .single();

  if (studentError || !student) {
    console.error("[crm-sync-trial] student sync failed", { leadId, existing: Boolean(existingStudent), code: studentError?.code });
    return json({
      ok: false,
      error: existingStudent ? "Не удалось обновить ученика в Mathroom" : "Не удалось создать ученика в Mathroom",
      details: studentError?.message || "",
    }, 500, origin);
  }

  const lessonPayload = {
    teacher_id: teacher.id,
    student_id: student.id,
    scheduled_at: trialAt.toISOString(),
    duration_minutes: 60,
    schedule_note: "Пробный урок создан автоматически из КОТОМАТИКА CRM",
    lesson_type: "trial",
    crm_event_key: eventKey,
    schedule_updated_at: new Date().toISOString(),
  };

  const { data: existingLesson, error: existingLessonError } = await supabase
    .from("lessons")
    .select("id, status, started_at, completed_at, cancelled_at, attendance_status")
    .eq("crm_event_key", eventKey)
    .maybeSingle();

  if (existingLessonError) {
    return json({ ok: false, error: "Ученик синхронизирован, но не удалось проверить пробный урок", details: existingLessonError.message }, 500, origin);
  }

  // Обычное изменение даты/преподавателя не имеет права откатывать уже
  // начатый урок обратно в assigned. Но если прошлое пробное не состоялось
  // (неявка/таймаут) или было отменено, новая дата из CRM открывает тот же
  // crm_event_key заново как запланированный пробный.
  const reopenTrial = Boolean(
    existingLesson &&
      (existingLesson.status === "cancelled" || existingLesson.attendance_status === "absent")
  );

  const lessonUpdatePayload = reopenTrial
    ? {
        ...lessonPayload,
        status: "assigned",
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        cancellation_reason: "",
        attendance_status: "unmarked",
        attendance_note: "",
        attendance_marked_at: null,
        actual_duration_minutes: null,
      }
    : lessonPayload;

  const lessonQuery = existingLesson
    ? supabase.from("lessons").update(lessonUpdatePayload).eq("id", existingLesson.id)
    : supabase.from("lessons").insert({ ...lessonPayload, status: "assigned" });

  const { data: lesson, error: lessonError } = await lessonQuery
    .select("id, scheduled_at, teacher_id, student_id, lesson_type")
    .single();

  if (lessonError || !lesson) {
    console.error("[crm-sync-trial] lesson sync failed", { leadId, existing: Boolean(existingLesson), code: lessonError?.code });
    return json({
      ok: false,
      error: existingLesson ? "Ученик синхронизирован, но пробный урок обновить не удалось" : "Ученик создан, но пробный урок создать не удалось",
      details: lessonError?.message || "",
    }, 500, origin);
  }

  return json({
    ok: true,
    studentId: student.id,
    lessonId: lesson.id,
    accessToken: student.access_token,
    scheduledAt: lesson.scheduled_at,
    teacher: teacher.display_name,
    studentAction: existingStudent ? "updated" : "created",
    lessonAction: existingLesson ? "updated" : "created",
  }, 200, origin);
});
