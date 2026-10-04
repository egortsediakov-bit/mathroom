/* Mathroom v29.13.1 — task-source PDF indexing progress in Task Bank. */
(() => {
  'use strict';
  const state={busy:false,lastAt:0};
  const mod=()=>window.MathroomLibraryFullIndex2910||null;
  const fmt=n=>Number(n||0).toLocaleString('ru-RU');
  function host(){return document.getElementById('pdfTaskImportCard');}
  function line(){const h=host();if(!h)return null;let el=h.querySelector('#pdfFullIndexProgress');if(!el){el=document.createElement('div');el.id='pdfFullIndexProgress';el.className='small muted';el.style.marginTop='4px';(h.firstElementChild||h).appendChild(el);}return el;}
  function paint(st){
    const el=line();if(!el||!st?.ready)return;
    const total=st.expectedPages?fmt(st.expectedPages):'?';
    const complete=`${fmt(st.complete)}/${fmt(st.taskSources||st.matched||0)}`;
    const extra=st.unknownPages?` · неизвестен объём ${fmt(st.unknownPages)}`:'';
    const q=st.incomplete?` · осталось в индексации ${fmt(st.incomplete)}`:'';
    el.innerHTML=`Индексация источников задач: <b>${fmt(st.indexedPages)}/${total}</b> страниц · полностью <b>${complete}</b>${q}${extra}. Учебники сюда не входят.`;
  }
  async function refresh(force=false){if(state.busy)return;if(!force&&Date.now()-state.lastAt<10000){paint(mod()?.state?.last);return;}const m=mod();if(!m)return;state.busy=true;try{const st=await m.inspect({probeUnknown:false,queue:true});state.lastAt=Date.now();paint(st);}catch(e){console.warn('[Mathroom task-source index UI]',e);}finally{state.busy=false;}}
  setInterval(()=>{if(host())refresh(false);},5000);
  window.addEventListener('focus',()=>refresh(true));
  setTimeout(()=>refresh(true),5000);
  window.MathroomLibraryFullIndexUI2910={version:'29.13.1',refresh};
})();
