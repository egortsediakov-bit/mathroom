(()=>{
  const API={};

  const buildMulti=(ctx,{rows=[],difficulty="balanced",allowTemplates=true}={})=>{
    const merged=new Map();
    for(const row of rows){
      const topicId=String(row&&row.topicId||"");
      const count=Math.max(0,Math.round(Number(row&&row.count)||0));
      if(!topicId||!count)continue;
      merged.set(topicId,(merged.get(topicId)||0)+count);
    }
    const quotas=[...merged].map(([topicId,count])=>({topicId,count}));
    const requested=Math.min(30,quotas.reduce((sum,row)=>sum+row.count,0));
    if(!requested)return {requested:0,items:[],attempts:0,duplicates:0,rejected:0,fallbacks:0,lastError:"",generated:0,uniqueSources:0,counts:{basic:0,medium:0,advanced:0},complete:false,multiTopic:true,topicSnapshots:[],topicQuotas:[],topicSnapshot:null};
    let budget=requested;
    const normalized=quotas.map(row=>{const take=Math.min(row.count,budget);budget-=take;return {...row,count:take}}).filter(x=>x.count>0);
    const items=[],seen=new Set(),topicSnapshots=[],topicQuotas=[];
    let attempts=0,duplicates=0,rejected=0,fallbacks=0,lastError="";
    for(const row of normalized){
      const topic=(ctx.S.topics||[]).find(x=>String(x.id)===String(row.topicId));
      if(!topic)continue;
      const snap={id:topic.id,title:topic.title,grade:topic.grade,section:topic.section||""};
      topicSnapshots.push(snap);topicQuotas.push({...snap,count:row.count});
      let remaining=row.count,cycles=0;
      while(remaining>0&&cycles<5){
        cycles++;
        const part=ctx.buildSmartTaskSet({
          topicId:row.topicId,
          count:Math.min(30,remaining+Math.min(5,remaining+3)),
          difficulty,
          allowTemplates
        });
        attempts+=part.attempts||0;duplicates+=part.duplicates||0;rejected+=part.rejected||0;fallbacks+=part.fallbacks||0;
        if(part.lastError)lastError=part.lastError;
        let added=0;
        for(const item of part.items||[]){
          if(remaining<=0)break;
          const fp=ctx.taskVariantFingerprint(item);
          if(seen.has(fp)){duplicates++;continue}
          seen.add(fp);
          items.push({...item,topic_id:topic.id,topic_title:topic.title,topic_grade:topic.grade,topic_section:topic.section||""});
          remaining--;added++;
        }
        if(!added)break;
      }
    }
    const counts={basic:items.filter(x=>x.difficulty==="basic").length,medium:items.filter(x=>x.difficulty==="medium").length,advanced:items.filter(x=>x.difficulty==="advanced").length};
    const grades=[...new Set(topicSnapshots.map(x=>Number(x.grade)).filter(Boolean))];
    const topicSnapshot={id:null,title:"Повторение по "+topicSnapshots.length+" темам",grade:grades.length===1?grades[0]:null,section:topicSnapshots.map(x=>x.title).join(" · ")||"Смешанный комплект"};
    return {requested,items,attempts,duplicates,rejected,fallbacks,lastError,generated:items.filter(x=>x.generated).length,uniqueSources:new Set(items.map(x=>String(x.source&&x.source.id||""))).size,counts,complete:items.length===requested,multiTopic:true,topicSnapshots,topicQuotas,topicSnapshot};
  };

  API.openBuilder=(ctx,prefill={})=>{
    const taskTopics=(ctx.S.topics||[]).filter(topic=>(ctx.S.exercises||[]).some(x=>String(x.topic_id)===String(topic.id)&&x.kind==="task"&&!x.is_draft&&String(x.answer||"").trim()));
    if(!taskTopics.length)return ctx.toast("В личном банке пока нет задач с ответами");
    const grades=[...new Set(taskTopics.map(x=>Number(x.grade)).filter(Boolean))].sort((a,b)=>a-b);
    let initialGrade=Number(prefill.grade);if(!grades.includes(initialGrade))initialGrade=grades[0];
    const initialDiff=["basic","medium","advanced"].includes(prefill.difficulty)?prefill.difficulty:"balanced";
    const students=ctx.S.students||[];
    const root=ctx.modal(
      '<section class="mr-smart-set">'+
        '<div class="mr-smart-set-head"><div><span class="pill mr-smart-set-pill">✦ умный комплект</span><h2>Собрать готовый набор задач</h2><p class="muted">Одна тема для практики или несколько тем с точной квотой — для повторения, проверочной и контрольной.</p></div></div>'+
        '<div class="mr-smart-set-mode"><button class="active" type="button" data-smart-mode="single">Одна тема</button><button type="button" data-smart-mode="multi">Несколько тем</button></div>'+
        '<div id="smartSetSinglePanel" class="mr-smart-set-panel"><div class="mr-smart-set-controls mr-smart-set-controls-single">'+
          '<label><span>Класс</span><select id="smartSetGrade">'+grades.map(g=>'<option value="'+g+'" '+(g===initialGrade?"selected":"")+'>'+g+' класс</option>').join("")+'</select></label>'+
          '<label class="wide"><span>Тема</span><select id="smartSetTopic"></select></label>'+
          '<label><span>Количество</span><select id="smartSetCount">'+[5,8,10,15,20].map(n=>'<option value="'+n+'" '+(n===10?"selected":"")+'>'+n+' задач</option>').join("")+'</select></label>'+
        '</div></div>'+
        '<div id="smartSetMultiPanel" class="mr-smart-set-panel" hidden>'+
          '<div class="mr-smart-multi-head"><label><span>Класс</span><select id="smartSetMultiGrade">'+grades.map(g=>'<option value="'+g+'" '+(g===initialGrade?"selected":"")+'>'+g+' класс</option>').join("")+'</select></label><div class="mr-smart-multi-total"><span>Всего</span><b id="smartMultiTotal">0 задач</b></div></div>'+
          '<div id="smartMultiRows" class="mr-smart-multi-rows"></div><button type="button" class="btn sm" id="smartMultiAdd">＋ Добавить тему</button>'+
        '</div>'+
        '<div class="mr-smart-set-controls mr-smart-set-common">'+
          '<label><span>Сложность</span><select id="smartSetDifficulty"><option value="balanced">Сбалансировано</option><option value="basic">Только базовые</option><option value="medium">Только средние</option><option value="advanced">Только сложные</option></select></label>'+
          '<label class="mr-smart-set-check"><input type="checkbox" id="smartSetTemplates" checked><span><b>Использовать генераторы</b><small>Один шаблон можно взять несколько раз, если варианты уникальны</small></span></label>'+
          '<label><span>Ученик для ДЗ</span><select id="smartSetStudent"><option value="">Не выбран</option>'+students.map(s=>'<option value="'+s.id+'">'+ctx.esc(s.name)+' · '+(s.grade||"?")+' кл.</option>').join("")+'</select></label>'+
        '</div>'+
        '<div class="mr-smart-set-run"><div id="smartSetHint" class="small muted">Обычная задача не повторяется. Для генераторов система отдельно проверяет уникальность готового условия.</div><button class="btn primary" id="smartSetGenerate">✦ Собрать комплект</button></div>'+
        '<div id="smartSetStatus" class="mr-smart-set-status" hidden></div>'+
        '<div id="smartSetActions" class="mr-smart-set-actions" hidden><button class="btn sm" id="smartSetCopy">Скопировать без ответов</button><button class="btn sm" id="smartSetCopyAnswers">Скопировать с ответами</button><button class="btn sm mr-smart-set-sheet" id="smartSetWorksheet">A4 / PDF</button><button class="btn sm mr-save-smart-set" id="smartSetSave" '+(ctx.S.savedTaskSetsFeatureAvailable?"":"disabled")+'>Сохранить комплект</button><button class="btn sm primary" id="smartSetHomework" '+(students.length?"":"disabled")+'>Назначить как ДЗ</button></div>'+
        '<div id="smartSetList" class="mr-smart-set-list"></div>'+
      '</section>',
      "mr-smart-set-modal"
    );
    const q=s=>root.querySelector(s);
    const grade=q("#smartSetGrade"),topic=q("#smartSetTopic"),count=q("#smartSetCount"),multiGrade=q("#smartSetMultiGrade"),multiRows=q("#smartMultiRows"),multiTotal=q("#smartMultiTotal"),multiAdd=q("#smartMultiAdd"),singlePanel=q("#smartSetSinglePanel"),multiPanel=q("#smartSetMultiPanel"),difficulty=q("#smartSetDifficulty"),templates=q("#smartSetTemplates"),student=q("#smartSetStudent"),status=q("#smartSetStatus"),actions=q("#smartSetActions"),list=q("#smartSetList"),generate=q("#smartSetGenerate"),copy=q("#smartSetCopy"),copyAnswers=q("#smartSetCopyAnswers"),worksheet=q("#smartSetWorksheet"),saveSet=q("#smartSetSave"),homework=q("#smartSetHomework"),hint=q("#smartSetHint");
    difficulty.value=initialDiff;
    let lastBatch=null,builderMode="single";

    const topicsForGrade=g=>taskTopics.filter(x=>Number(x.grade)===Number(g));
    const fillTopics=()=>{const rows=topicsForGrade(grade.value),current=topic.value;topic.innerHTML=rows.map(x=>'<option value="'+x.id+'">'+ctx.esc(x.section||"Математика")+' · '+ctx.esc(x.title)+'</option>').join("");if(rows.some(x=>String(x.id)===String(current)))topic.value=current};
    const resetResult=()=>{lastBatch=null;actions.hidden=true;status.hidden=true;list.innerHTML=""};
    const multiRowHtml=(selectedId="",value=3)=>{
      const rows=topicsForGrade(multiGrade.value),selected=rows.some(x=>String(x.id)===String(selectedId))?String(selectedId):String(rows[0]&&rows[0].id||"");
      return '<div class="mr-smart-multi-row"><select data-multi-topic>'+rows.map(x=>'<option value="'+x.id+'" '+(String(x.id)===selected?"selected":"")+'>'+ctx.esc(x.section||"Математика")+' · '+ctx.esc(x.title)+'</option>').join("")+'</select><label><span>Задач</span><input data-multi-count type="number" min="1" max="20" step="1" value="'+Math.max(1,Math.min(20,Number(value)||3))+'"></label><button type="button" class="mr-smart-multi-remove" title="Убрать тему">×</button></div>';
    };
    const updateMultiTotal=()=>{const total=[...multiRows.querySelectorAll("[data-multi-count]")].reduce((sum,input)=>sum+(Number(input.value)||0),0);multiTotal.textContent=total+" "+(total===1?"задача":total>=2&&total<=4?"задачи":"задач")+(total>30?" · максимум 30":"");multiTotal.classList.toggle("warn",total>30)};
    const bindMultiRows=()=>{
      multiRows.querySelectorAll("[data-multi-count],[data-multi-topic]").forEach(el=>{el.oninput=()=>{updateMultiTotal();resetResult()};el.onchange=()=>{updateMultiTotal();resetResult()}});
      multiRows.querySelectorAll(".mr-smart-multi-remove").forEach(button=>button.onclick=()=>{const rows=multiRows.querySelectorAll(".mr-smart-multi-row");if(rows.length<=2)return ctx.toast("Оставь минимум две темы");button.closest(".mr-smart-multi-row")?.remove();bindMultiRows();updateMultiTotal();resetResult()});
    };
    const resetMultiRows=()=>{const rows=topicsForGrade(multiGrade.value);multiRows.innerHTML=multiRowHtml(rows[0]&&rows[0].id||"",5)+multiRowHtml(rows[1]&&rows[1].id||rows[0]&&rows[0].id||"",5);bindMultiRows();updateMultiTotal();resetResult()};
    const addMultiRow=()=>{const rows=topicsForGrade(multiGrade.value),used=new Set([...multiRows.querySelectorAll("[data-multi-topic]")].map(x=>String(x.value))),next=rows.find(x=>!used.has(String(x.id)))||rows[0];if(!next)return ctx.toast("Нет доступных тем");multiRows.insertAdjacentHTML("beforeend",multiRowHtml(next.id,3));bindMultiRows();updateMultiTotal();resetResult()};
    const readMultiRows=()=>[...multiRows.querySelectorAll(".mr-smart-multi-row")].map(row=>({topicId:row.querySelector("[data-multi-topic]")?.value||"",count:Math.max(1,Math.min(20,Math.round(Number(row.querySelector("[data-multi-count]")?.value)||1)))}));
    const setMode=mode=>{builderMode=mode==="multi"?"multi":"single";singlePanel.hidden=builderMode!=="single";multiPanel.hidden=builderMode!=="multi";root.querySelectorAll("[data-smart-mode]").forEach(button=>button.classList.toggle("active",button.dataset.smartMode===builderMode));generate.textContent=builderMode==="multi"?"✦ Собрать по квотам":"✦ Собрать комплект";hint.textContent=builderMode==="multi"?"Каждая тема получает ровно свою квоту. Дубли отбрасываются по всему комплекту.":"Обычная задача не повторяется. Для генераторов система отдельно проверяет уникальность готового условия.";resetResult()};
    const copyBatch=async answers=>{
      if(!lastBatch||!lastBatch.items.length)return;
      let head="Комплект задач",quotaLines=[];
      if(lastBatch.multiTopic){head=[lastBatch.topicSnapshot&&lastBatch.topicSnapshot.grade?lastBatch.topicSnapshot.grade+" класс":"","Повторение по "+(lastBatch.topicQuotas||[]).length+" темам"].filter(Boolean).join(" · ");quotaLines=(lastBatch.topicQuotas||[]).map(x=>x.title+": "+x.count+" задач")}
      else{const tp=taskTopics.find(x=>String(x.id)===String(topic.value));if(tp)head=tp.grade+" класс · "+tp.title}
      const out=[head,"",...quotaLines,quotaLines.length?"":""];
      lastBatch.items.forEach((item,index)=>{out.push((index+1)+". "+item.content);if(answers)out.push("Ответ: "+(item.answer||"—"));out.push("")});
      await ctx.copyText(out.join("\n").trim());ctx.toast(answers?"Комплект с ответами скопирован":"Листок без ответов скопирован");
    };
    const renderBatch=batch=>{
      lastBatch=batch;const got=batch.items.length;status.hidden=false;status.className="mr-smart-set-status "+(batch.complete?"good":"warn");
      const topicInfo=batch.multiTopic?"Тем: "+(batch.topicQuotas||[]).length+" · "+(batch.topicQuotas||[]).map(x=>x.title+": "+batch.items.filter(item=>String(item.topic_id)===String(x.id)).length+"/"+x.count).join(" · "):(batch.counts.basic+" базовых · "+batch.counts.medium+" средних · "+batch.counts.advanced+" сложных");
      status.innerHTML=batch.complete?'<div><b>Готово: '+got+'/'+batch.requested+'</b><span>'+ctx.esc(topicInfo)+'</span></div><div><span>Источников: '+batch.uniqueSources+'</span><span>Сгенерировано: '+batch.generated+'</span>'+(batch.duplicates?'<span>Дублей отброшено: '+batch.duplicates+'</span>':'')+'</div>':'<div><b>Собрано '+got+'/'+batch.requested+'</b><span>'+ctx.esc(topicInfo)+'</span></div><div><span>Не хватило уникальных задач под выбранные квоты.</span><span>Дублей: '+batch.duplicates+'</span><span>Некорректных: '+batch.rejected+'</span>'+(batch.lastError?'<span>'+ctx.esc(batch.lastError)+'</span>':'')+'</div>';
      actions.hidden=!got;copy.disabled=!got;copyAnswers.disabled=!got;homework.disabled=!got||!students.length;
      list.innerHTML=got?batch.items.map((item,index)=>{
        const values=item.generated?ctx.templateVariantValues(item.builder_meta):"";
        return '<article class="mr-smart-set-card"><div class="mr-smart-set-card-num">'+String(index+1).padStart(2,"0")+'</div><div class="mr-smart-set-card-main"><div class="mr-smart-set-card-meta">'+(item.topic_title?'<span class="pill mr-smart-topic-pill">'+ctx.esc(item.topic_title)+'</span>':'')+'<span class="pill">'+ctx.diffLabel(item.difficulty)+'</span>'+(item.generated?'<span class="pill mr-template-pill">↻ вариант генератора</span>':'')+'<span class="small muted">'+ctx.esc(item.source&&item.source.title||"Задача")+'</span></div>'+ctx.taskConditionHtml(item.content,item.builder_meta,{textClass:"mr-smart-set-prompt"})+(values?'<div class="small muted mr-smart-set-values">'+ctx.esc(values)+'</div>':'')+'<div class="mr-smart-set-answer"><span>Ответ</span><b>'+ctx.nl(item.answer||"—")+'</b></div></div></article>';
      }).join(""):'<div class="empty">Под выбранные настройки комплект собрать не удалось.</div>';
      ctx.hydrateTaskMedia(list);ctx.typesetTaskMath(list);
    };

    grade.onchange=()=>{fillTopics();resetResult()};multiGrade.onchange=resetMultiRows;multiAdd.onclick=addMultiRow;root.querySelectorAll("[data-smart-mode]").forEach(button=>button.onclick=()=>setMode(button.dataset.smartMode));
    generate.onclick=()=>{
      if(builderMode==="multi"){
        const rows=readMultiRows(),total=rows.reduce((sum,row)=>sum+row.count,0),uniqueTopics=new Set(rows.map(x=>x.topicId));
        if(uniqueTopics.size<2)return ctx.toast("Выбери минимум две разные темы");
        if(total>30)return ctx.toast("В одном комплекте максимум 30 задач");
        renderBatch(buildMulti(ctx,{rows,difficulty:difficulty.value,allowTemplates:templates.checked}));
        return;
      }
      renderBatch(ctx.buildSmartTaskSet({topicId:topic.value,count:Number(count.value)||10,difficulty:difficulty.value,allowTemplates:templates.checked}));
    };
    copy.onclick=()=>copyBatch(false);copyAnswers.onclick=()=>copyBatch(true);
    worksheet.onclick=()=>{if(!lastBatch||!lastBatch.items.length)return ctx.toast("Сначала собери комплект");ctx.openSmartWorksheetBuilder(lastBatch,lastBatch.multiTopic?null:topic.value,{studentId:student.value})};
    saveSet.onclick=()=>{if(!lastBatch||!lastBatch.items.length)return ctx.toast("Сначала собери комплект");window.MathroomSavedSetsV84?.save?.({S:ctx.S,sb:ctx.sb,esc:ctx.esc,modal:ctx.modal,toast:ctx.toast,fail:ctx.fail},lastBatch,lastBatch.multiTopic?null:topic.value,{difficultyMode:difficulty.value,allowTemplates:templates.checked})};
    homework.onclick=async()=>{if(!lastBatch||!lastBatch.items.length)return;if(!student.value)return ctx.toast("Выбери ученика для домашней работы");homework.disabled=true;const result=await ctx.assignSmartTaskSetHomework(lastBatch,lastBatch.multiTopic?null:topic.value,student.value);if(!result)homework.disabled=false;else homework.textContent="✓ Домашняя назначена"};
    fillTopics();resetMultiRows();setMode("single");
  };

  window.MathroomMultiTopicSetsV85=API;
})();