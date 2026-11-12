(()=>{
  const API={};

  const recipeMeta=row=>{
    const cfg=row&&row.config&&typeof row.config==="object"?row.config:{};
    const mode=row&&row.mode==="multi"?"multi":"single";
    const difficulty=["balanced","basic","medium","advanced"].includes(row&&row.difficulty_mode)?row.difficulty_mode:"balanced";
    return {cfg,mode,difficulty,allowTemplates:row&&row.allow_templates!==false};
  };

  const batchSets=(ctx,batch)=>{
    const fingerprints=new Set(),sources=new Set();
    (batch&&batch.items||[]).forEach(item=>{
      fingerprints.add(ctx.taskVariantFingerprint(item));
      if(item&&item.source&&item.source.id)sources.add(String(item.source.id));
    });
    return {fingerprints,sources};
  };

  const overlapScore=(ctx,batch,usedFingerprints,usedSources)=>{
    let exact=0,source=0;
    (batch&&batch.items||[]).forEach(item=>{
      if(usedFingerprints.has(ctx.taskVariantFingerprint(item)))exact++;
      if(item&&item.source&&item.source.id&&usedSources.has(String(item.source.id)))source++;
    });
    return {exact,source,score:exact*100+source*3};
  };

  const buildSingle=(ctx,row)=>{
    const {cfg,difficulty,allowTemplates}=recipeMeta(row);
    const topicId=cfg.topic_id||cfg.topic_snapshot&&cfg.topic_snapshot.id||"";
    const count=Math.max(1,Math.min(30,Number(cfg.count)||10));
    const batch=ctx.buildSmartTaskSet({topicId,count,difficulty,allowTemplates});
    const topic=(ctx.S.topics||[]).find(x=>String(x.id)===String(topicId))||cfg.topic_snapshot||null;
    batch.topicSnapshot=topic?{id:topic.id||topicId,title:topic.title||"Тема",grade:topic.grade||row.grade||null,section:topic.section||""}:null;
    return batch;
  };

  const buildMulti=(ctx,row)=>{
    const {cfg,difficulty,allowTemplates}=recipeMeta(row);
    const rows=Array.isArray(cfg.rows)?cfg.rows:[];
    const items=[],seen=new Set(),topicSnapshots=[],topicQuotas=[];
    let requested=0,attempts=0,duplicates=0,rejected=0,fallbacks=0,lastError="";
    for(const recipeRow of rows){
      const topicId=recipeRow&&recipeRow.topic_id||recipeRow&&recipeRow.topic_snapshot&&recipeRow.topic_snapshot.id||"";
      const quota=Math.max(0,Math.min(20,Math.round(Number(recipeRow&&recipeRow.count)||0)));
      if(!topicId||!quota)continue;
      requested+=quota;
      const topic=(ctx.S.topics||[]).find(x=>String(x.id)===String(topicId))||recipeRow.topic_snapshot||null;
      if(!topic)continue;
      const snapshot={id:topic.id||topicId,title:topic.title||"Тема",grade:topic.grade||row.grade||null,section:topic.section||""};
      topicSnapshots.push(snapshot);topicQuotas.push({...snapshot,count:quota});
      let remaining=quota,cycles=0;
      while(remaining>0&&cycles<5){
        cycles++;
        const part=ctx.buildSmartTaskSet({topicId,count:Math.min(30,remaining+Math.min(5,remaining+3)),difficulty,allowTemplates});
        attempts+=part.attempts||0;duplicates+=part.duplicates||0;rejected+=part.rejected||0;fallbacks+=part.fallbacks||0;
        if(part.lastError)lastError=part.lastError;
        let added=0;
        for(const item of part.items||[]){
          if(remaining<=0)break;
          const fp=ctx.taskVariantFingerprint(item);
          if(seen.has(fp)){duplicates++;continue}
          seen.add(fp);
          items.push({...item,topic_id:snapshot.id,topic_title:snapshot.title,topic_grade:snapshot.grade,topic_section:snapshot.section});
          remaining--;added++;
        }
        if(!added)break;
      }
    }
    requested=Math.min(30,requested);
    if(items.length>requested)items.length=requested;
    const counts={basic:items.filter(x=>x.difficulty==="basic").length,medium:items.filter(x=>x.difficulty==="medium").length,advanced:items.filter(x=>x.difficulty==="advanced").length};
    const grades=[...new Set(topicSnapshots.map(x=>Number(x.grade)).filter(Boolean))];
    return {
      requested,items,attempts,duplicates,rejected,fallbacks,lastError,
      generated:items.filter(x=>x.generated).length,
      uniqueSources:new Set(items.map(x=>String(x.source&&x.source.id||""))).size,
      counts,complete:items.length===requested,multiTopic:true,topicSnapshots,topicQuotas,
      topicSnapshot:{id:null,title:"Параллельный вариант",grade:grades.length===1?grades[0]:row.grade||null,section:topicSnapshots.map(x=>x.title).join(" · ")}
    };
  };

  const buildOne=(ctx,row)=>recipeMeta(row).mode==="multi"?buildMulti(ctx,row):buildSingle(ctx,row);

  const bestCandidate=(ctx,row,usedFingerprints,usedSources)=>{
    let best=null,bestOverlap=null;
    const tries=6;
    for(let i=0;i<tries;i++){
      const batch=buildOne(ctx,row);
      if(!batch||!batch.items||!batch.items.length)continue;
      const overlap=overlapScore(ctx,batch,usedFingerprints,usedSources);
      if(!best||overlap.score<bestOverlap.score||(overlap.score===bestOverlap.score&&batch.items.length>best.items.length)){
        best=batch;bestOverlap=overlap;
      }
      if(batch.complete&&overlap.exact===0&&overlap.source===0)break;
    }
    return best?{batch:best,overlap:bestOverlap}:{batch:null,overlap:{exact:0,source:0,score:0}};
  };

  const generateAll=(ctx,row,count)=>{
    const usedFingerprints=new Set(),usedSources=new Set(),variants=[];
    let exactTotal=0,sourceTotal=0;
    for(let index=0;index<count;index++){
      const picked=bestCandidate(ctx,row,usedFingerprints,usedSources);
      if(!picked.batch)break;
      const sets=batchSets(ctx,picked.batch);
      sets.fingerprints.forEach(x=>usedFingerprints.add(x));
      sets.sources.forEach(x=>usedSources.add(x));
      exactTotal+=picked.overlap.exact;sourceTotal+=picked.overlap.source;
      variants.push({
        index:index+1,
        label:"Вариант "+(index+1),
        batch:picked.batch,
        exactOverlap:picked.overlap.exact,
        sourceOverlap:picked.overlap.source
      });
    }
    return {variants,exactTotal,sourceTotal,complete:variants.length===count};
  };

  const copyAllText=(row,result,answers)=>{
    const out=[row&&row.title||"Параллельные варианты",""];
    result.variants.forEach(v=>{
      out.push(v.label);
      out.push("=".repeat(v.label.length));
      (v.batch.items||[]).forEach((item,index)=>{
        out.push((index+1)+". "+String(item.content||""));
        if(answers)out.push("Ответ: "+String(item.answer||"—"));
        out.push("");
      });
      out.push("");
    });
    return out.join("\n").trim();
  };

  const openVariant=(ctx,row,variant)=>{
    const batch=variant.batch;
    const students=ctx.S.students||[];
    const topicId=batch.multiTopic?null:(row.config&&row.config.topic_id||row.config&&row.config.topic_snapshot&&row.config.topic_snapshot.id||null);
    const root=ctx.modal(
      '<section class="mr-parallel-open">'+
        '<div class="mr-parallel-open-head"><div><span class="pill mr-parallel-pill">'+ctx.esc(variant.label)+'</span><h2>'+ctx.esc(row.title||"Параллельный вариант")+'</h2><p class="muted">'+batch.items.length+' задач · точных совпадений с предыдущими: '+variant.exactOverlap+' · повторов источников: '+variant.sourceOverlap+'</p></div>'+
        '<div class="actions"><button class="btn sm" id="parallelCopyOne">Копировать</button><button class="btn sm mr-smart-set-sheet" id="parallelPdfOne">A4 / PDF</button><button class="btn sm mr-save-smart-set" id="parallelSaveOne">Сохранить комплект</button></div></div>'+
        '<div class="mr-parallel-assign"><label><span>Назначить ученику</span><select id="parallelStudent"><option value="">Не выбран</option>'+students.map(s=>'<option value="'+s.id+'">'+ctx.esc(s.name)+' · '+(s.grade||"?")+' кл.</option>').join("")+'</select></label><button class="btn primary" id="parallelAssign" '+(students.length?"":"disabled")+'>Назначить этот вариант</button></div>'+
        '<div class="mr-parallel-task-list">'+batch.items.map((item,index)=>'<article class="mr-smart-set-card"><div class="mr-smart-set-card-num">'+String(index+1).padStart(2,"0")+'</div><div class="mr-smart-set-card-main"><div class="mr-smart-set-card-meta">'+(item.topic_title?'<span class="pill mr-smart-topic-pill">'+ctx.esc(item.topic_title)+'</span>':'')+'<span class="pill">'+ctx.diffLabel(item.difficulty)+'</span>'+(item.generated?'<span class="pill mr-template-pill">↻ вариант генератора</span>':'')+'</div>'+ctx.taskConditionHtml(item.content,item.builder_meta,{textClass:"mr-smart-set-prompt"})+'<div class="mr-smart-set-answer"><span>Ответ</span><b>'+ctx.nl(item.answer||"—")+'</b></div></div></article>').join("")+'</div>'+
      '</section>',
      "mr-parallel-open-modal"
    );
    ctx.hydrateTaskMedia(root);ctx.typesetTaskMath(root);
    root.querySelector("#parallelCopyOne").onclick=async()=>{
      const text=[variant.label,"",...batch.items.flatMap((item,index)=>[(index+1)+". "+item.content,""])].join("\n").trim();
      await ctx.copyText(text);ctx.toast(variant.label+" скопирован");
    };
    root.querySelector("#parallelPdfOne").onclick=()=>ctx.openSmartWorksheetBuilder(batch,topicId,{});
    root.querySelector("#parallelSaveOne").onclick=()=>window.MathroomSavedSetsV84?.save?.(
      {S:ctx.S,sb:ctx.sb,esc:ctx.esc,modal:ctx.modal,toast:ctx.toast,fail:ctx.fail},
      batch,topicId,{difficultyMode:row.difficulty_mode||"balanced",allowTemplates:row.allow_templates!==false}
    );
    const assign=root.querySelector("#parallelAssign");
    if(assign)assign.onclick=async()=>{
      const studentId=root.querySelector("#parallelStudent").value||"";
      if(!studentId)return ctx.toast("Выбери ученика");
      assign.disabled=true;
      const res=await ctx.assignSmartTaskSetHomework(batch,topicId,studentId,{title:(row.title||"Работа")+" · "+variant.label});
      if(!res)assign.disabled=false;else assign.textContent="✓ Назначено";
    };
  };

  API.open=(ctx,row)=>{
    if(!row)return ctx.toast("Рецепт не найден");
    const root=ctx.modal(
      '<section class="mr-parallel-lab">'+
        '<div class="mr-parallel-head"><div><span class="pill mr-parallel-pill">Параллельные варианты</span><h2>'+ctx.esc(row.title||"Рецепт")+'</h2><p class="muted">Mathroom несколько раз пересоберёт рецепт и выберет комбинации с минимальным пересечением готовых задач.</p></div>'+
        '<div class="mr-parallel-controls"><span>Вариантов</span><div class="mr-parallel-counts"><button type="button" data-parallel-count="2">2</button><button type="button" data-parallel-count="3">3</button><button type="button" class="active" data-parallel-count="4">4</button></div><button class="btn primary" id="parallelGenerate">Собрать варианты</button></div></div>'+
        '<div id="parallelStatus" class="mr-parallel-status" hidden></div>'+
        '<div id="parallelActions" class="mr-parallel-actions" hidden><button class="btn sm" id="parallelCopyAll">Скопировать все</button><button class="btn sm" id="parallelCopyAnswers">Все с ответами</button></div>'+
        '<div id="parallelGrid" class="mr-parallel-grid"></div>'+
      '</section>',
      "mr-parallel-modal"
    );
    const grid=root.querySelector("#parallelGrid"),status=root.querySelector("#parallelStatus"),actions=root.querySelector("#parallelActions"),generate=root.querySelector("#parallelGenerate");
    let wanted=4,lastResult=null;
    root.querySelectorAll("[data-parallel-count]").forEach(button=>button.onclick=()=>{
      wanted=Number(button.dataset.parallelCount)||4;
      root.querySelectorAll("[data-parallel-count]").forEach(x=>x.classList.toggle("active",x===button));
    });
    const renderResult=result=>{
      lastResult=result;status.hidden=false;actions.hidden=!result.variants.length;
      status.className="mr-parallel-status "+(result.complete?"good":"warn");
      const totalTasks=result.variants.reduce((sum,v)=>sum+v.batch.items.length,0);
      status.innerHTML='<div><b>Собрано '+result.variants.length+'/'+wanted+' вариантов</b><span>'+totalTasks+' задач суммарно</span></div><div><span>Точных повторов между вариантами: '+result.exactTotal+'</span><span>Повторов исходников с другими числами: '+result.sourceTotal+'</span></div>';
      grid.innerHTML=result.variants.map(v=>{
        const complete=v.batch.complete;
        const topicInfo=v.batch.multiTopic?(v.batch.topicQuotas||[]).map(x=>x.title+" · "+x.count).join(" / "):(v.batch.topicSnapshot&&v.batch.topicSnapshot.title||"Одна тема");
        return '<article class="mr-parallel-card">'+
          '<div class="mr-parallel-card-top"><span class="mr-parallel-number">'+v.index+'</span><div><h3>'+ctx.esc(v.label)+'</h3><p>'+ctx.esc(topicInfo)+'</p></div><span class="pill '+(complete?"":"warn")+'">'+v.batch.items.length+'/'+v.batch.requested+'</span></div>'+
          '<div class="mr-parallel-overlap"><span><b>'+v.exactOverlap+'</b> точных повторов</span><span><b>'+v.sourceOverlap+'</b> повторов источника</span><span><b>'+v.batch.generated+'</b> сгенерировано</span></div>'+
          '<div class="mr-parallel-preview">'+v.batch.items.slice(0,4).map((item,i)=>'<div><b>'+(i+1)+'.</b> <span>'+ctx.esc(String(item.content||"").replace(/\s+/g," ").slice(0,120))+(String(item.content||"").length>120?"…":"")+'</span></div>').join("")+(v.batch.items.length>4?'<small>＋ ещё '+(v.batch.items.length-4)+'</small>':'')+'</div>'+
          '<button class="btn sm primary" data-parallel-open="'+v.index+'">Открыть вариант</button>'+
        '</article>';
      }).join("");
      grid.querySelectorAll("[data-parallel-open]").forEach(button=>button.onclick=()=>{
        const variant=result.variants.find(v=>String(v.index)===String(button.dataset.parallelOpen));
        if(variant)openVariant(ctx,row,variant);
      });
    };
    generate.onclick=async()=>{
      generate.disabled=true;generate.textContent="Собираю…";
      await new Promise(r=>setTimeout(r,20));
      try{
        const result=generateAll(ctx,row,wanted);
        renderResult(result);
        try{
          const update=await ctx.sb.from("task_set_recipes").update({use_count:(Number(row.use_count)||0)+1,last_used_at:new Date().toISOString()}).eq("id",row.id).select().single();
          if(!update.error&&update.data)ctx.S.taskSetRecipes=(ctx.S.taskSetRecipes||[]).map(x=>String(x.id)===String(row.id)?update.data:x);
        }catch{}
      }catch(error){ctx.fail(error)}
      finally{generate.disabled=false;generate.textContent="Собрать заново"}
    };
    root.querySelector("#parallelCopyAll").onclick=async()=>{if(!lastResult)return;await ctx.copyText(copyAllText(row,lastResult,false));ctx.toast("Все варианты скопированы")};
    root.querySelector("#parallelCopyAnswers").onclick=async()=>{if(!lastResult)return;await ctx.copyText(copyAllText(row,lastResult,true));ctx.toast("Все варианты с ответами скопированы")};
  };

  window.MathroomParallelVariantsV87=API;
})();