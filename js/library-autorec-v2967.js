/* Mathroom v29.6.7 — SPA-safe enhancer of the native “Добавить учебник” form. */
(function(){
  'use strict';
  const MARK='2967';
  const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim();
  const lib=()=>window.MathroomLibrary2967;
  const pending=new Map();

  function isAddRoot(root){return !!root&&/Добавить учебник/i.test(text(root))&&!!root.querySelector('input[type="file"]');}
  function rootFrom(el){
    let p=el;
    for(let i=0;p&&i<9;i++,p=p.parentElement){if(isAddRoot(p))return p;}
    return [...document.querySelectorAll('section,article,form,.card,[class*="card"],main > div')].find(isAddRoot)||null;
  }
  function findByLabel(root,label,selector){
    const nodes=[...root.querySelectorAll('label,div,span,p,strong,b')].filter(x=>text(x)===label);
    for(const n of nodes){
      let p=n.parentElement;
      for(let i=0;p&&i<3;i++,p=p.parentElement){const found=p.querySelector(selector);if(found)return found;}
    }
    return null;
  }
  function subjectSelect(root){return [...root.querySelectorAll('select')].find(s=>{const t=[...s.options].map(o=>text(o)).join('|');return /Математика/i.test(t)&&(/Алгебра/i.test(t)||/Геометрия/i.test(t));})||root.querySelector('select');}
  function gradeSelects(root,subject){return [...root.querySelectorAll('select')].filter(s=>s!==subject&&[...s.options].filter(o=>/^(?:[1-9]|1[01])$/.test(String(o.value||text(o)).trim())).length>=8);}
  function controls(root){
    const file=root.querySelector('input[type="file"]');
    const title=findByLabel(root,'Название','input:not([type="file"])')||[...root.querySelectorAll('input:not([type="file"])')].find(i=>/математика.*класс|назван/i.test(i.placeholder||''))||null;
    const authors=findByLabel(root,'Автор','input:not([type="file"])')||[...root.querySelectorAll('input:not([type="file"])')].find(i=>/автор/i.test(i.placeholder||''))||null;
    const subject=findByLabel(root,'Предмет','select')||subjectSelect(root);const grades=gradeSelects(root,subject);
    const gradeFrom=findByLabel(root,'С класса','select')||grades[0]||null;const gradeTo=findByLabel(root,'По класс','select')||grades[1]||null;
    return {file,title,authors,subject,gradeFrom,gradeTo};
  }
  function inputValue(el,val){
    if(!el||val==null||val==='')return;
    const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    try{desc?.set?desc.set.call(el,String(val)):el.value=String(val);}catch{el.value=String(val);}
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function selectValue(el,value,label){
    if(!el||value==null)return;const want=String(label??value).toLowerCase();
    let opt=[...el.options].find(o=>String(o.value)===String(value));if(!opt)opt=[...el.options].find(o=>text(o).toLowerCase()===want||text(o).toLowerCase().includes(want));
    if(!opt)return;el.value=opt.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function ensureExtras(root){
    let wrap=root.querySelector('[data-m2967-extra]');if(wrap)return wrap;
    wrap=document.createElement('div');wrap.dataset.m2967Extra='1';wrap.className='m2967-extra-grid';
    wrap.innerHTML=`
      <label>Уровень<select data-m2967="level"><option value="base">Базовый</option><option value="advanced">Углублённый</option><option value="profile">Профильный</option><option value="mixed">Общий / не указан</option></select></label>
      <label>Тип<select data-m2967="kind"><option value="textbook">Учебник</option><option value="taskbook">Задачник</option><option value="collection">Сборник задач</option><option value="workbook">Рабочая тетрадь</option></select></label>
      <label>Год<input data-m2967="year" inputmode="numeric" placeholder="2025"></label>
      <label>Часть<input data-m2967="part" placeholder="1"></label>
      <label class="m2967-publisher">Издательство<input data-m2967="publisher" placeholder="Просвещение"></label>
    `;
    const hint=[...root.querySelectorAll('p,div')].find(x=>/^PDF хранится/i.test(text(x)));const btn=[...root.querySelectorAll('button')].find(b=>/^Загрузить PDF$/i.test(text(b)));
    const anchor=hint||btn?.parentElement||btn;
    if(anchor?.parentElement)anchor.parentElement.insertBefore(wrap,anchor);else root.appendChild(wrap);
    return wrap;
  }
  function extra(root,name){return ensureExtras(root).querySelector(`[data-m2967="${name}"]`);}
  function status(root,msg,kind='work'){
    let el=root.querySelector('[data-m2967-status]');if(!el){el=document.createElement('div');el.dataset.m2967Status='1';el.className='m2967-status';const wrap=ensureExtras(root);wrap.after(el);}
    el.className=`m2967-status m2967-${kind}`;el.textContent=msg;
  }
  function fill(root,m){
    const c=controls(root);inputValue(c.title,m.title);inputValue(c.authors,m.authors);
    const sl={algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',mathematics:'Математика'}[m.subject];
    selectValue(c.subject,m.subject,sl);selectValue(c.gradeFrom,m.grade_from,String(m.grade_from));selectValue(c.gradeTo,m.grade_to,String(m.grade_to));
    selectValue(extra(root,'level'),m.level,m.level);selectValue(extra(root,'kind'),m.material_kind,m.material_kind);inputValue(extra(root,'year'),m.publication_year);inputValue(extra(root,'part'),m.part_no);inputValue(extra(root,'publisher'),m.publisher);
    root.dataset.m2967Meta=JSON.stringify(m||{});
  }
  function metaFrom(root){
    let m={};try{m=JSON.parse(root.dataset.m2967Meta||'{}')}catch{}
    const c=controls(root);m.title=c.title?.value?.trim()||m.title;m.authors=c.authors?.value?.trim()||m.authors;m.grade_from=Number(c.gradeFrom?.value)||m.grade_from;m.grade_to=Number(c.gradeTo?.value)||m.grade_to;
    if(c.subject){const t=text(c.subject.selectedOptions?.[0]||c.subject).toLowerCase();m.subject=t.includes('геометр')?'geometry':t.includes('начала')&&t.includes('анализ')?'algebra_analysis':t.includes('алгебр')?'algebra':'mathematics';m.subject_title={geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',algebra:'Алгебра',mathematics:'Математика'}[m.subject];}
    m.level=extra(root,'level')?.value||m.level||'mixed';m.material_kind=extra(root,'kind')?.value||m.material_kind||'textbook';m.publication_year=Number(extra(root,'year')?.value)||m.publication_year||null;m.part_no=extra(root,'part')?.value?.trim()||m.part_no||null;m.publisher=extra(root,'publisher')?.value?.trim()||m.publisher||null;return m;
  }
  async function recognize(input){
    const root=rootFrom(input),file=input.files?.[0];if(!root||!file)return;ensureExtras(root);const token=`${Date.now()}-${Math.random()}`;root.dataset.m2967Token=token;status(root,'Распознаём учебник…');
    try{
      const rec=await lib().recognizeFile(file);if(root.dataset.m2967Token!==token)return;fill(root,rec.meta||{});
      const m=rec.meta||{};const bits=[m.subject_title,m.grade_from?`${m.grade_from}${m.grade_to&&m.grade_to!==m.grade_from?'–'+m.grade_to:''} класс`:'',m.level==='advanced'?'углублённый уровень':m.level==='profile'?'профильный уровень':m.level==='base'?'базовый уровень':''].filter(Boolean);
      status(root,`Определено автоматически${bits.length?': '+bits.join(' · '):''}.`,rec.confidence==='low'?'warn':'ok');
    }catch(e){console.error('[Mathroom 29.6.7 recognize]',e);status(root,'Не удалось определить данные автоматически. Загрузка всё равно доступна.','warn');}
  }
  function isUploadButton(el){return el instanceof Element&&/^Загрузить PDF$/i.test(text(el.closest('button')||el));}
  async function queueAfterNative(root,file,key){
    try{status(root,'PDF загружается в библиотеку. После загрузки добавим его в очередь OCR…','work');const row=await lib().queueExistingTextbook(file,metaFrom(root));pending.set(key,'done');status(root,row?.ocr_status==='not_needed'?'Учебник загружен и готов к индексации.':'Учебник загружен. OCR поставлен в очередь на VPS.','ok');}
    catch(e){console.warn('[Mathroom 29.6.7 OCR queue]',e);pending.delete(key);status(root,'Учебник загружается штатно. OCR-очередь не подтверждена: '+String(e?.message||e),'warn');}
  }
  document.addEventListener('change',e=>{const t=e.target;if(t instanceof HTMLInputElement&&t.type==='file'&&t.files?.[0]?.name?.toLowerCase().endsWith('.pdf'))recognize(t);},true);
  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('button');if(!b||!isUploadButton(b))return;const root=rootFrom(b),c=root&&controls(root),file=c?.file?.files?.[0];if(!root||!file)return;
    const key=`${file.name}|${file.size}|${file.lastModified}`;if(pending.has(key))return;pending.set(key,'waiting');setTimeout(()=>queueAfterNative(root,file,key),900);
  },true);
  function scan(){const root=[...document.querySelectorAll('body *')].find(isAddRoot);if(root)ensureExtras(root);}
  let scheduled=false;const obs=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;scan();});});
  function boot(){scan();obs.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
