/* Mathroom v29.16.0 — finalize completed School 57 indexing and run the final task extraction. */
(()=>{
'use strict';if(window.MathroomIndexFinalizer2916)return;
const MR=()=>window.MR||{},db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
let busy=false,lastSig='';
async function run(){
 if(busy)return;const mod=window.MathroomLibraryFullIndex2910,c=db();if(!mod||!c)return;busy=true;
 try{
  const st=await mod.inspect({probeUnknown:false,queue:false});if(!st?.ready)return;
  for(const d of st.details||[]){if(!d.complete||String(d.status||'')==='done')continue;await c.from('task_bank_sources').update({ocr_status:'done',ocr_pages_done:Number(d.done||0),ocr_pages_total:Number(d.target||d.done||0),ocr_error:null}).eq('id',d.sourceId)}
  if(st.taskSources&&st.complete>=st.taskSources){
   const sig=`${st.indexedPages}/${st.expectedPages}`;
   if(sig!==lastSig){lastSig=sig;MR().toast?.(`Индексация задачников завершена: ${sig}. Извлекаем задачи…`);try{await window.MathroomSchool57Import2916?.scan?.({onProgress:m=>MR().toast?.(m)})}catch(e){console.warn('[Mathroom final task import]',e)}try{await window.MathroomLibraryFullIndexUI2910?.refresh?.(true)}catch{}try{await window.MathroomTaskImportUIV2983?.render?.(true)}catch{}try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true})}catch{}
   }
  }
 }catch(e){console.warn('[Mathroom index finalizer]',e)}finally{busy=false}
}
setTimeout(run,3500);setInterval(run,30000);window.MathroomIndexFinalizer2916={version:'29.16.0',run};
})();
