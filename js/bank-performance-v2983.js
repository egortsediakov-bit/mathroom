/* Mathroom v29.8.3 — keep the task bank responsive with large datasets. */
(() => {
  'use strict';
  const state={busy:false,total:null,lastAt:0};
  const MR=()=>window.MR||{}, S=()=>MR().S||{}, sb=()=>MR().sb||null;
  const bankVisible=()=>!!document.getElementById('bankList');
  const txt=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();

  function patchBadge(){
    if(!bankVisible()||state.total==null)return;
    const pills=[...document.querySelectorAll('.bank-summary .pill')];
    const first=pills[0];if(!first)return;
    const loaded=(S().exercises||[]).filter(x=>x.kind==='task').length;
    first.textContent=state.total>loaded?`Всего ${state.total} · показано ${loaded}`:`${state.total} задач`;
  }
  async function refreshCount({force=false}={}){
    if(state.busy)return state.total;
    if(!force&&Date.now()-state.lastAt<10000&&state.total!=null){patchBadge();return state.total;}
    const c=sb(),uid=S()?.user?.id;if(!c||!uid)return null;
    state.busy=true;
    try{
      const {count,error}=await c.from('exercises').select('*',{count:'exact',head:true}).eq('teacher_id',uid).eq('kind','task');
      if(error)throw error;state.total=count||0;state.lastAt=Date.now();patchBadge();return state.total;
    }catch(e){console.warn('[Mathroom 29.8.3 bank count]',e);return null;}finally{state.busy=false;}
  }
  function tick(){if(bankVisible())refreshCount();}
  // Intentionally no MutationObserver and no loading of all 10k+ exercise rows into S.exercises.
  // Native UI keeps its bounded page in memory; only the exact total is queried separately.
  setInterval(tick,12000);
  window.addEventListener('focus',()=>{if(bankVisible())refreshCount({force:true});});
  document.addEventListener('click',e=>{const t=e.target?.closest?.('button,a,[data-view],.nav-item');if(t&&/^Банк задач$/i.test(txt(t)))setTimeout(()=>refreshCount({force:true}),500);},{capture:true});
  setTimeout(tick,1000);
  window.MathroomBankPerformanceV2983={version:'29.8.3',state,refreshCount,patchBadge};
})();