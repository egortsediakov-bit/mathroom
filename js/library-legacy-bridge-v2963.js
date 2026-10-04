/* v29.6.3: enhance the EXISTING "Добавить учебник" form; no second uploader. */
(function(){
  'use strict';
  const API={version:'29.6.3'};
  const state=new WeakMap();
  let catalog=null,libraryRoot=null;
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const txt=el=>norm(el?.textContent);
  const lib=()=>window.MathroomLibrary2963;

  function headingExact(name){return [...document.querySelectorAll('h1,h2,h3,h4,.title,.page-title,.section-title')].find(el=>txt(el).toLowerCase()===name.toLowerCase())||null;}
  function rootForHeading(h){
    if(!h) return null; let p=h.parentElement,best=null;
    for(let i=0;p&&i<9;i++,p=p.parentElement){if(p.querySelector('input[type="file"]')) best=p; if(p.querySelectorAll('input,select,button').length>=5) best=p;}
    return best||h.parentElement;
  }
  function addForm(){const h=headingExact('Добавить учебник');return h?rootForHeading(h):null;}
  function findByLabel(root,names){
    const ns=names.map(x=>x.toLowerCase());
    for(const label of root.querySelectorAll('label')){
      const t=txt(label).toLowerCase();
      if(ns.some(n=>t===n||t.startsWith(n+' '))){const c=label.querySelector('input,select,textarea')||label.parentElement?.querySelector('input,select,textarea');if(c)return c;}
    }
    const controls=[...root.querySelectorAll('input,select,textarea')];
    for(const c of controls){
      const ph=(c.getAttribute('placeholder')||'').toLowerCase(); const aria=(c.getAttribute('aria-label')||'').toLowerCase();
      if(ns.some(n=>ph.includes(n)||aria.includes(n))) return c;
    }
    return null;
  }
  function fileInput(root){return root.querySelector('input[type="file"]');}
  function uploadButton(root){return [...root.querySelectorAll('button,[role="button"]')].find(b=>/^загрузить\s+pdf$/i.test(txt(b)))||null;}
  function setSelectByText(sel,label,value){
    if(!sel)return; const want=String(label||'').toLowerCase();
    let opt=[...sel.options].find(o=>String(o.value)===String(value));
    if(!opt&&want) opt=[...sel.options].find(o=>txt(o).toLowerCase().includes(want));
    if(opt){sel.value=opt.value;sel.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function fieldMap(root){
    const inputs=[...root.querySelectorAll('input:not([type="file"]),select')];
    return {
      title:findByLabel(root,['Название'])||inputs.find(x=>(x.placeholder||'').includes('Математика')),
      authors:findByLabel(root,['Автор','Авторы'])||inputs.find(x=>(x.placeholder||'').toLowerCase().includes('автор')),
      subject:findByLabel(root,['Предмет']),
      grade_from:findByLabel(root,['С класса','Класс от']),
      grade_to:findByLabel(root,['По класс','Класс до'])
    };
  }
  function ensureStatus(root){
    let box=root.querySelector('[data-auto-recognition-2963]');
    if(box)return box;
    box=document.createElement('div');box.dataset.autoRecognition2963='1';box.className='mauto-status';box.innerHTML='<b>Автораспознавание PDF</b><span>Выберите файл — Mathroom заполнит данные сам.</span>';
    const btn=uploadButton(root); if(btn?.parentElement) btn.parentElement.insertBefore(box,btn); else root.appendChild(box);
    return box;
  }
  function status(root,text,kind='work'){
    const b=ensureStatus(root);b.className=`mauto-status ${kind}`;b.innerHTML=`<b>${kind==='ok'?'Распознано автоматически':kind==='error'?'Не удалось распознать':'Анализируем PDF'}</b><span>${text}</span>`;
  }
  function fill(root,meta){
    const f=fieldMap(root);
    if(f.title&&meta.title){f.title.value=meta.title;f.title.dispatchEvent(new Event('input',{bubbles:true}));}
    if(f.authors&&meta.authors){f.authors.value=meta.authors;f.authors.dispatchEvent(new Event('input',{bubbles:true}));}
    if(f.subject&&meta.subject){const label={algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',mathematics:'Математика'}[meta.subject];setSelectByText(f.subject,label,meta.subject);}
    if(f.grade_from&&meta.grade_from)setSelectByText(f.grade_from,String(meta.grade_from),meta.grade_from);
    if(f.grade_to&&meta.grade_to)setSelectByText(f.grade_to,String(meta.grade_to),meta.grade_to);
  }
  function summary(meta){
    const parts=[];
    if(meta.subject_title)parts.push(meta.subject_title);
    if(meta.grade_from)parts.push(meta.grade_from===meta.grade_to?`${meta.grade_from} класс`:`${meta.grade_from}–${meta.grade_to} классы`);
    if(meta.level)parts.push(({base:'базовый',advanced:'углублённый',profile:'профильный',mixed:'общий'}[meta.level]||meta.level));
    if(meta.publication_year)parts.push(String(meta.publication_year));
    if(meta.publisher)parts.push(meta.publisher);
    return parts.join(' · ')+(meta.authors?` · ${meta.authors}`:'');
  }

  async function analyze(root,file){
    if(!file)return;
    const s=state.get(root)||{}; const token={};s.token=token;s.file=file;state.set(root,s);
    status(root,'читаем титульные страницы и метаданные…','work');
    try{
      const r=await lib().recognizeFile(file); if((state.get(root)||{}).token!==token)return;
      s.recognition=r;s.meta=r.meta||{};fill(root,s.meta);
      if(r.source==='scan'&&r.confidence==='low') status(root,'Это скан без текстового слоя. Заполни недостающие поля вручную; после загрузки VPS OCR обработает книгу.','warn');
      else status(root,summary(s.meta)||'Данные найдены.','ok');
    }catch(err){console.error(err);status(root,err.message||String(err),'error');}
  }
  function metaFromForm(root){
    const s=state.get(root)||{}, f=fieldMap(root), m={...(s.meta||{})};
    if(f.title?.value.trim())m.title=f.title.value.trim();
    if(f.authors?.value.trim())m.authors=f.authors.value.trim();
    if(f.grade_from?.value)m.grade_from=Number(f.grade_from.value)||m.grade_from;
    if(f.grade_to?.value)m.grade_to=Number(f.grade_to.value)||m.grade_to;
    if(f.subject){const t=txt(f.subject.selectedOptions?.[0]||f.subject).toLowerCase();m.subject=t.includes('геометр')?'geometry':t.includes('начала')&&t.includes('анализ')?'algebra_analysis':t.includes('алгебр')?'algebra':'mathematics';m.subject_title={geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',algebra:'Алгебра',mathematics:'Математика'}[m.subject];}
    return m;
  }
  async function submit(root){
    const s=state.get(root)||{}, file=s.file||fileInput(root)?.files?.[0]; if(!file){status(root,'Сначала выберите PDF.','error');return;}
    const btn=uploadButton(root); if(btn){btn.disabled=true;btn.dataset.oldText=txt(btn);btn.textContent='Загружаем…';}
    const meta=metaFromForm(root);
    try{
      const book=await lib().uploadAndRegister(file,meta,p=>{
        const pct=Math.max(0,Math.min(100,p.percent||0));
        const label=p.phase==='recognize'?'распознаём книгу':p.phase==='analyze'?'проверяем PDF':p.phase==='upload'?'загружаем PDF':p.phase==='register'?'регистрируем в библиотеке':'готово';
        status(root,`${label} · ${pct}%`,'work');
      });
      status(root,book.text_layer_status==='text'?'Учебник загружен. Текстовый слой найден — задачи можно индексировать.':'Учебник загружен. Скан автоматически отправлен в OCR-очередь.','ok');
      if(btn){btn.textContent='Загружено ✓';}
      window.dispatchEvent(new CustomEvent('mathroom:library-updated',{detail:{book}}));
      setTimeout(()=>{if(btn){btn.disabled=false;btn.textContent=btn.dataset.oldText||'Загрузить PDF';}},2500);
    }catch(err){console.error(err);status(root,err.message||String(err),'error');if(btn){btn.disabled=false;btn.textContent=btn.dataset.oldText||'Загрузить PDF';}}
  }

  function enhance(){
    const root=addForm(); if(!root)return false;
    if(root.dataset.autoRecognition2963==='1')return true;
    root.dataset.autoRecognition2963='1';ensureStatus(root);
    const fi=fileInput(root); if(fi){fi.addEventListener('change',()=>analyze(root,fi.files?.[0]));if(fi.files?.[0])analyze(root,fi.files[0]);}
    return true;
  }

  // Replace ONLY the old form's submit action. The old form remains the single upload UI.
  document.addEventListener('click',e=>{
    const root=addForm();if(!root)return;const btn=e.target?.closest?.('button,[role="button"]');if(!btn||btn!==uploadButton(root))return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();submit(root);
  },true);

  function findLibraryHeading(){return [...document.querySelectorAll('h1,h2,h3,h4,.title,.page-title,.section-title')].find(el=>/^Моя библиотека(?:\s*[·•]\s*\d+)?/i.test(txt(el)))||null;}
  function libraryContainer(h){if(!h)return null;let p=h.parentElement,best=null;for(let i=0;p&&i<8;i++,p=p.parentElement){if(/Привязать вручную/i.test(txt(p)))best=p;}return best||h.parentElement;}
  async function refreshCatalog(){
    const h=findLibraryHeading();if(!h)return;const root=libraryContainer(h);if(!root)return;libraryRoot=root;
    if(!catalog?.isConnected){catalog=document.createElement('section');catalog.className='muni-catalog muni-catalog-v2963';catalog.innerHTML='<div class="muni-catalog-head"><div><b>Новые PDF / OCR</b><span>Учебники, загруженные через обновлённую форму</span></div><button type="button" class="muni-refresh">Обновить</button></div><div class="muni-catalog-body"></div>';catalog.querySelector('.muni-refresh').onclick=refreshCatalog;root.appendChild(catalog);}
    await lib()?.renderCatalogInto?.(catalog.querySelector('.muni-catalog-body'));
  }
  window.addEventListener('mathroom:library-updated',refreshCatalog);

  const obs=new MutationObserver(()=>{enhance();refreshCatalog();});
  function boot(){enhance();refreshCatalog();obs.observe(document.documentElement,{childList:true,subtree:true});setInterval(()=>{enhance();refreshCatalog();},2500);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  API.enhance=enhance;API.refreshCatalog=refreshCatalog;window.MathroomLegacyBridge2963=API;
})();
