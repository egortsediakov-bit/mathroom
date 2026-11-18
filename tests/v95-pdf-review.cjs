/* v95 test — node tests/v95-pdf-review.cjs
   Browser modal, PDF.js and Supabase are mocked; no live data is changed. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const window={};
const confirmCalls=[];
const context={window,console,confirm:msg=>(confirmCalls.push(msg),true),
  URL:{revokeObjectURL(){}}};
for(const file of [
  'js/pdf-draft-save-v94.js',
  'js/pdf-layout-v93.js',
  'js/pdf-topics-v93.js',
  'js/pdf-import-v91.js'
]){
  const script=new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
  script.runInNewContext(context);
}
window.MathroomBankAllExercisesV2982={hydrate:async()=>{}};
const line=(str,x,y)=>({str,width:160,transform:[1,0,0,1,x,y]});
window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({
  numPages:1,getPage:async()=>({getTextContent:async()=>({items:[
    line('1',58,646),line('Решите уравнение 2x + 5 = 9.',101,655),
    line('2',58,528),line('По рисунку найдите площадь закрашенной фигуры.',101,537),
    line('3',58,410),line('Найдите среднее арифметическое чисел 7 и 11.',101,419)
  ]}),cleanup(){}}),
  destroy:async()=>{}
})})};
const pdf={name:'original.pdf',size:512,type:'application/pdf',
  arrayBuffer:async()=>new Uint8Array(40).buffer};
const modals=[];
function modal(html){
  const review=html.includes('mr-pdf-review');
  const v=review?{
    '#pdfTaskRights':{checked:true},'#pdfTaskSaveHint':{},'#pdfTaskSave':{},'#pdfTaskStatus':{},
    '#pdfTaskSummary':{},'#pdfTaskAll':{},'#pdfTaskNone':{},
    '#pdfReviewGoBank':{},'#pdfReviewRemoveBad':{}
  }:{
    '#pdfTaskFile':{files:[pdf]},'#pdfTaskGrade':{value:''},'#pdfTaskTopic':{value:''},
    '#pdfTaskDifficulty':{value:'medium'},'#pdfTaskFrom':{value:1},'#pdfTaskTo':{value:1},
    '#pdfTaskRights':{checked:true},'#pdfTaskSaveHint':{},'#pdfTaskSave':{},
    '#pdfTaskStatus':{},'#pdfTaskSummary':{},'#pdfTaskExtract':{},
    '#pdfTaskAll':{},'#pdfTaskNone':{},'#pdfTaskAddVisual':{}
  };
  const instance={html,review,values:v,removed:false,nodes:{},
    remove(){this.removed=true},
    querySelector(sel){assert.ok(v[sel],'Missing modal control '+sel);return v[sel]}
  };
  let cards='';
  v['#pdfTaskResults']={
    get innerHTML(){return cards},
    set innerHTML(html){cards=html;instance.nodes={}},
    querySelectorAll(selector){
      const attr=selector.slice(1,-1),regex=new RegExp(attr+'="(\\d+)"','g');
      const suffix=attr.slice('data-pdf-'.length);
      const datasetKey='pdf'+suffix.replace(/(^|-)([a-z])/g,(_,dash,c)=>c.toUpperCase());
      return [...cards.matchAll(regex)].map(m=>{
        const element={dataset:{[datasetKey]:m[1]},value:''};
        instance.nodes[attr+m[1]]=element;
        return element;
      });
    }
  };
  modals.push(instance);return instance;
}
const S={user:{id:'teacher'},exercises:[],topics:[
  {id:'linear',grade:7,title:'Линейное уравнение с одной переменной',section:'Алгебра'},
  {id:'mean',grade:6,title:'Среднее арифметическое',section:'Статистика'}
]};
const rows=[];
const sb={from(table){
  assert.equal(table,'exercises');
  return {insert:row=>({select:()=>({single:async()=>{
    rows.push(row);return {data:{id:'item'+rows.length},error:null};
  }})})};
}};
(async()=>{
  const errors=[];let bankOpened=0;
  window.MathroomPdfImportV91.open({
    S,sb,modal,toast(){},fail:e=>errors.push(e),
    loadTeacher:async()=>{},openBank:()=>bankOpened++
  });
  assert.equal(modals.length,1);
  assert.ok(modals[0].html.includes('mr-pdf-header'));
  await modals[0].values['#pdfTaskExtract'].onclick();
  assert.match(modals[0].values['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 2/);
  assert.match(modals[0].values['#pdfTaskResults'].innerHTML,/Удалить из импорта/);
  await modals[0].values['#pdfTaskSave'].onclick();
  assert.equal(errors.length,0);
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.topic_id),['linear','mean']);
  assert.ok(rows.every(x=>x.is_draft));
  assert.equal(modals.length,2,'A separate follow-up modal must open');
  assert.ok(modals[0].removed);
  const second=modals[1];
  assert.equal(second.review,true);
  assert.ok(second.html.includes('Разобрать оставшиеся задачи'));
  assert.match(second.values['#pdfTaskResults'].innerHTML,/Задача № 2/);
  assert.doesNotMatch(second.values['#pdfTaskResults'].innerHTML,/Задача № 1/);
  assert.doesNotMatch(second.values['#pdfTaskResults'].innerHTML,/Задача № 3/);
  const del=Object.entries(second.nodes)
    .find(([k])=>k.startsWith('data-pdf-discard'))?.[1];
  assert.ok(typeof del?.onclick==='function','Remove-from-import handler must exist');
  del.onclick();
  assert.doesNotMatch(second.values['#pdfTaskResults'].innerHTML,/Задача № 2/);
  assert.equal(rows.length,2,'Removing remaining task must not touch saved drafts');
  assert.ok(confirmCalls.some(s=>s.includes('из текущего импорта')));
  assert.equal(bankOpened,0,'Review window stays open for explicit navigation');

  // Second run: teacher fixes the previously unrecognized topic in the
  // follow-up window, saves it and arrives back in the private bank.
  window.MathroomPdfImportV91.open({
    S,sb,modal,toast(){},fail:e=>errors.push(e),
    loadTeacher:async()=>{},openBank:()=>bankOpened++
  });
  const again=modals[2];
  await again.values['#pdfTaskExtract'].onclick();
  await again.values['#pdfTaskSave'].onclick();
  const unresolved=modals[3];
  assert.equal(unresolved.review,true);
  const grade=unresolved.nodes['data-pdf-grade1'];
  assert.ok(grade,'grade selector exists in follow-up modal');
  grade.value='7';grade.onchange();
  const topic=unresolved.nodes['data-pdf-topic1'];
  assert.ok(topic,'topic selector exists after grade change');
  topic.value='linear';topic.onchange();
  assert.match(unresolved.values['#pdfTaskSaveHint'].textContent,/Готово к сохранению: 1/);
  await unresolved.values['#pdfTaskSave'].onclick();
  assert.equal(rows.length,5);
  assert.equal(rows[4].topic_id,'linear');
  assert.equal(unresolved.removed,true,'Review modal closes when all tasks saved');
  assert.equal(bankOpened,1,'Bank opened after last saved task');

  console.log('v95 PDF UI PASS: two windows, safe removal, correction and repeat save');
})().catch(e=>{console.error(e);process.exitCode=1});
