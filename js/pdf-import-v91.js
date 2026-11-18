/* Mathroom v91 — rights-aware, text-layer PDF import into PRIVATE DRAFTS.
   Scanned or diagram-heavy pages require manual review; this does not OCR or publish. */
(()=>{
  'use strict';
  const API={};
  const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
  const fingerprint=s=>norm(s).toLocaleLowerCase('ru-RU').replace(/[«»"']/g,'');
  const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,Math.round(Number(v)||a)));
  const hasPdfLib=()=>Boolean(window.pdfjsLib&&typeof window.pdfjsLib.getDocument==='function');

  // Convert PDF text objects to lines while retaining most word spacing.
  API.linesFromItems=items=>{
    const parts=(items||[]).filter(x=>String(x?.str||'').trim())
      .map((x,i)=>({
        str:String(x.str),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),
        w:Number(x.width||0),i
      }));
    if(!parts.length)return [];
    parts.sort((a,b)=>Math.abs(b.y-a.y)>2.5?b.y-a.y:a.x-b.x);
    const rows=[];
    for(const p of parts){
      const last=rows[rows.length-1];
      if(!last||Math.abs(last.y-p.y)>2.5){
        rows.push({y:p.y,xEnd:p.x+p.w,text:p.str});
      }else{
        const gap=p.x-last.xEnd;
        last.text+=(gap>2.5?' ':'')+p.str;
        last.xEnd=Math.max(last.xEnd,p.x+p.w);
      }
    }
    return rows.map(r=>r.text.trim()).filter(Boolean);
  };
  const isTaskLine=s=>{
    const m=String(s||'').match(/^\s*(?:(?:№|Задача|Задание)\s*)?(\d{1,4}(?:\.\d{1,3})?)[.)]\s*(?=\S)/iu);
    if(m)return {label:m[1],rest:String(s).slice(m[0].length).trim()};
    const n=String(s||'').match(/^\s*(?:№|Задача|Задание)\s*(\d{1,4}(?:\.\d{1,3})?)\s*[:\-–]?\s+(.*)$/iu);
    return n?{label:n[1],rest:n[2].trim()}:null;
  };
  API.splitPage=(lines,page)=>{
    const tasks=[];
    let current=null;
    const flush=()=>{
      if(current&&norm(current.parts.join(' ')).length>=12)
        tasks.push({page,number:current.number,content:current.parts.join('\n').trim(),selected:true,answer:''});
    };
    for(const line of lines){
      const head=isTaskLine(line);
      if(head){
        flush();
        current={number:head.label,parts:[head.rest]};
      }else if(current){
        current.parts.push(line);
      }
    }
    flush();
    if(tasks.length)return tasks;
    // Never guess where a problem starts if no number markers exist.
    return [];
  };

  const oldLines=API.linesFromItems,oldSplit=API.splitPage;
  API.linesFromItems=items=>window.MathroomPdfLayoutV93?.linesFromItems(items)||oldLines(items);
  API.splitPage=(lines,page)=>window.MathroomPdfLayoutV93?.splitPage(lines,page)||oldSplit(lines,page);
  API.open=({S,sb,modal,toast,fail,loadTeacher,openBank})=>{
    const grades=[...new Set((S.topics||[]).map(t=>Number(t.grade)).filter(g=>g>=1&&g<=11))].sort((a,b)=>a-b);
    if(!grades.length)return toast('Для импорта сначала создайте темы');
    const m=modal('<section class="mr-pdf-import">'+
      '<h2>Импорт задач из PDF</h2>'+
      '<p class="muted">Извлекаем текст только из выбранного файла на твоём компьютере. Ничего не сохраняется до подтверждения. Готовые фрагменты попадут в <b>личные черновики</b>, не в общую библиотеку.</p>'+
      '<div class="grid cols2">'+
        '<div class="field"><label>PDF-файл, до 20 МБ</label><input type="file" id="pdfTaskFile" accept=".pdf,application/pdf"></div>'+
        '<div class="field"><label>Класс для подсказки (необязательно)</label><select id="pdfTaskGrade"><option value="">Определять автоматически</option>'+grades.map(g=>'<option value="'+g+'">'+g+' класс</option>').join('')+'</select></div>'+
        '<div class="field"><label>Запасная тема (для непривязанных задач)</label><select id="pdfTaskTopic"><option value="">— Не задана —</option></select></div>'+
        '<div class="field"><label>Сложность (позже можно изменить)</label><select id="pdfTaskDifficulty"><option value="basic">Базовая</option><option value="medium" selected>Средняя</option><option value="advanced">Сложная</option></select></div>'+
        '<div class="field"><label>Начальная страница PDF</label><input type="number" id="pdfTaskFrom" min="1" value="1"></div>'+
        '<div class="field"><label>Конечная страница PDF (макс. 25 за раз)</label><input type="number" id="pdfTaskTo" min="1" value="10"></div>'+
      '</div>'+
      '<label class="mr-pdf-rights"><input type="checkbox" id="pdfTaskRights"> Подтверждаю, что имею право использовать и хранить задания из выбранного документа. Понимаю, что импорт не даёт права публиковать чужой учебник целиком.</label>'+
      '<div class="actions"><button class="btn primary" id="pdfTaskExtract">Извлечь задания</button><button class="btn" id="pdfTaskAddVisual">＋ Задача со скана</button><button class="btn" id="pdfTaskAll">Выбрать всё</button><button class="btn" id="pdfTaskNone">Снять выбор</button></div>'+
      '<div class="notice" id="pdfTaskStatus">Выбери файл и укажи страницы.</div>'+
      '<div id="pdfTaskResults"></div>'+
      '<div class="actions" style="margin-top:16px"><button class="btn primary" id="pdfTaskSave" disabled>Сохранить в черновики</button></div>'+
      '</section>','wide-modal');
    const q=s=>m.querySelector(s);
    let entries=[],filename='',busy=false,pdfPages=0,visualSerial=0;
    const topicsForGrade=()=> (S.topics||[]).filter(t=>Number(t.grade)===Number(q('#pdfTaskGrade').value));
    const refreshTopics=()=>{
      const options=topicsForGrade();
      q('#pdfTaskTopic').innerHTML='<option value="">— Не задана —</option>'+options.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.section||'Математика')+' · '+esc(t.title)+'</option>').join('');
    };
    const state=s=>{q('#pdfTaskStatus').textContent=s;};
    const render=()=>{
      const panel=q('#pdfTaskResults');
      const total=entries.filter(x=>x.selected&&!x.imported).length;
      q('#pdfTaskSave').disabled=busy||!total;
      const allTopics=S.topics||[];
      if(!entries.length){panel.innerHTML='';return;}
      panel.innerHTML='<p class="muted">Найдено фрагментов: '+entries.length+'. Выбрано: '+total+'. <b>Проверяй формулы, схемы, переносы строк и условия вручную.</b></p>'+
        entries.map((x,i)=>{
          if(x.imported)return '<article class="card" style="margin:8px 0;padding:12px"><b>✓ Сохранено в личные черновики: PDF № '+esc(x.number)+' · страница '+x.page+'</b></article>';
          const audit=window.MathroomPdfQualityV92?.audit?.(x,(S.exercises||[]).filter(e=>String(e.topic_id)===String(x.topicId)));
          return '<article class="card" style="margin:8px 0;padding:12px">'+
          '<div class="actions" style="align-items:center"><label><input type="checkbox" data-pdf-select="'+i+'" '+(x.selected?'checked':'')+' '+(x.imported?'disabled':'')+'> № '+esc(x.number)+' · PDF-страница '+x.page+'</label><span class="pill">'+(x.imported?'Уже сохранено':x.duplicate?'Дубль условия':'Черновик')+'</span></div>'+
          (audit?.warnings?.length?'<div class="small" style="padding:8px 10px;background:var(--panel,#fff8ed);border-radius:8px;margin-bottom:8px"><b>Проверка импорта:</b> '+audit.warnings.map(w=>esc(w)).join('; ')+'</div>':'')+
          '<div class="grid cols2" style="margin:12px 0">'+
            '<div class="field"><label>Класс задачи</label><select data-pdf-grade="'+i+'"><option value="">— Выбери класс —</option>'+grades.map(g=>'<option value="'+g+'" '+(Number(x.grade)===g?'selected':'')+'>'+g+' класс</option>').join('')+'</select></div>'+
            '<div class="field"><label>Тема задачи</label><select data-pdf-topic="'+i+'"><option value="">— Выбери тему —</option>'+allTopics.filter(t=>Number(t.grade)===Number(x.grade)).map(t=>'<option value="'+esc(t.id)+'" '+(String(x.topicId||'')===String(t.id)?'selected':'')+'>'+esc(t.section||'Математика')+' · '+esc(t.title)+'</option>').join('')+'</select></div>'+
          '</div>'+
          '<div class="small muted" style="margin:0 0 8px">'+(x.topicMode==='auto'?'Автоопределение: '+esc(x.suggestion?.reason||'')+' · уверенность '+Math.round((x.suggestion?.confidence||0)*100)+'%. Проверь перед сохранением.':x.topicMode==='manual'?'Тема выбрана вручную.':x.topicId?'Использована запасная тема.':'Тема не определена — нужно выбрать вручную.')+'</div>'+
          '<div class="field"><label>Условие</label><textarea data-pdf-content="'+i+'" rows="4"></textarea></div>'+
          '<div class="field"><label>Ответ (если известен; можно заполнить позже)</label><input data-pdf-answer="'+i+'" type="text" placeholder="Необязательно для черновика"></div>'+
          '<div class="mr-pdf-v92-capture" style="padding:10px;border:1px solid var(--line,#ddd);border-radius:12px;margin-top:8px">'+
          '<div class="actions"><button type="button" class="btn sm" data-pdf-capture="'+i+'">'+(x.capture?'↻ Заменить фрагмент':'▧ Прикрепить формулу / чертёж из PDF')+'</button>'+
          (x.capture?'<button type="button" class="btn sm" data-pdf-remove="'+i+'">Убрать фрагмент</button>':'')+'</div>'+
          (x.capture?'<div class="small muted">Снимок PDF-страницы '+x.page+' прикрепится только к черновику. Не заменяет проверку задачи.</div><img data-pdf-preview="'+i+'" alt="Фрагмент исходной страницы PDF" style="display:block;max-width:100%;height:auto;margin-top:9px;border-radius:8px;border:1px solid #ddd">':'<div class="small muted">Если в условии есть дроби, степени, таблица или рисунок — прикрепи снимок оригинала для точности.</div>')+
          '</div>'+
        '</article>';
        }).join('');
      panel.querySelectorAll('[data-pdf-grade]').forEach(el=>el.onchange=()=>{
        const row=entries[Number(el.dataset.pdfGrade)];
        row.grade=Number(el.value)||null;row.topicId=null;row.topicMode='manual';
        render();
      });
      panel.querySelectorAll('[data-pdf-topic]').forEach(el=>el.onchange=()=>{
        const row=entries[Number(el.dataset.pdfTopic)];
        row.topicId=el.value||null;row.topicMode='manual';
        q('#pdfTaskSave').disabled=busy||!entries.some(x=>x.selected&&!x.imported);
      });
      panel.querySelectorAll('[data-pdf-content]').forEach(el=>{
        const i=Number(el.dataset.pdfContent);el.value=entries[i].content;
        el.oninput=()=>entries[i].content=el.value;
      });
      panel.querySelectorAll('[data-pdf-answer]').forEach(el=>{
        const i=Number(el.dataset.pdfAnswer);el.value=entries[i].answer||'';
        el.oninput=()=>entries[i].answer=el.value;
      });
      panel.querySelectorAll('[data-pdf-preview]').forEach(el=>{
        const row=entries[Number(el.dataset.pdfPreview)];
        if(row?.previewUrl)el.src=row.previewUrl;
      });
      panel.querySelectorAll('[data-pdf-capture]').forEach(el=>el.onclick=async()=>{
        const i=Number(el.dataset.pdfCapture),row=entries[i];
        if(!row||busy)return;
        const file=q('#pdfTaskFile').files?.[0];
        if(!file||file.name!==filename)return toast('Выбери исходный PDF заново');
        if(!window.MathroomPdfCaptureV92)return toast('Модуль захвата PDF не загрузился');
        el.disabled=true;
        try{
          const captured=await window.MathroomPdfCaptureV92.capture({file,pageNumber:row.page});
          if(captured){
            if(row.previewUrl)URL.revokeObjectURL(row.previewUrl);
            row.capture=captured;row.previewUrl=URL.createObjectURL(captured.blob);
            render();
          }
        }catch(e){toast('Ошибка снимка PDF: '+String(e?.message||e))}
        finally{el.disabled=false}
      });
      panel.querySelectorAll('[data-pdf-remove]').forEach(el=>el.onclick=()=>{
        const row=entries[Number(el.dataset.pdfRemove)];
        if(row?.previewUrl)URL.revokeObjectURL(row.previewUrl);
        if(row){row.previewUrl=null;row.capture=null;}
        render();
      });
      panel.querySelectorAll('[data-pdf-select]').forEach(el=>{
        el.onchange=()=>{
          const row=entries[Number(el.dataset.pdfSelect)];
          if(row.imported){el.checked=false;return;}
          row.selected=el.checked;q('#pdfTaskSave').disabled=busy||!entries.some(x=>x.selected&&!x.imported);
        };
      });
    };
    const extract=async()=>{
      const file=q('#pdfTaskFile').files?.[0];
      if(!file)return toast('Выбери PDF-файл');
      if(file.size>20*1024*1024)return toast('PDF больше 20 МБ; разбей его на части');
      if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf')return toast('Нужен PDF-файл');
      if(!hasPdfLib())return toast('Не загрузился PDF.js, обнови страницу');
      if(busy)return;
      busy=true;q('#pdfTaskExtract').disabled=true;
      for(const row of entries)if(row.previewUrl)URL.revokeObjectURL(row.previewUrl);
      entries=[];render();filename=file.name;
      let pdf=null;
      try{
        const data=new Uint8Array(await file.arrayBuffer());
        window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        pdf=await window.pdfjsLib.getDocument({data}).promise;
        pdfPages=pdf.numPages;
        const first=clamp(q('#pdfTaskFrom').value,1,pdf.numPages);
        const last=clamp(q('#pdfTaskTo').value,first,Math.min(pdf.numPages,first+24));
        q('#pdfTaskFrom').value=first;q('#pdfTaskTo').value=last;
        // The main teacher state can be capped at 1000 rows by PostgREST.
        // Rehydrate the full personal bank before duplicate screening.
        try{await window.MathroomBankAllExercisesV2982?.hydrate?.({rerender:false})}
        catch(e){console.warn('[PDF importer] full-bank hydration unavailable',e)}
        const existing=new Set((S.exercises||[]).map(x=>fingerprint(x.content)));
        const fallbackId=q('#pdfTaskTopic').value||null;
        const fallbackTopic=(S.topics||[]).find(t=>String(t.id)===String(fallbackId));
        const seen=new Set();
        for(let pageNum=first;pageNum<=last;pageNum++){
          state('Извлекаем PDF: страница '+pageNum+' из '+last+'…');
          const page=await pdf.getPage(pageNum);
          const text=await page.getTextContent();
          const lines=API.linesFromItems(text.items);
          for(const entry of API.splitPage(lines,pageNum)){
            const suggestion=window.MathroomPdfTopicsV93?.propose?.({
              content:entry.content,topics:S.topics||[],
              preferredGrade:q('#pdfTaskGrade').value||null
            })||{topicId:null,grade:null,confidence:0,reason:'Выбери тему вручную'};
            const identified=(S.topics||[]).find(t=>String(t.id)===String(suggestion.topicId));
            entry.suggestion=suggestion;
            entry.topicId=identified?.id||fallbackTopic?.id||null;
            entry.grade=identified?Number(identified.grade):fallbackTopic?Number(fallbackTopic.grade):(Number(q('#pdfTaskGrade').value)||null);
            entry.topicMode=identified?'auto':fallbackTopic?'fallback':'unknown';
            const f=fingerprint(entry.content);
            entry.duplicate=seen.has(f)||existing.has(f);
            entry.selected=!entry.duplicate;
            seen.add(f);
            entries.push(entry);
            if(entries.length>=60)break;
          }
          page.cleanup();
          if(entries.length>=60)break;
        }
        if(!entries.length)state('Текстовый слой с пронумерованными задачами не найден. Если это скан, нажми «Задача со скана» и вырежи нужное условие со страницы.');
        else state('Извлечено '+entries.length+' задач. Автоматически предложены темы: '+entries.filter(x=>x.topicMode==='auto').length+'. Нужно выбрать тему вручную: '+entries.filter(x=>!x.topicId).length+'. Изображения и формулы проверь по оригиналу.');
        render();
      }catch(e){state('Ошибка PDF: '+String(e?.message||e));}
      finally{
        try{await pdf?.destroy()}catch{}
        busy=false;q('#pdfTaskExtract').disabled=false;render();
      }
    };
    const save=async()=>{
      if(busy)return;
      if(!q('#pdfTaskRights').checked)return toast('Подтверди права на использование документа');
      const topicId=q('#pdfTaskTopic').value;
      const topic=topicsForGrade().find(t=>String(t.id)===String(topicId));
      if(!topic)return toast('Выбери существующую тему');
      const selected=entries.filter(x=>x.selected&&(norm(x.content).length>=12||x.capture)&&!x.imported);
      if(selected.some(x=>x.visualOnly&&!x.capture))
        return toast('Для задачи со скана сначала прикрепи снимок условия');
      if(!selected.length)return toast('Выбери хотя бы одну задачу с условием');
      if(!confirm('Сохранить '+selected.length+' фрагментов как ЛИЧНЫЕ ЧЕРНОВИКИ? Непроверенные формулы и рисунки нельзя публиковать.'))return;
      busy=true;q('#pdfTaskSave').disabled=true;
      const existing=new Set((S.exercises||[]).filter(x=>String(x.topic_id)===String(topicId)).map(x=>fingerprint(x.content)));
      const seen=new Set();
      const eligible=selected.filter(x=>{
        const fp=x.visualOnly?'visual:'+x.page+':'+x.number:fingerprint(x.content);
        if((!x.visualOnly&&existing.has(fp))||seen.has(fp))return false;
        seen.add(fp);return true;
      });
      let inserted=0,issue=null;
      try{
        // Per-task transactions in the UI: on partial failure, completed drafts
        // are excluded from retries, and only failed image uploads are removed.
        for(const x of eligible){
          const cap=x.capture;
          let imagePath='',imageId='';
          try{
            if(cap){
              imageId='pdfcap-'+(window.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
              imagePath=S.user.id+'/pdf-captures/'+Date.now()+'-'+imageId+'.png';
              const upload=await sb.storage.from('task-images').upload(imagePath,cap.blob,{
                contentType:'image/png',cacheControl:'3600',upsert:false
              });
              if(upload.error)throw upload.error;
            }
            const image=cap?{
              id:imageId,path:imagePath,name:'PDF № '+x.number+' · страница '+x.page+'.png',
              mime:'image/png',width:cap.width,height:cap.height,
              display_width:100,alt:'Фрагмент оригинального условия на странице '+x.page
            }:null;
            const body={
              teacher_id:S.user.id,topic_id:topic.id,kind:'task',
              title:'PDF № '+x.number+' · '+topic.title,
              content:x.content,answer:norm(x.answer),difficulty:q('#pdfTaskDifficulty').value,
              category:topic.title,tags:['mathroom-pdf-import-v91',...(cap?['mathroom-pdf-capture-v92']:[]),'класс-'+topic.grade],
              generator_spec:'',generator_answer:'',favorite:false,is_draft:true,
              builder_meta:{
                version:10,grade:topic.grade,task_type:'standard',
                text_blocks:[{id:'main',text:x.content}],
                content_order:['text:main',...(image?['image:'+image.id]:[])],
                images:image?[image]:[],
                answers:[{label:'Ответ',value:norm(x.answer),accepted:[]}],
                solution:'',hints:[],
                settings:{shared:false,allow_tests:false,allow_ai_example:false},
                source:{kind:'pdf',file:filename,pdf_page:x.page,exercise_no:x.number,
                  note:'Импорт локального PDF — требуется проверка преподавателем'},
                pdf_import:{
                  version:92,rights_confirmed:true,verified:false,
                  requires_teacher_review:true,
                  original_page:x.page,
                  capture:image?{rect:cap.rect,width:cap.width,height:cap.height,storage_path:imagePath}:null,
                  quality_warnings:window.MathroomPdfQualityV92?.audit?.(x,
                    (S.exercises||[]).filter(e=>String(e.topic_id)===String(topic.id)))?.warnings||[]
                }
              }
            };
            const {data,error}=await sb.from('exercises').insert(body).select('id').single();
            if(error)throw error;
            inserted++;
            x.imported=true;x.selected=false;
            if(x.previewUrl){URL.revokeObjectURL(x.previewUrl);x.previewUrl=null;}
            state('Черновики: сохранено '+inserted+' из '+eligible.length);
          }catch(error){
            if(imagePath){
              try{await sb.storage.from('task-images').remove([imagePath])}catch(cleanupError){
                console.warn('[Mathroom PDF capture cleanup]',cleanupError)
              }
            }
            issue=error;break;
          }
        }
        if(inserted)await loadTeacher();
        if(issue){
          state('Сохранено '+inserted+' из '+eligible.length+'. Остальные не сохранены: '+String(issue?.message||issue)+'. Можешь исправить ошибку и продолжить.');
          render();
          fail(issue);
        }else{
          state('В личных черновиках: '+inserted+' новых задач. Открой банк и проверь условия, формулы, иллюстрации и ответы.');
          toast('Сохранено в черновики: '+inserted);
          for(const x of entries)if(x.previewUrl)URL.revokeObjectURL(x.previewUrl);
          entries=[];render();m.remove();openBank();
        }
      }catch(e){
        state('Ошибка сохранения: '+String(e?.message||e));fail(e);
      }finally{
        busy=false;q('#pdfTaskSave').disabled=!entries.some(x=>x.selected&&!x.imported);
      }
    };
    q('#pdfTaskFile').onchange=()=>{
      for(const x of entries)if(x.previewUrl)URL.revokeObjectURL(x.previewUrl);
      entries=[];filename='';pdfPages=0;visualSerial=0;render();
      state('Файл изменён — извлеки задания заново.');
    };
    q('#pdfTaskGrade').onchange=refreshTopics;
    q('#pdfTaskAddVisual').onclick=()=>{
      const file=q('#pdfTaskFile').files?.[0];
      if(!file)return toast('Выбери PDF-файл');
      if(!pdfPages)return toast('Сначала нажми «Извлечь задания», чтобы открыть PDF и узнать число страниц');
      const page=clamp(q('#pdfTaskFrom').value,1,pdfPages);
      visualSerial++;
      entries.push({
        page,number:'скан-'+visualSerial,
        content:'Условие представлено на прикреплённом изображении PDF. Требуется проверка преподавателем.',
        answer:'',selected:true,duplicate:false,visualOnly:true,
        grade:Number(q('#pdfTaskGrade').value)||null,topicId:q('#pdfTaskTopic').value||null,
        topicMode:q('#pdfTaskTopic').value?'fallback':'unknown'
      });
      render();state('Задача со скана добавлена. Нажми «Прикрепить фрагмент» у новой карточки, выдели область и заполни ответ позже.');
    };
    q('#pdfTaskExtract').onclick=extract;
    q('#pdfTaskSave').onclick=save;
    q('#pdfTaskAll').onclick=()=>{entries.forEach(x=>{if(!x.imported)x.selected=true});render();};
    q('#pdfTaskNone').onclick=()=>{entries.forEach(x=>x.selected=false);render();};
    refreshTopics();
  };
  window.MathroomPdfImportV91=API;
})();
