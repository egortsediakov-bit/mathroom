/* Mathroom v29.8.2 — hydrate the complete exercise bank beyond Supabase's 1000-row response cap. */
(() => {
  'use strict';
  const state={busy:false,lastCount:0,lastAt:0,replaying:false};
  const MR=()=>window.MR||{};
  const S=()=>MR().S||{};
  const sb=()=>MR().sb||null;
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  const bankVisible=()=>!!document.querySelector('#bankList')||/^Банк задач$/i.test(text(document.querySelector('h1')));
  const findBankNav=()=>[...document.querySelectorAll('button,a,[data-view],.nav-item')].find(x=>/^Банк задач$/i.test(text(x)));

  async function fetchAll(){
    const c=sb(),teacherId=S()?.user?.id;if(!c||!teacherId)return null;
    const rows=[];const size=1000;
    for(let from=0;from<20000;from+=size){
      const {data,error}=await c.from('exercises').select('*').eq('teacher_id',teacherId).order('created_at').range(from,from+size-1);
      if(error)throw error;
      const batch=data||[];rows.push(...batch);if(batch.length<size)break;
    }
    return rows;
  }
  async function hydrate({rerender=true}={}){
    if(state.busy)return;const ss=S();if(!ss?.user?.id)return;
    // Avoid hammering the API while the page is mutating.
    if(Date.now()-state.lastAt<1200&&state.lastCount>1000)return;
    state.busy=true;
    try{
      const rows=await fetchAll();if(!rows)return;
      state.lastAt=Date.now();state.lastCount=rows.length;
      const old=(ss.exercises||[]).length;
      if(rows.length!==old){ss.exercises=rows;}
      // Native bank renderer uses S.exercises. Replay the Bank navigation once after hydration.
      if(rerender&&bankVisible()&&rows.length!==old&&!state.replaying){
        const nav=findBankNav();
        if(nav){state.replaying=true;setTimeout(()=>{try{nav.click()}finally{setTimeout(()=>state.replaying=false,250)}},0);}
      }
      // If replay was impossible, at least correct the visible total badge.
      if(bankVisible()){
        for(const el of document.querySelectorAll('.pill,.badge,span,strong,b')){
          if(/^\d+ задач$/i.test(text(el)))el.textContent=`${rows.length} задач`;
        }
      }
      return rows;
    }catch(e){console.warn('[Mathroom 29.8.2 bank hydration]',e);return null;}
    finally{state.busy=false;}
  }

  let timer=null;
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(bankVisible())hydrate();},180);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',()=>{if(bankVisible())hydrate();});
  setTimeout(schedule,700);
  window.MathroomBankAllExercisesV2982={version:'29.8.2',state,hydrate,fetchAll};
})();