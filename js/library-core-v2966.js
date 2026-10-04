/* Mathroom v29.6.6 — PDF recognition + OCR queue using the existing textbook upload. */
(function(){
  'use strict';
  const API={version:'29.6.6'};
  const SUBJECT_LABEL={mathematics:'Математика',algebra:'Алгебра',geometry:'Геометрия',algebra_analysis:'Алгебра и начала анализа'};
  const LEVEL_LABEL={base:'Базовый',advanced:'Углублённый',profile:'Профильный',mixed:'Общий',other:'Другой'};
  let presets=null, sb=null;
  const options={presetUrl:'./data/book-presets-v2966.json',maxBytes:50*1024*1024};
  const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  const normName=s=>String(s||'').normalize('NFKD').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const slug=s=>String(s||'book').toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,110)||'book';
  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  function candidateClient(v){return v&&typeof v==='object'&&typeof v.from==='function'&&v.storage&&v.auth?v:null;}
  function resolveClient(){
    if(candidateClient(sb)) return sb;
    const known=[window.supabaseClient,window.sb,window._supabase,window.appSupabase,window.Mathroom?.supabase,window.Mathroom?.sb,window.api?.supabase];
    for(const c of known){if(candidateClient(c)){sb=c;return sb;}}
    try{
      for(const k of Object.keys(window)){
        let v;try{v=window[k]}catch{continue}
        if(candidateClient(v)){sb=v;return sb;}
      }
    }catch{}
    const cfgs=[window.CONFIG,window.config,window.MATHROOM_CONFIG,window.APP_CONFIG,window.MathroomConfig].filter(Boolean);
    let url=window.SUPABASE_URL||window.supabaseUrl||'', key=window.SUPABASE_ANON_KEY||window.SUPABASE_KEY||window.supabaseKey||window.SUPABASE_PUBLISHABLE_KEY||'';
    for(const c of cfgs){
      url=url||c.SUPABASE_URL||c.supabaseUrl||c.url||'';
      key=key||c.SUPABASE_ANON_KEY||c.SUPABASE_KEY||c.SUPABASE_PUBLISHABLE_KEY||c.supabaseKey||c.anonKey||c.publishableKey||'';
    }
    if(url&&key&&window.supabase?.createClient){
      try{sb=window.supabase.createClient(url,key);return sb;}catch{}
    }
    return null;
  }
  API.resolveClient=resolveClient;
  API.setClient=c=>{sb=c;return API};

  async function loadPresets(){
    if(presets) return presets;
    try{
      const r=await fetch(options.presetUrl,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const j=await r.json();presets=Array.isArray(j.books)?j.books:[];
    }catch(e){console.warn('[Mathroom 29.6.6] preset file unavailable',e);presets=[];}
    return presets;
  }
  function heuristicPreset(filename){
    const n=normName(filename);
    const is=(...parts)=>parts.every(p=>n.includes(normName(p)));
    if(is('алгебра','9','углуб','2025')) return {external_key:'alg-9-advanced-makarychev-2025',title:'Алгебра. 9 класс. Углублённый уровень',subject:'algebra',subject_title:'Алгебра',grade_from:9,grade_to:9,level:'advanced',material_kind:'textbook',authors:'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, И. Е. Феоктистов',publication_year:2025,publisher:'Просвещение'};
    if(is('algebra','9','uglubl','2025')) return {external_key:'alg-9-advanced-makarychev-2025',title:'Алгебра. 9 класс. Углублённый уровень',subject:'algebra',subject_title:'Алгебра',grade_from:9,grade_to:9,level:'advanced',material_kind:'textbook',authors:'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, И. Е. Феоктистов',publication_year:2025,publisher:'Просвещение'};
    if(is('макарычев','7','2024')||is('makarychev','7','2024')) return {external_key:'alg-7-base-makarychev-2024',title:'Алгебра. 7 класс. Базовый уровень',subject:'algebra',subject_title:'Алгебра',grade_from:7,grade_to:7,level:'base',material_kind:'textbook',authors:'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, С. Б. Суворова',publication_year:2024,publisher:'Просвещение'};
    if(is('макарычев','8','2024')||is('makarychev','8','2024')) return {external_key:'alg-8-base-makarychev-2024',title:'Алгебра. 8 класс. Базовый уровень',subject:'algebra',subject_title:'Алгебра',grade_from:8,grade_to:8,level:'base',material_kind:'textbook',authors:'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, С. Б. Суворова',publication_year:2024,publisher:'Просвещение'};
    if(is('макарычев','9','2023')||is('makarychev','9','2023')) return {external_key:'alg-9-base-makarychev-2023',title:'Алгебра. 9 класс. Базовый уровень',subject:'algebra',subject_title:'Алгебра',grade_from:9,grade_to:9,level:'base',material_kind:'textbook',authors:'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, С. Б. Суворова',publication_year:2023,publisher:'Просвещение'};
    if(is('погорелов','7','11')||is('pogorelov','7','11')) return {external_key:'geometry-7-11-pogorelov-1995',title:'Геометрия. 7–11 классы',subject:'geometry',subject_title:'Геометрия',grade_from:7,grade_to:11,level:'mixed',material_kind:'textbook',authors:'А. В. Погорелов',publication_year:1995,publisher:'Просвещение'};
    if(is('mordkovich','10','semenov','chast','1')) return {external_key:'alg-analysis-10-profile-mordkovich-semenov-2009-p1',title:'Алгебра и начала математического анализа. 10 класс. Профильный уровень. Часть 1',subject:'algebra_analysis',subject_title:'Алгебра и начала анализа',grade_from:10,grade_to:10,level:'profile',material_kind:'textbook',authors:'А. Г. Мордкович, П. В. Семёнов',publication_year:2009,part_no:'1',publisher:'Мнемозина'};
    return null;
  }
  API.matchPreset=async function(filename){
    const n=normName(filename), ps=await loadPresets();
    for(const p of ps){
      for(const raw of (p.filename_patterns||[])){
        const q=normName(raw);if(q&&(n===q||n.includes(q)||q.includes(n))) return {...p};
      }
    }
    return heuristicPreset(filename);
  };

  async function pdfFromFile(file){
    if(!window.pdfjsLib) throw new Error('PDF.js не загружен');
    const buf=await file.arrayBuffer();return window.pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
  }
  function lineGroups(items){
    const rows=[];
    for(const it of items||[]){
      const str=String(it.str||'').replace(/\s+/g,' ').trim();if(!str)continue;
      const y=Math.round((it.transform?.[5]||0)*2)/2;let row=rows.find(r=>Math.abs(r.y-y)<=2);
      if(!row){row={y,parts:[]};rows.push(row)}row.parts.push({x:it.transform?.[4]||0,str});
    }
    rows.sort((a,b)=>b.y-a.y);return rows.map(r=>r.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  }
  async function extractBookText(file){
    const pdf=await pdfFromFile(file),n=pdf.numPages;
    const pages=[1,2,3,4,5,6,7,8,Math.max(1,n-1),n].filter((v,i,a)=>v<=n&&a.indexOf(v)===i);
    const blocks=[];let textPages=0,totalChars=0;
    for(const pno of pages){
      const page=await pdf.getPage(pno),tc=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
      const t=lineGroups(tc.items).join('\n');if(t.replace(/\s/g,'').length>=60)textPages++;totalChars+=t.length;blocks.push(t);
    }
    return {page_count:n,text:blocks.join('\n'),text_layer_status:textPages===0?'scan':textPages===pages.length?'text':'mixed',avg_chars:Math.round(totalChars/Math.max(1,pages.length))};
  }
  API.extractBookText=extractBookText;
  function newestYear(text,filename){
    const ys=[...(String(filename||'').match(/(?:19|20)\d{2}/g)||[]),...(String(text||'').match(/(?:19|20)\d{2}/g)||[])].map(Number).filter(y=>y>=1950&&y<=2035);return ys.length?Math.max(...ys):null;
  }
  function parseAuthors(raw){
    let m=String(raw||'').match(/Авторы\s*:\s*([^\n]{8,260})/i);if(m)return clean(m[1].replace(/(?:Математика|Алгебра|Геометрия).*$/i,''));
    m=String(raw||'').match(/(?:учебник|задачник)[^/\n]{0,150}\/\s*([^\n;]{8,260})(?:;|—|-{2,})/i);return m?clean(m[1]):null;
  }
  function parseTextMetadata(text,filename){
    const flat=clean(text), lower=flat.toLowerCase(),out={};let m;
    m=flat.match(/(\d{1,2})\s*[–—-]\s*(\d{1,2})\s*(?:класс|классы)/i);
    if(m){out.grade_from=+m[1];out.grade_to=+m[2];}else{m=flat.match(/(\d{1,2})(?:\s*[-–—]?\s*(?:й|ый|ой))?\s*класс/i);if(m)out.grade_from=out.grade_to=+m[1];}
    if(/алгебр[^.]{0,100}(?:начала|элемент)[^.]{0,100}(?:анализ)/i.test(flat))out.subject='algebra_analysis';else if(/геометр/i.test(lower))out.subject='geometry';else if(/алгебр/i.test(lower))out.subject='algebra';else if(/математ/i.test(lower))out.subject='mathematics';
    if(out.subject)out.subject_title=SUBJECT_LABEL[out.subject];
    if(/углубл[её]нн(?:ый|ого)\s+уров/i.test(lower))out.level='advanced';else if(/профильн(?:ый|ого)\s+уров/i.test(lower))out.level='profile';else if(/базов(?:ый|ого)\s+уров/i.test(lower))out.level='base';else out.level='mixed';
    out.material_kind=/задачник/i.test(lower)?'taskbook':/сборник\s+задач/i.test(lower)?'collection':'textbook';
    m=flat.match(/част[ьи]\s*(?:№\s*)?(\d+)/i);if(m)out.part_no=m[1];
    out.publication_year=newestYear(flat,filename);if(/просвещен/i.test(lower))out.publisher='Просвещение';else if(/мнемозин/i.test(lower))out.publisher='Мнемозина';else if(/бином/i.test(lower))out.publisher='БИНОМ. Лаборатория знаний';out.authors=parseAuthors(text);
    if(out.subject&&out.grade_from){const gr=out.grade_from===out.grade_to?`${out.grade_from} класс`:`${out.grade_from}–${out.grade_to} классы`,lvl=out.level&&out.level!=='mixed'?`. ${LEVEL_LABEL[out.level]} уровень`:'',part=out.part_no?`. Часть ${out.part_no}`:'';out.title=`${SUBJECT_LABEL[out.subject]}. ${gr}${lvl}${part}`;}
    return out;
  }
  API.parseTextMetadata=parseTextMetadata;
  API.recognizeFile=async function(file){
    if(!(file instanceof File))throw new Error('Выберите PDF');
    const preset=await API.matchPreset(file.name);
    if(preset){return {meta:{...preset,filename:file.name,file_size_bytes:file.size,text_layer_status:'unknown'},confidence:'high',source:'preset'};}
    let extract=null,parsed={};
    try{extract=await extractBookText(file);if(extract.text_layer_status!=='scan')parsed=parseTextMetadata(extract.text,file.name);}catch(e){console.warn('[Mathroom 29.6.6] PDF read error',e);}
    const meta={...parsed,filename:file.name,file_size_bytes:file.size};if(extract){meta.page_count=extract.page_count;meta.text_layer_status=extract.text_layer_status;}
    const score=['subject','grade_from','grade_to','level','authors','publication_year','publisher'].reduce((s,k)=>s+(meta[k]?1:0),0);
    return {meta,confidence:score>=6?'high':score>=4?'medium':'low',source:extract?.text_layer_status==='scan'?'scan':'pdf-text'};
  };

  function sourceRow(book,meta,file){
    const gf=Number(meta.grade_from||book.grade_from||0)||null,gt=Number(meta.grade_to||book.grade_to||gf||0)||null;
    const subject=meta.subject||(/геометр/i.test(book.subject||'')?'geometry':/алгебр/i.test(book.subject||'')?'algebra':'mathematics');
    const layer=meta.text_layer_status==='text'?'text':meta.text_layer_status==='mixed'?'mixed':'unknown';
    return {
      external_key:`textbook-${book.id}`,title:meta.title||book.title||file.name,grade:gf&&gt===gf?gf:null,grade_from:gf,grade_to:gt,
      subject,subject_title:meta.subject_title||SUBJECT_LABEL[subject]||book.subject||'Математика',level:meta.level||'mixed',material_kind:meta.material_kind||'textbook',authors:meta.authors||book.author||null,
      publication_year:Number(meta.publication_year||0)||null,part_no:meta.part_no||null,publisher:meta.publisher||null,source_kind:'pdf',filename:file.name,file_size_bytes:file.size,
      text_layer_status:layer,ocr_status:layer==='text'?'not_needed':'pending',storage_bucket:'textbooks',storage_path:book.file_path,page_count:Number(meta.page_count||0)||null,
      meta:{textbook_id:book.id,unified_upload:true,recognition_version:'29.6.6'},is_active:true
    };
  }
  API.queueExistingTextbook=async function(file,meta={}){
    const client=resolveClient();if(!client)throw new Error('Не найден клиент Supabase');
    const auth=await client.auth.getUser();const uid=auth?.data?.user?.id;if(!uid)throw new Error('Нет активной сессии преподавателя');
    let book=null,lastErr=null;
    for(let i=0;i<40;i++){
      const q=await client.from('textbooks').select('id,title,author,subject,grade_from,grade_to,file_path,file_name,file_size,created_at').eq('teacher_id',uid).eq('file_name',file.name).order('created_at',{ascending:false}).limit(1);
      lastErr=q.error;if(q.data?.[0]){book=q.data[0];break;}await wait(750);
    }
    if(!book)throw lastErr||new Error('Загруженный учебник пока не найден в библиотеке');
    const row=sourceRow(book,meta,file);const r=await client.from('task_bank_sources').upsert(row,{onConflict:'external_key'}).select().single();if(r.error)throw r.error;return r.data;
  };
  window.MathroomLibrary2966=API;
})();
