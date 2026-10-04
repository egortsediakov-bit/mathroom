/* Mathroom v29.8.6 — robust task parser for flattened OCR/text layers. */
(() => {
  'use strict';
  const api=window.MathroomTaskImportV298;
  if(!api){console.warn('[Mathroom 29.8.6] base task import module missing');return;}
  if(api.__parserFix2986)return;

  const VERSION='29.8.6';
  const AUTO_THRESHOLD=.82;
  const REVIEW_THRESHOLD=.58;
  const MR=()=>window.MR||{};
  const S=()=>MR().S||{};
  const sb=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const toast=m=>{try{MR().toast?.(m)}catch{};console.log('[Mathroom PDF tasks 29.8.6]',m)};
  const plain=s=>String(s||'').replace(/\u00ad/g,'').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').trim();
  const norm=s=>plain(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const clamp=n=>Math.max(0,Math.min(1,n));
  const hash=s=>{let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h.toString(36)};
  const fingerprint=s=>'pdf-'+hash(norm(s));
  const basename=s=>norm(String(s||'').split('/').pop()?.replace(/\.pdf$/i,'')||'');
  const tokenSet=s=>new Set(norm(s).split(' ').filter(x=>x.length>=2));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const noise=/(?:содержание|оглавление|предисловие|предметный указатель|учебное издание|isbn|удк|ббк|издательств|список литературы)/i;
  const answerPage=/(?:^|\n)\s*(?:ответы|ответы к упражнениям)\b/i;
  const instruction=/(?:реш(?:и|ите|ить)|найд(?:и|ите|ти)|вычисл(?:и|ите|ить)|докаж(?:и|ите|ать)|постро(?:й|йте|ить)|сравн(?:и|ите|ить)|упрост(?:и|ите|ить)|разлож(?:и|ите|ить)|представ(?:ьте|ить)|определ(?:ите|ить)|исслед(?:уйте|овать)|состав(?:ьте|ить)|запиш(?:и|ите)|сколько|чему\s+рав|если\s|при\s|вероятност|площад|периметр|объ[её]м|угол|корн|уравнен|неравен|функц|процент|скорост|расстояни|врем|=|\?|√|\^|\+|−|-|:)/i;
  const obviousTaskLead=/^(?:реш|найд|вычисл|докаж|постро|сравн|упрост|разлож|представ|определ|исслед|состав|запиш|сколько|из\s|на\s|в\s|прямоугольник|треугольник|окружност|автомоб|поезд|рабоч|ученик|школ|магазин|турист)/i;

  function sourceBookScore(src,book){
    const sm=src?.meta||{};
    if(sm.textbook_id&&String(sm.textbook_id)===String(book.id))return 1000;
    const sp=String(sm.file_path||sm.storage_path||sm.path||'');
    if(sp&&book.file_path&&sp===book.file_path)return 900;
    const st=norm(src?.title),bt=norm(book?.title),sf=basename(src?.title),bf=basename(book?.file_path||book?.title);
    if(st&&bt&&st===bt)return 800;if(sf&&bf&&sf===bf)return 780;
    let score=0;
    if(st&&bt&&(st.includes(bt)||bt.includes(st))&&Math.min(st.length,bt.length)>=7)score+=55;
    if(sf&&bf&&(sf.includes(bf)||bf.includes(sf))&&Math.min(sf.length,bf.length)>=7)score+=55;
    const a=tokenSet(`${src?.title||''} ${sm.author||''}`),b=tokenSet(`${book?.title||''} ${book?.author||''}`);
    if(a.size&&b.size){let common=0;for(const x of a)if(b.has(x))common++;score+=45*common/Math.max(1,Math.min(a.size,b.size));}
    const sg=Number(sm.grade||src?.grade||0),bg=Number(book?.grade_from||book?.grade||0);if(sg&&bg&&sg===bg)score+=8;
    return score;
  }
  function matchSourceToBook(src,books){let best=null,bestScore=0;for(const book of books){const score=sourceBookScore(src,book);if(score>bestScore){best=book;bestScore=score}}return bestScore>=25?{book:best,score:bestScore}:null;}

  function numericPart(taskNo){const m=String(taskNo||'').match(/(\d+)(?!.*\d)/);return m?Number(m[1]):NaN;}
  function collectMarkers(body){
    const hits=[];
    const add=(re,strong=false,noDot=false)=>{let m;while((m=re.exec(body))){const lead=m[1]||'',taskNo=m[2]||m[1],whole=m[0];let start=m.index+(lead?lead.length:0);let end=m.index+whole.length;hits.push({start,end,taskNo,strong,noDot});if(re.lastIndex===m.index)re.lastIndex++;}};
    // № 123., 123., 1.127., 5.24. — including markers in flattened one-line PDF text.
    add(/(^|[\n\r\s])(?:№\s*)?((?:\d{1,2}\.)?\d{1,4}[а-яa-z]?)\s*[.)]\s+(?=[А-ЯЁA-Zа-яёa-z0-9(])/gim,false,false);
    // Some primary-school books print a task number without a dot: "164 Игра...".
    let m;const re2=/(^|\n)\s*(\d{2,4})\s+([^\n]{3,120})/gim;
    while((m=re2.exec(body))){if(!obviousTaskLead.test(plain(m[3])))continue;hits.push({start:m.index+(m[1]?m[1].length:0),end:m.index+m[0].length-String(m[3]).length,taskNo:m[2],strong:false,noDot:true});if(re2.lastIndex===m.index)re2.lastIndex++;}
    hits.sort((a,b)=>a.start-b.start||b.end-a.end);
    const out=[];for(const h of hits){if(out.length&&Math.abs(out[out.length-1].start-h.start)<3)continue;out.push(h);}return out;
  }
  function cleanTaskText(text){
    let s=plain(text).replace(/\s+(?:Глава|§)\s+\d+.*$/i,'').trim();
    s=s.replace(/^[-–—•·]+\s*/,'').trim();
    return s.slice(0,1800);
  }
  function parsePages(pages){
    const out=[];
    for(const page of pages){
      const body=String(page.body_text||'').replace(/\u00ad/g,'');
      if(!body.trim()||answerPage.test(body)||/^\s*(?:содержание|оглавление)\b/i.test(body))continue;
      const markers=collectMarkers(body);
      for(let i=0;i<markers.length;i++){
        const h=markers[i],next=markers[i+1];
        const content=cleanTaskText(body.slice(h.end,next?next.start:body.length));
        if(content.length<8||noise.test(content.slice(0,160)))continue;
        const n=numericPart(h.taskNo);if(!Number.isFinite(n)||n<1||n>5000)continue;
        out.push({taskNo:String(h.taskNo),numeric:n,content,answer:'',page_no:Number(page.page_no),ocrConfidence:Number(page.confidence)||0,strong:h.strong||String(h.taskNo).includes('.'),noDot:h.noDot});
      }
    }
    for(let i=0;i<out.length;i++){
      const a=out[i-1],b=out[i],c=out[i+1];
      b.sequential=!!((a&&a.page_no===b.page_no&&b.numeric===a.numeric+1)||(c&&c.page_no===b.page_no&&c.numeric===b.numeric+1));
    }
    return out;
  }
  function chooseTopic(links,topics,page){const a=[];for(const l of links){const f=Number(l.page_from),t=Number(l.page_to||l.page_from);if(!f||page<f||page>t)continue;const topic=topics.get(String(l.topic_id));if(topic)a.push({topic,span:Math.max(0,t-f),titleLen:String(topic.title||'').length});}a.sort((x,y)=>x.span-y.span||y.titleLen-x.titleLen);return a[0]?.topic||null;}
  function material(src,book){return norm(`${src?.material_kind||''} ${src?.meta?.material_kind||''} ${book?.title||''}`)}
  function score(task,src,book,topic){
    let s=.40;s+=task.strong?.13:.06;
    if(/задачник|сборник|taskbook|collection/.test(material(src,book)))s+=.13;
    if(topic)s+=.12;
    if(task.ocrConfidence>=.9)s+=.07;else if(task.ocrConfidence>=.7)s+=.03;
    const n=task.content.length;if(n>=20&&n<=800)s+=.08;else if(n>=10&&n<=1300)s+=.03;else if(n<10)s-=.3;else if(n>1800)s-=.18;
    if(instruction.test(task.content))s+=.10;if(task.sequential)s+=.08;if(noise.test(task.content))s-=.35;if(/\.{5,}/.test(task.content))s-=.2;if(!topic)s-=.15;
    return Math.round(clamp(s)*1000)/1000;
  }
  function difficulty(src,content){const x=norm(`${src?.level||''} ${src?.meta?.level||''}`);if(/advanced|profile|углуб|профил/.test(x))return'advanced';if(String(content).length<100&&/(вычисл|сравн|найдите значение)/i.test(content))return'basic';return'medium';}
  function sourceTitle(src,book){return plain(book?.title||src?.title||'PDF').slice(0,100)}
  async function loadPages(c,id){const out=[];for(let from=0;from<7000;from+=500){const {data,error}=await c.from('task_bank_ocr_pages').select('page_no,body_text,confidence,status').eq('source_id',id).eq('status','done').order('page_no').range(from,from+499);if(error)throw error;const rows=data||[];out.push(...rows);if(rows.length<500)break;}return out;}
  async function knownFingerprints(c,uid){const out=new Set((S().exercises||[]).filter(x=>x.kind==='task').map(x=>fingerprint(x.content)));for(let from=0;from<20000;from+=1000){const {data,error}=await c.from('task_bank_import_candidates').select('fingerprint').eq('teacher_id',uid).range(from,from+999);if(error)throw error;const rows=data||[];rows.forEach(r=>out.add(r.fingerprint));if(rows.length<1000)break;}return out;}
  async function upsertCandidates(c,rows){const out=[];for(let i=0;i<rows.length;i+=200){const {data,error}=await c.from('task_bank_import_candidates').upsert(rows.slice(i,i+200),{onConflict:'teacher_id,fingerprint'}).select();if(error)throw error;out.push(...(data||[]));}return out;}
  async function importIds(c,ids){let n=0;for(let i=0;i<ids.length;i+=250){const {data,error}=await c.rpc('mathroom_import_task_candidates',{p_ids:ids.slice(i,i+250)});if(error)throw error;n+=Number(data)||0;}return n;}

  async function scanAndImport({force=false,onProgress}={}){
    if(api.state?.busy)return api.state.last;
    api.state.busy=true;
    try{
      const c=sb(),ss=S(),check=await api.ready();api.state.ready=check;if(!check?.ok){toast(check?.reason||'Модуль не готов');return {ready:false,reason:check?.reason};}
      const uid=check.teacherId;
      const [{data:sources,error:se},{data:links,error:le}]=await Promise.all([
        c.from('task_bank_sources').select('id,title,subject,level,material_kind,ocr_status,ocr_pages_done,meta').eq('is_active',true),
        c.from('textbook_topic_links').select('textbook_id,topic_id,page_from,page_to,note').not('page_from','is',null)
      ]);if(se)throw se;if(le)throw le;
      const topics=new Map((ss.topics||[]).map(t=>[String(t.id),t])),books=ss.textbooks||[],byBook=new Map();
      for(const l of links||[]){const k=String(l.textbook_id);if(!byBook.has(k))byBook.set(k,[]);byBook.get(k).push(l);}
      const known=await knownFingerprints(c,uid);
      let sourcesTotal=(sources||[]).length,sourcesMatched=0,sourcesWithPages=0,sourcesScanned=0,pagesScanned=0,parsed=0,withTopic=0,autoImported=0,pending=0,duplicates=0,discarded=0,queued=0;
      for(let si=0;si<(sources||[]).length;si++){
        const src=sources[si],matched=matchSourceToBook(src,books);if(!matched)continue;
        const book=matched.book,bookLinks=byBook.get(String(book.id))||[];if(!bookLinks.length)continue;sourcesMatched++;
        const pages=await loadPages(c,src.id);
        if(!pages.length){if(!['pending','processing'].includes(String(src.ocr_status||''))){const {error}=await c.from('task_bank_sources').update({ocr_status:'pending',ocr_error:null,meta:{...(src.meta||{}),task_import_full_scan:true,task_import_requested_at:new Date().toISOString()}}).eq('id',src.id);if(!error)queued++;}continue;}
        sourcesWithPages++;sourcesScanned++;pagesScanned+=pages.length;onProgress?.(`PDF → задачи: ${sourceTitle(src,book)} (${si+1}/${sources.length})`);
        const tasks=parsePages(pages);parsed+=tasks.length;const candidates=[];
        for(const task of tasks){const topic=chooseTopic(bookLinks,topics,task.page_no);if(!topic){discarded++;continue;}withTopic++;const conf=score(task,src,book,topic);if(conf<REVIEW_THRESHOLD){discarded++;continue;}const fp=fingerprint(task.content);if(known.has(fp)){duplicates++;continue;}known.add(fp);candidates.push({teacher_id:uid,source_id:src.id,textbook_id:book.id,topic_id:topic.id,grade:Number(topic.grade)||null,topic_title:topic.title,source_title:sourceTitle(src,book),page_no:task.page_no,task_no:String(task.taskNo||''),content:task.content,answer:task.answer||'',confidence:conf,difficulty:difficulty(src,task.content),fingerprint:fp,status:conf>=AUTO_THRESHOLD?'ready':'pending',meta:{version:VERSION,ocr_confidence:task.ocrConfidence,sequential:task.sequential,section:topic.section||'',source_kind:src.material_kind||src.meta?.material_kind||''}});}
        if(candidates.length){const saved=await upsertCandidates(c,candidates),autoIds=saved.filter(x=>Number(x.confidence)>=AUTO_THRESHOLD&&x.status!=='imported'&&x.status!=='rejected').map(x=>x.id);pending+=saved.filter(x=>x.status==='pending').length;if(autoIds.length)autoImported+=await importIds(c,autoIds);}
        const meta={...(src.meta||{}),textbook_id:book.id,task_import_version:VERSION,task_import_pages_done:pages.length,task_import_at:new Date().toISOString()};
        // 87 pages across 24 sources is clearly a partial index. Requeue sparse sources so the VPS worker can continue through the PDF.
        if(pages.length<Math.max(12,Number(src.ocr_pages_done||0))&&!['pending','processing'].includes(String(src.ocr_status||''))){meta.task_import_full_scan=true;const {error}=await c.from('task_bank_sources').update({ocr_status:'pending',ocr_error:null,meta}).eq('id',src.id);if(!error)queued++;}else{await c.from('task_bank_sources').update({meta}).eq('id',src.id);}
        await new Promise(r=>setTimeout(r,0));
      }
      api.state.last={ready:true,sourcesTotal,sourcesMatched,sourcesWithPages,sourcesScanned,pagesScanned,parsed,withTopic,autoImported,pending,duplicates,discarded,queued,version:VERSION};
      toast(`PDF → банк: найдено ${parsed}, добавлено ${autoImported}, на проверку ${pending}, дублей ${duplicates}${queued?`, в OCR-очередь ${queued}`:''}.`);
      window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});
      return api.state.last;
    }catch(e){console.error('[Mathroom 29.8.6 task import]',e);toast('Импорт PDF: '+String(e?.message||e));api.state.last={error:String(e?.message||e),version:VERSION};return api.state.last;}finally{api.state.busy=false;}
  }

  api.scanAndImport=scanAndImport;
  api.parsePages=parsePages;
  api.VERSION=VERSION;
  api.__parserFix2986=true;
  setTimeout(()=>window.MathroomTaskImportUIV2983?.render?.(true),100);
})();
