/* Run: node tests/v99-math-check.cjs
   Pure arithmetic checks + fake PDF UI, no network and no production writes. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),
  vm=require('node:vm');
const root=path.resolve(__dirname,'..'),window={};
const created=[];
const doc={
 createElement(tag){const el={tagName:tag,textContent:'',children:[],append(){this.children.push(...arguments)}};created.push(el);return el}
};
const context={window,document:doc,console,confirm:()=>true,URL:{revokeObjectURL(){}}};
for(const file of ['js/math-check-v99.js','js/pdf-draft-save-v94.js',
  'js/pdf-layout-v93.js','js/pdf-topics-v93.js','js/pdf-import-v91.js']){
 new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file}).runInNewContext(context);
}
const checker=window.MathroomMathCheckV99.check;
const test=(content,answer,status,expected)=>{
  const result=checker({content,answer});
  assert.equal(result.status,status,content);
  if(expected!==undefined)assert.equal(result.expected,expected,content);
  return result;
};
test('Решите уравнение: 3(2x − 1) = 4x + 9.','6','match','6');
test('Решите уравнение: 3(2x − 1) = 4x + 9.','5','mismatch','6');
test('Решите уравнение: 3(2x − 1) = 4x + 9.','','missing','6');
test('Решите уравнение: x/2 + 3 = 6.','6','match','6');
test('Решите уравнение: 2x + 5 = 1.','-2','match','-2');
test('Вычислите значение выражения 7 + 3*(8 − 5).','16','match','16');
test('Вычислите значение выражения -2².','-4','match','-4');
test('Найдите значение выражения 1/2 + 0,25.','0,75','match','0,75');
test('Найдите значение выражения 100000000 + 0,1.','100000000','mismatch','100000000,1');
test('Вычислите значение выражения 5/0.','0','unsupported');
test('Вычислите значение выражения 2^999.','0','unsupported');
test('Решите уравнение: x² = 4.','2','unsupported');
test('Решите уравнение: x=x.','0','unsupported');
test('Решите уравнение: 2x = 2x+1.','0','unsupported');
test('Решите уравнение: x*x=4.','2','unsupported');
test('Найдите площадь квадрата со стороной 4.','16','unsupported');
test('По рисунку найдите значение выражения 1+2.','3','unsupported');
test('Вычислите значение выражения 2+3.','1;4','unsupported');
test('Вычислите значение выражения eval(2+3).','5','unsupported');
assert.equal(checker({content:'Решите уравнение: x + 2 = 3.',answer:'1',
  hasVisual:true}).status,'unsupported','any attached geometry disables unsupported verification');
assert.ok(fs.readFileSync(path.join(root,'js/task-builder-v60.js'),'utf8')
  .includes('"Ответ не совпадает с расчётом"'),
  'Task Builder must reject a supported mismatched answer before publication');

window.MathroomBankAllExercisesV2982={hydrate:async()=>{}};
const lines=[{str:'1',width:10,transform:[1,0,0,1,58,646]},
 {str:'Решите уравнение: 3(2x − 1) = 4x + 9.',width:250,transform:[1,0,0,1,101,655]}];
window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
 numPages:1,getPage:async()=>({getTextContent:async()=>({items:lines}),cleanup(){}}),
 destroy:async()=>{}
})})};
const fields={
 '#pdfTaskFile':{files:[{name:'math-check.pdf',size:100,type:'application/pdf',
   arrayBuffer:async()=>new Uint8Array(8).buffer}]},
 '#pdfTaskGrade':{value:''},'#pdfTaskTopic':{value:''},
 '#pdfTaskDifficulty':{value:'medium'},'#pdfTaskFrom':{value:1},'#pdfTaskTo':{value:1},
 '#pdfTaskRights':{checked:true},
 '#pdfTaskSave':{},'#pdfTaskSaveHint':{},'#pdfTaskStatus':{},'#pdfTaskSummary':{},
 '#pdfTaskExtract':{},'#pdfTaskAll':{},'#pdfTaskNone':{},'#pdfTaskAddVisual':{}
};
let cardHtml='',nodes={},mathNode={
 dataset:{status:'missing'},children:[],
 replaceChildren(){this.children=[]},
 append(){this.children.push(...arguments)}
};
fields['#pdfTaskResults']={
 get innerHTML(){return cardHtml},
 set innerHTML(html){cardHtml=html;nodes={}},
 querySelector(selector){if(selector==='[data-pdf-math="0"]')return mathNode;return null},
 querySelectorAll(selector){
  const key=selector.slice(1,-1),regex=new RegExp(key+'="(\\d+)"','g');
  const suffix=key.slice('data-pdf-'.length),
    dataKey='pdf'+suffix.replace(/(^|-)([a-z])/g,(_,s,c)=>c.toUpperCase());
  return [...cardHtml.matchAll(regex)].map(hit=>{
    const el={dataset:{[dataKey]:hit[1]},value:''};
    nodes[key+hit[1]]=el;return el;
  });
 }};
const S={user:{id:'teacher'},topics:[{id:'linear',grade:7,
  title:'Линейное уравнение с одной переменной',section:'Алгебра'}],exercises:[]};
const written=[];
const sb={from:table=>{
 assert.equal(table,'exercises');
 return {insert:body=>({select:()=>({single:async()=>{
   written.push(body);return{data:{id:'id'+written.length},error:null}
 }})})};
}};
let errors=[];
const modal={
 querySelector:selector=>fields[selector],
 remove(){this.removed=true}
};
(async()=>{
 window.MathroomPdfImportV91.open({S,sb,modal:()=>modal,toast(){},
  fail:e=>errors.push(e),loadTeacher:async()=>{},openBank:()=>{}});
 await fields['#pdfTaskExtract'].onclick();
 assert.match(cardHtml,/Расчёт выполнен, ответа пока нет/);
 const input=nodes['data-pdf-answer0'];
 assert.ok(input&&typeof input.oninput==='function');
 input.value='5';input.oninput();
 assert.equal(mathNode.dataset.status,'mismatch');
 assert.ok(mathNode.children[1].textContent.includes('даёт 6'));
 input.value='6';input.oninput();
 assert.equal(mathNode.dataset.status,'match');
 await fields['#pdfTaskSave'].onclick();
 assert.equal(errors.length,0);
 assert.equal(written.length,1);
 assert.equal(written[0].is_draft,true);
 assert.equal(written[0].builder_meta.pdf_import.math_check.status,'match');
 assert.equal(written[0].builder_meta.pdf_import.math_check.expected,'6');
 console.log('v99 PASS: strict arithmetic/linear solver, live PDF answer feedback, draft audit');
})().catch(e=>{console.error(e);process.exitCode=1});
