/* Mathroom v29.10.0 — full-library PDF indexing coordinator. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__fullIndex2910) return;

  const VERSION = '29.10.0';
  const state = { busy:false, last:null, monitor:null, lastAutoPages:0 };
  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const plain = s => String(s || '').replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();
  const norm = s => plain(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const basename = s => norm(String(s || '').split('/').pop()?.replace(/\.pdf$/i,'') || '');
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function sourceBookScore(src, book){
    const m = src?.meta || {};
    if (m.textbook_id && String(m.textbook_id) === String(book.id)) return 10000;
    const sp = String(src?.storage_path || m.storage_path || m.file_path || m.path || '');
    const bp = String(book?.file_path || '');
    if (sp && bp && sp === bp) return 9000;
    const sf = basename(src?.filename || src?.storage_path || src?.title);
    const bf = basename(book?.file_path || book?.title);
    if (sf && bf && sf === bf) return 8000;
    const st = norm(src?.title), bt = norm(book?.title);
    if (st && bt && st === bt) return 7000;
    let score = 0;
    if (sf && bf && (sf.includes(bf) || bf.includes(sf)) && Math.min(sf.length,bf.length) >= 7) score += 90;
    if (st && bt && (st.includes(bt) || bt.includes(st)) && Math.min(st.length,bt.length) >= 7) score += 80;
    const sg = Number(src?.grade_from || src?.grade || m.grade || 0);
    const bg = Number(book?.grade_from || book?.grade || 0);
    if (sg && bg && sg === bg) score += 10;
    const sa = norm(`${src?.authors || m.authors || m.author || ''}`), ba = norm(book?.author || book?.authors || '');
    if (sa && ba && (sa.includes(ba) || ba.includes(sa))) score += 20;
    return score;
  }

  function matchSource(src, books){
    let best = null, bestScore = 0;
    for (const book of books || []) {
      const score = sourceBookScore(src, book);
      if (score > bestScore) { best = book; bestScore = score; }
    }
    return bestScore >= 25 ? { book:best, score:bestScore } : null;
  }

  async function loadPageCounts(c){
    const counts = new Map();
    for (let from=0; from<40000; from+=1000) {
      const { data, error } = await c.from('task_bank_ocr_pages').select('source_id,page_no').range(from, from+999);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) counts.set(String(r.source_id), (counts.get(String(r.source_id)) || 0) + 1);
      if (rows.length < 1000) break;
    }
    return counts;
  }

  async function probePdfPages(c, src, book){
    const path = src?.storage_path || book?.file_path || '';
    if (!path || !window.pdfjsLib) return 0;
    const bucket = src?.storage_bucket || 'textbooks';
    const { data, error } = await c.storage.from(bucket).createSignedUrl(path, 900);
    if (error || !data?.signedUrl) return 0;
    let doc = null;
    try {
      doc = await window.pdfjsLib.getDocument({ url:data.signedUrl, disableAutoFetch:true }).promise;
      return Number(doc?.numPages || 0);
    } catch (e) {
      console.warn('[Mathroom full index] page-count probe failed', src?.title, e);
      return 0;
    } finally {
      try { await doc?.destroy?.(); } catch {}
    }
  }

  async function inspect({ probeUnknown=false, queue=false, onProgress }={}){
    const c = sb();
    if (!c) return { ready:false, reason:'Supabase не подключён' };
    const books = S().textbooks || [];
    const { data:sources, error } = await c.from('task_bank_sources')
      .select('id,title,filename,storage_bucket,storage_path,page_count,grade,grade_from,grade_to,authors,text_layer_status,ocr_status,ocr_pages_done,ocr_pages_total,ocr_error,meta,is_active')
      .eq('is_active', true);
    if (error) throw error;

    let counts = new Map();
    try { counts = await loadPageCounts(c); } catch (e) { console.warn('[Mathroom full index] page counts', e); }

    let matched=0, repaired=0, queued=0, complete=0, expectedPages=0, indexedPages=0, unknownPages=0;
    const unmatched=[];
    const details=[];

    for (let i=0; i<(sources||[]).length; i++) {
      const src = sources[i];
      const found = matchSource(src, books);
      if (!found) { unmatched.push(src.title || src.id); continue; }
      matched++;
      const book = found.book;
      let meta = { ...(src.meta || {}) };
      let dirtyMeta = String(meta.textbook_id || '') !== String(book.id);
      if (dirtyMeta) { meta.textbook_id = book.id; meta.full_index_match_score = found.score; repaired++; }

      let target = Number(src.page_count || src.ocr_pages_total || 0) || 0;
      if (!target && probeUnknown) {
        onProgress?.(`Определяем объём PDF: ${plain(book.title || src.title)} (${i+1}/${sources.length})`);
        target = await probePdfPages(c, src, book);
      }

      const actualRows = Number(counts.get(String(src.id)) || 0);
      const done = Math.max(Number(src.ocr_pages_done || 0) || 0, actualRows);
      indexedPages += done;
      if (target) expectedPages += target; else unknownPages++;
      const isComplete = !!target && done >= target;
      if (isComplete) complete++;

      const needsQueue = !isComplete && !['processing','pending'].includes(String(src.ocr_status || ''));
      const needsUpdate = dirtyMeta || (!!target && Number(src.page_count || 0) !== target) || (!!target && Number(src.ocr_pages_total || 0) !== target) || (queue && needsQueue);
      if (needsUpdate) {
        const patch = { meta:{ ...meta, full_index_requested:true, full_index_version:VERSION, full_index_target_pages:target || null, full_index_requested_at:new Date().toISOString() } };
        if (target) { patch.page_count = target; patch.ocr_pages_total = target; }
        if (queue && needsQueue) { patch.ocr_status='pending'; patch.ocr_error=null; }
        const { error:u } = await c.from('task_bank_sources').update(patch).eq('id', src.id);
        if (!u && queue && needsQueue) queued++;
      }

      details.push({ sourceId:src.id, textbookId:book.id, title:book.title || src.title, target, done, complete:isComplete, status:src.ocr_status || '', score:found.score });
      if (i % 4 === 3) await wait(0);
    }

    const out = {
      ready:true, version:VERSION,
      sourcesTotal:(sources||[]).length, matched, unmatched:unmatched.slice(0,12), repaired, queued,
      complete, incomplete:Math.max(0, matched-complete), expectedPages, indexedPages,
      unknownPages, details, at:Date.now()
    };
    state.last = out;
    return out;
  }

  async function ensureFullIndex(opts={}){
    if (state.busy) return state.last || {ready:true, busy:true};
    state.busy = true;
    try { return await inspect({ probeUnknown:true, queue:true, ...opts }); }
    finally { state.busy = false; }
  }

  function startMonitor(previousScan){
    if (state.monitor) return;
    state.monitor = setInterval(async () => {
      try {
        const st = await inspect({ probeUnknown:false, queue:true });
        if (!st?.ready) return;
        if (st.indexedPages > state.lastAutoPages) {
          const delta = st.indexedPages - state.lastAutoPages;
          state.lastAutoPages = st.indexedPages;
          if (delta >= 5) {
            await previousScan({ force:false, onProgress:m=>MR().toast?.(m) });
            try { await window.MathroomTaskAutoReviewV2993?.run?.({silent:true}); } catch {}
            try { await window.MathroomTaskImportUIV2983?.render?.(true); } catch {}
            try { await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true}); } catch {}
          }
        }
        if (st.complete >= st.matched && st.matched) {
          clearInterval(state.monitor); state.monitor=null;
          MR().toast?.(`PDF полностью проиндексированы: ${st.indexedPages}/${st.expectedPages} страниц.`);
        }
      } catch (e) { console.warn('[Mathroom full index monitor]', e); }
    }, 45000);
  }

  const previousScan = api.scanAndImport.bind(api);
  api.scanAndImport = async opts => {
    let full = null;
    try {
      full = await ensureFullIndex({ onProgress:opts?.onProgress });
      if (full?.incomplete) MR().toast?.(`Полная индексация: ${full.indexedPages}/${full.expectedPages || '?'} страниц, в очереди ${full.incomplete} источников.`);
    } catch (e) { console.warn('[Mathroom full index prepare]', e); }
    const result = await previousScan(opts || {});
    if (api.state?.last) api.state.last.fullIndex = full || state.last;
    if ((full || state.last)?.incomplete > 0) {
      state.lastAutoPages = Number((full || state.last)?.indexedPages || 0);
      startMonitor(previousScan);
    }
    return { ...(result || {}), fullIndex:full || state.last, version:VERSION };
  };

  api.__fullIndex2910 = true;
  window.MathroomLibraryFullIndex2910 = { version:VERSION, state, inspect, ensureFullIndex, matchSource };

  setTimeout(() => ensureFullIndex().catch(e => console.warn('[Mathroom full index initial]', e)), 3500);
})();
