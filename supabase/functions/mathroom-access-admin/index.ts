import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const CRM_API_URL = "https://functions.yandexcloud.net/d4ebvaiffdtsos840t16";
const ALLOWED_ORIGINS = new Set(["https://admin.kotomatika.ru"]);
const KNOWN_TEACHERS = new Set(["Егор", "Миша", "Иван", "Никита"]);

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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function randomFrom(chars: string) {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return chars[n[0] % chars.length];
}

function generatePassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + digits + symbols;
  const chars = [
    randomFrom(upper),
    randomFrom(lower),
    randomFrom(digits),
    randomFrom(symbols),
  ];
  while (chars.length < 16) chars.push(randomFrom(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    const j = n[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function verifyCrmSession(sessionToken: string) {
  try {
    const r = await fetch(CRM_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ action: "bootstrap", sessionToken }),
    });
    const body = await r.json().catch(() => null);
    return Boolean(r.ok && body?.ok);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);

  let input: {
    sessionToken?: string;
    action?: string;
    teacherKey?: string;
    email?: string;
    enabled?: boolean;
  };
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: "Некорректный JSON" }, 400, origin);
  }

  const sessionToken = String(input.sessionToken || "").trim();
  const action = String(input.action || "").trim();
  if (!sessionToken || !action) return json({ ok: false, error: "Не хватает sessionToken или action" }, 400, origin);
  if (!(await verifyCrmSession(sessionToken))) return json({ ok: false, error: "CRM-сессия недействительна" }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Mathroom service configuration is missing" }, 500, origin);

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function authUsers() {
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users || [];
  }

  async function writeAudit(
    teacherId: string | null,
    teacherKey: string,
    eventAction: string,
    email: string | null = null,
    details: Record<string, unknown> = {},
  ) {
    const { error } = await supabase.from("teacher_access_audit").insert({
      teacher_id: teacherId,
      teacher_key: teacherKey,
      action: eventAction,
      email,
      details,
    });
    if (error) console.error("[mathroom-access-admin] audit", eventAction, error.message);
  }

  async function accountStats(teacherId: string) {
    const now = new Date().toISOString();
    const [students, upcoming, nextLesson] = await Promise.all([
      supabase.from("students").select("*", { count: "exact", head: true })
        .eq("teacher_id", teacherId).eq("active", true),
      supabase.from("lessons").select("*", { count: "exact", head: true })
        .eq("teacher_id", teacherId).eq("status", "assigned").gte("scheduled_at", now),
      supabase.from("lessons")
        .select("id, scheduled_at, lesson_type, students(name)")
        .eq("teacher_id", teacherId)
        .eq("status", "assigned")
        .gte("scheduled_at", now)
        .order("scheduled_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      activeStudentCount: Number(students.count || 0),
      upcomingLessonCount: Number(upcoming.count || 0),
      nextLessonAt: nextLesson.data?.scheduled_at || null,
      nextLessonStudent: nextLesson.data?.students?.name || null,
      nextLessonType: nextLesson.data?.lesson_type || null,
    };
  }

  if (action === "list") {
    const { data: teachers, error: teachersError } = await supabase
      .from("teachers")
      .select("id, display_name, crm_teacher_key, created_at, access_enabled")
      .not("crm_teacher_key", "is", null)
      .order("created_at", { ascending: true });
    if (teachersError) return json({ ok: false, error: "Не удалось загрузить доступы Mathroom", details: teachersError.message }, 500, origin);

    try {
      const users = await authUsers();
      const byId = new Map(users.map((u) => [u.id, u]));
      const accounts = await Promise.all((teachers || []).map(async (teacher) => {
        const user = byId.get(teacher.id);
        const stats = await accountStats(teacher.id);
        return {
          teacherKey: teacher.crm_teacher_key || teacher.display_name,
          displayName: teacher.display_name,
          userId: teacher.id,
          email: user?.email || "",
          createdAt: teacher.created_at,
          lastSignInAt: user?.last_sign_in_at || null,
          bannedUntil: user?.banned_until || null,
          accessEnabled: teacher.access_enabled !== false,
          ...stats,
        };
      }));
      const { data: auditRows, error: auditError } = await supabase
        .from("teacher_access_audit")
        .select("id, teacher_id, teacher_key, action, email, details, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (auditError) console.error("[mathroom-access-admin] audit list", auditError.message);
      return json({ ok: true, accounts, audit: auditRows || [] }, 200, origin);
    } catch (error) {
      return json({ ok: false, error: "Не удалось прочитать пользователей Mathroom", details: error instanceof Error ? error.message : String(error) }, 500, origin);
    }
  }

  const teacherKey = String(input.teacherKey || "").trim();
  if (!teacherKey) return json({ ok: false, error: "Не указан преподаватель" }, 400, origin);
  if (!KNOWN_TEACHERS.has(teacherKey)) return json({ ok: false, error: "Неизвестный преподаватель" }, 400, origin);

  const { data: teacherRows, error: teacherError } = await supabase
    .from("teachers")
    .select("id, display_name, crm_teacher_key, created_at, access_enabled")
    .eq("crm_teacher_key", teacherKey)
    .limit(2);
  if (teacherError) return json({ ok: false, error: "Ошибка поиска преподавателя Mathroom", details: teacherError.message }, 500, origin);
  if ((teacherRows || []).length > 1) return json({ ok: false, error: "В Mathroom найдено несколько аккаунтов одного преподавателя. Нужна ручная проверка." }, 409, origin);
  const teacher = teacherRows?.[0] || null;

  if (action === "save_access") {
    const email = normalizeEmail(input.email);
    if (!validEmail(email)) return json({ ok: false, error: "Укажите корректный email" }, 400, origin);

    let users;
    try {
      users = await authUsers();
    } catch (error) {
      return json({ ok: false, error: "Не удалось проверить email в Mathroom", details: error instanceof Error ? error.message : String(error) }, 500, origin);
    }
    const emailUser = users.find((u) => normalizeEmail(u.email) === email);

    if (teacher) {
      if (emailUser && emailUser.id !== teacher.id) {
        return json({ ok: false, error: "Этот email уже используется другим аккаунтом Mathroom" }, 409, origin);
      }
      const { data, error } = await supabase.auth.admin.updateUserById(teacher.id, {
        email,
        email_confirm: true,
        user_metadata: { display_name: teacherKey, crm_teacher_key: teacherKey },
      });
      if (error || !data.user) return json({ ok: false, error: "Не удалось изменить email Mathroom", details: error?.message || "" }, 500, origin);

      const { error: rowError } = await supabase
        .from("teachers")
        .update({ display_name: teacherKey, crm_teacher_key: teacherKey })
        .eq("id", teacher.id);
      if (rowError) return json({ ok: false, error: "Email изменён, но профиль преподавателя обновить не удалось", details: rowError.message }, 500, origin);

      const previousEmail = normalizeEmail(users.find((u) => u.id === teacher.id)?.email);
      if (previousEmail !== email) {
        await writeAudit(teacher.id, teacherKey, "email_changed", email, { previousEmail: previousEmail || null });
      }
      return json({
        ok: true,
        created: false,
        account: {
          teacherKey,
          displayName: teacherKey,
          userId: teacher.id,
          email: data.user.email || email,
          createdAt: teacher.created_at,
          lastSignInAt: data.user.last_sign_in_at || null,
          bannedUntil: data.user.banned_until || null,
          accessEnabled: teacher.access_enabled !== false,
        },
      }, 200, origin);
    }

    if (emailUser) {
      return json({ ok: false, error: "Этот email уже существует в Supabase Auth. Используйте другой email или проверьте аккаунт вручную." }, 409, origin);
    }

    const password = generatePassword();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: teacherKey, crm_teacher_key: teacherKey },
    });
    if (createError || !created.user) return json({ ok: false, error: "Не удалось создать доступ Mathroom", details: createError?.message || "" }, 500, origin);

    const { error: insertError } = await supabase.from("teachers").insert({
      id: created.user.id,
      display_name: teacherKey,
      crm_teacher_key: teacherKey,
      access_enabled: true,
    });
    if (insertError) {
      try { await supabase.auth.admin.deleteUser(created.user.id); } catch {}
      return json({ ok: false, error: "Не удалось создать профиль преподавателя Mathroom", details: insertError.message }, 500, origin);
    }

    await writeAudit(created.user.id, teacherKey, "access_created", email);
    return json({
      ok: true,
      created: true,
      password,
      account: {
        teacherKey,
        displayName: teacherKey,
        userId: created.user.id,
        email: created.user.email || email,
        createdAt: created.user.created_at,
        lastSignInAt: null,
        bannedUntil: created.user.banned_until || null,
        accessEnabled: true,
      },
    }, 200, origin);
  }

  if (action === "toggle_access") {
    if (!teacher) return json({ ok: false, error: "Сначала создайте доступ Mathroom для преподавателя" }, 404, origin);
    const enabled = Boolean(input.enabled);

    const { data: authData, error: authError } = await supabase.auth.admin.updateUserById(
      teacher.id,
      { ban_duration: enabled ? "none" : "876000h" },
    );
    if (authError || !authData.user) {
      return json({
        ok: false,
        error: enabled ? "Не удалось включить доступ Mathroom" : "Не удалось отключить доступ Mathroom",
        details: authError?.message || "",
      }, 500, origin);
    }

    const { error: rowError } = await supabase
      .from("teachers")
      .update({ access_enabled: enabled })
      .eq("id", teacher.id);
    if (rowError) {
      try {
        await supabase.auth.admin.updateUserById(
          teacher.id,
          { ban_duration: enabled ? "876000h" : "none" },
        );
      } catch {}
      return json({
        ok: false,
        error: "Статус авторизации изменён, но профиль Mathroom обновить не удалось",
        details: rowError.message,
      }, 500, origin);
    }

    await writeAudit(
      teacher.id,
      teacherKey,
      enabled ? "access_enabled" : "access_disabled",
      authData.user.email || null,
    );
    return json({
      ok: true,
      account: {
        teacherKey,
        displayName: teacher.display_name || teacherKey,
        userId: teacher.id,
        email: authData.user.email || "",
        createdAt: teacher.created_at,
        lastSignInAt: authData.user.last_sign_in_at || null,
        bannedUntil: authData.user.banned_until || null,
        accessEnabled: enabled,
      },
    }, 200, origin);
  }

  if (action === "reset_password") {
    if (!teacher) return json({ ok: false, error: "Сначала создайте доступ Mathroom для преподавателя" }, 404, origin);
    const password = generatePassword();
    const { data, error } = await supabase.auth.admin.updateUserById(teacher.id, { password });
    if (error || !data.user) return json({ ok: false, error: "Не удалось сменить пароль Mathroom", details: error?.message || "" }, 500, origin);
    await writeAudit(teacher.id, teacherKey, "password_reset", data.user.email || null);
    return json({ ok: true, password, account: { teacherKey, userId: teacher.id, email: data.user.email || "" } }, 200, origin);
  }

  return json({ ok: false, error: "Неизвестное действие" }, 400, origin);
});
