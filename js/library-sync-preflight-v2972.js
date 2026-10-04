/* Mathroom v29.7.2 — ensure detailed 7–11 curriculum, repair books, queue/index pages, then run native sync. */
(function(){
  'use strict';
  const STATE={busy:false,lastRepair:0,lastExtra:null,lastCurriculum:null};
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  const isSyncButton=b=>!!b&&/^Синхронизировать(?: учебники)? с темами$/i.test(text(b));
  function toast(msg,ms=9000){
    let t=document.querySelector('[data-m2972-sync-toast]');
    if(!t){t=document.createElement('div');t.dataset.m2972SyncToast='1';t.style.cssText='position:fixed;right:24px;bottom:24px;z-index:999999;background:#17191c;color:#fff;padding:13px 16px;border-radius:14px;box-shadow:0 12px 36px #0003;font:600 14px/1.4 system-ui;max-width:540px';document.documentElement.appendChild(t);}
    t.textContent=msg;clearTimeout(t._timer);t._timer=setTimeout(()=>t.remove(),ms);
  }
  function refreshVisibleCounters(s){try{for(const el of document.querySelectorAll('span,div,p,strong,b')){const v=text(el);if(/^Распознано\s+\d+\/\d+$/i.test(v))el.textContent=`Распознано ${s.recognized}/${s.total}`;}}catch{}}
  async function repairThenReplay(button){
    if(STATE.busy)return;STATE.busy=true;const previousDisabled=button.disabled;button.disabled=true;
    try{
      const curr=window.MathroomCurriculum711V2972;
      if(curr?.ensure){toast('Обновляем детальную программу 7–11 классов…',15000);STATE.lastCurriculum=await curr.ensure();}

      toast('Проверяем метаданные библиотеки…');
      const lib=window.MathroomLibrary2968;if(!lib?.repairExistingLibrary)throw new Error('Модуль библиотеки не загружен');
      const s=await lib.repairExistingLibrary();STATE.lastRepair=Date.now();refreshVisibleCounters(s);

      const extra=window.MathroomTextbookExtraV2970;
      if(extra?.prepare){toast(`Библиотека: ${s.recognized}/${s.total}. Строим детальные карты страниц…`,20000);STATE.lastExtra=await extra.prepare({onProgress:m=>toast(m,16000)});}
      const x=STATE.lastExtra||{};
      const mapPart=x.mapped?` Найдено ${x.mapped} OCR-соответствий по ${x.sources} источникам.`:'';
      const queuePart=x.queued?` Ещё ${x.queued} учебник(ов) отправлено на фоновую индексацию VPS; после её завершения следующая синхронизация добавит больше точных связей.`:'';
      toast(`Программа и библиотека готовы: распознано ${s.recognized}/${s.total}.${mapPart}${queuePart} Запускаем синхронизацию…`,14000);

      button.dataset.m2972AllowLegacy='1';button.disabled=false;await new Promise(r=>setTimeout(r,300));button.click();
    }catch(e){console.error('[Mathroom 29.7.2 sync preflight]',e);toast('Не удалось подготовить синхронизацию: '+String(e?.message||e),12000);button.disabled=previousDisabled;}
    finally{STATE.busy=false;}
  }
  window.addEventListener('click',function(e){const b=e.target?.closest?.('button');if(!isSyncButton(b))return;if(b.dataset.m2972AllowLegacy==='1'){delete b.dataset.m2972AllowLegacy;return;}e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();repairThenReplay(b);},true);
  window.MathroomSyncPreflight2972={state:STATE};
})();
