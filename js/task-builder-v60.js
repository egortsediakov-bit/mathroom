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
      answerCheck:{
        numericEquivalent:meta.answer_check?.numeric_equivalence!==false,
        tolerance:Math.max(0,Number(meta.answer_check?.tolerance??0.000000001)||0),
        ignoreCase:meta.answer_check?.ignore_case!==false,
        ignoreSpaces:meta.answer_check?.ignore_spaces!==false
      },
      content:String(editing?.content||""),
      templateVars:Array.isArray(meta.template_vars)?meta.template_vars.map((v,i)=>({
        id:String(v?.id||("var"+i)),
        name:String(v?.name||String.fromCharCode(97+i)).replace(/[^A-Za-z0-9_]/g,"").slice(0,16)||("v"+(i+1)),
        min:Number.isFinite(Number(v?.min))?Number(v.min):1,
        max:Number.isFinite(Number(v?.max))?Number(v.max):10,
        step:Math.max(1e-9,Math.abs(Number(v?.step)||1)),
        multipleOf:Math.max(0,Math.abs(Number(v?.multiple_of)||0)),
        parity:["any","even","odd"].includes(v?.parity)?v.parity:"any",
        nonZero:!!v?.non_zero
      })).slice(0,12):[],
      templateCondition:String(meta.template_settings?.condition||""),
      templateIntegerAnswers:!!meta.template_settings?.integer_answers,
      templateValues:{},
      images:Array.isArray(meta.images)?meta.images.map((img,i)=>({
        id:String(img?.id||("img"+i)),
        path:String(img?.path||""),
        name:String(img?.name||"Изображение"),
        mime:String(img?.mime||"image/png"),
        width:Math.max(1,Number(img?.width)||1),
        height:Math.max(1,Number(img?.height)||1),
        displayWidth:Math.min(100,Math.max(30,Number(img?.display_width)||100)),
        alt:String(img?.alt||"")
      })).filter(img=>img.path):[],
      tables:Array.isArray(meta.tables)?meta.tables.map((table,i)=>{
        const raw=Array.isArray(table?.cells)?table.cells:[];
        const rows=Math.min(12,Math.max(1,Number(table?.rows)||raw.length||3));
        const cols=Math.min(12,Math.max(1,Number(table?.cols)||Math.max(0,...raw.map(r=>Array.isArray(r)?r.length:0))||3));
        return {
          id:String(table?.id||("tbl"+i)),
          caption:String(table?.caption||""),
          rows,cols,
          headerRow:!!table?.header_row,
          headerCol:!!table?.header_col,
          cells:Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>String(Array.isArray(raw[r])?raw[r][c]??"":"")))
        };
      }):[],
      contentOrder:Array.isArray(meta.content_order)?meta.content_order.map(String):[],
      geometries:Array.isArray(meta.geometries)?meta.geometries.map((g,i)=>({
        id:String(g?.id||("geo"+i)),
        type:["triangle","rectangle","circle","coordinate"].includes(g?.type)?g.type:"triangle",
        caption:String(g?.caption||""),
        displayWidth:Math.min(100,Math.max(45,Number(g?.display_width)||80)),
        triangle:{
          vertices:Array.isArray(g?.triangle?.vertices)?[0,1,2].map(n=>String(g.triangle.vertices[n]||["A","B","C"][n])):["A","B","C"],
          sides:Array.isArray(g?.triangle?.sides)?[0,1,2].map(n=>String(g.triangle.sides[n]||"")):["","",""],
          rightAngle:["","0","1","2"].includes(String(g?.triangle?.right_angle??""))?String(g.triangle.right_angle??""):""
        },
        rectangle:{
          vertices:Array.isArray(g?.rectangle?.vertices)?[0,1,2,3].map(n=>String(g.rectangle.vertices[n]||["A","B","C","D"][n])):["A","B","C","D"],
          widthLabel:String(g?.rectangle?.width_label||""),
          heightLabel:String(g?.rectangle?.height_label||"")
        },
        circle:{centerLabel:String(g?.circle?.center_label||"O"),radiusLabel:String(g?.circle?.radius_label||"r")},
        coordinate:{
          points:String(g?.coordinate?.points||"A(2;3); B(-1;4)"),
          xMin:Math.max(-20,Math.min(-1,Number(g?.coordinate?.x_min)||-5)),
          xMax:Math.min(20,Math.max(1,Number(g?.coordinate?.x_max)||5)),
          yMin:Math.max(-20,Math.min(-1,Number(g?.coordinate?.y_min)||-5)),
          yMax:Math.min(20,Math.max(1,Number(g?.coordinate?.y_max)||5))
        }
      })):[],
      answers:Array.isArray(meta.answers)&&meta.answers.length?meta.answers.map((a,i)=>({label:String(a?.label||("Ответ "+(i+1))),value:String(a?.value||""),accepted:Array.isArray(a?.accepted)?a.accepted.map(String):[]})):[{label:"Ответ",value:String(editing?.answer||""),accepted:[]}],
      options:Array.isArray(meta.options)&&meta.options.length?meta.options.map((o,i)=>({id:String(o?.id||("o"+i)),text:String(o?.text||""),correct:!!o?.correct})):[{id:"o0",text:"",correct:true},{id:"o1",text:"",correct:false},{id:"o2",text:"",correct:false},{id:"o3",text:"",correct:false}],
      openAnswer:String(meta.open_answer??(meta.task_type==="open"?editing?.answer||"":"")),
      solution:String(meta.solution||""),
      hints:Array.isArray(meta.hints)?[0,1,2].map(i=>String(meta.hints[i]||"")):["","",""],
      helpSettings:{
        homeworkHints:meta.help_settings?.homework_hints!==false,
        testHints:!!meta.help_settings?.test_hints,
        solutionMode:["after_attempt","teacher_only"].includes(meta.help_settings?.solution_mode)?meta.help_settings.solution_mode:"after_attempt"
      },
      source:{kind:["textbook","mine","ai","other"].includes(src.kind)?src.kind:"mine",textbookId:String(src.textbook_id||""),page:String(src.page||""),exerciseNo:String(src.exercise_no||""),note:String(src.note||"")},
      settings:{shared:settings.shared!=null?!!settings.shared:!!shared,allowTests:settings.allow_tests!==false,allowAi:settings.allow_ai_example!==false},
      help:"solution"
    };
    const diffName=v=>v==="advanced"?"Сложная":v==="medium"?"Средняя":"Простая";
    const typeName=v=>({standard:"Обычная задача",numeric:"Числовой ответ",single:"Тест",multiple:"Несколько ответов",open:"Развёрнутый ответ"}[v]||"Обычная задача");
    const q=id=>document.getElementById(id);
    const TASK_IMAGE_BUCKET="task-images";
    const imageUrlCache=new Map(),imageUrlPending=new Map(),pendingImagePaths=new Set();
    const imageById=id=>state.images.find(x=>String(x.id)===String(id))||null;
    const imageId=()=>window.crypto?.randomUUID?.()||("img-"+Date.now()+"-"+Math.random().toString(36).slice(2));
    const tableById=id=>state.tables.find(x=>String(x.id)===String(id))||null;
    const tableId=()=>window.crypto?.randomUUID?.()||("tbl-"+Date.now()+"-"+Math.random().toString(36).slice(2));
    const geometryById=id=>state.geometries.find(x=>String(x.id)===String(id))||null;
    const geometryId=()=>window.crypto?.randomUUID?.()||("geo-"+Date.now()+"-"+Math.random().toString(36).slice(2));
    function allContentKeys(){
      return ["text",...state.images.map(x=>"image:"+x.id),...state.tables.map(x=>"table:"+x.id),...state.geometries.map(x=>"geometry:"+x.id)];
    }
    function syncContentOrder(){
      const valid=new Set(allContentKeys()),seen=new Set(),next=[];
      for(const key of state.contentOrder||[]){
        if(valid.has(key)&&!seen.has(key)){seen.add(key);next.push(key)}
      }
      for(const key of allContentKeys())if(!seen.has(key)){seen.add(key);next.push(key)}
      state.contentOrder=next;
      return next;
    }
    function moveContentBlock(key,delta){
      syncContentOrder();
      const i=state.contentOrder.indexOf(key),j=i+delta;
      if(i<0||j<0||j>=state.contentOrder.length)return;
      [state.contentOrder[i],state.contentOrder[j]]=[state.contentOrder[j],state.contentOrder[i]];
      renderContentOrder();preview();
    }
    const imageExt=mime=>({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[mime]||"png");
    const templateVarId=()=>window.crypto?.randomUUID?.()||("var-"+Date.now()+"-"+Math.random().toString(36).slice(2));
    function normalizeTemplateVars(){
      const used=new Set();
      state.templateVars=state.templateVars.map((v,i)=>{
        let name=String(v.name||"").replace(/[^A-Za-z0-9_]/g,"").replace(/^([^A-Za-z_])/,"_$1").slice(0,16)||("v"+(i+1));
        let base=name,n=2;while(used.has(name))name=(base.slice(0,13)+n++).slice(0,16);
        used.add(name);
        let min=Number(v.min),max=Number(v.max),step=Math.max(1e-9,Math.abs(Number(v.step)||1));
        let multipleOf=Math.max(0,Math.abs(Number(v.multipleOf)||0));
        const parity=["any","even","odd"].includes(v.parity)?v.parity:"any";
        if(!Number.isFinite(min))min=1;if(!Number.isFinite(max))max=10;if(min>max)[min,max]=[max,min];
        if(!Number.isFinite(multipleOf))multipleOf=0;
        return {...v,name,min,max,step,multipleOf,parity,nonZero:!!v.nonZero};
      });
      const valid=new Set(state.templateVars.map(v=>v.name));
      for(const k of Object.keys(state.templateValues))if(!valid.has(k))delete state.templateValues[k];
    }
    function templateCandidateValid(v,value){
      if(!Number.isFinite(value))return false;
      if(v.nonZero&&Math.abs(value)<1e-12)return false;
      if(v.multipleOf>0){
        const ratio=value/v.multipleOf;
        if(Math.abs(ratio-Math.round(ratio))>1e-10)return false;
      }
      if(v.parity!=="any"){
        if(Math.abs(value-Math.round(value))>1e-10)return false;
        const even=Math.abs(Math.round(value)%2)===0;
        if(v.parity==="even"&&!even)return false;
        if(v.parity==="odd"&&even)return false;
      }
      return true;
    }
    function templateCandidates(v,limit=5000){
      const count=Math.max(0,Math.floor((v.max-v.min)/v.step));
      const out=[];
      if(count<=limit){
        for(let i=0;i<=count;i++){
          const value=v.min+i*v.step;
          if(templateCandidateValid(v,value))out.push(value);
        }
        return out;
      }
      const seen=new Set();
      for(let tries=0;tries<Math.min(limit*3,15000)&&out.length<limit;tries++){
        const i=Math.floor(Math.random()*(count+1)),value=v.min+i*v.step,key=String(value);
        if(seen.has(key))continue;seen.add(key);
        if(templateCandidateValid(v,value))out.push(value);
      }
      return out;
    }
    function randomTemplateValue(v){
      const values=templateCandidates(v);
      if(!values.length)throw new Error("Для переменной "+v.name+" нет чисел, подходящих под ограничения");
      return values[Math.floor(Math.random()*values.length)];
    }
    function templateEval(expr,scope){
      if(!window.math?.evaluate)throw new Error("Математический движок не загружен");
      const exactScope={};
      for(const [k,v] of Object.entries(scope||{})){
        try{exactScope[k]=window.math.fraction?window.math.fraction(v):v}catch{exactScope[k]=v}
      }
      return window.math.evaluate(expr,exactScope);
    }
    function templateConditionOk(scope){
      const cond=String(state.templateCondition||"").trim();
      if(!cond)return true;
      try{return !!templateEval(cond,scope)}catch{return false}
    }
    function templateAnswerExpressions(){
      const strings=[];
      if(["standard","numeric"].includes(state.taskType))state.answers.forEach(a=>strings.push(a.value,...(a.accepted||[])));
      else if(["single","multiple"].includes(state.taskType))state.options.filter(o=>o.correct).forEach(o=>strings.push(o.text));
      else strings.push(state.openAnswer);
      const exprs=[];
      strings.forEach(src=>{const re=/{{\s*([^{}]+?)\s*}}/g;let m;while((m=re.exec(String(src||""))))exprs.push(m[1])});
      return exprs;
    }
    function templateIntegerAnswersOk(scope){
      if(!state.templateIntegerAnswers)return true;
      const exprs=templateAnswerExpressions();
      for(const expr of exprs){
        try{
          const value=templateEval(expr,scope);
          if(value&&typeof value==="object"&&Number.isFinite(Number(value.d))){
            if(Number(value.d)!==1)return false;
            continue;
          }
          const n=typeof value==="number"?value:Number(value?.toString?.()??value);
          if(Number.isFinite(n)&&Math.abs(n-Math.round(n))>1e-10)return false;
        }catch{return false}
      }
      return true;
    }
    function generateTemplateScope({tries=600}={}){
      normalizeTemplateVars();
      if(!state.templateVars.length)return {};
      for(const v of state.templateVars)if(!templateCandidates(v).length)throw new Error("Для "+v.name+" нет допустимых значений в заданном диапазоне");
      for(let attempt=0;attempt<tries;attempt++){
        const scope={};
        for(const v of state.templateVars)scope[v.name]=randomTemplateValue(v);
        if(templateConditionOk(scope)&&templateIntegerAnswersOk(scope))return scope;
      }
      throw new Error("Не удалось подобрать числа под все ограничения. Расширь диапазон или ослабь условие.");
    }
    function rerollTemplateValues(){
      state.templateValues=generateTemplateScope();
      return state.templateValues;
    }
    function ensureTemplateValues(){
      normalizeTemplateVars();
      const keys=state.templateVars.map(v=>v.name);
      const complete=keys.every(k=>Number.isFinite(Number(state.templateValues[k])));
      if(complete&&templateConditionOk(state.templateValues)&&templateIntegerAnswersOk(state.templateValues))return;
      try{state.templateValues=generateTemplateScope({tries:300})}
      catch{for(const v of state.templateVars){const c=templateCandidates(v);state.templateValues[v.name]=c[0]??v.min}}
    }
    function formatTemplateValue(value){
      if(value&&typeof value==="object"){
        const n=Number(value.n),d=Number(value.d),sign=Number(value.s??1);
        if(Number.isFinite(n)&&Number.isFinite(d)&&d!==0){
          if(d===1)return String(sign*n);
          let rest=Math.abs(d);while(rest%2===0)rest/=2;while(rest%5===0)rest/=5;
          if(rest===1){
            const decimal=sign*n/d;
            return String(Number(decimal.toPrecision(15)));
          }
          return (sign<0?"-":"")+n+"/"+d;
        }
        if(typeof value.toString==="function")return value.toString();
      }
      if(typeof value==="number"&&Number.isFinite(value)){
        if(Math.abs(value-Math.round(value))<1e-12)return String(Math.round(value));
        return String(Number(value.toPrecision(15)));
      }
      return String(value??"");
    }
    function renderTemplateString(value,scope=state.templateValues){
      const src=String(value??"");
      if(!src.includes("{{"))return src;
      return src.replace(/{{\s*([^{}]+?)\s*}}/g,(full,expr)=>{
        try{
          if(window.math?.evaluate)return formatTemplateValue(templateEval(expr,scope));
          if(Object.prototype.hasOwnProperty.call(scope,expr.trim()))return formatTemplateValue(scope[expr.trim()]);
        }catch{}
        return full;
      });
    }
    async function signedImageUrl(path){
      if(!path)return "";
      if(imageUrlCache.has(path))return imageUrlCache.get(path);
      if(imageUrlPending.has(path))return imageUrlPending.get(path);
      const promise=(async()=>{
        let lastError=null;
        for(const delay of [0,180,420,900]){
          if(delay)await new Promise(r=>setTimeout(r,delay));
          const {data,error}=await sb.storage.from(TASK_IMAGE_BUCKET).createSignedUrl(path,3600);
          if(!error&&data?.signedUrl){
            imageUrlCache.set(path,data.signedUrl);
            return data.signedUrl;
          }
          lastError=error||new Error("Не удалось получить ссылку на изображение");
        }
        throw lastError;
      })().finally(()=>imageUrlPending.delete(path));
      imageUrlPending.set(path,promise);
      return promise;
    }
    function releaseImageUrl(path){
      const url=imageUrlCache.get(path);
      if(url&&String(url).startsWith("blob:"))try{URL.revokeObjectURL(url)}catch{}
      imageUrlCache.delete(path);
    }
    function releaseLocalImageUrls(){
      for(const [path,url] of imageUrlCache.entries()){
        if(String(url).startsWith("blob:")){try{URL.revokeObjectURL(url)}catch{};imageUrlCache.delete(path)}
      }
    }
    async function hydrateTaskImages(root=document){
      const nodes=[...(root||document).querySelectorAll?.("[data-tb-image-src]")||[]];
      await Promise.all(nodes.map(async el=>{
        const img=imageById(el.dataset.tbImageSrc);if(!img||!img.path)return;
        if(el.dataset.tbLoadedPath===img.path&&el.getAttribute("src"))return;
        try{
          const url=await signedImageUrl(img.path);
          if(el.isConnected&&url){el.src=url;el.dataset.tbLoadedPath=img.path;el.closest(".mr-tb-image-thumb,.mr-tb-preview-image")?.classList.remove("load-error")}
        }catch(e){console.warn("[Mathroom task image]",e);el.closest(".mr-tb-image-thumb,.mr-tb-preview-image")?.classList.add("load-error")}
      }));
    }
    async function readImageSize(file){
      return await new Promise((resolve,reject)=>{
        const url=URL.createObjectURL(file),img=new Image();
        img.onload=()=>{const out={width:img.naturalWidth||1,height:img.naturalHeight||1};URL.revokeObjectURL(url);resolve(out)};
        img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Не удалось прочитать изображение"))};
        img.src=url;
      });
    }
    async function cleanupPendingImages(){
      const paths=[...pendingImagePaths];pendingImagePaths.clear();
      if(!paths.length)return;
      try{await sb.storage.from(TASK_IMAGE_BUCKET).remove(paths)}catch(e){console.warn("[Mathroom task image cleanup]",e)}
    }
    const icon=name=>{const map={
      info:'<path d="M4 6.5h16v12H4z"/><path d="M8 4v5M16 4v5M8 13h3M13 13h3"/>',
      condition:'<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v5h5M8 13h8M8 16h6"/>',
      answer:'<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.3 2.3 4.9-5"/>',
      solution:'<path d="M4 18h16M7 15l7-7 3 3-7 7H7v-3Z"/><path d="m13 9 3 3"/>',
      source:'<path d="M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 1-3-3V5Z"/><path d="M8 19a3 3 0 0 1 0-6h11M9 8h6"/>',
      preview:'<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/>',
      settings:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'
    };return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(map[name]||map.info)+'</svg>'};
    const section=(name,title,sub)=>'<div class="mr-tb-head"><span>'+icon(name)+'</span><div><h2>'+title+'</h2><p>'+sub+'</p></div></div>';
    const types=[["standard","Обычная задача"],["numeric","Числовой ответ"],["single","Тест"],["multiple","Несколько ответов"],["open","Развёрнутый ответ"]];
    const typeButtons=types.map(([v,n])=>'<button type="button" data-tb-type="'+v+'" class="'+(state.taskType===v?"active":"")+'">'+n+'</button>').join("");
    const diffButtons=[["basic","Простая"],["medium","Средняя"],["advanced","Сложная"]].map(([v,n])=>'<button type="button" data-tb-diff="'+v+'" class="'+(state.difficulty===v?"active":"")+'">'+n+'</button>').join("");
    const grades=Array.from({length:11},(_,i)=>i+1).map(g=>'<option value="'+g+'" '+(g===state.grade?"selected":"")+'>'+g+' класс</option>').join("");
    const top='<div class="mr-tb-top"><button id="tbExit" class="ghost">← В банк</button><button id="tbAudit" class="audit">◉ Проверить задачу</button><button id="tbDraft">Сохранить в черновики</button><button id="tbSave" class="save">✓ '+(editing?"Сохранить изменения":"Сохранить задачу")+'</button></div>';
    const html=
      '<div class="mr-task-builder"><div class="mr-tb-grid"><main class="mr-tb-main">'+
        '<section class="mr-tb-card">'+section("info","Основная информация","Выберите тему, сложность и тип задачи")+
          '<div class="mr-tb-fields"><label><span>Класс</span><select id="tbGrade">'+grades+'</select></label><label class="topic"><span>Тема</span><select id="tbTopic"></select></label><label><span>Подтема <em>(необязательно)</em></span><input id="tbSubtopic" value="'+esc(state.subtopic)+'" placeholder="Например: Округление"></label></div>'+
          '<div class="mr-tb-choices"><div><b>Сложность</b><div class="mr-tb-segments">'+diffButtons+'</div></div><div class="grow"><b>Тип задачи</b><div class="mr-tb-segments types">'+typeButtons+'</div></div></div>'+
        '</section>'+
        '<section class="mr-tb-card">'+section("condition","Условие задачи","Введите текст, добавьте формулы и структурные элементы")+
          '<div class="mr-tb-toolbar"><button data-insert="text">T&nbsp; Текст</button><button class="active" data-insert="formula">∿&nbsp; Формула</button><button data-insert="list">☷&nbsp; Список</button><button data-insert="template">◇&nbsp; Шаблон</button><button data-insert="image">▧&nbsp; Изображение</button><button data-insert="table">⊞&nbsp; Таблица</button><button data-insert="geometry">△&nbsp; Геометрия</button></div>'+
          '<div class="mr-tb-editor"><textarea id="tbContent" maxlength="5000" placeholder="Введите условие задачи…">'+esc(state.content)+'</textarea><span id="tbContentCount">'+state.content.length+'/5000</span></div>'+
          '<input id="tbImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>'+
          '<div id="tbImages" class="mr-tb-images"></div>'+
          '<div id="tbTables" class="mr-tb-tables"></div>'+
          '<div id="tbGeometries" class="mr-tb-geometries"></div>'+
          '<div id="tbTemplateVars" class="mr-tb-template-vars"></div>'+
          '<div id="tbContentOrder" class="mr-tb-content-order"></div>'+
        '</section>'+
        '<section class="mr-tb-card">'+section("answer","Правильный ответ","Укажите правильный ответ и допустимые варианты")+
          '<div class="mr-tb-answer-types">'+typeButtons+'</div><div id="tbAnswerEditor"></div>'+
        '</section>'+
        '<div class="mr-tb-bottom">'+
          '<section class="mr-tb-card">'+section("solution","Решение и подсказки","Добавьте решение для преподавателя и подсказки ученику")+
            '<div class="mr-tb-help-tabs"><button class="active" data-help="solution">Решение</button><button data-help="hint0">Подсказка 1</button><button data-help="hint1">Подсказка 2</button><button data-help="hint2">Подсказка 3</button></div>'+
            '<div class="mr-tb-mini-tools"><button data-help-insert="formula">∿ Формула</button><button data-help-insert="list">☷ Список</button></div>'+
            '<div class="mr-tb-editor small"><textarea id="tbHelp" maxlength="5000"></textarea><span id="tbHelpCount">0/5000</span></div>'+
            '<div class="mr-tb-help-settings">'+
              '<label><input id="tbHomeworkHints" type="checkbox" '+(state.helpSettings.homeworkHints?"checked":"")+'><div><b>Подсказки в домашней работе</b><small>Ученик открывает их по одной. Уже открытые подсказки запоминаются.</small></div></label>'+
              '<label><input id="tbTestHints" type="checkbox" '+(state.helpSettings.testHints?"checked":"")+'><div><b>Подсказки в тестах</b><small>По умолчанию выключено, чтобы не снижать объективность теста.</small></div></label>'+
              '<label class="mr-tb-solution-mode"><div><b>Полное решение ученику</b><small>Когда разрешить увидеть готовое решение.</small></div><select id="tbSolutionMode"><option value="after_attempt" '+(state.helpSettings.solutionMode==="after_attempt"?"selected":"")+'>После первой сданной попытки</option><option value="teacher_only" '+(state.helpSettings.solutionMode==="teacher_only"?"selected":"")+'>Только преподавателю</option></select></label>'+
            '</div>'+
          '</section>'+
          '<section class="mr-tb-card">'+section("source","Источник","Укажите, откуда взята задача")+
            '<div class="mr-tb-source-tabs"><button data-source="textbook" class="'+(state.source.kind==="textbook"?"active":"")+'">Учебник</button><button data-source="mine" class="'+(state.source.kind==="mine"?"active":"")+'">Моя задача</button><button data-source="ai" class="'+(state.source.kind==="ai"?"active":"")+'">Сгенерировано AI</button><button data-source="other" class="'+(state.source.kind==="other"?"active":"")+'">Другое</button></div><div id="tbSource"></div>'+
          '</section>'+
        '</div>'+
      '</main><aside class="mr-tb-side">'+
        '<section class="mr-tb-preview-card"><div class="mr-tb-sidehead"><span>'+icon("preview")+'</span><div><h2>Предпросмотр задачи</h2><p>Так задачу увидит ученик</p></div></div><div class="mr-tb-preview-tabs"><button class="active">Условие</button><button data-info="'+(state.helpSettings.solutionMode==="after_attempt"?"Решение откроется ученику после первой попытки":"Решение видно только преподавателю")+'">Решение</button><button data-info="Подсказки открываются ученику по одной и запоминаются">Подсказки</button></div><div id="tbPreview"></div></section>'+
        '<section id="tbQualityAudit" class="mr-tb-quality"></section>'+
        '<section class="mr-tb-settings"><div class="mr-tb-sidehead"><span>'+icon("settings")+'</span><div><h2>Параметры использования</h2><p>Настройки для банка задач</p></div></div>'+
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
        host.innerHTML='<div class="mr-tb-answer-list">'+state.answers.map((a,i)=>'<div class="mr-tb-answer-row" data-answer-row><label><span>Метка</span><input data-label value="'+esc(a.label)+'"></label><label class="answer"><span>Правильный ответ</span><input data-value '+(state.taskType==="numeric"?'inputmode="decimal"':'')+' value="'+esc(a.value)+'" placeholder="Введите ответ"></label><label class="accepted"><span>Допустимые варианты</span><input data-accepted value="'+esc((a.accepted||[]).join(", "))+'" placeholder="через запятую"></label><button data-remove-answer="'+i+'" '+(state.answers.length===1?"disabled":"")+'>×</button></div>').join("")+'<button class="mr-tb-add" id="tbAddAnswer">＋ Добавить ещё один ответ</button></div>'+
          '<div class="mr-tb-answer-check"><div class="mr-tb-answer-check-head"><b>Как проверять ответ</b><small>Настройки применяются при автоматической проверке ДЗ и тестов</small></div>'+
          '<div class="mr-tb-answer-check-grid">'+
            '<label class="toggle"><input id="tbCheckNumeric" type="checkbox" '+(state.answerCheck.numericEquivalent?"checked":"")+'><div><b>Числовые эквиваленты</b><small>Например, 1/2 = 0.5 = 0,5</small></div></label>'+
            '<label class="tolerance"><span>Допуск ±</span><input id="tbCheckTolerance" type="number" min="0" step="any" value="'+state.answerCheck.tolerance+'" '+(state.answerCheck.numericEquivalent?"":"disabled")+'><small>0 — строгое совпадение чисел</small></label>'+
            '<label class="toggle"><input id="tbCheckCase" type="checkbox" '+(state.answerCheck.ignoreCase?"checked":"")+'><div><b>Не учитывать регистр</b><small>«Москва» и «москва» считаются одинаковыми</small></div></label>'+
            '<label class="toggle"><input id="tbCheckSpaces" type="checkbox" '+(state.answerCheck.ignoreSpaces?"checked":"")+'><div><b>Не учитывать пробелы</b><small>Лишние пробелы не делают ответ ошибочным</small></div></label>'+
          '</div></div>';
        q("tbAddAnswer").onclick=()=>{syncAnswer();state.answers.push({label:"Ответ "+(state.answers.length+1),value:"",accepted:[]});renderAnswer();preview()};
        host.querySelectorAll("[data-remove-answer]").forEach(b=>b.onclick=()=>{syncAnswer();state.answers.splice(Number(b.dataset.removeAnswer),1);renderAnswer();preview()});
        q("tbCheckNumeric").onchange=e=>{state.answerCheck.numericEquivalent=e.target.checked;q("tbCheckTolerance").disabled=!e.target.checked};
        q("tbCheckTolerance").onchange=e=>state.answerCheck.tolerance=Math.max(0,Number(e.target.value)||0);
        q("tbCheckCase").onchange=e=>state.answerCheck.ignoreCase=e.target.checked;
        q("tbCheckSpaces").onchange=e=>state.answerCheck.ignoreSpaces=e.target.checked;
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
      ensureTemplateValues();
      if(["standard","numeric"].includes(state.taskType))return '<div class="mr-tb-student-answer"><h4>Ответ ученика</h4>'+state.answers.map((a,i)=>'<label><span>'+esc(renderTemplateString(a.label||("Ответ "+(i+1))))+'</span><input placeholder="Введите ответ…"></label>').join("")+'<button>Проверить ответ</button></div>';
      if(["single","multiple"].includes(state.taskType)){const it=state.taskType==="single"?"radio":"checkbox";return '<div class="mr-tb-student-answer"><h4>Выберите '+(state.taskType==="single"?"один ответ":"все правильные ответы")+'</h4><div class="mr-tb-student-options">'+state.options.map((o,i)=>'<label><input type="'+it+'" name="previewChoice"><span>'+String.fromCharCode(65+i)+'. '+esc(renderTemplateString(o.text||"Вариант ответа"))+'</span></label>').join("")+'</div><button>Проверить ответ</button></div>'}
      return '<div class="mr-tb-student-answer"><h4>Развёрнутый ответ</h4><textarea rows="5" placeholder="Введите решение или пояснение…"></textarea><button>Отправить ответ</button></div>';
    }
    function previewImagesHtml(){
      if(!state.images.length)return "";
      return '<div class="mr-tb-preview-images">'+state.images.map(img=>'<figure class="mr-tb-preview-image" style="width:'+img.displayWidth+'%"><img data-tb-image-src="'+esc(img.id)+'" alt="'+esc(renderTemplateString(img.alt||img.name||"Изображение к задаче"))+'"><figcaption>'+(img.alt?esc(renderTemplateString(img.alt)):"")+'</figcaption></figure>').join("")+'</div>';
    }
    function tableHtml(table,{previewMode=false}={}){
      ensureTemplateValues();
      const rows=table.cells.map((row,r)=>'<tr>'+row.map((cell,c)=>{
        const tag=(table.headerRow&&r===0)||(table.headerCol&&c===0)?'th':'td';
        const value=renderTemplateString(cell);
        return '<'+tag+'>'+((String(value).trim())?nl(String(value)):(previewMode?'&nbsp;':''))+'</'+tag+'>';
      }).join("")+'</tr>').join("");
      return '<figure class="'+(previewMode?'mr-tb-preview-table':'mr-tb-table-render')+'">'+
        (table.caption?'<figcaption>'+esc(renderTemplateString(table.caption))+'</figcaption>':'')+
        '<div class="mr-tb-table-scroll"><table>'+rows+'</table></div></figure>';
    }
    function previewTablesHtml(){
      if(!state.tables.length)return "";
      return '<div class="mr-tb-preview-tables">'+state.tables.map(t=>tableHtml(t,{previewMode:true})).join("")+'</div>';
    }
    function parseCoordinatePoints(raw){
      const out=[],re=/([^();\n]+?)\s*\(\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*\)/g;
      let m;
      while((m=re.exec(String(raw||"")))){
        const x=Number(m[2].replace(",", ".")),y=Number(m[3].replace(",", "."));
        if(Number.isFinite(x)&&Number.isFinite(y))out.push({label:m[1].trim().replace(/^[;,\s]+/,""),x,y});
      }
      return out;
    }
    function geometrySvg(g){
      ensureTemplateValues();
      const txt=(x,y,v,anchor="middle",cls="label")=>'<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" class="'+cls+'">'+esc(renderTemplateString(String(v||"")))+'</text>';
      if(g.type==="rectangle"){
        const v=g.rectangle.vertices;
        return '<svg viewBox="0 0 360 230" role="img" aria-label="Прямоугольник"><rect x="72" y="48" width="216" height="134" class="shape"/>'+
          txt(60,43,v[0],"end")+txt(300,43,v[1],"start")+txt(300,202,v[2],"start")+txt(60,202,v[3],"end")+
          (g.rectangle.widthLabel?txt(180,34,g.rectangle.widthLabel):"")+
          (g.rectangle.heightLabel?txt(314,118,g.rectangle.heightLabel,"start"):"")+'</svg>';
      }
      if(g.type==="circle"){
        return '<svg viewBox="0 0 360 230" role="img" aria-label="Окружность"><circle cx="180" cy="115" r="72" class="shape"/><circle cx="180" cy="115" r="3.5" class="point"/><line x1="180" y1="115" x2="252" y2="115" class="shape"/>'+
          txt(169,108,g.circle.centerLabel,"end")+txt(216,104,g.circle.radiusLabel)+'</svg>';
      }
      if(g.type==="coordinate"){
        const x0=g.coordinate.xMin,x1=g.coordinate.xMax,y0=g.coordinate.yMin,y1=g.coordinate.yMax;
        const left=52,right=354,top=28,bottom=232,w=right-left,h=bottom-top;
        const sx=x=>left+(x-x0)/(x1-x0)*w,sy=y=>bottom-(y-y0)/(y1-y0)*h;
        const span=Math.max(x1-x0,y1-y0),step=span<=12?1:span<=24?2:5;
        const xAxisY=sy(0),yAxisX=sx(0);
        let grid="",ticks="";
        const firstX=Math.ceil(x0/step)*step,firstY=Math.ceil(y0/step)*step;
        for(let x=firstX;x<=x1+1e-9;x+=step){
          if(Math.abs(x)<1e-9)continue;
          const px=sx(x);
          grid+='<line x1="'+px+'" y1="'+top+'" x2="'+px+'" y2="'+bottom+'" class="coord-grid"/>';
          ticks+='<line x1="'+px+'" y1="'+(xAxisY-4)+'" x2="'+px+'" y2="'+(xAxisY+4)+'" class="coord-tick"/>'+txt(px,xAxisY+19,Number(x.toFixed(6)),"middle","coord-tick-label");
        }
        for(let y=firstY;y<=y1+1e-9;y+=step){
          if(Math.abs(y)<1e-9)continue;
          const py=sy(y);
          grid+='<line x1="'+left+'" y1="'+py+'" x2="'+right+'" y2="'+py+'" class="coord-grid"/>';
          ticks+='<line x1="'+(yAxisX-4)+'" y1="'+py+'" x2="'+(yAxisX+4)+'" y2="'+py+'" class="coord-tick"/>'+txt(yAxisX-11,py+4,Number(y.toFixed(6)),"end","coord-tick-label");
        }
        const axes=
          '<line x1="'+left+'" y1="'+xAxisY+'" x2="'+(right-7)+'" y2="'+xAxisY+'" class="coord-axis"/>'+
          '<path d="M '+(right-7)+' '+(xAxisY-5)+' L '+right+' '+xAxisY+' L '+(right-7)+' '+(xAxisY+5)+'" class="coord-arrow"/>'+
          '<line x1="'+yAxisX+'" y1="'+bottom+'" x2="'+yAxisX+'" y2="'+(top+7)+'" class="coord-axis"/>'+
          '<path d="M '+(yAxisX-5)+' '+(top+7)+' L '+yAxisX+' '+top+' L '+(yAxisX+5)+' '+(top+7)+'" class="coord-arrow"/>'+
          txt(right-1,xAxisY-11,"x","end","coord-axis-name")+txt(yAxisX+11,top+2,"y","start","coord-axis-name")+
          txt(yAxisX-10,xAxisY+18,"0","end","coord-origin");
        const pts=parseCoordinatePoints(renderTemplateString(g.coordinate.points)).filter(p=>p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1).map(p=>{
          const px=sx(p.x),py=sy(p.y);
          const dx=px>right-45?-10:10,anchor=px>right-45?"end":"start",dy=py<top+28?18:-11;
          return '<circle cx="'+px+'" cy="'+py+'" r="7" class="coord-point-halo"/><circle cx="'+px+'" cy="'+py+'" r="4.8" class="coord-point"/>'+txt(px+dx,py+dy,p.label,anchor,"coord-point-label");
        }).join("");
        return '<svg viewBox="0 0 406 264" role="img" aria-label="Координатная плоскость"><rect x="'+left+'" y="'+top+'" width="'+w+'" height="'+h+'" rx="12" class="coord-plot-bg"/>'+grid+axes+ticks+pts+'</svg>';
      }
      const v=g.triangle.vertices,s=g.triangle.sides;
      const right=g.triangle.rightAngle;
      const marker=right==="0"?'<path d="M88 160h18v-18" class="right-angle"/>':right==="1"?'<path d="M272 160h-18v-18" class="right-angle"/>':right==="2"?'<path d="M173 54l11 14 14-11" class="right-angle"/>':"";
      return '<svg viewBox="0 0 360 230" role="img" aria-label="Треугольник"><polygon points="82,170 278,170 180,48" class="shape"/>'+marker+
        txt(70,188,v[0],"end")+txt(290,188,v[1],"start")+txt(180,34,v[2])+
        (s[0]?txt(180,193,s[0]):"")+(s[1]?txt(244,103,s[1],"start"):"")+(s[2]?txt(116,103,s[2],"end"):"")+'</svg>';
    }
    function geometryHtml(g,{previewMode=false}={}){
      return '<figure class="'+(previewMode?'mr-tb-preview-geometry':'mr-tb-geometry-render')+'" style="width:'+g.displayWidth+'%">'+
        (g.caption?'<figcaption>'+esc(renderTemplateString(g.caption))+'</figcaption>':'')+
        '<div class="mr-geometry-svg">'+geometrySvg(g)+'</div></figure>';
    }
    function previewGeometriesHtml(){
      if(!state.geometries.length)return "";
      return '<div class="mr-tb-preview-geometries">'+state.geometries.map(g=>geometryHtml(g,{previewMode:true})).join("")+'</div>';
    }
    function contentBlockLabel(key){
      if(key==="text")return {icon:"T",title:"Текст условия",sub:"Основной текст задачи"};
      const [type,id]=key.split(":");
      if(type==="image"){
        const x=imageById(id),i=state.images.indexOf(x);
        return {icon:"▧",title:"Изображение "+(i+1),sub:x?.name||"Картинка"};
      }
      if(type==="table"){
        const x=tableById(id),i=state.tables.indexOf(x);
        return {icon:"⊞",title:"Таблица "+(i+1),sub:(x?.caption||((x?.rows||0)+" × "+(x?.cols||0)))};
      }
      const x=geometryById(id),i=state.geometries.indexOf(x);
      const names={triangle:"Треугольник",rectangle:"Прямоугольник",circle:"Окружность",coordinate:"Координатная плоскость"};
      return {icon:"△",title:"Схема "+(i+1),sub:names[x?.type]||"Геометрия"};
    }
    function renderContentOrder(){
      const host=q("tbContentOrder");if(!host)return;
      const order=syncContentOrder();
      if(order.length<=1){host.innerHTML="";return}
      host.innerHTML='<div class="mr-tb-order-head"><div><b>Порядок блоков в условии</b><small>Зажмите ручку ⠿ и тяните блок вверх или вниз</small></div></div>'+
        '<div class="mr-tb-order-list">'+order.map((key,i)=>{
          const info=contentBlockLabel(key);
          return '<div class="mr-tb-order-item" data-order-key="'+esc(key)+'">'+
            '<button type="button" class="mr-tb-order-grip" data-order-grip="'+esc(key)+'" title="Зажмите и перетащите" aria-label="Перетащить блок">⠿</button><span class="mr-tb-order-icon">'+info.icon+'</span>'+
            '<div><b>'+esc(info.title)+'</b><small>'+esc(info.sub)+'</small></div>'+
            '<div class="mr-tb-order-actions"><button type="button" data-order-up="'+esc(key)+'" '+(i===0?'disabled':'')+' title="Выше">↑</button><button type="button" data-order-down="'+esc(key)+'" '+(i===order.length-1?'disabled':'')+' title="Ниже">↓</button></div>'+
          '</div>';
        }).join("")+'</div>';
      host.querySelectorAll("[data-order-up]").forEach(b=>b.onclick=()=>moveContentBlock(b.dataset.orderUp,-1));
      host.querySelectorAll("[data-order-down]").forEach(b=>b.onclick=()=>moveContentBlock(b.dataset.orderDown,1));

      let pointerDrag=null;
      const clearPointerDrag=()=>{
        pointerDrag?.ghost?.remove();
        pointerDrag?.placeholder?.remove();
        if(pointerDrag?.row)pointerDrag.row.classList.remove("dragging-source");
        document.body.classList.remove("mr-tb-order-dragging");
        pointerDrag=null;
      };
      const placeDropPlaceholder=clientY=>{
        if(!pointerDrag)return;
        const list=host.querySelector(".mr-tb-order-list");
        if(!list)return;
        const rows=[...list.querySelectorAll("[data-order-key]")].filter(row=>row!==pointerDrag.row);
        pointerDrag.placeholder.remove();
        let insertIndex=rows.length;
        for(let i=0;i<rows.length;i++){
          const rect=rows[i].getBoundingClientRect();
          if(clientY<rect.top+rect.height/2){insertIndex=i;break}
        }
        pointerDrag.insertIndex=insertIndex;
        if(insertIndex>=rows.length)list.append(pointerDrag.placeholder);
        else list.insertBefore(pointerDrag.placeholder,rows[insertIndex]);
      };
      const moveDragGhost=(clientX,clientY)=>{
        if(!pointerDrag?.ghost)return;
        pointerDrag.ghost.style.left=(clientX-pointerDrag.offsetX)+"px";
        pointerDrag.ghost.style.top=(clientY-pointerDrag.offsetY)+"px";
      };
      host.querySelectorAll("[data-order-grip]").forEach(grip=>{
        grip.onpointerdown=e=>{
          if(e.button!=null&&e.button!==0)return;
          e.preventDefault();e.stopPropagation();
          const key=grip.dataset.orderGrip||"";
          const row=grip.closest("[data-order-key]");
          if(!key||!row)return;
          syncContentOrder();
          const rect=row.getBoundingClientRect();
          const ghost=row.cloneNode(true);
          ghost.classList.add("mr-tb-order-drag-ghost");
          ghost.removeAttribute("data-order-key");
          ghost.querySelectorAll("button").forEach(b=>{b.disabled=true;b.tabIndex=-1});
          ghost.style.width=rect.width+"px";
          ghost.style.height=rect.height+"px";
          document.body.appendChild(ghost);

          const placeholder=document.createElement("div");
          placeholder.className="mr-tb-order-placeholder";
          placeholder.style.minHeight=rect.height+"px";
          placeholder.innerHTML='<span>↓</span><b>Вставить сюда</b>';

          pointerDrag={
            key,row,ghost,placeholder,
            insertIndex:state.contentOrder.indexOf(key),
            offsetX:e.clientX-rect.left,
            offsetY:e.clientY-rect.top
          };
          row.classList.add("dragging-source");
          document.body.classList.add("mr-tb-order-dragging");
          moveDragGhost(e.clientX,e.clientY);
          placeDropPlaceholder(e.clientY);
          try{grip.setPointerCapture(e.pointerId)}catch{}
        };
        grip.onpointermove=e=>{
          if(!pointerDrag||pointerDrag.key!==grip.dataset.orderGrip)return;
          e.preventDefault();
          moveDragGhost(e.clientX,e.clientY);
          placeDropPlaceholder(e.clientY);
        };
        grip.onpointerup=e=>{
          if(!pointerDrag||pointerDrag.key!==grip.dataset.orderGrip)return;
          e.preventDefault();
          const key=pointerDrag.key,insertIndex=pointerDrag.insertIndex;
          syncContentOrder();
          const from=state.contentOrder.indexOf(key);
          if(from>=0){
            state.contentOrder.splice(from,1);
            const at=Math.max(0,Math.min(insertIndex,state.contentOrder.length));
            state.contentOrder.splice(at,0,key);
          }
          try{grip.releasePointerCapture(e.pointerId)}catch{}
          clearPointerDrag();
          renderContentOrder();preview();
        };
        grip.onpointercancel=e=>{
          try{grip.releasePointerCapture(e.pointerId)}catch{}
          clearPointerDrag();
        };
      });
    }
    function previewConditionHtml(){
      const order=syncContentOrder();
      return order.map(key=>{
        if(key==="text"){ensureTemplateValues();const rendered=renderTemplateString(state.content);return '<div class="mr-tb-preview-problem">'+(rendered.trim()?nl(rendered):'<span class="placeholder">Здесь появится условие задачи.</span>')+'</div>'}
        const [type,id]=key.split(":");
        if(type==="image"){
          const img=imageById(id);if(!img)return "";
          return '<div class="mr-tb-preview-images"><figure class="mr-tb-preview-image" style="width:'+img.displayWidth+'%"><img data-tb-image-src="'+esc(img.id)+'" alt="'+esc(img.alt||img.name||"Изображение к задаче")+'"><figcaption>'+(img.alt?esc(img.alt):"")+'</figcaption></figure></div>';
        }
        if(type==="table"){const table=tableById(id);return table?'<div class="mr-tb-preview-tables">'+tableHtml(table,{previewMode:true})+'</div>':""}
        if(type==="geometry"){const g=geometryById(id);return g?'<div class="mr-tb-preview-geometries">'+geometryHtml(g,{previewMode:true})+'</div>':""}
        return "";
      }).join("");
    }
    function typesetTaskMath(root){
      if(!root||typeof window.renderMathInElement!=="function")return;
      try{
        window.renderMathInElement(root,{delimiters:[
          {left:"\\[",right:"\\]",display:true},
          {left:"\\(",right:"\\)",display:false}
        ],throwOnError:false,strict:"ignore"});
      }catch(e){console.warn("[Mathroom formula render]",e)}
    }
    function preview(){
      const t=topic();
      q("tbPreview").innerHTML='<div class="mr-tb-preview-sheet"><div class="mr-tb-preview-meta"><span>'+diffName(state.difficulty)+'</span><small>'+esc(t?.title||"Тема не выбрана")+' · '+esc(typeName(state.taskType))+'</small></div>'+previewConditionHtml()+'</div>'+studentAnswer();
      hydrateTaskImages(q("tbPreview"));
      typesetTaskMath(q("tbPreview"));
    }
    function nextTemplateName(){
      const used=new Set(state.templateVars.map(v=>v.name));
      for(const n of "abcdefghijklmnopqrstuvwxyz")if(!used.has(n))return n;
      let i=1;while(used.has("v"+i))i++;
      return "v"+i;
    }
    function addTemplateVar(){
      if(state.templateVars.length>=12)return toast("Максимум 12 переменных");
      const name=nextTemplateName(),v={id:templateVarId(),name,min:1,max:10,step:1,multipleOf:0,parity:"any",nonZero:false};
      state.templateVars.push(v);state.templateValues[name]=v.min;
      renderTemplateVars();preview();
    }
    function renderTemplateVars(){
      const host=q("tbTemplateVars");if(!host)return;
      normalizeTemplateVars();ensureTemplateValues();
      if(!state.templateVars.length){host.innerHTML="";return}
      const names=state.templateVars.map(v=>v.name);
      const quick=names.length>=2?'<div class="mr-tb-template-quick"><span>Быстрые условия:</span>'+
        '<button type="button" data-template-condition-preset="mod('+esc(names[0])+','+esc(names[1])+') == 0">'+esc(names[0])+' делится на '+esc(names[1])+'</button>'+
        '<button type="button" data-template-condition-preset="'+esc(names[0])+' > '+esc(names[1])+'">'+esc(names[0])+' &gt; '+esc(names[1])+'</button>'+
        '<button type="button" data-template-condition-preset="'+esc(names[0])+' != '+esc(names[1])+'">'+esc(names[0])+' ≠ '+esc(names[1])+'</button></div>':'';
      host.innerHTML='<section class="mr-tb-template-panel"><div class="mr-tb-template-head"><div><b>Шаблон задачи</b><small>Задайте диапазоны и ограничения — Mathroom подберёт только корректные числа</small></div><div><button type="button" id="tbTemplateReroll">↻ Новый пример</button><button type="button" id="tbTemplateAdd">＋ Переменная</button></div></div>'+
        '<div class="mr-tb-template-example"><span>Текущие значения</span><div>'+state.templateVars.map(v=>'<b>'+esc(v.name)+' = '+esc(formatTemplateValue(state.templateValues[v.name]))+'</b>').join("")+'</div></div>'+
        '<div class="mr-tb-template-list">'+state.templateVars.map(v=>'<article class="mr-tb-template-var" data-template-var="'+esc(v.id)+'">'+
          '<button type="button" class="mr-tb-template-chip" data-template-insert="'+esc(v.name)+'" title="Вставить {{'+esc(v.name)+'}}"><b>{{'+esc(v.name)+'}}</b><small>вставить</small></button>'+
          '<label><span>От</span><input type="number" step="any" data-template-min="'+esc(v.id)+'" value="'+v.min+'"></label>'+
          '<label><span>До</span><input type="number" step="any" data-template-max="'+esc(v.id)+'" value="'+v.max+'"></label>'+
          '<label><span>Шаг</span><input type="number" step="any" min="0.000000001" data-template-step="'+esc(v.id)+'" value="'+v.step+'"></label>'+
          '<label><span>Кратно</span><input type="number" step="any" min="0" data-template-multiple="'+esc(v.id)+'" value="'+(v.multipleOf||"")+'" placeholder="например 10"></label>'+
          '<label><span>Чётность</span><select data-template-parity="'+esc(v.id)+'"><option value="any" '+(v.parity==="any"?"selected":"")+'>Любое</option><option value="even" '+(v.parity==="even"?"selected":"")+'>Чётное</option><option value="odd" '+(v.parity==="odd"?"selected":"")+'>Нечётное</option></select></label>'+
          '<label class="mr-tb-template-check"><input type="checkbox" data-template-nonzero="'+esc(v.id)+'" '+(v.nonZero?"checked":"")+'><span>Не равно 0</span></label>'+
          '<button type="button" class="mr-tb-template-remove" data-template-remove="'+esc(v.id)+'" title="Удалить переменную">×</button>'+
        '</article>').join("")+'</div>'+
        '<div class="mr-tb-template-rules"><div class="mr-tb-template-rule-head"><div><b>Связь между переменными</b><small>Необязательно. Например, для деления без остатка: <code>mod(a,b) == 0</code></small></div></div>'+
          '<input id="tbTemplateCondition" value="'+esc(state.templateCondition)+'" placeholder="Например: mod(a,b) == 0 или a > b">'+quick+
          '<label class="mr-tb-template-integer"><input id="tbTemplateIntegerAnswers" type="checkbox" '+(state.templateIntegerAnswers?"checked":"")+'><div><b>Правильный ответ должен быть целым</b><small>Mathroom отбросит варианты, где выражение ответа даёт дробь.</small></div></label>'+
        '</div>'+
        '<div class="mr-tb-template-hint"><b>Примеры:</b><code>{{a+b}}</code><code>{{a*b}}</code><code>{{a/b}}</code><code>{{a^2}}</code><span>Для точной дроби Mathroom хранит вычисление без плавающей ошибки; 1/3 останется 1/3, а 1/2 станет 0.5.</span></div></section>';
      q("tbTemplateReroll").onclick=()=>{
        try{rerollTemplateValues();renderTemplateVars();preview()}
        catch(e){toast(e.message||"Не удалось подобрать числа")}
      };
      q("tbTemplateAdd").onclick=addTemplateVar;
      q("tbTemplateCondition").oninput=e=>{state.templateCondition=e.target.value};
      q("tbTemplateCondition").onchange=()=>{try{rerollTemplateValues();renderTemplateVars();preview()}catch(e){toast(e.message||"Проверь условие генерации")}};
      q("tbTemplateIntegerAnswers").onchange=e=>{state.templateIntegerAnswers=e.target.checked;try{rerollTemplateValues();renderTemplateVars();preview()}catch(err){toast(err.message||"Не удалось подобрать целый ответ")}};
      host.querySelectorAll("[data-template-condition-preset]").forEach(b=>b.onclick=()=>{state.templateCondition=b.dataset.templateConditionPreset||"";try{rerollTemplateValues();renderTemplateVars();preview()}catch(e){toast(e.message||"Не удалось применить условие")}});
      host.querySelectorAll("[data-template-insert]").forEach(b=>b.onclick=()=>insertInto(q("tbContent"),"{{"+b.dataset.templateInsert+"}}"));
      const varById=id=>state.templateVars.find(v=>String(v.id)===String(id));
      const refresh=()=>{try{rerollTemplateValues();renderTemplateVars();preview()}catch(e){renderTemplateVars();preview();toast(e.message||"Для этих ограничений нет подходящих чисел")}};
      host.querySelectorAll("[data-template-min]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateMin);if(!v)return;v.min=Number(el.value);refresh()});
      host.querySelectorAll("[data-template-max]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateMax);if(!v)return;v.max=Number(el.value);refresh()});
      host.querySelectorAll("[data-template-step]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateStep);if(!v)return;v.step=Math.max(1e-9,Math.abs(Number(el.value)||1));refresh()});
      host.querySelectorAll("[data-template-multiple]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateMultiple);if(!v)return;v.multipleOf=Math.max(0,Math.abs(Number(el.value)||0));refresh()});
      host.querySelectorAll("[data-template-parity]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateParity);if(!v)return;v.parity=el.value;refresh()});
      host.querySelectorAll("[data-template-nonzero]").forEach(el=>el.onchange=()=>{const v=varById(el.dataset.templateNonzero);if(!v)return;v.nonZero=el.checked;refresh()});
      host.querySelectorAll("[data-template-remove]").forEach(b=>b.onclick=()=>{const v=varById(b.dataset.templateRemove);if(!v)return;state.templateVars=state.templateVars.filter(x=>x!==v);delete state.templateValues[v.name];renderTemplateVars();preview()});
    }
    function renderImages(){
      const host=q("tbImages");if(!host)return;
      if(!state.images.length){host.innerHTML="";return}
      host.innerHTML='<div class="mr-tb-images-head"><div><b>Изображения к условию</b><small>'+state.images.length+' шт. · PNG, JPG, WEBP или GIF до 15 МБ</small></div><button type="button" id="tbAddMoreImages">＋ Добавить ещё</button></div>'+
        '<div class="mr-tb-image-list">'+state.images.map(img=>'<article class="mr-tb-image-card" data-tb-image-card="'+esc(img.id)+'">'+
          '<div class="mr-tb-image-thumb"><img data-tb-image-src="'+esc(img.id)+'" alt="'+esc(img.alt||img.name)+'"><span>Не удалось загрузить превью</span></div>'+
          '<div class="mr-tb-image-body"><div class="mr-tb-image-title"><b>'+esc(img.name)+'</b><small>'+img.width+' × '+img.height+' px</small></div>'+
          '<label class="mr-tb-image-alt"><span>Описание <em>(для доступности)</em></span><input data-tb-image-alt="'+esc(img.id)+'" maxlength="180" value="'+esc(img.alt)+'" placeholder="Например: график функции y = x²"></label>'+
          '<label class="mr-tb-image-width"><span>Ширина в задаче</span><div><input data-tb-image-width="'+esc(img.id)+'" type="range" min="30" max="100" step="5" value="'+img.displayWidth+'"><b data-tb-image-width-label="'+esc(img.id)+'">'+img.displayWidth+'%</b></div></label></div>'+
          '<button type="button" class="mr-tb-image-remove" data-tb-image-remove="'+esc(img.id)+'" title="Удалить изображение">×</button>'+
        '</article>').join("")+'</div>';
      q("tbAddMoreImages").onclick=()=>q("tbImageInput").click();
      host.querySelectorAll("[data-tb-image-alt]").forEach(el=>el.oninput=()=>{const img=imageById(el.dataset.tbImageAlt);if(!img)return;img.alt=el.value;preview()});
      host.querySelectorAll("[data-tb-image-width]").forEach(el=>el.oninput=()=>{const img=imageById(el.dataset.tbImageWidth);if(!img)return;img.displayWidth=Number(el.value)||100;const label=host.querySelector('[data-tb-image-width-label="'+CSS.escape(img.id)+'"]');if(label)label.textContent=img.displayWidth+"%";preview()});
      host.querySelectorAll("[data-tb-image-remove]").forEach(el=>el.onclick=async()=>{
        const img=imageById(el.dataset.tbImageRemove);if(!img)return;
        state.images=state.images.filter(x=>x!==img);
        if(pendingImagePaths.has(img.path)){
          pendingImagePaths.delete(img.path);
          try{await sb.storage.from(TASK_IMAGE_BUCKET).remove([img.path])}catch(e){console.warn("[Mathroom task image remove]",e)}
        }
        releaseImageUrl(img.path);
        syncContentOrder();renderImages();renderContentOrder();preview();
      });
      hydrateTaskImages(host);
    }
    function renderTables(){
      const host=q("tbTables");if(!host)return;
      if(!state.tables.length){host.innerHTML="";return}
      host.innerHTML='<div class="mr-tb-tables-head"><div><b>Таблицы к условию</b><small>'+state.tables.length+' шт. · до 12 × 12 ячеек</small></div><button type="button" id="tbAddMoreTables">＋ Добавить таблицу</button></div>'+
        '<div class="mr-tb-table-list">'+state.tables.map((table,index)=>'<article class="mr-tb-table-card" data-tb-table-card="'+esc(table.id)+'">'+
          '<div class="mr-tb-table-card-head"><div><span>Таблица '+(index+1)+'</span><b>'+table.rows+' × '+table.cols+'</b></div><button type="button" class="mr-tb-table-remove" data-tb-table-remove="'+esc(table.id)+'" title="Удалить таблицу">×</button></div>'+
          '<label class="mr-tb-table-caption"><span>Подпись <em>(необязательно)</em></span><input data-tb-table-caption="'+esc(table.id)+'" maxlength="120" value="'+esc(table.caption)+'" placeholder="Например: результаты измерений"></label>'+
          '<div class="mr-tb-table-options"><label><input type="checkbox" data-tb-table-header-row="'+esc(table.id)+'" '+(table.headerRow?'checked':'')+'><span>Верхняя строка — заголовок</span></label><label><input type="checkbox" data-tb-table-header-col="'+esc(table.id)+'" '+(table.headerCol?'checked':'')+'><span>Первый столбец — заголовок</span></label></div>'+
          '<div class="mr-tb-table-editor-scroll"><table class="mr-tb-table-editor">'+table.cells.map((row,r)=>'<tr>'+row.map((cell,c)=>'<td><input data-tb-table-cell="'+esc(table.id)+'" data-row="'+r+'" data-col="'+c+'" value="'+esc(cell)+'" placeholder="'+(r+1)+','+(c+1)+'"></td>').join("")+'</tr>').join("")+'</table></div>'+
          '<div class="mr-tb-table-controls"><div><button type="button" data-tb-table-row-add="'+esc(table.id)+'">＋ Строка</button><button type="button" data-tb-table-row-remove="'+esc(table.id)+'" '+(table.rows<=1?'disabled':'')+'>− Строка</button></div><div><button type="button" data-tb-table-col-add="'+esc(table.id)+'">＋ Столбец</button><button type="button" data-tb-table-col-remove="'+esc(table.id)+'" '+(table.cols<=1?'disabled':'')+'>− Столбец</button></div></div>'+
        '</article>').join("")+'</div>';
      q("tbAddMoreTables").onclick=addTable;
      host.querySelectorAll("[data-tb-table-caption]").forEach(el=>el.oninput=()=>{const t=tableById(el.dataset.tbTableCaption);if(!t)return;t.caption=el.value;renderContentOrder();preview()});
      host.querySelectorAll("[data-tb-table-header-row]").forEach(el=>el.onchange=()=>{const t=tableById(el.dataset.tbTableHeaderRow);if(!t)return;t.headerRow=el.checked;preview()});
      host.querySelectorAll("[data-tb-table-header-col]").forEach(el=>el.onchange=()=>{const t=tableById(el.dataset.tbTableHeaderCol);if(!t)return;t.headerCol=el.checked;preview()});
      host.querySelectorAll("[data-tb-table-cell]").forEach(el=>el.oninput=()=>{const t=tableById(el.dataset.tbTableCell);if(!t)return;const r=Number(el.dataset.row),c=Number(el.dataset.col);if(t.cells[r])t.cells[r][c]=el.value;preview()});
      host.querySelectorAll("[data-tb-table-row-add]").forEach(el=>el.onclick=()=>{const t=tableById(el.dataset.tbTableRowAdd);if(!t||t.rows>=12)return toast("Максимум 12 строк");t.cells.push(Array.from({length:t.cols},()=>''));t.rows++;renderTables();preview()});
      host.querySelectorAll("[data-tb-table-row-remove]").forEach(el=>el.onclick=()=>{const t=tableById(el.dataset.tbTableRowRemove);if(!t||t.rows<=1)return;t.cells.pop();t.rows--;renderTables();preview()});
      host.querySelectorAll("[data-tb-table-col-add]").forEach(el=>el.onclick=()=>{const t=tableById(el.dataset.tbTableColAdd);if(!t||t.cols>=12)return toast("Максимум 12 столбцов");t.cells.forEach(row=>row.push(''));t.cols++;renderTables();preview()});
      host.querySelectorAll("[data-tb-table-col-remove]").forEach(el=>el.onclick=()=>{const t=tableById(el.dataset.tbTableColRemove);if(!t||t.cols<=1)return;t.cells.forEach(row=>row.pop());t.cols--;renderTables();preview()});
      host.querySelectorAll("[data-tb-table-remove]").forEach(el=>el.onclick=()=>{state.tables=state.tables.filter(t=>String(t.id)!==String(el.dataset.tbTableRemove));syncContentOrder();renderTables();renderContentOrder();preview()});
    }
    function addTable(){
      const id=tableId();
      state.tables.push({id,caption:"",rows:3,cols:3,headerRow:true,headerCol:false,cells:Array.from({length:3},()=>Array.from({length:3},()=>""))});
      state.contentOrder.push("table:"+id);syncContentOrder();
      renderTables();renderContentOrder();preview();
      setTimeout(()=>q("tbTables")?.scrollIntoView({behavior:"smooth",block:"nearest"}),0);
    }
    function geometryFields(g){
      if(g.type==="rectangle"){
        return '<div class="mr-tb-geo-grid four">'+g.rectangle.vertices.map((v,i)=>'<label><span>Вершина '+(i+1)+'</span><input data-geo-rect-vertex="'+esc(g.id)+'" data-index="'+i+'" maxlength="8" value="'+esc(v)+'"></label>').join("")+'</div>'+
          '<div class="mr-tb-geo-grid two"><label><span>Подпись ширины</span><input data-geo-rect-width="'+esc(g.id)+'" maxlength="30" value="'+esc(g.rectangle.widthLabel)+'" placeholder="например 8 см"></label><label><span>Подпись высоты</span><input data-geo-rect-height="'+esc(g.id)+'" maxlength="30" value="'+esc(g.rectangle.heightLabel)+'" placeholder="например 5 см"></label></div>';
      }
      if(g.type==="circle"){
        return '<div class="mr-tb-geo-grid two"><label><span>Центр</span><input data-geo-circle-center="'+esc(g.id)+'" maxlength="8" value="'+esc(g.circle.centerLabel)+'"></label><label><span>Радиус</span><input data-geo-circle-radius="'+esc(g.id)+'" maxlength="30" value="'+esc(g.circle.radiusLabel)+'" placeholder="r = 5"></label></div>';
      }
      if(g.type==="coordinate"){
        return '<label class="mr-tb-geo-points"><span>Точки</span><input data-geo-points="'+esc(g.id)+'" value="'+esc(g.coordinate.points)+'" placeholder="A(2;3); B(-1;4)"><small>Формат: A(2;3); B(-1;4)</small></label>'+
          '<div class="mr-tb-geo-grid four"><label><span>x min</span><input type="number" min="-20" max="-1" data-geo-axis="xMin" data-geo-id="'+esc(g.id)+'" value="'+g.coordinate.xMin+'"></label><label><span>x max</span><input type="number" min="1" max="20" data-geo-axis="xMax" data-geo-id="'+esc(g.id)+'" value="'+g.coordinate.xMax+'"></label><label><span>y min</span><input type="number" min="-20" max="-1" data-geo-axis="yMin" data-geo-id="'+esc(g.id)+'" value="'+g.coordinate.yMin+'"></label><label><span>y max</span><input type="number" min="1" max="20" data-geo-axis="yMax" data-geo-id="'+esc(g.id)+'" value="'+g.coordinate.yMax+'"></label></div>';
      }
      return '<div class="mr-tb-geo-grid three">'+g.triangle.vertices.map((v,i)=>'<label><span>Вершина '+(i+1)+'</span><input data-geo-tri-vertex="'+esc(g.id)+'" data-index="'+i+'" maxlength="8" value="'+esc(v)+'"></label>').join("")+'</div>'+
        '<div class="mr-tb-geo-grid three">'+g.triangle.sides.map((v,i)=>'<label><span>Сторона '+(i+1)+'</span><input data-geo-tri-side="'+esc(g.id)+'" data-index="'+i+'" maxlength="30" value="'+esc(v)+'" placeholder="например 5 см"></label>').join("")+'</div>'+
        '<label class="mr-tb-geo-right"><span>Прямой угол</span><select data-geo-tri-right="'+esc(g.id)+'"><option value="" '+(g.triangle.rightAngle===""?'selected':'')+'>Нет</option><option value="0" '+(g.triangle.rightAngle==="0"?'selected':'')+'>В вершине '+esc(g.triangle.vertices[0])+'</option><option value="1" '+(g.triangle.rightAngle==="1"?'selected':'')+'>В вершине '+esc(g.triangle.vertices[1])+'</option><option value="2" '+(g.triangle.rightAngle==="2"?'selected':'')+'>В вершине '+esc(g.triangle.vertices[2])+'</option></select></label>';
    }
    function renderGeometries(){
      const host=q("tbGeometries");if(!host)return;
      if(!state.geometries.length){host.innerHTML="";return}
      host.innerHTML='<div class="mr-tb-geometries-head"><div><b>Геометрические схемы</b><small>'+state.geometries.length+' шт. · векторные SVG</small></div><button type="button" id="tbAddMoreGeometry">＋ Добавить схему</button></div>'+
        '<div class="mr-tb-geometry-list">'+state.geometries.map((g,index)=>'<article class="mr-tb-geometry-card" data-geo-card="'+esc(g.id)+'">'+
          '<div class="mr-tb-geometry-card-head"><div><span>Схема '+(index+1)+'</span><select data-geo-type="'+esc(g.id)+'"><option value="triangle" '+(g.type==="triangle"?'selected':'')+'>Треугольник</option><option value="rectangle" '+(g.type==="rectangle"?'selected':'')+'>Прямоугольник</option><option value="circle" '+(g.type==="circle"?'selected':'')+'>Окружность</option><option value="coordinate" '+(g.type==="coordinate"?'selected':'')+'>Координатная плоскость</option></select></div><button type="button" class="mr-tb-geometry-remove" data-geo-remove="'+esc(g.id)+'">×</button></div>'+
          '<div class="mr-tb-geometry-layout"><div class="mr-tb-geometry-controls">'+
            '<label class="mr-tb-geo-caption"><span>Подпись <em>(необязательно)</em></span><input data-geo-caption="'+esc(g.id)+'" maxlength="120" value="'+esc(g.caption)+'" placeholder="Например: рисунок к задаче"></label>'+
            geometryFields(g)+
            '<label class="mr-tb-geo-width"><span>Размер схемы</span><div><input type="range" min="45" max="100" step="5" data-geo-width="'+esc(g.id)+'" value="'+g.displayWidth+'"><b data-geo-width-label="'+esc(g.id)+'">'+g.displayWidth+'%</b></div></label>'+
          '</div><div class="mr-tb-geometry-live">'+geometryHtml(g)+'</div></div>'+
        '</article>').join("")+'</div>';
      q("tbAddMoreGeometry").onclick=addGeometry;
      host.querySelectorAll("[data-geo-type]").forEach(el=>el.onchange=()=>{const g=geometryById(el.dataset.geoType);if(!g)return;g.type=el.value;renderGeometries();renderContentOrder();preview()});
      host.querySelectorAll("[data-geo-caption]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoCaption);if(!g)return;g.caption=el.value;renderContentOrder();preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-width]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoWidth);if(!g)return;g.displayWidth=Number(el.value)||80;const lab=host.querySelector('[data-geo-width-label="'+CSS.escape(g.id)+'"]');if(lab)lab.textContent=g.displayWidth+"%";preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-tri-vertex]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoTriVertex);if(!g)return;g.triangle.vertices[Number(el.dataset.index)]=el.value;renderGeometries();preview()});
      host.querySelectorAll("[data-geo-tri-side]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoTriSide);if(!g)return;g.triangle.sides[Number(el.dataset.index)]=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-tri-right]").forEach(el=>el.onchange=()=>{const g=geometryById(el.dataset.geoTriRight);if(!g)return;g.triangle.rightAngle=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-rect-vertex]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoRectVertex);if(!g)return;g.rectangle.vertices[Number(el.dataset.index)]=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-rect-width]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoRectWidth);if(!g)return;g.rectangle.widthLabel=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-rect-height]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoRectHeight);if(!g)return;g.rectangle.heightLabel=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-circle-center]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoCircleCenter);if(!g)return;g.circle.centerLabel=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-circle-radius]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoCircleRadius);if(!g)return;g.circle.radiusLabel=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-points]").forEach(el=>el.oninput=()=>{const g=geometryById(el.dataset.geoPoints);if(!g)return;g.coordinate.points=el.value;preview();const card=el.closest("[data-geo-card]");if(card)card.querySelector(".mr-tb-geometry-live").innerHTML=geometryHtml(g)});
      host.querySelectorAll("[data-geo-axis]").forEach(el=>el.onchange=()=>{const g=geometryById(el.dataset.geoId);if(!g)return;const k=el.dataset.geoAxis,v=Number(el.value);if(!Number.isFinite(v))return;g.coordinate[k]=v;if(g.coordinate.xMin>=g.coordinate.xMax)g.coordinate.xMin=g.coordinate.xMax-1;if(g.coordinate.yMin>=g.coordinate.yMax)g.coordinate.yMin=g.coordinate.yMax-1;renderGeometries();preview()});
      host.querySelectorAll("[data-geo-remove]").forEach(el=>el.onclick=()=>{state.geometries=state.geometries.filter(g=>String(g.id)!==String(el.dataset.geoRemove));syncContentOrder();renderGeometries();renderContentOrder();preview()});
    }
    function addGeometry(){
      const id=geometryId();
      state.geometries.push({id,type:"triangle",caption:"",displayWidth:80,triangle:{vertices:["A","B","C"],sides:["","",""],rightAngle:""},rectangle:{vertices:["A","B","C","D"],widthLabel:"",heightLabel:""},circle:{centerLabel:"O",radiusLabel:"r"},coordinate:{points:"A(2;3); B(-1;4)",xMin:-5,xMax:5,yMin:-5,yMax:5}});
      state.contentOrder.push("geometry:"+id);syncContentOrder();
      renderGeometries();renderContentOrder();preview();
      setTimeout(()=>q("tbGeometries")?.scrollIntoView({behavior:"smooth",block:"nearest"}),0);
    }
    async function uploadTaskImages(files){
      const list=[...(files||[])];if(!list.length)return;
      const button=document.querySelector('[data-insert="image"]');
      if(button){button.disabled=true;button.textContent="▧  Загружаем…"}
      try{
        for(const file of list){
          if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)){toast("Поддерживаются PNG, JPG, WEBP и GIF");continue}
          if(file.size>15*1024*1024){toast("Изображение «"+file.name+"» больше 15 МБ");continue}
          const size=await readImageSize(file),id=imageId(),ext=imageExt(file.type);
          const path=S.user.id+"/"+Date.now()+"-"+id+"."+ext;
          const {error}=await sb.storage.from(TASK_IMAGE_BUCKET).upload(path,file,{contentType:file.type,upsert:false,cacheControl:"3600"});
          if(error)throw error;
          pendingImagePaths.add(path);
          imageUrlCache.set(path,URL.createObjectURL(file));
          state.images.push({id,path,name:file.name||("image."+ext),mime:file.type,width:size.width,height:size.height,displayWidth:100,alt:""});
          state.contentOrder.push("image:"+id);syncContentOrder();
          renderImages();renderContentOrder();preview();
        }
      }catch(e){fail(e)}
      finally{
        if(button){button.disabled=false;button.innerHTML="▧&nbsp; Изображение"}
        q("tbImageInput").value="";
      }
    }
    function insertInto(el,text){if(!el)return;const a=el.selectionStart??el.value.length,b=el.selectionEnd??a;el.setRangeText(text,a,b,"end");el.dispatchEvent(new Event("input",{bubbles:true}));el.focus()}
    let formulaModal=null;
    function closeFormulaEditor(){
      formulaModal?.remove();
      formulaModal=null;
    }
    function openFormulaEditor(target){
      if(!target)return;
      closeFormulaEditor();
      const start=target.selectionStart??target.value.length,end=target.selectionEnd??start;
      let selected=String(target.value.slice(start,end)||"").trim();
      const inlineMatch=selected.match(/^\\\((.*)\\\)$/s),displayMatch=selected.match(/^\\\[(.*)\\\]$/s);
      if(inlineMatch)selected=inlineMatch[1].trim();
      if(displayMatch)selected=displayMatch[1].trim();

      const modal=document.createElement("div");
      modal.className="mr-formula-modal";
      modal.innerHTML='<div class="mr-formula-dialog">'+
        '<div class="mr-formula-head"><div><span>∿</span><div><b>Редактор формулы</b><small>Введите формулу или соберите её кнопками</small></div></div><button type="button" data-formula-close aria-label="Закрыть">×</button></div>'+
        '<div class="mr-formula-mode"><button type="button" data-formula-mode="inline" class="'+(displayMatch?"":"active")+'">В строке</button><button type="button" data-formula-mode="display" class="'+(displayMatch?"active":"")+'">Отдельной строкой</button></div>'+
        '<div class="mr-formula-tools">'+
          '<button type="button" data-formula-snippet="\\frac{a}{b}"><span> a⁄b </span><small>Дробь</small></button>'+
          '<button type="button" data-formula-snippet="x^{2}"><span>x²</span><small>Степень</small></button>'+
          '<button type="button" data-formula-snippet="\\sqrt{x}"><span>√x</span><small>Корень</small></button>'+
          '<button type="button" data-formula-snippet="\\sqrt[n]{x}"><span>ⁿ√x</span><small>Корень n</small></button>'+
          '<button type="button" data-formula-snippet="\\left|x\\right|"><span>|x|</span><small>Модуль</small></button>'+
          '<button type="button" data-formula-snippet="\\pi"><span>π</span><small>Пи</small></button>'+
          '<button type="button" data-formula-snippet="\\alpha"><span>α</span><small>Альфа</small></button>'+
          '<button type="button" data-formula-snippet="\\theta"><span>θ</span><small>Тета</small></button>'+
          '<button type="button" data-formula-snippet="\\le"><span>≤</span><small>Меньше</small></button>'+
          '<button type="button" data-formula-snippet="\\ge"><span>≥</span><small>Больше</small></button>'+
          '<button type="button" data-formula-snippet="\\ne"><span>≠</span><small>Не равно</small></button>'+
          '<button type="button" data-formula-snippet="\\pm"><span>±</span><small>Плюс-минус</small></button>'+
          '<button type="button" data-formula-snippet="\\sum_{i=1}^{n}"><span>Σ</span><small>Сумма</small></button>'+
          '<button type="button" data-formula-snippet="\\int_{a}^{b}"><span>∫</span><small>Интеграл</small></button>'+
          '<button type="button" data-formula-snippet="\\to"><span>→</span><small>Стрелка</small></button>'+
          '<button type="button" data-formula-snippet="\\infty"><span>∞</span><small>Бесконечность</small></button>'+
        '</div>'+
        '<label class="mr-formula-input-wrap"><span>Формула</span><textarea id="tbFormulaInput" rows="3" spellcheck="false" placeholder="Например: \\frac{x+1}{2}=5">'+esc(selected)+'</textarea></label>'+
        '<div class="mr-formula-preview-wrap"><span>Предпросмотр</span><div id="tbFormulaPreview" class="mr-formula-preview"></div></div>'+
        '<div class="mr-formula-actions"><button type="button" class="ghost" data-formula-cancel>Отмена</button><button type="button" class="primary" data-formula-insert>Вставить формулу</button></div>'+
      '</div>';
      document.body.appendChild(modal);
      formulaModal=modal;

      const input=modal.querySelector("#tbFormulaInput"),previewEl=modal.querySelector("#tbFormulaPreview");
      let mode=displayMatch?"display":"inline";
      const draw=()=>{
        const latex=input.value.trim();
        if(!latex){previewEl.innerHTML='<span class="mr-formula-empty">Здесь появится формула</span>';return}
        if(window.katex?.render){
          try{window.katex.render(latex,previewEl,{throwOnError:false,displayMode:mode==="display",strict:"ignore"})}
          catch(e){previewEl.textContent=latex}
        }else previewEl.textContent=latex;
      };
      const insertSnippet=snippet=>{
        const a=input.selectionStart??input.value.length,b=input.selectionEnd??a;
        input.setRangeText(snippet,a,b,"end");input.focus();draw();
      };
      modal.querySelectorAll("[data-formula-snippet]").forEach(b=>b.onclick=()=>insertSnippet(b.dataset.formulaSnippet||""));
      modal.querySelectorAll("[data-formula-mode]").forEach(b=>b.onclick=()=>{
        mode=b.dataset.formulaMode||"inline";
        modal.querySelectorAll("[data-formula-mode]").forEach(x=>x.classList.toggle("active",x===b));
        draw();
      });
      modal.querySelector("[data-formula-insert]").onclick=()=>{
        const latex=input.value.trim();if(!latex)return toast("Введите формулу");
        const wrapped=mode==="display"?"\\[\n"+latex+"\n\\]":"\\("+latex+"\\)";
        target.setRangeText(wrapped,start,end,"end");
        target.dispatchEvent(new Event("input",{bubbles:true}));
        closeFormulaEditor();target.focus();
      };
      modal.querySelector("[data-formula-close]").onclick=closeFormulaEditor;
      modal.querySelector("[data-formula-cancel]").onclick=closeFormulaEditor;
      modal.onmousedown=e=>{if(e.target===modal)closeFormulaEditor()};
      input.oninput=draw;
      input.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();modal.querySelector("[data-formula-insert]").click()}};
      draw();setTimeout(()=>{input.focus();input.setSelectionRange(input.value.length,input.value.length)},0);
    }
    function legacyAnswer(){if(["standard","numeric"].includes(state.taskType))return state.answers.map(a=>a.value.trim()).filter(Boolean).join("; ");if(["single","multiple"].includes(state.taskType))return state.options.filter(o=>o.correct&&o.text.trim()).map(o=>o.text.trim()).join(" | ");return state.openAnswer.trim()}
    function collect(){state.grade=Number(q("tbGrade").value)||state.grade;state.topicId=q("tbTopic").value;state.subtopic=q("tbSubtopic").value;state.content=q("tbContent").value;state.settings.shared=!!q("tbShared").checked;state.settings.allowTests=!!q("tbAllowTests").checked;state.settings.allowAi=!!q("tbAllowAi").checked;state.helpSettings.homeworkHints=!!q("tbHomeworkHints")?.checked;state.helpSettings.testHints=!!q("tbTestHints")?.checked;state.helpSettings.solutionMode=q("tbSolutionMode")?.value==="teacher_only"?"teacher_only":"after_attempt";setHelp(q("tbHelp").value);syncAnswer()}
    function builderMeta(){const t=topic();syncContentOrder();normalizeTemplateVars();return {version:9,grade:Number(t?.grade||state.grade)||null,subtopic:state.subtopic.trim(),task_type:state.taskType,answer_check:{numeric_equivalence:!!state.answerCheck.numericEquivalent,tolerance:state.answerCheck.tolerance,ignore_case:!!state.answerCheck.ignoreCase,ignore_spaces:!!state.answerCheck.ignoreSpaces},template_vars:state.templateVars.map(v=>({id:v.id,name:v.name,min:v.min,max:v.max,step:v.step,multiple_of:v.multipleOf||0,parity:v.parity,non_zero:!!v.nonZero})),template_settings:{condition:state.templateCondition.trim(),integer_answers:!!state.templateIntegerAnswers},content_order:state.contentOrder,images:state.images.map(img=>({id:img.id,path:img.path,name:img.name,mime:img.mime,width:img.width,height:img.height,display_width:img.displayWidth,alt:img.alt.trim()})),tables:state.tables.map(table=>({id:table.id,caption:table.caption.trim(),rows:table.rows,cols:table.cols,header_row:!!table.headerRow,header_col:!!table.headerCol,cells:table.cells.map(row=>row.map(cell=>String(cell)))})),geometries:state.geometries.map(g=>({id:g.id,type:g.type,caption:g.caption.trim(),display_width:g.displayWidth,triangle:{vertices:g.triangle.vertices,sides:g.triangle.sides,right_angle:g.triangle.rightAngle},rectangle:{vertices:g.rectangle.vertices,width_label:g.rectangle.widthLabel,height_label:g.rectangle.heightLabel},circle:{center_label:g.circle.centerLabel,radius_label:g.circle.radiusLabel},coordinate:{points:g.coordinate.points,x_min:g.coordinate.xMin,x_max:g.coordinate.xMax,y_min:g.coordinate.yMin,y_max:g.coordinate.yMax}})),answers:state.answers,options:state.options,open_answer:state.openAnswer,solution:state.solution,hints:state.hints,help_settings:{homework_hints:!!state.helpSettings.homeworkHints,test_hints:!!state.helpSettings.testHints,solution_mode:state.helpSettings.solutionMode},source:{kind:state.source.kind,textbook_id:state.source.kind==="textbook"?(state.source.textbookId||null):null,page:state.source.kind==="textbook"?(state.source.page||null):null,exercise_no:state.source.kind==="textbook"?(state.source.exerciseNo||null):null,note:state.source.kind==="textbook"?"":state.source.note.trim()},settings:{shared:!!state.settings.shared,allow_tests:!!state.settings.allowTests,allow_ai_example:!!state.settings.allowAi}}}
    function back(){cleanupPendingImages();releaseLocalImageUrls();const ret=S.taskBuilderReturn||{view:"bank"};S.taskBuilderExerciseId=null;S.taskBuilderReturn=null;if(ret.view==="topics"&&ret.topicId){S.view="topics";S.topic=(S.topics||[]).find(t=>String(t.id)===String(ret.topicId))||null;return S.topic?renderTopic():renderTopics()}S.view="bank";S.topic=null;renderBank()}
    async function syncShared(saved,draft){
      if(draft)return;
      const t=(S.topics||[]).find(x=>String(x.id)===String(saved.topic_id));
      const old=(S.sharedMaterials||[]).find(x=>String(x.source_exercise_id||"")===String(saved.id)&&String(x.published_by||"")===String(S.user?.id||""));
      if(!state.settings.shared){if(old){const {error}=await sb.from("shared_materials").delete().eq("id",old.id);if(error)throw error}return}
      const body={published_by:S.user.id,source_exercise_id:saved.id,kind:"task",title:saved.title||"",content:saved.content||"",answer:saved.answer||"",difficulty:saved.difficulty||"basic",category:saved.category||"",tags:sharedMaterialUserTags(saved.tags),grade:Number(t?.grade)||null,section:t?.section||"",topic_title:t?.title||"",builder_meta:saved.builder_meta&&typeof saved.builder_meta==="object"?saved.builder_meta:{}};
      const res=old?await sb.from("shared_materials").update({...body,updated_at:new Date().toISOString()}).eq("id",old.id):await sb.from("shared_materials").insert(body);
      if(res.error)throw res.error;
    }
    async function save(draft){
      try{
        collect();const t=topic();if(!t)return toast("Выбери тему задачи");if(!draft&&!state.content.trim())return toast("Добавь условие задачи");if(!draft&&!legacyAnswer()&&state.taskType!=="open")return toast("Укажи правильный ответ");if(state.templateVars.length&&!draft){try{generateTemplateScope({tries:1200})}catch(e){return toast(e.message||"Проверь ограничения шаблона")}}
        const sys=editing?exerciseSystemTags(editing.tags):[];const tags=[...new Set([...sys,"класс-"+t.grade,"тема:"+t.title,"тип:"+state.taskType])];
        const body={topic_id:t.id,kind:"task",title:(editing?.title&&editing.title.trim())||("Задача · "+t.title),content:state.content.trim(),answer:legacyAnswer(),difficulty:state.difficulty,category:state.subtopic.trim(),tags,builder_meta:builderMeta(),is_draft:!!draft,updated_at:new Date().toISOString()};
        const res=editing?await sb.from("exercises").update(body).eq("id",editing.id).select().single():await sb.from("exercises").insert({teacher_id:S.user.id,...body}).select().single();
        if(res.error)throw res.error;pendingImagePaths.clear();await syncShared(res.data,draft);await loadTeacher();toast(draft?"Черновик сохранён":editing?"Задача обновлена":"Задача добавлена в банк");back();
      }catch(e){fail(e)}
    }

    syncContentOrder();ensureTemplateValues();fillTopics();renderAnswer();renderSource();renderHelp();renderImages();renderTables();renderGeometries();renderTemplateVars();renderContentOrder();preview();
    q("tbGrade").onchange=e=>{state.grade=Number(e.target.value);fillTopics();state.topicId=q("tbTopic").value;preview()};
    q("tbTopic").onchange=e=>{state.topicId=e.target.value;preview()};
    q("tbSubtopic").oninput=e=>state.subtopic=e.target.value;
    q("tbContent").oninput=e=>{state.content=e.target.value;q("tbContentCount").textContent=e.target.value.length+"/5000";preview()};
    document.querySelectorAll("[data-tb-diff]").forEach(b=>b.onclick=()=>{state.difficulty=b.dataset.tbDiff;document.querySelectorAll("[data-tb-diff]").forEach(x=>x.classList.toggle("active",x===b));preview()});
    const setType=v=>{syncAnswer();state.taskType=v;if(v==="single"&&!state.options.some(o=>o.correct)&&state.options[0])state.options[0].correct=true;document.querySelectorAll("[data-tb-type]").forEach(x=>x.classList.toggle("active",x.dataset.tbType===v));renderAnswer();preview()};
    document.querySelectorAll("[data-tb-type]").forEach(b=>b.onclick=()=>setType(b.dataset.tbType));
    document.querySelectorAll("[data-insert]").forEach(b=>b.onclick=()=>{const k=b.dataset.insert;if(k==="formula")openFormulaEditor(q("tbContent"));else if(k==="list")insertInto(q("tbContent"),"\n• ");else if(k==="template"){if(!state.templateVars.length)addTemplateVar();else q("tbTemplateVars")?.scrollIntoView({behavior:"smooth",block:"nearest"})}else if(k==="image")q("tbImageInput").click();else if(k==="table")addTable();else if(k==="geometry")addGeometry();else q("tbContent").focus()});
    q("tbImageInput").onchange=e=>uploadTaskImages(e.target.files);
    document.querySelectorAll("[data-coming]").forEach(b=>b.onclick=()=>toast(b.dataset.coming+" подключим следующим этапом конструктора"));
    document.querySelectorAll("[data-help]").forEach(b=>b.onclick=()=>{setHelp(q("tbHelp").value);state.help=b.dataset.help;document.querySelectorAll("[data-help]").forEach(x=>x.classList.toggle("active",x===b));renderHelp()});
    q("tbHelp").oninput=e=>{setHelp(e.target.value);q("tbHelpCount").textContent=e.target.value.length+"/5000"};
    document.querySelectorAll("[data-help-insert]").forEach(b=>b.onclick=()=>{if(b.dataset.helpInsert==="formula")openFormulaEditor(q("tbHelp"));else insertInto(q("tbHelp"),"\n• ")});
    document.querySelectorAll("[data-source]").forEach(b=>b.onclick=()=>{state.source.kind=b.dataset.source;document.querySelectorAll("[data-source]").forEach(x=>x.classList.toggle("active",x===b));renderSource()});
    q("tbShared").onchange=e=>state.settings.shared=e.target.checked;q("tbAllowTests").onchange=e=>state.settings.allowTests=e.target.checked;q("tbAllowAi").onchange=e=>state.settings.allowAi=e.target.checked;
    document.querySelectorAll("[data-info]").forEach(b=>b.onclick=()=>toast(b.dataset.info));
    q("tbExit").onclick=back;q("tbDraft").onclick=()=>save(true);q("tbSave").onclick=()=>save(false);
  }};
  window.MathroomTaskBuilderV60=API;
})();