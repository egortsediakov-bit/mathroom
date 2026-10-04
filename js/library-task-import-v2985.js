/* Mathroom v29.8.5 — robust PDF task extraction with legacy-source matching and diagnostics. */
(() => {
  'use strict';

  const VERSION = '29.8.5';
  const AUTO_THRESHOLD = 0.86;
  const REVIEW_THRESHOLD = 0.62;
  const state = { busy:false, last:null, ready:null };

  const MR = () => window.MR || {};
  const S = () => MR().S || {};
  const sb = () => MR().sb || window.MathroomLibrary2968?.resolveClient?.() || null;
  const toast = m => { try { MR().toast?.(m); } catch {} console.log('[Mathroom PDF tasks 29.8.5]', m); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain = s => String(s || '').replace(/\u00ad/g,'').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').trim();
  const norm = s => plain(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const clamp = n => Math.max(0, Math.min(1, n));
  const hash = s => { let h=2166136261>>>0; for(const ch of String(s)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619)>>>0; } return h.toString(36); };
  const fingerprint = s => 'pdf-' + hash(norm(s));
  const basename = s => norm(String(s||'').split('/').pop()?.replace(/\.pdf$/i,'') || '');
  const tokenSet = s => new Set(norm(s).split(' ').filter(x => x.length >= 2));

  async function teacherId(){
    const ss=S();
    if(ss?.user?.id) return ss.user.id;
    const c=sb();
    if(!c) return null;
    try {
      const {data:{user}} = await c.auth.getUser();
      if(user?.id && !user.is_anonymous){ ss.user=user; return user.id; }
    } catch {}
    return null;
  }

  async function ready(){
    const c=sb();
    if(!c) return {ok:false, reason:'Supabase не подключён'};
    const uid=await teacherId();
    if(!uid) return {ok:false, reason:'Сессия преподавателя ещё загружается'};
    const {error}=await c.from('task_bank_import_candidates').select('id').limit(1);
    if(error){
      const missing=error.code==='42P01' || /task_bank_import_candidates|does not exist|relation .* does not exist/i.test(String(error.message||''));
      return {ok:false, reason:missing?'Нужно выполнить supabase/upgrade-v29.8-task-import.sql':'Ошибка очереди PDF: '+error.message};
    }
    return {ok:true, teacherId:uid};
  }

  function sourceBookScore(src, book){
    const sm=src?.meta||{};
    if(sm.textbook_id && String(sm.textbook_id)===String(book.id)) return 1000;
    const sp=String(sm.file_path||sm.storage_path||sm.path||'');
    if(sp && book.file_path && sp===book.file_path) return 900;
    const st=norm(src?.title), bt=norm(book?.title);
    const sf=basename(src?.title), bf=basename(book?.file_path||book?.title);
    if(st && bt && st===bt) return 800;
    if(sf && bf && sf===bf) return 780;
    let score=0;
    if(st && bt && (st.includes(bt)||bt.includes(st)) && Math.min(st.length,bt.length)>=7) score+=55;
    if(sf && bf && (sf.includes(bf)||bf.includes(sf)) && Math.min(sf.length,bf.length)>=7) score+=50;
    const a=tokenSet(`${src?.title||''} ${sm.author||''}`), b=tokenSet(`${book?.title||''} ${book?.author||''}`);
    if(a.size && b.size){ let common=0; for(const x of a) if(b.has(x)) common++; score += 45 * common / Math.max(1,Math.min(a.size,b.size)); }
    const sg=Number(sm.grade||src?.grade||0), bg=Number(book?.grade_from||book?.grade||0);
    if(sg && bg && sg===bg) score+=8;
    return score;
  }

  function matchSourceToBook(src, books){
    let best=null, bestScore=0;
    for(const book of books){
      const score=sourceBookScore(src,book);
      if(score>bestScore){ best=book; bestScore=score; }
    }
    return bestScore>=25 ? {book:best, score:bestScore} : null;
  }

  const starts = [
    {re:/^\s*№\s*(\d{1,4}(?:[.,]\d+)?[а-яa-z]?)\s*[.:]?\s*(.*)$/i,strong:true},
    {re:/^\s*(\d{1,4}[а-яa-z]?)\.\s+(.{3,})$/i,strong:false}
  ];
  const pageOnly=/^\s*\d{1,4}\s*$/;
  const heading=/^(?:содержание|оглавление|предисловие|ответы(?:\s|$)|глава\s|§\s*\d|параграф\s|упражнения\s*$|задачи\s*$|контрольные\s+вопросы)/i;
  const noise=/(?:содержание|оглавление|предисловие|предметный указатель|ответы к|учебное издание|isbn|удк|ббк|издательств)/i;
  const instruction=/(?:реш(?:и|ите|ить)|найд(?:и|ите|ти)|вычисл(?:и|ите|ить)|докаж(?:и|ите|ать)|постро(?:й|йте|ить)|сравн(?:и|ите|ить)|упрост(?:и|ите|ить)|разлож(?:и|ите|ить)|представ(?:ьте|ить)|определ(?:ите|ить)|исслед(?:уйте|овать)|состав(?:ьте|ить)|сколько|чему\s+рав|если\s|при\s|вероятност|площад|периметр|объ[её]м|угол|корн|уравнен|неравен|функц|=|\?|√|\^|\+|−|-|:)/i;

  function startOf(line){
    for(const p of starts){
      const m=line.match(p.re); if(!m) continue;
      const n=Number(String(m[1]).replace(/[^0-9].*$/,''));
      if(n>=1 && n<=5000) return {taskNo:m[1],numeric:n,first:plain(m[2]),strong:p.strong};
    }
    return null;
  }

  function answerOf(text){
    const m=String(text).match(/(?:^|\s)(?:Ответ|Ответы)\s*[:.]\s*([^\n]{1,180})$/i);
    return m ? {content:plain(String(text).slice(0,m.index)), answer:plain(m[1])} : {content:plain(text), answer:''};
  }

  function parsePages(pages){
    const out=[]; let cur=null;
    const finish=()=>{
      if(!cur) return;
      const a=answerOf(cur.parts.join(' '));
      if(a.content.length>=8) out.push({...cur,...a});
      cur=null;
    };
    for(const page of pages){
      const body=String(page.body_text||'');
      for(const raw of body.split(/\n+/)){
        const line=plain(raw); if(!line||pageOnly.test(line)) continue;
        if(heading.test(line)){ finish(); continue; }
        const st=startOf(line);
        if(st){ finish(); cur={...st,page_no:Number(page.page_no),ocrConfidence:Number(page.confidence)||0,parts:st.first?[st.first]:[]}; continue; }
        if(cur && !(noise.test(line)&&line.length<120)) cur.parts.push(line);
      }
    }
    finish();
    for(let i=0;i<out.length;i++){
      const a=out[i-1]?.numeric,b=out[i].numeric,c=out[i+1]?.numeric;
      out[i].sequential=(Number.isFinite(a)&&b===a+1)||(Number.isFinite(c)&&c===b+1);
    }
    return out;
  }

  function chooseTopic(links,topics,page){
    const a=[];
    for(const l of links){
      const f=Number(l.page_from), t=Number(l.page_to||l.page_from);
      if(!f||page<f||page>t) continue;
      const topic=topics.get(String(l.topic_id));
      if(topic) a.push({topic,span:Math.max(0,t-f),titleLen:String(topic.title||'').length});
    }
    a.sort((x,y)=>x.span-y.span||y.titleLen-x.titleLen);
    return a[0]?.topic||null;
  }

  function material(src,book){ return norm(`${src?.material_kind||''} ${src?.meta?.material_kind||''} ${book?.title||''}`); }
  function score(task,src,book,topic){
    let s=.38; s+=task.strong?.18:.07;
    if(/задачник|сборник|taskbook|collection/.test(material(src,book))) s+=.12;
    if(topic) s+=.12;
    if(task.ocrConfidence>=.9) s+=.08; else if(task.ocrConfidence>=.75) s+=.04;
    const n=task.content.length;
    if(n>=30&&n<=700) s+=.08; else if(n>=15&&n<=1100) s+=.04; else if(n<15) s-=.35; else if(n>1800) s-=.18;
    if(instruction.test(task.content)) s+=.08;
    if(task.sequential) s+=.07;
    if(noise.test(task.content)) s-=.35;
    if(/\.{4,}/.test(task.content)) s-=.25;
    if(!topic) s-=.12;
    return Math.round(clamp(s)*1000)/1000;
  }
  function difficulty(src,content){
    const x=norm(`${src?.level||''} ${src?.meta?.level||''}`);
    if(/advanced|profile|углуб|профил/.test(x)) return 'advanced';
    if(String(content).length<90&&/(вычисл|сравн|найдите значение)/i.test(content)) return 'basic';
    return 'medium';
  }
  function sourceTitle(src,book){ return plain(book?.title||src?.title||'PDF').slice(0,100); }

  async function loadPages(c,id){
    const out=[];
    for(let from=0;from<7000;from+=500){
      const {data,error}=await c.from('task_bank_ocr_pages').select('page_no,body_text,confidence,status').eq('source_id',id).eq('status','done').order('page_no').range(from,from+499);
      if(error) throw error;
      const rows=data||[]; out.push(...rows); if(rows.length<500) break;
    }
    return out;
  }

  async function knownFingerprints(c,uid){
    const out=new Set((S().exercises||[]).filter(x=>x.kind==='task').map(x=>fingerprint(x.content)));
    for(let from=0;from<20000;from+=1000){
      const {data,error}=await c.from('task_bank_import_candidates').select('fingerprint').eq('teacher_id',uid).range(from,from+999);
      if(error) throw error;
      const rows=data||[]; rows.forEach(r=>out.add(r.fingerprint)); if(rows.length<1000) break;
    }
    return out;
  }

  async function upsertCandidates(c,rows){
    const out=[];
    for(let i=0;i<rows.length;i+=200){
      const {data,error}=await c.from('task_bank_import_candidates').upsert(rows.slice(i,i+200),{onConflict:'teacher_id,fingerprint'}).select();
      if(error) throw error;
      out.push(...(data||[]));
    }
    return out;
  }

  async function importIds(c,ids){
    let n=0;
    for(let i=0;i<ids.length;i+=250){
      const {data,error}=await c.rpc('mathroom_import_task_candidates',{p_ids:ids.slice(i,i+250)});
      if(error) throw error;
      n+=Number(data)||0;
    }
    return n;
  }

  async function scanAndImport({force=false,onProgress}={}){
    if(state.busy) return state.last;
    state.busy=true;
    try{
      const c=sb(), ss=S(), check=await ready(); state.ready=check;
      if(!check.ok){ toast(check.reason); return {ready:false,reason:check.reason}; }
      const uid=check.teacherId;
      const [{data:sources,error:se},{data:links,error:le}]=await Promise.all([
        c.from('task_bank_sources').select('id,title,subject,level,material_kind,ocr_status,ocr_pages_done,meta').eq('is_active',true),
        c.from('textbook_topic_links').select('textbook_id,topic_id,page_from,page_to,note').not('page_from','is',null)
      ]);
      if(se) throw se; if(le) throw le;

      const topics=new Map((ss.topics||[]).map(t=>[String(t.id),t]));
      const books=ss.textbooks||[];
      const byBook=new Map();
      for(const l of links||[]){ const k=String(l.textbook_id); if(!byBook.has(k)) byBook.set(k,[]); byBook.get(k).push(l); }
      const known=await knownFingerprints(c,uid);

      let sourcesTotal=(sources||[]).length, sourcesMatched=0, sourcesWithPages=0, sourcesScanned=0, pagesScanned=0, parsed=0, withTopic=0, autoImported=0, pending=0, duplicates=0, discarded=0, queued=0;
      const unmatched=[];

      for(let si=0;si<(sources||[]).length;si++){
        const src=sources[si];
        const matched=matchSourceToBook(src,books);
        if(!matched){ unmatched.push(src.title||src.id); continue; }
        const book=matched.book, bookLinks=byBook.get(String(book.id))||[];
        if(!bookLinks.length){ unmatched.push(`${src.title||src.id} → без связей тем`); continue; }
        sourcesMatched++;

        const done=Number(src.ocr_pages_done||0)||0, meta=src.meta||{};
        if(!force && meta.task_import_version===VERSION && Number(meta.task_import_pages_done||0)===done) continue;

        onProgress?.(`PDF → задачи: ${sourceTitle(src,book)} (${si+1}/${sources.length})`);
        const pages=await loadPages(c,src.id);
        if(!pages.length){
          if(!['pending','processing'].includes(String(src.ocr_status||''))){
            const {error}=await c.from('task_bank_sources').update({ocr_status:'pending',ocr_error:null}).eq('id',src.id);
            if(!error) queued++;
          }
          continue;
        }
        sourcesWithPages++; sourcesScanned++; pagesScanned+=pages.length;
        const tasks=parsePages(pages); parsed+=tasks.length;
        const candidates=[];

        for(const task of tasks){
          const topic=chooseTopic(bookLinks,topics,task.page_no);
          if(!topic){ discarded++; continue; }
          withTopic++;
          const conf=score(task,src,book,topic);
          if(conf<REVIEW_THRESHOLD){ discarded++; continue; }
          const fp=fingerprint(task.content);
          if(known.has(fp)){ duplicates++; continue; }
          known.add(fp);
          candidates.push({
            teacher_id:uid, source_id:src.id, textbook_id:book.id, topic_id:topic.id,
            grade:Number(topic.grade)||null, topic_title:topic.title, source_title:sourceTitle(src,book),
            page_no:task.page_no, task_no:String(task.taskNo||''), content:task.content, answer:task.answer||'',
            confidence:conf, difficulty:difficulty(src,task.content), fingerprint:fp,
            status:conf>=AUTO_THRESHOLD?'ready':'pending',
            meta:{version:VERSION,ocr_confidence:task.ocrConfidence,strong_number:task.strong,sequential:task.sequential,section:topic.section||'',source_kind:src.material_kind||src.meta?.material_kind||'',source_match_score:matched.score}
          });
        }

        if(candidates.length){
          const saved=await upsertCandidates(c,candidates);
          const autoIds=saved.filter(x=>Number(x.confidence)>=AUTO_THRESHOLD&&x.status!=='imported'&&x.status!=='rejected').map(x=>x.id);
          pending+=saved.filter(x=>x.status==='pending').length;
          if(autoIds.length) autoImported+=await importIds(c,autoIds);
        }

        await c.from('task_bank_sources').update({meta:{...meta,textbook_id:book.id,task_import_version:VERSION,task_import_pages_done:done,task_import_at:new Date().toISOString()}}).eq('id',src.id);
        await new Promise(r=>setTimeout(r,0));
      }

      state.last={ready:true,sourcesTotal,sourcesMatched,sourcesWithPages,sourcesScanned,pagesScanned,parsed,withTopic,autoImported,pending,duplicates,discarded,queued,unmatched:unmatched.slice(0,10),version:VERSION};
      toast(`PDF → банк: источников ${sourcesMatched}/${sourcesTotal}, страниц ${pagesScanned}, найдено задач ${parsed}, добавлено ${autoImported}, на проверку ${pending}, дублей ${duplicates}${queued?`, в OCR-очередь ${queued}`:''}.`);
      window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});
      return state.last;
    } catch(e){
      console.error('[Mathroom 29.8.5 task import]',e);
      toast('Импорт PDF: '+String(e?.message||e));
      state.last={error:String(e?.message||e)};
      return state.last;
    } finally { state.busy=false; }
  }

  async function stats(){
    const c=sb(),check=await ready(); state.ready=check;
    if(!check.ok) return {ready:false,reason:check.reason};
    const uid=check.teacherId, statuses=['pending','ready','imported','rejected'];
    const res=await Promise.all(statuses.map(st=>c.from('task_bank_import_candidates').select('*',{count:'exact',head:true}).eq('teacher_id',uid).eq('status',st)));
    const out={ready:true};
    for(let i=0;i<statuses.length;i++){ if(res[i].error) throw res[i].error; out[statuses[i]+'Count']=res[i].count||0; }
    out.pending=out.pendingCount; out.imported=out.importedCount; out.rejected=out.rejectedCount; out.readyCandidates=out.readyCount;
    return out;
  }

  async function approve(id){ const c=sb(); if(!c) return false; return (await importIds(c,[id]))>0; }
  async function reject(id){ const c=sb(); if(!c) return false; const {error}=await c.from('task_bank_import_candidates').update({status:'rejected',updated_at:new Date().toISOString()}).eq('id',id); if(error) throw error; return true; }

  async function reviewModal(){
    const c=sb(),check=await ready(); if(!check.ok) return toast(check.reason);
    const {data,error}=await c.from('task_bank_import_candidates').select('*').eq('teacher_id',check.teacherId).eq('status','pending').order('confidence',{ascending:false}).limit(80);
    if(error) throw error;
    const rows=data||[], modal=MR().modal; if(!modal) return;
    modal(`<h2>Задачи из PDF · на проверку</h2><p class="muted">Показаны первые ${rows.length} пограничных распознаваний.</p><div class="list">${rows.length?rows.map(x=>`<div class="row" data-pdf-candidate="${x.id}"><div><div class="actions"><span class="pill">${x.grade||'?'} кл.</span><span class="pill">${esc(x.topic_title)}</span><span class="pill">${Math.round(Number(x.confidence)*100)}%</span></div><h3>№ ${esc(x.task_no||'—')} · ${esc(x.source_title)}</h3><div class="prewrap">${esc(x.content)}</div><p class="muted">PDF стр. ${x.page_no}</p></div><div class="actions"><button class="btn sm" data-pdf-approve="${x.id}">В банк</button><button class="btn sm danger" data-pdf-reject="${x.id}">Отклонить</button></div></div>`).join(''):'<div class="empty">Очередь проверки пуста.</div>'}</div>`,'wide-modal');
    await new Promise(r=>setTimeout(r,0));
    document.querySelectorAll('[data-pdf-approve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await approve(b.dataset.pdfApprove);b.closest('[data-pdf-candidate]')?.remove();window.MathroomTaskImportUIV2983?.render?.(true);window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});}catch(e){toast(String(e.message||e));b.disabled=false;}});
    document.querySelectorAll('[data-pdf-reject]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await reject(b.dataset.pdfReject);b.closest('[data-pdf-candidate]')?.remove();window.MathroomTaskImportUIV2983?.render?.(true);}catch(e){toast(String(e.message||e));b.disabled=false;}});
  }

  window.MathroomTaskImportV298={VERSION,state,ready,scanAndImport,stats,reviewModal,approve,reject,parsePages,matchSourceToBook};
})();
