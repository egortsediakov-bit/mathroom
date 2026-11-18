const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const base=path.resolve(__dirname,'..');
const sandbox={window:{},console};
for(const name of ['js/pdf-quality-v92.js','js/pdf-capture-v92.js','js/pdf-import-v91.js']){
  const code=fs.readFileSync(path.join(base,name),'utf8');
  new vm.Script(code,{filename:name}).runInNewContext(sandbox);
}
const quality=sandbox.window.MathroomPdfQualityV92;
const capture=sandbox.window.MathroomPdfCaptureV92;
const importer=sandbox.window.MathroomPdfImportV91;
assert.ok(quality&&capture&&importer,'v92 API not loaded');
const formula='Вычислите значение выражения (a + b)² при a = 7, b = 3.';
const near='Вычислите  значение выражения (a + b)² при a = 7, b = 3!';
assert.ok(quality.similarity(formula,near)>.9,'near duplicate detection');
assert.ok(quality.audit({content:'Используя рисунок, найдите площадь треугольника.',answer:''},[])
  .warnings.some(w=>w.includes('рисунок')),'missing figure warning');
assert.ok(quality.audit({content:'Используя рисунок, найдите площадь треугольника.',answer:'20',capture:{blob:{}}},[])
  .warnings.every(w=>!w.includes('рисунок')),'no missing figure warning when captured');
assert.ok(quality.audit({content:'Найдите значение \uFFFD + 12 и объясните ответ.',answer:'3'},[])
  .warnings.some(w=>w.includes('символы')),'bad glyph warning');
const parsed=importer.splitPage(['1. Найдите площадь квадрата со стороной 4.','2. Найдите значение выражения 12+14.'],8);
assert.equal(parsed.length,2);
assert.equal(parsed[0].page,8);
const importerSource=fs.readFileSync(path.join(base,'js/pdf-import-v91.js'),'utf8');
assert.ok(importerSource.includes("is_draft:true"),'PDF tasks must remain drafts');
assert.ok(importerSource.includes(".storage.from('task-images')"),'crop uploads must use task-images Storage');
assert.ok(importerSource.includes("x.visualOnly&&!x.capture"),'scans need a selected crop');
const builder=fs.readFileSync(path.join(base,'js/task-builder-v60.js'),'utf8');
assert.ok(builder.includes('editing?.builder_meta?.pdf_import'),'PDF publication must be confirmed');
capture.capture({file:null,pageNumber:1}).then(result=>{
  assert.equal(result,null);
  console.log('v92 smoke PASS: parsing, risk flags, near duplicates, draft safeguards, capture API');
}).catch(e=>{console.error(e);process.exitCode=1});
