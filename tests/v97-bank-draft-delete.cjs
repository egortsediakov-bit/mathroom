/* Mathroom v97 regression: deleting 1 draft must not hide the remaining 19.
 * Run: node tests/v97-bank-draft-delete.cjs
 * Does not touch production data. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'..','app-v341.js'),'utf8');
const reconcileSource=app.match(/  const reconcileDeletedBankRow=\(deletedId,previousRows,reloadedRows\)=>\{[\s\S]*?\n  \};/);
assert.ok(reconcileSource,'deleted-row reconciliation helper must exist');
const reconcile=new Function(reconcileSource[0]+'return reconcileDeletedBankRow;')();
const originals=Array.from({length:1992},(_,i)=>({id:'task-'+i,kind:'task',is_draft:false}))
  .concat(Array.from({length:20},(_,i)=>({id:'draft-'+i,kind:'task',is_draft:true})));
const target=originals.find(x=>x.id==='draft-0');
const truncated=originals.slice(0,1000);
const after=reconcile(target.id,originals,truncated);
assert.equal(originals.length,2012);
assert.equal(after.length,2011,'one and only one row removed');
assert.equal(after.filter(x=>x.is_draft).length,19,'remaining drafts survive a 1000-row reload');
assert.ok(after.some(x=>x.id==='draft-19'),'drafts outside first page must be retained');
assert.ok(!after.some(x=>x.id===target.id),'deleted row must not return');

const start=app.indexOf("    host.querySelectorAll('[data-bank-delete]').forEach(b=>b.onclick=()=>{");
const end=app.indexOf("    hydrateTaskMedia(host);",start);
assert.ok(start>=0&&end>start,'expected delete handler not found');
const handler=app.slice(start,end);
assert.ok(handler.includes('const keepDraftFilter=!!S.bankDraftOnly'));
assert.ok(handler.includes('S.bankDraftOnly=keepDraftFilter'));
assert.ok(!handler.includes('onDone:renderBank'),'do not rebuild whole bank after delete');

const S={view:'bank',bankDraftOnly:true,bankLibraryMode:'mine',exercises:originals};
let draws=0,button={dataset:{bankDelete:'draft-0'},onclick:null};
const host={querySelectorAll:selector=>{
  assert.equal(selector,'[data-bank-delete]');
  return [button];
}};
const document={getElementById:id=>id==='bankList'?{}:null};
function draw(){
  draws++;
  assert.equal(S.bankDraftOnly,true,'draft filter must remain active on draw');
}
function mockDelete(row,{onDone}){
  assert.equal(row.id,'draft-0');
  // Simulate the existing loadTeacher() returning a truncated first page.
  S.exercises=truncated;
  // Even if some concurrent handler toggles state while reloading,
  // the deletion callback must restore what the user selected.
  S.bankDraftOnly=false;
  onDone();
}
const installer=new Function('host','S','deleteExerciseRow','reconcileDeletedBankRow','document','draw','own',
 handler+'\nreturn ()=>own;');
const getOwn=installer(host,S,mockDelete,reconcile,document,draw,originals);
button.onclick();
assert.equal(draws,1,'only the list is redrawn, no full-page reset');
assert.equal(S.bankDraftOnly,true,'keep the active draft filter');
assert.equal(getOwn().filter(x=>x.is_draft).length,19);
assert.equal(S.exercises.length,2011,'full bank preserved in application state');
assert.equal(S.exercises.filter(x=>x.is_draft).length,19);
assert.ok(app.includes("S.bankDraftOnly?'✓ Черновики · '"),
 'draft counter must be visible when filtered');
assert.ok(app.includes("refreshDraftUI();"),'count and active state must refresh');
console.log('v97 PASS: one draft deleted, 19 stay in filtered list, no 1000-row truncation');
