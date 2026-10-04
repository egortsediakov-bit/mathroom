/* Mathroom v29.8.0 — extract numbered tasks from indexed textbook PDF pages into the task bank. */
(() => {
  'use strict';
  const VERSION='29.8.0';
  const IMPORT_TAG='pdf-import-v29.8';
  const AUTO_THRESHOLD=0.84;
  const REVIEW_THRESHOLD=0.58;
  const state={busy:false,last:null,ready:null,autoStarted:false};
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\u00ad/g,'').replace(/[^a-zа-я0-9=+\-*/^√()%.,:;!?]+/gi,' ').replace(/\s+/g,' ').trim();
  const plain=s=>String(s||'').replace(/\u00ad/g,'').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').trim();
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const hash=s=>{let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h.toString(36)};
  const MR=()=>window.MR||{};
  const sb=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const S=()=>MR().S||{};
  const toast=(m)=>{try{MR().toast?.(m)}catch{};console.log('[Mathroom task import]',m)};
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function tableMissing(error){return !!error && (error.code==='42P01'||/task_bank_import_candidates|does not exist|relation .* does not exist/i.test(String(error.message||'')));}
  async function ready(){
    const c=sb();if(!c)return {ok:false,reason:'Supabase не подключён'};
    const {error}=await c.from('task_bank_import_candidates').select('id').limit(1);
    if(error)return {ok:false,reason:tableMissing(error)?'Нужно установить SQL v29.8':'Ошибка таблицы импорта: '+error.message};
    return {ok:true};
  }

  const startPatterns=[
    {re:/^\s*№\s*(\d{1,4}(?:[.,]\d+)?[а-яa-z]?)\s*[.:]?\s*(.*)$/i,strong:true},
    {re:/^\s*(\d{1,4}[а-яa-z]?)\.\s+(.{3,})$/i,strong:false}
  ];
  const headingRe=/^(?:содержание|оглавление|предисловие|ответы(?:\s|$)|глава\s|§\s*\d|параграф\s|упражнения\s*$|задачи\s*$|контрольные\s+вопросы)/i;
  const instructionRe=/(?:реш(?:и|ите|ить)|найд(?:и|ите|ти)|вычисл(?:и|ите|ить)|докаж(?:и|ите|ать)|постро(?:й|йте|ить)|сравн(?:и|ите|ить)|упрост(?:и|ите|ить)|разлож(?:и|ите|ить)|представ(?:ьте|ить)|определ(?:ите|ить)|исслед(?:уйте|овать)|состав(?:ьте|ить)|сколько|чему\s+рав|если\s|при\s|вероятност|площад|периметр|объ[её]м|угол|корн|уравнен|неравен|функц|=|\?|√|\^|\+|−|-|:)/i;
  const noiseRe=/(?:содержание|оглавление|предисловие|предметный указатель|ответы к|учебное издание|isbn|удк|ббк|издательств)/i;
  const pageNumberRe=/^\s*\d{1,4}\s*$/;

  function splitLines(body){return String(body||'').split(/\n+/).map(plain).filter(Boolean).filter(x=>!pageNumberRe.test(x));}
  function parseStart(line){
    for(const p of startPatterns){const m=line.match(p.re);if(m){const n=Number(String(m[1]).replace(/[^0-9].*$/,''));if(!Number.isFinite(n)||n<1||n>5000)return null;return {taskNo:m[1],first:plain(m[2]||''),strong:p.strong,numeric:n};}}
    return null;
  }
  function stripAnswer(text){
    const m=String(text||'').match(/(?:^|\s)(?:Ответ|Ответы)\s*[:.]\s*([^\n]{1,180})$/i);
    if(!m)return {content:plain(text),answer:''};
    return {content:plain(String(text).slice(0,m.index)),answer:plain(m[1])};
  }
  function parseTasks(pages){
    const out=[];let cur=null;
    const finish=()=>{if(!cur)return;const joined=plain(cur.parts.join(' '));const aa=stripAnswer(joined);if(aa.content.length>=8)out.push({...cur,content:aa.content,answer:aa.answer});cur=null;};
    for(const page of pages){
      const lines=splitLines(page.body_text);
      for(const line of lines){
        if(headingRe.test(line)){if(cur&&cur.parts.length)finish();continue;}
        const st=parseStart(line);
        if(st){finish();cur={taskNo:st.taskNo,numeric:st.numeric,strongNumber:st.strong,page_no:Number(page.page_no),ocrConfidence:Number(page.confidence)||0,parts:st.first?[st.first]:[]};continue;}
        if(cur){if(noiseRe.test(line)&&line.length<120)continue;cur.parts.push(line);}
      }
    }
    finish();
    for(let i=0;i<out.length;i++){const a=out[i-1]?.numeric,b=out[i].numeric,c=out[i+1]?.numeric;out[i].sequential=Number.isFinite(b)&&((Number.isFinite(a)&&b===a+1)||(Number.isFinite(c)&&c===b+1));}
    return out;
  }

  function chooseTopic(links,topics,pageNo){
    const candidates=[];
    for(const l of links){const a=Number(l.page_from),b=Number(l.page_to||l.page_from);if(!a||pageNo<a||pageNo>b)continue;const t=topics.get(String(l.topic_id));if(!t)continue;const span=Math.max(0,b-a),titleLen=String(t.title||'').length;candidates.push({link:l,topic:t,span,titleLen});}
    candidates.sort((x,y)=>x.span-y.span||y.titleLen-x.titleLen);return candidates[0]||null;
  }
  function sourceMaterialKind(src,book){return norm(`${src?.material_kind||''} ${src?.meta?.material_kind||''} ${book?.title||''}`)}
  function confidence(task,{src,book,topicMatch}){
    let s=.38;if(task.strongNumber)s+=.18;else s+=.07;
    if(/задачник|сборник|taskbook|collection/.test(sourceMaterialKind(src,book)))s+=.12;
    if(topicMatch)s+=.12;
    if(task.ocrConfidence>=.9)s+=.08;else if(task.ocrConfidence>=.75)s+=.04;
    const n=task.content.length;if(n>=30&&n<=700)s+=.08;else if(n>=15&&n<=1100)s+=.04;else if(n<15)s-=.35;else if(n>1800)s-=.18;
    if(instructionRe.test(task.content))s+=.08;if(task.sequential)s+=.07;if(noiseRe.test(task.content))s-=.35;if(/\.{4,}/.test(task.content))s-=.25;if(!topicMatch)s-=.12;
    return clamp(Math.round(s*1000)/1000);
  }
  function difficulty(src,content){const n=norm(`${src?.level||''} ${src?.meta?.level||''}`);if(/advanced|profile|углуб|профил/.test(n))return 'advanced';if(String(content||'').length<90&&/(вычисл|сравн|найдите значение)/i.test(content||''))return 'basic';return 'medium';}
  function fingerprint(content){return 'pdf-'+hash(norm(content).replace(/\s+/g,' '))}
  function shortSource(src,book){return plain(book?.title||src?.title||'PDF').slice(0,80)}

  async function loadPages(c,sourceId){
    const out=[];const chunk=500;
    for(let from=0;from<7000;from+=chunk){const {data,error}=await c.from('task_bank_ocr_pages').select('page_no,body_text,confidence,status').eq('source_id',sourceId).eq('status','done').order('page_no').range(from,from+chunk-1);if(error)throw error;const rows=data||[];out.push(...rows);if(rows.length<chunk)break;}
    return out;
  }
  async function existingFingerprints(c,teacherId){
    const out=new Set();
    for(let from=0;from<10000;from+=1000){const {data,error}=await c.from('exercises').select('content,tags').eq('teacher_id',teacherId).eq('kind','task').range(from,from+999);if(error)throw error;const rows=data||[];for(const r of rows){if((r.tags||[]).includes(IMPORT_TAG))out.add(fingerprint(r.content));}if(rows.length<1000)break;}
    return out;
  }
  async function candidateFingerprints(c,teacherId){const out=new Set();for(let from=0;from<10000;from+=1000){const {data,error}=await c.from('task_bank_import_candidates').select('fingerprint').eq('teacher_id',teacherId).range(from,from+999);if(error)throw error;const rows=data||[];rows.forEach(r=>out.add(r.fingerprint));if(rows.length<1000)break;}return out;}
  function exerciseBody(cand,teacherId){
    const tags=[IMPORT_TAG,`pdf:source:${cand.source_id}`,`pdf:page:${cand.page_no}`,`pdf:task:${cand.task_no||'?'}`];
    return {teacher_id:teacherId,topic_id:cand.topic_id,kind:'task',title:`№ ${cand.task_no||'—'} · ${cand.topic_title}`,content:cand.content,answer:cand.answer||'',difficulty:cand.difficulty||'medium',category:cand.topic_title,tags,generator_spec:JSON.stringify({type:'pdf_import',version:VERSION,source_id:cand.source_id,textbook_id:cand.textbook_id,page_no:cand.page_no,task_no:cand.task_no,confidence:cand.confidence,source_title:cand.source_title}),generator_answer:'',favorite:false};
  }
  async function insertExercise(c,cand,teacherId){const body=exerciseBody(cand,teacherId);const {data,error}=await c.from('exercises').insert(body).select().single();if(error)throw error;const {error:u}=await c.from('task_bank_import_candidates').update({status:'imported',exercise_id:data.id,updated_at:new Date().toISOString()}).eq('id',cand.id);if(u)console.warn(u);try{S().exercises?.push(data);}catch{}return data;}

  async function scanAndImport({auto=false,force=false,onProgress}={}){
    if(state.busy)return state.last;state.busy=true;
    try{
      const c=sb(),ss=S();if(!c||!ss?.user?.id)throw new Error('Кабинет преподавателя не готов');
      const rdy=await ready();state.ready=rdy;if(!rdy.ok){if(!auto)toast(rdy.reason);return {ready:false,reason:rdy.reason};}
      const teacherId=ss.user.id;
      const [{data:sources,error:se},{data:links,error:le}]=await Promise.all([
        c.from('task_bank_sources').select('id,title,subject,level,material_kind,ocr_status,ocr_pages_done,meta').eq('is_active',true),
        c.from('textbook_topic_links').select('textbook_id,topic_id,page_from,page_to,note').not('page_from','is',null)
      ]);if(se)throw se;if(le)throw le;
      const topics=new Map((ss.topics||[]).map(t=>[String(t.id),t]));const books=new Map((ss.textbooks||[]).map(b=>[String(b.id),b]));
      const linksByBook=new Map();for(const l of links||[]){const k=String(l.textbook_id);if(!linksByBook.has(k))linksByBook.set(k,[]);linksByBook.get(k).push(l);}
      const existing=await existingFingerprints(c,teacherId),candidateSeen=await candidateFingerprints(c,teacherId);
      let sourcesScanned=0,pagesScanned=0,parsed=0,autoImported=0,pending=0,duplicates=0,discarded=0;
      for(let si=0;si<(sources||[]).length;si++){
        const src=sources[si],bookId=String(src?.meta?.textbook_id||''),book=books.get(bookId);if(!book)continue;
        const bookLinks=linksByBook.get(bookId)||[];if(!bookLinks.length)continue;
        const done=Number(src.ocr_pages_done||0)||0,meta=src.meta||{};if(!force&&meta.task_import_version===VERSION&&Number(meta.task_import_pages_done||0)===done)continue;
        onProgress?.(`Разбираем задачи: ${shortSource(src,book)} (${si+1}/${sources.length})`);
        const pages=await loadPages(c,src.id);if(!pages.length)continue;sourcesScanned++;pagesScanned+=pages.length;
        const tasks=parseTasks(pages);parsed+=tasks.length;
        for(const task of tasks){
          const picked=chooseTopic(bookLinks,topics,task.page_no);if(!picked){discarded++;continue;}
          const conf=confidence(task,{src,book,topicMatch:picked});if(conf<REVIEW_THRESHOLD){discarded++;continue;}
          const fp=fingerprint(task.content);if(existing.has(fp)||candidateSeen.has(fp)){duplicates++;continue;}
          const topic=picked.topic;
          const cand={teacher_id:teacherId,source_id:src.id,textbook_id:book.id,topic_id:topic.id,grade:Number(topic.grade)||null,topic_title:topic.title,source_title:shortSource(src,book),page_no:task.page_no,task_no:String(task.taskNo||''),content:task.content,answer:task.answer||'',confidence:conf,difficulty:difficulty(src,task.content),fingerprint:fp,status:conf>=AUTO_THRESHOLD?'ready':'pending',meta:{version:VERSION,ocr_confidence:task.ocrConfidence,strong_number:task.strongNumber,sequential:task.sequential,section:topic.section||'',source_kind:src.material_kind||src.meta?.material_kind||''}};
          const {data:row,error:ie}=await c.from('task_bank_import_candidates').upsert(cand,{onConflict:'teacher_id,fingerprint'}).select().single();if(ie)throw ie;candidateSeen.add(fp);
          if(conf>=AUTO_THRESHOLD){await insertExercise(c,row,teacherId);existing.add(fp);autoImported++;}else pending++;
        }
        try{await c.from('task_bank_sources').update({meta:{...meta,task_import_version:VERSION,task_import_pages_done:done,task_import_at:new Date().toISOString()}}).eq('id',src.id);}catch{}
      }
      state.last={ready:true,sourcesScanned,pagesScanned,parsed,autoImported,pending,duplicates,discarded,version:VERSION};
      if(autoImported||pending)toast(`PDF → банк: добавлено ${autoImported}, на проверку ${pending}, дублей пропущено ${duplicates}.`);refreshCard();return state.last;
    }catch(e){console.error('[Mathroom 29.8 task import]',e);if(!auto)toast('Импорт задач: '+String(e?.message||e));state.last={error:String(e?.message||e)};return state.last;}
    finally{state.busy=false;}
  }

  async function stats(){
    const c=sb(),teacherId=S()?.user?.id;if(!c||!teacherId)return null;const rdy=await ready();state.ready=rdy;if(!rdy.ok)return {ready:false,reason:rdy.reason};
    const statuses=['pending','ready','imported','rejected'],out={ready:true};for(const st of statuses){const {count,error}=await c.from('task_bank_import_candidates').select('*',{count:'exact',head:true}).eq('teacher_id',teacherId).eq('status',st);if(error)throw error;out[st]=count||0;}return out;
  }
  async function approve(id){const c=sb(),teacherId=S()?.user?.id;if(!c||!teacherId)return;const {data,error}=await c.from('task_bank_import_candidates').select('*').eq('id',id).single();if(error)throw error;await insertExercise(c,data,teacherId);return true;}
  async function reject(id){const c=sb();if(!c)return;const {error}=await c.from('task_bank_import_candidates').update({status:'rejected',updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;return true;}
  async function reviewModal(){
    const c=sb(),teacherId=S()?.user?.id;if(!c||!teacherId)return;const {data,error}=await c.from('task_bank_import_candidates').select('*').eq('teacher_id',teacherId).eq('status','pending').order('confidence',{ascending:false}).limit(120);if(error)throw error;
    const rows=data||[],modal=MR().modal;if(!modal)return;
    modal(`<h2>Задачи из PDF · на проверку</h2><p class="muted">Сомнительные распознавания не попадают в банк автоматически. Подтверди задачу или отклони её.</p><div class="list">${rows.length?rows.map(x=>`<div class="row" data-pdf-candidate="${x.id}"><div style="min-width:0"><div class="actions"><span class="pill">${x.grade||'?'} кл.</span><span class="pill">${escapeHtml(x.topic_title)}</span><span class="pill">${Math.round(Number(x.confidence||0)*100)}%</span></div><h3>№ ${escapeHtml(x.task_no||'—')} · ${escapeHtml(x.source_title)}</h3><div class="prewrap">${escapeHtml(x.content)}</div><p class="muted">PDF стр. ${x.page_no}${x.answer?` · Ответ: ${escapeHtml(x.answer)}`:''}</p></div><div class="actions"><button class="btn sm primary" data-pdf-approve="${x.id}">В банк</button><button class="btn sm danger" data-pdf-reject="${x.id}">Отклонить</button></div></div>`).join(''):'<div class="empty">Очередь проверки пуста.</div>'}</div>`,'wide-modal');
    setTimeout(()=>{document.querySelectorAll('[data-pdf-approve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await approve(b.dataset.pdfApprove);b.closest('[data-pdf-candidate]')?.remove();refreshCard();}catch(e){toast(String(e.message||e));b.disabled=false;}});document.querySelectorAll('[data-pdf-reject]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await reject(b.dataset.pdfReject);b.closest('[data-pdf-candidate]')?.remove();refreshCard();}catch(e){toast(String(e.message||e));b.disabled=false;}});},0);
  }

  async function refreshCard(){
    const host=document.getElementById('pdfTaskImportCard');if(!host)return;let st;try{st=await stats();}catch(e){st={ready:false,reason:String(e.message||e)}}
    if(!st?.ready){host.innerHTML=`<div><b>Задачи из PDF</b><div class="small muted">${escapeHtml(st?.reason||'Модуль ожидает настройку')}</div></div><div class="actions"><span class="pill">v29.8</span></div>`;return;}
    host.innerHTML=`<div><b>Задачи из PDF</b><div class="small muted">Высокая уверенность → сразу в банк; сомнительные → на проверку.</div></div><div class="actions"><span class="pill">Импортировано ${st.imported||0}</span><span class="pill">На проверку ${st.pending||0}</span><button class="btn sm" id="pdfTaskScan">Сканировать библиотеку</button><button class="btn sm" id="pdfTaskReview" ${st.pending?'':'disabled'}>Проверить</button></div>`;
    document.getElementById('pdfTaskScan').onclick=()=>scanAndImport({force:true,onProgress:m=>toast(m)});document.getElementById('pdfTaskReview').onclick=()=>reviewModal();
  }
  function mountCard(){const list=document.getElementById('bankList');if(!list||document.getElementById('pdfTaskImportCard'))return;const card=document.createElement('div');card.id='pdfTaskImportCard';card.className='notice';card.style.cssText='margin:0 0 12px;display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap';list.parentNode.insertBefore(card,list);refreshCard();}
  const mo=new MutationObserver(()=>mountCard());mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(mountCard,500);

  const syncObserver=new MutationObserver(()=>{if(state.autoStarted||state.busy)return;const txt=document.body?.innerText||'';if(/Синхронизация завершена/.test(txt)&&/Все \d+ автоматических связей имеют точные страницы PDF/.test(txt)){state.autoStarted=true;setTimeout(()=>scanAndImport({auto:true}).finally(()=>setTimeout(()=>{state.autoStarted=false},5000)),900);}});
  syncObserver.observe(document.documentElement,{childList:true,subtree:true,characterData:true});

  window.MathroomTaskImportV298={VERSION,state,ready,scanAndImport,stats,reviewModal,approve,reject,parseTasks};
})();
