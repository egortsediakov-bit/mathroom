/* Mathroom v100 regression: trusted XLSX data is previewed and imported ONLY as drafts.
 * Run: node tests/v100-xlsx-import.cjs
 * No production writes or requests. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),window={};
new Function('window',fs.readFileSync(path.join(root,'js/xlsx-import-core-v100.js'),'utf8'))(window);
const document={readyState:'loading',addEventListener(){}};
new Function('window','document','MutationObserver','console','confirm',
  fs.readFileSync(path.join(root,'js/task-bank-xlsx-import-v100.js'),'utf8'))
  (window,document,undefined,console,()=>true);
const api=window.MathroomXlsxV100,ui=window.MathroomTaskXlsxImport;
assert.ok(api&&ui);
const formatted=api.formatMath('Вычислите: 2 1/6 − 5/9.');
assert.equal(formatted,'Вычислите: \\(2\\frac{1}{6} - \\frac{5}{9}\\).');
assert.equal(api.formatMath('Решите уравнение: (x − 2)/3 + (x + 1)/2 = 7.'),
  'Решите уравнение: \\(\\frac{x - 2}{3} + \\frac{x + 1}{2} = 7\\).');
assert.equal(api.formatMath('https://school.ru/2026/2027'),'https://school.ru/2026/2027');
const ready=[
 {task_id:'K6-008',grade:6,topic:'Сложение и вычитание дробей',
  task_text:'Вычислите: 2 1/6 − 5/9.',answer:'29/18',difficulty:'medium',
  solution:'2 1/6 − 5/9 = 13/6 − 5/9 = 39/18 − 10/18 = 29/18.',
  review_status:'AUTO_CHECKED / проверить преподавателю',section:'Обыкновенные дроби'},
 {task_id:'K6-039',grade:6,topic:'Линейные уравнения с одной переменной',
  task_text:'Решите уравнение: (x − 2)/3 + (x + 1)/2 = 7.',
  answer:'43/5',difficulty:'advanced',solution:'5x=43. x=43/5.'}
];
const templates=[
 {template_id:'TG6-02','Подтема':'Сложение и вычитание дробей',
  'Шаблон условия':'Вычислите p/d + q/d','Переменные / диапазоны':'p,q=1..9; d>0',
  'Пример задачи':'Вычислите: 2/12 + 3/12.','Ответ примера':'5/12',
  'Решение примера':'(2+3)/12=5/12'},
 {template_id:'TG6-hard',grade:6,topic:'Дроби',
  template_text:'Вычислите: {{a}}+{{b}}.',
  variables_json:JSON.stringify([{name:'a',min:2,max:12,step:1},{name:'b',min:1,max:9,step:1}]),
  answer_template:'{{a+b}}',
  template_solution:'Сложим два числа.'}
];
const content=api.readSheetRows(ready,[],templates);
assert.equal(content.tasks.length,2);
assert.equal(content.templates.length,2);
const legacy=content.templates[0],machine=content.templates[1];
assert.equal(legacy.generatorReady,false,'descriptive source cannot masquerade as executable generator');
assert.equal(machine.generatorReady,true);
assert.equal(machine.templateVars.length,2);
assert.equal(legacy.answer,'5/12');
const plan=ui.prepare(content,[]);
assert.equal(plan.length,4);
assert.equal(plan.filter(x=>x.selected).length,2,'legacy and machine templates are opt-in');
assert.equal(plan.every(x=>x.valid),true,'all four drafts can be imported');
const dupPlan=ui.prepare(content,[{generator_spec:JSON.stringify({task_id:'K6-008'}),
  content:ready[0].task_text,tags:['mathroom-xlsx-57-school-v1']}]);
assert.equal(dupPlan[0].selected,false,'repeated source ID must be skipped');
const uid='teacher-test';
const storage={exercises:[],topics:[]};
const sb={from(table){
  if(!Object.prototype.hasOwnProperty.call(storage,table))throw Error('unexpected table '+table);
  return{
    select(fields){return {
      eq(column,value){assert.equal(column,'teacher_id');assert.equal(value,uid);
        return {order(){return {range:async(start,end)=>({
          data:storage[table].slice(start,end+1),error:null
        })}}}
      }
    }},
    insert(records){return {select:async()=>{
      const rows=(Array.isArray(records)?records:[records]).map((x,i)=>({
        id:table+'-'+(storage[table].length+i),...x
      }));
      storage[table].push(...rows);
      return {data:rows,error:null};
    }}}
  };
}};
window.MR={S:{user:{id:uid}},sb};
const state={data:content,items:plan};
(async()=>{
 const first=await ui.importItems(state,()=>{});
 assert.equal(first.added,2);
 assert.equal(storage.exercises.length,2);
 for(const e of storage.exercises){
   assert.equal(e.is_draft,true);
   assert.equal(e.builder_meta.settings.shared,false);
   assert.equal(e.builder_meta.settings.allow_tests,false);
   assert.equal(e.builder_meta.xlsx_import.requires_teacher_review,true);
   assert.ok(e.builder_meta.solution);
 }
 assert.equal(storage.exercises[0].builder_meta.solution,
   api.formatMath(ready[0].solution),'solution and math must survive import');
 assert.equal(storage.exercises[0].answer,'29/18','grading answer remains a plain fraction');
 const second=await ui.importItems(state,()=>{});
 assert.equal(second.added,0);
 assert.equal(second.skipped,2);
 assert.equal(storage.exercises.length,2,'repeat upload must be idempotent');
 const extended=ui.prepare(content,storage.exercises);
 extended.filter(x=>x.r.type==='template').forEach(x=>x.selected=true);
 const other=await ui.importItems({items:extended},()=>{});
 assert.equal(other.added,2);
 assert.equal(storage.exercises.length,4);
 const draft=storage.exercises.find(x=>x.builder_meta.xlsx_import.source_id==='TG6-02');
 assert.ok(draft);
 assert.equal(draft.is_draft,true);
 assert.equal(draft.builder_meta.template_vars.length,0);
 assert.equal(draft.builder_meta.xlsx_import.generator_ready,false);
 assert.ok(draft.builder_meta.xlsx_import.template_review.template.includes('p/d'));
 const gen=storage.exercises.find(x=>x.builder_meta.xlsx_import.source_id==='TG6-hard');
 assert.equal(gen.is_draft,true);
 assert.equal(gen.builder_meta.template_vars.length,2);
 assert.equal(gen.answer,'{{a+b}}');
 const builder=fs.readFileSync(path.join(root,'js/task-builder-v60.js'),'utf8');
 assert.ok(builder.includes('xlsx_import:meta.xlsx_import'));
 assert.ok(builder.includes('editing?.builder_meta?.xlsx_import'));
 console.log('v100 PASS: TeX fractions, equations, solutions, safe drafts, idempotency and template review');
})().catch(e=>{console.error(e);process.exitCode=1});
