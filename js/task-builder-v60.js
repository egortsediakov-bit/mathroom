(()=>{
  const API={render(ctx){
    const {app,shell,bindShell,S,sb,esc,nl,toast,fail,loadTeacher,renderBank,renderTopic,renderTopics,sharedMaterialForExercise,sharedMaterialUserTags,exerciseSystemTags,curriculumBank}=ctx;
    const editing=S.taskBuilderExerciseId?(S.exercises||[]).find(x=>String(x.id)===String(S.taskBuilderExerciseId)):null;
    const editingTopic=editing?(S.topics||[]).find(t=>String(t.id)===String(editing.topic_id)):null;
    const meta=editing&&editing.builder_meta&&typeof editing.builder_meta==="object"?editing.builder_meta:{};
    const src=meta.source&&typeof meta.source==="object"?meta.source:{};
    const settings=meta.settings&&typeof meta.settings==="object"?meta.settings:{};
    const shared=editing?sharedMaterialForExercise(editing.id):null;
    const state={
      grade:Number(meta.grade||editingTopic?.grade||S.students?.[0]?.grade||5),
      topicId:String(editing?.topic_id||""),
      subtopic:String(meta.subtopic??editing?.category??""),
      difficulty:["basic","medium","advanced"].includes(editing?.difficulty)?editing.difficulty:"medium",
      taskType:["standard","numeric","single","multiple","open"].includes(meta.task_type)?meta.task_type:"standard",
      content:String(editing?.content||""),
      answers:Array.isArray(meta.answers)&&meta.answers.length?meta.answers.map((a,i)=>({label:String(a?.label||("Ответ "+(i+1))),value:String(a?.value||""),accepted:Array.isArray(a?.accepted)?a.accepted.map(String):[]})):[{label:"Ответ",value:String(editing?.answer||""),accepted:[]}],
      options:Array.isArray(meta.options)&&meta.options.length?meta.options.map((o,i)=>({id:String(o?.id||("o"+i)),text:String(o?.text||""),correct:!!o?.correct})):[{id:"o0",text:"",correct:true},{id:"o1",text:"",correct:false},{id:"o2",text:"",correct:false},{id:"o3",text:"",correct:false}],
      openAnswer:String(meta.open_answer??(meta.task_type==="open"?editing?.answer||"":"")),
      solution:String(meta.solution||""),
      hints:Array.isArray(meta.hints)?[0,1,2].map(i=>String(meta.hints[i]||"")):["","",""],
      source:{kind:["textbook","mine","ai","other"].includes(src.kind)?src.kind:"mine",textbookId:String(src.textbook_id||""),page:String(src.page||""),exerciseNo:String(src.exercise_no||""),note:String(src.note||"")},
      settings:{shared:settings.shared!=null?!!settings.shared:!!shared,allowTests:settings.allow_tests!==false,allowAi:settings.allow_ai_example!==false},
      help:"solution"
    };
    const diffName=v=>v==="advanced"?"Сложная":v==="medium"?"Средняя":"Простая";
    const typeName=v=>({standard:"Обычная задача",numeric:"Числовой ответ",single:"Тест",multiple:"Несколько ответов",open:"Развёрнутый ответ"}[v]||"Обычная задача");
    const q=id=>document.getElementById(id);
    const section=(n,title,sub)=>'<div class="mr-tb-head"><span>'+n+'</span><div><h2>'+title+'</h2><p>'+sub+'</p></div></div>';
    const types=[["standard","Обычная задача"],["numeric","Числовой ответ"],["single","Тест"],["multiple","Несколько ответов"],["open","Развёрнутый ответ"]];
    const typeButtons=types.map(([v,n])=>'<button type="button" data-tb-type="'+v+'" class="'+(state.taskType===v?"active":"")+'">'+n+'</button>').join("");
    const diffButtons=[["basic","Простая"],["medium","Средняя"],["advanced","Сложная"]].map(([v,n])=>'<button type="button" data-tb-diff="'+v+'" class="'+(state.difficulty===v?"active":"")+'">'+n+'</button>').join("");
    const grades=Array.from({length:11},(_,i)=>i+1).map(g=>'<option value="'+g+'" '+(g===state.grade?"selected":"")+'>'+g+' класс</option>').join("");
    const top='<div class="mr-tb-top"><button id="tbExit" class="ghost">← В банк</button><button id="tbDraft">Сохранить в черновики</button><button id="tbSave" class="save">✓ '+(editing?"Сохранить изменения":"Сохранить задачу")+'</button></div>';
    const html=
      '<div class="mr-task-builder"><div class="mr-tb-grid"><main class="mr-tb-main">'+
        '<section class="mr-tb-card">'+section("1","Основная информация","Выберите тему, сложность и тип задачи")+
          '<div class="mr-tb-fields"><label><span>Класс</span><select id="tbGrade">'+grades+'</select></label><label class="topic"><span>Тема</span><select id="tbTopic"></select></label><label><span>Подтема <em>(необязательно)</em></span><input id="tbSubtopic" value="'+esc(state.subtopic)+'" placeholder="Например: Округление"></label></div>'+
          '<div class="mr-tb-choices"><div><b>Сложность</b><div class="mr-tb-segments">'+diffButtons+'</div></div><div class="grow"><b>Тип задачи</b><div class="mr-tb-segments types">'+typeButtons+'</div></div></div>'+
        '</section>'+
        '<section class="mr-tb-card">'+section("2","Условие задачи","Введите текст, добавьте формулы и структурные элементы")+
          '<div class="mr-tb-toolbar"><button data-insert="text">T&nbsp; Текст</button><button class="active" data-insert="formula">∿&nbsp; Формула</button><button data-insert="list">☷&nbsp; Список</button><button data-insert="template">◇&nbsp; Шаблон</button><button data-coming="Изображения">▧&nbsp; Изображение</button><button data-coming="Таблицы">⊞&nbsp; Таблица</button><button data-coming="Геометрия">△&nbsp; Геометрия</button></div>'+
          '<div class="mr-tb-editor"><textarea id="tbContent" maxlength="5000" placeholder="Введите условие задачи…">'+esc(state.content)+'</textarea><span id="tbContentCount">'+state.content.length+'/5000</span></div>'+
        '</section>'+
        '<section class="mr-tb-card">'+section("3","Правильный ответ","Укажите правильный ответ и допустимые варианты")+
          '<div class="mr-tb-answer-types">'+typeButtons+'</div><div id="tbAnswerEditor"></div>'+
        '</section>'+
        '<div class="mr-tb-bottom">'+
          '<section class="mr-tb-card">'+section("4","Решение и подсказки","Добавьте решение для преподавателя и подсказки ученику")+
            '<div class="mr-tb-help-tabs"><button class="active" data-help="solution">Решение</button><button data-help="hint0">Подсказка 1</button><button data-help="hint1">Подсказка 2</button><button data-help="hint2">Подсказка 3</button></div>'+
            '<div class="mr-tb-mini-tools"><button data-help-insert="formula">∿ Формула</button><button data-help-insert="list">☷ Список</button></div>'+
            '<div class="mr-tb-editor small"><textarea id="tbHelp" maxlength="5000"></textarea><span id="tbHelpCount">0/5000</span></div>'+
          '</section>'+
          '<section class="mr-tb-card">'+section("5","Источник","Укажите, откуда взята задача")+
            '<div class="mr-tb-source-tabs"><button data-source="textbook" class="'+(state.source.kind==="textbook"?"active":"")+'">Учебник</button><button data-source="mine" class="'+(state.source.kind==="mine"?"active":"")+'">Моя задача</button><button data-source="ai" class="'+(state.source.kind==="ai"?"active":"")+'">Сгенерировано AI</button><button data-source="other" class="'+(state.source.kind==="other"?"active":"")+'">Другое</button></div><div id="tbSource"></div>'+
          '</section>'+
        '</div>'+
      '</main><aside class="mr-tb-side">'+
        '<section class="mr-tb-preview-card"><div class="mr-tb-sidehead"><span>◇</span><div><h2>Предпросмотр задачи</h2><p>Так задачу увидит ученик</p></div></div><div class="mr-tb-preview-tabs"><button class="active">Условие</button><button data-info="Решение видно только преподавателю">Решение</button><button data-info="Подсказки открываются ученику по очереди">Подсказки</button></div><div id="tbPreview"></div></section>'+
        '<section class="mr-tb-settings"><div class="mr-tb-sidehead"><span>◈</span><div><h2>Параметры использования</h2><p>Настройки для банка задач</p></div></div>'+
          '<label class="mr-tb-toggle disabled"><div><b>Добавить в мой банк задач</b><small>Сохранённая задача всегда остаётся в вашей библиотеке</small></div><input checked disabled type="checkbox"><i></i></label>'+
          '<label class="mr-tb-toggle"><div><b>Добавить в общий банк</b><small>Задача станет доступна всем преподавателям</small></div><input id="tbShared" '+(state.settings.shared?"checked":"")+' type="checkbox"><i></i></label>'+
          '<label class="mr-tb-toggle"><div><b>Разрешить использование в тестах</b><small>Эту задачу можно будет добавлять в тесты</small></div><input id="tbAllowTests" '+(state.settings.allowTests?"checked":"")+' type="checkbox"><i></i></label>'+
          '<label class="mr-tb-toggle"><div><b>Разрешить AI использовать как пример</b><small>Задача может использоваться как образец для похожих задач</small></div><input id="tbAllowAi" '+(state.settings.allowAi?"checked":"")+' type="checkbox"><i></i></label>'+
        '</section>'+
      '</aside></div></div>';
    app.innerHTML=shell(html,editing?"Редактировать задачу":"Создать задачу","Добавьте условие, ответ, решение и параметры. Задача будет сохранена в ваш банк задач.",top);
    bindShell();

    const topic=()=> (S.topics||[]).find(t=>String(t.id)===String(state.topicId))||null;
    function fillTopics(){
      const rows=(S.topics||[]).filter(t=>Number(t.grade)===Number(state.grade)).slice().sort(curriculumBank()?.compareTopics||(()=>0));
      if(!rows.length){state.topicId="";q("tbTopic").innerHTML='<option value="">Для этого класса тем пока нет</option>';q("tbTopic").disabled=true;return}
      q("tbTopic").disabled=false;
      if(!rows.some(t=>String(t.id)===state.topicId))state.topicId=String(rows[0].id);
      q("tbTopic").innerHTML=rows.map(t=>'<option value="'+t.id+'" '+(String(t.id)===state.topicId?"selected":"")+'>'+esc(t.section||"Математика")+' · '+esc(t.title)+'</option>').join("");
    }
    function syncAnswer(){
      if(["standard","numeric"].includes(state.taskType)){
        state.answers=[...document.querySelectorAll("[data-answer-row]")].map((r,i)=>({label:r.querySelector("[data-label]")?.value.trim()||("Ответ "+(i+1)),value:r.querySelector("[data-value]")?.value.trim()||"",accepted:(r.querySelector("[data-accepted]")?.value||"").split(",").map(v=>v.trim()).filter(Boolean)}));
        if(!state.answers.length)state.answers=[{label:"Ответ",value:"",accepted:[]}];
      }else if(["single","multiple"].includes(state.taskType)){
        state.options=[...document.querySelectorAll("[data-option-row]")].map((r,i)=>({id:r.dataset.optionRow||("o"+i),text:r.querySelector("[data-option-text]")?.value.trim()||"",correct:!!r.querySelector("[data-option-correct]")?.checked}));
      }else state.openAnswer=q("tbOpen")?.value||"";
    }
    function bindAnswerInputs(host){
      host.querySelectorAll("input,textarea").forEach(el=>el.addEventListener("input",()=>{syncAnswer();preview()}));
      host.querySelectorAll('input[type="checkbox"],input[type="radio"]').forEach(el=>el.addEventListener("change",()=>{syncAnswer();preview()}));
    }
    function renderAnswer(){
      const host=q("tbAnswerEditor");
      if(["standard","numeric"].includes(state.taskType)){
        host.innerHTML='<div class="mr-tb-answer-list">'+state.answers.map((a,i)=>'<div class="mr-tb-answer-row" data-answer-row><label><span>Метка</span><input data-label value="'+esc(a.label)+'"></label><label class="answer"><span>Правильный ответ</span><input data-value '+(state.taskType==="numeric"?'inputmode="decimal"':'')+' value="'+esc(a.value)+'" placeholder="Введите ответ"></label><label class="accepted"><span>Допустимые варианты</span><input data-accepted value="'+esc((a.accepted||[]).join(", "))+'" placeholder="через запятую"></label><button data-remove-answer="'+i+'" '+(state.answers.length===1?"disabled":"")+'>×</button></div>').join("")+'<button class="mr-tb-add" id="tbAddAnswer">＋ Добавить ещё один ответ</button></div>';
        q("tbAddAnswer").onclick=()=>{syncAnswer();state.answers.push({label:"Ответ "+(state.answers.length+1),value:"",accepted:[]});renderAnswer();preview()};
        host.querySelectorAll("[data-remove-answer]").forEach(b=>b.onclick=()=>{syncAnswer();state.answers.splice(Number(b.dataset.removeAnswer),1);renderAnswer();preview()});
      }else if(["single","multiple"].includes(state.taskType)){
        host.innerHTML='<div class="mr-tb-option-list">'+state.options.map((o,i)=>'<div class="mr-tb-option-row" data-option-row="'+esc(o.id)+'"><input data-option-correct type="'+(state.taskType==="single"?"radio":"checkbox")+'" name="tbCorrect" '+(o.correct?"checked":"")+'><span>'+String.fromCharCode(65+i)+'</span><input data-option-text value="'+esc(o.text)+'" placeholder="Вариант ответа"><button data-remove-option="'+i+'" '+(state.options.length<=2?"disabled":"")+'>×</button></div>').join("")+'<button class="mr-tb-add" id="tbAddOption">＋ Добавить вариант</button></div>';
        q("tbAddOption").onclick=()=>{syncAnswer();state.options.push({id:"o"+Date.now(),text:"",correct:false});renderAnswer();preview()};
        host.querySelectorAll("[data-remove-option]").forEach(b=>b.onclick=()=>{syncAnswer();state.options.splice(Number(b.dataset.removeOption),1);renderAnswer();preview()});
      }else host.innerHTML='<label class="mr-tb-open"><span>Эталон ответа / критерий проверки</span><textarea id="tbOpen" rows="5" placeholder="Опишите, что считается правильным развёрнутым ответом…">'+esc(state.openAnswer)+'</textarea></label>';
      bindAnswerInputs(host);
    }
    function renderSource(){
      const host=q("tbSource");
      if(state.source.kind==="textbook"){
        const books=(S.textbooks||[]).filter(b=>!b.teacher_id||String(b.teacher_id)===String(S.user?.id));
        if(!state.source.textbookId&&books[0])state.source.textbookId=String(books[0].id);
        host.innerHTML='<div class="mr-tb-source-grid"><label class="book"><span>Учебник</span><select id="tbBook">'+(books.length?books.map(b=>'<option value="'+b.id+'" '+(String(b.id)===state.source.textbookId?"selected":"")+'>'+esc(b.title||b.name||b.filename||"Учебник")+'</option>').join(""):'<option value="">Учебники не загружены</option>')+'</select></label><label><span>Страница</span><input id="tbPage" inputmode="numeric" value="'+esc(state.source.page)+'" placeholder="68"></label><label><span>Номер задачи</span><input id="tbNo" value="'+esc(state.source.exerciseNo)+'" placeholder="324"></label></div>';
        q("tbBook")?.addEventListener("change",e=>state.source.textbookId=e.target.value);q("tbPage")?.addEventListener("input",e=>state.source.page=e.target.value);q("tbNo")?.addEventListener("input",e=>state.source.exerciseNo=e.target.value);
      }else{
        const ph={mine:"Можно оставить заметку о происхождении или версии задачи.",ai:"Укажите модель, промпт или контекст генерации.",other:"Например: олимпиада, методичка, сайт или подборка."};
        host.innerHTML='<label class="mr-tb-source-note"><span>Комментарий к источнику <em>(необязательно)</em></span><textarea id="tbSourceNote" rows="4" placeholder="'+esc(ph[state.source.kind]||"Источник задачи")+'">'+esc(state.source.note)+'</textarea></label>';
        q("tbSourceNote").addEventListener("input",e=>state.source.note=e.target.value);
      }
    }
    function helpValue(){return state.help==="solution"?state.solution:state.hints[Number(state.help.replace("hint",""))]||""}
    function setHelp(v){if(state.help==="solution")state.solution=v;else state.hints[Number(state.help.replace("hint",""))]=v}
    function renderHelp(){q("tbHelp").value=helpValue();q("tbHelp").placeholder=state.help==="solution"?"Распишите решение для преподавателя…":"Напишите подсказку, которая поможет сделать следующий шаг…";q("tbHelpCount").textContent=q("tbHelp").value.length+"/5000"}
    function studentAnswer(){
      if(["standard","numeric"].includes(state.taskType))return '<div class="mr-tb-student-answer"><h4>Ответ ученика</h4>'+state.answers.map((a,i)=>'<label><span>'+esc(a.label||("Ответ "+(i+1)))+'</span><input placeholder="Введите ответ…"></label>').join("")+'<button>Проверить ответ</button></div>';
      if(["single","multiple"].includes(state.taskType)){const it=state.taskType==="single"?"radio":"checkbox";return '<div class="mr-tb-student-answer"><h4>Выберите '+(state.taskType==="single"?"один ответ":"все правильные ответы")+'</h4><div class="mr-tb-student-options">'+state.options.map((o,i)=>'<label><input type="'+it+'" name="previewChoice"><span>'+String.fromCharCode(65+i)+'. '+esc(o.text||"Вариант ответа")+'</span></label>').join("")+'</div><button>Проверить ответ</button></div>'}
      return '<div class="mr-tb-student-answer"><h4>Развёрнутый ответ</h4><textarea rows="5" placeholder="Введите решение или пояснение…"></textarea><button>Отправить ответ</button></div>';
    }
    function preview(){const t=topic();q("tbPreview").innerHTML='<div class="mr-tb-preview-sheet"><div class="mr-tb-preview-meta"><span>'+diffName(state.difficulty)+'</span><small>'+esc(t?.title||"Тема не выбрана")+' · '+esc(typeName(state.taskType))+'</small></div><div class="mr-tb-preview-problem">'+(state.content.trim()?nl(state.content):'<span class="placeholder">Здесь появится условие задачи.</span>')+'</div></div>'+studentAnswer()}
    function insertInto(el,text){if(!el)return;const a=el.selectionStart??el.value.length,b=el.selectionEnd??a;el.setRangeText(text,a,b,"end");el.dispatchEvent(new Event("input",{bubbles:true}));el.focus()}
    function legacyAnswer(){if(["standard","numeric"].includes(state.taskType))return state.answers.map(a=>a.value.trim()).filter(Boolean).join("; ");if(["single","multiple"].includes(state.taskType))return state.options.filter(o=>o.correct&&o.text.trim()).map(o=>o.text.trim()).join(" | ");return state.openAnswer.trim()}
    function collect(){state.grade=Number(q("tbGrade").value)||state.grade;state.topicId=q("tbTopic").value;state.subtopic=q("tbSubtopic").value;state.content=q("tbContent").value;state.settings.shared=!!q("tbShared").checked;state.settings.allowTests=!!q("tbAllowTests").checked;state.settings.allowAi=!!q("tbAllowAi").checked;setHelp(q("tbHelp").value);syncAnswer()}
    function builderMeta(){const t=topic();return {version:1,grade:Number(t?.grade||state.grade)||null,subtopic:state.subtopic.trim(),task_type:state.taskType,answers:state.answers,options:state.options,open_answer:state.openAnswer,solution:state.solution,hints:state.hints,source:{kind:state.source.kind,textbook_id:state.source.kind==="textbook"?(state.source.textbookId||null):null,page:state.source.kind==="textbook"?(state.source.page||null):null,exercise_no:state.source.kind==="textbook"?(state.source.exerciseNo||null):null,note:state.source.kind==="textbook"?"":state.source.note.trim()},settings:{shared:!!state.settings.shared,allow_tests:!!state.settings.allowTests,allow_ai_example:!!state.settings.allowAi}}}
    function back(){const ret=S.taskBuilderReturn||{view:"bank"};S.taskBuilderExerciseId=null;S.taskBuilderReturn=null;if(ret.view==="topics"&&ret.topicId){S.view="topics";S.topic=(S.topics||[]).find(t=>String(t.id)===String(ret.topicId))||null;return S.topic?renderTopic():renderTopics()}S.view="bank";S.topic=null;renderBank()}
    async function syncShared(saved,draft){
      if(draft)return;
      const t=(S.topics||[]).find(x=>String(x.id)===String(saved.topic_id));
      const old=(S.sharedMaterials||[]).find(x=>String(x.source_exercise_id||"")===String(saved.id)&&String(x.published_by||"")===String(S.user?.id||""));
      if(!state.settings.shared){if(old){const {error}=await sb.from("shared_materials").delete().eq("id",old.id);if(error)throw error}return}
      const body={published_by:S.user.id,source_exercise_id:saved.id,kind:"task",title:saved.title||"",content:saved.content||"",answer:saved.answer||"",difficulty:saved.difficulty||"basic",category:saved.category||"",tags:sharedMaterialUserTags(saved.tags),grade:Number(t?.grade)||null,section:t?.section||"",topic_title:t?.title||""};
      const res=old?await sb.from("shared_materials").update({...body,updated_at:new Date().toISOString()}).eq("id",old.id):await sb.from("shared_materials").insert(body);
      if(res.error)throw res.error;
    }
    async function save(draft){
      try{
        collect();const t=topic();if(!t)return toast("Выбери тему задачи");if(!draft&&!state.content.trim())return toast("Добавь условие задачи");if(!draft&&!legacyAnswer()&&state.taskType!=="open")return toast("Укажи правильный ответ");
        const sys=editing?exerciseSystemTags(editing.tags):[];const tags=[...new Set([...sys,"класс-"+t.grade,"тема:"+t.title,"тип:"+state.taskType])];
        const body={topic_id:t.id,kind:"task",title:(editing?.title&&editing.title.trim())||("Задача · "+t.title),content:state.content.trim(),answer:legacyAnswer(),difficulty:state.difficulty,category:state.subtopic.trim(),tags,builder_meta:builderMeta(),is_draft:!!draft,updated_at:new Date().toISOString()};
        const res=editing?await sb.from("exercises").update(body).eq("id",editing.id).select().single():await sb.from("exercises").insert({teacher_id:S.user.id,...body}).select().single();
        if(res.error)throw res.error;await syncShared(res.data,draft);await loadTeacher();toast(draft?"Черновик сохранён":editing?"Задача обновлена":"Задача добавлена в банк");back();
      }catch(e){fail(e)}
    }

    fillTopics();renderAnswer();renderSource();renderHelp();preview();
    q("tbGrade").onchange=e=>{state.grade=Number(e.target.value);fillTopics();state.topicId=q("tbTopic").value;preview()};
    q("tbTopic").onchange=e=>{state.topicId=e.target.value;preview()};
    q("tbSubtopic").oninput=e=>state.subtopic=e.target.value;
    q("tbContent").oninput=e=>{state.content=e.target.value;q("tbContentCount").textContent=e.target.value.length+"/5000";preview()};
    document.querySelectorAll("[data-tb-diff]").forEach(b=>b.onclick=()=>{state.difficulty=b.dataset.tbDiff;document.querySelectorAll("[data-tb-diff]").forEach(x=>x.classList.toggle("active",x===b));preview()});
    const setType=v=>{syncAnswer();state.taskType=v;if(v==="single"&&!state.options.some(o=>o.correct)&&state.options[0])state.options[0].correct=true;document.querySelectorAll("[data-tb-type]").forEach(x=>x.classList.toggle("active",x.dataset.tbType===v));renderAnswer();preview()};
    document.querySelectorAll("[data-tb-type]").forEach(b=>b.onclick=()=>setType(b.dataset.tbType));
    document.querySelectorAll("[data-insert]").forEach(b=>b.onclick=()=>{const k=b.dataset.insert;if(k==="formula")insertInto(q("tbContent"),"\\(  \\)");else if(k==="list")insertInto(q("tbContent"),"\n• ");else if(k==="template")insertInto(q("tbContent"),"{{a}}");else q("tbContent").focus()});
    document.querySelectorAll("[data-coming]").forEach(b=>b.onclick=()=>toast(b.dataset.coming+" подключим следующим этапом конструктора"));
    document.querySelectorAll("[data-help]").forEach(b=>b.onclick=()=>{setHelp(q("tbHelp").value);state.help=b.dataset.help;document.querySelectorAll("[data-help]").forEach(x=>x.classList.toggle("active",x===b));renderHelp()});
    q("tbHelp").oninput=e=>{setHelp(e.target.value);q("tbHelpCount").textContent=e.target.value.length+"/5000"};
    document.querySelectorAll("[data-help-insert]").forEach(b=>b.onclick=()=>{if(b.dataset.helpInsert==="formula")insertInto(q("tbHelp"),"\\(  \\)");else insertInto(q("tbHelp"),"\n• ")});
    document.querySelectorAll("[data-source]").forEach(b=>b.onclick=()=>{state.source.kind=b.dataset.source;document.querySelectorAll("[data-source]").forEach(x=>x.classList.toggle("active",x===b));renderSource()});
    q("tbShared").onchange=e=>state.settings.shared=e.target.checked;q("tbAllowTests").onchange=e=>state.settings.allowTests=e.target.checked;q("tbAllowAi").onchange=e=>state.settings.allowAi=e.target.checked;
    document.querySelectorAll("[data-info]").forEach(b=>b.onclick=()=>toast(b.dataset.info));
    q("tbExit").onclick=back;q("tbDraft").onclick=()=>save(true);q("tbSave").onclick=()=>save(false);
  }};
  window.MathroomTaskBuilderV60=API;
})();