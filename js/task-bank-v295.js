/* Mathroom v29.5 — Task Bank v1
 * Browser-side PDF indexing using the pdfjsLib already loaded by Mathroom.
 * No OCR is used here. Scanned PDFs can later be delegated to the VPS worker.
 */
(function(){
  'use strict';

  const API = {};
  let sb = null;
  let stopped = false;

  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const normalize=(s)=>String(s||'')
    .replace(/\u00ad/g,'')
    .replace(/[\u200b-\u200d\ufeff]/g,'')
    .replace(/\s+/g,' ')
    .trim();

  async function sha256(text){
    const bytes=new TextEncoder().encode(normalize(text).toLowerCase());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }

  function resolveClient(){
    if(sb) return sb;
    const candidates=[
      window.Mathroom?.supabase,
      window.supabaseClient,
      window.sb,
      window._supabase,
      window.appSupabase
    ];
    sb=candidates.find(x=>x && typeof x.from==='function') || null;
    return sb;
  }

  API.setClient=(client)=>{ sb=client; return API; };
  API.stop=()=>{ stopped=true; };

  function joinTextItems(items){
    // pdf.js gives x/y coordinates. Rebuild visual lines to make exercise markers reliable.
    const rows=[];
    for(const it of (items||[])){
      const t=normalize(it.str);
      if(!t) continue;
      const tr=it.transform||[];
      const x=Number(tr[4]||0), y=Number(tr[5]||0);
      let row=rows.find(r=>Math.abs(r.y-y)<2.3);
      if(!row){ row={y,parts:[]}; rows.push(row); }
      row.parts.push({x,t});
    }
    rows.sort((a,b)=>b.y-a.y);
    return rows.map(r=>r.parts.sort((a,b)=>a.x-b.x).map(p=>p.t).join(' ').replace(/\s+([,.;:!?])/g,'$1').trim()).filter(Boolean);
  }

  const RE_DECIMAL=/^\s*(?:№\s*)?((?:\d{1,2}\.)\d{1,4})[.)]?\s+(.{3,})$/;
  const RE_SIMPLE=/^\s*(?:№\s*)?(\d{1,4})[.)]\s+(.{3,})$/;
  const RE_SIMPLE_SPACE=/^\s*(?:№\s*)?(\d{1,4})\s+(.{8,})$/;

  function findMarkers(lines){
    const out=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      let m=line.match(RE_DECIMAL) || line.match(RE_SIMPLE);
      if(m) out.push({i,no:m[1],head:m[2],strong:true});
    }
    // Some taskbooks use "228 text" without a dot. Accept only if there is a sequence
    // of at least 3 increasing numbers on the page — this avoids page-number false positives.
    if(out.length<2){
      const weak=[];
      for(let i=0;i<lines.length;i++){
        const m=lines[i].match(RE_SIMPLE_SPACE);
        if(m) weak.push({i,no:m[1],head:m[2],strong:false});
      }
      let seq=0, best=0, prev=null;
      for(const w of weak){
        const n=Number(w.no);
        if(prev!=null && n>prev && n-prev<=8) seq++; else seq=1;
        prev=n; best=Math.max(best,seq);
      }
      if(best>=3) return weak;
    }
    return out;
  }

  function splitExercises(lines){
    const markers=findMarkers(lines);
    if(!markers.length) return [];
    const tasks=[];
    for(let k=0;k<markers.length;k++){
      const m=markers[k];
      const end=(markers[k+1]?.i ?? lines.length);
      const rest=lines.slice(m.i+1,end);
      const body=normalize([m.head,...rest].join(' '));
      if(body.length<12) continue;
      tasks.push({exercise_no:m.no,body_text:body,confidence:m.strong?0.94:0.78});
    }
    return tasks;
  }

  function resolveTopic(page, map){
    const candidates=(map||[]).filter(x=>page>=Number(x.page_from||x.page||0) && page<=Number(x.page_to||x.page||0));
    if(!candidates.length) return null;
    candidates.sort((a,b)=>Number(b.verified||0)-Number(a.verified||0) || Number(b.confidence||0)-Number(a.confidence||0));
    return candidates[0];
  }

  async function upsertSource(src){
    const client=resolveClient();
    if(!client) throw new Error('Supabase client not found. Call MathroomTaskBank.setClient(client).');
    const row={
      external_key:src.external_key||src.key||src.title,
      title:src.title,
      grade:src.grade||null,
      source_kind:'pdf',
      pdf_url:src.url||null,
      page_count:src.page_count||null,
      meta:src.meta||{}
    };
    const {data,error}=await client.from('task_bank_sources').upsert(row,{onConflict:'external_key'}).select().single();
    if(error) throw error;
    return data;
  }

  async function syncTopicMap(sourceId,map){
    const client=resolveClient();
    const rows=(map||[]).filter(x=>x.topic_title).map(x=>({
      source_id:sourceId,
      topic_key:x.topic_key||null,
      topic_title:x.topic_title,
      grade:x.grade||null,
      page_from:Number(x.page_from||x.page),
      page_to:Number(x.page_to||x.page),
      confidence:clamp(Number(x.confidence??1),0,1),
      verified:Boolean(x.verified),
      meta:x.meta||{}
    }));
    if(!rows.length) return;
    for(let i=0;i<rows.length;i+=200){
      const {error}=await client.from('task_bank_topic_pages').upsert(rows.slice(i,i+200),{onConflict:'source_id,topic_title,page_from,page_to'});
      if(error) throw error;
    }
  }

  async function createRun(sourceId,total){
    const client=resolveClient();
    const {data,error}=await client.from('task_bank_runs').insert({source_id:sourceId,pages_total:total,status:'running'}).select().single();
    if(error) throw error;
    return data;
  }

  async function updateRun(runId,patch){
    const client=resolveClient();
    if(!runId) return;
    await client.from('task_bank_runs').update(patch).eq('id',runId);
  }

  async function saveTasks(source, page, tasks, topic){
    const client=resolveClient();
    if(!tasks.length) return {found:0,added:0};
    const rows=[];
    for(const t of tasks){
      const h=await sha256(`${source.id}|${page}|${t.exercise_no}|${t.body_text}`);
      const topicConfidence=topic?Number(topic.confidence??1):0.35;
      const confidence=clamp(t.confidence*0.7+topicConfidence*0.3,0,1);
      rows.push({
        source_id:source.id,
        source_page:page,
        exercise_no:t.exercise_no,
        grade:source.grade||topic?.grade||null,
        topic_key:topic?.topic_key||null,
        topic_title:topic?.topic_title||null,
        body_text:t.body_text,
        body_hash:h,
        confidence,
        verified:Boolean(topic?.verified) && confidence>=0.9,
        status:confidence>=0.72?'active':'review',
        meta:{parser:'browser-v29.5'}
      });
    }
    const {data,error}=await client.from('task_bank_items')
      .upsert(rows,{onConflict:'source_id,source_page,exercise_no,body_hash',ignoreDuplicates:true})
      .select('id');
    if(error) throw error;
    return {found:rows.length,added:data?.length||0};
  }

  async function loadPdf(url){
    if(!window.pdfjsLib) throw new Error('pdfjsLib is not loaded');
    const task=window.pdfjsLib.getDocument({url,withCredentials:false});
    return task.promise;
  }

  API.scanPdf=async function(opts){
    stopped=false;
    const sourceInput={...opts};
    if(!sourceInput.url) throw new Error('PDF url is required');
    if(!sourceInput.title) sourceInput.title=sourceInput.external_key||'PDF';
    const pdf=await loadPdf(sourceInput.url);
    sourceInput.page_count=pdf.numPages;
    const source=await upsertSource(sourceInput);
    const topicMap=sourceInput.topicMap||[];
    if(topicMap.length) await syncTopicMap(source.id,topicMap);

    const from=clamp(Number(opts.startPage||1),1,pdf.numPages);
    const to=clamp(Number(opts.endPage||pdf.numPages),from,pdf.numPages);
    const run=await createRun(source.id,to-from+1);
    let done=0, found=0, added=0, errors=0;

    try{
      for(let pageNo=from; pageNo<=to; pageNo++){
        if(stopped){ await updateRun(run.id,{status:'cancelled',pages_done:done,tasks_found:found,tasks_added:added,finished_at:new Date().toISOString()}); break; }
        try{
          const page=await pdf.getPage(pageNo);
          const tc=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
          const lines=joinTextItems(tc.items);
          const tasks=splitExercises(lines);
          const topic=resolveTopic(pageNo,topicMap);
          const res=await saveTasks(source,pageNo,tasks,topic);
          found+=res.found; added+=res.added;
        }catch(e){
          errors++;
          console.warn('[TaskBank] page',pageNo,e);
        }
        done++;
        if(done%5===0 || pageNo===to){
          await updateRun(run.id,{pages_done:done,tasks_found:found,tasks_added:added,errors});
        }
        opts.onProgress?.({source,page:pageNo,done,total:to-from+1,found,added,errors});
        if(done%10===0) await sleep(0);
      }
      if(!stopped) await updateRun(run.id,{status:'done',pages_done:done,tasks_found:found,tasks_added:added,errors,finished_at:new Date().toISOString()});
      return {source,run_id:run.id,pages:done,found,added,errors,cancelled:stopped};
    }catch(e){
      await updateRun(run.id,{status:'failed',pages_done:done,tasks_found:found,tasks_added:added,errors:errors+1,error_text:String(e?.message||e).slice(0,1000),finished_at:new Date().toISOString()});
      throw e;
    }
  };

  API.list=async function(filters={}){
    const client=resolveClient();
    if(!client) throw new Error('Supabase client not found');
    let q=client.from('task_bank_items').select('*,task_bank_sources(title,external_key,pdf_url)').eq('status',filters.status||'active');
    if(filters.grade) q=q.eq('grade',filters.grade);
    if(filters.topic) q=q.or(`topic_title.eq.${filters.topic},topic_key.eq.${filters.topic}`);
    if(filters.source_id) q=q.eq('source_id',filters.source_id);
    if(filters.verified!=null) q=q.eq('verified',!!filters.verified);
    if(filters.search) q=q.ilike('body_text',`%${String(filters.search).replace(/[%_]/g,'')}%`);
    q=q.order('verified',{ascending:false}).order('confidence',{ascending:false}).limit(clamp(filters.limit||100,1,500));
    const {data,error}=await q;
    if(error) throw error;
    return data||[];
  };

  API.markVerified=async function(id,patch={}){
    const client=resolveClient();
    const {data,error}=await client.from('task_bank_items').update({verified:true,status:'active',...patch}).eq('id',id).select().single();
    if(error) throw error;
    return data;
  };

  API.pick=async function({grade=null,topic=null,limit=20,difficulty=null}={}){
    const client=resolveClient();
    const {data,error}=await client.rpc('task_bank_pick',{p_grade:grade,p_topic:topic,p_limit:limit,p_difficulty:difficulty});
    if(error) throw error;
    return data||[];
  };

  API.renderTaskCard=function(task){
    const el=document.createElement('div');
    el.className='tb-task-card';
    el.dataset.taskId=task.id;
    el.innerHTML=`<div class="tb-task-top"><b>${escapeHtml(task.exercise_no?`№ ${task.exercise_no}`:'Задача')}</b><span>${Math.round((task.confidence||0)*100)}%</span></div><div class="tb-task-text">${escapeHtml(task.body_text)}</div><div class="tb-task-meta">${escapeHtml([task.grade?`${task.grade} класс`:'',task.topic_title||'',task.task_bank_sources?.title||''].filter(Boolean).join(' · '))}</div>`;
    return el;
  };

  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  window.MathroomTaskBank=API;
})();
