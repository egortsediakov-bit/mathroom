/* Run: node tests/v93-import-save.cjs — mock PDF.js, no live Supabase writes */
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const w={},context={window:w,console,confirm:()=>true};
for(const file of ['js/pdf-layout-v93.js','js/pdf-topics-v93.js','js/pdf-draft-save-v94.js','js/pdf-import-v91.js']){
  new vm.Script(fs.readFileSync(path.resolve(__dirname,'..',file),'utf8')).runInNewContext(context);
}
const it=(str,x,y)=>({str,width:140,transform:[1,0,0,1,x,y]});
const pages=[
  [it('1',58,646),it('Решите уравнение: 3(2x − 1) = 4x + 9.',101,655),it('2',58,528),it('Упростите выражение:',101,537),it('(2a − 3)² − (a − 1)(a + 1).',101,517)],
  [it('5',58,495),it('По таблице найдите среднее арифметическое',101,504),it('всех значений y.',101,484)]
];
w.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
  numPages:2,getPage:async n=>({getTextContent:async()=>({items:pages[n-1]}),cleanup(){}}),
  destroy:async()=>{}
})})};
w.MathroomBankAllExercisesV2982={hydrate:async()=>{}};
const S={user:{id:'test-user'},exercises:[],topics:[
 {id:'equations',grade:7,title:'Линейное уравнение с одной переменной',section:'Алгебра'},
 {id:'identities',grade:7,title:'Формулы сокращённого умножения',section:'Алгебра'},
 {id:'mean',grade:6,title:'Среднее арифметическое',section:'Статистика'}
]};
const fields={
 '#pdfTaskFile':{files:[{name:'test.pdf',type:'application/pdf',size:100,arrayBuffer:async()=>new Uint8Array(10).buffer}]},
 '#pdfTaskGrade':{value:''},'#pdfTaskTopic':{value:'',innerHTML:''},
 '#pdfTaskFrom':{value:1},'#pdfTaskTo':{value:2},'#pdfTaskDifficulty':{value:'medium'},
 '#pdfTaskRights':{checked:true},'#pdfTaskExtract':{},'#pdfTaskSave':{},
 '#pdfTaskAddVisual':{},'#pdfTaskAll':{},'#pdfTaskNone':{},'#pdfTaskStatus':{textContent:''},
 '#pdfTaskSaveHint':{},'#pdfTaskSummary':{},
 '#pdfTaskResults':{innerHTML:'',querySelectorAll:()=>[]}
};
const saved=[];
const sb={from:table=>{
  assert.equal(table,'exercises');
  return {insert:row=>{saved.push(row);return {select:()=>({single:async()=>({data:{id:'created'},error:null})})}}};
}};
let errors=[];
w.MathroomPdfImportV91.open({
  S,sb,modal:()=>({querySelector:sel=>fields[sel],remove(){}}),
  toast:()=>{},fail:e=>errors.push(e),loadTeacher:async()=>{},openBank:()=>{}
});
(async()=>{
  await fields['#pdfTaskExtract'].onclick();
  assert.ok(fields['#pdfTaskResults'].innerHTML.includes('Линейное уравнение'));
  await fields['#pdfTaskSave'].onclick();
  assert.equal(errors.length,0);
  assert.deepEqual(saved.map(x=>x.topic_id),['equations','identities','mean']);
  assert.deepEqual(saved.map(x=>x.builder_meta.grade),[7,7,6]);
  assert.ok(saved.every(x=>x.is_draft===true));
  console.log('v93 mock integration PASS: independent topic ID and grade per draft');
})().catch(e=>{console.error(e);process.exitCode=1});
