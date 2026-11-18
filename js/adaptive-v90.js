/* Mathroom v90 — evidence-aware adaptive sets. No student data leaves Supabase. */
(()=>{
  'use strict';
  const API={};
  const num=v=>(v===null||v===undefined||v==='')?null:(Number.isFinite(Number(v))?Number(v):null);
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const weight=(row)=>{
    const m=num(row.mastery),n=Math.max(0,num(row.evidence_count)||0);
    if(m===null||n<1)return -1;
    const normalized=m<=1&&m>0?m*100:m;
    return Math.max(0,100-normalized)*Math.min(1,n/3);
  };
  const quota=(rows,total)=>{
    const count=Math.max(5,Math.min(30,Math.round(Number(total)||10)));
    if(!rows.length)return [];
    const selected=rows.slice(0,Math.min(4,rows.length,count));
    if(selected.length===1)return [{row:selected[0],count:Math.min(20,count)}];
    const weights=selected.map(x=>Math.max(1,weight(x)));
    const sum=weights.reduce((a,b)=>a+b,0);
    const out=selected.map((r,i)=>({row:r,count:1,frac:weights[i]/sum*(count-selected.length)}));
    let left=count-selected.length;
    for(const x of out){const n=Math.floor(x.frac);x.count+=n;left-=n;}
    out.sort((a,b)=>(b.frac%1)-(a.frac%1));
    for(let i=0;i<left;i++)out[i%out.length].count++;
    // Multi-topic UI currently limits each topic quota to 20.
    for(let guard=0;guard<100;guard++){
      const over=out.find(x=>x.count>20),under=out.find(x=>x.count<20 && x!==over);
      if(!over||!under)break;
      over.count--;under.count++;
    }
    return out.map(x=>({row:x.row,count:x.count}));
  };
  API.recommend=async ({S,sb},studentId,total=10)=>{
    const student=(S.students||[]).find(s=>String(s.id)===String(studentId));
    if(!student)return {rows:[],reason:'Не выбран ученик'};
    const available=new Map();
    const taskCount=new Map();
    for(const ex of S.exercises||[]){
      if(ex.kind!=='task'||ex.is_draft||!String(ex.answer||'').trim())continue;
      const id=String(ex.topic_id),topic=(S.topics||[]).find(t=>String(t.id)===id);
      if(!topic||Number(topic.grade)!==Number(student.grade))continue;
      available.set(id,topic);taskCount.set(id,(taskCount.get(id)||0)+1);
    }
    const {data,error}=await sb.from('student_progress_snapshots')
      .select('topic_snapshot,created_at').eq('teacher_id',S.user.id)
      .eq('student_id',student.id).order('created_at',{ascending:false}).limit(1);
    if(error)throw error;
    const snapshot=Array.isArray(data?.[0]?.topic_snapshot)?data[0].topic_snapshot:[];
    let graded=[];
    try{
      graded=await window.MathroomErrorDiagnosticsV91?.read?.({S,sb},student.id)||[];
    }catch(e){console.warn('[Mathroom diagnostics] graded work unavailable',e)}
    // Real checked work overrides aggregate diagnostic estimates when there are at least 2 checked exercises.
    const merged=new Map(snapshot.map(x=>[String(x.topic_id),{...x,source:'progress-snapshot'}]));
    for(const row of graded)if(row.evidence_count>=2 || !merged.has(String(row.topic_id)))
      merged.set(String(row.topic_id),row);
    const observed=[...merged.values()];
    const rows=observed.filter(x=>available.has(String(x.topic_id)) && num(x.evidence_count)>0 && num(x.mastery)!==null)
      .map(x=>({...x,topic:available.get(String(x.topic_id)),available:taskCount.get(String(x.topic_id)),priority:weight(x)}))
      .sort((a,b)=>b.priority-a.priority || (num(a.mastery)||0)-(num(b.mastery)||0));
    const chosen=quota(rows,total);
    return {rows:chosen,observed:observed.length,verified:rows.length,at:data?.[0]?.created_at||null,
      reason:!observed.length?'Нет проверенных домашних работ и диагностики':!rows.length?'Нет оценённых тем с задачами в банке':'',
      student};
  };
  API.open=({S,sb,modal,toast,openBuilder})=>{
    const students=(S.students||[]).filter(s=>s.active!==false);
    if(!students.length)return toast('Сначала добавь ученика');
    const root=modal('<section class="mr-adaptive-panel"><h2>Подобрать задачи ученику</h2><p class="muted">Подбор по последней диагностике. Темы с недостаточным количеством данных не считаем доказанными пробелами.</p>'+
      '<div class="grid cols2"><div class="field"><label>Ученик</label><select id="adaptStudent">'+students.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(s.grade)+' кл.</option>').join('')+'</select></div>'+
      '<div class="field"><label>Количество задач</label><select id="adaptCount">'+[5,8,10,15,20,30].map(n=>'<option value="'+n+'" '+(n===10?'selected':'')+'>'+n+'</option>').join('')+'</select></div></div>'+
      '<div id="adaptStatus" class="notice" style="margin:12px 0">Собираем данные…</div><div id="adaptRows" style="display:grid;gap:8px"></div>'+
      '<div class="actions" style="margin-top:16px"><button id="adaptBuild" class="btn primary" disabled>✦ Собрать по слабым темам</button></div></section>','mr-adaptive-dialog');
    const q=s=>root.querySelector(s);
    q('#adaptStudent').value=String(S.selectedStudent||students[0].id);
    let current=null,serial=0;
    const load=async()=>{
      const token=++serial; q('#adaptBuild').disabled=true;q('#adaptStatus').textContent='Анализируем результаты…';q('#adaptRows').innerHTML='';
      try{
        const rec=await API.recommend({S,sb},q('#adaptStudent').value,Number(q('#adaptCount').value));
        if(token!==serial)return;
        current=rec;
        if(rec.reason){q('#adaptStatus').textContent=rec.reason+'. Сначала проведи и оцени задания — Mathroom не будет придумывать успеваемость.';return;}
        q('#adaptStatus').textContent='Оценённых тем: '+rec.verified+' · выбрано для повторения: '+rec.rows.length+'. Рекомендация, а не автоматическая оценка знаний.';
        q('#adaptRows').innerHTML=rec.rows.map(({row,count})=>{
          const label=row.source==='graded-homework'
            ?('Проверено '+row.graded_total+' задач, ошибок: '+row.graded_errors)
            :('Данные диагностического профиля · наблюдений '+Math.round(num(row.evidence_count)||0));
          const skills=Array.isArray(row.skill_errors)&&row.skill_errors.length?
            '<div class="small muted">Типичные ошибки: '+row.skill_errors.map(x=>esc(x.name)+' ('+x.errors+'/'+x.total+')').join('; ')+'</div>':'';
          return '<div class="card" style="padding:10px 12px"><b>'+esc(row.topic.title)+'</b><span class="muted" style="float:right">'+count+' задач</span>'+
            '<div class="small muted">Успешность: '+Math.round(num(row.mastery)<=1&&num(row.mastery)>0?num(row.mastery)*100:num(row.mastery))+'% · '+esc(label)+' · в банке: '+row.available+'</div>'+skills+'</div>';
        }).join('');
        q('#adaptBuild').disabled=!rec.rows.length;
      }catch(e){if(token!==serial)return;q('#adaptStatus').textContent='Не удалось загрузить диагностику: '+(e?.message||e);}
    };
    q('#adaptStudent').onchange=load;q('#adaptCount').onchange=load;
    q('#adaptBuild').onclick=()=>{
      if(!current?.rows?.length)return;
      const rows=current.rows.map(({row,count})=>({topic_id:row.topic.id,count,topic_snapshot:{id:row.topic.id,title:row.topic.title,grade:row.topic.grade,section:row.topic.section||''}}));
      root.remove();
      const single=rows.length===1;
      openBuilder({grade:current.student.grade,recipe:single
        ?{mode:'single',grade:current.student.grade,difficulty_mode:'balanced',allow_templates:true,
          config:{topic_id:rows[0].topic_id,count:Math.min(20,rows[0].count),topic_snapshot:rows[0].topic_snapshot}}
        :{mode:'multi',grade:current.student.grade,difficulty_mode:'balanced',allow_templates:true,config:{rows}}
      });
    };
    load();
  };
  window.MathroomAdaptiveV90=API;
})();
