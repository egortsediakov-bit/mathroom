/* Mathroom v29.6.1 — bridge: one library screen, one upload path.
 * Keeps legacy library cards intact, embeds the new PDF/OCR catalog into the
 * existing "Моя библиотека" screen, and redirects legacy upload buttons to
 * the v29.6.1 uploader.
 */
(function(){
  'use strict';

  const API={version:'29.6.1'};
  let mountedRoot=null;
  let refreshTimer=null;

  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const txt=el=>norm(el?.textContent);

  function lib(){return window.MathroomLibrary2961||window.MathroomLibrary296||null}

  function removeFloatingLaunchers(){
    document.querySelectorAll('[data-mathroom-library-launcher],.mlib-launcher').forEach(el=>el.remove());
  }

  function findLegacyHeading(){
    const nodes=[...document.querySelectorAll('h1,h2,h3,h4,.title,.page-title,.section-title')];
    return nodes.find(el=>/^Моя библиотека(?:\s*[·•]\s*\d+)?/i.test(txt(el)))||null;
  }

  function scoreRoot(el){
    if(!el) return -1;
    const t=txt(el);
    let score=0;
    if(t.includes('Моя библиотека')) score+=10;
    if(/Привязать вручную/i.test(t)) score+=4;
    if(/Открыть/i.test(t)) score+=2;
    if(/Удалить/i.test(t)) score+=1;
    if(el.querySelectorAll('button').length) score+=1;
    return score;
  }

  function findLegacyRoot(heading){
    if(!heading) return null;
    const candidates=[];
    let p=heading.parentElement;
    for(let i=0;p&&i<7;i++,p=p.parentElement) candidates.push(p);
    candidates.sort((a,b)=>scoreRoot(b)-scoreRoot(a));
    return candidates[0]||heading.parentElement;
  }

  function ensureHeaderAction(root,heading){
    let btn=root.querySelector('[data-mathroom-unified-upload]');
    if(btn) return btn;
    btn=document.createElement('button');
    btn.type='button';
    btn.className='muni-upload-btn';
    btn.dataset.mathroomUnifiedUpload='1';
    btn.textContent='+ Добавить PDF';
    btn.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      lib()?.openUpload?.({onSaved:()=>API.refresh()});
    });

    const host=heading.parentElement;
    if(host){
      host.classList.add('muni-heading-row');
      host.appendChild(btn);
    }else heading.insertAdjacentElement('afterend',btn);
    return btn;
  }

  function ensureCatalog(root,heading){
    let box=root.querySelector('[data-mathroom-unified-catalog]');
    if(box) return box;
    box=document.createElement('section');
    box.className='muni-catalog';
    box.dataset.mathroomUnifiedCatalog='1';
    box.innerHTML='<div class="muni-catalog-head"><div><b>Учебники PDF / OCR</b><span>Новые загрузки, OCR и банк задач</span></div><button type="button" class="muni-refresh">Обновить</button></div><div class="muni-catalog-body"><div class="mlib-empty">Загрузка…</div></div>';
    box.querySelector('.muni-refresh').addEventListener('click',()=>API.refresh());

    const anchor=heading.parentElement||heading;
    anchor.insertAdjacentElement('afterend',box);
    return box;
  }

  function setIntegratedCount(root,n){
    const heading=findLegacyHeading(); if(!heading) return;
    let badge=heading.querySelector('.muni-count');
    if(!badge){badge=document.createElement('span');badge.className='muni-count';heading.appendChild(badge)}
    badge.textContent=n?` + ${n} PDF/OCR`:'';
  }

  API.refresh=async function(){
    if(!mountedRoot||!mountedRoot.isConnected) return;
    const box=mountedRoot.querySelector('[data-mathroom-unified-catalog]');
    const body=box?.querySelector('.muni-catalog-body');
    const l=lib();
    if(!body||!l?.renderCatalogInto) return;
    try{
      const books=await l.renderCatalogInto(body);
      setIntegratedCount(mountedRoot,books?.length||0);
    }catch(err){console.warn('[UnifiedLibrary2961] refresh failed',err)}
  };

  API.mount=function(){
    removeFloatingLaunchers();
    const heading=findLegacyHeading();
    if(!heading) return false;
    const root=findLegacyRoot(heading);
    if(!root) return false;
    mountedRoot=root;
    root.dataset.mathroomUnifiedLibrary='1';
    ensureHeaderAction(root,heading);
    ensureCatalog(root,heading);
    API.refresh();
    if(!refreshTimer){
      refreshTimer=setInterval(()=>{
        removeFloatingLaunchers();
        if(mountedRoot?.isConnected) API.refresh();
        else mountedRoot=null;
      },15000);
    }
    return true;
  };

  function isLegacyUploadButton(btn){
    if(!btn||btn.dataset.mathroomUnifiedUpload) return false;
    const label=txt(btn);
    return /(?:добав(?:ить)?\s*(?:pdf|учебник|книг)|загруз(?:ить)?\s*(?:pdf|учебник|книг))/i.test(label);
  }

  document.addEventListener('click',e=>{
    const btn=e.target?.closest?.('button,[role="button"]');
    if(!btn||!mountedRoot?.isConnected||!mountedRoot.contains(btn)) return;
    if(!isLegacyUploadButton(btn)) return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    lib()?.openUpload?.({onSaved:()=>API.refresh()});
  },true);

  window.addEventListener('mathroom:library-updated',()=>API.refresh());

  const obs=new MutationObserver(()=>{
    removeFloatingLaunchers();
    if(!mountedRoot?.isConnected) API.mount();
  });

  function boot(){
    removeFloatingLaunchers();
    API.mount();
    obs.observe(document.documentElement,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();

  window.MathroomUnifiedLibrary2961=API;
})();
