/* Mathroom v29.6.3 — single legacy upload form + automatic PDF recognition + OCR catalog. */
(function(){
  'use strict';
  const API={version:'29.6.3'};
  let sb=null;
  let options={bucket:'mathroom-books',presetUrl:'./data/book-presets-v2963.json',maxBytes:50*1024*1024};
  let presets=null;

  const SUBJECT_LABEL={mathematics:'Математика',algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа'};
  const LEVEL_LABEL={base:'Базовый',advanced:'Углублённый',profile:'Профильный',mixed:'Общий',other:'Другой'};
  const KIND_LABEL={textbook:'Учебник',taskbook:'Задачник',collection:'Сборник',workbook:'Рабочая тетрадь',reference:'Справочник',other:'Другое'};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug=s=>String(s||'book').toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,100)||'book';
  const toast=(text,ms=3500)=>{const d=document.createElement('div');d.className='mlib-toast';d.textContent=text;document.body.appendChild(d);setTimeout(()=>d.remove(),ms)};

  function resolveClient(){
    if(sb) return sb;
    const candidates=[window.supabaseClient,window.sb,window._supabase,window.appSupabase,window.Mathroom?.supabase];
    sb=candidates.find(x=>x&&typeof x.from==='function')||null;
    return sb;
  }
  API.setClient=c=>{sb=c;return API};
  API.setOptions=o=>{options={...options,...(o||{})};return API};

  async function loadPresets(){
    if(presets) return presets;
    try{
      const r=await fetch(options.presetUrl,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const j=await r.json(); presets=Array.isArray(j.books)?j.books:[];
    }catch(err){console.warn('[Library2963] presets unavailable',err);presets=[];}
    return presets;
  }
  API.loadPresets=loadPresets;
  API.matchPreset=async filename=>{
    const name=String(filename||'').toLowerCase();
    const ps=await loadPresets();
    return ps.find(p=>(p.filename_patterns||[]).some(x=>name===String(x).toLowerCase()||name.includes(String(x).toLowerCase())))||null;
  };

  async function pdfFromFile(file){
    if(!window.pdfjsLib) throw new Error('PDF.js не загружен');
    const buf=await file.arrayBuffer();
    return window.pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
  }

  function lineGroups(items){
    const rows=[];
    for(const it of items||[]){
      const str=String(it.str||'').replace(/\s+/g,' ').trim(); if(!str) continue;
      const y=Math.round((it.transform?.[5]||0)*2)/2;
      let row=rows.find(r=>Math.abs(r.y-y)<=2);
      if(!row){row={y,parts:[]};rows.push(row)}
      row.parts.push({x:it.transform?.[4]||0,str});
    }
    rows.sort((a,b)=>b.y-a.y);
    return rows.map(r=>r.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  }

  async function extractBookText(file){
    const pdf=await pdfFromFile(file);
    const n=pdf.numPages;
    const pages=[1,2,3,4,5,6,7,8,Math.max(1,n-2),Math.max(1,n-1),n].filter((v,i,a)=>v<=n&&a.indexOf(v)===i);
    const blocks=[]; let textPages=0,totalChars=0;
    for(const pno of pages){
      const page=await pdf.getPage(pno);
      const tc=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
      const lines=lineGroups(tc.items);
      const text=lines.join('\n');
      if(text.replace(/\s/g,'').length>=60) textPages++;
      totalChars+=text.length;
      blocks.push(`\n--- PAGE ${pno} ---\n${text}`);
    }
    const status=textPages===0?'scan':textPages===pages.length?'text':'mixed';
    return {pdf,page_count:n,pages,text:blocks.join('\n'),text_layer_status:status,avg_chars:Math.round(totalChars/Math.max(1,pages.length))};
  }
  API.extractBookText=extractBookText;

  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  function newestYear(text,filename){
    const fn=String(filename||'').match(/(?:19|20)\d{2}/g)||[];
    if(fn.length) return Number(fn[fn.length-1]);
    const ys=(String(text).match(/(?:19|20)\d{2}/g)||[]).map(Number).filter(y=>y>=1950&&y<=2035);
    return ys.length?Math.max(...ys):null;
  }
  function parseAuthors(text){
    const t=String(text||'');
    let m=t.match(/Авторы\s*:\s*([^\n]{8,260})/i);
    if(m) return clean(m[1].replace(/(?:Математика|Алгебра|Геометрия).*$/i,''));
    m=t.match(/(?:учебник|задачник)[^/\n]{0,120}\/\s*([^\n;]{8,240})(?:;|—|-{2,})/i);
    if(m) return clean(m[1]);
    // Common compact initials + surnames sequence.
    const candidates=(t.match(/(?:[А-ЯЁ]\.?\s*){1,2}[А-ЯЁ][а-яё-]+(?:\s*,\s*(?:[А-ЯЁ]\.?\s*){1,2}[А-ЯЁ][а-яё-]+){0,6}/g)||[])
      .map(clean).filter(s=>s.length>=8&&!/Москва|ISBN|УДК|ФГОС/i.test(s));
    return candidates.sort((a,b)=>b.length-a.length)[0]||null;
  }
  function parseTextMetadata(text,filename){
    const raw=String(text||''); const flat=clean(raw); const lower=flat.toLowerCase();
    const out={};
    let m=flat.match(/(\d{1,2})\s*[–—-]\s*(\d{1,2})\s*(?:класс|классы)/i);
    if(m){out.grade_from=Number(m[1]);out.grade_to=Number(m[2]);}
    else {m=flat.match(/(\d{1,2})(?:\s*[-–—]?\s*(?:й|ый|ой))?\s*класс/i);if(m){out.grade_from=out.grade_to=Number(m[1]);}}

    if(/алгебр[^.]{0,80}(?:начала|элемент)[^.]{0,80}(?:анализ)/i.test(flat)) out.subject='algebra_analysis';
    else if(/геометр/i.test(lower)) out.subject='geometry';
    else if(/алгебр/i.test(lower)) out.subject='algebra';
    else if(/математ/i.test(lower)) out.subject='mathematics';
    if(out.subject) out.subject_title=SUBJECT_LABEL[out.subject];

    if(/углубл[её]нн(?:ый|ого)\s+уров/i.test(lower)) out.level='advanced';
    else if(/профильн(?:ый|ого)\s+уров/i.test(lower)) out.level='profile';
    else if(/базов(?:ый|ого)\s+уров/i.test(lower)) out.level='base';
    else out.level='mixed';

    if(/задачник/i.test(lower)) out.material_kind='taskbook';
    else if(/сборник\s+задач/i.test(lower)) out.material_kind='collection';
    else if(/рабочая\s+тетрад/i.test(lower)) out.material_kind='workbook';
    else out.material_kind='textbook';

    m=flat.match(/част[ьи]\s*(?:№\s*)?(\d+)/i); if(m) out.part_no=m[1];
    out.publication_year=newestYear(flat,filename);
    if(/просвещен/i.test(lower)) out.publisher='Просвещение';
    else if(/мнемозин/i.test(lower)) out.publisher='Мнемозина';
    else if(/бином/i.test(lower)) out.publisher='БИНОМ. Лаборатория знаний';
    out.authors=parseAuthors(raw);

    if(out.subject&&out.grade_from){
      const gr=out.grade_from===out.grade_to?`${out.grade_from} класс`:`${out.grade_from}–${out.grade_to} классы`;
      const lvl=out.level&&out.level!=='mixed'?`. ${LEVEL_LABEL[out.level]} уровень`:'';
      const part=out.part_no?`. Часть ${out.part_no}`:'';
      const kind=out.material_kind==='taskbook'?'. Задачник':out.material_kind==='collection'?'. Сборник задач':'';
      out.title=`${SUBJECT_LABEL[out.subject]}. ${gr}${lvl}${kind}${part}`;
    }
    return out;
  }
  API.parseTextMetadata=parseTextMetadata;

  API.recognizeFile=async function(file){
    if(!(file instanceof File)) throw new Error('Выберите PDF');
    const preset=await API.matchPreset(file.name);
    let extract=null,parsed={};
    try{extract=await extractBookText(file); if(extract.text_layer_status!=='scan') parsed=parseTextMetadata(extract.text,file.name);}catch(err){console.warn('[Library2963] PDF text recognition failed',err);}
    const merged={...parsed,...(preset||{})};
    if(extract){merged.page_count=extract.page_count;merged.text_layer_status=extract.text_layer_status;}
    merged.filename=file.name; merged.file_size_bytes=file.size;
    const important=['subject','grade_from','grade_to','level','authors','publication_year','publisher'];
    const score=important.reduce((s,k)=>s+(merged[k]?1:0),0);
    return {meta:merged,confidence:preset?'high':score>=6?'high':score>=4?'medium':'low',source:preset?'preset':extract?.text_layer_status==='scan'?'scan':'pdf-text',extract};
  };

  async function fingerprint(file){
    const data=await file.arrayBuffer(), bytes=new Uint8Array(data);
    const subtle=globalThis.crypto?.subtle;
    if(subtle?.digest){try{const hash=await subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}catch{}}
    let h=0x811c9dc5>>>0; const step=Math.max(1,Math.floor(bytes.length/150000));
    for(let i=0;i<bytes.length;i+=step){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}
    return h.toString(16).padStart(8,'0')+bytes.length.toString(16).padStart(12,'0');
  }

  function normalizedMeta(meta){
    const m={...(meta||{})}; const gf=Number(m.grade_from||m.grade||0)||null; const gt=Number(m.grade_to||gf||0)||null;
    return {external_key:m.external_key||slug([m.subject||'math',gf||'',gt&&gt!==gf?gt:'',m.level||'',m.authors||'',m.publication_year||'',m.part_no||''].join('-')),title:m.title||m.filename||'Учебник',grade:gf&&gt===gf?gf:null,grade_from:gf,grade_to:gt,subject:m.subject||'mathematics',subject_title:m.subject_title||SUBJECT_LABEL[m.subject]||'Математика',level:m.level||'mixed',material_kind:m.material_kind||'textbook',authors:m.authors||null,publication_year:Number(m.publication_year||0)||null,part_no:m.part_no||null,publisher:m.publisher||null,edition:m.edition||null,source_kind:'pdf',filename:m.filename||null,file_size_bytes:Number(m.file_size_bytes||0)||null,content_fingerprint:m.content_fingerprint||null,text_layer_status:m.text_layer_status||'unknown',ocr_status:m.ocr_status||'unknown',storage_bucket:m.storage_bucket||null,storage_path:m.storage_path||null,pdf_url:m.pdf_url||null,page_count:Number(m.page_count||0)||null,meta:m.meta||{},is_active:m.is_active!==false};
  }

  API.registerBook=async function(meta){
    const client=resolveClient(); if(!client) throw new Error('Supabase client not found');
    const row=normalizedMeta(meta);
    if(row.text_layer_status==='text') row.ocr_status='not_needed';
    else if(['scan','mixed'].includes(row.text_layer_status)) row.ocr_status='pending';
    const {data,error}=await client.from('task_bank_sources').upsert(row,{onConflict:'external_key'}).select().single();
    if(error) throw error; return data;
  };

  async function defaultUpload(file,meta,onProgress){
    const client=resolveClient(); if(!client) throw new Error('Supabase client not found');
    const bucket=meta.storage_bucket||options.bucket;
    const path=`books/${slug(meta.external_key||file.name)}/${Date.now()}-${slug(file.name)}`;
    onProgress?.({phase:'upload',percent:10});
    const {error}=await client.storage.from(bucket).upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
    if(error) throw error;
    onProgress?.({phase:'upload',percent:100});
    return {bucket,path};
  }

  API.uploadAndRegister=async function(file,meta={},onProgress){
    if(!(file instanceof File)) throw new Error('Выберите PDF');
    if(!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Нужен PDF-файл');
    if(file.size>options.maxBytes) throw new Error('Файл больше 50 МБ. Сначала сожмите PDF.');
    onProgress?.({phase:'recognize',percent:5});
    const recognized=await API.recognizeFile(file);
    const merged={...recognized.meta,...meta,filename:file.name,file_size_bytes:file.size};
    onProgress?.({phase:'analyze',percent:25});
    const fp=await fingerprint(file); merged.content_fingerprint=fp;
    merged.external_key=merged.external_key||slug(`${file.name}-${fp.slice(0,10)}`);
    if(!merged.text_layer_status){
      try{const e=await extractBookText(file);merged.text_layer_status=e.text_layer_status;merged.page_count=e.page_count;}catch{merged.text_layer_status='unknown';}
    }
    merged.ocr_status=merged.text_layer_status==='text'?'not_needed':'pending';
    const loc=await defaultUpload(file,merged,onProgress);
    merged.storage_bucket=loc.bucket; merged.storage_path=loc.path;
    onProgress?.({phase:'register',percent:95});
    const book=await API.registerBook(merged); onProgress?.({phase:'done',percent:100});
    return book;
  };

  API.listBooks=async function(filters={}){
    const client=resolveClient(); if(!client) throw new Error('Supabase client not found');
    let q=client.from('task_bank_source_catalog').select('*');
    if(!filters.includeInactive) q=q.eq('is_active',true);
    if(filters.grade) q=q.lte('grade_from',filters.grade).gte('grade_to',filters.grade);
    q=q.order('created_at',{ascending:false});
    const {data,error}=await q; if(error) throw error; return data||[];
  };
  API.getPdfUrl=async function(book,expiresIn=3600){
    if(book.pdf_url) return book.pdf_url;
    const client=resolveClient(); const {data,error}=await client.storage.from(book.storage_bucket).createSignedUrl(book.storage_path,expiresIn); if(error) throw error; return data.signedUrl;
  };
  API.requestOcr=async function(id){const client=resolveClient();const {data,error}=await client.rpc('task_bank_request_ocr',{p_source_id:id});if(error)throw error;return data;};
  API.syncTasks=async function(book,topicMap=[]){
    if(book.text_layer_status!=='text'){if(book.ocr_status!=='done')return{needs_ocr:true,book};return{already_indexed_by_worker:true,book};}
    if(!window.MathroomTaskBank?.scanPdf) throw new Error('Подключите task-bank-v295.js');
    const url=await API.getPdfUrl(book,7200);return window.MathroomTaskBank.scanPdf({external_key:book.external_key,title:book.title,grade:book.grade_from===book.grade_to?book.grade_from:null,url,meta:{book_id:book.id,level:book.level,material_kind:book.material_kind},topicMap});
  };

  function tag(t,c=''){return `<span class="mlib-tag ${c}">${esc(t)}</span>`}
  function gradeLabel(b){return !b.grade_from?'—':b.grade_from===b.grade_to?`${b.grade_from} класс`:`${b.grade_from}–${b.grade_to} классы`}
  function cardHtml(b){
    const layer=b.text_layer_status==='text'?tag('Текстовый PDF','text'):b.text_layer_status==='scan'?tag('Скан · OCR','scan'):tag('Смешанный · OCR','scan');
    const ocr=b.ocr_status==='pending'?tag('OCR в очереди','pending'):b.ocr_status==='processing'?tag(`OCR ${b.ocr_pages_done||0}/${b.ocr_pages_total||'…'}`,'pending'):b.ocr_status==='done'?tag('OCR готов','text'):'';
    return `<article class="mlib-card" data-book="${esc(b.id)}"><div class="mlib-title">${esc(b.title)}</div><div class="mlib-tags">${tag(gradeLabel(b))}${tag(LEVEL_LABEL[b.level]||b.level)}${tag(KIND_LABEL[b.material_kind]||b.material_kind)}${layer}${ocr}</div><div class="mlib-meta">${esc([b.authors,b.publication_year,b.publisher].filter(Boolean).join(' · '))}</div><div class="mlib-meta">Задач: <b>${b.task_count||0}</b>${b.review_count?` · проверить: <b>${b.review_count}</b>`:''}</div><div class="mlib-card-actions"><button class="mlib-btn" data-act="open">Открыть</button><button class="mlib-btn" data-act="sync">Синхронизировать задачи</button></div></article>`;
  }
  API.renderCatalogInto=async function(container,opts={}){
    if(!container) return [];
    container.innerHTML='<div class="mlib-empty mlib-empty-compact">Загрузка…</div>';
    try{
      const books=await API.listBooks(opts.filters||{});
      if(!books.length){container.innerHTML='<div class="mlib-empty mlib-empty-compact">Новых PDF пока нет.</div>';return books;}
      container.innerHTML=`<div class="mlib-grid mlib-grid-embedded">${books.map(cardHtml).join('')}</div>`;
      container.querySelectorAll('[data-book]').forEach(card=>{
        const book=books.find(x=>x.id===card.dataset.book);
        card.addEventListener('click',async e=>{const act=e.target?.dataset?.act;if(!act)return;try{if(act==='open'){const url=await API.getPdfUrl(book);if(typeof window.MathroomOpenPdf==='function')window.MathroomOpenPdf(url,book);else window.open(url,'_blank','noopener');}if(act==='sync'){const r=await API.syncTasks(book,[]);if(r.needs_ocr){await API.requestOcr(book.id);toast('OCR добавлен в очередь');}else if(r.already_indexed_by_worker)toast('OCR уже обработал эту книгу.');else toast(`Синхронизация: ${r.added||0} новых задач`);await API.renderCatalogInto(container,opts);}}catch(err){console.error(err);toast(err.message||String(err),5000)}});
      });
      return books;
    }catch(err){container.innerHTML=`<div class="mlib-empty mlib-danger">${esc(err.message||err)}</div>`;return[];}
  };

  window.MathroomLibrary2963=API;
  window.MathroomLibrary2962=API;
  window.MathroomLibrary2961=API;
  window.MathroomLibrary296=API;
})();
