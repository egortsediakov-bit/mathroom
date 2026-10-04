/* Mathroom v29.6.6 — persistent Library label + duplicate old textbook nav cleanup. */
(function(){
  'use strict';
  const ownText=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  function renameNode(el){
    if(!el)return;
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;
    while((n=walker.nextNode())){if(String(n.nodeValue||'').trim()==='Учебники')n.nodeValue=String(n.nodeValue).replace('Учебники','Библиотека');}
  }
  function navRoots(){return [...new Set([...document.querySelectorAll('aside,nav,[class*="sidebar"],[class*="rail"],[class*="menu"]')])];}
  function menuCandidates(){
    const arr=[];
    for(const r of navRoots())for(const el of r.querySelectorAll('a,button,[role="button"],[data-route],[data-view],[data-page]'))if(['Учебники','Библиотека'].includes(ownText(el)))arr.push(el);
    return [...new Set(arr)];
  }
  function activeScore(el){const c=String(el.className||'').toLowerCase();return (el.getAttribute('aria-current')?10:0)+(/active|selected|current/.test(c)?5:0);}
  function apply(){
    document.title='Mathroom';
    const items=menuCandidates();
    for(const el of items)renameNode(el);
    if(items.length>1){
      let keep=items.map((el,i)=>({el,i,s:activeScore(el)})).sort((a,b)=>b.s-a.s||b.i-a.i)[0]?.el||items[items.length-1];
      for(const el of items){
        if(el===keep){if(el.dataset.m2966Hidden==='1'){el.style.removeProperty('display');delete el.dataset.m2966Hidden;}}
        else{el.dataset.m2966Hidden='1';el.style.setProperty('display','none','important');}
      }
    }
    for(const h of document.querySelectorAll('h1,h2,h3,h4'))if(ownText(h)==='Учебники')renameNode(h);
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;apply();});};
  const obs=new MutationObserver(schedule);
  function boot(){apply();obs.observe(document.body,{childList:true,subtree:true,characterData:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
