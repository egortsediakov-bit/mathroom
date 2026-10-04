/* Mathroom v29.8.7 — reject theory/prose false positives from PDF task import. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__theoryFilter2987) return;

  const VERSION = '29.8.7';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF theory filter 29.8.7]', m); };
  const plain = s => String(s || '').replace(/\u00ad/g, '').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  const directTask = /(?:^|[.!?;:]\s*)(?:реш(?:и|ите|ить)|найд(?:и|ите|ти)|вычисл(?:и|ите|ить)|докаж(?:и|ите|ать)|постро(?:й|йте|ить)|сравн(?:и|ите|ить)|упрост(?:и|ите|ить)|разлож(?:и|ите|ить)|представ(?:ьте|ить)|определ(?:и|ите|ить)|исслед(?:уйте|овать)|состав(?:ьте|ить)|запиш(?:и|ите|ите)|объясн(?:и|ите)|установ(?:и|ите)|укаж(?:и|ите)|выраз(?:и|ите)|выполн(?:и|ите)|решите задачу)\b/i;
  const questionTask = /(?:\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|во\s+сколько|на\s+сколько|при\s+каких|для\s+каких|существует\s+ли|верно\s+ли|можно\s+ли)/i;
  const shortMathTask = /(?:^|\s)(?:[а-яa-z]\)|\d+\))\s*[^.;]{0,90}(?:=|[+−–-]|\*|\/|:|√|\^)/i;
  const mathExpression = /(?:\d\s*[+−–*/:=<>]\s*\d|[a-zа-я]\s*=\s*[^,.]{1,60}|√|\^|[<>≤≥])/i;
  const biography = /(?:математик|физик|астроном|уч[её]ный|механик|по происхождению|работал в|автор свыше|оказал .* влияние|родил(?:ся|ась)|жил(?:а)?\s+в)/i;
  const years = /(?:1[4-9]\d{2}|20\d{2})\s*[—–-]\s*(?:1[4-9]\d{2}|20\d{2})/;
  const theoryLead = /^(?:тогда\b|значит\b|следовательно\b|таким образом\b|итак\b|отсюда\b|получаем\b|мы видим\b|напомним\b|заметим\b|рассмотрим\b|будем считать\b|будем говорить\b|определение\b|теорема\b|свойство\b|правило\b)/i;
  const definition = /(?:представляет собой|называется|является (?:множеством|числом|функцией|выражением|уравнением|неравенством|элементом)|обозначается|состоит из|следовательно|таким образом|отсюда следует)/i;
  const history = /(?:историческ(?:ая|ие)\s+справк|из истории математики|великий математик|биографи)/i;
  const obviousGarble = /(?:\b[A-Z]{1,2}\s+[a-z]{1,3}\b.*){3,}/;

  function taskSignals(text) {
    const t = plain(text);
    const head = t.slice(0, 900);
    return {
      direct: directTask.test(head),
      question: questionTask.test(head),
      shortMath: shortMathTask.test(head),
      math: mathExpression.test(head)
    };
  }

  function theoryReason(text) {
    const t = plain(text);
    if (!t) return 'empty';
    const sig = taskSignals(t);
    const strongTask = sig.direct || sig.question;

    if (history.test(t.slice(0, 900))) return 'history';
    if (biography.test(t.slice(0, 1000)) && years.test(t.slice(0, 1000))) return 'biography';
    if (theoryLead.test(t) && !strongTask) return 'theory_lead';
    if (definition.test(t.slice(0, 700)) && !strongTask && !sig.shortMath) return 'definition';
    if (obviousGarble.test(t.slice(0, 900)) && !strongTask) return 'garbled_prose';

    const sentences = (t.match(/[.!?](?:\s|$)/g) || []).length;
    if (!strongTask && !sig.shortMath) {
      if (!sig.math && t.length > 180) return 'prose_without_task';
      if (t.length > 420) return 'long_prose';
      if (sentences >= 3 && !sig.math) return 'multi_sentence_prose';
    }
    return '';
  }

  async function teacherId(c) {
    if (S()?.user?.id) return S().user.id;
    try {
      const { data: { user } } = await c.auth.getUser();
      return user?.id || null;
    } catch { return null; }
  }

  async function cleanup({ silent = false } = {}) {
    const c = sb();
    if (!c) return { rejected: 0, removedExercises: 0 };
    const uid = await teacherId(c);
    if (!uid) return { rejected: 0, removedExercises: 0 };

    const bad = [];
    for (let from = 0; from < 10000; from += 500) {
      const { data, error } = await c.from('task_bank_import_candidates')
        .select('id,exercise_id,content,status,meta')
        .eq('teacher_id', uid)
        .in('status', ['pending','ready','imported'])
        .range(from, from + 499);
      if (error) throw error;
      const rows = data || [];
      for (const row of rows) {
        const reason = theoryReason(row.content);
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
      const meta = {
        ...(row.meta || {}),
        theory_filter_version: VERSION,
        rejection_reason: row.reason,
        rejected_at: new Date().toISOString()
      };
      await c.from('task_bank_import_candidates')
        .update({ status: 'rejected', exercise_id: null, meta })
        .eq('teacher_id', uid)
        .eq('id', row.id);
    }

    if (exerciseIds.length && Array.isArray(S().exercises)) {
      const remove = new Set(exerciseIds.map(String));
      S().exercises = S().exercises.filter(x => !remove.has(String(x.id)));
    }

    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    if (!silent) toast(`Фильтр PDF: убрано не-задач ${bad.length}${removedExercises ? `, удалено из банка ${removedExercises}` : ''}.`);
    return { rejected: bad.length, removedExercises };
  }

  const originalScan = api.scanAndImport?.bind(api);
  if (originalScan) {
    api.scanAndImport = async opts => {
      const result = await originalScan(opts);
      try {
        const cleaned = await cleanup({ silent: true });
        if (cleaned.rejected) toast(`PDF: отфильтровано теории и служебного текста ${cleaned.rejected}.`);
        return { ...(result || {}), theoryRejected: cleaned.rejected, version: VERSION };
      } catch (e) {
        console.warn('[Mathroom 29.8.7 cleanup]', e);
        return result;
      }
    };
  }

  const originalReview = api.reviewModal?.bind(api);
  if (originalReview) {
    api.reviewModal = async (...args) => {
      try { await cleanup({ silent: true }); } catch (e) { console.warn('[Mathroom 29.8.7 review cleanup]', e); }
      return originalReview(...args);
    };
  }

  api.theoryReason = theoryReason;
  api.cleanupTheory = cleanup;
  api.VERSION = VERSION;
  api.__theoryFilter2987 = true;
  window.MathroomTaskTheoryFilterV2987 = { version: VERSION, theoryReason, cleanup };

  setTimeout(() => cleanup({ silent: true }).catch(e => console.warn('[Mathroom 29.8.7 initial cleanup]', e)), 1800);
})();
