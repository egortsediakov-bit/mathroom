/* Mathroom v29.6.7 — repair native textbook metadata before legacy v29.2 topic sync. */
(function(){
  'use strict';
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  let busy=false, lastRepair=0;
  function isSyncButton(b){return b&&/^Синхронизировать(?: учебники)? с темами$/i.test(text(b));}
  function toast(msg){
    let t=document.querySelector('[data-m2967-sync-toast]');
    if(!t){t=document.createElement('div');t.dataset.m2967SyncToast='1';t.style.cssText='position:fixed;right:24px;bottom:24px;z-index:999999;background:#17191c;color:#fff;padding:13px 16px;border-radius:14px;box-shadow:0 12px 36px #0003;font:600 14px/1.3 system-ui;max-width:420px';document.body.appendChild(t);}
    t.textContent=msg;clearTimeout(t._timer);t._timer=setTimeout(()=>t.remove(),5000);
  }
  async function repairAndReplay(button){
    if(busy)return;busy=true;button.disabled=true;
    try{
      toast('Проверяем метаданные библиотеки перед синхронизацией…');
      const lib=window.MathroomLibrary2967;
      if(!lib?.repairExistingLibrary)throw new Error('Модуль библиотеки v29.6.7 не загружен');
      const s=await lib.repairExistingLibrary();lastRepair=Date.now();
      toast(`Библиотека проверена: распознано ${s.recognized}/${s.total}, исправлено ${s.updated}. Запускаем синхронизацию тем…`);
      button.dataset.m2967Replay='1';
      setTimeout(()=>{button.disabled=false;button.click();},100);
    }catch(e){
      console.error('[Mathroom 29.6.7 sync repair]',e);button.disabled=false;toast('Не удалось подготовить библиотеку: '+String(e?.message||e));
    }finally{busy=false;}
  }
  window.addEventListener('click',e=>{
    const b=e.target?.closest?.('button');if(!isSyncButton(b))return;
    if(b.dataset.m2967Replay==='1'){delete b.dataset.m2967Replay;return;}
    // Re-run repair if this is first sync or the library may have changed since the last run.
    if(Date.now()-lastRepair<15000)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    repairAndReplay(b);
  },true);
})();
