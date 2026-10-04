/* Mathroom v29.8.8 — stricter PDF task filter: reject worked examples and explanatory prose. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__theoryFilter2988) return;

  const VERSION = '29.8.8';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF filter 29.8.8]', m); };
  const plain = s => String(s || '').replace(/\u00ad/g, '').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  const imperative = /(?:^|[.!?;:]\s*)(?:реш(?:и|ите)|найд(?:и|ите)|вычисл(?:и|ите)|докаж(?:и|ите)|постро(?:й|йте)|сравн(?:и|ите)|упрост(?:и|ите)|разлож(?:и|ите)|представ(?:ьте)|определ(?:и|ите)|исслед(?:уйте)|состав(?:ьте)|запиш(?:и|ите)|объясн(?:и|ите)|установ(?:и|ите)|укаж(?:и|ите)|выраз(?:и|ите)|выполн(?:и|ите))\b/i;
  const question = /(?:\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|во\s+сколько|на\s+сколько|при\s+каких|для\s+каких|существует\s+ли|верно\s+ли|можно\s+ли)/i;
  const subtaskMath = /(?:^|\s)(?:[а-яa-z]\)|\d+\))\s*[^.;]{0,120}(?:=|[+−–*/:]|√|\^|<|>)/i;

  // Typical textbook solution/explanation language in first person plural.
  const workedLead = /^(?:вычислим|разложим|перепишем|получим|представим|обозначим|сравним|найд[её]м|рассмотрим|заметим|покажем|докажем|подставим|преобразуем|сократим|раскроем|вынесем|умножим|разделим|сложим|вычтем|проверим|провед[её]м|построим|запишем|решим|пусть\b)/i;
  const workedMid = /(?:\bдля этого\b|\bполучим\b|\bперепишем\b|\bвидим,? что\b|\bследовательно\b|\bзначит\b|\bтаким образом\b|\bотсюда\b)/i;
  const explanatoryNoun = /^(?:вычисление|решение|доказательство|построение|разложение|преобразование|нахождение|определение)\b.{0,100}\b(?:можно|выполним|проводится|осуществляется|получается|сводится)\b/i;
  const theoryLexicon = /(?:представляет собой|называется|является (?:множеством|числом|функцией|выражением|уравнением|неравенством|элементом)|обозначается|состоит из|теорема|определение|свойство|правило)/i;
  const biography = /(?:математик|физик|астроном|уч[её]ный|механик|по происхождению|работал в|автор свыше|оказал .* влияние|родил(?:ся|ась)|жил(?:а)?\s+в)/i;
  const years = /(?:1[4-9]\d{2}|20\d{2})\s*[—–-]\s*(?:1[4-9]\d{2}|20\d{2})/;
  const service = /(?:содержание|оглавление|предисловие|предметный указатель|учебное издание|isbn|удк|ббк|издательств|список литературы)/i;

  function rejectReason(text) {
    const t = plain(text);
    if (!t) return 'empty';
    const head = t.slice(0, 1000);
    const hasTask = imperative.test(head) || question.test(head) || subtaskMath.test(head);

    if (service.test(head.slice(0, 220))) return 'service_text';
    if (biography.test(head) && years.test(head)) return 'biography';
    if (workedLead.test(head) && !imperative.test(head.slice(0, 220)) && !question.test(head.slice(0, 220))) return 'worked_example';
    if (explanatoryNoun.test(head) && !hasTask) return 'explanation';
    if (theoryLexicon.test(head.slice(0, 700)) && !hasTask) return 'theory';

    // A multi-sentence exposition with solution-transition words but no actual request/question is not an exercise.
    const sentences = (head.match(/[.!?](?:\s|$)/g) || []).length;
    if (!hasTask && workedMid.test(head) && (sentences >= 2 || head.length > 140)) return 'solution_prose';

    // Long declarative prose with no task signal is not a task even if it contains formulas/numbers.
    if (!hasTask && head.length > 260 && sentences >= 2) return 'declarative_prose';
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
    for (let from = 0; from < 20000; from += 500) {
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

    for (const row of bad) {
      await c.from('task_bank_import_candidates').update({
        status: 'rejected',
        exercise_id: null,
        meta: {
          ...(row.meta || {}),
          theory_filter_version: VERSION,
          rejection_reason: row.reason,
          rejected_at: new Date().toISOString()
        }
      }).eq('teacher_id', uid).eq('id', row.id);
    }

    if (exerciseIds.length && Array.isArray(S().exercises)) {
      const remove = new Set(exerciseIds.map(String));
      S().exercises = S().exercises.filter(x => !remove.has(String(x.id)));
    }

    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    if (!silent) toast(`PDF-фильтр: убрано ${bad.length} теоретических/разобранных примеров${removedExercises ? `, удалено из банка ${removedExercises}` : ''}.`);
    return { rejected: bad.length, removedExercises };
  }

  const previousScan = api.scanAndImport?.bind(api);
  if (previousScan) {
    api.scanAndImport = async opts => {
      const result = await previousScan(opts);
      try {
        const cleaned = await cleanup({ silent: true });
        if (cleaned.rejected) toast(`PDF: дополнительно отфильтровано ${cleaned.rejected} фрагментов теории/решений.`);
        return { ...(result || {}), theoryRejected2988: cleaned.rejected, version: VERSION };
      } catch (e) { console.warn('[Mathroom 29.8.8 scan cleanup]', e); return result; }
    };
  }

  const previousReview = api.reviewModal?.bind(api);
  if (previousReview) {
    api.reviewModal = async (...args) => {
      try { await cleanup({ silent: true }); } catch (e) { console.warn('[Mathroom 29.8.8 review cleanup]', e); }
      return previousReview(...args);
    };
  }

  api.cleanupTheory2988 = cleanup;
  api.theoryReason2988 = rejectReason;
  api.VERSION = VERSION;
  api.__theoryFilter2988 = true;
  window.MathroomTaskTheoryFilterV2988 = { version: VERSION, rejectReason, cleanup };

  setTimeout(() => cleanup({ silent: true }).catch(e => console.warn('[Mathroom 29.8.8 initial cleanup]', e)), 1700);
})();
