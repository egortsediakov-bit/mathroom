/* Mathroom v29.6.5 — tiny UI recovery only. No routing/event interception. */
(function(){
  'use strict';
  function replaceTextNode(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node,changed=false;
    while((node=walker.nextNode())){
      if((node.nodeValue||'').trim()==='Учебники'){
        node.nodeValue=node.nodeValue.replace('Учебники','Библиотека');
        changed=true;
      }
    }
    return changed;
  }
  function apply(){
    document.title='Mathroom';
    const scope=document.querySelector('aside,nav,[class*="sidebar"],[class*="rail"],[class*="menu"]')||document.body;
    return replaceTextNode(scope);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
  let attempts=0;
  const timer=setInterval(()=>{attempts++; if(apply()||attempts>20)clearInterval(timer);},250);
})();
