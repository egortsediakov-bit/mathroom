/* Mathroom v29.15.0 — retire the old generated 1–11 bank after explicit user approval. */
(() => {
  'use strict';
  if (window.MathroomCoreBankRetire2915) return;

  const VERSION='29.15.0';
  const BANK_TAG='mathroom-core-bank-v1';
  const MR=()=>window.MR||{};
  const S=()=>MR().S||{};
  const db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const state={busy:false,done:false,retired:0,lastError:null};

  async function userId(c){
    if(S()?.user?.id)return S().user.id;
    try{return (await c.auth.getUser()).data.user?.id||null;}catch{return null;}
  }

  function disableGenerator(){
    const bank=window.MathroomCurriculumBank;
    if(bank&&!bank.__retired2915){
      window.MathroomCurriculumBank={
        ...bank,
        seed:async()=>({retired:true,added:0,updated:0,version:VERSION}),
        __retired2915:true,
        retiredVersion:VERSION
      };
    }
  }

  function hideLegacyUi(){
    for(const el of document.querySelectorAll('button,a,.btn,.pill')){
      const t=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if(/^Обновить базу 1[–-]11$/i.test(t))el.style.display='none';
      if(/^\d+\s+из готовой базы$/i.test(t))el.style.display='none';
    }
  }

  async function countActive(c,uid){
    const {count,error}=await c.from('exercises').select('*',{count:'exact',head:true})
      .eq('teacher_id',uid).eq('kind','task').contains('tags',[BANK_TAG]);
    if(error)throw error;
    return Number(count)||0;
  }

  async function retire({silent=false}={}){
    if(state.busy)return state;
    state.busy=true;state.lastError=null;
    try{
      disableGenerator();hideLegacyUi();
      const c=db();if(!c)return state;
      const uid=await userId(c);if(!uid)return state;
      const before=await countActive(c,uid);
      if(before>0){
        const {error}=await c.from('exercises')
          .update({kind:'example',updated_at:new Date().toISOString()})
          .eq('teacher_id',uid)
          .eq('kind','task')
          .contains('tags',[BANK_TAG]);
        if(error)throw error;
      }
      const left=await countActive(c,uid);
      state.retired=before-left;state.done=left===0;

      if(Array.isArray(S().exercises)){
        for(const ex of S().exercises){
          if(Array.isArray(ex.tags)&&ex.tags.includes(BANK_TAG)&&ex.kind==='task')ex.kind='example';
        }
      }
      try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});}catch{}
      const key=`mathroom-core-bank-retired-${VERSION}-${uid}`;
      if(state.done)localStorage.setItem(key,'1');
      if(!silent&&before>0)MR().toast?.(`Старая база 1–11 убрана из Банка задач: ${state.retired} записей.`);
      if(state.done&&before>0)setTimeout(()=>location.reload(),900);
      return{...state,before,left};
    }catch(e){
      state.lastError=String(e?.message||e);
      console.error('[Mathroom 29.15 core-bank retire]',e);
      if(!silent)MR().toast?.('Не удалось убрать старую базу 1–11: '+state.lastError);
      return state;
    }finally{state.busy=false;}
  }

  disableGenerator();hideLegacyUi();
  new MutationObserver(()=>{disableGenerator();hideLegacyUi();}).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(()=>{disableGenerator();hideLegacyUi();},4000);

  window.MathroomCoreBankRetire2915={version:VERSION,state,retire,disableGenerator,hideLegacyUi};

  let tries=0;
  const boot=setInterval(async()=>{
    tries++;
    const c=db(),uid=c?await userId(c):null;
    if(!c||!uid){if(tries>40)clearInterval(boot);return;}
    clearInterval(boot);
    const key=`mathroom-core-bank-retired-${VERSION}-${uid}`;
    if(localStorage.getItem(key)==='1'){
      disableGenerator();hideLegacyUi();
      try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});}catch{}
      return;
    }
    await retire({silent:false});
  },750);
})();
