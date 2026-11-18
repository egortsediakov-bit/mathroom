// Mathroom v90: scheduled, opt-in task replenishment.
// The cron secret is in Supabase Vault, not in this repository.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const MAX_BATCH = 5;
const reply = (value: unknown, status=200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type':'application/json','cache-control':'no-store'}
});
const message = (e:unknown) => e instanceof Error ? e.message : String(e);
const asInt = (x:unknown, fallback:number) => Number.isFinite(Number(x)) ? Math.floor(Number(x)) : fallback;

Deno.serve(async req => {
  if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  // Never enable JWT-less access without the Vault-backed header check.
  const token=req.headers.get('x-mr-supply-cron')||'';
  if(!URL||!SERVICE||!token)return reply({error:'UNAUTHORIZED'},401);
  const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const {data:allowed,error:authError}=await admin.rpc('task_supply_cron_auth',{p_token:token});
    if(authError||allowed!==true)return reply({error:'UNAUTHORIZED'},401);
    if(!Deno.env.get('OPENAI_API_KEY'))return reply({ok:true,skipped:'AI_NOT_CONFIGURED'});

    const {data:settings,error:settingsError}=await admin.from('task_supply_settings')
      .select('teacher_id,auto_enabled,auto_focus_grades,daily_ai_limit,auto_accept_ready,last_auto_run_at')
      .eq('auto_enabled',true).order('last_auto_run_at',{ascending:true,nullsFirst:true}).limit(30);
    if(settingsError)throw settingsError;
    for(const setting of settings||[]){
      const teacherId=String(setting.teacher_id||'');
      if(!teacherId)continue;
      const start=new Date();start.setUTCHours(0,0,0,0);
      const {data:dayJobs,error:jobsError}=await admin.from('task_generation_jobs')
        .select('id,requested_count,status,params,created_at')
        .eq('teacher_id',teacherId).gte('created_at',start.toISOString())
        .order('created_at',{ascending:false}).limit(500);
      if(jobsError)throw jobsError;
      const autoJobs=(dayJobs||[]).filter((j:any)=>j.params?.source==='auto-supply-v90');
      const used=autoJobs.reduce((s:number,j:any)=>s+Math.max(0,asInt(j.requested_count,0)),0);
      const remaining=Math.max(0,Math.min(100,asInt(setting.daily_ai_limit,10))-used);
      if(remaining===0)continue;
      if((dayJobs||[]).some((j:any)=>['queued','running'].includes(j.status)))continue;

      let grades=(Array.isArray(setting.auto_focus_grades)?setting.auto_focus_grades:[])
        .map((g:unknown)=>asInt(g,0)).filter((g:number)=>g>=1&&g<=11);
      if(!grades.length){
        const {data:students,error:studentsError}=await admin.from('students')
          .select('grade').eq('teacher_id',teacherId).eq('active',true);
        if(studentsError)throw studentsError;
        grades=(students||[]).map((s:any)=>asInt(s.grade,0)).filter((g:number)=>g>=1&&g<=11);
      }
      grades=[...new Set(grades)];
      if(!grades.length)continue; // No explicit scope or active student: don't spend credits.
      const {data:gaps,error:gapError}=await admin.rpc('task_supply_next_gap',{
        p_teacher:teacherId,p_grades:grades
      });
      if(gapError)throw gapError;
      const gap=(gaps||[])[0];
      if(!gap||!gap.topic_id||asInt(gap.shortage,0)<=0)continue;

      const count=Math.min(MAX_BATCH,remaining,Math.max(0,asInt(gap.shortage,0)));
      const {data:job,error:insertError}=await admin.from('task_generation_jobs').insert({
        teacher_id:teacherId,topic_id:gap.topic_id,mode:'topic',source_exercise_id:null,
        difficulty:gap.difficulty,requested_count:count,status:'queued',
        params:{source:'auto-supply-v90',scheduled_at:new Date().toISOString(),grades}
      }).select('id').single();
      if(insertError)throw insertError;
      await admin.from('task_supply_settings').update({
        last_auto_run_at:new Date().toISOString(),last_auto_error:null,updated_at:new Date().toISOString()
      }).eq('teacher_id',teacherId);
      const endpoint=URL+'/functions/v1/task-pipeline';
      const invoke=async(action:string)=>{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{authorization:'Bearer '+SERVICE,apikey:SERVICE,'content-type':'application/json','x-mr-supply-cron':token},
          body:JSON.stringify({action,job_id:job.id})
        });
        const body=await response.json().catch(()=>({error:'INVALID_PIPELINE_RESPONSE'}));
        if(!response.ok||body.ok===false)throw new Error(body.error||'PIPELINE_'+response.status);
        return body;
      };
      try{
        const generation=await invoke('generate');
        let accepted=0;
        if(setting.auto_accept_ready&&Number(generation.ready||0)>0){
          const accept=await invoke('accept_ready');
          accepted=Number(accept.accepted||0);
        }
        return reply({ok:true,teacher_processed:true,generated:generation.generated||0,accepted,job_id:job.id});
      }catch(err){
        const errorText=message(err).slice(0,500);
        await admin.from('task_supply_settings').update({last_auto_error:errorText}).eq('teacher_id',teacherId);
        return reply({ok:false,error:'GENERATION_FAILED',detail:errorText},502);
      }
    }
    return reply({ok:true,skipped:'NO_ELIGIBLE_GAPS_OR_LIMIT_REACHED'});
  }catch(e){
    return reply({ok:false,error:'WORKER_ERROR',detail:message(e).slice(0,500)},500);
  }
});
