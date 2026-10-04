/* Mathroom v29.6.4 — isolated PDF recognition + OCR mirror. Does not render/replace app navigation. */
(function(){
  'use strict';
  const API={version:'29.6.4'};
  let sb=null;
  let options={bucket:'mathroom-books',presetUrl:'./data/book-presets-v2964.json',maxBytes:50*1024*1024};
  let presets=null;
  const SUBJECT_LABEL={mathematics:'Математика',algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа'};
  const LEVEL_LABEL={base:'Базовый',advanced:'Углублённый',profile:'Профильный',mixed:'Общий',other:'Другой'};
  const slug=s=>String(s||'book').toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,100)||'book';
  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();

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
      const j=await r.json();
      presets=Array.isArray(j.books)?j.books:[];
    }catch(err){console.warn('[Library2964] presets unavailable',err);presets=[];}
    return presets;
  }
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
      const str=String(it.str||'').replace(/\s+/g,' ').trim();
      if(!str) continue;
      const y=Math.round((it.transform?.[5]||0)*2)/2;
      let row=rows.find(r=>Math.abs(r.y-y)<=2);
      if(!row){row={y,parts:[]};rows.push(row)}
      row.parts.push({x:it.transform?.[4]||0,str});
    }
    rows.sort((a,b)=>b.y-a.y);
    return rows.map(r=>r.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  }
  async function extractBookText(file){
    const pdf=await pdfFromFile(file), n=pdf.numPages;
    const pages=[1,2,3,4,5,6,7,8,Math.max(1,n-2),Math.max(1,n-1),n].filter((v,i,a)=>v<=n&&a.indexOf(v)===i);
    const blocks=[];
    let textPages=0,totalChars=0;
    for(const pno of pages){
      const page=await pdf.getPage(pno);
      const tc=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
      const text=lineGroups(tc.items).join('\n');
      if(text.replace(/\s/g,'').length>=60) textPages++;
      totalChars+=text.length;
      blocks.push(`\n--- PAGE ${pno} ---\n${text}`);
    }
    return {page_count:n,text:blocks.join('\n'),text_layer_status:textPages===0?'scan':textPages===pages.length?'text':'mixed',avg_chars:Math.round(totalChars/Math.max(1,pages.length))};
  }
  API.extractBookText=extractBookText;

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
    const cs=(t.match(/(?:[А-ЯЁ]\.?\s*){1,2}[А-ЯЁ][а-яё-]+(?:\s*,\s*(?:[А-ЯЁ]\.?\s*){1,2}[А-ЯЁ][а-яё-]+){0,6}/g)||[])
      .map(clean).filter(s=>s.length>=8&&!/Москва|ISBN|УДК|ФГОС/i.test(s));
    return cs.sort((a,b)=>b.length-a.length)[0]||null;
  }
  function authorsFallback(text){
    const line=String(text||'').split(/\n/).find(x=>/Авторы\s*:/i.test(x));
    return line?clean(line.replace(/^.*?Авторы\s*:\s*/i,'')):null;
  }
  function parseTextMetadata(text,filename){
    const raw=String(text||''), flat=clean(raw), lower=flat.toLowerCase(), out={};
    let m=flat.match(/(\d{1,2})\s*[–—-]\s*(\d{1,2})\s*(?:класс|классы)/i);
    if(m){out.grade_from=Number(m[1]);out.grade_to=Number(m[2]);}
    else{
      m=flat.match(/(\d{1,2})(?:\s*[-–—]?\s*(?:й|ый|ой))?\s*класс/i);
      if(m) out.grade_from=out.grade_to=Number(m[1]);
    }
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
    else out.material_kind='textbook';

    m=flat.match(/част[ьи]\s*(?:№\s*)?(\d+)/i);
    if(m) out.part_no=m[1];
    out.publication_year=newestYear(flat,filename);
    if(/просвещен/i.test(lower)) out.publisher='Просвещение';
    else if(/мнемозин/i.test(lower)) out.publisher='Мнемозина';
    else if(/бином/i.test(lower)) out.publisher='БИНОМ. Лаборатория знаний';
    out.authors=parseAuthors(raw)||authorsFallback(raw);

    if(out.subject&&out.grade_from){
      const gr=out.grade_from===out.grade_to?`${out.grade_from} класс`:`${out.grade_from}–${out.grade_to} классы`;
      const lvl=out.level&&out.level!=='mixed'?`. ${LEVEL_LABEL[out.level]} уровень`:'';
      const part=out.part_no?`. Часть ${out.part_no}`:'';
      out.title=`${SUBJECT_LABEL[out.subject]}. ${gr}${lvl}${part}`;
    }
    return out;
  }
  API.parseTextMetadata=parseTextMetadata;

  API.recognizeFile=async function(file){
    if(!(file instanceof File)) throw new Error('Выберите PDF');
    const preset=await API.matchPreset(file.name);
    let extract=null,parsed={};
    try{
      extract=await extractBookText(file);
      if(extract.text_layer_status!=='scan') parsed=parseTextMetadata(extract.text,file.name);
    }catch(err){console.warn('[Library2964] PDF recognition failed',err);}
    const merged={...parsed,...(preset||{})};
    if(extract){merged.page_count=extract.page_count;merged.text_layer_status=extract.text_layer_status;}
    merged.filename=file.name;merged.file_size_bytes=file.size;
    const keys=['subject','grade_from','grade_to','level','authors','publication_year','publisher'];
    const score=keys.reduce((s,k)=>s+(merged[k]?1:0),0);
    return {meta:merged,confidence:preset?'high':score>=6?'high':score>=4?'medium':'low',source:preset?'preset':extract?.text_layer_status==='scan'?'scan':'pdf-text'};
  };

  async function fingerprint(file){
    const data=await file.arrayBuffer(),bytes=new Uint8Array(data),subtle=globalThis.crypto?.subtle;
    if(subtle?.digest){
      try{
        const hash=await subtle.digest('SHA-256',data);
        return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
      }catch{}
    }
    let h=0x811c9dc5>>>0;
    const step=Math.max(1,Math.floor(bytes.length/150000));
    for(let i=0;i<bytes.length;i+=step){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}
    return h.toString(16).padStart(8,'0')+bytes.length.toString(16).padStart(12,'0');
  }
  function normalizedMeta(m){
    m={...(m||{})};
    const gf=Number(m.grade_from||m.grade||0)||null,gt=Number(m.grade_to||gf||0)||null;
    return {
      external_key:m.external_key||slug([m.subject||'math',gf||'',gt&&gt!==gf?gt:'',m.level||'',m.authors||'',m.publication_year||'',m.part_no||'',m.content_fingerprint||''].join('-')),
      title:m.title||m.filename||'Учебник',grade:gf&&gt===gf?gf:null,grade_from:gf,grade_to:gt,
      subject:m.subject||'mathematics',subject_title:m.subject_title||SUBJECT_LABEL[m.subject]||'Математика',
      level:m.level||'mixed',material_kind:m.material_kind||'textbook',authors:m.authors||null,
      publication_year:Number(m.publication_year||0)||null,part_no:m.part_no||null,publisher:m.publisher||null,
      source_kind:'pdf',filename:m.filename||null,file_size_bytes:Number(m.file_size_bytes||0)||null,
      content_fingerprint:m.content_fingerprint||null,text_layer_status:m.text_layer_status||'unknown',
      ocr_status:m.text_layer_status==='text'?'not_needed':'pending',storage_bucket:m.storage_bucket||null,
      storage_path:m.storage_path||null,page_count:Number(m.page_count||0)||null,meta:m.meta||{},is_active:true
    };
  }
  API.mirrorForOcr=async function(file,meta={}){
    if(!(file instanceof File)) throw new Error('Выберите PDF');
    if(file.size>options.maxBytes) throw new Error('PDF больше 50 МБ');
    const client=resolveClient();
    if(!client) throw new Error('Supabase client не найден');
    const rec=await API.recognizeFile(file);
    const merged={...rec.meta,...meta,filename:file.name,file_size_bytes:file.size};
    merged.content_fingerprint=await fingerprint(file);
    const row=normalizedMeta(merged);
    const path=`books/${slug(row.external_key)}/${Date.now()}-${slug(file.name)}`;
    const {error:upErr}=await client.storage.from(options.bucket).upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
    if(upErr) throw upErr;
    row.storage_bucket=options.bucket;row.storage_path=path;
    const {data,error}=await client.from('task_bank_sources').upsert(row,{onConflict:'external_key'}).select().single();
    if(error) throw error;
    return data;
  };

  window.MathroomLibrary2964=API;
})();