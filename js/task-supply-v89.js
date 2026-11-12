
(()=>{
  const API={};
  const DEFAULTS={target_basic:20,target_medium:30,target_advanced:15,target_generators:5,max_tasks_per_run:30,auto_accept_ready:false};

  const safeJson=v=>{
    if(v&&typeof v==="object")return v;
    try{return JSON.parse(String(v||"{}"))}catch{return {}}
  };

  const isValidTask=x=>x&&x.kind==="task"&&!x.is_draft&&String(x.answer||"").trim();

  const sourceKind=(ctx,ex)=>{
    if(ctx.isTemplateExercise&&ctx.isTemplateExercise(ex))return "generator";
    const tags=Array.isArray(ex&&ex.tags)?ex.tags.map(String):[];
    const spec=safeJson(ex&&ex.generator_spec);
    if(tags.includes("ai-pipeline-v1")||tags.includes("ai-generated")||spec.type==="ai_pipeline_v1")return "ai";
    if(tags.some(x=>x.startsWith("mathroom-xlsx"))||spec.type==="xlsx_import")return "xlsx";
    if(tags.some(x=>x.startsWith("mathroom-core-bank-v")||x.startsWith("mrseed:")))return "core";
    return "manual";
  };

  const sourceSummary=(ctx,rows)=>{
    const out={generator:0,ai:0,xlsx:0,core:0,manual:0,total:0};
    for(const ex of rows){const k=sourceKind(ctx,ex);out[k]=(out[k]||0)+1;out.total++}
    return out;
  };

  const loadSettings=async ctx=>{
    const r=await ctx.sb.from("task_supply_settings").select("*").eq("teacher_id",ctx.S.user.id).maybeSingle();
    if(r.error)throw r.error;
    if(r.data)return Object.assign({},DEFAULTS,r.data);
    const c=await ctx.sb.from("task_supply_settings").insert(Object.assign({teacher_id:ctx.S.user.id},DEFAULTS)).select().single();
    if(c.error)throw c.error;
    return Object.assign({},DEFAULTS,c.data);
  };

  const saveSettings=async(ctx,s)=>{
    const body={
      teacher_id:ctx.S.user.id,
      target_basic:Number(s.target_basic)||0,
      target_medium:Number(s.target_medium)||0,
      target_advanced:Number(s.target_advanced)||0,
      target_generators:Number(s.target_generators)||0,
      max_tasks_per_run:Number(s.max_tasks_per_run)||30,
      auto_accept_ready:!!s.auto_accept_ready,
      updated_at:new Date().toISOString()
    };
    const r=await ctx.sb.from("task_supply_settings").upsert(body,{onConflict:"teacher_id"}).select().single();
    if(r.error)throw r.error;
    return Object.assign({},DEFAULTS,r.data);
  };

  const audit=(ctx,settings)=>{
    const tasks=(ctx.S.exercises||[]).filter(isValidTask);
    const grouped=new Map();
    for(const ex of tasks){
      const id=String(ex.topic_id||"");
      if(!grouped.has(id))grouped.set(id,[]);
      grouped.get(id).push(ex);
    }
    return (ctx.S.topics||[]).map(topic=>{
      const rows=grouped.get(String(topic.id))||[];
      const counts={
        basic:rows.filter(x=>x.difficulty==="basic").length,
        medium:rows.filter(x=>x.difficulty==="medium").length,
        advanced:rows.filter(x=>x.difficulty==="advanced").length,
        generators:rows.filter(x=>ctx.isTemplateExercise&&ctx.isTemplateExercise(x)).length
      };
      const targets={
        basic:Number(settings.target_basic)||0,
        medium:Number(settings.target_medium)||0,
        advanced:Number(settings.target_advanced)||0,
        generators:Number(settings.target_generators)||0
      };
      const deficit={
        basic:Math.max(0,targets.basic-counts.basic),
        medium:Math.max(0,targets.medium-counts.medium),
        advanced:Math.max(0,targets.advanced-counts.advanced),
        generators:Math.max(0,targets.generators-counts.generators)
      };
      const total=targets.basic+targets.medium+targets.advanced+targets.generators;
      const covered=Math.min(counts.basic,targets.basic)+Math.min(counts.medium,targets.medium)+Math.min(counts.advanced,targets.advanced)+Math.min(counts.generators,targets.generators);
      return {
        topic,counts,targets,deficit,
        percent:total?Math.round(covered/total*100):100,
        ordinaryDeficit:deficit.basic+deficit.medium+deficit.advanced,
        totalDeficit:deficit.basic+deficit.medium+deficit.advanced+deficit.generators
      };
    }).sort((a,b)=>a.percent-b.percent||Number(a.topic.grade)-Number(b.topic.grade)||String(a.topic.title).localeCompare(String(b.topic.title),"ru"));
  };

  const planFor=(rows,selected,settings)=>{
    let budget=Math.max(1,Math.min(100,Number(settings.max_tasks_per_run)||30));
    const plan=[];
    const chosen=rows.filter(r=>selected.has(String(r.topic.id))).sort((a,b)=>b.ordinaryDeficit-a.ordinaryDeficit||a.percent-b.percent);
    for(const row of chosen){
      for(const difficulty of ["medium","basic","advanced"]){
        let remaining=Math.min(Number(row.deficit[difficulty])||0,budget);
        while(remaining>0&&budget>0){
          const requested=Math.min(20,remaining,budget);
          plan.push({topicId:row.topic.id,topicTitle:row.topic.title,grade:row.topic.grade,difficulty,requested,target:row.targets[difficulty],current:row.counts[difficulty],shortage:row.deficit[difficulty]});
          remaining-=requested;budget-=requested;
        }
        if(budget<=0)break;
      }
      if(budget<=0)break;
    }
    return plan;
  };

  API.render=async ctx=>{
    const S=ctx.S,sb=ctx.sb,esc=ctx.esc,toast=ctx.toast,fail=ctx.fail;
    let settings=Object.assign({},DEFAULTS),health={ai_configured:false},jobs=[],candidates=[];
    let selected=new Set(),grade="",query="",deficitsOnly=true,running=false,lastRun="";

    const top='<div class="mr-supply-top"><button id="supplyBack" class="ghost">← В банк задач</button><div><button id="supplyPipeline">Карантин</button><button id="supplyRefresh">↻ Обновить</button></div></div>';

    const load=async()=>{
      try{
        ctx.app.innerHTML=ctx.shell('<div class="mr-supply-loading"><span></span><b>Проверяем покрытие банка…</b></div>','Фабрика задач','Источники, аудит и автоматическое пополнение',top);
        ctx.bindShell();
        bindTop();
        const results=await Promise.all([
          loadSettings(ctx),
          sb.functions.invoke("task-pipeline",{body:{action:"health"}}),
          sb.from("task_generation_jobs").select("*").eq("teacher_id",S.user.id).order("created_at",{ascending:false}).limit(80),
          sb.from("task_candidates").select("id,status,confidence,topic_id,job_id").eq("teacher_id",S.user.id).order("created_at",{ascending:false}).limit(500)
        ]);
        settings=results[0];
        health=results[1].error?{ai_configured:false,error:results[1].error.message||"AI недоступен"}:(results[1].data||health);
        if(results[2].error)throw results[2].error;
        if(results[3].error)throw results[3].error;
        jobs=results[2].data||[];
        candidates=results[3].data||[];
        draw();
      }catch(e){fail(e)}
    };

    const bindTop=()=>{
      const back=document.getElementById("supplyBack"),pipe=document.getElementById("supplyPipeline"),refresh=document.getElementById("supplyRefresh");
      if(back)back.onclick=()=>ctx.openBank();
      if(pipe)pipe.onclick=()=>ctx.openPipeline({mode:"review"});
      if(refresh)refresh.onclick=()=>load();
    };

    const draw=()=>{
      const rows=audit(ctx,settings);
      const tasks=(S.exercises||[]).filter(isValidTask);
      const sources=sourceSummary(ctx,tasks);
      const ordinaryMissing=rows.reduce((n,r)=>n+r.ordinaryDeficit,0);
      const generatorMissing=rows.reduce((n,r)=>n+r.deficit.generators,0);
      const average=rows.length?Math.round(rows.reduce((n,r)=>n+r.percent,0)/rows.length):100;
      const ready=candidates.filter(x=>x.status==="ready").length;
      const review=candidates.filter(x=>x.status==="review").length;
      const active=jobs.filter(x=>x.status==="queued"||x.status==="running").length;
      const grades=[...new Set(rows.map(r=>Number(r.topic.grade)).filter(Boolean))].sort((a,b)=>a-b);

      let html='<div class="mr-supply">';
      html+='<section class="mr-supply-hero"><div><span class="mr-supply-kicker">TASK SUPPLY ENGINE · v89</span><h1>Банк, который сам показывает дефициты</h1><p>Покрытие по каждой теме → план недостающих задач → AI-генерация → независимая проверка → дедупликация → карантин → основной банк.</p></div>';
      html+='<aside class="mr-supply-health '+(health.ai_configured?"ok":"warn")+'"><span></span><div><b>'+(health.ai_configured?"AI-фабрика готова":"AI-фабрика не подключена")+'</b><small>'+(health.ai_configured?esc((health.model||"model")+" · validator "+(health.validator_model||health.model||"")):"Нужен OPENAI_API_KEY в Supabase")+'</small></div></aside></section>';

      html+='<section class="mr-supply-kpis">';
      html+='<article><span>Покрытие</span><b>'+average+'%</b><small>'+rows.length+' тем</small></article>';
      html+='<article><span>Не хватает задач</span><b>'+ordinaryMissing+'</b><small>basic / medium / advanced</small></article>';
      html+='<article><span>Не хватает генераторов</span><b>'+generatorMissing+'</b><small>отдельный слой</small></article>';
      html+='<article><span>Карантин</span><b>'+(ready+review)+'</b><small>'+ready+' ready · '+review+' review</small></article>';
      html+='<article><span>Активные jobs</span><b>'+active+'</b><small>queued / running</small></article></section>';

      html+='<section class="mr-supply-card"><div class="mr-supply-card-head"><div><span class="mr-supply-section-icon">◎</span><div><h2>Источники банка</h2><p>Реальный состав личного банка задач.</p></div></div></div>';
      html+='<div class="mr-supply-sources">';
      html+=sourceCard("AI",sources.ai,"AI после проверки","ai");
      html+=sourceCard("↻",sources.generator,"параметрические шаблоны","gen");
      html+=sourceCard("X",sources.xlsx,"импорт XLSX","xlsx");
      html+=sourceCard("K",sources.core,"готовая база","core");
      html+=sourceCard("✎",sources.manual,"ручные / прочие","manual");
      html+='</div><div class="mr-supply-source-actions"><button class="btn sm" id="supplyManual">✦ Ручная AI-генерация</button><button class="btn sm" id="supplyXlsx">Импорт XLSX</button><button class="btn sm" id="supplyReview">Карантин <b>'+(ready+review)+'</b></button></div></section>';

      html+='<section class="mr-supply-card"><div class="mr-supply-card-head"><div><span class="mr-supply-section-icon">⌁</span><div><h2>Целевое покрытие темы</h2><p>Пороги для аудита и автопополнения.</p></div></div><button class="btn sm" id="supplySave">Сохранить</button></div>';
      html+='<div class="mr-supply-targets">';
      html+=targetInput("supplyBasic","Базовых",settings.target_basic,0,200);
      html+=targetInput("supplyMedium","Средних",settings.target_medium,0,200);
      html+=targetInput("supplyAdvanced","Сложных",settings.target_advanced,0,200);
      html+=targetInput("supplyGenerators","Генераторов",settings.target_generators,0,50);
      html+=targetInput("supplyMax","За один запуск",settings.max_tasks_per_run,1,100);
      html+='<label class="mr-supply-autoaccept"><input id="supplyAuto" type="checkbox" '+(settings.auto_accept_ready?"checked":"")+'><span><b>Автопринимать ready</b><small>Только confidence ≥ 95%, помеченные pipeline как ready</small></span></label></div></section>';

      html+='<section class="mr-supply-card"><div class="mr-supply-card-head"><div><span class="mr-supply-section-icon">▦</span><div><h2>Аудит тем</h2><p>Выбирай дефицитные темы и запускай пополнение пачкой.</p></div></div><div class="mr-supply-actions"><button class="btn sm" id="supplySelect">Выбрать видимые</button><button class="btn sm" id="supplyClear">Снять выбор</button></div></div>';
      html+='<div class="mr-supply-filters"><label><span>Класс</span><select id="supplyGrade"><option value="">Все классы</option>'+grades.map(g=>'<option value="'+g+'" '+(String(g)===String(grade)?"selected":"")+'>'+g+' класс</option>').join("")+'</select></label><label class="wide"><span>Поиск темы</span><input id="supplyQuery" value="'+esc(query)+'" placeholder="Например: дроби"></label><label class="mr-supply-check"><input id="supplyDeficitsOnly" type="checkbox" '+(deficitsOnly?"checked":"")+'><span>Только дефициты</span></label></div>';
      html+='<div class="mr-supply-table-head"><span></span><span>Тема</span><span>%</span><span>Basic</span><span>Medium</span><span>Advanced</span><span>Ген.</span><span>Дефицит</span></div><div id="supplyRows" class="mr-supply-rows"></div>';
      html+='<div class="mr-supply-planbar"><div><b id="supplySelected">0 тем</b><small id="supplyPlan">Выбери темы с дефицитом</small></div><button class="btn primary" id="supplyRun" '+(health.ai_configured?"":"disabled")+'>✦ Запустить автопополнение</button></div><div id="supplyProgress" class="mr-supply-progress" hidden></div></section>';

      html+='<section class="mr-supply-card mr-supply-note"><div class="mr-supply-card-head"><div><span class="mr-supply-section-icon">↻</span><div><h2>Генераторы пока считаем, но не создаём вслепую</h2><p>Обычный task-pipeline умеет надёжно проверять конечные задачи, но ещё не валидирует builder_meta, переменные и ограничения шаблонов. Поэтому v89 показывает их дефицит отдельно; фабрика генераторов будет следующим слоем.</p></div></div></div></section>';
      if(lastRun)html+='<section class="mr-supply-card mr-supply-last"><div><h2>Последний запуск</h2><p>'+esc(lastRun)+'</p></div><button class="btn primary" id="supplyOpenReview">Открыть кандидатов</button></section>';
      html+='</div>';

      ctx.app.innerHTML=ctx.shell(html,'Фабрика задач','Источники, аудит и автоматическое пополнение',top);
      ctx.bindShell();bindTop();

      document.getElementById("supplyManual").onclick=()=>ctx.openPipeline({mode:"topic"});
      document.getElementById("supplyReview").onclick=()=>ctx.openPipeline({mode:"review"});
      document.getElementById("supplyXlsx").onclick=()=>ctx.openBank({focusImport:true});
      const or=document.getElementById("supplyOpenReview");if(or)or.onclick=()=>ctx.openPipeline({mode:"review"});

      document.getElementById("supplyGrade").onchange=e=>{grade=e.target.value;drawRows(rows)};
      document.getElementById("supplyQuery").oninput=e=>{query=e.target.value;drawRows(rows)};
      document.getElementById("supplyDeficitsOnly").onchange=e=>{deficitsOnly=e.target.checked;drawRows(rows)};
      document.getElementById("supplySelect").onclick=()=>{visibleRows(rows).filter(r=>r.ordinaryDeficit>0).forEach(r=>selected.add(String(r.topic.id)));drawRows(rows)};
      document.getElementById("supplyClear").onclick=()=>{selected.clear();drawRows(rows)};
      document.getElementById("supplySave").onclick=()=>saveUiSettings(rows);
      document.getElementById("supplyRun").onclick=()=>run(rows);
      drawRows(rows);
    };

    const sourceCard=(icon,count,label,cls)=>'<article><span class="'+cls+'">'+icon+'</span><b>'+count+'</b><small>'+label+'</small></article>';
    const targetInput=(id,label,value,min,max)=>'<label><span>'+label+'</span><input id="'+id+'" type="number" min="'+min+'" max="'+max+'" value="'+value+'"></label>';

    const visibleRows=rows=>{
      const q=String(query||"").trim().toLocaleLowerCase("ru");
      return rows.filter(r=>{
        if(grade&&String(r.topic.grade)!==String(grade))return false;
        if(deficitsOnly&&r.totalDeficit<=0)return false;
        if(q&&!String((r.topic.section||"")+" "+(r.topic.title||"")).toLocaleLowerCase("ru").includes(q))return false;
        return true;
      });
    };

    const metric=(cur,target,miss)=>{
      const ok=miss<=0;
      return '<span class="mr-supply-metric '+(ok?"ok":"low")+'"><b>'+cur+'<i>/'+target+'</i></b><small>'+(ok?"✓":"−"+miss)+'</small></span>';
    };

    const drawRows=rows=>{
      const host=document.getElementById("supplyRows");if(!host)return;
      const list=visibleRows(rows);
      host.innerHTML=list.length?list.map(r=>
        '<label class="mr-supply-row '+(r.totalDeficit?"needs":"healthy")+'">'+
        '<input type="checkbox" data-topic="'+r.topic.id+'" '+(selected.has(String(r.topic.id))?"checked":"")+' '+(r.ordinaryDeficit?"":"disabled")+'>'+
        '<span class="mr-supply-topic"><b>'+esc(r.topic.title)+'</b><small>'+r.topic.grade+' класс · '+esc(r.topic.section||"Математика")+'</small></span>'+
        '<span class="mr-supply-cover"><b>'+r.percent+'%</b><i><em style="width:'+r.percent+'%"></em></i></span>'+
        metric(r.counts.basic,r.targets.basic,r.deficit.basic)+metric(r.counts.medium,r.targets.medium,r.deficit.medium)+metric(r.counts.advanced,r.targets.advanced,r.deficit.advanced)+metric(r.counts.generators,r.targets.generators,r.deficit.generators)+
        '<span class="mr-supply-deficit"><b>'+r.totalDeficit+'</b><small>'+(r.ordinaryDeficit?r.ordinaryDeficit+" AI":r.deficit.generators?"генераторы":"готово")+'</small></span></label>'
      ).join(""):'<div class="empty">По этим фильтрам тем нет.</div>';
      host.querySelectorAll("[data-topic]").forEach(input=>input.onchange=()=>{const id=String(input.dataset.topic);if(input.checked)selected.add(id);else selected.delete(id);updatePlan(rows)});
      updatePlan(rows);
    };

    const updatePlan=rows=>{
      const plan=planFor(rows,selected,settings);
      const total=plan.reduce((n,x)=>n+x.requested,0);
      const topics=new Set(plan.map(x=>String(x.topicId))).size;
      const label=document.getElementById("supplySelected"),sub=document.getElementById("supplyPlan"),button=document.getElementById("supplyRun");
      if(label)label.textContent=selected.size+" тем выбрано";
      if(sub)sub.textContent=plan.length?"План: "+total+" задач · "+topics+" тем · "+plan.length+" jobs":"Нет дефицита обычных задач в выбранных темах";
      if(button)button.disabled=!health.ai_configured||!plan.length||running;
    };

    const saveUiSettings=async rows=>{
      const button=document.getElementById("supplySave");button.disabled=true;
      try{
        settings=await saveSettings(ctx,{
          target_basic:Math.max(0,Math.min(200,Number(document.getElementById("supplyBasic").value)||0)),
          target_medium:Math.max(0,Math.min(200,Number(document.getElementById("supplyMedium").value)||0)),
          target_advanced:Math.max(0,Math.min(200,Number(document.getElementById("supplyAdvanced").value)||0)),
          target_generators:Math.max(0,Math.min(50,Number(document.getElementById("supplyGenerators").value)||0)),
          max_tasks_per_run:Math.max(1,Math.min(100,Number(document.getElementById("supplyMax").value)||30)),
          auto_accept_ready:document.getElementById("supplyAuto").checked
        });
        toast("Настройки фабрики сохранены");draw();
      }catch(e){fail(e);button.disabled=false}
    };

    const run=async rows=>{
      if(running)return;
      const plan=planFor(rows,selected,settings);
      if(!plan.length)return toast("Выбери темы с дефицитом обычных задач");
      if(!health.ai_configured)return toast("AI-фабрика не подключена");
      const total=plan.reduce((n,x)=>n+x.requested,0);
      if(!confirm("Запустить "+plan.length+" jobs и создать до "+total+" задач? Все кандидаты пройдут независимую проверку и дедупликацию."))return;

      running=true;
      const button=document.getElementById("supplyRun"),progress=document.getElementById("supplyProgress");
      button.disabled=true;button.textContent="Фабрика работает…";progress.hidden=false;
      const runId=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():"supply-"+Date.now();
      let generated=0,ready=0,review=0,rejected=0,accepted=0,failed=0;

      const progressUi=(n,text)=>{
        const pct=Math.round(n/plan.length*100);
        progress.innerHTML='<i><em style="width:'+pct+'%"></em></i><div><b>'+n+'/'+plan.length+'</b><span>'+esc(text)+'</span></div>';
      };
      progressUi(0,"Создаём jobs");

      for(let i=0;i<plan.length;i++){
        const p=plan[i];
        progressUi(i,p.grade+" класс · "+p.topicTitle+" · "+p.difficulty);
        try{
          const body={
            teacher_id:S.user.id,topic_id:p.topicId,mode:"topic",source_exercise_id:null,difficulty:p.difficulty,requested_count:p.requested,status:"queued",
            params:{source:"supply-engine-v1",supply_run_id:runId,target_count:p.target,current_count:p.current,shortage:p.shortage}
          };
          const jr=await sb.from("task_generation_jobs").insert(body).select().single();
          if(jr.error)throw jr.error;
          const inv=await sb.functions.invoke("task-pipeline",{body:{action:"generate",job_id:jr.data.id}});
          if(inv.error)throw inv.error;
          if(inv.data&&inv.data.error)throw new Error(inv.data.error);
          generated+=Number(inv.data&&inv.data.generated||0);
          ready+=Number(inv.data&&inv.data.ready||0);
          review+=Number(inv.data&&inv.data.review||0);
          rejected+=Number(inv.data&&inv.data.rejected||0);
          if(settings.auto_accept_ready&&Number(inv.data&&inv.data.ready||0)>0){
            const ar=await sb.functions.invoke("task-pipeline",{body:{action:"accept_ready",job_id:jr.data.id}});
            if(ar.error)throw ar.error;
            if(ar.data&&ar.data.error)throw new Error(ar.data.error);
            accepted+=Number(ar.data&&ar.data.accepted||0);
          }
        }catch(e){console.error("[TaskSupply]",e);failed++}
        progressUi(i+1,p.topicTitle+" · готово");
      }

      if(accepted>0)await ctx.loadTeacher();
      lastRun="Сгенерировано "+generated+" · ready "+ready+" · review "+review+" · отсеяно "+rejected+" · автоматически принято "+accepted+" · ошибок jobs "+failed+".";
      running=false;
      toast("Фабрика завершила запуск: "+generated+" кандидатов");
      await load();
    };

    await load();
  };

  window.MathroomTaskSupplyV89=API;
})();
