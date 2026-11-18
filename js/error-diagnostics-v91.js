/* Mathroom v91: evidence from graded homework by topic and skill.
   Uses authenticated RLS reads only; never sends student records to AI. */
(()=>{
  'use strict';
  const API={};
  const normalized=s=>String(s??'').trim().toLocaleLowerCase('ru');
  API.analyze=(homeworks,items,exerciseById)=>{
    const byHomework=new Map(homeworks.map(h=>[String(h.id),h]));
    const topics=new Map();
    for(const item of items){
      if(typeof item.is_correct!=='boolean')continue;
      const h=byHomework.get(String(item.homework_id));
      if(!h||!['submitted','reviewed'].includes(String(h.status)))continue;
      const source=exerciseById.get(String(item.source_exercise_id||''));
      const topicId=String(item.builder_meta?.smart_topic?.id||source?.topic_id||h.topic_id||'');
      if(!topicId)continue;
      let row=topics.get(topicId);
      if(!row){row={topic_id:topicId,correct:0,total:0,errors:0,skills:new Map(),source:'graded-homework'};topics.set(topicId,row);}
      row.total++;
      if(item.is_correct)row.correct++;else row.errors++;
      const tags=Array.isArray(item.tags)?item.tags:[];
      const skillTag=tags.map(String).find(t=>/^(?:skill|навык|подтема)\s*:/iu.test(t))||'';
      const skill=skillTag?skillTag.split(':').slice(1).join(':').trim():String(
        item.builder_meta?.subtopic||item.category||''
      ).trim();
      if(!skill)continue;
      const key=normalized(skill);
      const x=row.skills.get(key)||{name:skill,total:0,errors:0};
      x.total++;if(!item.is_correct)x.errors++;
      row.skills.set(key,x);
    }
    return [...topics.values()].map(r=>({
      topic_id:r.topic_id,
      evidence_count:r.total,mastery:Math.round(100*r.correct/r.total),
      graded_total:r.total,graded_correct:r.correct,graded_errors:r.errors,
      source:r.source,
      skill_errors:[...r.skills.values()].filter(s=>s.errors>0)
        .sort((a,b)=>b.errors-a.errors||b.total-a.total).slice(0,3)
    }));
  };
  API.read=async ({S,sb},studentId)=>{
    // Scope the query to the selected pupil's most recent submitted work.
    const homeworks=(S.homeworks||[]).filter(h=>
      String(h.student_id)===String(studentId) &&
      String(h.teacher_id)===String(S.user?.id) &&
      ['submitted','reviewed'].includes(String(h.status))
    ).sort((a,b)=>String(b.submitted_at||b.created_at||'').localeCompare(String(a.submitted_at||a.created_at||'')))
      .slice(0,80);
    if(!homeworks.length)return [];
    const ids=homeworks.map(h=>h.id);
    const all=[];
    for(let i=0;i<ids.length;i+=50){
      const {data,error}=await sb.from('homework_items')
        .select('id,homework_id,is_correct,source_exercise_id,category,tags,builder_meta')
        .in('homework_id',ids.slice(i,i+50))
        .not('is_correct','is',null).limit(1000);
      if(error)throw error;
      all.push(...(data||[]));
    }
    const exercises=new Map((S.exercises||[]).map(e=>[String(e.id),e]));
    return API.analyze(homeworks,all,exercises);
  };
  window.MathroomErrorDiagnosticsV91=API;
})();
