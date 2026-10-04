/* Mathroom v29.15.1 — keep exactly one canonical School 57 task source per grade 5–8. */
(() => {
  'use strict';
  if (window.MathroomTaskbookCanonical29151) return;

  const VERSION='29.15.1';
  const MR=()=>window.MR||{};
  const S=()=>MR().S||{};
  const db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const state={busy:false,last:null};

  async function userId(c){
    if(S()?.user?.id)return S().user.id;
    try{return (await c.auth.getUser()).data.user?.id||null;}catch{return null;}
  }

  function gradeFromText(v){
    const s=String(v||'');
    let m=s.match(/(?:^|[^0-9])([5-8])[\s_.-]*57(?:[^0-9]|$)/i);
    if(m)return Number(m[1]);
    m=s.match(/57\s*(?:школ|school).*?([5-8])\s*(?:класс|grade)?/i);
    if(m)return Number(m[1]);
    return 0;
  }

  function bookGrade(book){
    return gradeFromText(`${book?.file_name||''} ${book?.title||''}`) || ((Number(book?.grade_from)>=5&&Number(book?.grade_from)<=8 && /57\s*(?:школ|school)/i.test(`${book?.title||''} ${book?.file_name||''}`)) ? Number(book.grade_from) : 0);
  }

  function sourceGrade(src){
    const m=src?.meta||{};
    const explicit=Number(m.task_source_grade||src?.grade||src?.grade_from||0);
    const txt=`${src?.filename||''} ${src?.title||''} ${m.task_source_family||''} ${m.external_key||''}`;
    if(/school57/i.test(String(m.task_source_family||'')) && explicit>=5&&explicit<=8)return explicit;
    return gradeFromText(txt) || (explicit>=5&&explicit<=8 && /57\s*(?:школ|school)/i.test(txt)?explicit:0);
  }

  function scoreSource(src,book){
    const m=src?.meta||{};
    let score=0;
    if(String(m.textbook_id||'')===String(book?.id||''))score+=1000;
    if(book?.file_path && String(src?.storage_path||'')===String(book.file_path))score+=800;
    if(book?.file_name && norm(src?.filename)===norm(book.file_name))score+=500;
    if(src?.is_active)score+=30;
    score+=Math.min(200,Number(src?.ocr_pages_done||0)||0);
    score+=Math.min(200,Number(src?.page_count||0)||0)/10;
    if(String(src?.ocr_status||'')==='processing')score+=25;
    if(String(src?.ocr_status||'')==='done')score+=20;
    return score;
  }

  function pickBook(list){
    return [...list].sort((a,b)=>{
      const sa=Number(a?.file_size||0), sb=Number(b?.file_size||0);
      if(sb!==sa)return sb-sa;
      return Date.parse(b?.created_at||0)-Date.parse(a?.created_at||0);
    })[0]||null;
  }

  async function run(){
    if(state.busy)return state.last;
    const c=db();if(!c)return null;
    const uid=await userId(c);if(!uid)return null;
    state.busy=true;
    try{
      const [{data:books,error:be},{data:sources,error:se}]=await Promise.all([
        c.from('textbooks').select('id,title,file_name,file_path,file_size,grade_from,grade_to,author,created_at').eq('teacher_id',uid),
        c.from('task_bank_sources').select('id,title,filename,storage_path,storage_bucket,grade,grade_from,grade_to,material_kind,is_active,ocr_status,ocr_pages_done,ocr_pages_total,page_count,meta,updated_at')
      ]);
      if(be)throw be;if(se)throw se;

      const canonical=[]; const deactivated=[]; const missing=[];
      for(const grade of [5,6,7,8]){
        const gradeBooks=(books||[]).filter(b=>bookGrade(b)===grade);
        const book=pickBook(gradeBooks);
        if(!book){missing.push(grade);continue;}
        const candidates=(sources||[]).filter(s=>sourceGrade(s)===grade);
        if(!candidates.length){missing.push(grade);continue;}
        candidates.sort((a,b)=>scoreSource(b,book)-scoreSource(a,book));
        const keep=candidates[0];
        const keepMeta={...(keep.meta||{}),textbook_id:book.id,material_kind:'taskbook',task_source_force:true,task_source_family:'school57',task_source_grade:grade,canonical_task_source:true,canonical_version:VERSION};
        const keepPatch={
          is_active:true,material_kind:'taskbook',grade,grade_from:grade,grade_to:grade,
          storage_path:book.file_path||keep.storage_path,
          filename:book.file_name||keep.filename,
          title:`Задачник 57 школы. ${grade} класс`,
          meta:keepMeta
        };
        if(!['pending','processing'].includes(String(keep.ocr_status||'')) && Number(keep.ocr_pages_done||0)<Number(keep.page_count||keep.ocr_pages_total||Infinity)){
          keepPatch.ocr_status='pending';
        }
        const {error:ke}=await c.from('task_bank_sources').update(keepPatch).eq('id',keep.id);
        if(ke)throw ke;
        canonical.push({grade,id:keep.id,title:keepPatch.title});

        for(const dup of candidates.slice(1)){
          const meta={...(dup.meta||{}),canonical_task_source:false,duplicate_of:keep.id,duplicate_disabled_version:VERSION};
          const {error:de}=await c.from('task_bank_sources').update({is_active:false,meta}).eq('id',dup.id);
          if(de)console.warn('[Mathroom 29.15.1] duplicate source disable failed',dup.id,de);
          else deactivated.push({grade,id:dup.id,title:dup.title});
        }
      }

      state.last={version:VERSION,canonical,deactivated,missing,at:Date.now()};
      try{await window.MathroomTaskSourcePolicy2913?.stats?.();}catch{}
      try{await window.MathroomLibraryFullIndexUI2910?.refresh?.(true);}catch{}
      if(deactivated.length)MR().toast?.(`Источники задач очищены: отключено дублей ${deactivated.length}. Задачники 57 школы: ${canonical.length}/4.`);
      return state.last;
    }catch(e){
      console.error('[Mathroom 29.15.1 canonical taskbooks]',e);
      state.last={version:VERSION,error:String(e?.message||e),at:Date.now()};
      return state.last;
    }finally{state.busy=false;}
  }

  window.MathroomTaskbookCanonical29151={version:VERSION,state,run,bookGrade,sourceGrade};
  setTimeout(()=>run(),2500);
})();
