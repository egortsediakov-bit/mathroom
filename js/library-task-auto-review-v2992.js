/* Mathroom v29.9.2 — aggressive automatic cleanup of obvious theory, worked solutions and OCR fragments. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__autoReview2992) return;

  const VERSION = '29.9.2';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF auto-review 29.9.2]', m); };
  const plain = s => String(s || '').replace(/\u00ad/g, '').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  const pupilCommand = /(?:^|[.!?;:]\s*)(?:реш(?:и|ите)|найд(?:и|ите)|вычисл(?:и|ите)|докаж(?:и|ите)|постро(?:й|йте)|сравн(?:и|ите)|упрост(?:и|ите)|разлож(?:и|ите)|представ(?:ьте)|определ(?:и|ите)|исслед(?:уйте)|состав(?:ьте)|запиш(?:и|ите)|объясн(?:и|ите)|установ(?:и|ите)|укаж(?:и|ите)|выраз(?:и|ите)|выполн(?:и|ите)|отмет(?:ьте)|ответ(?:ьте))\b/i;
  const question = /(?:\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|во\s+сколько|на\s+сколько|при\s+каких|для\s+каких|существует\s+ли|верно\s+ли|можно\s+ли|имеет\s+ли)/i;
  const explicitTask = t => pupilCommand.test(t) || question.test(t);

  // First-person plural is textbook narration: "упростим", "умножим", "получим" etc.
  const firstPersonSolution = /\b(?:упростим|умножим|разложим|вычислим|решим|найд[её]м|докажем|построим|возвед[её]м|разделим|сложим|вычтем|подставим|применим|применяя|раскроем|вынесем|сократим|перепишем|получим|представим|рассмотрим|обозначим|заметим|сравним|проверим|расположим|выразим|имеем|видим)\b/i;
  const solutionFlow = /\b(?:следовательно|таким образом|значит|отсюда|поэтому|тем самым|подбором\s+находим|полученный\s+результат|в\s+первом\s+случае|во\s+втором\s+случае|это\s+возможно,?\s+если)\b/i;
  const exposition = /(?:во\s+(?:второй|третьей?|первой)\s+строчк[еи]\s+таблиц|записываются\s+коэффициент|являющ(?:его|ийся)\s+.*степен|например,?\s+если|представляет\s+собой|называется|по\s+определению|согласно\s+определению|теорема\b|доказательство\b|правило\b|разумеется)/i;
  const crossRef = /(?:^|\s)(?:рис\.?\s*\d+|рисунок\s*\d+|глава\s*\d*|§\s*\d+|пример\s*\d*)\s*(?:$|[.;])/i;
  const service = /(?:содержание|оглавление|предисловие|предметный\s+указатель|учебное\s+издание|isbn|удк|ббк|издательств|список\s+литературы)/i;
  const ocrGarbage = /(?:\b(?:Бик|Se\s+oo|at"|Ри:)\b|[©®]{1,}|\?{2,}|\|\s*Глава|(?:[A-Za-z]{1,3}\s+){4,})/i;
  const headingLike = /^(?:линейная\s+функция|квадрат\s+суммы\s+и\s+квадрат\s+разности|сумма\s+и\s+разность\s+кубов|формулы\s+сокращ[её]нного\s+умножения)\s*\d*\s*$/i;
  const openEnding = /(?:равен|равна|равно|равны|составляет|составит|будет|получится|имеет\s+вид|равняется)\s*(?:[:—–-]?\s*)$/i;

  function rejectReason(row) {
    const t = plain(row?.content);
    if (!t) return 'empty';
    const head = t.slice(0, 1800);
    const explicit = explicitTask(head);

    // Reuse all older learned rejection rules first.
    try {
      const r = api.theoryReason2989?.(head);
      if (r) return r;
    } catch {}

    if (service.test(head.slice(0, 260))) return 'service_text';
    if (firstPersonSolution.test(head) && !explicit) return 'worked_solution_first_person';
    if (solutionFlow.test(head) && !explicit) return 'solution_flow';
    if (exposition.test(head) && !explicit) return 'textbook_exposition';
    if (crossRef.test(head) && !explicit) return 'cross_reference';
    if (ocrGarbage.test(head) && !explicit) return 'ocr_garbage';
    if (headingLike.test(head) && !explicit) return 'heading_fragment';

    // Very short incomplete fragments from prose are not exercises.
    const words = head.split(/\s+/).filter(Boolean);
    const letters = (head.match(/[а-яёa-z]/gi) || []).length;
    if (!explicit && !openEnding.test(head) && words.length <= 7 && letters >= 8 && !/[=+−*/√^]/.test(head)) return 'short_incomplete_fragment';

    // Long narration with no command/question is explanation, even if formulas occur inside.
    if (!explicit && !openEnding.test(head) && head.length >= 150 && firstPersonSolution.test(head)) return 'worked_solution_long';
    return '';
  }

  async function teacherId(c) {
    if (S()?.user?.id) return S().user.id;
    try { const { data: { user } } = await c.auth.getUser(); return user?.id || null; } catch { return null; }
  }

  async function cleanup({ silent = false } = {}) {
    const c = sb();
    if (!c) return { rejected: 0, removedExercises: 0 };
    const uid = await teacherId(c);
    if (!uid) return { rejected: 0, removedExercises: 0 };

    const bad = [];
    for (let from = 0; from < 30000; from += 500) {
      const { data, error } = await c.from('task_bank_import_candidates')
        .select('id,exercise_id,content,status,meta')
        .eq('teacher_id', uid)
        .in('status', ['pending','ready','imported'])
        .range(from, from + 499);
      if (error) throw error;
      const rows = data || [];
      for (const row of rows) {
        const reason = rejectReason(row);
        if (reason) bad.push({ ...row, reason });
      }
      if (rows.length < 500) break;
    }

    if (!bad.length) return { rejected: 0, removedExercises: 0 };

    const exerciseIds = [...new Set(bad.map(x => x.exercise_id).filter(Boolean).map(String))];
    let removedExercises = 0;
    for (let i = 0; i < exerciseIds.length; i += 100) {
      const ids = exerciseIds.slice(i, i + 100);
      const { error } = await c.from('exercises').delete().eq('teacher_id', uid).in('id', ids);
      if (!error) removedExercises += ids.length;
    }

    for (let i = 0; i < bad.length; i += 100) {
      const chunk = bad.slice(i, i + 100);
      await Promise.all(chunk.map(row => c.from('task_bank_import_candidates').update({
        status: 'rejected',
        exercise_id: null,
        meta: {
          ...(row.meta || {}),
          auto_review_version: VERSION,
          rejection_reason: row.reason,
          rejected_at: new Date().toISOString()
        }
      }).eq('teacher_id', uid).eq('id', row.id)));
    }

    if (exerciseIds.length && Array.isArray(S().exercises)) {
      const rm = new Set(exerciseIds);
      S().exercises = S().exercises.filter(x => !rm.has(String(x.id)));
    }

    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    if (!silent) toast(`PDF автоочистка: отклонено ${bad.length}${removedExercises ? `, удалено из банка ${removedExercises}` : ''}.`);
    return { rejected: bad.length, removedExercises };
  }

  const prevScan = api.scanAndImport?.bind(api);
  if (prevScan) api.scanAndImport = async opts => {
    const result = await prevScan(opts);
    try {
      const cleaned = await cleanup({ silent: true });
      if (cleaned.rejected) toast(`PDF автоочистка: убрано ${cleaned.rejected} фрагментов теории/решений.`);
      return { ...(result || {}), autoCleanup2992: cleaned, version: VERSION };
    } catch (e) { console.warn('[Mathroom 29.9.2 scan cleanup]', e); return result; }
  };

  const prevReview = api.reviewModal?.bind(api);
  if (prevReview) api.reviewModal = async (...args) => {
    try { await cleanup({ silent: true }); } catch (e) { console.warn('[Mathroom 29.9.2 review cleanup]', e); }
    return prevReview(...args);
  };

  api.cleanupAutoReview2992 = cleanup;
  api.autoReviewReject2992 = rejectReason;
  api.__autoReview2992 = true;
  window.MathroomTaskAutoReviewV2992 = { version: VERSION, cleanup, rejectReason };

  setTimeout(() => cleanup({ silent: false }).catch(e => console.warn('[Mathroom 29.9.2 initial cleanup]', e)), 3200);
})();
