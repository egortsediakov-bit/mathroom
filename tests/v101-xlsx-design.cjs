/* v101 regression. Run: node tests/v101-xlsx-design.cjs
 * Static/DOM-smoke test. No production data writes. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css/xlsx-import-v100.css'),'utf8');
const source=fs.readFileSync(path.join(root,'js/task-bank-xlsx-import-v100.js'),'utf8');
const core=fs.readFileSync(path.join(root,'js/xlsx-import-core-v100.js'),'utf8');
for(const pattern of [
  /(?:101\.0-xlsx-pro-grid|102\.0-no-ai)/,
  /css\/xlsx-import-v100\.css/,
  /js\/task-bank-xlsx-import-v100\.js/
])assert.match(html,pattern);
assert.doesNotMatch(html,/task-bank-xlsx-import-v300\.js/);
for(const pattern of [
  /mr-xlsx-stats/,/mr-xlsx-control-group/,/mr-xlsx-item-tags/,
  /mr-xlsx-item-bottom/,/mr-xlsx-import-footer/,/data-xlsx-choice/,
  /id="mrXlsxRights"/,/data-xlsx-stat-selected/,/renderMathInElement/
])assert.match(source,pattern);
for(const pattern of [
  /\.mr-xlsx-import-v100 \.mr-xlsx-brandmark/,
  /\.mr-xlsx-import-v100 \.mr-xlsx-stats/,
  /\.mr-xlsx-import-v100 \.mr-xlsx-item\.is-selected/,
  /@media\(max-width:720px\)/,
  /:root\[data-theme="dark"\]/
])assert.match(css,pattern);
let depth=0;for(const ch of css){depth+=ch==='{'?1:ch==='}'?-1:0;assert.ok(depth>=0)}
assert.equal(depth,0);
new Function(source);new Function(core);
const window={};
const handlers={};
const container={innerHTML:'',
  querySelector:sel=>handlers[sel]||(handlers[sel]={click(){this.clicked=true}})};
let mounted=null;
const list={parentNode:{insertBefore(node){mounted=node}}};
const document={
  readyState:'loading',
  addEventListener(){},
  getElementById:id=>id==='bankList'?list:null,
  createElement:tag=>{assert.equal(tag,'section');return container}
};
new Function('window','document','MutationObserver',source)(window,document,undefined);
const API=window.MathroomTaskXlsxImport;
assert.ok(API?.mount);
API.mount();
assert.equal(mounted,container);
assert.match(container.innerHTML,/КОТОМАТИКА \/ БАНК ЗАДАЧ/);
assert.match(container.innerHTML,/mr-xlsx-brandmark/);
assert.match(container.innerHTML,/01<\/b> Загрузить файл/);
assert.match(container.innerHTML,/03<\/b> Сохранить черновики/);
assert.match(container.innerHTML,/Ничего не публикуется автоматически/);
assert.match(container.innerHTML,/data-xlsx-button/);
assert.equal(typeof handlers['#mrXlsxChooseV100'].onclick,'function');
assert.equal(typeof handlers['#mrXlsxFileV100'].onchange,'function');
handlers['#mrXlsxChooseV100'].onclick();
assert.equal(handlers['#mrXlsxFileV100'].clicked,true);
console.log('v101 PASS: Pro Grid importer CSS, responsive styles, branded header, controls and scripts');
