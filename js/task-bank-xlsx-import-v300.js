/* Mathroom v30.0 — XLSX task bank import
 * Replaces legacy "Задачи из PDF" scanning controls with one XLSX importer.
 * Expected sheet: READY (falls back to first sheet).
 */
(function(){
  'use strict';
  const VERSION='30.0';
  let importing=false;

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const num=(v,d=null)=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:d};

  function toast(text,ms=4200){
    const el=document.getElementById('toast');
    if(el){ el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),ms); }
    else console.log('[Task XLSX]',text);
  }

  function client(){
    const c=[window.Mathroom?.supabase,window.supabaseClient,window.sb,window._supabase,window.appSupabase]
      .find(x=>x&&typeof x.from==='function');
    if(!c) throw new Error('Supabase client не найден');
    return c;
  }

  async function sha256(text){
    const bytes=new TextEncoder().encode(norm(text).toLowerCase());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
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
    for(const k of keys) if(row[k]!==undefined && row[k]!==null && String(row[k]).trim()!=='') return row[k];
    return '';
  }

  function normalizeRow(row){
    const grade=num(val(row,'grade','Класс','класс'));
    const topic=norm(val(row,'topic','Тема','тема'));
    const text=norm(val(row,'task_text','Задание','Условие','condition','body_text'));
    const source=norm(val(row,'source','Источник','источник')) || `Импорт XLSX ${new Date().toLocaleDateString('ru-RU')}`;
    const page=Math.max(1,Math.round(num(val(row,'pdf_page','PDF page','Страница PDF','source_page'),1)));
    const ex=norm(val(row,'exercise_no','Номер задания','exercise'));
    const sub=norm(val(row,'subtask','Подпункт'));
    const score=clamp(Math.round(num(val(row,'difficulty_score','Сложность 1-10','difficulty_score_1_10'),5)),1,10);
    const confidence=clamp(num(val(row,'confidence','Уверенность'),0.95),0,1);
    const ttype=norm(val(row,'task_type','Тип задания','type')) || 'exercise';
    const group=norm(val(row,'group_id','Группа','test_group'));
    const independent=String(val(row,'independent','Независимый подпункт')).toLowerCase();
    return {grade,topic,text,source,page,ex,sub,score,confidence,ttype,group,independent:independent==='true'||independent==='1'||independent==='да'};
  }

  async function upsertSource(sb,source,grade){
    const external_key=`xlsx:${grade}:${source}`.toLowerCase().replace(/\s+/g,' ').slice(0,240);
    const payload={external_key,title:source,grade,source_kind:'manual',meta:{importer:'xlsx-v30.0'}};
    const {data,error}=await sb.from('task_bank_sources').upsert(payload,{onConflict:'external_key'}).select('id,title,grade').single();
    if(error) throw error;
    return data;
  }

  async function importRows(rows,onProgress){
    const sb=client();
    const clean=rows.map(normalizeRow).filter(r=>r.grade>=1&&r.grade<=11&&r.topic&&r.text);
    if(!clean.length) throw new Error('В листе READY нет подходящих строк. Нужны grade, topic и task_text.');

    const groups=new Map();
    clean.forEach(r=>{const k=`${r.grade}|${r.source}`; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(r)});
    let done=0, added=0;
    for(const [key,list] of groups){
      const source=await upsertSource(sb,list[0].source,list[0].grade);
      const batch=[];
      for(const r of list){
        const no=[r.ex,r.sub].filter(Boolean).join('-') || null;
        const hash=await sha256(`${source.id}|${r.page}|${no||''}|${r.text}`);
        batch.push({
          source_id:source.id,
          source_page:r.page,
          exercise_no:no,
          grade:r.grade,
          topic_title:r.topic,
          body_text:r.text,
          body_hash:hash,
          task_type:r.ttype,
          difficulty:clamp(Math.ceil(r.score/2),1,5),
          confidence:r.confidence,
          verified:r.confidence>=0.90,
          status:'active',
          meta:{
            importer:'xlsx-v30.0',
            difficulty_score_10:r.score,
            group_id:r.group||null,
            subtask:r.sub||null,
            independent:r.independent
          }
        });
      }
      for(let i=0;i<batch.length;i+=200){
        const part=batch.slice(i,i+200);
        const {data,error}=await sb.from('task_bank_items')
          .upsert(part,{onConflict:'source_id,source_page,exercise_no,body_hash',ignoreDuplicates:true})
          .select('id');
        if(error) throw error;
        added+=data?.length||0;
        done+=part.length;
        onProgress?.({done,total:clean.length,added});
      }
    }
    return {processed:clean.length,added};
  }

  async function chooseAndImport(input,button,status){
    const file=input.files?.[0]; if(!file) return;
    importing=true; button.disabled=true;
    try{
      status.textContent='Читаем таблицу…';
      const XLSX=await loadXlsx();
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const sheetName=wb.SheetNames.includes('READY')?'READY':wb.SheetNames[0];
      if(!sheetName) throw new Error('В файле нет листов');
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''});
      status.textContent=`Найдено строк: ${rows.length}. Импортируем…`;
      const result=await importRows(rows,p=>{status.textContent=`Импорт ${p.done}/${p.total} · добавлено ${p.added}`});
      status.textContent=`Готово: обработано ${result.processed}, добавлено новых ${result.added}.`;
      toast(`Банк задач: обработано ${result.processed}, новых ${result.added}.`);
      setTimeout(()=>location.reload(),1400);
    }catch(e){
      console.error(e);
      status.textContent='Ошибка: '+(e?.message||e);
      toast('Ошибка импорта: '+(e?.message||e),7000);
    }finally{
      importing=false; button.disabled=false; input.value='';
    }
  }

  function findPdfPanel(){
    const nodes=[...document.querySelectorAll('h1,h2,h3,h4,b,strong,div,span')]
      .filter(el=>norm(el.textContent)==='Задачи из PDF');
    for(const h of nodes){
      let p=h;
      for(let i=0;i<6&&p;i++,p=p.parentElement){
        const txt=norm(p.textContent);
        const buttons=p.querySelectorAll?.('button')?.length||0;
        if(buttons>=1 && txt.includes('Сканировать библиотеку')) return p;
      }
    }
    return null;
  }

  function mount(){
    let panel=findPdfPanel() || document.getElementById('pdfTaskImportCard');
    if(!panel){
      const list=document.getElementById('bankList');
      if(!list) return;
      panel=document.createElement('div');
      panel.id='pdfTaskImportCard';
      panel.className='notice';
      panel.style.cssText='margin:0 0 12px;';
      list.parentNode.insertBefore(panel,list);
    }
    if(panel.dataset.xlsxImportV300==='1' && panel.querySelector('[data-xlsx-button]')) return;
    panel.dataset.xlsxImportV300='1';
    panel.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap">
        <div>
          <h3 style="margin:0 0 6px">Импорт задач</h3>
          <div class="muted" style="font-size:14px">Загрузите подготовленный XLSX. Лист <b>READY</b> попадёт в банк; лист REVIEW не импортируется.</div>
          <div data-xlsx-status class="muted" style="font-size:13px;margin-top:6px"></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input data-xlsx-input type="file" accept=".xlsx,.xls" hidden>
          <button data-xlsx-button class="btn primary" type="button">Загрузить файл с задачами</button>
        </div>
      </div>`;
    const input=panel.querySelector('[data-xlsx-input]');
    const button=panel.querySelector('[data-xlsx-button]');
    const status=panel.querySelector('[data-xlsx-status]');
    button.addEventListener('click',()=>{if(!importing) input.click()});
    input.addEventListener('change',()=>chooseAndImport(input,button,status));
  }

  const obs=new MutationObserver(()=>mount());
  obs.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
  setInterval(mount,1200);
  window.MathroomTaskXlsxImport={version:VERSION,mount};
})();
