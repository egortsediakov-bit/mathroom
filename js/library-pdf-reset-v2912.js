/* Mathroom v29.12.0 — manual PDF import reset and strict rescan. */
(() => {
  'use strict';
  const TAG='mathroom-core-bank-v29.8-pdf';
  const api=window.MathroomTaskImportV298;
  if(!api||api.__reset2912)return;
  const MR=()=>window.MR||{}, S=()=>MR().S||{}, db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const toast=m=>{try{MR().toast?.(m)}catch{}};
  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/([А-Яа-яЁё])-\s+([А-Яа-яЁё])/g,'$1$2').replace(/\s+/g,' ').trim();
  const imperative=/(?:^|[.!?]\s*)(?:решите|найдите|вычислите|докажите|постройте|сравните|упростите|разложите|представьте|определите|исследуйте|составьте|запишите|объясните|установите|укажите|выразите|выполните|ответьте|замените|раскройте|преобразуйте)\b/i;
  const question=/(?:\?|\bсколько\b|\bчему\s+рав(?:ен|на|но)\b|\bкакое\s+число\b|\bкакие\s+числа\b|\bпри\s+каких\b|\bверно\s+ли\b|\bможно\s+ли\b)/i;
  const notTask=/(?:^|[.!?]\s*)(?:получим|получаем|получили|упростим|умножим|разложим|возвед[её]м|подставим|рассмотрим|представим|обозначим|перепишем|найд[её]м|видим|имеем|проверим|заметим|вычтем|сложим|применяя|подбором\s+находим|следовательно|поэтому|таким\s+образом|отсюда|это\s+возможно)\b|\bназывается\b|\bявляется\b|\bпредставляет\s+собой\b|\bтеорема\b|\bдоказательство\b|\bнапример\b|\bрис\.?\s*\d+|\bглава\b|\bсодержание\b|\bоглавление\b/i;
  const classify=t=>{t=clean(t);if(!t||t.length<12||notTask.test(t))return'reject';if(imperative.test(t)||question.test(t))return'accept';return'review'};
  async function uid(){if(S()?.user?.id)return S().user.id;try{return (await db()?.auth.getUser()).data.user?.id||null}catch{return null}}

  async function strictReview(){
    const c=db(),u=await uid();if(!c||!u)return;
    const {data,error}=await c.from('task_bank_import_candidates').select('id,content,status').eq('teacher_id',u).in('status',['pending','ready']).limit(5000);if(error)throw error;
    const accept=[],reject=[];
    for(const r of data||[]){const d=classify(r.content);if(d==='accept')accept.push(r.id);else if(d==='reject')reject.push(r.id)}
    for(let i=0;i<reject.length;i+=100){const {error:e}=await c.from('task_bank_import_candidates').update({status:'rejected',exercise_id:null,updated_at:new Date().toISOString()}).eq('teacher_id',u).in('id',reject.slice(i,i+100));if(e)throw e}
    let imported=0;for(let i=0;i<accept.length;i+=150){const {data:n,error:e}=await c.rpc('mathroom_import_task_candidates',{p_ids:accept.slice(i,i+150)});if(e)throw e;imported+=Number(n)||0}
    return{imported,rejected:reject.length};
  }

  async function resetAndRescan(){
    const c=db(),u=await uid();if(!c||!u)throw new Error('Сессия преподавателя не готова');
    const ok=window.confirm('Удалить только задачи, импортированные из PDF, очистить очередь PDF и просканировать библиотеку заново? Готовая база 1–11 и ваши обычные задачи не будут удалены.');
    if(!ok)return;
    toast('Очищаем старый PDF-импорт…');
    let q=await c.from('exercises').delete().eq('teacher_id',u).eq('kind','task').contains('tags',[TAG]);if(q.error)throw q.error;
    q=await c.from('task_bank_import_candidates').delete().eq('teacher_id',u);if(q.error)throw q.error;
    const {data:sources,error:se}=await c.from('task_bank_sources').select('id,meta').eq('is_active',true);if(se)throw se;
    for(const s of sources||[]){const meta={...(s.meta||{}),task_import_version:'',task_import_pages_done:-1,task_import_at:null};const {error:e}=await c.from('task_bank_sources').update({meta}).eq('id',s.id);if(e)throw e}
    try{window.MathroomPdfTasksBrowser2911.state.rows=[];window.MathroomPdfTasksBrowser2911.state.loaded=false}catch{}
    try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true})}catch{}
    try{await window.MathroomTaskImportUIV2983?.render?.(true)}catch{}
    toast('PDF-импорт обнулён. Запускаем новое сканирование…');
    const r=await api.scanAndImport({force:true,onProgress:m=>toast(m)});
    const sr=await strictReview();
    try{await window.MathroomTaskImportUIV2983?.render?.(true)}catch{}
    try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true})}catch{}
    toast(`Готово: найдено ${r?.parsed||0}, строго импортировано ${sr?.imported||0}, теория отклонена ${sr?.rejected||0}.`);
  }

  const prevScan=api.scanAndImport.bind(api);
  api.scanAndImport=async opts=>{const r=await prevScan(opts||{});try{await strictReview()}catch(e){console.warn(e)}return r};
  api.resetPdfImport2912=resetAndRescan;api.strictReview2912=strictReview;api.__reset2912=true;

  function mount(){const h=document.getElementById('pdfTaskImportCard');if(!h)return;const a=h.querySelector('.actions');if(!a||a.querySelector('#pdfReset2912'))return;const b=document.createElement('button');b.id='pdfReset2912';b.className='btn sm danger';b.textContent='Сбросить PDF и пересканировать';b.onclick=()=>resetAndRescan().catch(e=>toast('Сброс PDF: '+String(e.message||e)));a.appendChild(b)}
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});setTimeout(mount,1200);
  window.MathroomPdfReset2912={version:'29.12.0',resetAndRescan,strictReview,classify};
})();
