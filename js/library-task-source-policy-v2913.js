/* Mathroom v29.13.0 — tasks come only from taskbooks/collections/exam banks, never from textbooks. */
(() => {
  'use strict';
  const api = window.MathroomTaskImportV298;
  if (!api || api.__sourcePolicy2913) return;

  const VERSION = '29.13.0';
  const PDF_TAG = 'mathroom-core-bank-v29.8-pdf';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const db = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  const ALLOWED_KINDS = new Set(['taskbook','collection','problem_book','workbook','exam_bank','oge_bank','ege_bank']);
  const allowedWords = /(?:задачник|сборник\s+(?:задач|упражнений)|банк\s+заданий|огэ|егэ|фипи|тренировочн(?:ый|ые)\s+вариант|типов(?:ой|ые)\s+вариант|экзаменационн(?:ый|ые)\s+вариант|problem\s*book|task\s*book|workbook|collection)/i;
  const school57 = /(?:^|[^0-9])(?:5|6|7|8)[\s_.-]*57(?:[^0-9]|$)|57\s*(?:школ|school)/i;
  const explicitTextbook = /(?:^|\b)(?:учебник|textbook)(?:\b|$)/i;

  function sourceText(src) {
    const m = src?.meta || {};
    return [src?.title, src?.filename, src?.material_kind, src?.authors, m.material_kind, m.filename, m.title, m.external_key].filter(Boolean).join(' ');
  }

  function isAllowedSource(src) {
    if (!src) return false;
    const m = src.meta || {};
    const kind = norm(src.material_kind || m.material_kind || '');
    if (ALLOWED_KINDS.has(kind)) return true;
    const txt = sourceText(src);
    if (allowedWords.test(txt) || school57.test(txt)) return true;
    // Explicit textbooks are never task sources.
    if (kind === 'textbook' || explicitTextbook.test(txt)) return false;
    return false;
  }

  async function currentUserId(c) {
    if (S()?.user?.id) return S().user.id;
    try { return (await c.auth.getUser()).data.user?.id || null; } catch { return null; }
  }

  async function loadSources(c, activeOnly = false) {
    let q = c.from('task_bank_sources').select('id,title,filename,material_kind,authors,is_active,meta');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  function classifySources(rows) {
    const allowed = [], blocked = [];
    for (const r of rows || []) (isAllowedSource(r) ? allowed : blocked).push(r);
    return { allowed, blocked };
  }

  async function purgeTextbookImports({ silent = false } = {}) {
    const c = db();
    if (!c) return null;
    const uid = await currentUserId(c);
    if (!uid) return null;
    const sources = await loadSources(c, false);
    const sourceMap = new Map(sources.map(x => [String(x.id), x]));

    const removeExerciseIds = [];
    for (let from = 0; from < 10000; from += 500) {
      const { data, error } = await c.from('exercises')
        .select('id,generator_spec')
        .eq('teacher_id', uid)
        .eq('kind', 'task')
        .contains('tags', [PDF_TAG])
        .range(from, from + 499);
      if (error) throw error;
      const rows = data || [];
      for (const ex of rows) {
        let meta = {};
        try { meta = JSON.parse(ex.generator_spec || '{}'); } catch {}
        const src = sourceMap.get(String(meta.source_id || '')) || { title: meta.source_title || '', material_kind: meta.source_kind || '', meta };
        if (!isAllowedSource(src)) removeExerciseIds.push(ex.id);
      }
      if (rows.length < 500) break;
    }
    for (let i = 0; i < removeExerciseIds.length; i += 100) {
      const { error } = await c.from('exercises').delete().eq('teacher_id', uid).in('id', removeExerciseIds.slice(i, i + 100));
      if (error) throw error;
    }

    const removeCandidateIds = [];
    for (let from = 0; from < 15000; from += 700) {
      const { data, error } = await c.from('task_bank_import_candidates')
        .select('id,source_id,source_title,meta')
        .eq('teacher_id', uid)
        .range(from, from + 699);
      if (error) throw error;
      const rows = data || [];
      for (const row of rows) {
        const src = sourceMap.get(String(row.source_id || '')) || { title: row.source_title || '', material_kind: row.meta?.source_kind || '', meta: row.meta || {} };
        if (!isAllowedSource(src)) removeCandidateIds.push(row.id);
      }
      if (rows.length < 700) break;
    }
    for (let i = 0; i < removeCandidateIds.length; i += 100) {
      const { error } = await c.from('task_bank_import_candidates').delete().eq('teacher_id', uid).in('id', removeCandidateIds.slice(i, i + 100));
      if (error) throw error;
    }

    try { await window.MathroomBankPerformanceV2983?.refreshCount?.({ force: true }); } catch {}
    try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
    try { await window.MathroomPdfTasksBrowser2911?.refresh?.(); } catch {}
    if (!silent && (removeExerciseIds.length || removeCandidateIds.length)) {
      toast(`Учебники исключены из банка: удалено ${removeExerciseIds.length} PDF-задач и ${removeCandidateIds.length} старых кандидатов.`);
    }
    return { exercises: removeExerciseIds.length, candidates: removeCandidateIds.length };
  }

  async function resetAllowedImportMarkers(c, allowed) {
    for (const src of allowed) {
      const m = { ...(src.meta || {}) };
      if (m.task_source_policy_version === VERSION) continue;
      m.task_source_policy_version = VERSION;
      m.task_import_version = '';
      m.task_import_pages_done = -1;
      m.task_import_at = null;
      const { error } = await c.from('task_bank_sources').update({ meta: m }).eq('id', src.id);
      if (error) console.warn('[Mathroom source policy] marker reset', src.title, error);
    }
  }

  // The legacy scanner reads all active sources. During its scan we temporarily hide textbooks,
  // then restore them immediately. This does NOT remove textbooks from the Library.
  const previousScan = api.scanAndImport.bind(api);
  api.scanAndImport = async opts => {
    const c = db();
    if (!c) return previousScan(opts || {});
    const sources = await loadSources(c, true);
    const { allowed, blocked } = classifySources(sources);
    await resetAllowedImportMarkers(c, allowed);

    if (!allowed.length) {
      toast('Нет источников задач. Загрузите задачник, сборник задач или банк ОГЭ/ЕГЭ.');
      return { ready: true, sourcesTotal: sources.length, sourcesMatched: 0, parsed: 0, autoImported: 0, pending: 0, duplicates: 0, policy: VERSION };
    }

    const blockedIds = blocked.map(x => x.id).filter(Boolean);
    try {
      if (blockedIds.length) {
        const { error } = await c.from('task_bank_sources').update({ is_active: false }).in('id', blockedIds);
        if (error) throw error;
      }
      const r = await previousScan({ ...(opts || {}), force: true });
      return { ...(r || {}), taskSources: allowed.length, excludedTextbooks: blocked.length, policy: VERSION };
    } finally {
      if (blockedIds.length) {
        const { error } = await c.from('task_bank_sources').update({ is_active: true }).in('id', blockedIds);
        if (error) console.error('[Mathroom source policy] failed to restore sources', error);
      }
    }
  };

  function patchExamRecognition() {
    const lib = window.MathroomLibrary2968;
    if (!lib?.recognizeFile || lib.__examRecognition2913) return;
    const prev = lib.recognizeFile.bind(lib);
    lib.recognizeFile = async file => {
      const out = await prev(file);
      const n = norm(file?.name || '');
      const isOge = /(?:огэ|oge|9\s*класс.*экзам|экзам.*9\s*класс)/i.test(n);
      const isEge = /(?:егэ|ege|11\s*класс.*экзам|экзам.*11\s*класс)/i.test(n);
      const isBank = /(?:банк\s*заданий|сборник\s*задач|задачник|вариант)/i.test(n);
      if (isOge || isEge || isBank) {
        out.meta = { ...(out.meta || {}), material_kind: (isOge || isEge) ? 'exam_bank' : (out.meta?.material_kind === 'textbook' ? 'collection' : (out.meta?.material_kind || 'collection')) };
        if (isOge) { out.meta.grade_from = 9; out.meta.grade_to = 9; out.meta.exam = 'OGE'; }
        if (isEge) { out.meta.grade_from = 11; out.meta.grade_to = 11; out.meta.exam = 'EGE'; }
      }
      return out;
    };
    lib.__examRecognition2913 = true;
  }

  async function stats() {
    const c = db();
    if (!c) return null;
    const rows = await loadSources(c, true);
    const x = classifySources(rows);
    return { total: rows.length, allowed: x.allowed.length, textbooks: x.blocked.length, allowedSources: x.allowed };
  }

  function mountPolicyInfo() {
    const host = document.getElementById('pdfTaskImportCard');
    if (!host || host.querySelector('#taskSourcePolicy2913')) return;
    const left = host.firstElementChild || host;
    const el = document.createElement('div');
    el.id = 'taskSourcePolicy2913';
    el.className = 'small muted';
    el.style.marginTop = '5px';
    el.textContent = 'Источники задач: только задачники, сборники и банки ОГЭ/ЕГЭ. Учебники используются только как учебные материалы.';
    left.appendChild(el);
    stats().then(s => {
      if (s) el.textContent += ` Активных источников задач: ${s.allowed}/${s.total}.`;
    }).catch(() => {});
  }

  async function initialize() {
    patchExamRecognition();
    const c = db();
    if (!c) return;
    try {
      await purgeTextbookImports({ silent: false });
      const uid = await currentUserId(c);
      const key = uid ? `mathroom-task-source-policy-${VERSION}-${uid}` : '';
      if (key && localStorage.getItem(key) !== '1') {
        localStorage.setItem(key, '1');
        setTimeout(() => api.scanAndImport({ force: true, onProgress: m => toast(m) }).catch(e => console.warn('[Mathroom source policy scan]', e)), 1200);
      }
    } catch (e) {
      console.error('[Mathroom source policy init]', e);
      toast('Политика источников задач: ' + String(e?.message || e));
    }
  }

  api.sourcePolicy2913 = { VERSION, isAllowedSource, purgeTextbookImports, stats };
  api.__sourcePolicy2913 = true;
  window.MathroomTaskSourcePolicy2913 = api.sourcePolicy2913;

  new MutationObserver(mountPolicyInfo).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(mountPolicyInfo, 1500);
  setTimeout(initialize, 2600);
})();
