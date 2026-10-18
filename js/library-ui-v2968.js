/* Mathroom v52.4 — stable Library labels. Never hide the primary sidebar navigation item. */
(function(){
  'use strict';
  const ownText=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();

  function renameNode(el){
    if(!el)return;
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
    while((n=walker.nextNode())){
      if(String(n.nodeValue||'').trim()==='Учебники'){
        n.nodeValue=String(n.nodeValue).replace('Учебники','Библиотека');
      }
    }
  }

  function apply(){
    document.title='Mathroom';

    /* The sidebar button is canonical. Older versions tried to deduplicate
       Library/Textbooks buttons globally and could accidentally hide it. */
    document.querySelectorAll('.sidebar .nav [data-nav="textbooks"]').forEach(el=>{
      el.style.removeProperty('display');
      delete el.dataset.m2968Hidden;
      renameNode(el);
    });

    document.querySelectorAll('h1,h2,h3,h4').forEach(h=>{
      if(ownText(h)==='Учебники')renameNode(h);
    });

    document.querySelectorAll('button,a,[role="button"]').forEach(el=>{
      if(ownText(el)==='Учебники')renameNode(el);
    });
  }

  let queued=false;
  const schedule=()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{queued=false;apply();});
  };

  const obs=new MutationObserver(schedule);
  function boot(){
    apply();
    obs.observe(document.body,{childList:true,subtree:true,characterData:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();