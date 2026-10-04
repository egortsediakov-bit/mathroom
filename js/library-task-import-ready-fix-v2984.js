/* Mathroom v29.8.4 — fix task-import stats ready/status name collision. */
(() => {
  'use strict';
  const api=window.MathroomTaskImportV298;
  if(!api||typeof api.stats!=='function'){
    console.warn('[Mathroom 29.8.4] task import API is not ready');
    return;
  }
  if(api.__readyFix2984)return;
  const originalStats=api.stats.bind(api);
  api.stats=async (...args)=>{
    const st=await originalStats(...args);
    if(!st||typeof st!=='object')return st;
    // v29.8.3 used `ready` both as the boolean module state and as the
    // count of candidates with status='ready'. When that count was 0,
    // the UI interpreted the module as not initialized forever.
    if(typeof st.ready==='number'){
      st.readyCount=st.ready;
      st.ready=true;
    } else if(st.ready===true && st.readyCount==null){
      st.readyCount=0;
    }
    return st;
  };
  api.__readyFix2984=true;
  api.VERSION='29.8.4';
  setTimeout(()=>window.MathroomTaskImportUIV2983?.render?.(true),100);
})();
