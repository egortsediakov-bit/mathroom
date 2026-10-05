/* Mathroom v29.16.1 — canonical task sources; School 57 bypasses legacy PDF parser. */
(() => {
  'use strict';
  const api = window.MathroomTaskImportV298;
  if (!api || api.__sourcePolicy29161) return;

  const VERSION = '29.16.1';
  const PDF_TAG = 'mathroom-core-bank-v29.8-pdf';
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const db = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

  const examWords = /(?:\bогэ\b|\bегэ\b|\bfipi\b|\bфипи\b|банк\s+заданий.*(?:огэ|егэ)|(?:огэ|егэ).*банк\s+заданий)/i;
  const explicitTextbook = /(?:^|\b)(?:учебник|textbook)(?:\b|$)/i;

  function sourceText(src) {
    const m = src?.meta || {};
    return [src?.title, src?.filename, src?.material_kind, src?.authors, m.material_kind, m.filename, m.title, m.external_key, m.exam, m.task_source_family].filter(Boolean).join(' ');
  }
  function school57Grade(src) {
    const m = src?.meta || {};
    const g = Number(m.task_source_grade || src?.grade || src?.grade_from || 0);
    return g >= 5 && g <= 8 ? g : 0;
  }
  function isCanonicalSchool57(src) {
    const m = src?.meta || {};
    return m.task_source_family === 'school57' && m.canonical_task_source === true && !!school57Grade(src);
  }
  function isExamBank(src) {
    const m = src?.meta || {};
    const kind = norm(src?.material_kind || m.material_kind || '');
    const exam = String(m.exam || '').toUpperCase();
    const txt = sourceText(src);
    if (exam === 'OGE' || exam === 'EGE' || exam === 'ОГЭ' || exam === 'ЕГЭ') return true;
    if (kind === 'oge_bank' || kind === 'ege_bank') return true;
    if (kind === 'exam_bank' && examWords.test(txt)) return true;
    return examWords.test(txt);
  }
  function isAllowedSource(src) {
    if (!src || src.is_active === false) return false;
    const txt = sourceText(src);
    if (explicitTextbook.test(txt) && !isCanonicalSchool57(src) && !isExamBank(src)) return false;
    return isCanonicalSchool57(src) || isExamBank(src);
  }
  async function currentUserId(c) {
    if (S()?.user?.id) return S().user.id;
    try { return (await c.auth.getUser()).data.user?.id || null; } catch { return null; }
  }
  async function loadSources(c, activeOnly = false) {
    let q = c.from('task_bank_sources').select('id,title,filename,material_kind,authors,grade,grade_from,is_active,meta');
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
    const c = db(); if (!c) return null;
    const uid = await currentUserId(c); if (!uid) return null;
    const sources = await loadSources(c, false), sourceMap = new Map(sources.map(x => [String(x.id), x]));
    const removeExerciseIds = [];
    for (let from = 0; from < 10000; from += 500) {
      const { data, error } = await c.from('exercises').select('id,generator_spec').eq('teacher_id', uid).eq('kind', 'task').contains('tags', [PDF_TAG]).range(from, from + 499);
      if (error) throw error; const rows = data || [];
      for (const ex of rows) {
        let meta = {}; try { meta = JSON.parse(ex.generator_spec || '{}'); } catch {}
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
      const { data, error } = await c.from('task_bank_import_candidates').select('id,source_id,source_title,meta').eq('teacher_id', uid).range(from, from + 699);
      if (error) throw error; const rows = data || [];
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
    if (!silent && (removeExerciseIds.length || removeCandidateIds.length)) toast(`Лишние источники исключены: удалено ${removeExerciseIds.length} PDF-задач и ${removeCandidateIds.length} кандидатов.`);
    return { exercises: removeExerciseIds.length, candidates: removeCandidateIds.length };
  }
  async function resetAllowedImportMarkers(c, allowed) {
    for (const src of allowed) {
      const m = { ...(src.meta || {}) };
      if (m.task_source_policy_version === VERSION) continue;
      m.task_source_policy_version = VERSION; m.task_import_version = ''; m.task_import_pages_done = -1; m.task_import_at = null;
      const { error } = await c.from('task_bank_sources').update({ meta: m }).eq('id', src.id);
      if (error) console.warn('[Mathroom source policy] marker reset', src.title, error);
    }
  }

  const previousScan = api.scanAndImport.bind(api);
  api.scanAndImport = async opts => {
    const c = db(); if (!c) return previousScan(opts || {});
    const sources = await loadSources(c, true), { allowed, blocked } = classifySources(sources);
    await resetAllowedImportMarkers(c, allowed);
    if (!allowed.length) {
      toast('Нет активных источников задач. Нужны задачники 57 школы или банк ОГЭ/ЕГЭ.');
      return { ready: true, sourcesTotal: sources.length, sourcesMatched: 0, parsed: 0, autoImported: 0, pending: 0, duplicates: 0, policy: VERSION };
    }

    // The old generic parser is not reliable for School 57 taskbooks: it confuses
    // section headings and worked solutions with exercises. Only exam banks are
    // passed to the legacy parser; School 57 is handled by v29.16.1 dedicated parser.
    const school = allowed.filter(isCanonicalSchool57), exams = allowed.filter(isExamBank);
    const hide = [...blocked, ...school].map(x => x.id).filter(Boolean);
    if (!exams.length) {
      return { ready:true, sourcesTotal:allowed.length, sourcesMatched:0, parsed:0, autoImported:0, pending:0, duplicates:0, taskSources:allowed.length, excludedSources:blocked.length, policy:VERSION, school57Dedicated:true };
    }
    try {
      if (hide.length) {
        const { error } = await c.from('task_bank_sources').update({ is_active:false }).in('id', hide); if (error) throw error;
      }
      const r = await previousScan({ ...(opts || {}), force:true });
      return { ...(r || {}), taskSources:allowed.length, excludedSources:blocked.length, policy:VERSION, school57Dedicated:true };
    } finally {
      if (hide.length) {
        const { error } = await c.from('task_bank_sources').update({ is_active:true }).in('id', hide); if (error) console.error('[Mathroom source policy] failed to restore sources', error);
      }
    }
  };

  function patchExamRecognition() {
    const lib = window.MathroomLibrary2968; if (!lib?.recognizeFile || lib.__examRecognition2913) return;
    const prev = lib.recognizeFile.bind(lib);
    lib.recognizeFile = async file => {
      const out = await prev(file), n = norm(file?.name || '');
      const isOge = /(?:огэ|oge|9\s*класс.*экзам|экзам.*9\s*класс)/i.test(n), isEge = /(?:егэ|ege|11\s*класс.*экзам|экзам.*11\s*класс)/i.test(n);
      if (isOge || isEge) {
        out.meta = { ...(out.meta || {}), material_kind:isOge?'oge_bank':'ege_bank', exam:isOge?'OGE':'EGE' };
        if (isOge) { out.meta.grade_from=9; out.meta.grade_to=9; } if (isEge) { out.meta.grade_from=11; out.meta.grade_to=11; }
      }
      return out;
    }; lib.__examRecognition2913 = true;
  }
  async function stats() {
    const c=db(); if(!c)return null; const rows=await loadSources(c,true),x=classifySources(rows);
    const school57=x.allowed.filter(isCanonicalSchool57),exams=x.allowed.filter(isExamBank);
    return {total:rows.length,allowed:x.allowed.length,blocked:x.blocked.length,school57:school57.length,exams:exams.length,allowedSources:x.allowed};
  }
  function mountPolicyInfo() {
    const host=document.getElementById('pdfTaskImportCard'); if(!host||host.querySelector('#taskSourcePolicy2913'))return;
    const left=host.firstElementChild||host,el=document.createElement('div'); el.id='taskSourcePolicy2913';el.className='small muted';el.style.marginTop='5px';left.appendChild(el);
    const paint=async()=>{try{const s=await stats();if(!s)return;el.textContent=`Источники задач: задачники 57 школы ${s.school57}/4${s.exams?` · банки ОГЭ/ЕГЭ ${s.exams}`:''}. Учебники и прочие PDF в Банк задач не входят.`}catch{}};
    paint();setInterval(paint,12000);
  }
  async function initialize() {
    patchExamRecognition(); const c=db(); if(!c)return;
    try {
      await purgeTextbookImports({silent:false}); const uid=await currentUserId(c),key=uid?`mathroom-task-source-policy-${VERSION}-${uid}`:'';
      if(key&&localStorage.getItem(key)!=='1'){localStorage.setItem(key,'1');setTimeout(()=>api.scanAndImport({force:true,onProgress:m=>toast(m)}).catch(e=>console.warn('[Mathroom source policy scan]',e)),1200)}
    } catch(e){console.error('[Mathroom source policy init]',e);toast('Политика источников задач: '+String(e?.message||e))}
  }
  api.sourcePolicy2913={VERSION,isAllowedSource,isCanonicalSchool57,isExamBank,purgeTextbookImports,stats};api.__sourcePolicy29161=true;window.MathroomTaskSourcePolicy2913=api.sourcePolicy2913;
  new MutationObserver(mountPolicyInfo).observe(document.documentElement,{childList:true,subtree:true});setTimeout(mountPolicyInfo,1500);setTimeout(initialize,2600);
})();
