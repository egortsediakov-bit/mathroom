/* Mathroom v29.6.4 — safe enhancer for the EXISTING Add textbook form.
   Does not replace navigation, does not stop existing upload, no polling/catalog mutation loop. */
(function(){
  'use strict';
  const lib=()=>window.MathroomLibrary2964;
  const enhanced=new WeakSet();
  const mirrored=new Set();
  let scheduled=false;
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const text=el=>norm(el?.textContent);

  function toast(msg,kind='ok'){
    let box=document.getElementById('mathroom-auto-pdf-toast-2964');
    if(!box){box=document.createElement('div');box.id='mathroom-auto-pdf-toast-2964';document.body.appendChild(box);}
    box.className=`mauto-toast mauto-${kind}`;box.textContent=msg;box.hidden=false;
    clearTimeout(box._t);box._t=setTimeout(()=>box.hidden=true,4500);
  }
  function exactHeading(){return [...document.querySelectorAll('h1,h2,h3,h4')].find(x=>/^Добавить учебник$/i.test(text(x)))||null;}
  function formRoot(){
    const h=exactHeading();if(!h)return null;let p=h.parentElement;
    for(let i=0;p&&i<7;i++,p=p.parentElement){
      if(p.querySelector('input[type="file"]')&&p.querySelectorAll('input,select').length>=4)return p;
    }
    return null;
  }
  function controls(root){
    const textInputs=[...root.querySelectorAll('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')];
    const sels=[...root.querySelectorAll('select')];
    return {title:textInputs[0]||null,authors:textInputs[1]||null,subject:sels[0]||null,gradeFrom:sels[1]||null,gradeTo:sels[2]||null,file:root.querySelector('input[type="file"]')};
  }
  function setInput(el,val){
    if(!el||val==null||val==='')return;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    try{setter?setter.call(el,String(val)):el.value=String(val);}catch{el.value=String(val);}
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function setSelect(el,value,label){
    if(!el||value==null)return;
    const opts=[...el.options],want=String(label||value).toLowerCase();
    let o=opts.find(x=>String(x.value)===String(value));
    if(!o)o=opts.find(x=>text(x).toLowerCase()===want||text(x).toLowerCase().includes(want));
    if(!o)return;
    el.value=o.value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function fill(root,m){
    const c=controls(root);setInput(c.title,m.title);setInput(c.authors,m.authors);
    const sl={algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',mathematics:'Математика'}[m.subject];
    setSelect(c.subject,m.subject,sl);setSelect(c.gradeFrom,m.grade_from,String(m.grade_from));setSelect(c.gradeTo,m.grade_to,String(m.grade_to));
    root.dataset.mathroomPdfMeta=JSON.stringify(m);
  }
  function status(root,msg,kind='work'){
    let el=root.querySelector('[data-mathroom-autorec-status="2964"]');
    if(!el){
      el=document.createElement('div');el.dataset.mathroomAutorecStatus='2964';el.className='mauto-inline';
      const f=controls(root).file;const parent=f?.closest('div')?.parentElement||f?.parentElement||root;parent.appendChild(el);
    }
    el.className=`mauto-inline mauto-${kind}`;el.textContent=msg;
  }
  async function recognize(root,file){
    if(!file)return;
    const token=String(Date.now())+Math.random();root.dataset.mathroomRecToken=token;status(root,'Распознаём учебник…');
    try{
      const r=await lib().recognizeFile(file);if(root.dataset.mathroomRecToken!==token)return;
      fill(root,r.meta||{});
      if(r.source==='scan'&&r.confidence==='low')status(root,'Скан: основные данные можно поправить вручную. После загрузки OCR продолжится на VPS.','warn');
      else status(root,'Данные учебника заполнены автоматически.','ok');
    }catch(e){console.error('[Mathroom autorec]',e);status(root,'Не удалось прочитать PDF автоматически — можно заполнить поля вручную.','warn');}
  }
  function currentMeta(root){
    let m={};try{m=JSON.parse(root.dataset.mathroomPdfMeta||'{}')}catch{}
    const c=controls(root);
    if(c.title?.value)m.title=c.title.value.trim();if(c.authors?.value)m.authors=c.authors.value.trim();
    if(c.gradeFrom?.value)m.grade_from=Number(c.gradeFrom.value)||m.grade_from;if(c.gradeTo?.value)m.grade_to=Number(c.gradeTo.value)||m.grade_to;
    if(c.subject){
      const t=text(c.subject.selectedOptions?.[0]||c.subject).toLowerCase();
      m.subject=t.includes('геометр')?'geometry':t.includes('начала')&&t.includes('анализ')?'algebra_analysis':t.includes('алгебр')?'algebra':'mathematics';
      m.subject_title={geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа',algebra:'Алгебра',mathematics:'Математика'}[m.subject];
    }
    return m;
  }
  function uploadButton(root){return [...root.querySelectorAll('button')].find(b=>/^Загрузить PDF$/i.test(text(b)))||null;}
  function enhance(root){
    if(!root||enhanced.has(root))return;
    enhanced.add(root);
    const c=controls(root);
    if(c.file)c.file.addEventListener('change',()=>recognize(root,c.file.files?.[0]));
    const btn=uploadButton(root);
    if(btn)btn.addEventListener('click',()=>{
      const file=c.file?.files?.[0];if(!file)return;
      const key=`${file.name}:${file.size}:${file.lastModified}`;if(mirrored.has(key))return;mirrored.add(key);
      const meta=currentMeta(root);
      setTimeout(async()=>{
        try{await lib().mirrorForOcr(file,meta);toast('PDF добавлен в OCR/банк задач','ok');}
        catch(e){console.error('[Mathroom OCR mirror]',e);mirrored.delete(key);toast('Основная загрузка работает, но OCR не запустился: '+(e?.message||e),'warn');}
      },0);
    },false);
  }
  function scan(){scheduled=false;const root=formRoot();if(root)enhance(root);}
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(scan,120);}
  const obs=new MutationObserver(schedule);
  function boot(){scan();obs.observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();