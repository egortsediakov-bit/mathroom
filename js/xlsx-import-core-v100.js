/* Mathroom v100 — safe, no-network XLSX normalization, math display and draft mapping.
 * Intentionally pure: no DOM, Supabase, eval or automatic publication. */
(function(){
  'use strict';
  const API={VERSION:'100.0',IMPORT_TAG:'mathroom-xlsx-draft-v100',OLD_TAG:'mathroom-xlsx-57-school-v1'};
  const str=x=>String(x??'').trim();
  const text=x=>String(x??'').replace(/\r\n?/g,'\n').trim();
  const get=(row,...keys)=>{
    for(const k of keys){
      if(Object.prototype.hasOwnProperty.call(row||{},k)&&str(row[k])!=='')return row[k];
    }
    return '';
  };
  const number=(x,otherwise=null)=>{const v=str(x);if(!v)return otherwise;const n=Number(v.replace(',','.'));return Number.isFinite(n)?n:otherwise};
  const safeInt=(x,fallback=0)=>Math.round(number(x,fallback));
  const difficulty=(raw,score)=>{
    const v=str(raw).toLowerCase();
    if(['basic','easy','базовый','базовая','легкая','лёгкая'].includes(v))return 'basic';
    if(['medium','средний','средняя'].includes(v))return 'medium';
    if(['advanced','hard','сложный','сложная','повышенный'].includes(v))return 'advanced';
    const n=number(score,5);return n<=3?'basic':n<=7?'medium':'advanced';
  };
  const mathTeX=expression=>{
    let s=text(expression).replace(/[−–—]/g,'-').replace(/×/g,'\\times ')
      .replace(/[·⋅]/g,'\\cdot ').replace(/÷/g,'\\div ')
      .replace(/²/g,'^{2}').replace(/³/g,'^{3}');
    s=s.replace(/√\(([^()]*)\)/g,(_,part)=>'\\sqrt{'+part+'}')
      .replace(/√(\d{1,6})/g,(_,part)=>'\\sqrt{'+part+'}')
      .replace(/sqrt\(([^()]*)\)/gi,(_,part)=>'\\sqrt{'+part+'}');
    // Parenthesized numerators occur in linear equations: (x-2)/3.
    s=s.replace(/\(([^()]{1,55})\)\s*\/\s*(\d{1,5})(?!\d)/g,
      (_,num,den)=>'\\frac{'+num+'}{'+den+'}');
    // Mixed fractions must be recognized before ordinary fractions.
    s=s.replace(/(^|[^\w\d])(\d{1,5})\s+(\d{1,5})\s*\/\s*(\d{1,5})(?!\d)/g,
      (_,prefix,whole,num,den)=>prefix+whole+'\\frac{'+num+'}{'+den+'}');
    s=s.replace(/(^|[^\w\\])([a-zA-Z]|\d{1,6})\s*\/\s*(\d{1,6})(?!\d)/g,
      (_,prefix,num,den)=>prefix+'\\frac{'+num+'}{'+den+'}');
    // Typical arithmetic power syntax is transformed only in mathematical segments.
    s=s.replace(/([A-Za-z0-9)]+)\s*\^\s*(-?\d{1,2})/g,'$1^{$2}');
    return s;
  };
  API.formatMath=value=>{
    const s=text(value);if(!s)return '';
    if(/\\\(|\\\[|\$\$|\\frac\{/.test(s))return s; // already authored TeX
    const byLine=s.split('\n').map(line=>{
      // Only a strictly arithmetic tail after ':' gets a single math block.
      // This preserves Russian prose and avoids reinterpreting slashes in dates/URLs.
      const match=line.match(/^(.+?:\s*)([0-9a-zA-Z()\s,:+\-−–—*×÷·⋅/^=²³√]+)([.!?]?)$/u);
      if(match&&/[\/^=²³√]/.test(match[2])&&!/https?:|www\./i.test(line)){
        return match[1]+'\\('+mathTeX(match[2].trim())+'\\)'+match[3];
      }
      // Standalone expressions (for example a line from a worked solution).
      const bare=line.match(/^([0-9a-zA-Z()\s,:+\-−–—*×÷·⋅/^=²³√]+)([.!?]?)$/u);
      if(bare&&/[\/^=²³√]/.test(bare[1])&&!/https?:|www\./i.test(line))
        return '\\('+mathTeX(bare[1].trim())+'\\)'+bare[2];
      // Fallback: replace only standalone fractions; all other prose stays intact.
      return line.replace(/(^|[^\w\\])(\d{1,5}\s+)?(\d{1,5}|[a-zA-Z])\s*\/\s*(\d{1,5})(?!\d)/g,
        (_,prefix,whole,num,den)=>{
          const original=(whole||'')+num+'/'+den;
          // Bare years and date-like values are not mathematical fractions.
          if(Number(num)>999||Number(den)>999)return prefix+original;
          return prefix+'\\('+(whole?str(whole):'')+'\\frac{'+num+'}{'+den+'}\\)';
        });
    });
    return byLine.join('\n');
  };
  // Preserve generator expressions while formatting literal fractions.
  // Converting e.g. {{n/2}} into KaTeX would break live parameter generation.
  API.formatTemplateText=value=>text(value).split(/(\{\{[^{}]+\}\})/g).map(part=>{
    if(part.startsWith('{{')&&part.endsWith('}}'))return part;
    const lead=part.match(/^\s*/)?.[0]||'',tail=part.match(/\s*$/)?.[0]||'';
    const middle=part.slice(lead.length,part.length-tail.length);
    return lead+API.formatMath(middle)+tail;
  }).join('');
  API.fingerprint=s=>str(s).normalize('NFC').toLocaleLowerCase('ru')
    .replace(/\\\(|\\\)/g,'').replace(/\\frac\{(\d+)\}\{(\d+)\}/g,'$1/$2')
    .replace(/[«»"'’]/g,'').replace(/\s+/g,' ').trim();
  // Excel supports either one multiline "hints" cell or three ordered hint columns.
  // Explicit columns win; blank lines in a multiline cell separate progressive hints.
  API.readHints=(row,backup)=>{
    const pick=(...keys)=>text(get(row,...keys)||get(backup,...keys));
    const numbered=[1,2,3].map(n=>pick('hint_'+n,'hint'+n,'Подсказка '+n,'Подсказка'+n));
    const chosen=numbered.some(Boolean)?numbered.filter(Boolean):
      (pick('hints','Подсказки')?pick('hints','Подсказки').split(/\n\s*\n/):[]);
    return chosen.map(API.formatMath).filter(Boolean).slice(0,3);
  };
  API.readTask=(row,solutionRow)=>{
    const id=str(get(row,'task_id','Task ID','id'));
    const grade=safeInt(get(row,'grade','Класс','класс'),0);
    const topic=str(get(row,'topic','Тема','тема'));
    const raw=text(get(row,'task_text','Задание','Условие','condition','body_text'));
    const rawSolution=text(get(row,'solution','Решение','Пошаговое решение')||
      get(solutionRow,'solution','Пошаговое решение','Решение'));
    return {
      type:'task',id,grade,topic,section:str(get(row,'section','Раздел'))||('Математика '+grade+' класс'),
      original:raw,content:API.formatMath(raw),
      answer:text(get(row,'answer','Ответ','ответ')),
      solution:API.formatMath(rawSolution),
      hints:API.readHints(row,solutionRow),
      difficulty:difficulty(get(row,'difficulty','Сложность'),get(row,'difficulty_score','Сложность 1-10')),
      score:number(get(row,'difficulty_score','Сложность 1-10'),5),
      status:str(get(row,'review_status','Статус проверки'))||'REVIEW',
      source:str(get(row,'source','Источник')),
      sourceFile:str(get(row,'source_file','Файл')),sourceUrl:str(get(row,'source_url','URL')),
      license:str(get(row,'license','Лицензия')),
      page:safeInt(get(row,'pdf_page','Страница PDF'),0),
      exerciseNo:str(get(row,'exercise_no','Номер задания')),
      confidence:number(get(row,'confidence','Уверенность'),0),
      note:text(get(row,'verification_note','Комментарий проверки')),
      subtopicCode:str(get(row,'micro_code','Код подтемы')),
      taskType:str(get(row,'task_type','Тип задания'))||'exercise',
      rawRow:row
    };
  };
  API.readTemplate=(row)=>{
    const machine=str(get(row,'template_text','template_condition','Условие генератора'));
    const vars=str(get(row,'variables_json','template_vars_json'));
    const rawId=str(get(row,'template_id','ID шаблона','id'));
    const topic=str(get(row,'topic','Подтема','Тема'));
    const grade=safeInt(get(row,'grade','Класс'),6);
    const example=text(get(row,'Пример задачи','example_task','example_text'));
    const exampleAnswer=text(get(row,'Ответ примера','example_answer'));
    const originalTemplate=text(get(row,'Шаблон условия','template','template_text'));
    const rawAnswer=text(get(row,'answer_template','answer_expression','Формула ответа'));
    const originalSolution=text(get(row,'Решение примера','solution','template_solution'));
    const candidate={
      type:'template',id:rawId,grade,topic,section:str(get(row,'section','Раздел'))||'Шаблоны Котоматики',
      original:example||originalTemplate,
      content:API.formatMath(example||originalTemplate),
      answer:exampleAnswer,solution:API.formatMath(originalSolution),
      hints:API.readHints(row),
      difficulty:difficulty(get(row,'difficulty','Сложность'),get(row,'difficulty_score','Сложность 1-10')),
      note:text(get(row,'Ограничения / проверки','verification_note')),
      source:str(get(row,'source','Источник')),sourceUrl:str(get(row,'source_url','URL')),
      templateSource:{
        template:originalTemplate,
        variables:text(get(row,'Переменные / диапазоны','variables')),
        formula:rawAnswer,exampleParameters:str(get(row,'Пример параметров')),
        restrictions:text(get(row,'Ограничения / проверки'))
      },
      templateVars:[],templateSettings:{condition:'',integer_answers:false},
      imageDataUri:str(get(row,'image_data_uri','diagram_data_uri')),
      generatorReady:false
    };
    if(machine&&vars){
      let parsed;
      try{parsed=JSON.parse(vars)}catch{return {...candidate,warning:'Некорректный JSON параметров генератора'};}
      if(!Array.isArray(parsed)||!parsed.length||parsed.length>12)
        return {...candidate,warning:'Нужен список из 1–12 переменных'};
      const normalized=[],seen=new Set();
      for(const item of parsed){
        const name=str(item?.name),min=number(item?.min),max=number(item?.max);
        const step=number(item?.step,1);
        if(!/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(name)||seen.has(name)||
          !Number.isFinite(min)||!Number.isFinite(max)||min>max||
          !Number.isFinite(step)||step<=0||(max-min)/step>10000)
          return {...candidate,warning:'Проверь имя, диапазон и шаг каждой переменной'};
        seen.add(name);
        normalized.push({id:'var-'+name,name,min,max,step,
          multiple_of:Math.max(0,number(item.multiple_of,0)),
          parity:['even','odd'].includes(item.parity)?item.parity:'any',
          non_zero:!!item.non_zero});
      }
      const expression=str(get(row,'answer_template','answer_expression'));
      const condition=str(get(row,'template_condition_filter','constraint_expression'));
      if(!expression||!/\{\{[^}]+\}\}/.test(expression)||
         !/\{\{[^}]+\}\}/.test(machine))
        return {...candidate,warning:'Нужны {{выражения}} и в условии, и в ответе'};
      const checks=[...machine.matchAll(/\{\{([^{}]+)\}\}/g),
        ...expression.matchAll(/\{\{([^{}]+)\}\}/g)];
      if(checks.some(match=>!/^[a-zA-Z0-9_+\-*/(). %]+$/.test(match[1])||
        /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(match[1])||
        /[A-Za-z_]\w*\s*\.\s*[A-Za-z_]/.test(match[1]))||
        (condition&&(!/^[a-zA-Z0-9_+\-*/(). %<>=!&|]+$/.test(condition)||
          /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(condition))))
        return {...candidate,warning:'Недопустимое выражение параметризованного шаблона'};
      candidate.content=API.formatTemplateText(machine);candidate.original=machine;candidate.answer=expression;
      candidate.templateVars=normalized;
      candidate.templateSettings={condition,integer_answers:String(get(row,'integer_answers')).toLowerCase()==='true'};
      candidate.generatorReady=true;
      candidate.solution=API.formatTemplateText(text(get(row,'template_solution','solution'))||originalSolution);
    }
    return candidate;
  };
  API.validate=r=>{
    const failures=[];
    if(!r.id)failures.push('нет task_id/template_id');
    if(!(r.grade>=1&&r.grade<=11))failures.push('класс вне диапазона 1–11');
    if(!r.topic)failures.push('нет темы');
    if(!r.content)failures.push('нет условия');
    if(r.type==='template'&&!r.generatorReady&&r.warning)failures.push(r.warning);
    if(r.imageDataUri&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(r.imageDataUri))
      failures.push('Неподдерживаемое изображение: требуется PNG base64');
    if(r.imageDataUri&&r.imageDataUri.length>=300000)
      failures.push('Изображение слишком большое для импорта');
    return failures;
  };
  API.toExercise=(uid,topic,row)=>{
    const template=row.type==='template';
    const note=[row.note,row.templateSource?.restrictions].filter(Boolean).join('\n');
    // XLSX cell pictures are not exposed by SheetJS; a deliberately restricted
    // embedded PNG column is supported for portable diagrams.
    const embeddedImage=String(row.imageDataUri||'').trim();
    const safeImage=/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(embeddedImage)
      && embeddedImage.length<300000;
    const meta={
      version:10,grade:row.grade,task_type:'standard',
      text_blocks:[{id:'main',text:row.content}],
      content_order:['text:main'],
      template_vars:template?(row.templateVars||[]):[],
      template_settings:template?(row.templateSettings||{condition:'',integer_answers:false}):{condition:'',integer_answers:false},
      images:safeImage?[{id:'xlsx-diagram',data_uri:embeddedImage,alt:'Авторская схема к задаче',display_width:75}]:[],
      tables:[],geometries:[],
      content_order:safeImage?['text:main','image:xlsx-diagram']:['text:main'],
      answers:[{label:'Ответ',value:row.answer||'',accepted:[]}],
      solution:row.solution||'',hints:row.hints||[],
      source:{kind:'manual',note:['XLSX '+row.id,row.sourceFile,row.sourceUrl].filter(Boolean).join(' · ')},
      settings:{shared:false,allow_tests:false,allow_ai_example:false},
      xlsx_import:{
        version:API.VERSION,source_id:row.id,
        original_condition:row.original,
        verification_status:row.status||'REVIEW',difficulty_score:row.score??null,
        verification_note:note,confidence:row.confidence??null,
        source:row.source||null,source_url:row.sourceUrl||null,
        source_file:row.sourceFile||null,license:row.license||null,
        pdf_page:row.page||null,exercise_no:row.exerciseNo||null,
        template_review:template&&!row.generatorReady?(row.templateSource||{}):null,
        generator_ready:template&&row.generatorReady,
        requires_teacher_review:true
      }
    };
    return {
      teacher_id:uid,topic_id:topic.id,kind:'task',
      title:(template?'Шаблон · ':row.exerciseNo?'№ '+row.exerciseNo+' · ':'Задача · ')+topic.title,
      content:row.content,answer:row.answer||'',
      difficulty:row.difficulty||'medium',category:topic.title,
      tags:[API.IMPORT_TAG,'класс-'+row.grade,'тема:'+topic.title].concat(template?['mathroom-xlsx-template-v100']:[]),
      generator_spec:JSON.stringify({type:'xlsx_import_v100',task_id:row.id,template:template}),
      generator_answer:'',favorite:false,is_draft:true,
      builder_meta:meta
    };
  };
  API.readSheetRows=(ready=[],solution=[],templates=[])=>{
    const solutionMap=new Map((solution||[]).map(r=>[str(get(r,'task_id','id')),r]));
    const tasks=(ready||[]).filter(r=>Object.keys(r||{}).length)
      .map(r=>API.readTask(r,solutionMap.get(str(get(r,'task_id','id')))));
    const gens=(templates||[]).filter(r=>Object.keys(r||{}).length).map(API.readTemplate);
    return {tasks,templates:gens,all:[...tasks,...gens]};
  };
  window.MathroomXlsxV100=API;
})();
