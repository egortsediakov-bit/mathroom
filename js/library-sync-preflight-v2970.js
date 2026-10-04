/* Mathroom v29.7.0 — sync preflight: repair metadata, build OCR page maps, then run native sync. */
(function(){
  'use strict';
  const STATE={busy:false,lastRepair:0,lastExtra:null};
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  const isSyncButton=b=>!!b&&/^Синхронизировать(?: учебники)? с темами$/i.test(text(b));
  function toast(msg,ms=7000){
    let t=document.querySelector('[data-m2970-sync-toast]');
    if(!t){
      t=document.createElement('div');t.dataset.m2970SyncToast='1';
      t.style.cssText='position:fixed;right:24px;bottom:24px;z-index:999999;background:#17191c;color:#fff;padding:13px 16px;border-radius:14px;box-shadow:0 12px 36px #0003;font:600 14px/1.35 system-ui;max-width:500px';
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
    const previousDisabled=button.disabled;button.disabled=true;
    try{
      toast('Проверяем метаданные библиотеки…');
      const lib=window.MathroomLibrary2968;
      if(!lib?.repairExistingLibrary) throw new Error('Модуль библиотеки v29.6.8 не загружен');
      const s=await lib.repairExistingLibrary();
      STATE.lastRepair=Date.now();refreshVisibleCounters(s);

      const extra=window.MathroomTextbookExtraV2970;
      if(extra?.prepare){
        toast(`Библиотека: ${s.recognized}/${s.total}. Строим карты страниц для новых учебников…`,12000);
        STATE.lastExtra=await extra.prepare({onProgress:m=>toast(m,12000)});
      }
      const x=STATE.lastExtra;
      const suffix=x?.mapped?` OCR-карта нашла ${x.mapped} соответствий по ${x.sources} новым источникам.`:'';
      toast(`Библиотека проверена: распознано ${s.recognized}/${s.total}, исправлено ${s.updated}.${suffix} Запускаем синхронизацию…`,9000);

      button.dataset.m2970AllowLegacy='1';button.disabled=false;
      await new Promise(r=>setTimeout(r,250));button.click();
    }catch(e){
      console.error('[Mathroom 29.7 sync preflight]',e);
      toast('Не удалось подготовить библиотеку: '+String(e?.message||e));button.disabled=previousDisabled;
    }finally{STATE.busy=false;}
  }
  window.addEventListener('click',function(e){
    const b=e.target?.closest?.('button');if(!isSyncButton(b))return;
    if(b.dataset.m2970AllowLegacy==='1'){delete b.dataset.m2970AllowLegacy;return;}
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();repairThenReplay(b);
  },true);
  window.MathroomSyncPreflight2970={state:STATE};
})();
