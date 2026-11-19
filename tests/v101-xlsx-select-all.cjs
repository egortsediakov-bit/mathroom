/* Run: node tests/v101-xlsx-select-all.cjs
 * 67-row workbook and 66-of-67 duplicate scenario, mocked browser only. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/task-bank-xlsx-import-v100.js'),'utf8');
const core=fs.readFileSync(path.join(root,'js/xlsx-import-core-v100.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css/xlsx-import-v100.css'),'utf8');
assert.match(source,/class="mr-xlsx-solution-show">Показать решение/);
assert.match(source,/class="mr-xlsx-solution-hide">Скрыть решение/);
assert.match(css,/\.mr-xlsx-solution\[open\] \.mr-xlsx-solution-show\s*\{\s*display:none/);
assert.match(css,/\.mr-xlsx-solution\[open\] \.mr-xlsx-solution-hide\s*\{\s*display:inline/);
const window={};
new Function('window',core)(window);
const api=window.MathroomXlsxV100;
const ready=Array.from({length:56},(_,i)=>({
 task_id:'K6-'+String(i+1).padStart(3,'0'),grade:6,
 topic:'Тема '+(i+1),task_text:'Вычислите: '+(i+1)+' + 1.',
 answer:String(i+2),solution:'Сумма равна '+(i+2)+'.'
}));
const templates=Array.from({length:8},(_,i)=>({
 template_id:'TG6-0'+(i+1),'Подтема':'Тема шаблона '+(i+1),
 'Пример задачи':'Вычислите: '+(i+1)+'/12 + 1/12.',
 'Ответ примера':String((i+2))+'/12'
}));
const generators=Array.from({length:3},(_,i)=>({
 template_id:'TG6-H0'+(i+1),grade:6,topic:'Генератор '+(i+1),
 template_text:'Вычислите: {{a}} + '+(i+1)+'.',
 variables_json:'[{"name":"a","min":1,"max":8,"step":1}]',
 answer_template:'{{a+'+(i+1)+'}}'
}));
const data=api.readSheetRows(ready,[],[...templates,...generators]);
assert.equal(data.tasks.length,56);
assert.equal(data.templates.length,11);
assert.equal(data.all.length,67);
const fakeDoc={readyState:'loading',addEventListener(){}};
new Function('window','document','MutationObserver',source)(window,fakeDoc,undefined);
const UI=window.MathroomTaskXlsxImport;
const initial=UI.prepare(data,[]);
assert.equal(initial.length,67);
assert.equal(initial.filter(x=>x.valid).length,67);
assert.equal(initial.filter(x=>x.selected).length,56);
const existing=[{generator_spec:JSON.stringify({task_id:'TG6-H03'}),content:'not a duplicate'}];
const withOne=UI.prepare(data,existing);
assert.equal(withOne.filter(x=>x.valid).length,66);
assert.deepEqual(withOne.filter(x=>!x.valid).map(x=>x.r.id),['TG6-H03']);
assert.match(withOne.find(x=>!x.valid).reason,/уже импортирован/);

// Minimal DOM test: opening a workbook and clicking "all tasks and templates".
const elements={};
const makeEl=()=>({dataset:{},checked:false,textContent:'',disabled:false,onclick:null,onchange:null,
  click(){this.clicked=true},classList:{toggle(){}}});
const input=makeEl(),choose=makeEl(),boxEl=makeEl();
let html='';
const preview={
 get innerHTML(){return html},
 set innerHTML(x){html=x;this.controls={};this.choices=[];
   for(const tag of html.matchAll(/data-xlsx-choice="(\d+)"/g)){
     this.choices.push({dataset:{xlsxChoice:tag[1]},checked:html.includes('data-xlsx-choice="'+tag[1]+'" checked'),
       onchange:null,closest(){return{classList:{toggle(){}}}}});
   }
 },
 controls:{},choices:[],
 querySelector(sel){return this.controls[sel]||(this.controls[sel]=makeEl())},
 querySelectorAll(sel){return sel==='[data-xlsx-choice]'?this.choices:[]}
};
const status=makeEl();
const container={innerHTML:'',querySelector(sel){
 if(sel==='#mrXlsxChooseV100')return choose;
 if(sel==='#mrXlsxFileV100')return input;
 return null
}};
const bankList={parentNode:{insertBefore(){elements.mrXlsxImportV100=container}}};
const doc={
 readyState:'loading',addEventListener(){},
 getElementById(id){if(id==='bankList')return bankList;if(id==='mrXlsxImportV100')return elements.mrXlsxImportV100||null;if(id==='mrXlsxPreview')return preview;return null},
 querySelector(sel){return sel==='#mrXlsxImportStatus'?status:null},
 createElement(){return container}
};
const sb={from(name){
 assert.equal(name,'exercises');
 return {select(){return{eq(){return{order(){return{range:async()=>({data:[],error:null})}}}}}}}
}};
window.MR={S:{user:{id:'teacher-test'}},sb};
window.XLSX={
 read(){return{SheetNames:['READY','ШАБЛОНЫ','GENERATORS'],
   Sheets:{READY:ready,'ШАБЛОНЫ':templates,GENERATORS:generators}}},
 utils:{sheet_to_json:data=>data}
};
window.renderMathInElement=()=>{};
new Function('window','document','MutationObserver',source)(window,doc,undefined);
window.MathroomTaskXlsxImport.mount();
input.files=[{name:'Kotomatika_6klass_v100_56_zadach.xlsx',size:5000,
  arrayBuffer:async()=>new Uint8Array(4).buffer}];
(async()=>{
 input.onchange();
 for(let i=0;i<40;i++)await Promise.resolve();
 assert.match(preview.innerHTML,/67<\/strong><span>Всего записей/);
 assert.match(preview.innerHTML,/56<\/strong><span>Выбрано/);
 assert.match(preview.innerHTML,/Показать решение/);
 assert.match(preview.innerHTML,/Скрыть решение/);
 assert.match(preview.innerHTML,/Не выбрано: 11/);
 assert.equal(preview.choices.length,67);
 assert.equal(typeof preview.querySelector('[data-xlsx-all]').onclick,'function');
 preview.querySelector('[data-xlsx-all]').onclick();
 assert.match(preview.innerHTML,/67<\/strong><span>Выбрано/);
 assert.match(preview.innerHTML,/Выбраны все 67 записей/);
 assert.equal(preview.choices.length,67);
 assert.equal(preview.choices.filter(x=>x.checked).length,67);
 console.log('v101 PASS: 67 available records selected, solution open/close labels, existing ID singled out');
})().catch(e=>{console.error(e);process.exitCode=1});
