/* v96 quality and responsive PDF-form regressions.
 * Run: node tests/v96-pdf-layout.cjs */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const sandbox={window:{},console};
new vm.Script(fs.readFileSync(path.join(root,'js/pdf-quality-v92.js'),'utf8'))
 .runInNewContext(sandbox);
const audit=sandbox.window.MathroomPdfQualityV92.audit;
const clean=audit({
 content:'Решите уравнение 3x + 2 = 11 и запишите найденный корень.',
 answer:''
},[]);
assert.deepEqual(Array.from(clean.warnings),[],
 'No answer is allowed in a private draft; it must not be called an import error');
const missingDrawing=audit({
 content:'По рисунку определите площадь треугольника ABC.',answer:''
},[]);
assert.ok(missingDrawing.warnings.some(w=>w.includes('рисунок')),
 'Actually missing illustration remains a warning');
const badSymbol=audit({
 content:'Вычислите значение выражения 3 + □ + 7.',answer:''
},[]);
assert.ok(badSymbol.warnings.some(w=>w.includes('символы')),
 'Corrupted mathematical text remains a warning');
const css=fs.readFileSync(path.join(root,'css/pdf-import-v95.css'),'utf8');
assert.ok(css.includes('.mr-pdf-task-card > .grid.cols2'),
 'Task selectors need a scoped explicit layout');
assert.ok(css.includes('grid-template-columns:minmax(0,1fr)!important'),
 'Narrow dialogs must stack fields');
assert.ok(css.includes('max-width:calc(100vw - 24px)!important'),
 'Dialog must not exceed viewport width');
assert.ok(css.includes('max-width:100%!important'),
 'Form descendants must not overflow');
let depth=0;
for(const c of css){if(c==='{')depth++;else if(c==='}')depth--;assert.ok(depth>=0)}
assert.equal(depth,0,'CSS braces must be balanced');
console.log('v96 PASS: answer optional, real warnings retained, responsive PDF fields');
