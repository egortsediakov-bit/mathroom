(()=>{
  const API={};

  const topicLabels=row=>{
    const cfg=row&&row.config&&typeof row.config==="object"?row.config:{};
    if(row&&row.mode==="multi"){
      return (Array.isArray(cfg.rows)?cfg.rows:[]).map(x=>x&&x.topic_snapshot&&x.topic_snapshot.title||"").filter(Boolean);
    }
    return [cfg&&cfg.topic_snapshot&&cfg.topic_snapshot.title||""].filter(Boolean);
  };

  const totalCount=row=>{
    const cfg=row&&row.config&&typeof row.config==="object"?row.config:{};
    if(row&&row.mode==="multi")return (Array.isArray(cfg.rows)?cfg.rows:[]).reduce((sum,x)=>sum+(Number(x&&x.count)||0),0);
    return Number(cfg.count)||0;
  };

  API.load=async ctx=>{
    try{
      const res=await ctx.sb.from("task_set_recipes").select("*").order("updated_at",{ascending:false});
      ctx.S.taskSetRecipesFeatureAvailable=!res.error;
      ctx.S.taskSetRecipes=res.data||[];
      return ctx.S.taskSetRecipes;
    }catch{
      ctx.S.taskSetRecipesFeatureAvailable=false;
      ctx.S.taskSetRecipes=[];
      return [];
    }
  };

  API.save=(ctx,recipe)=>{
    if(!ctx.S.taskSetRecipesFeatureAvailable)return ctx.toast("Рецепты комплектов пока недоступны");
    if(!recipe||!["single","multi"].includes(recipe.mode))return ctx.toast("Не удалось прочитать настройки комплекта");
    const labels=recipe.mode==="multi"
      ?(recipe.config&&recipe.config.rows||[]).map(x=>x&&x.topic_snapshot&&x.topic_snapshot.title).filter(Boolean)
      :[recipe.config&&recipe.config.topic_snapshot&&recipe.config.topic_snapshot.title].filter(Boolean);
    const count=recipe.mode==="multi"
      ?(recipe.config&&recipe.config.rows||[]).reduce((sum,x)=>sum+(Number(x&&x.count)||0),0)
      :Number(recipe.config&&recipe.config.count)||0;
    const defaultTitle=recipe.mode==="multi"
      ?((recipe.grade?recipe.grade+" класс · ":"")+"Повторение по "+labels.length+" темам · "+count+" задач")
      :((recipe.grade?recipe.grade+" класс · ":"")+(labels[0]||"Тема")+" · "+count+" задач");
    const root=ctx.modal(
      '<section class="mr-recipe-dialog">'+
        '<span class="pill mr-recipe-pill">Рецепт комплекта</span>'+
        '<h2>Сохранить рецепт</h2>'+
        '<p class="muted">Рецепт хранит не сами задачи, а правила сборки. При каждом запуске Mathroom создаст новый вариант.</p>'+
        '<div class="field"><label>Название рецепта</label><input id="recipeTitle" maxlength="160" value="'+ctx.esc(defaultTitle)+'"></div>'+
        '<div class="mr-recipe-summary"><span>'+ctx.esc(recipe.mode==="multi"?labels.length+" темы":"1 тема")+'</span><span>'+count+' задач</span><span>'+ctx.esc(recipe.difficultyMode||"balanced")+'</span><span>'+(recipe.allowTemplates!==false?"генераторы включены":"без генераторов")+'</span></div>'+
        '<div class="actions"><button class="btn primary" id="recipeSaveConfirm">Сохранить рецепт</button></div>'+
      '</section>',
      "mr-recipe-dialog-modal"
    );
    const input=root.querySelector("#recipeTitle"),button=root.querySelector("#recipeSaveConfirm");
    if(input){input.focus();input.select()}
    button.onclick=async()=>{
      const title=String(input.value||"").trim();
      if(!title)return ctx.toast("Укажи название рецепта");
      button.disabled=true;
      try{
        const body={
          teacher_id:ctx.S.user.id,
          title,
          grade:Number(recipe.grade)||null,
          mode:recipe.mode,
          difficulty_mode:["balanced","basic","medium","advanced"].includes(recipe.difficultyMode)?recipe.difficultyMode:"balanced",
          allow_templates:recipe.allowTemplates!==false,
          config:recipe.config&&typeof recipe.config==="object"?recipe.config:{}
        };
        const res=await ctx.sb.from("task_set_recipes").insert(body).select().single();
        if(res.error)throw res.error;
        ctx.S.taskSetRecipes=[res.data].concat((ctx.S.taskSetRecipes||[]).filter(x=>String(x.id)!==String(res.data.id)));
        root.remove();
        ctx.toast("Рецепт сохранён");
      }catch(error){ctx.fail(error);button.disabled=false}
    };
  };

  const rename=(ctx,row,onDone)=>{
    const root=ctx.modal(
      '<section class="mr-recipe-dialog"><span class="pill mr-recipe-pill">Рецепт</span><h2>Переименовать</h2>'+
      '<div class="field"><label>Название</label><input id="recipeRename" maxlength="160" value="'+ctx.esc(row.title||"Рецепт")+'"></div>'+
      '<div class="actions"><button class="btn primary" id="recipeRenameConfirm">Сохранить</button></div></section>',
      "mr-recipe-dialog-modal"
    );
    const input=root.querySelector("#recipeRename"),button=root.querySelector("#recipeRenameConfirm");
    if(input){input.focus();input.select()}
    button.onclick=async()=>{
      const title=String(input.value||"").trim();
      if(!title)return ctx.toast("Название не может быть пустым");
      button.disabled=true;
      try{
        const res=await ctx.sb.from("task_set_recipes").update({title,updated_at:new Date().toISOString()}).eq("id",row.id).select().single();
        if(res.error)throw res.error;
        ctx.S.taskSetRecipes=(ctx.S.taskSetRecipes||[]).map(x=>String(x.id)===String(row.id)?res.data:x);
        root.remove();ctx.toast("Рецепт переименован");if(onDone)onDone();
      }catch(error){ctx.fail(error);button.disabled=false}
    };
  };

  const clone=async(ctx,row,onDone)=>{
    try{
      const body={
        teacher_id:ctx.S.user.id,
        title:(row.title||"Рецепт")+" · копия",
        grade:row.grade||null,
        mode:row.mode||"single",
        difficulty_mode:row.difficulty_mode||"balanced",
        allow_templates:row.allow_templates!==false,
        config:row.config&&typeof row.config==="object"?row.config:{}
      };
      const res=await ctx.sb.from("task_set_recipes").insert(body).select().single();
      if(res.error)throw res.error;
      ctx.S.taskSetRecipes=[res.data].concat(ctx.S.taskSetRecipes||[]);
      ctx.toast("Копия рецепта создана");if(onDone)onDone();
    }catch(error){ctx.fail(error)}
  };

  const remove=async(ctx,row,onDone)=>{
    if(!confirm('Удалить рецепт «'+(row.title||"Рецепт")+'»?'))return;
    const res=await ctx.sb.from("task_set_recipes").delete().eq("id",row.id);
    if(res.error)return ctx.fail(res.error);
    ctx.S.taskSetRecipes=(ctx.S.taskSetRecipes||[]).filter(x=>String(x.id)!==String(row.id));
    ctx.toast("Рецепт удалён");if(onDone)onDone();
  };

  const useRecipe=async(ctx,row,root)=>{
    let next=row;
    try{
      const res=await ctx.sb.from("task_set_recipes").update({
        use_count:(Number(row.use_count)||0)+1,
        last_used_at:new Date().toISOString()
      }).eq("id",row.id).select().single();
      if(!res.error&&res.data){
        next=res.data;
        ctx.S.taskSetRecipes=(ctx.S.taskSetRecipes||[]).map(x=>String(x.id)===String(row.id)?res.data:x);
      }
    }catch{}
    root&&root.remove();
    ctx.openBuilder({recipe:next});
  };

  API.openLibrary=ctx=>{
    if(!ctx.S.taskSetRecipesFeatureAvailable)return ctx.toast("Рецепты комплектов пока недоступны");
    const root=ctx.modal(
      '<section class="mr-recipes-library">'+
        '<div class="mr-recipes-head"><div><span class="pill mr-recipe-pill">Автосборка</span><h2>Рецепты комплектов</h2><p class="muted">Один рецепт — сколько угодно свежих вариантов с теми же темами, квотами и правилами сложности.</p></div>'+
        '<div class="field mr-recipe-search"><label>Поиск</label><input id="recipeSearch" placeholder="Название или тема..."></div></div>'+
        '<div id="recipeList" class="mr-recipes-grid"></div>'+
      '</section>',
      "mr-recipes-modal"
    );
    const host=root.querySelector("#recipeList"),search=root.querySelector("#recipeSearch");
    const draw=()=>{
      const q=String(search.value||"").trim().toLocaleLowerCase("ru");
      const rows=(ctx.S.taskSetRecipes||[]).filter(row=>!q||[row.title,row.grade,...topicLabels(row)].join(" ").toLocaleLowerCase("ru").includes(q));
      if(!rows.length){
        host.innerHTML='<div class="empty">'+(q?"По запросу ничего не найдено.":"Рецептов пока нет. Открой «Собрать комплект», настрой структуру и нажми «Сохранить рецепт».")+'</div>';
        return;
      }
      host.innerHTML=rows.map(row=>{
        const labels=topicLabels(row),count=totalCount(row),uses=Number(row.use_count)||0;
        const details=row.mode==="multi"?labels.join(" · "):(labels[0]||"Тема недоступна");
        return '<article class="mr-recipe-card">'+
          '<div class="mr-recipe-card-top"><span class="mr-recipe-icon">↻</span><div>'+
            '<div class="mr-recipe-card-pills"><span class="pill">'+(row.grade||"?")+' кл.</span><span class="pill">'+(row.mode==="multi"?labels.length+" темы":"1 тема")+'</span><span class="pill">'+count+' задач</span></div>'+
            '<h3>'+ctx.esc(row.title||"Рецепт")+'</h3><p>'+ctx.esc(details)+'</p>'+
          '</div></div>'+
          '<div class="mr-recipe-card-meta"><span>'+ctx.esc(row.difficulty_mode||"balanced")+'</span><span>'+(row.allow_templates!==false?"генераторы":"без генераторов")+'</span><span>запусков: '+uses+'</span></div>'+
          '<div class="mr-recipe-card-foot"><button class="btn sm primary" data-recipe-use="'+row.id+'">Собрать свежий вариант</button><div class="actions"><button class="btn sm" data-recipe-clone="'+row.id+'">Клон</button><button class="btn sm" data-recipe-rename="'+row.id+'">Название</button><button class="btn sm danger" data-recipe-delete="'+row.id+'">Удалить</button></div></div>'+
        '</article>';
      }).join("");
      host.querySelectorAll("[data-recipe-use]").forEach(b=>b.onclick=()=>{const row=(ctx.S.taskSetRecipes||[]).find(x=>String(x.id)===String(b.dataset.recipeUse));if(row)useRecipe(ctx,row,root)});
      host.querySelectorAll("[data-recipe-clone]").forEach(b=>b.onclick=()=>{const row=(ctx.S.taskSetRecipes||[]).find(x=>String(x.id)===String(b.dataset.recipeClone));if(row)clone(ctx,row,draw)});
      host.querySelectorAll("[data-recipe-rename]").forEach(b=>b.onclick=()=>{const row=(ctx.S.taskSetRecipes||[]).find(x=>String(x.id)===String(b.dataset.recipeRename));if(row)rename(ctx,row,draw)});
      host.querySelectorAll("[data-recipe-delete]").forEach(b=>b.onclick=()=>{const row=(ctx.S.taskSetRecipes||[]).find(x=>String(x.id)===String(b.dataset.recipeDelete));if(row)remove(ctx,row,draw)});
    };
    search.oninput=draw;draw();
  };

  window.MathroomSetRecipesV86=API;
})();