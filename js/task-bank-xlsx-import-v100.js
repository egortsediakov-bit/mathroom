/* Mathroom v100 — XLSX preview -> safe private drafts, never auto-publish.
 * Uses pure MathroomXlsxV100 mappings; old imports remain untouched. */
(function(){
  'use strict';
  const API={version:'100.0'};
  const core=()=>window.MathroomXlsxV100;
  let busy=false,previewState=null;
  const el=(root,sel)=>root?.querySelector?.(sel)||null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const clip=(s,n)=>{const v=String(s??'');return v.length>n?v.slice(0,n)+'…':v};
  const norm=s=>String(s??'').trim().toLocaleLowerCase('ru-RU');
  const status=(value,isError=false)=>{
    const node=document.querySelector('#mrXlsxImportStatus');
    if(node){node.textContent=value;node.dataset.error=isError?'true':'false'}
  };
  const client=()=>{
    const sb=window.MR?.sb||window.sb||window.appSupabase;
    if(!sb||typeof sb.from!=='function')throw new Error('Не удалось подключиться к банку. Войди в аккаунт Mathroom заново.');
    return sb;
  };
  const teacher=async sb=>{
    if(window.MR?.S?.user?.id)return window.MR.S.user.id;
    const {data,error}=await sb.auth.getUser();
    if(error||!data?.user?.id)throw new Error('Не удалось определить преподавателя');
    return data.user.id;
  };
  const loadXlsx=async()=>{
    if(window.XLSX)return window.XLSX;
    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload=resolve;script.onerror=()=>reject(new Error('Модуль Excel не загрузился'));
      document.head.append(script);
    });
    return window.XLSX;
  };
  const sheet=(xlsx,wb,name)=>{
    if(!wb.SheetNames.includes(name))return [];
    return xlsx.utils.sheet_to_json(wb.Sheets[name],{defval:'',raw:false});
  };
  const readWorkbook=(xlsx,workbook)=>{
    const names=workbook.SheetNames||[];
    if(!names.includes('READY'))throw new Error('Не найден лист READY. Проверь формат книги.');
    const sources=sheet(xlsx,workbook,'РЕШЕНИЯ');
    const templates=[...sheet(xlsx,workbook,'ШАБЛОНЫ'),
      ...sheet(xlsx,workbook,'GENERATORS'),...sheet(xlsx,workbook,'TEMPLATES')];
    const data=core().readSheetRows(sheet(xlsx,workbook,'READY'),sources,templates);
    if(data.all.length>15000)throw new Error('В книге слишком много строк. Раздели файл на части.');
    return data;
  };
  const fetchExercises=async(sb,uid)=>{
    const rows=[];
    for(let from=0;from<50000;from+=1000){
      const {data,error}=await sb.from('exercises').select('id,content,generator_spec,tags')
        .eq('teacher_id',uid).order('created_at').range(from,from+999);
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<1000)break;
    }
    return rows;
  };
  const fetchTopics=async(sb,uid)=>{
    const rows=[];
    for(let from=0;from<15000;from+=1000){
      const {data,error}=await sb.from('topics').select('id,grade,section,title')
        .eq('teacher_id',uid).order('created_at').range(from,from+999);
      if(error)throw error;
      rows.push(...(data||[]));
      if(!data||data.length<1000)break;
    }
    return rows;
  };
  const seenIds=(rows=[])=>{
    const ids=new Set();
    for(const row of rows){
      let spec={};
      try{spec=JSON.parse(row.generator_spec||'{}')}catch{}
      if(spec?.task_id)ids.add(String(spec.task_id));
    }
    return ids;
  };
  const prepare=(data,bank=[])=>{
    const idSet=seenIds(bank),existingContent=new Set(bank.map(x=>core().fingerprint(x.content)).filter(Boolean));
    const encountered=new Set(),newContent=new Set();
    return data.all.map((r,index)=>{
      const issues=core().validate(r);
      let reason='';
      if(issues.length)reason=issues.join('; ');
      if(!reason&&encountered.has(r.id))reason='повтор task_id внутри файла';
      if(!reason&&idSet.has(r.id))reason='этот ID уже импортирован';
      const fp=core().fingerprint(r.content);
      if(!reason&&r.type==='task'&&fp&&(existingContent.has(fp)||newContent.has(fp)))reason='точный повтор условия';
      encountered.add(r.id);
      if(r.type==='task'&&fp)newContent.add(fp);
      return {r,index,reason,valid:!reason,selected:!reason&&r.type==='task',
        advisory:r.type==='template'&&!r.generatorReady?'описательный шаблон — настроить в конструкторе':
          r.type==='template'?'параметризованный шаблон — проверить формулы':'',
        kind:r.type==='template'?'Шаблон':'Задача'};
    });
  };
  const topicKey=(grade,name)=>String(grade)+'|'+norm(name);
  const ensureTopics=async(sb,uid,items,known,notify)=>{
    const map=new Map((known||[]).map(t=>[topicKey(t.grade,t.title),t]));
    const additions=new Map();
    for(const item of items){
      const r=item.r,k=topicKey(r.grade,r.topic);
      if(!map.has(k)&&!additions.has(k))
        additions.set(k,{teacher_id:uid,grade:r.grade,section:r.section||'Математика',
          title:r.topic,theory:''});
    }
    let added=0;const missing=[...additions.values()];
    for(let i=0;i<missing.length;i+=80){
      notify?.('Создаём темы '+(i+1)+'–'+Math.min(i+80,missing.length)+' из '+missing.length);
      const {data,error}=await sb.from('topics').insert(missing.slice(i,i+80))
        .select('id,grade,section,title');
      if(error)throw error;
      for(const t of data||[]){map.set(topicKey(t.grade,t.title),t);added++}
    }
    return {map,added};
  };
  const importItems=async(state,notify)=>{
    if(!state)throw new Error('Сначала выбери Excel');
    const chosen=state.items.filter(x=>x.valid&&x.selected);
    if(!chosen.length)throw new Error('Нет выбранных задач или шаблонов');
    const sb=client(),uid=await teacher(sb);
    // Re-check the database just before writing to avoid re-import on retries.
    notify?.('Проверяем существующий банк…');
    const current=await fetchExercises(sb,uid),ids=seenIds(current);
    const fingerprints=new Set(current.map(x=>core().fingerprint(x.content)).filter(Boolean));
    const pending=[],skipped=[];
    for(const item of chosen){
      const fp=core().fingerprint(item.r.content);
      if(ids.has(item.r.id)||item.r.type==='task'&&fp&&fingerprints.has(fp)){
        skipped.push(item.r.id);continue;
      }
      ids.add(item.r.id);
      if(item.r.type==='task'&&fp)fingerprints.add(fp);
      pending.push(item);
    }
    if(!pending.length)return {added:0,skipped:skipped.length,topicsAdded:0};
    const topics=await fetchTopics(sb,uid);
    const {map,added:topicsAdded}=await ensureTopics(sb,uid,pending,topics,notify);
    let added=0;
    for(let offset=0;offset<pending.length;offset+=80){
      const part=pending.slice(offset,offset+80);
      const payload=part.map(item=>{
        const t=map.get(topicKey(item.r.grade,item.r.topic));
        if(!t)throw new Error('Не удалось найти тему: '+item.r.topic);
        return core().toExercise(uid,t,item.r);
      });
      const {error,data}=await sb.from('exercises').insert(payload).select('id');
      if(error)throw new Error('Сохранено '+added+' черновиков, затем ошибка: '+error.message+
        '. Повтори импорт: уже загруженные ID пропустятся.');
      added+=(data||payload).length;
      notify?.('Сохранено в черновики: '+added+' / '+pending.length);
    }
    return {added,skipped:skipped.length,topicsAdded};
  };
  const renderPreview=()=>{
    const box=document.getElementById('mrXlsxPreview');
    if(!box||!previewState)return;
    const items=previewState.items,valid=items.filter(x=>x.valid);
    const pageSize=80,pages=Math.max(1,Math.ceil(items.length/pageSize));
    const page=Math.min(pages-1,Math.max(0,Number(previewState.page)||0));
    previewState.page=page;
    const visibleItems=items.slice(page*pageSize,(page+1)*pageSize);
    const selected=valid.filter(x=>x.selected);
    const problems=items.filter(x=>!x.valid);
    const templates=items.filter(x=>x.r.type==='template');
    // Explain exactly why a row was left unchecked or unavailable.
    const selectionNote=()=>{
      const remaining=items.filter(x=>!x.selected);
      if(!remaining.length)return 'Выбраны все '+items.length+' записей: задачи и шаблоны.';
      const blocked=remaining.filter(x=>!x.valid);
      const unchecked=remaining.filter(x=>x.valid);
      const explanation=[];
      if(unchecked.length)explanation.push('Не выбрано: '+unchecked.length+
        ' ('+unchecked.slice(0,5).map(x=>x.r.id).join(', ')+
        (unchecked.length>5?'…':'')+').');
      if(blocked.length)explanation.push('Недоступно для выбора: '+blocked.length+
        ' ('+blocked.slice(0,5).map(x=>x.r.id+': '+x.reason).join('; ')+
        (blocked.length>5?'…':'')+').');
      return explanation.join(' ');
    };
    const stat=(count,label,extra='')=>'<div class="mr-xlsx-stat '+extra+'"><strong>'+count+'</strong><span>'+label+'</span></div>';
    box.innerHTML='<div class="mr-xlsx-head"><div><span class="mr-xlsx-kicker">ШАГ 02 / ПРОВЕРКА МАТЕРИАЛОВ</span>'+
      '<h4>Предпросмотр заданий</h4><p>Проверь условия и решения, затем выбери, что добавить в черновики.</p></div>'+
      '<span class="mr-xlsx-filename" title="'+esc(previewState.fileName||'')+'">'+esc(clip(previewState.fileName||'Excel',42))+'</span></div>'+
      '<div class="mr-xlsx-stats">'+
        stat(items.length,'Всего записей')+
        '<div class="mr-xlsx-stat is-accent"><strong data-xlsx-stat-selected>'+selected.length+'</strong><span>Выбрано</span></div>'+
        stat(templates.length,'Шаблонов')+
        stat(problems.length,'Пропущено',problems.length?'is-warning':'')+
      '</div>'+
      '<div class="mr-xlsx-controls"><div class="mr-xlsx-control-group">'+
      '<button class="is-primary" type="button" data-xlsx-all>✓ Все задачи и шаблоны</button>'+
      '<button type="button" data-xlsx-tasks>Только задачи</button>'+
      '<button type="button" data-xlsx-none>Снять выбор</button>'+
      '<button type="button" data-xlsx-templates>＋ Добавить шаблоны</button></div>'+
      (pages>1?'<div class="mr-xlsx-page-controls"><span>Страница '+(page+1)+' из '+pages+'</span>'+
        '<button type="button" data-xlsx-prev '+(page===0?'disabled':'')+'>←</button>'+
        '<button type="button" data-xlsx-next '+(page===pages-1?'disabled':'')+'>→</button></div>':'')+'</div>'+
      '<div class="mr-xlsx-selection-note" id="mrXlsxSelectionNote" role="status">'+esc(selectionNote())+'</div>'+
      '<div class="mr-xlsx-items" role="list">'+visibleItems.map(item=>{
        const r=item.r;
        const difficulty=({basic:'Базовая',medium:'Средняя',advanced:'Сложная'})[r.difficulty]||r.difficulty;
        return '<article class="mr-xlsx-item'+(!item.valid?' is-invalid':item.selected?' is-selected':'')+'" data-xlsx-item="'+item.index+'" role="listitem">'+
          '<label class="mr-xlsx-check" title="Выбрать запись"><input aria-label="Выбрать '+esc(r.id||'запись')+'" type="checkbox" data-xlsx-choice="'+item.index+'" '+(item.selected?'checked':'')+
          (!item.valid?' disabled':'')+'><span class="mr-xlsx-check-face"></span></label>'+
          '<div class="mr-xlsx-item-body"><div class="mr-xlsx-item-top">'+
            '<div class="mr-xlsx-item-heading"><span class="mr-xlsx-task-id">'+esc(r.id||'—')+'</span>'+
            '<strong>'+esc(r.topic||'Без темы')+'</strong></div>'+
            '<div class="mr-xlsx-item-tags"><span class="mr-xlsx-grade-tag">'+esc(r.grade)+' класс</span>'+
            '<span class="mr-xlsx-difficulty" data-level="'+esc(r.difficulty)+'">'+esc(difficulty)+'</span></div>'+
          '</div>'+
          (item.reason?'<p class="mr-xlsx-review-note is-error">Пропущено: '+esc(item.reason)+'</p>':
            item.advisory?'<p class="mr-xlsx-review-note">'+esc(item.advisory)+'</p>':'')+
          '<div class="mr-xlsx-item-condition">'+esc(clip(r.content,1200))+'</div>'+
          '<div class="mr-xlsx-item-bottom">'+
            (r.answer?'<div class="mr-xlsx-answer"><span>ОТВЕТ</span><strong>'+esc(clip(r.answer,180))+'</strong></div>':
              '<span class="mr-xlsx-answer-missing">Ответ не указан</span>')+
            (r.hints?.length?'<details class="mr-xlsx-solution"><summary>Подсказки ('+r.hints.length+')</summary><div class="mr-xlsx-solution-text">'+
              r.hints.map((hint,i)=>'<p><b>Подсказка '+(i+1)+':</b> '+esc(clip(hint,1000))+'</p>').join('')+'</div></details>':'')+
            (r.solution?'<details class="mr-xlsx-solution"><summary>'+
              '<span class="mr-xlsx-solution-show">Показать решение</span>'+
              '<span class="mr-xlsx-solution-hide">Скрыть решение</span></summary>'+
              '<div class="mr-xlsx-solution-text">'+esc(clip(r.solution,3000))+'</div></details>':'')+
          '</div></div></article>';
      }).join('')+'</div>'+
      '<div class="mr-xlsx-import-footer"><label class="mr-xlsx-rights">'+
      '<input id="mrXlsxRights" type="checkbox" '+(previewState.rightsConfirmed?'checked':'')+'>'+
      '<span><strong>Подтверждаю право использования</strong><small>Все материалы сохраняются в личные черновики. Публикации без проверки нет.</small></span></label>'+
      '<div class="mr-xlsx-actions"><span id="mrXlsxSelected">'+selected.length+' выбрано</span>'+
      '<button type="button" id="mrXlsxApply" '+(!selected.length?'disabled':'')+
      '>Сохранить в черновики <span aria-hidden="true">→</span></button></div></div>';
    const update=()=>{
      const count=items.filter(x=>x.valid&&x.selected).length;
      const counter=el(box,'#mrXlsxSelected'),button=el(box,'#mrXlsxApply');
      if(counter)counter.textContent=count+' выбрано';
      const statSelected=el(box,'[data-xlsx-stat-selected]');
      if(statSelected)statSelected.textContent=String(count);
      const note=el(box,'#mrXlsxSelectionNote');
      if(note)note.textContent=selectionNote();
      if(button)button.disabled=!count||busy;
    };
    box.querySelectorAll('[data-xlsx-choice]').forEach(c=>c.onchange=()=>{
      const item=items[Number(c.dataset.xlsxChoice)];
      if(item?.valid){
        item.selected=c.checked;
        const card=c.closest('.mr-xlsx-item');
        card?.classList.toggle('is-selected',c.checked);
        update();
      }
    });
    if(el(box,'[data-xlsx-prev]'))el(box,'[data-xlsx-prev]').onclick=()=>{
      previewState.page=Math.max(0,page-1);renderPreview();
    };
    if(el(box,'[data-xlsx-next]'))el(box,'[data-xlsx-next]').onclick=()=>{
      previewState.page=Math.min(pages-1,page+1);renderPreview();
    };
    el(box,'[data-xlsx-all]').onclick=()=>{
      items.forEach(x=>x.selected=!!x.valid);
      renderPreview();
    };
    el(box,'[data-xlsx-tasks]').onclick=()=>{
      items.forEach(x=>x.selected=x.valid&&x.r.type==='task');
      renderPreview();
    };
    el(box,'[data-xlsx-none]').onclick=()=>{items.forEach(x=>x.selected=false);renderPreview()};
    el(box,'[data-xlsx-templates]').onclick=()=>{
      items.filter(x=>x.valid&&x.r.type==='template').forEach(x=>x.selected=true);
      renderPreview();
    };
    el(box,'#mrXlsxRights').onchange=e=>{previewState.rightsConfirmed=!!e.target.checked};
    el(box,'#mrXlsxApply').onclick=async()=>{
      if(busy)return;
      if(!el(box,'#mrXlsxRights')?.checked)return status('Подтверди право использования внизу списка.',true);
      const chosen=items.filter(x=>x.valid&&x.selected);
      if(!chosen.length)return status('Выбери хотя бы одну запись',true);
      if(!confirm('Загрузить '+chosen.length+' записей как ЛИЧНЫЕ ЧЕРНОВИКИ? Материалы не будут опубликованы и не заменят существующие задачи.'))return;
      busy=true;el(box,'#mrXlsxApply').disabled=true;
      try{
        const result=await importItems(previewState,status);
        try{await window.MathroomBankAllExercisesV2982?.hydrate?.({force:true,rerender:false})}
        catch(e){console.warn('[xlsx bank refresh]',e)}
        status('Готово: '+result.added+' новых черновиков, '+result.skipped+
          ' повторов, '+result.topicsAdded+' новых тем. Открой «Черновики», чтобы проверить решения.');
        // Re-preview: uploaded tasks must not be selected for a second write.
        const sb=client(),uid=await teacher(sb);
        const current=await fetchExercises(sb,uid);
        previewState.items=prepare(previewState.data,current);
        previewState.rightsConfirmed=false;
        renderPreview();
      }catch(err){status('Ошибка импорта: '+String(err?.message||err),true);console.error('[Mathroom XLSX v100]',err)}
      finally{busy=false;const b=document.getElementById('mrXlsxApply');if(b)b.disabled=!previewState?.items.some(x=>x.valid&&x.selected)}
    };
    try{window.renderMathInElement?.(box,{delimiters:[
      {left:'\\[',right:'\\]',display:true},
      {left:'\\(',right:'\\)',display:false}],throwOnError:false})}catch(e){console.warn('[xlsx math preview]',e)}
  };
  const onFile=async input=>{
    const file=input.files?.[0];if(!file||busy)return;
    if(file.size>15*1024*1024)return status('Excel больше 15 МБ. Раздели его на части.',true);
    busy=true;status('Читаем Excel и проверяем банк…');
    try{
      const XLSX=await loadXlsx(),buffer=await file.arrayBuffer();
      const book=XLSX.read(buffer,{type:'array',cellDates:false});
      const data=readWorkbook(XLSX,book);
      const sb=client(),uid=await teacher(sb);
      const bank=await fetchExercises(sb,uid);
      previewState={fileName:file.name,data,items:prepare(data,bank),rightsConfirmed:false};
      renderPreview();
      status('Файл прочитан. Проверь условия, формулы и решения, затем выбери, что сохранить.');
    }catch(e){previewState=null;const p=document.getElementById('mrXlsxPreview');if(p)p.innerHTML='';
      status('Ошибка чтения: '+String(e?.message||e),true)}
    finally{busy=false;input.value=''}
  };
  const mount=()=>{
    const list=document.getElementById('bankList');
    if(!list||!list.parentNode)return;
    if(document.getElementById('mrXlsxImportV100'))return;
    const div=document.createElement('section');
    div.id='mrXlsxImportV100';div.className='mr-xlsx-import-v100';
    div.innerHTML='<div class="mr-xlsx-intro">'+
      '<div class="mr-xlsx-identity"><div class="mr-xlsx-brandmark" aria-hidden="true">'+
      '<svg viewBox="0 0 36 36" fill="none"><rect x="8" y="6" width="18" height="24" rx="4" stroke="currentColor" stroke-width="2.6"/>'+
      '<path d="M13 14h8M13 19h8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'+
      '<path d="m18 27 5 4 9-11" stroke="#FF6422" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
      '</div><div class="mr-xlsx-intro-copy"><span class="mr-xlsx-kicker">КОТОМАТИКА / БАНК ЗАДАЧ</span>'+
      '<h3>Импорт Excel</h3>'+
      '<p>Загружай задания, проверяй подсказки и решения, сохраняй материалы в личные черновики. Для подсказок используй столбцы hint_1, hint_2, hint_3 или hints.</p>'+
      '</div></div>'+
      '<div class="mr-xlsx-upload"><input type="file" id="mrXlsxFileV100" accept=".xlsx,.xls" hidden>'+
      '<button type="button" data-xlsx-button id="mrXlsxChooseV100"><span aria-hidden="true">＋</span> Выбрать Excel</button>'+
      '<span>Поддерживаются файлы XLSX и XLS</span></div></div>'+
      '<div class="mr-xlsx-steps" aria-label="Этапы импорта">'+
      '<span><b>01</b> Загрузить файл</span><i aria-hidden="true"></i>'+
      '<span><b>02</b> Проверить задания</span><i aria-hidden="true"></i>'+
      '<span><b>03</b> Сохранить черновики</span></div>'+
      '<div class="mr-xlsx-status-wrap"><span class="mr-xlsx-status-indicator" aria-hidden="true"></span>'+
      '<div id="mrXlsxImportStatus" role="status" aria-live="polite">Начни с выбора Excel. Ничего не публикуется автоматически.</div></div>'+
      '<div id="mrXlsxPreview"></div>';
    list.parentNode.insertBefore(div,list);
    el(div,'#mrXlsxChooseV100').onclick=()=>{if(!busy)el(div,'#mrXlsxFileV100').click()};
    el(div,'#mrXlsxFileV100').onchange=function(){onFile(this)};
    if(previewState)renderPreview();
  };
  if(typeof MutationObserver==='function')
    new MutationObserver(()=>mount()).observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);
  else mount();
  API.readWorkbook=readWorkbook;API.prepare=prepare;API.importItems=importItems;API.mount=mount;
  window.MathroomTaskXlsxImport=API;
})();
