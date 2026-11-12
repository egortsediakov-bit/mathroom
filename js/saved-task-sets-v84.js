(()=>{
  const API={};

  const topicMeta=(ctx,row)=>{
    const live=(ctx.S.topics||[]).find(x=>String(x.id)===String(row&&row.topic_id));
    return live||((row&&row.settings&&row.settings.topic_snapshot)||null);
  };

  const snapshotItem=item=>({
    source_id:item&&item.source?item.source.id:null,
    source_title:item&&item.source&&item.source.title?item.source.title:"Задача",
    content:String(item&&item.content||""),
    answer:String(item&&item.answer||""),
    builder_meta:item&&item.builder_meta&&typeof item.builder_meta==="object"?item.builder_meta:{},
    generated:!!(item&&item.generated),
    difficulty:["basic","medium","advanced"].includes(item&&item.difficulty)?item.difficulty:"basic",
    category:String(item&&item.category||""),
    tags:Array.isArray(item&&item.tags)?item.tags:[],
    topic_id:item&&item.topic_id||null,
    topic_title:String(item&&item.topic_title||""),
    topic_grade:item&&item.topic_grade||null,
    topic_section:String(item&&item.topic_section||"")
  });

  const toBatch=row=>{
    const raw=Array.isArray(row&&row.items)?row.items:[];
    const items=raw.map((item,index)=>({
      source:{id:item&&item.source_id||null,title:item&&item.source_title||("Задача "+(index+1))},
      content:String(item&&item.content||""),
      answer:String(item&&item.answer||""),
      builder_meta:item&&item.builder_meta&&typeof item.builder_meta==="object"?item.builder_meta:{},
      generated:!!(item&&item.generated),
      difficulty:["basic","medium","advanced"].includes(item&&item.difficulty)?item.difficulty:"basic",
      category:String(item&&item.category||""),
      tags:Array.isArray(item&&item.tags)?item.tags:[],
      topic_id:item&&item.topic_id||null,
      topic_title:String(item&&item.topic_title||""),
      topic_grade:item&&item.topic_grade||null,
      topic_section:String(item&&item.topic_section||"")
    }));
    const counts={
      basic:items.filter(x=>x.difficulty==="basic").length,
      medium:items.filter(x=>x.difficulty==="medium").length,
      advanced:items.filter(x=>x.difficulty==="advanced").length
    };
    return {
      requested:items.length,items,counts,complete:true,
      generated:items.filter(x=>x.generated).length,
      uniqueSources:new Set(items.map(x=>String(x.source&&x.source.id||("snapshot:"+x.source.title)))).size,
      savedSetId:row&&row.id||null,
      topicSnapshot:row&&row.settings&&row.settings.topic_snapshot||null,
      topicSnapshots:Array.isArray(row&&row.settings&&row.settings.topic_snapshots)?row.settings.topic_snapshots:[],
      topicQuotas:Array.isArray(row&&row.settings&&row.settings.topic_quotas)?row.settings.topic_quotas:[],
      multiTopic:!!(row&&row.settings&&row.settings.multi_topic)
    };
  };

  API.load=async ctx=>{
    try{
      const res=await ctx.sb.from("saved_task_sets").select("*").order("updated_at",{ascending:false});
      ctx.S.savedTaskSetsFeatureAvailable=!res.error;
      ctx.S.savedTaskSets=res.data||[];
      return ctx.S.savedTaskSets;
    }catch{
      ctx.S.savedTaskSetsFeatureAvailable=false;
      ctx.S.savedTaskSets=[];
      return [];
    }
  };

  API.save=(ctx,batch,topicId,opts={})=>{
    if(!ctx.S.savedTaskSetsFeatureAvailable)return ctx.toast("Сохранённые комплекты пока недоступны");
    if(!batch||!batch.items||!batch.items.length)return ctx.toast("Сначала собери комплект");
    const liveTopic=(ctx.S.topics||[]).find(x=>String(x.id)===String(topicId));
    const topic=liveTopic||batch&&batch.topicSnapshot||null;
    const defaultTitle=batch&&batch.multiTopic
      ?((topic&&topic.grade?topic.grade+" класс · ":"")+"Повторение по "+((batch.topicSnapshots||[]).length)+" темам · "+batch.items.length+" задач")
      :(topic?(topic.grade+" класс · "+topic.title+" · "+batch.items.length+" задач"):("Комплект · "+batch.items.length+" задач"));
    const root=ctx.modal(
      '<section class="mr-save-set-dialog">'+
        '<span class="pill mr-saved-set-pill">Сохранение</span>'+
        '<h2>Сохранить комплект</h2>'+
        '<p class="muted">Сохраняем именно этот набор и эти значения переменных. Изменения исходных задач его не поменяют.</p>'+
        '<div class="field"><label>Название комплекта</label><input id="saveTaskSetTitle" maxlength="160" value="'+ctx.esc(defaultTitle)+'"></div>'+
        '<div class="mr-save-set-summary">'+
          '<span>'+batch.items.length+' задач</span>'+
          '<span>'+(batch.counts&&batch.counts.basic||0)+' базовых</span>'+
          '<span>'+(batch.counts&&batch.counts.medium||0)+' средних</span>'+
          '<span>'+(batch.counts&&batch.counts.advanced||0)+' сложных</span>'+
          '<span>'+(batch.generated||0)+' из генераторов</span>'+
        '</div>'+
        '<div class="actions"><button class="btn primary" id="saveTaskSetConfirm">Сохранить</button></div>'+
      '</section>',
      "mr-save-set-modal"
    );
    const input=root.querySelector("#saveTaskSetTitle"),button=root.querySelector("#saveTaskSetConfirm");
    if(input){input.focus();input.select()}
    button.onclick=async()=>{
      const title=String(input.value||"").trim();
      if(!title)return ctx.toast("Укажи название комплекта");
      button.disabled=true;
      try{
        const body={
          teacher_id:ctx.S.user.id,
          topic_id:batch&&batch.multiTopic?null:(liveTopic&&liveTopic.id||null),
          title,
          difficulty_mode:["balanced","basic","medium","advanced"].includes(opts.difficultyMode)?opts.difficultyMode:"balanced",
          item_count:batch.items.length,
          items:batch.items.map(snapshotItem),
          settings:{
            allow_templates:opts.allowTemplates!==false,
            topic_snapshot:topic?{id:topic.id||null,title:topic.title,grade:topic.grade,section:topic.section||""}:null,
            topic_snapshots:Array.isArray(batch.topicSnapshots)?batch.topicSnapshots:[],
            topic_quotas:Array.isArray(batch.topicQuotas)?batch.topicQuotas:[],
            multi_topic:!!batch.multiTopic,
            counts:batch.counts||{},
            generated_count:Number(batch.generated||0)
          }
        };
        const res=await ctx.sb.from("saved_task_sets").insert(body).select().single();
        if(res.error)throw res.error;
        ctx.S.savedTaskSets=[res.data].concat((ctx.S.savedTaskSets||[]).filter(x=>String(x.id)!==String(res.data.id)));
        root.remove();
        ctx.toast("Комплект сохранён");
      }catch(error){
        ctx.fail(error);
        button.disabled=false;
      }
    };
  };

  const copyTextFor=(ctx,row,answers)=>{
    const batch=toBatch(row),topic=topicMeta(ctx,row);
    const head=batch.multiTopic
      ?[topic&&topic.grade?topic.grade+" класс":"",row&&row.title||"Повторение",batch.topicSnapshots.length+" тем"].filter(Boolean).join(" · ")
      :[topic&&topic.grade?topic.grade+" класс":"",topic&&topic.title||"",row&&row.title||""].filter(Boolean).join(" · ");
    const out=[head||"Комплект задач",""];
    batch.items.forEach((item,index)=>{
      out.push((index+1)+". "+item.content);
      if(answers)out.push("Ответ: "+(item.answer||"—"));
      out.push("");
    });
    return out.join("\n").trim();
  };

  const rename=(ctx,row,onDone)=>{
    const root=ctx.modal(
      '<section class="mr-save-set-dialog">'+
        '<span class="pill mr-saved-set-pill">Название</span>'+
        '<h2>Переименовать комплект</h2>'+
        '<div class="field"><label>Название</label><input id="renameTaskSetTitle" maxlength="160" value="'+ctx.esc(row.title||"Комплект")+'"></div>'+
        '<div class="actions"><button class="btn primary" id="renameTaskSetConfirm">Сохранить</button></div>'+
      '</section>',
      "mr-save-set-modal"
    );
    const input=root.querySelector("#renameTaskSetTitle"),button=root.querySelector("#renameTaskSetConfirm");
    if(input){input.focus();input.select()}
    button.onclick=async()=>{
      const title=String(input.value||"").trim();
      if(!title)return ctx.toast("Название не может быть пустым");
      button.disabled=true;
      try{
        const res=await ctx.sb.from("saved_task_sets").update({title,updated_at:new Date().toISOString()}).eq("id",row.id).select().single();
        if(res.error)throw res.error;
        ctx.S.savedTaskSets=(ctx.S.savedTaskSets||[]).map(x=>String(x.id)===String(row.id)?res.data:x);
        root.remove();
        ctx.toast("Название обновлено");
        if(onDone)onDone();
      }catch(error){ctx.fail(error);button.disabled=false}
    };
  };

  const clone=async(ctx,row,onDone)=>{
    try{
      const body={
        teacher_id:ctx.S.user.id,
        topic_id:row.topic_id||null,
        title:(row.title||"Комплект")+" · копия",
        difficulty_mode:row.difficulty_mode||"balanced",
        item_count:Number(row.item_count)||((row.items||[]).length),
        items:Array.isArray(row.items)?row.items:[],
        settings:row.settings&&typeof row.settings==="object"?row.settings:{},
        cloned_from:row.id
      };
      const res=await ctx.sb.from("saved_task_sets").insert(body).select().single();
      if(res.error)throw res.error;
      ctx.S.savedTaskSets=[res.data].concat(ctx.S.savedTaskSets||[]);
      ctx.toast("Копия комплекта создана");
      if(onDone)onDone();
    }catch(error){ctx.fail(error)}
  };

  const remove=async(ctx,row,onDone)=>{
    if(!confirm('Удалить комплект «'+(row.title||"Комплект")+'»?'))return;
    const res=await ctx.sb.from("saved_task_sets").delete().eq("id",row.id);
    if(res.error)return ctx.fail(res.error);
    ctx.S.savedTaskSets=(ctx.S.savedTaskSets||[]).filter(x=>String(x.id)!==String(row.id));
    ctx.toast("Комплект удалён");
    if(onDone)onDone();
  };

  const openSet=(ctx,row)=>{
    const batch=toBatch(row),topic=topicMeta(ctx,row),students=ctx.S.students||[];
    const cards=batch.items.map((item,index)=>{
      return '<article class="mr-smart-set-card">'+
        '<div class="mr-smart-set-card-num">'+String(index+1).padStart(2,"0")+'</div>'+
        '<div class="mr-smart-set-card-main">'+
          '<div class="mr-smart-set-card-meta"><span class="pill">'+ctx.diffLabel(item.difficulty)+'</span>'+
          (item.generated?'<span class="pill mr-template-pill">↻ сохранённый вариант</span>':'')+
          '<span class="small muted">'+ctx.esc(item.source&&item.source.title||"Задача")+'</span></div>'+
          ctx.taskConditionHtml(item.content,item.builder_meta,{textClass:"mr-smart-set-prompt"})+
          '<div class="mr-smart-set-answer"><span>Ответ</span><b>'+ctx.nl(item.answer||"—")+'</b></div>'+
        '</div>'+
      '</article>';
    }).join("");
    const studentOptions=students.map(s=>'<option value="'+s.id+'">'+ctx.esc(s.name)+' · '+(s.grade||"?")+' кл.</option>').join("");
    const meta=batch.multiTopic
      ?((topic&&topic.grade?ctx.esc(String(topic.grade))+" класс · ":"")+batch.topicSnapshots.length+" тем · "+batch.topicSnapshots.map(x=>ctx.esc(x.title||"")).join(" · "))
      :(topic?(ctx.esc(String(topic.grade||""))+" класс · "+ctx.esc(topic.section||"Математика")+" · "+ctx.esc(topic.title||"Без темы")):"Тема больше недоступна");
    const root=ctx.modal(
      '<section class="mr-saved-set-open">'+
        '<div class="mr-saved-set-open-head">'+
          '<div><span class="pill mr-saved-set-pill">Сохранённый комплект</span><h2>'+ctx.esc(row.title||"Комплект")+'</h2><p class="muted">'+meta+' · '+batch.items.length+' задач</p></div>'+
          '<div class="actions"><button class="btn sm" id="savedSetCopy">Без ответов</button><button class="btn sm" id="savedSetCopyAnswers">С ответами</button><button class="btn sm mr-smart-set-sheet" id="savedSetWorksheet">A4 / PDF</button></div>'+
        '</div>'+
        '<div class="mr-saved-set-assignment">'+
          '<label><span>Назначить как ДЗ</span><select id="savedSetStudent"><option value="">Выбери ученика</option>'+studentOptions+'</select></label>'+
          '<button class="btn primary" id="savedSetHomework" '+(((topic||batch.multiTopic)&&students.length)?"":"disabled")+'>Назначить этот набор</button>'+
        '</div>'+
        '<div class="mr-saved-set-task-list">'+cards+'</div>'+
      '</section>',
      "mr-saved-set-open-modal"
    );
    ctx.hydrateTaskMedia(root);ctx.typesetTaskMath(root);
    root.querySelector("#savedSetCopy").onclick=async()=>{await ctx.copyText(copyTextFor(ctx,row,false));ctx.toast("Листок без ответов скопирован")};
    root.querySelector("#savedSetCopyAnswers").onclick=async()=>{await ctx.copyText(copyTextFor(ctx,row,true));ctx.toast("Комплект с ответами скопирован")};
    root.querySelector("#savedSetWorksheet").onclick=()=>ctx.openSmartWorksheetBuilder(batch,batch.multiTopic?null:row.topic_id,{});
    const hw=root.querySelector("#savedSetHomework");
    if(hw)hw.addEventListener("click",async e=>{
      const studentId=root.querySelector("#savedSetStudent").value||"";
      if(!studentId)return ctx.toast("Выбери ученика");
      e.currentTarget.disabled=true;
      const result=await ctx.assignSmartTaskSetHomework(batch,batch.multiTopic?null:row.topic_id,studentId);
      if(!result)e.currentTarget.disabled=false;
      else e.currentTarget.textContent="✓ Домашняя назначена";
    });
  };

  API.openLibrary=ctx=>{
    if(!ctx.S.savedTaskSetsFeatureAvailable)return ctx.toast("Сохранённые комплекты пока недоступны");
    const root=ctx.modal(
      '<section class="mr-saved-sets-library">'+
        '<div class="mr-saved-sets-head">'+
          '<div><span class="pill mr-saved-set-pill">Библиотека комплектов</span><h2>Мои комплекты</h2><p class="muted">Готовые наборы не меняются вместе с банком: их можно переиспользовать, клонировать, печатать и назначать снова.</p></div>'+
          '<div class="field mr-saved-set-search"><label>Поиск</label><input id="savedSetsSearch" placeholder="Название, класс, тема..."></div>'+
        '</div>'+
        '<div id="savedSetsList" class="mr-saved-sets-grid"></div>'+
      '</section>',
      "mr-saved-sets-modal"
    );
    const host=root.querySelector("#savedSetsList"),search=root.querySelector("#savedSetsSearch");
    const draw=()=>{
      const q=String(search.value||"").trim().toLocaleLowerCase("ru");
      const rows=(ctx.S.savedTaskSets||[]).filter(row=>{
        const topic=topicMeta(ctx,row),many=(row.settings&&row.settings.topic_snapshots)||[];
        return !q||[row.title,topic&&topic.title,topic&&topic.section,topic&&topic.grade,...many.map(x=>x&&x.title)].join(" ").toLocaleLowerCase("ru").includes(q);
      });
      if(!rows.length){
        host.innerHTML='<div class="empty">'+(q?"По запросу ничего не найдено.":"Сохранённых комплектов пока нет. Собери первый набор и нажми «Сохранить комплект».")+'</div>';
        return;
      }
      host.innerHTML=rows.map(row=>{
        const topic=topicMeta(ctx,row),items=Array.isArray(row.items)?row.items:[],generated=items.filter(x=>x.generated).length;
        const multi=!!(row.settings&&row.settings.multi_topic),topicSnapshots=(row.settings&&row.settings.topic_snapshots)||[];
        const created=row.updated_at||row.created_at;
        return '<article class="mr-saved-set-card">'+
          '<div class="mr-saved-set-card-top"><span class="mr-saved-set-count">'+items.length+'</span><div>'+
            '<span class="pill">'+(topic&&topic.grade||"?")+' кл.</span>'+
            (multi?'<span class="pill mr-multi-topic-pill">'+topicSnapshots.length+' темы</span>':'')+
            (generated?'<span class="pill mr-template-pill">'+generated+' ген.</span>':'')+
            '<h3>'+ctx.esc(row.title||"Комплект")+'</h3>'+
            '<p>'+(multi?ctx.esc(topicSnapshots.map(x=>x&&x.title).filter(Boolean).join(" · ")):ctx.esc(topic&&topic.section||"Математика")+' · '+ctx.esc(topic&&topic.title||"Тема недоступна"))+'</p>'+
          '</div></div>'+
          '<div class="mr-saved-set-card-foot"><span class="small muted">'+(created?new Date(created).toLocaleDateString("ru-RU"):"")+'</span>'+
            '<div class="actions"><button class="btn sm primary" data-set-open="'+row.id+'">Открыть</button><button class="btn sm" data-set-clone="'+row.id+'">Клонировать</button><button class="btn sm" data-set-rename="'+row.id+'">Название</button><button class="btn sm danger" data-set-delete="'+row.id+'">Удалить</button></div>'+
          '</div>'+
        '</article>';
      }).join("");
      host.querySelectorAll("[data-set-open]").forEach(b=>b.onclick=()=>{const row=(ctx.S.savedTaskSets||[]).find(x=>String(x.id)===String(b.dataset.setOpen));if(row)openSet(ctx,row)});
      host.querySelectorAll("[data-set-clone]").forEach(b=>b.onclick=()=>{const row=(ctx.S.savedTaskSets||[]).find(x=>String(x.id)===String(b.dataset.setClone));if(row)clone(ctx,row,draw)});
      host.querySelectorAll("[data-set-rename]").forEach(b=>b.onclick=()=>{const row=(ctx.S.savedTaskSets||[]).find(x=>String(x.id)===String(b.dataset.setRename));if(row)rename(ctx,row,draw)});
      host.querySelectorAll("[data-set-delete]").forEach(b=>b.onclick=()=>{const row=(ctx.S.savedTaskSets||[]).find(x=>String(x.id)===String(b.dataset.setDelete));if(row)remove(ctx,row,draw)});
    };
    search.oninput=draw;
    draw();
  };

  API.toBatch=toBatch;
  window.MathroomSavedSetsV84=API;
})();