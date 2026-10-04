/* Mathroom v29.13.1 — indexing coordinator for TASK SOURCES only. Textbooks are excluded from task OCR. */
(() => {
  'use strict';

  const api = window.MathroomTaskImportV298;
  if (!api || api.__fullIndex2910) return;

  const VERSION = '29.13.1';
  const state = { busy:false, last:null, monitor:null, lastAutoPages:0, lastAutoScanAt:0 };
  const MR = () => window.MR || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const plain = s => String(s || '').replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function isAllowedSource(src){
    const policy = window.MathroomTaskSourcePolicy2913;
    if (policy?.isAllowedSource) return !!policy.isAllowedSource(src);
    const kind=String(src?.material_kind||src?.meta?.material_kind||'').toLowerCase();
    const text=`${src?.title||''} ${src?.filename||''} ${kind}`.toLowerCase();
    if (['taskbook','collection','problem_book','workbook','exam_bank','oge_bank','ege_bank'].includes(kind)) return true;
    return /задачник|сборник\s+(задач|упражнений)|банк\s+заданий|огэ|егэ|фипи|5[\s_.-]*57|6[\s_.-]*57|7[\s_.-]*57|8[\s_.-]*57/.test(text);
  }

  async function loadPageCounts(c, allowedIds){
    const counts = new Map();
    if(!allowedIds.length) return counts;
    for (let from=0; from<40000; from+=1000) {
      const { data, error } = await c.from('task_bank_ocr_pages').select('source_id,page_no').in('source_id',allowedIds).range(from, from+999);
      if (error) throw error;
      const rows = data || [];
      for (const r of rows) counts.set(String(r.source_id), (counts.get(String(r.source_id)) || 0) + 1);
      if (rows.length < 1000) break;
    }
    return counts;
  }

  async function probePdfPages(c, src){
    const path = src?.storage_path || src?.meta?.storage_path || src?.meta?.file_path || '';
    if (!path || !window.pdfjsLib) return 0;
    const bucket = src?.storage_bucket || 'textbooks';
    const { data, error } = await c.storage.from(bucket).createSignedUrl(path, 900);
    if (error || !data?.signedUrl) return 0;
    let doc = null;
    try {
      doc = await window.pdfjsLib.getDocument({ url:data.signedUrl, disableAutoFetch:true }).promise;
      return Number(doc?.numPages || 0);
    } catch (e) {
      console.warn('[Mathroom task-source index] page-count probe failed', src?.title, e);
      return 0;
    } finally {
      try { await doc?.destroy?.(); } catch {}
    }
  }

  function ageMs(v){ const t=Date.parse(v||''); return Number.isFinite(t)?Date.now()-t:Infinity; }

  async function inspect({ probeUnknown=false, queue=false, onProgress }={}){
    const c = sb();
    if (!c) return { ready:false, reason:'Supabase не подключён' };
    const { data:allSources, error } = await c.from('task_bank_sources')
      .select('id,title,filename,storage_bucket,storage_path,page_count,grade,grade_from,grade_to,authors,material_kind,text_layer_status,ocr_status,ocr_pages_done,ocr_pages_total,ocr_error,meta,is_active,updated_at')
      .eq('is_active', true);
    if (error) throw error;

    const sources=(allSources||[]).filter(isAllowedSource);
    const allowedIds=sources.map(x=>x.id).filter(Boolean);
    let counts = new Map();
    try { counts = await loadPageCounts(c, allowedIds); } catch (e) { console.warn('[Mathroom task-source index] page counts', e); }

    let queued=0, complete=0, expectedPages=0, indexedPages=0, unknownPages=0, probing=0;
    const details=[];

    for (let i=0; i<sources.length; i++) {
      const src = sources[i];
      let target = Number(src.page_count || src.ocr_pages_total || src.meta?.page_count || 0) || 0;
      if (!target && probeUnknown) {
        probing++;
        onProgress?.(`Определяем объём задачника: ${plain(src.title)} (${i+1}/${sources.length})`);
        target = await probePdfPages(c, src);
      }

      const actualRows = Number(counts.get(String(src.id)) || 0);
      // Actual rows are authoritative. ocr_pages_done can be stale/high from an older worker run.
      const done = actualRows;
      indexedPages += done;
      if (target) expectedPages += target; else unknownPages++;
      const isComplete = !!target && done >= target;
      if (isComplete) complete++;

      const status=String(src.ocr_status||'');
      const staleProcessing=status==='processing' && ageMs(src.updated_at)>10*60*1000;
      const needsQueue = !isComplete && (status!=='processing' || staleProcessing);
      const shouldKick = queue && needsQueue;
      const meta={...(src.meta||{}),task_source_index:true,task_source_index_version:VERSION,task_source_target_pages:target||null,task_source_index_requested_at:new Date().toISOString()};
      const patch={meta};
      let needsUpdate=false;
      if(target && Number(src.page_count||0)!==target){patch.page_count=target;needsUpdate=true;}
      if(target && Number(src.ocr_pages_total||0)!==target){patch.ocr_pages_total=target;needsUpdate=true;}
      if(shouldKick){patch.ocr_status='pending';patch.ocr_error=null;needsUpdate=true;}
      if(needsUpdate){
        const {error:u}=await c.from('task_bank_sources').update(patch).eq('id',src.id);
        if(!u&&shouldKick)queued++;
        if(u)console.warn('[Mathroom task-source index] queue update',src.title,u);
      }

      details.push({sourceId:src.id,title:src.title,target,done,complete:isComplete,status:shouldKick?'pending':status,staleProcessing});
      if(i%3===2)await wait(0);
    }

    const out={
      ready:true,version:VERSION,
      sourcesTotal:(allSources||[]).length,
      taskSources:sources.length,matched:sources.length,
      complete,incomplete:Math.max(0,sources.length-complete),expectedPages,indexedPages,unknownPages,queued,probing,
      excludedTextbooks:Math.max(0,(allSources||[]).length-sources.length),details,at:Date.now()
    };
    state.last=out;
    return out;
  }

  async function ensureFullIndex(opts={}){
    if(state.busy)return state.last||{ready:true,busy:true};
    state.busy=true;
    try{return await inspect({probeUnknown:true,queue:true,...opts});}
    finally{state.busy=false;}
  }

  function startMonitor(previousScan){
    if(state.monitor)return;
    state.monitor=setInterval(async()=>{
      try{
        const st=await inspect({probeUnknown:false,queue:true});
        if(!st?.ready)return;
        if(st.indexedPages>state.lastAutoPages){
          const delta=st.indexedPages-state.lastAutoPages;
          state.lastAutoPages=st.indexedPages;
          if(delta>=3&&Date.now()-state.lastAutoScanAt>25000){
            state.lastAutoScanAt=Date.now();
            MR().toast?.(`Новые страницы задачников: +${delta}. Ищем задачи…`);
            await previousScan({force:true,onProgress:m=>MR().toast?.(m)});
            try{await window.MathroomTaskStrictGate29111?.cleanAll?.({silent:true});}catch{}
            try{await window.MathroomTaskImportUIV2983?.render?.(true);}catch{}
            try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});}catch{}
            try{await window.MathroomPdfTasksBrowser2911?.refreshCount?.();}catch{}
          }
        }
        if(st.taskSources&&st.complete>=st.taskSources){
          clearInterval(state.monitor);state.monitor=null;
          MR().toast?.(`Источники задач проиндексированы: ${st.indexedPages}/${st.expectedPages} страниц.`);
        }
      }catch(e){console.warn('[Mathroom task-source monitor]',e);}
    },20000);
  }

  const previousScan=api.scanAndImport.bind(api);
  api.scanAndImport=async opts=>{
    let full=null;
    try{
      full=await ensureFullIndex({onProgress:opts?.onProgress});
      if(full?.incomplete)MR().toast?.(`Индексация задачников: ${full.indexedPages}/${full.expectedPages||'?'} страниц. В очереди ${full.queued||0}.`);
    }catch(e){console.warn('[Mathroom task-source index prepare]',e);}
    const result=await previousScan(opts||{});
    if(api.state?.last)api.state.last.fullIndex=full||state.last;
    if((full||state.last)?.incomplete>0){state.lastAutoPages=Number((full||state.last)?.indexedPages||0);startMonitor(previousScan);}
    return{...(result||{}),fullIndex:full||state.last,version:VERSION};
  };

  api.__fullIndex2910=true;
  window.MathroomLibraryFullIndex2910={version:VERSION,state,inspect,ensureFullIndex,isAllowedSource};

  setTimeout(()=>ensureFullIndex().then(st=>{if(st?.incomplete){state.lastAutoPages=Number(st.indexedPages||0);startMonitor(previousScan);}}).catch(e=>console.warn('[Mathroom task-source initial]',e)),3500);
})();
