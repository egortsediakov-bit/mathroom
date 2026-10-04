/* Mathroom v29.14.0 — guarantee all four School 57 taskbooks (grades 5–8) have active task-source rows. */
(() => {
  'use strict';
  if (window.MathroomTaskbookRepair2914) return;

  const VERSION='29.14.0';
  const MR=()=>window.MR||{};
  const S=()=>MR().S||{};
  const db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const school57=/(?:^|[^0-9])(5|6|7|8)[\s_.-]*57(?:[^0-9]|$)|57\s*(?:школ|school)/i;
  const state={busy:false,last:null};

  async function userId(c){
    if(S()?.user?.id)return S().user.id;
    try{return (await c.auth.getUser()).data.user?.id||null;}catch{return null;}
  }

  function gradeOf(book){
    const txt=`${book?.file_name||''} ${book?.title||''}`;
    const m=txt.match(/(?:^|[^0-9])([5-8])[\s_.-]*57(?:[^0-9]|$)/i);
    if(m)return Number(m[1]);
    const g=Number(book?.grade_from||0);
    return g>=5&&g<=8&&/57\s*(?:школ|school)/i.test(txt)?g:0;
  }

  function isSchool57Book(book){
    const txt=`${book?.file_name||''} ${book?.title||''}`;
    return school57.test(txt)&&!!gradeOf(book);
  }

  async function repair(){
    if(state.busy)return state.last;
    const c=db();if(!c)return null;
    const uid=await userId(c);if(!uid)return null;
    state.busy=true;
    try{
      const [{data:books,error:be},{data:sources,error:se}]=await Promise.all([
        c.from('textbooks').select('id,title,author,subject,grade_from,grade_to,file_path,file_name,file_size,created_at').eq('teacher_id',uid).order('created_at'),
        c.from('task_bank_sources').select('*')
      ]);
      if(be)throw be;if(se)throw se;
      const target=(books||[]).filter(isSchool57Book);
      let repaired=0,created=0;
      const readyGrades=[];

      for(const book of target){
        const grade=gradeOf(book);if(!grade)continue;
        let src=(sources||[]).find(s=>String(s?.meta?.textbook_id||'')===String(book.id));
        if(!src&&book.file_path)src=(sources||[]).find(s=>String(s.storage_path||'')===String(book.file_path));
        if(!src&&book.file_name)src=(sources||[]).find(s=>norm(s.filename)===norm(book.file_name));

        const metaBase={
          textbook_id:book.id,
          material_kind:'taskbook',
          task_source_force:true,
          task_source_family:'school57',
          task_source_grade:grade,
          task_source_repair_version:VERSION
        };
        const patch={
          title:`Задачник 57 школы. ${grade} класс`,
          filename:book.file_name||src?.filename||`${grade}-57.pdf`,
          storage_bucket:src?.storage_bucket||'textbooks',
          storage_path:book.file_path||src?.storage_path||null,
          grade:grade,grade_from:grade,grade_to:grade,
          subject:'mathematics',subject_title:'Математика',
          material_kind:'taskbook',
          authors:book.author||src?.authors||null,
          is_active:true,
          meta:{...(src?.meta||{}),...metaBase}
        };

        if(src){
          if(!src.ocr_status||['not_needed','done','error','failed'].includes(String(src.ocr_status))) {
            patch.ocr_status='pending';patch.ocr_error=null;
          }
          const {error}=await c.from('task_bank_sources').update(patch).eq('id',src.id);
          if(error)throw error;repaired++;
        }else{
          const row={
            external_key:`school57-${grade}-taskbook-${book.id}`,
            ...patch,
            level:'mixed',source_kind:'pdf',text_layer_status:'unknown',ocr_status:'pending',ocr_pages_done:0,ocr_pages_total:null,page_count:null,
            file_size_bytes:Number(book.file_size||0)||null
          };
          const {error}=await c.from('task_bank_sources').insert(row);
          if(error)throw error;created++;
        }
        try{await c.from('textbooks').update({material_kind:'taskbook'}).eq('id',book.id);}catch{}
        readyGrades.push(grade);
      }

      const unique=[...new Set(readyGrades)].sort((a,b)=>a-b);
      state.last={version:VERSION,found:target.length,ready:unique.length,grades:unique,repaired,created,missing:[5,6,7,8].filter(g=>!unique.includes(g))};
      if(unique.length<4){
        MR().toast?.(`Задачники 57 школы: найдено ${unique.length}/4. Не найдены классы: ${state.last.missing.join(', ')||'—'}.`);
      }else if(repaired||created){
        MR().toast?.('Задачники 57 школы: все 4 источника готовы к индексации.');
      }
      return state.last;
    }finally{state.busy=false;}
  }

  window.MathroomTaskbookRepair2914={version:VERSION,state,repair,isSchool57Book,gradeOf};
  setTimeout(()=>repair().catch(e=>console.warn('[Mathroom 29.14 taskbook repair]',e)),1800);
})();
