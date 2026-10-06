/* Mathroom v30.3 — XLSX -> canonical exercise bank import
 * Imports the READY sheet directly into public.exercises so uploaded tasks
 * immediately become part of the same bank used by assignments and lessons.
 */
(function(){
  'use strict';
  const VERSION='30.3';
  const IMPORT_TAG='mathroom-xlsx-57-school-v1';
  let importing=false;

  const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
  const lower=s=>norm(s).toLocaleLowerCase('ru-RU');
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const num=(v,d=null)=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:d};

  function toast(text,ms=4200){
    const el=document.getElementById('toast');
    if(el){ el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),ms); }
    else console.log('[Task XLSX]',text);
  }

  function client(){
    const c=[window.MR?.sb,window.Mathroom?.supabase,window.supabaseClient,window.sb,window._supabase,window.appSupabase]
      .find(x=>x&&typeof x.from==='function');
    if(!c) throw new Error('Supabase не инициализирован. Обновите страницу и попробуйте снова.');
    return c;
  }

  function state(){ return window.MR?.S||null; }

  async function teacherId(sb){
    const cached=state()?.user?.id;
    if(cached)return cached;
    const {data,error}=await sb.auth.getUser();
    if(error)throw error;
    if(!data?.user?.id)throw new Error('Не удалось определить преподавателя. Войдите в аккаунт заново.');
    return data.user.id;
  }

  async function loadXlsx(){
    if(window.XLSX) return window.XLSX;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload=resolve; s.onerror=()=>reject(new Error('Не удалось загрузить модуль XLSX'));
      document.head.appendChild(s);
    });
    return window.XLSX;
  }

  function val(row,...keys){
    for(const k of keys){
      const v=row?.[k];
      if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;
    }
    return '';
  }

  function difficultyOf(raw,score){
    const s=lower(raw);
    if(['easy','basic','базовая','базовый','легкая','лёгкая','легкий','лёгкий'].includes(s))return 'basic';
    if(['medium','средняя','средний'].includes(s))return 'medium';
    if(['hard','advanced','сложная','сложный','повышенная','повышенный'].includes(s))return 'advanced';
    const n=clamp(Math.round(num(score,5)),1,10);
    return n<=3?'basic':n<=7?'medium':'advanced';
  }

  function normalizeRow(row){
    const taskId=norm(val(row,'task_id','Task ID','id'));
    const grade=Math.round(num(val(row,'grade','Класс','класс'),0));
    const topic=norm(val(row,'topic','Тема','тема'));
    const text=norm(val(row,'task_text','Задание','Условие','condition','body_text'));
    const answer=norm(val(row,'answer','Ответ','ответ'));
    const source=norm(val(row,'source','Источник','источник'));
    const sourceFile=norm(val(row,'source_file','Файл','source file'));
    const page=Math.max(1,Math.round(num(val(row,'pdf_page','PDF page','Страница PDF','source_page'),1)));
    const bookPage=Math.max(0,Math.round(num(val(row,'book_page','Страница книги'),0)));
    const ex=norm(val(row,'exercise_no','Номер задания','exercise'));
    const sub=norm(val(row,'subtask','Подпункт'));
    const group=norm(val(row,'group_id','Группа','test_group'));
    const taskType=norm(val(row,'task_type','Тип задания','type'))||'exercise';
    const rawDifficulty=norm(val(row,'difficulty','Сложность'));
    const score=clamp(Math.round(num(val(row,'difficulty_score','Сложность 1-10','difficulty_score_1_10'),5)),1,10);
    const confidence=clamp(num(val(row,'confidence','Уверенность'),0.95),0,1);
    const note=norm(val(row,'verification_note','Комментарий проверки'));
    const independentRaw=lower(val(row,'independent','Независимый подпункт'));
    const independent=['true','1','да','yes'].includes(independentRaw);
    return {taskId,grade,topic,text,answer,source,sourceFile,page,bookPage,ex,sub,group,taskType,rawDifficulty,score,confidence,note,independent};
  }

  async function fetchAllTopics(sb,uid){
    const out=[];
    for(let from=0;from<10000;from+=1000){
      const {data,error}=await sb.from('topics').select('id,teacher_id,grade,section,title').eq('teacher_id',uid).order('created_at').range(from,from+999);
      if(error)throw error;
      const rows=data||[];out.push(...rows);if(rows.length<1000)break;
    }
    return out;
  }

  const topicKey=(grade,title)=>`${Number(grade)}|${lower(title)}`;

  async function ensureTopics(sb,uid,rows,onStatus){
    const topics=await fetchAllTopics(sb,uid);
    const map=new Map(topics.map(t=>[topicKey(t.grade,t.title),t]));
    const missing=[];
    const seen=new Set();
    for(const r of rows){
      const k=topicKey(r.grade,r.topic);
      if(map.has(k)||seen.has(k))continue;
      seen.add(k);
      missing.push({teacher_id:uid,grade:r.grade,section:'Задачник 57 школы',title:r.topic,theory:''});
    }
    let added=0;
    for(let i=0;i<missing.length;i+=100){
      onStatus?.(`Создаём темы ${Math.min(i+100,missing.length)}/${missing.length}…`);
      const {data,error}=await sb.from('topics').insert(missing.slice(i,i+100)).select('id,teacher_id,grade,section,title');
      if(error)throw error;
      for(const t of (data||[])){map.set(topicKey(t.grade,t.title),t);added++;}
    }
    return {map,added};
  }

  async function fetchImportedTaskIds(sb,uid){
    const ids=new Set();
    for(let from=0;from<30000;from+=1000){
      const {data,error}=await sb.from('exercises')
        .select('id,generator_spec')
        .eq('teacher_id',uid)
        .contains('tags',[IMPORT_TAG])
        .order('created_at')
        .range(from,from+999);
      if(error)throw error;
      const rows=data||[];
      for(const row of rows){
        try{
          const meta=JSON.parse(row.generator_spec||'{}');
          if(meta?.task_id)ids.add(String(meta.task_id));
        }catch{}
      }
      if(rows.length<1000)break;
    }
    return ids;
  }

  function exerciseTitle(r){
    const no=[r.ex,r.sub].filter(Boolean).join(' ');
    return no?`№ ${no} · ${r.topic}`:`Задача · ${r.topic}`;
  }

  function exerciseRow(uid,topic,r){
    return {
      teacher_id:uid,
      topic_id:topic.id,
      kind:'task',
      title:exerciseTitle(r),
      content:r.text,
      answer:r.answer||'',
      difficulty:difficultyOf(r.rawDifficulty,r.score),
      category:r.topic,
      tags:[IMPORT_TAG,`класс-${r.grade}`,`тема:${r.topic}`],
      generator_spec:JSON.stringify({
        type:'xlsx_import',version:VERSION,task_id:r.taskId,group_id:r.group||null,
        source:r.source||null,source_file:r.sourceFile||null,pdf_page:r.page||null,
        book_page:r.bookPage||null,exercise_no:r.ex||null,subtask:r.sub||null,
        task_type:r.taskType,difficulty_score:r.score,confidence:r.confidence,
        independent:r.independent,verification_note:r.note||null
      }),
      generator_answer:'',
      favorite:false
    };
  }

  async function importRows(rows,onProgress,onStatus){
    const sb=client();
    const uid=await teacherId(sb);
    const clean=rows.map(normalizeRow).filter(r=>r.taskId&&r.grade>=1&&r.grade<=11&&r.topic&&r.text);
    if(!clean.length)throw new Error('В листе READY нет подходящих строк. Нужны task_id, grade, topic и task_text.');

    onStatus?.(`Проверяем ${clean.length} задач…`);
    const existingIds=await fetchImportedTaskIds(sb,uid);
    const pending=clean.filter(r=>!existingIds.has(r.taskId));
    const skipped=clean.length-pending.length;
    if(!pending.length)return {processed:clean.length,added:0,skipped,topicsAdded:0};

    const {map:topicMap,added:topicsAdded}=await ensureTopics(sb,uid,pending,onStatus);
    const payload=[];
    for(const r of pending){
      const topic=topicMap.get(topicKey(r.grade,r.topic));
      if(!topic)throw new Error(`Не удалось создать тему: ${r.grade} класс · ${r.topic}`);
      payload.push(exerciseRow(uid,topic,r));
    }

    let done=0,added=0;
    for(let i=0;i<payload.length;i+=150){
      const part=payload.slice(i,i+150);
      const {data,error}=await sb.from('exercises').insert(part).select('id');
      if(error)throw error;
      added+=data?.length||part.length;
      done+=part.length;
      onProgress?.({done,total:payload.length,added,skipped});
    }
    return {processed:clean.length,added,skipped,topicsAdded};
  }

  async function chooseAndImport(input,button,status){
    const file=input.files?.[0];if(!file)return;
    importing=true;button.disabled=true;
    try{
      status.textContent='Читаем таблицу…';
      const XLSX=await loadXlsx();
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const sheetName=wb.SheetNames.includes('READY')?'READY':wb.SheetNames[0];
      if(!sheetName)throw new Error('В файле нет листов');
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''});
      status.textContent=`Найдено строк: ${rows.length}. Проверяем банк…`;
      const result=await importRows(
        rows,
        p=>{status.textContent=`Импорт ${p.done}/${p.total} · добавлено ${p.added}${p.skipped?` · уже было ${p.skipped}`:''}`},
        text=>{status.textContent=text}
      );
      status.textContent=`Готово: обработано ${result.processed}, добавлено ${result.added}, уже было ${result.skipped}${result.topicsAdded?`, новых тем ${result.topicsAdded}`:''}.`;
      toast(`Импорт завершён: новых задач ${result.added}, уже было ${result.skipped}.`,7000);
      try{await window.MathroomBankAllExercisesV2982?.hydrate?.({rerender:true,force:true});}catch{}
      setTimeout(()=>location.reload(),1600);
    }catch(e){
      console.error('[Task XLSX import]',e);
      const msg=e?.message||String(e);
      status.textContent='Ошибка: '+msg;
      toast('Ошибка импорта: '+msg,9000);
    }finally{
      importing=false;button.disabled=false;input.value='';
    }
  }

  function findPdfPanel(){
    const nodes=[...document.querySelectorAll('h1,h2,h3,h4,b,strong,div,span')].filter(el=>norm(el.textContent)==='Задачи из PDF');
    for(const h of nodes){
      let p=h;
      for(let i=0;i<6&&p;i++,p=p.parentElement){
        const txt=norm(p.textContent),buttons=p.querySelectorAll?.('button')?.length||0;
        if(buttons>=1&&txt.includes('Сканировать библиотеку'))return p;
      }
    }
    return null;
  }

  function mount(){
    let panel=findPdfPanel()||document.getElementById('pdfTaskImportCard');
    if(!panel){
      const list=document.getElementById('bankList');if(!list)return;
      panel=document.createElement('div');panel.id='pdfTaskImportCard';panel.className='notice';panel.style.cssText='margin:0 0 12px;';
      list.parentNode.insertBefore(panel,list);
    }
    if(panel.dataset.xlsxImportV303==='1'&&panel.querySelector('[data-xlsx-button]'))return;
    panel.dataset.xlsxImportV303='1';
    panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap">
        <div>
          <h3 style="margin:0 0 6px">Импорт задач</h3>
          <div class="muted" style="font-size:14px">Загрузите подготовленный XLSX. Лист <b>READY</b> попадёт прямо в основной банк задач.</div>
          <div data-xlsx-status class="muted" style="font-size:13px;margin-top:6px"></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input data-xlsx-input type="file" accept=".xlsx,.xls" hidden>
          <button data-xlsx-button class="btn primary" type="button">Загрузить файл с задачами</button>
        </div>
      </div>`;
    const input=panel.querySelector('[data-xlsx-input]'),button=panel.querySelector('[data-xlsx-button]'),status=panel.querySelector('[data-xlsx-status]');
    button.addEventListener('click',()=>{if(!importing)input.click()});
    input.addEventListener('change',()=>chooseAndImport(input,button,status));
  }

  const obs=new MutationObserver(()=>mount());
  obs.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  setInterval(mount,1200);
  window.MathroomTaskXlsxImport={version:VERSION,mount,importRows};
})();
