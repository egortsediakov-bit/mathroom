/* Mathroom v29.9.3 — final automatic pass for low-confidence PDF review. */
(() => {
  'use strict';
  const api=window.MathroomTaskImportV298;
  if(!api||api.__finalReview2993)return;
  const VERSION='29.9.3';
  const MR=()=>window.MR||{}, S=()=>MR().S||{};
  const client=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const toast=m=>{try{MR().toast?.(m)}catch{}};
  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/([А-Яа-яЁё])-\s+([А-Яа-яЁё])/g,'$1$2').replace(/\s+/g,' ').trim();

  const request=/(?:реш(?:и|ите|ить)|найд(?:и|ите|ти)|вычисл(?:и|ите|ить)|докаж(?:и|ите|ать)|постро(?:й|йте|ить)|сравн(?:и|ите|ить)|упрост(?:и|ите|ить)|разлож(?:и|ите|ить)|представ(?:ьте|ить)|определ(?:и|ите|ить)|исслед(?:уй|уйте|овать)|состав(?:ь|ьте|ить)|запиш(?:и|ите|ать)|объясн(?:и|ите|ить)|установ(?:и|ите|ить)|укаж(?:и|ите|ать)|выраз(?:и|ите|ить)|выполн(?:и|ите|ить)|ответ(?:ь|ьте|ить)|\?|сколько\b|чему\s+рав|какое\s+число|какие\s+числа|при\s+каких|верно\s+ли|можно\s+ли)/i;
  const bad=/(?:\b(?:мы\s+получили|мы\s+получаем|упростим|умножим|разложим|возвед[её]м|получим|подставим|рассмотрим|представим|подбором\s+находим|имеем|видим)\b|^(?:это\s+возможно|например|эти\b|чтобы\b|для\s+этого\b|во\s+второй\b|в\s+третью\b|тогда\b|следовательно\b|полученный\s+результат)|записываются\s+коэффициенты|в\s+(?:второй|третьей)\s+строчк|являющегося\s+второй\s+степенью|дают\s+все\s+целочисленные\s+решения|\bрис\.?\s*\d+|\bглава\b|\bБик\s*:|\bSe\s+oo\b|\|\s*Глава)/i;
  const heading=/^(?:линейная\s+функция|степенная\s+функция|квадрат\s+суммы\s+и\s+квадрат\s+разности|формулы?\s+сокращ[её]нного\s+умножения)\s*\d*\s*$/i;
  const oddNo=/[A-Za-zА-Яа-яЁё]/;
  const mathOnly=t=>{
    const letters=(t.match(/[А-Яа-яЁёA-Za-z]/g)||[]).length;
    const maths=(t.match(/[0-9=+−–\-*/^√()\[\]{}<>%.,:;]/g)||[]).length;
    const words=(t.match(/[А-Яа-яЁёA-Za-z]{2,}/g)||[]).length;
    return t.length<=220&&maths>=6&&maths>=letters*.55&&words<=5;
  };
  function decision(row){
    const t=clean(row.content), conf=Number(row.confidence||0);
    if(!t)return'reject';
    if(request.test(t))return'accept';
    if(bad.test(t)||heading.test(t)||oddNo.test(String(row.task_no||'')))return'reject';
    if(conf<=.82){
      if(mathOnly(t))return'accept';
      if((t.match(/[А-Яа-яЁёA-Za-z]/g)||[]).length>=10)return'reject';
      if(t.length<24)return'reject';
    }
    return'keep';
  }
  async function userId(c){if(S()?.user?.id)return S().user.id;try{return (await c.auth.getUser()).data.user?.id||null}catch{return null}}
  async function run({silent=false}={}){
    const c=client(); if(!c)return{accepted:0,rejected:0,remaining:0};
    const uid=await userId(c); if(!uid)return{accepted:0,rejected:0,remaining:0};
    try{await api.autoTriage2991?.({silent:true})}catch{}
    const {data,error}=await c.from('task_bank_import_candidates').select('id,content,confidence,task_no').eq('teacher_id',uid).eq('status','pending').order('confidence',{ascending:false}).limit(1000);
    if(error)throw error;
    const accept=[],reject=[],keep=[];
    for(const row of data||[]){const d=decision(row);(d==='accept'?accept:d==='reject'?reject:keep).push(row.id)}
    for(let i=0;i<reject.length;i+=100){const {error:e}=await c.from('task_bank_import_candidates').update({status:'rejected',updated_at:new Date().toISOString()}).eq('teacher_id',uid).in('id',reject.slice(i,i+100));if(e)throw e}
    let imported=0;
    for(let i=0;i<accept.length;i+=200){const {data:n,error:e}=await c.rpc('mathroom_import_task_candidates',{p_ids:accept.slice(i,i+200)});if(e)throw e;imported+=Number(n)||0}
    try{await window.MathroomTaskImportUIV2983?.render?.(true)}catch{}
    try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true})}catch{}
    if(!silent)toast(`PDF авторазбор: в банк ${imported}, отклонено ${reject.length}, осталось ${keep.length}.`);
    return{accepted:imported,rejected:reject.length,remaining:keep.length,version:VERSION};
  }
  const prevReview=api.reviewModal?.bind(api);
  if(prevReview)api.reviewModal=async(...args)=>{try{await run({silent:true})}catch(e){console.warn(e)}return prevReview(...args)};
  const prevScan=api.scanAndImport?.bind(api);
  if(prevScan)api.scanAndImport=async opts=>{const r=await prevScan(opts);try{await run({silent:false})}catch(e){console.warn(e)}return r};
  api.finalAutoReview2993=run;
  api.__finalReview2993=true;
  window.MathroomTaskFinalReviewV2993={version:VERSION,run,decision};
  setTimeout(()=>run({silent:false}).catch(e=>console.warn('[Mathroom 29.9.3]',e)),3200);
})();
