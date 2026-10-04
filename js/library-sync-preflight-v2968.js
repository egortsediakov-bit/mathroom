/* Mathroom v29.6.8 — EARLY sync preflight.
   IMPORTANT: load this file BEFORE app-v341.js so it intercepts the native
   v29.2 sync click before the legacy handler can start with stale metadata. */
(function(){
  'use strict';
  const STATE={busy:false,lastRepair:0};
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  const isSyncButton=b=>!!b&&/^Синхронизировать(?: учебники)? с темами$/i.test(text(b));
  function toast(msg,ms=6500){
    let t=document.querySelector('[data-m2968-sync-toast]');
    if(!t){
      t=document.createElement('div');t.dataset.m2968SyncToast='1';
      t.style.cssText='position:fixed;right:24px;bottom:24px;z-index:999999;background:#17191c;color:#fff;padding:13px 16px;border-radius:14px;box-shadow:0 12px 36px #0003;font:600 14px/1.35 system-ui;max-width:460px';
      document.documentElement.appendChild(t);
    }
    t.textContent=msg;clearTimeout(t._timer);t._timer=setTimeout(()=>t.remove(),ms);
  }
  function refreshVisibleCounters(s){
    try{
      for(const el of document.querySelectorAll('span,div,p,strong,b')){
        const v=text(el);
        if(/^Распознано\s+\d+\/\d+$/i.test(v)) el.textContent=`Распознано ${s.recognized}/${s.total}`;
      }
    }catch{}
  }
  async function repairThenReplay(button){
    if(STATE.busy)return;
    STATE.busy=true;
    const previousDisabled=button.disabled;
    button.disabled=true;
    try{
      toast('Проверяем метаданные библиотеки перед синхронизацией…');
      // Core is loaded later than this early guard, but is available by the time the user clicks.
      const lib=window.MathroomLibrary2968;
      if(!lib?.repairExistingLibrary) throw new Error('Модуль библиотеки v29.6.8 не загружен');
      const s=await lib.repairExistingLibrary();
      STATE.lastRepair=Date.now();
      refreshVisibleCounters(s);
      toast(`Библиотека проверена: распознано ${s.recognized}/${s.total}, исправлено ${s.updated}. Теперь запускаем синхронизацию тем…`);
      // Let the legacy v29.2 handler receive ONLY this second click, after repair is complete.
      button.dataset.m2968AllowLegacy='1';
      button.disabled=false;
      await new Promise(r=>setTimeout(r,350));
      button.click();
    }catch(e){
      console.error('[Mathroom 29.6.8 sync preflight]',e);
      toast('Не удалось подготовить библиотеку: '+String(e?.message||e));
      button.disabled=previousDisabled;
    }finally{
      STATE.busy=false;
    }
  }
  // Register on WINDOW CAPTURE before app-v341.js registers its own handlers.
  window.addEventListener('click',function(e){
    const b=e.target?.closest?.('button');
    if(!isSyncButton(b))return;
    if(b.dataset.m2968AllowLegacy==='1'){
      delete b.dataset.m2968AllowLegacy;
      return; // native sync now runs with repaired rows
    }
    // Block the first click completely so legacy sync cannot race the repair.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    repairThenReplay(b);
  },true);

  window.MathroomSyncPreflight2968={state:STATE};
})();
