/* Mathroom v30.0 — legacy PDF task UI retired.
 * This compatibility shim now loads the XLSX task-bank importer.
 */
(() => {
  'use strict';
  const SRC='./js/task-bank-xlsx-import-v300.js?v=30.0';

  function load(){
    if(window.MathroomTaskXlsxImport){
      window.MathroomTaskXlsxImport.mount?.();
      return;
    }
    if(document.querySelector('script[data-mathroom-xlsx-v300]')) return;
    const s=document.createElement('script');
    s.src=SRC;
    s.dataset.mathroomXlsxV300='1';
    s.onload=()=>window.MathroomTaskXlsxImport?.mount?.();
    s.onerror=()=>console.error('[Mathroom v30] Не удалось загрузить XLSX importer');
    document.head.appendChild(s);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',load,{once:true});
  else load();

  window.MathroomTaskImportUIV2983={
    version:'30.0',
    mount:()=>{load();window.MathroomTaskXlsxImport?.mount?.();},
    render:()=>{load();window.MathroomTaskXlsxImport?.mount?.();}
  };
})();
