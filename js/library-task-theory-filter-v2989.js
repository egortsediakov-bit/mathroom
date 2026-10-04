/* Mathroom v29.8.9 — stricter review cleanup for worked solutions/explanatory fragments. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__theoryFilter2989) return;

  const VERSION = '29.8.9';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF filter 29.8.9]', m); };
  const plain = s => String(s || '').replace(/\u00ad/g, '').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  const imperative = /(?:^|[.!?;:]\s*)(?:реш(?:и|ите)|найд(?:и|ите)|вычисл(?:и|ите)|докаж(?:и|ите)|постро(?:й|йте)|сравн(?:и|ите)|упрост(?:и|ите)|разлож(?:и|ите)|представ(?:ьте)|определ(?:и|ите)|исслед(?:уйте)|состав(?:ьте)|запиш(?:и|ите)|объясн(?:и|ите)|установ(?:и|ите)|укаж(?:и|ите)|выраз(?:и|ите)|выполн(?:и|ите)|отмет(?:ьте)|ответ(?:ьте))\b/i;
  const question = /(?:\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|во\s+сколько|на\s+сколько|при\s+каких|для\s+каких|существует\s+ли|верно\s+ли|можно\s+ли|имеет\s+ли)/i;
  const explicitTask = t => imperative.test(t) || question.test(t);

  // Language used by textbook authors while SHOWING a solution, not asking the pupil to solve it.
  const workedNarration = /\b(?:вычислим|упростим|разложим|умножим|разделим|сложим|вычтем|возвед[её]м|перепишем|получим|применим|применяя|подставим|раскроем|вынесем|сократим|обозначим|рассмотрим|сравним|найд[её]м|решим|построим|докажем|покажем|заполним|проверим)\b/i;
  const conclusion = /\b(?:значит|следовательно|таким образом|отсюда(?:\s+следует)?|поэтому|тем самым)\b/i;
  const explanation = /(?:представляет собой|называется|является (?:множеством|числом|функцией|выражением|уравнением|неравенством|элементом)|располагаются между|для выборки .*?(?:наименьш|наибольш)|по формуле|применяя .*?формул)/i;
  const exampleLabel = /(?:^|\s)(?:пример|решение|доказательство)\s*[:.]?(?:\s|$)/i;
  const service = /(?:содержание|оглавление|предисловие|предметный указатель|учебное издание|isbn|удк|ббк|издательств|список литературы)/i;
  const biography = /(?:математик|физик|астроном|уч[её]ный|механик|по происхождению|работал в|автор свыше|оказал .* влияние|родил(?:ся|ась)|жил(?:а)?\s+в)/i;
  const years = /(?:1[4-9]\d{2}|20\d{2})\s*[—–-]\s*(?:1[4-9]\d{2}|20\d{2})/;
  const pureMath = /^(?:[()\[\]{}0-9a-zа-я+−–\-*/:=<>√^.,;%°\s]+)$/i;

  function rejectReason(text) {
    const t = plain(text);
    if (!t) return 'empty';
    const head = t.slice(0, 1200);
    const explicit = explicitTask(head);

    if (service.test(head.slice(0, 240))) return 'service_text';
    if (biography.test(head) && years.test(head)) return 'biography';

    // A worked solution can contain lots of formulas; formulas alone must not make it a task.
    if (workedNarration.test(head) && !explicit) return 'worked_solution';
    if (exampleLabel.test(head) && !explicit) return 'example_or_solution';
    if (conclusion.test(head) && !explicit) return 'solution_conclusion';
    if (explanation.test(head) && !explicit) return 'explanatory_text';

    // Long prose without a request/question is almost always theory or an explanation.
    const sentences = (head.match(/[.!?](?:\s|$)/g) || []).length;
    const letters = (head.match(/[а-яёa-z]/gi) || []).length;
    if (!explicit && !pureMath.test(head)) {
      if (sentences >= 2 && letters >= 70) return 'multi_sentence_prose';
      if (head.length >= 190 && letters >= 110) return 'long_declarative_prose';
    }

    // OCR fragments ending in chapter/example labels are not complete exercises.
    if (!explicit && /(?:\bГлава\b|\bПример\b)\s*$/i.test(head)) return 'trailing_section_label';
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
        const reason = rejectReason(row.content);
        if (reason) bad.push({ ...row, reason });
      }
      if (rows.length < 500) break;
    }

    if (!bad.length) return { rejected: 0, removedExercises: 0 };

    const exerciseIds = [...new Set(bad.map(x => x.exercise_id).filter(Boolean))];
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
          theory_filter_version: VERSION,
          rejection_reason: row.reason,
          rejected_at: new Date().toISOString()
        }
      }).eq('teacher_id', uid).eq('id', row.id)));
    }

    if (exerciseIds.length && Array.isArray(S().exercises)) {
      const remove = new Set(exerciseIds.map(String));
      S().exercises = S().exercises.filter(x => !remove.has(String(x.id)));
    }

    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    if (!silent) toast(`PDF-фильтр: убрано ${bad.length} фрагментов теории/готовых решений${removedExercises ? `, удалено из банка ${removedExercises}` : ''}.`);
    return { rejected: bad.length, removedExercises };
  }

  const previousScan = api.scanAndImport?.bind(api);
  if (previousScan) {
    api.scanAndImport = async opts => {
      const result = await previousScan(opts);
      try {
        const cleaned = await cleanup({ silent: true });
        if (cleaned.rejected) toast(`PDF: отфильтровано ещё ${cleaned.rejected} фрагментов теории/решений.`);
        return { ...(result || {}), theoryRejected2989: cleaned.rejected, version: VERSION };
      } catch (e) { console.warn('[Mathroom 29.8.9 scan cleanup]', e); return result; }
    };
  }

  const previousReview = api.reviewModal?.bind(api);
  if (previousReview) {
    api.reviewModal = async (...args) => {
      try { await cleanup({ silent: true }); } catch (e) { console.warn('[Mathroom 29.8.9 review cleanup]', e); }
      return previousReview(...args);
    };
  }

  api.cleanupTheory2989 = cleanup;
  api.theoryReason2989 = rejectReason;
  api.VERSION = VERSION;
  api.__theoryFilter2989 = true;
  window.MathroomTaskTheoryFilterV2989 = { version: VERSION, rejectReason, cleanup };

  setTimeout(() => cleanup({ silent: true }).catch(e => console.warn('[Mathroom 29.8.9 initial cleanup]', e)), 1400);
})();
