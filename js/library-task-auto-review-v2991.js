/* Mathroom v29.9.1 — automatically accept clear PDF exercises and reject theory/worked solutions. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__autoReview2991) return;

  const VERSION = '29.9.1';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF auto-review 29.9.1]', m); };
  const plain = s => String(s || '').replace(/\u00ad/g, '').replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Explicit pupil-facing requests/questions are strong evidence that the fragment is an exercise.
  const imperative = /(?:^|[.!?;:]\s*)(?:реш(?:и|ите)|найд(?:и|ите)|вычисл(?:и|ите)|докаж(?:и|ите)|постро(?:й|йте)|сравн(?:и|ите)|упрост(?:и|ите)|разлож(?:и|ите)|представ(?:ьте)|определ(?:и|ите)|исслед(?:уйте)|состав(?:ьте)|запиш(?:и|ите)|объясн(?:и|ите)|установ(?:и|ите)|укаж(?:и|ите)|выраз(?:и|ите)|выполн(?:и|ите)|отмет(?:ьте)|ответ(?:ьте)|решите|найдите)\b/i;
  const question = /(?:\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|во\s+сколько|на\s+сколько|при\s+каких|для\s+каких|существует\s+ли|верно\s+ли|можно\s+ли|имеет\s+ли|что\s+получится|определите)/i;
  const explicitTask = t => imperative.test(t) || question.test(t);

  // Textbook narration used while explaining or showing a completed solution.
  const worked = /\b(?:вычислим|вычисляем|упростим|разложим|умножим|разделим|сложим|вычтем|возвед[её]м|перепишем|получим|получаем|получили|применим|применяем|применяя|подставим|раскроем|вынесем|сократим|обозначим|рассмотрим|сравним|найд[её]м|решим|построим|докажем|покажем|заполним|проверим|представим|расположим|выразим|заметим|имеем|видим|полученный\s+результат|подбором\s+находим)\b/i;
  const solutionLead = /(?:^|[.!?]\s*)(?:тогда|значит|следовательно|таким образом|отсюда|поэтому|тем самым|в\s+первом\s+случае|во\s+втором\s+случае|разумеется|для\s+этого\s+перепишем|применяя\s+.*?формул)/i;
  const theory = /(?:представляет\s+собой|называется|по\s+определению|согласно\s+определению|теорема\b|доказательство\b|свойство\b|правило\b|формула\s*\(?\d+\)?|является\s+(?:множеством|числом|функцией|выражением|уравнением|неравенством|элементом)|располагаются\s+между)/i;
  const service = /(?:содержание|оглавление|предисловие|предметный\s+указатель|учебное\s+издание|isbn|удк|ббк|издательств|список\s+литературы)/i;
  const biography = /(?:математик|физик|астроном|уч[её]ный|механик|по\s+происхождению|работал\s+в|автор\s+свыше|оказал\s+.*влияние|родил(?:ся|ась)|жил(?:а)?\s+в)/i;
  const years = /(?:1[4-9]\d{2}|20\d{2})\s*[—–-]\s*(?:1[4-9]\d{2}|20\d{2})/;
  const exampleLabel = /(?:^|\s)(?:пример|решение|доказательство)\s*[:.]?(?:\s|$)/i;

  // Common fill-in / short-answer forms in Russian textbooks often omit a question mark.
  const openEnding = /(?:равен|равна|равно|равны|составляет|составит|будет|получится|имеет\s+вид|равняется)\s*(?:[:—–-]?\s*)$/i;
  const mathSignal = /(?:=|\?|√|\^|\+|−|-|\*|\/|\b(?:x|y|a|b|c|m|n)\b|\d)/i;
  const badOcr = /(?:[©®]{2,}|\?{3,}|[^\s]{35,})/;

  function oldRejectReason(text) {
    try { return api.theoryReason2989?.(text) || ''; } catch { return ''; }
  }

  function rejectReason(row) {
    const t = plain(row?.content);
    if (!t) return 'empty';
    const head = t.slice(0, 1600);
    const explicit = explicitTask(head);
    const previous = oldRejectReason(head);
    if (previous) return previous;
    if (service.test(head.slice(0, 260))) return 'service_text';
    if (biography.test(head) && years.test(head)) return 'biography';
    if (exampleLabel.test(head) && !explicit) return 'example_or_solution';
    if (worked.test(head) && !explicit) return 'worked_solution';
    if (solutionLead.test(head) && !explicit) return 'solution_narration';
    if (theory.test(head) && !explicit) return 'theory_text';
    if (badOcr.test(head) && !explicit) return 'bad_ocr';

    const sentences = (head.match(/[.!?](?:\s|$)/g) || []).length;
    const letters = (head.match(/[а-яёa-z]/gi) || []).length;
    if (!explicit && sentences >= 3 && letters >= 90 && !openEnding.test(head)) return 'declarative_explanation';
    if (!explicit && head.length > 320 && letters > 170 && !openEnding.test(head)) return 'long_explanation';
    return '';
  }

  function acceptReason(row) {
    const t = plain(row?.content);
    if (!t || rejectReason(row)) return '';
    const conf = Number(row?.confidence || 0);
    const meta = row?.meta || {};
    const strongNo = !!meta.strong_number || /^\s*№/i.test(String(row?.task_no || '')) || !!String(row?.task_no || '').trim();
    const sourceKind = plain(meta.source_kind || '').toLowerCase();
    const taskSource = /задачник|сборник|taskbook|collection|упражнен/.test(sourceKind);
    const explicit = explicitTask(t);

    // Clear requests/questions: accept from the review band when OCR and numbering are reasonably reliable.
    if (explicit && conf >= 0.67 && (strongNo || taskSource || conf >= 0.76)) return 'explicit_task';

    // Fill-in statements like "... коэффициент произведения равен" are legitimate exercises even without ?.
    if (openEnding.test(t) && mathSignal.test(t) && conf >= 0.70 && (strongNo || taskSource)) return 'fill_in_task';

    // Short numbered mathematical prompts from a taskbook are safe enough to import automatically.
    if (taskSource && strongNo && conf >= 0.74 && t.length <= 220 && mathSignal.test(t)) return 'short_taskbook_prompt';
    return '';
  }

  async function teacherId(c) {
    if (S()?.user?.id) return S().user.id;
    try { const { data: { user } } = await c.auth.getUser(); return user?.id || null; } catch { return null; }
  }

  async function loadPending(c, uid) {
    const out = [];
    for (let from = 0; from < 10000; from += 500) {
      const { data, error } = await c.from('task_bank_import_candidates')
        .select('id,content,confidence,task_no,status,meta')
        .eq('teacher_id', uid)
        .eq('status', 'pending')
        .order('confidence', { ascending: false })
        .range(from, from + 499);
      if (error) throw error;
      const rows = data || [];
      out.push(...rows);
      if (rows.length < 500) break;
    }
    return out;
  }

  async function rejectIds(c, uid, ids) {
    let n = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await c.from('task_bank_import_candidates')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('teacher_id', uid)
        .in('id', chunk);
      if (error) throw error;
      n += chunk.length;
    }
    return n;
  }

  async function importIds(c, ids) {
    let n = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await c.rpc('mathroom_import_task_candidates', { p_ids: ids.slice(i, i + 200) });
      if (error) throw error;
      n += Number(data) || 0;
    }
    return n;
  }

  async function autoTriage({ silent = false } = {}) {
    const c = sb();
    if (!c) return { accepted: 0, rejected: 0, remaining: 0 };
    const uid = await teacherId(c);
    if (!uid) return { accepted: 0, rejected: 0, remaining: 0 };

    // First let the stricter theory cleaner remove anything it already understands.
    try { await api.cleanupTheory2989?.({ silent: true }); } catch (e) { console.warn('[Mathroom 29.9.1 pre-clean]', e); }

    const rows = await loadPending(c, uid);
    if (!rows.length) return { accepted: 0, rejected: 0, remaining: 0 };

    const reject = [], accept = [], undecided = [];
    for (const row of rows) {
      const rr = rejectReason(row);
      if (rr) { reject.push({ id: row.id, reason: rr }); continue; }
      const ar = acceptReason(row);
      if (ar) { accept.push({ id: row.id, reason: ar }); continue; }
      undecided.push(row.id);
    }

    const rejected = reject.length ? await rejectIds(c, uid, reject.map(x => x.id)) : 0;
    const accepted = accept.length ? await importIds(c, accept.map(x => x.id)) : 0;

    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}

    const result = { accepted, rejected, remaining: undecided.length, scanned: rows.length, version: VERSION };
    if (!silent && (accepted || rejected || undecided.length)) {
      toast(`Авторазбор PDF: в банк ${accepted}, отклонено ${rejected}, осталось сомнительных ${undecided.length}.`);
    }
    return result;
  }

  const previousScan = api.scanAndImport?.bind(api);
  if (previousScan) {
    api.scanAndImport = async opts => {
      const result = await previousScan(opts);
      try {
        const auto = await autoTriage({ silent: true });
        if (auto.accepted || auto.rejected) toast(`PDF авторазбор: в банк ${auto.accepted}, отклонено ${auto.rejected}, осталось ${auto.remaining}.`);
        return { ...(result || {}), autoReview2991: auto, version: VERSION };
      } catch (e) { console.warn('[Mathroom 29.9.1 scan triage]', e); return result; }
    };
  }

  const previousReview = api.reviewModal?.bind(api);
  if (previousReview) {
    api.reviewModal = async (...args) => {
      try { await autoTriage({ silent: true }); } catch (e) { console.warn('[Mathroom 29.9.1 review triage]', e); }
      return previousReview(...args);
    };
  }

  api.autoTriage2991 = autoTriage;
  api.autoReviewDecision2991 = row => ({ reject: rejectReason(row), accept: acceptReason(row) });
  api.__autoReview2991 = true;
  window.MathroomTaskAutoReviewV2991 = { version: VERSION, autoTriage, rejectReason, acceptReason };

  // Existing pending queue is processed once after the cabinet finishes loading.
  setTimeout(() => autoTriage({ silent: false }).catch(e => console.warn('[Mathroom 29.9.1 initial triage]', e)), 2600);
})();
