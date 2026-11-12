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


  const shuffled=list=>{
    const out=[...list];
    for(let i=out.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  };

  const distributionTopicId=(row,batch)=>{
    if(batch&&batch.multiTopic)return null;
    const cfg=row&&row.config&&typeof row.config==="object"?row.config:{};
    return cfg.topic_id||cfg.topic_snapshot&&cfg.topic_snapshot.id||batch&&batch.topicSnapshot&&batch.topicSnapshot.id||null;
  };

  const buildDistributionAssignments=(students,variants,{shuffleStudents=false}={})=>{
    const ordered=shuffleStudents?shuffled(students):[...students];
    return ordered.map((student,index)=>({
      student,
      variant:variants[index%variants.length],
      position:index
    }));
  };

  const assignDistribution=async(ctx,row,assignments)=>{
    if(!assignments.length)return {ok:false,error:"Не выбраны ученики"};
    const distributionId=(globalThis.crypto&&typeof globalThis.crypto.randomUUID==="function")
      ?globalThis.crypto.randomUUID()
      :"dist-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    const parents=assignments.map((entry,index)=>{
      const batch=entry.variant.batch;
      const topicId=distributionTopicId(row,batch);
      return {
        teacher_id:ctx.S.user.id,
        student_id:entry.student.id,
        topic_id:topicId,
        title:(row.title||"Работа")+" · "+entry.variant.label,
        source:"smart_set",
        smart_meta:{
          multi_topic:!!batch.multiTopic,
          topic_snapshots:batch.topicSnapshots||[],
          topic_quotas:batch.topicQuotas||[],
          recipe_id:row.id||null,
          parallel_distribution_id:distributionId,
          parallel_distribution_slot:index,
          parallel_variant_index:entry.variant.index,
          parallel_variant_label:entry.variant.label
        }
      };
    });
    const parentRes=await ctx.sb.from("homeworks").insert(parents).select("id,student_id,smart_meta");
    if(parentRes.error)throw parentRes.error;
    const created=parentRes.data||[];
    const bySlot=new Map(created.map(hw=>[Number(hw.smart_meta&&hw.smart_meta.parallel_distribution_slot),hw]));
    const items=[];
    assignments.forEach((entry,index)=>{
      const parent=bySlot.get(index);
      if(!parent)return;
      (entry.variant.batch.items||[]).forEach((item,position)=>{
        items.push({
          homework_id:parent.id,
          prompt:item.content,
          correct_answer:item.answer,
          position,
          source_exercise_id:(ctx.S.exercises||[]).some(x=>String(x.id)===String(item.source&&item.source.id))?item.source.id:null,
          difficulty:item.difficulty,
          category:item.category||"",
          tags:item.tags||[],
          builder_meta:{
            ...(item.builder_meta||{}),
            smart_topic:item.topic_id?{
              id:item.topic_id,
              title:item.topic_title||"",
              grade:item.topic_grade||null,
              section:item.topic_section||""
            }:undefined,
            parallel_variant:{
              distribution_id:distributionId,
              index:entry.variant.index,
              label:entry.variant.label
            }
          }
        });
      });
    });
    if(created.length!==assignments.length){
      if(created.length)await ctx.sb.from("homeworks").delete().in("id",created.map(x=>x.id));
      throw new Error("Не удалось создать все домашние работы");
    }
    if(items.length){
      const itemRes=await ctx.sb.from("homework_items").insert(items);
      if(itemRes.error){
        await ctx.sb.from("homeworks").delete().in("id",created.map(x=>x.id));
        throw itemRes.error;
      }
    }
    if(ctx.loadTeacher)await ctx.loadTeacher();
    return {ok:true,distributionId,homeworks:created.length,items:items.length};
  };

  const openDistribution=(ctx,row,result)=>{
    if(!result||!result.variants||!result.variants.length)return ctx.toast("Сначала собери параллельные варианты");
    const students=(ctx.S.students||[]).filter(s=>s&&s.active!==false);
    if(!students.length)return ctx.toast("Нет активных учеников для раздачи");
    const grades=[...new Set(students.map(s=>Number(s.grade)).filter(Boolean))].sort((a,b)=>a-b);
    const recipeGrade=Number(row&&row.grade)||0;
    const defaultGrade=grades.includes(recipeGrade)?String(recipeGrade):"";
    const groups=[...new Set(students.map(s=>String(s.group_name||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));
    const root=ctx.modal(
      '<section class="mr-distribute">'+
        '<div class="mr-distribute-head"><div><span class="pill mr-parallel-pill">Раздача вариантов</span><h2>'+ctx.esc(row.title||"Работа")+'</h2><p class="muted">'+result.variants.length+' варианта будут распределяться по кругу между выбранными учениками.</p></div></div>'+
        '<div class="mr-distribute-filters">'+
          '<label><span>Класс</span><select id="distGrade"><option value="">Все классы</option>'+grades.map(g=>'<option value="'+g+'" '+(String(g)===defaultGrade?"selected":"")+'>'+g+' класс</option>').join("")+'</select></label>'+
          '<label><span>Группа</span><select id="distGroup"><option value="">Все группы</option>'+groups.map(g=>'<option value="'+ctx.esc(g)+'">'+ctx.esc(g)+'</option>').join("")+'</select></label>'+
          '<label class="wide"><span>Поиск</span><input id="distSearch" placeholder="Имя ученика"></label>'+
          '<label class="mr-distribute-shuffle"><input type="checkbox" id="distShuffle"><span><b>Перемешать учеников</b><small>Перед циклической раздачей</small></span></label>'+
        '</div>'+
        '<div class="mr-distribute-tools"><div><button class="btn sm" id="distSelectVisible">Выбрать видимых</button><button class="btn sm" id="distClear">Снять выбор</button></div><b id="distSelectedCount">0 учеников</b></div>'+
        '<div class="mr-distribute-body">'+
          '<div class="mr-distribute-students"><div id="distStudents" class="mr-distribute-student-list"></div></div>'+
          '<div class="mr-distribute-preview"><div class="mr-distribute-preview-head"><h3>Предпросмотр раздачи</h3><span id="distVariantBalance"></span></div><div id="distPreviewList" class="mr-distribute-preview-list"></div></div>'+
        '</div>'+
        '<div class="mr-distribute-footer"><div class="small muted">Каждому ученику создаётся отдельное ДЗ с конкретным зафиксированным вариантом.</div><button class="btn primary" id="distAssign" disabled>Назначить выбранным</button></div>'+
      '</section>',
      "mr-distribute-modal"
    );

    const grade=root.querySelector("#distGrade"),group=root.querySelector("#distGroup"),search=root.querySelector("#distSearch"),shuffle=root.querySelector("#distShuffle");
    const host=root.querySelector("#distStudents"),preview=root.querySelector("#distPreviewList"),balance=root.querySelector("#distVariantBalance"),countLabel=root.querySelector("#distSelectedCount"),assign=root.querySelector("#distAssign");
    const selected=new Set();

    const filtered=()=>{
      const q=String(search.value||"").trim().toLocaleLowerCase("ru");
      return students.filter(s=>{
        if(grade.value&&String(s.grade)!==String(grade.value))return false;
        if(group.value&&String(s.group_name||"")!==String(group.value))return false;
        if(q&&!String(s.name||"").toLocaleLowerCase("ru").includes(q))return false;
        return true;
      });
    };

    const selectedStudents=()=>students.filter(s=>selected.has(String(s.id))).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ru"));

    const drawPreview=()=>{
      const picked=selectedStudents();
      const assignments=buildDistributionAssignments(picked,result.variants,{shuffleStudents:shuffle.checked});
      countLabel.textContent=picked.length+" "+(picked.length===1?"ученик":picked.length>=2&&picked.length<=4?"ученика":"учеников");
      assign.disabled=!assignments.length;
      const counts=new Map(result.variants.map(v=>[v.index,0]));
      assignments.forEach(x=>counts.set(x.variant.index,(counts.get(x.variant.index)||0)+1));
      balance.textContent=result.variants.map(v=>v.label+": "+(counts.get(v.index)||0)).join(" · ");
      preview.innerHTML=assignments.length?assignments.map((entry,index)=>
        '<div class="mr-distribute-preview-row"><span>'+String(index+1).padStart(2,"0")+'</span><b>'+ctx.esc(entry.student.name||"Ученик")+'</b><small>'+ctx.esc(entry.student.group_name||((entry.student.grade||"?")+" класс"))+'</small><i>→</i><strong>'+ctx.esc(entry.variant.label)+'</strong></div>'
      ).join(""):'<div class="empty">Выбери учеников слева — здесь появится распределение.</div>';
    };

    const drawStudents=()=>{
      const rows=filtered();
      host.innerHTML=rows.length?rows.map(s=>{
        const checked=selected.has(String(s.id));
        return '<label class="mr-distribute-student '+(checked?"selected":"")+'"><input type="checkbox" data-dist-student="'+s.id+'" '+(checked?"checked":"")+'><span class="mr-distribute-avatar">'+ctx.esc(String(s.name||"?").trim().charAt(0).toUpperCase()||"?")+'</span><span><b>'+ctx.esc(s.name||"Ученик")+'</b><small>'+(s.grade||"?")+' класс'+(s.group_name?" · "+ctx.esc(s.group_name):"")+'</small></span></label>';
      }).join(""):'<div class="empty">По этим фильтрам учеников нет.</div>';
      host.querySelectorAll("[data-dist-student]").forEach(input=>input.onchange=()=>{
        const id=String(input.dataset.distStudent);
        if(input.checked)selected.add(id);else selected.delete(id);
        input.closest(".mr-distribute-student")?.classList.toggle("selected",input.checked);
        drawPreview();
      });
    };

    const redraw=()=>{drawStudents();drawPreview()};
    grade.onchange=redraw;group.onchange=redraw;search.oninput=drawStudents;shuffle.onchange=drawPreview;
    root.querySelector("#distSelectVisible").onclick=()=>{filtered().forEach(s=>selected.add(String(s.id)));redraw()};
    root.querySelector("#distClear").onclick=()=>{selected.clear();redraw()};

    if(defaultGrade)filtered().forEach(s=>selected.add(String(s.id)));
    redraw();

    assign.onclick=async()=>{
      const picked=selectedStudents();
      if(!picked.length)return ctx.toast("Выбери хотя бы одного ученика");
      const assignments=buildDistributionAssignments(picked,result.variants,{shuffleStudents:shuffle.checked});
      assign.disabled=true;assign.textContent="Назначаю…";
      try{
        const summary=await assignDistribution(ctx,row,assignments);
        if(summary.ok){
          root.querySelector(".mr-distribute-body").innerHTML=
            '<div class="mr-distribute-success"><span>✓</span><div><h3>Варианты распределены</h3><p>'+summary.homeworks+' ученикам назначены отдельные домашние работы. Всего добавлено '+summary.items+' заданий.</p></div></div>';
          root.querySelector(".mr-distribute-tools").remove();
          root.querySelector(".mr-distribute-filters").remove();
          root.querySelector(".mr-distribute-footer .small").textContent="Раздача завершена. Конкретный вариант каждого ученика зафиксирован в его ДЗ.";
          assign.textContent="Готово";
          ctx.toast("Варианты назначены "+summary.homeworks+" ученикам");
        }
      }catch(error){ctx.fail(error);assign.disabled=false;assign.textContent="Назначить выбранным"}
    };
  };

  API.open=(ctx,row)=>{
    if(!row)return ctx.toast("Рецепт не найден");
    const root=ctx.modal(
      '<section class="mr-parallel-lab">'+
        '<div class="mr-parallel-head"><div><span class="pill mr-parallel-pill">Параллельные варианты</span><h2>'+ctx.esc(row.title||"Рецепт")+'</h2><p class="muted">Mathroom несколько раз пересоберёт рецепт и выберет комбинации с минимальным пересечением готовых задач.</p></div>'+
        '<div class="mr-parallel-controls"><span>Вариантов</span><div class="mr-parallel-counts"><button type="button" data-parallel-count="2">2</button><button type="button" data-parallel-count="3">3</button><button type="button" class="active" data-parallel-count="4">4</button></div><button class="btn primary" id="parallelGenerate">Собрать варианты</button></div></div>'+
        '<div id="parallelStatus" class="mr-parallel-status" hidden></div>'+
        '<div id="parallelActions" class="mr-parallel-actions" hidden><button class="btn sm" id="parallelCopyAll">Скопировать все</button><button class="btn sm" id="parallelCopyAnswers">Все с ответами</button><button class="btn sm primary mr-distribute-launch" id="parallelDistribute">Распределить ученикам</button></div>'+
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
    root.querySelector("#parallelDistribute").onclick=()=>openDistribution(ctx,row,lastResult);
  };

  window.MathroomParallelVariantsV87=API;
})();