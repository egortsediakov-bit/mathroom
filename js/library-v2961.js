/* Mathroom v29.6.1 — unified legacy library + upload metadata + OCR queue.
 * Additive module. It does not replace the existing board/PDF viewer.
 */
(function(){
  'use strict';
  const API={version:'29.6.1'};
  let sb=null;
  let options={bucket:'mathroom-books',presetUrl:'./data/book-presets-v296.json',maxBytes:50*1024*1024};
  let presets=null;
  let uploadAdapter=null;

  const LEVEL_LABEL={base:'Базовый',advanced:'Углублённый',profile:'Профильный',mixed:'Общий',other:'Другой'};
  const KIND_LABEL={textbook:'Учебник',taskbook:'Задачник',workbook:'Рабочая тетрадь',collection:'Сборник',reference:'Справочник',other:'Другое'};
  const SUBJECT_LABEL={mathematics:'Математика',algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа'};

  function resolveClient(){
    if(sb) return sb;
    const candidates=[window.supabaseClient,window.sb,window._supabase,window.appSupabase,window.Mathroom?.supabase];
    sb=candidates.find(x=>x&&typeof x.from==='function')||null;
    return sb;
  }
  API.setClient=c=>{sb=c;return API};
  API.setOptions=o=>{options={...options,...(o||{})};return API};
  API.setUploadAdapter=fn=>{uploadAdapter=typeof fn==='function'?fn:null;return API};

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug=s=>String(s||'book').toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,90)||'book';
  const gradeLabel=b=>!b.grade_from?'—':(b.grade_from===b.grade_to?`${b.grade_from} класс`:`${b.grade_from}–${b.grade_to} классы`);
  const toast=(text,ms=3200)=>{const d=document.createElement('div');d.className='mlib-toast';d.textContent=text;document.body.appendChild(d);setTimeout(()=>d.remove(),ms)};

  async function loadPresets(){
    if(presets) return presets;
    try{
      const r=await fetch(options.presetUrl,{cache:'no-store'});
      if(!r.ok) throw new Error(String(r.status));
      const j=await r.json(); presets=j.books||[];
    }catch(e){console.warn('[MathroomLibrary296] presets unavailable',e);presets=[];}
    return presets;
  }
  API.loadPresets=loadPresets;
  API.matchPreset=async filename=>{
    const name=String(filename||'').toLowerCase();
    const ps=await loadPresets();
    return ps.find(p=>(p.filename_patterns||[]).some(x=>name===String(x).toLowerCase()||name.includes(String(x).toLowerCase())))||null;
  };

  async function sha256Blob(file){
    const data=await file.arrayBuffer();
    const hash=await crypto.subtle.digest('SHA-256',data);
    return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }

  async function pdfFromInput(input){
    if(!window.pdfjsLib) throw new Error('pdfjsLib не загружен');
    if(input instanceof File || input instanceof Blob){
      const buf=await input.arrayBuffer();
      return window.pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
    }
    return window.pdfjsLib.getDocument({url:String(input),withCredentials:false}).promise;
  }

  API.detectTextLayer=async function(input){
    const pdf=await pdfFromInput(input);
    const n=pdf.numPages;
    const sample=[1,Math.max(1,Math.round(n*.25)),Math.max(1,Math.round(n*.5)),Math.max(1,Math.round(n*.75)),n].filter((v,i,a)=>a.indexOf(v)===i);
    let textPages=0,scanPages=0,totalChars=0;
    for(const pno of sample){
      const page=await pdf.getPage(pno);
      const tc=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
      const chars=(tc.items||[]).reduce((s,x)=>s+String(x.str||'').trim().length,0);
      totalChars+=chars;
      if(chars>=60) textPages++; else scanPages++;
    }
    let status='mixed';
    if(textPages===sample.length) status='text';
    else if(scanPages===sample.length) status='scan';
    return {status,page_count:n,sample_pages:sample,text_pages:textPages,scan_pages:scanPages,avg_chars:Math.round(totalChars/sample.length)};
  };

  function normalizedMeta(meta){
    const m={...(meta||{})};
    const gf=Number(m.grade_from||m.grade||0)||null;
    const gt=Number(m.grade_to||gf||0)||null;
    return {
      external_key:m.external_key||slug([m.subject||'math',gf||'',gt&&gt!==gf?gt:'',m.level||'',m.authors||'',m.publication_year||'',m.part_no||''].join('-')),
      title:m.title||m.filename||'Учебник',
      grade:gf&&gt===gf?gf:null,
      grade_from:gf,grade_to:gt,
      subject:m.subject||'mathematics',
      subject_title:m.subject_title||SUBJECT_LABEL[m.subject]||'Математика',
      level:m.level||'mixed',material_kind:m.material_kind||'textbook',authors:m.authors||null,
      publication_year:Number(m.publication_year||0)||null,part_no:m.part_no||null,publisher:m.publisher||null,edition:m.edition||null,
      source_kind:'pdf',filename:m.filename||null,file_size_bytes:Number(m.file_size_bytes||0)||null,
      content_fingerprint:m.content_fingerprint||null,text_layer_status:m.text_layer_status||'unknown',ocr_status:m.ocr_status||'unknown',
      storage_bucket:m.storage_bucket||null,storage_path:m.storage_path||null,pdf_url:m.pdf_url||null,page_count:Number(m.page_count||0)||null,
      meta:m.meta||{},is_active:m.is_active!==false
    };
  }

  API.registerBook=async function(meta){
    const client=resolveClient(); if(!client) throw new Error('Supabase client not found');
    const row=normalizedMeta(meta);
    if(row.text_layer_status==='text') row.ocr_status='not_needed';
    else if(['scan','mixed'].includes(row.text_layer_status)&&['unknown','not_needed'].includes(row.ocr_status)) row.ocr_status='pending';
    const {data,error}=await client.from('task_bank_sources').upsert(row,{onConflict:'external_key'}).select().single();
    if(error) throw error; return data;
  };

  API.getPdfUrl=async function(book,expiresIn=3600){
    if(book.pdf_url) return book.pdf_url;
    if(!book.storage_bucket||!book.storage_path) throw new Error('У книги нет файла');
    const client=resolveClient();
    const {data,error}=await client.storage.from(book.storage_bucket).createSignedUrl(book.storage_path,expiresIn);
    if(error) throw error; return data.signedUrl;
  };

  async function defaultUpload(file,meta,onProgress){
    const client=resolveClient();
    const bucket=meta.storage_bucket||options.bucket;
    const path=`books/${slug(meta.external_key||file.name)}/${Date.now()}-${slug(file.name)}`;
    onProgress?.({phase:'upload',percent:5});
    const {error}=await client.storage.from(bucket).upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
    if(error) throw error;
    onProgress?.({phase:'upload',percent:100});
    return {bucket,path};
  }

  API.uploadAndRegister=async function(file,meta={},onProgress){
    if(!(file instanceof File)) throw new Error('Выберите PDF');
    if(file.type && file.type!=='application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('Нужен PDF-файл');
    if(file.size>options.maxBytes) throw new Error('Файл больше 50 МБ. Сначала сожмите PDF.');
    const preset=await API.matchPreset(file.name);
    const merged={...(preset||{}),...(meta||{}),filename:file.name,file_size_bytes:file.size};
    onProgress?.({phase:'analyze',percent:0});
    const [layer,fingerprint]=await Promise.all([API.detectTextLayer(file),sha256Blob(file)]);
    onProgress?.({phase:'analyze',percent:100});
    merged.page_count=layer.page_count; merged.text_layer_status=layer.status; merged.content_fingerprint=fingerprint;
    merged.ocr_status=layer.status==='text'?'not_needed':'pending';
    merged.external_key=merged.external_key||slug(`${file.name}-${fingerprint.slice(0,10)}`);
    const uploader=uploadAdapter||defaultUpload;
    const loc=await uploader(file,merged,onProgress);
    merged.storage_bucket=loc.bucket||loc.storage_bucket||options.bucket;
    merged.storage_path=loc.path||loc.storage_path;
    if(loc.pdf_url) merged.pdf_url=loc.pdf_url;
    return API.registerBook(merged);
  };

  API.listBooks=async function(filters={}){
    const client=resolveClient(); if(!client) throw new Error('Supabase client not found');
    let q=client.from('task_bank_source_catalog').select('*');
    if(!filters.includeInactive) q=q.eq('is_active',true);
    if(filters.subject) q=q.eq('subject',filters.subject);
    if(filters.level) q=q.eq('level',filters.level);
    if(filters.material_kind) q=q.eq('material_kind',filters.material_kind);
    if(filters.grade) q=q.lte('grade_from',filters.grade).gte('grade_to',filters.grade);
    if(filters.search){const s=String(filters.search).replace(/[%_,()]/g,' ').trim(); if(s) q=q.or(`title.ilike.%${s}%,authors.ilike.%${s}%`);}
    q=q.order('grade_from',{ascending:true}).order('subject',{ascending:true}).order('level',{ascending:true}).order('publication_year',{ascending:false});
    const {data,error}=await q; if(error) throw error; return data||[];
  };

  API.requestOcr=async function(id){
    const client=resolveClient();
    const {data,error}=await client.rpc('task_bank_request_ocr',{p_source_id:id});
    if(error) throw error; return data;
  };

  API.syncTasks=async function(book,topicMap=[]){
    if(book.text_layer_status!=='text'){
      if(book.ocr_status!=='done') return {needs_ocr:true,book};
      return {already_indexed_by_worker:true,book};
    }
    if(!window.MathroomTaskBank?.scanPdf) throw new Error('Подключите task-bank-v295.js');
    const url=await API.getPdfUrl(book,7200);
    return window.MathroomTaskBank.scanPdf({
      external_key:book.external_key,title:book.title,grade:book.grade_from===book.grade_to?book.grade_from:null,url,
      meta:{book_id:book.id,level:book.level,material_kind:book.material_kind},topicMap
    });
  };

  function tag(text,cls=''){return `<span class="mlib-tag ${cls}">${esc(text)}</span>`}
  function cardHtml(b){
    const layer=b.text_layer_status==='text'?tag('Текстовый PDF','text'):b.text_layer_status==='scan'?tag('Скан · OCR','scan'):tag('Смешанный · OCR','scan');
    const ocr=b.ocr_status==='pending'?tag('OCR в очереди','pending'):b.ocr_status==='processing'?tag(`OCR ${b.ocr_pages_done||0}/${b.ocr_pages_total||'…'}`,'pending'):b.ocr_status==='done'?tag('OCR готов','text'):'';
    return `<article class="mlib-card" data-book="${esc(b.id)}"><div class="mlib-title">${esc(b.title)}</div><div class="mlib-tags">${tag(gradeLabel(b))}${tag(LEVEL_LABEL[b.level]||b.level)}${tag(KIND_LABEL[b.material_kind]||b.material_kind)}${layer}${ocr}</div><div class="mlib-meta">${esc([b.authors,b.publication_year,b.publisher].filter(Boolean).join(' · '))}</div><div class="mlib-meta">Задач: <b>${b.task_count||0}</b>${b.review_count?` · проверить: <b>${b.review_count}</b>`:''}</div><div class="mlib-card-actions"><button class="mlib-btn" data-act="open">Открыть</button><button class="mlib-btn" data-act="sync">Синхронизировать задачи</button>${['scan','mixed'].includes(b.text_layer_status)&&b.ocr_status!=='done'?'<button class="mlib-btn orange" data-act="ocr">OCR</button>':''}</div></article>`;
  }

  function uploadFormHtml(meta={}){
    const g=meta.grade_from||''; const gt=meta.grade_to||g||'';
    return `<div class="mlib-form"><label class="wide mlib-filebox">PDF<input id="mlib-file" type="file" accept="application/pdf,.pdf"></label><label class="wide">Название<input id="mlib-title" value="${esc(meta.title||'')}"></label><label>Предмет<select id="mlib-subject"><option value="algebra">Алгебра</option><option value="geometry">Геометрия</option><option value="algebra_analysis">Алгебра и начала анализа</option><option value="mathematics">Математика</option></select></label><label>Уровень<select id="mlib-level"><option value="base">Базовый</option><option value="advanced">Углублённый</option><option value="profile">Профильный</option><option value="mixed">Общий</option></select></label><label>Класс от<input id="mlib-gf" type="number" min="1" max="11" value="${esc(g)}"></label><label>Класс до<input id="mlib-gt" type="number" min="1" max="11" value="${esc(gt)}"></label><label>Тип<select id="mlib-kind"><option value="textbook">Учебник</option><option value="taskbook">Задачник</option><option value="collection">Сборник</option><option value="workbook">Рабочая тетрадь</option></select></label><label>Год<input id="mlib-year" type="number" min="1900" max="2100" value="${esc(meta.publication_year||'')}"></label><label class="wide">Авторы<input id="mlib-authors" value="${esc(meta.authors||'')}"></label><label>Часть<input id="mlib-part" value="${esc(meta.part_no||'')}"></label><label>Издательство<input id="mlib-publisher" value="${esc(meta.publisher||'')}"></label><div class="wide"><div class="mlib-progress"><i id="mlib-progressbar"></i></div><div class="mlib-note" id="mlib-progressnote">До 50 МБ. Для сканов после загрузки автоматически создаётся OCR-задача.</div></div></div>`;
  }

  function selectValue(id,v){const el=document.getElementById(id);if(el&&v!=null)el.value=String(v)}
  async function fillFromPreset(file){
    const p=await API.matchPreset(file?.name); if(!p) return;
    document.getElementById('mlib-title').value=p.title||''; selectValue('mlib-subject',p.subject); selectValue('mlib-level',p.level); selectValue('mlib-gf',p.grade_from); selectValue('mlib-gt',p.grade_to); selectValue('mlib-kind',p.material_kind); selectValue('mlib-year',p.publication_year); document.getElementById('mlib-authors').value=p.authors||''; document.getElementById('mlib-part').value=p.part_no||''; document.getElementById('mlib-publisher').value=p.publisher||'';
  }

  API.open=async function(){
    document.querySelector('.mlib-overlay')?.remove();
    const ov=document.createElement('div'); ov.className='mlib-overlay';
    ov.innerHTML=`<section class="mlib-modal"><header class="mlib-head"><h2>Библиотека учебников</h2><span class="spacer"></span><button class="mlib-btn primary" data-top="add">+ Добавить PDF</button><button class="mlib-btn" data-top="close">Закрыть</button></header><div class="mlib-body"><div class="mlib-toolbar"><select id="mlib-f-grade"><option value="">Все классы</option>${Array.from({length:11},(_,i)=>`<option value="${i+1}">${i+1} класс</option>`).join('')}</select><select id="mlib-f-subject"><option value="">Все предметы</option><option value="algebra">Алгебра</option><option value="geometry">Геометрия</option><option value="algebra_analysis">Алгебра и начала анализа</option><option value="mathematics">Математика</option></select><select id="mlib-f-level"><option value="">Все уровни</option><option value="base">Базовый</option><option value="advanced">Углублённый</option><option value="profile">Профильный</option><option value="mixed">Общий</option></select><select id="mlib-f-kind"><option value="">Все типы</option><option value="textbook">Учебники</option><option value="taskbook">Задачники</option></select><input id="mlib-f-search" placeholder="Поиск по названию или автору"><button class="mlib-btn" data-top="refresh">Обновить</button></div><div id="mlib-content"><div class="mlib-empty">Загрузка…</div></div></div></section>`;
    document.body.appendChild(ov);
    const content=ov.querySelector('#mlib-content');
    const refresh=async()=>{try{const filters={grade:Number(ov.querySelector('#mlib-f-grade').value)||null,subject:ov.querySelector('#mlib-f-subject').value||null,level:ov.querySelector('#mlib-f-level').value||null,material_kind:ov.querySelector('#mlib-f-kind').value||null,search:ov.querySelector('#mlib-f-search').value||null};const books=await API.listBooks(filters);content.innerHTML=books.length?`<div class="mlib-grid">${books.map(cardHtml).join('')}</div>`:'<div class="mlib-empty">Книг пока нет.</div>';content.querySelectorAll('[data-book]').forEach(card=>{const book=books.find(x=>x.id===card.dataset.book);card.addEventListener('click',async e=>{const act=e.target?.dataset?.act;if(!act)return;try{if(act==='open'){const url=await API.getPdfUrl(book,3600); if(typeof window.MathroomOpenPdf==='function')window.MathroomOpenPdf(url,book);else window.open(url,'_blank','noopener');}if(act==='ocr'){await API.requestOcr(book.id);toast('OCR добавлен в очередь');refresh();}if(act==='sync'){const r=await API.syncTasks(book,[]);if(r.needs_ocr){await API.requestOcr(book.id);toast('Это скан. OCR добавлен в очередь.');}else if(r.already_indexed_by_worker)toast('OCR уже обработал эту книгу.');else toast(`Синхронизация завершена: ${r.added||0} новых задач`);refresh();}}catch(err){console.error(err);toast(err.message||String(err),5000)}})});}catch(err){content.innerHTML=`<div class="mlib-empty mlib-danger">${esc(err.message||err)}</div>`;}};
    ov.querySelector('[data-top="close"]').onclick=()=>ov.remove(); ov.addEventListener('click',e=>{if(e.target===ov)ov.remove()});
    ov.querySelector('[data-top="refresh"]').onclick=refresh; ['#mlib-f-grade','#mlib-f-subject','#mlib-f-level','#mlib-f-kind'].forEach(s=>ov.querySelector(s).addEventListener('change',refresh)); let timer; ov.querySelector('#mlib-f-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(refresh,300)});
    ov.querySelector('[data-top="add"]').onclick=()=>{
      content.innerHTML=`${uploadFormHtml()}<div style="display:flex;gap:8px;margin-top:14px"><button class="mlib-btn primary" id="mlib-upload">Загрузить и зарегистрировать</button><button class="mlib-btn" id="mlib-cancel">Отмена</button></div>`;
      const fileInput=document.getElementById('mlib-file'); fileInput.onchange=()=>fillFromPreset(fileInput.files?.[0]);
      document.getElementById('mlib-cancel').onclick=refresh;
      document.getElementById('mlib-upload').onclick=async()=>{const file=fileInput.files?.[0];if(!file){toast('Выберите PDF');return;}const meta={title:document.getElementById('mlib-title').value,subject:document.getElementById('mlib-subject').value,subject_title:SUBJECT_LABEL[document.getElementById('mlib-subject').value],level:document.getElementById('mlib-level').value,grade_from:Number(document.getElementById('mlib-gf').value)||null,grade_to:Number(document.getElementById('mlib-gt').value)||null,material_kind:document.getElementById('mlib-kind').value,publication_year:Number(document.getElementById('mlib-year').value)||null,authors:document.getElementById('mlib-authors').value,part_no:document.getElementById('mlib-part').value,publisher:document.getElementById('mlib-publisher').value};const bar=document.getElementById('mlib-progressbar'),note=document.getElementById('mlib-progressnote');try{const book=await API.uploadAndRegister(file,meta,s=>{bar.style.width=`${s.percent||0}%`;note.textContent=s.phase==='analyze'?'Анализируем PDF…':'Загружаем PDF…'});toast(book.text_layer_status==='text'?'PDF добавлен. Можно синхронизировать задачи.':'PDF добавлен. OCR поставлен в очередь.');refresh();}catch(err){console.error(err);toast(err.message||String(err),6000)}};
    };
    await refresh();
  };

  API.renderCatalogInto=async function(container,opts={}){
    if(!container) throw new Error('Не найден контейнер библиотеки');
    const filters=opts.filters||{};
    container.innerHTML='<div class="mlib-empty">Проверяем новые PDF…</div>';
    try{
      const books=await API.listBooks(filters);
      if(!books.length){
        container.innerHTML='<div class="mlib-empty mlib-empty-compact">Новых PDF в OCR-каталоге пока нет. Старые учебники остаются ниже без изменений.</div>';
        return books;
      }
      container.innerHTML=`<div class="mlib-unified-caption"><b>PDF / OCR</b><span>${books.length}</span></div><div class="mlib-grid mlib-grid-embedded">${books.map(cardHtml).join('')}</div>`;
      container.querySelectorAll('[data-book]').forEach(card=>{
        const book=books.find(x=>x.id===card.dataset.book);
        card.addEventListener('click',async e=>{
          const act=e.target?.dataset?.act;if(!act)return;
          try{
            if(act==='open'){
              const url=await API.getPdfUrl(book,3600);
              if(typeof window.MathroomOpenPdf==='function') window.MathroomOpenPdf(url,book);
              else window.open(url,'_blank','noopener');
            }
            if(act==='ocr'){
              await API.requestOcr(book.id); toast('OCR добавлен в очередь');
              await API.renderCatalogInto(container,opts);
            }
            if(act==='sync'){
              const r=await API.syncTasks(book,[]);
              if(r.needs_ocr){await API.requestOcr(book.id);toast('Это скан. OCR добавлен в очередь.');}
              else if(r.already_indexed_by_worker) toast('OCR уже обработал эту книгу.');
              else toast(`Синхронизация завершена: ${r.added||0} новых задач`);
              await API.renderCatalogInto(container,opts);
            }
          }catch(err){console.error(err);toast(err.message||String(err),5000)}
        });
      });
      return books;
    }catch(err){
      container.innerHTML=`<div class="mlib-empty mlib-danger">${esc(err.message||err)}</div>`;
      throw err;
    }
  };

  API.openUpload=function(opts={}){
    document.querySelector('.mlib-upload-overlay')?.remove();
    const ov=document.createElement('div');
    ov.className='mlib-overlay mlib-upload-overlay';
    ov.innerHTML=`<section class="mlib-modal mlib-upload-modal"><header class="mlib-head"><h2>Добавить PDF</h2><span class="spacer"></span><button class="mlib-btn" data-up="close">Закрыть</button></header><div class="mlib-body"><div id="mlib-upload-content">${uploadFormHtml()}<div style="display:flex;gap:8px;margin-top:14px"><button class="mlib-btn primary" id="mlib-upload">Загрузить и зарегистрировать</button><button class="mlib-btn" id="mlib-cancel">Отмена</button></div></div></div></section>`;
    document.body.appendChild(ov);
    const close=()=>ov.remove();
    ov.querySelector('[data-up="close"]').onclick=close;
    ov.querySelector('#mlib-cancel').onclick=close;
    ov.addEventListener('click',e=>{if(e.target===ov)close()});
    const fileInput=ov.querySelector('#mlib-file');
    fileInput.onchange=()=>fillFromPreset(fileInput.files?.[0]);
    ov.querySelector('#mlib-upload').onclick=async()=>{
      const file=fileInput.files?.[0]; if(!file){toast('Выберите PDF');return;}
      const meta={
        title:ov.querySelector('#mlib-title').value,
        subject:ov.querySelector('#mlib-subject').value,
        subject_title:SUBJECT_LABEL[ov.querySelector('#mlib-subject').value],
        level:ov.querySelector('#mlib-level').value,
        grade_from:Number(ov.querySelector('#mlib-gf').value)||null,
        grade_to:Number(ov.querySelector('#mlib-gt').value)||null,
        material_kind:ov.querySelector('#mlib-kind').value,
        publication_year:Number(ov.querySelector('#mlib-year').value)||null,
        authors:ov.querySelector('#mlib-authors').value,
        part_no:ov.querySelector('#mlib-part').value,
        publisher:ov.querySelector('#mlib-publisher').value
      };
      const bar=ov.querySelector('#mlib-progressbar'),note=ov.querySelector('#mlib-progressnote'),btn=ov.querySelector('#mlib-upload');
      btn.disabled=true;
      try{
        const book=await API.uploadAndRegister(file,meta,s=>{
          bar.style.width=`${s.percent||0}%`;
          note.textContent=s.phase==='analyze'?'Анализируем PDF…':'Загружаем PDF…';
        });
        toast(book.text_layer_status==='text'?'PDF добавлен. Можно синхронизировать задачи.':'PDF добавлен. OCR поставлен в очередь.');
        window.dispatchEvent(new CustomEvent('mathroom:library-updated',{detail:{book}}));
        close();
        if(typeof opts.onSaved==='function') await opts.onSaved(book);
      }catch(err){console.error(err);toast(err.message||String(err),6000);btn.disabled=false;}
    };
    return ov;
  };

  API.mountLauncher=function(opts={}){
    if(document.querySelector('[data-mathroom-library-launcher]')) return;
    const b=document.createElement('button'); b.className='mlib-launcher';b.dataset.mathroomLibraryLauncher='1';b.textContent=opts.label||'Библиотека PDF';b.onclick=API.open;document.body.appendChild(b);return b;
  };

  window.MathroomLibrary2961=API;
  window.MathroomLibrary296=API; // backward compatibility for v29.6 integrations
})();
