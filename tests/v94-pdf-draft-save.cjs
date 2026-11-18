/* Mathroom v94 — tests the partial-save blocker and safe retries.
 * Run: node tests/v94-pdf-draft-save.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const scripts=['js/pdf-draft-save-v94.js','js/pdf-layout-v93.js',
  'js/pdf-topics-v93.js','js/pdf-quality-v92.js','js/pdf-import-v91.js'];
const log={log(){},warn(){},error(){}};
function harness({rights=true,failFirst=false}={}){
  const win={};
  const sandbox={window:win,console:log,confirm:()=>true,
    URL:{revokeObjectURL(){}}};
  for(const script of scripts)new vm.Script(fs.readFileSync(path.join(root,script),'utf8'),
    {filename:script}).runInNewContext(sandbox);
  const sentence=(s,x,y)=>({str:s,width:160,transform:[1,0,0,1,x,y]});
  const items=[
    sentence('1',58,646),sentence('Решите уравнение 2x + 5 = 9.',101,655),
    sentence('2',58,528),sentence('Вычислите значение выражения на рисунке.',101,537)
  ];
  win.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
    numPages:1,getPage:async()=>({getTextContent:async()=>({items}),cleanup(){}}),
    destroy:async()=>{}
  })})};
  win.MathroomBankAllExercisesV2982={hydrate:async()=>{}};
  const S={user:{id:'teacher-1'},topics:[{
    id:'linear',grade:7,section:'Алгебра',
    title:'Линейное уравнение с одной переменной'
  }],exercises:[]};
  const fields={
    '#pdfTaskFile':{files:[{name:'fixture.pdf',size:120,type:'application/pdf',
      arrayBuffer:async()=>new Uint8Array(100).buffer}]},
    '#pdfTaskGrade':{value:''},'#pdfTaskTopic':{value:'',innerHTML:''},
    '#pdfTaskFrom':{value:1},'#pdfTaskTo':{value:1},
    '#pdfTaskDifficulty':{value:'medium'},
    '#pdfTaskRights':{checked:rights,focus(){this.focused=true}},
    '#pdfReviewGoBank':{},'#pdfReviewRemoveBad':{},'#pdfTaskSummary':{},
    '#pdfTaskExtract':{},'#pdfTaskSave':{disabled:false},
    '#pdfTaskSaveHint':{textContent:''},
    '#pdfTaskAddVisual':{},'#pdfTaskAll':{},'#pdfTaskNone':{},
    '#pdfTaskStatus':{textContent:''},
    '#pdfTaskResults':{innerHTML:'',querySelectorAll:()=>[]}
  };
  const modal={removed:false,querySelector:sel=>fields[sel],remove(){this.removed=true}};
  const reviewModal={removed:false,querySelector:sel=>fields[sel],remove(){this.removed=true}};
  let reviewOpened=false;
  const inserted=[],errors=[],messages=[];
  let reject=failFirst;
  const sb={from(table){
    assert.equal(table,'exercises');
    return {insert(row){return {select(){return{single:async()=>{
      if(reject){reject=false;return {error:{message:'RLS denied test'}}}
      inserted.push(row);return{data:{id:'id'+inserted.length},error:null};
    }}}}}};
  }};
  win.MathroomPdfImportV91.open({
    S,sb,modal:html=>{
      if(html.includes('mr-pdf-review')){reviewOpened=true;return reviewModal}
      return modal;
    },toast:x=>messages.push(x),
    fail:e=>errors.push(e),loadTeacher:async()=>{},openBank:()=>{}
  });
  return {win,fields,modal,reviewModal,reviewOpened:()=>reviewOpened,inserted,errors,messages};
}
(async()=>{
  const sample=[
    {number:'1',page:1,selected:true,topicId:'linear',grade:7,content:'Решите уравнение 2x + 5 = 9.'},
    {number:'2',page:1,selected:true,topicId:null,grade:null,content:'Вычислите выражение по рисунку.'}
  ];
  const planner=harness().win.MathroomPdfDraftsV94;
  const plan=planner.plan(sample,[{id:'linear',grade:7}],[]);
  assert.equal(plan.ready.length,1);
  assert.equal(plan.pending.length,1);
  assert.equal(plan.duplicates.length,0);

  const h=harness();
  await h.fields['#pdfTaskExtract'].onclick();
  assert.match(h.fields['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 1/);
  assert.equal(h.fields['#pdfTaskSave'].disabled,false);
  await h.fields['#pdfTaskSave'].onclick();
  assert.equal(h.inserted.length,1);
  assert.equal(h.inserted[0].is_draft,true);
  assert.equal(h.inserted[0].topic_id,'linear');
  assert.equal(h.modal.removed,true);
  assert.equal(h.reviewOpened(),true);
  assert.equal(h.reviewModal.removed,false);
  assert.match(h.fields['#pdfTaskSaveHint'].textContent,/Требуют внимания: №2/);
  assert.equal(h.fields['#pdfTaskSave'].disabled,true);

  const noRights=harness({rights:false});
  await noRights.fields['#pdfTaskExtract'].onclick();
  await noRights.fields['#pdfTaskSave'].onclick();
  assert.equal(noRights.inserted.length,0);
  assert.equal(noRights.fields['#pdfTaskRights'].focused,true);
  assert.match(noRights.fields['#pdfTaskStatus'].textContent,/галочку/);

  const retry=harness({failFirst:true});
  await retry.fields['#pdfTaskExtract'].onclick();
  await retry.fields['#pdfTaskSave'].onclick();
  assert.equal(retry.inserted.length,0);
  assert.equal(retry.errors.length,1);
  assert.match(retry.fields['#pdfTaskStatus'].textContent,/RLS denied test/);
  await retry.fields['#pdfTaskSave'].onclick();
  assert.equal(retry.inserted.length,1);
  await retry.fields['#pdfTaskSave'].onclick();
  assert.equal(retry.inserted.length,1);
  console.log('v94 PASS: partial save, unclassified tasks, rights prompt, retry without duplicates');
})().catch(e=>{console.error(e);process.exitCode=1});
