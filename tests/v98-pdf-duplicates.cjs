/* Mathroom v98 duplicate-review regressions. Run:
 * node tests/v98-pdf-duplicates.cjs
 * Uses in-memory PDF.js / Supabase mocks; no live writes.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const window={},confirmations=[];
const sandbox={window,console,confirm:msg=>(confirmations.push(msg),true),
  URL:{revokeObjectURL(){}}};
for(const file of [
  'js/pdf-draft-save-v94.js','js/pdf-layout-v93.js',
  'js/pdf-topics-v93.js','js/pdf-quality-v92.js','js/pdf-import-v91.js'
]){
  new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file})
    .runInNewContext(sandbox);
}
const planner=window.MathroomPdfDraftsV94;
const content='Решите уравнение 2x + 5 = 9.';
const topics=[{id:'linear',grade:7,title:'Линейное уравнение с одной переменной'},
  {id:'mean',grade:6,title:'Среднее арифметическое'}];
const original={id:'old-task',kind:'task',topic_id:'linear',title:'Ранее сохранённая задача',
  content,is_draft:true};
const first={number:'1',page:1,content,selected:true,topicId:'linear',grade:7};
const second={number:'2',page:2,content,selected:true,topicId:'linear',grade:7};
const normal=planner.plan([first,second],topics,[original]);
assert.equal(normal.ready.length,0,'previously saved duplicates blocked by default');
assert.equal(normal.duplicates.length,2);
assert.equal(normal.duplicates[0].match.kind,'bank');
assert.equal(normal.duplicates[0].match.id,'old-task');
const nonempty=planner.plan([first,second],topics,[]);
assert.equal(nonempty.ready.length,1);
assert.equal(nonempty.duplicates.length,1,'later occurrence in the same PDF flagged');
assert.equal(nonempty.duplicates[0].match.kind,'batch');
assert.equal(nonempty.duplicates[0].match.title,'Задача № 1 · страница 1');
const manual={...first,allowDuplicate:true};
const copy=planner.plan([manual],topics,[original]);
assert.equal(copy.ready.length,1);
assert.equal(copy.duplicates.length,0);
assert.equal(copy.ready[0].duplicateOverride,true);
assert.equal(copy.ready[0].match.id,'old-task');
const imagePlaceholder='Условие представлено на прикреплённом изображении PDF. Требуется проверка преподавателем.';
const scan=planner.plan([
  {number:'скан-1',page:2,visualOnly:true,capture:{blob:{}},selected:true,topicId:'linear',grade:7,content:imagePlaceholder},
  {number:'скан-2',page:3,visualOnly:true,capture:{blob:{}},selected:true,topicId:'linear',grade:7,content:imagePlaceholder}
],topics,[{id:'visual',content:imagePlaceholder}]);
assert.equal(scan.ready.length,2,'different scanned figures must not be flagged solely on placeholder text');
const deleted=planner.plan([first],topics,[{...original,kind:'deleted'}]);
assert.equal(deleted.ready.length,1,'seed records marked as deleted do not block reimports');

const line=(str,x,y)=>({str,width:160,transform:[1,0,0,1,x,y]});
window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
 numPages:1,getPage:async()=>({getTextContent:async()=>({items:[
   line('1',58,646),line(content,101,655),
   line('2',58,528),line('Найдите среднее арифметическое чисел 7 и 11.',101,537)
 ]}),cleanup(){}}),destroy:async()=>{}
})})};
let fullBankLoads=0;
window.MathroomBankAllExercisesV2982={hydrate:async()=>{fullBankLoads++}};
const pdf={name:'existing.pdf',size:400,type:'application/pdf',arrayBuffer:async()=>new Uint8Array(32).buffer};
const screens=[];
function modal(html){
  const fields={
   '#pdfTaskFile':{files:[pdf]},'#pdfTaskGrade':{value:''},'#pdfTaskTopic':{value:''},
   '#pdfTaskDifficulty':{value:'medium'},'#pdfTaskFrom':{value:1},'#pdfTaskTo':{value:1},
   '#pdfTaskRights':{checked:true,focus(){}},
   '#pdfTaskExtract':{},'#pdfTaskSave':{},'#pdfTaskSaveHint':{},'#pdfTaskStatus':{},
   '#pdfTaskSummary':{},'#pdfTaskAll':{},'#pdfTaskNone':{},'#pdfTaskAddVisual':{}
  };
  let cardHtml='';
  const screen={html,fields,nodes:{},closed:false,remove(){this.closed=true},
    querySelector(key){assert.ok(fields[key],'Missing '+key);return fields[key]}};
  fields['#pdfTaskResults']={
    get innerHTML(){return cardHtml},
    set innerHTML(v){cardHtml=v;screen.nodes={}},
    querySelectorAll(selector){
      const attr=selector.slice(1,-1);
      const pattern=new RegExp(attr+'="(\\d+)"','g');
      const suffix=attr.slice('data-pdf-'.length),
        dataName='pdf'+suffix.replace(/(^|-)([a-z])/g,(_,dash,c)=>c.toUpperCase());
      return [...cardHtml.matchAll(pattern)].map(match=>{
        const el={dataset:{[dataName]:match[1]},value:''};
        screen.nodes[attr+match[1]]=el;
        return el;
      });
    }
  };
  screens.push(screen);return screen;
}
const S={user:{id:'teacher1'},exercises:[original],topics};
const saved=[];
const sb={from:table=>{
  assert.equal(table,'exercises');
  return {insert:body=>({select:()=>({single:async()=>{
    saved.push(body);return {data:{id:'created'+saved.length},error:null};
  }})})};
}};
(async()=>{
  let openBankCount=0;const errors=[];
  window.MathroomPdfImportV91.open({
    S,sb,modal,toast(){},fail:e=>errors.push(e),
    loadTeacher:async()=>{},openBank:()=>openBankCount++
  });
  const panel=screens[0];
  await panel.fields['#pdfTaskExtract'].onclick();
  assert.match(panel.fields['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 1/);
  assert.match(panel.fields['#pdfTaskResults'].innerHTML,/Показать совпавшую задачу/);
  assert.match(panel.fields['#pdfTaskResults'].innerHTML,/Ранее сохранённая задача/);
  const toggle=()=>panel.nodes['data-pdf-override0'];
  assert.ok(toggle()&&typeof toggle().onclick==='function');
  toggle().onclick();
  assert.match(panel.fields['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 2/);
  assert.match(panel.fields['#pdfTaskResults'].innerHTML,/Сохранение отдельной копии разрешено/);
  toggle().onclick();
  assert.match(panel.fields['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 1/);
  toggle().onclick();
  await panel.fields['#pdfTaskSave'].onclick();
  assert.equal(errors.length,0);
  assert.equal(saved.length,2);
  assert.ok(saved.every(x=>x.is_draft));
  const duplicateCopy=saved.find(x=>x.content===content);
  assert.ok(duplicateCopy);
  assert.equal(duplicateCopy.builder_meta.pdf_import.duplicate_review.override,true);
  assert.equal(duplicateCopy.builder_meta.pdf_import.duplicate_review.match_source,'bank');
  assert.equal(duplicateCopy.builder_meta.pdf_import.duplicate_review.matched_exercise_id,'old-task');
  assert.ok(confirmations.some(x=>x.includes('Создать ОТДЕЛЬНЫЙ личный черновик')));
  assert.ok(confirmations.some(x=>x.includes('намеренно повторяющихся задач: 1')));
  assert.equal(S.exercises[0].id,'old-task','existing task unchanged');
  assert.equal(openBankCount,1);
  assert.ok(fullBankLoads>=2,'full bank hydrated on extract and after saving');
  console.log('v98 PASS: exact matches, own PDF duplicates, visual scans, opt-in copy, provenance and save');
})().catch(e=>{console.error(e);process.exitCode=1});
