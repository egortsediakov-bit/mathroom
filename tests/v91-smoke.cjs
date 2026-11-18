const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = {window:{},console};
for (const file of ['js/pdf-import-v91.js','js/error-diagnostics-v91.js','js/adaptive-v90.js']) {
  const source = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  vm.runInNewContext(source,sandbox,{filename:file});
}
const pdf=sandbox.window.MathroomPdfImportV91;
const diagnostic=sandbox.window.MathroomErrorDiagnosticsV91;
const adaptive=sandbox.window.MathroomAdaptiveV90;
const copy=x=>JSON.parse(JSON.stringify(x));

function smokeParser() {
  const got=copy(pdf.splitPage([
    'Тестовая проверочная','1. Найдите сумму 3 и 7.','2. Решите уравнение x + 4 = 11.',
    'Ответ поясните.','3. Что','4. Найдите произведение 8 и 6.'
  ],9));
  assert.equal(got.length,3);
  assert.equal(got[0].number,'1');
  assert.equal(got[1].page,9);
  assert.equal(got[1].content,'Решите уравнение x + 4 = 11.\nОтвет поясните.');
  assert.ok(!got.some(t=>t.content.includes('Тестовая проверочная')));
  const lines=copy(pdf.linesFromItems([
    {str:'5.',transform:[1,0,0,1,10,100],width:10},
    {str:'Найдите корень.',transform:[1,0,0,1,35,100],width:90},
    {str:'6. Решите пример.',transform:[1,0,0,1,10,80],width:130}
  ]));
  assert.equal(lines.length,2);
  assert.equal(copy(pdf.splitPage(lines,4)).length,2);
}
function smokeDiagnostic(){
  const observed=copy(diagnostic.analyze(
    [{id:'a',status:'reviewed',topic_id:'t1'},{id:'b',status:'assigned',topic_id:'t2'}],
    [{homework_id:'a',is_correct:false,source_exercise_id:'e1',tags:['skill:дроби']},
     {homework_id:'a',is_correct:true,source_exercise_id:'e1',tags:['skill:дроби']},
     {homework_id:'b',is_correct:false,source_exercise_id:'e2'}],
    new Map([['e1',{topic_id:'t1'}],['e2',{topic_id:'t2'}]])
  ));
  assert.equal(observed.length,1);
  assert.equal(observed[0].mastery,50);
  assert.equal(observed[0].skill_errors[0].errors,1);
}
async function smokeAdaptive(){
  const S={user:{id:'teach'},students:[{id:'st',grade:7}],homeworks:[
    {id:'hw',teacher_id:'teach',student_id:'st',status:'reviewed',topic_id:'t1'}
  ],topics:[
    {id:'t1',grade:7,title:'Дроби'}, {id:'t2',grade:7,title:'Геометрия'}
  ],exercises:[
    {id:'e1',topic_id:'t1',kind:'task',is_draft:false,answer:'7'},
    {id:'e2',topic_id:'t2',kind:'task',is_draft:false,answer:'10'}
  ]};
  const sb={from(name){
    const q={select(){return this},eq(){return this},order(){return this},in(){return this},
      not(){return this},limit:async function(){
        if(name==='homework_items') return {data:[
          {homework_id:'hw',is_correct:false,source_exercise_id:'e1',tags:['skill:смешанные дроби']},
          {homework_id:'hw',is_correct:false,source_exercise_id:'e1',tags:['skill:смешанные дроби']}
        ]};
        return {data:[{topic_snapshot:[{topic_id:'t1',mastery:80,evidence_count:3},
          {topic_id:'t2',mastery:95,evidence_count:3}],created_at:'2026-11-18'}]};
      }};
    return q;
  }};
  const rec=copy(await adaptive.recommend({S,sb},'st',10));
  assert.equal(rec.rows.length,2);
  assert.equal(rec.rows[0].row.topic.id,'t1');
  assert.equal(rec.rows[0].row.mastery,0);
  assert.equal(rec.rows[0].row.skill_errors[0].name,'смешанные дроби');
  assert.equal(rec.rows.reduce((n,x)=>n+x.count,0),10);
}
(async()=>{
 smokeParser(); smokeDiagnostic(); await smokeAdaptive();
 console.log('Mathroom v91 smoke: PDF parser, checked error aggregation, adaptive quota — PASS');
})().catch(err=>{console.error(err);process.exitCode=1});
