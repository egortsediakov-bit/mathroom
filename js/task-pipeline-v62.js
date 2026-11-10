(()=> {
  const API={
    async render(ctx){
      const {app,shell,bindShell,S,sb,esc,nl,toast,fail,loadTeacher,renderBank}=ctx;
      const prefill=S.taskPipelinePrefill||{};
      let mode=prefill.mode==='similar'?'similar':'topic';
      let sourceExerciseId=String(prefill.sourceExerciseId||'');
      S.taskPipelinePrefill=null;
      let health={ai_configured:false,model:'',validator_model:''};
      let jobs=[],candidates=[],loading=false,activeFilter='all';

      const q=id=>document.getElementById(id);
      const topicById=id=>(S.topics||[]).find(t=>String(t.id)===String(id));
      const exerciseById=id=>(S.exercises||[]).find(x=>String(x.id)===String(id));
      const diffLabel=v=>v==='advanced'?'Сложная':v==='medium'?'Средняя':v==='mixed'?'Смешанная':'Базовая';
      const statusLabel=v=>({ready:'Готова',review:'Проверить',rejected:'Отклонена',accepted:'В банке',duplicate:'Дубликат'}[v]||v);
      const pct=v=>Math.round(Number(v||0)*100);
      const icon=name=>{
        const m={
          spark:'<path d="m12 3 1.2 4.1L17 8.3l-3.8 1.5L12 14l-1.2-4.2L7 8.3l3.8-1.2L12 3Z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.7.8-2.3Z"/>',
          clone:'<rect x="4" y="4" width="11" height="11" rx="2"/><rect x="9" y="9" width="11" height="11" rx="2"/>',
          review:'<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h5"/><path d="m14 17 1.4 1.4L19 15"/>',
          shield:'<path d="M12 3 19 6v5c0 4.7-2.8 8.2-7 10-4.2-1.8-7-5.3-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>'
        };
        return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(m[name]||m.spark)+'</svg>';
      };

      const top='<div class="mr-pipe-top"><button id="pipeBack" class="ghost">← В банк задач</button><button id="pipeRefresh">↻ Обновить</button></div>';
      app.innerHTML=shell(`
        <div class="mr-pipeline">
          <section class="mr-pipe-hero">
            <div class="mr-pipe-hero-main"><span class="mr-pipe-hero-icon">${icon('spark')}</span><div><span class="mr-pipe-kicker">КОНВЕЙЕР ЗАДАЧ</span><h2>Пополнение банка без ручной рутины</h2><p>Генерируем задачи, независимо перепроверяем ответы, отсеиваем сомнительные и только после этого добавляем в основной банк.</p></div></div>
            <div class="mr-pipe-health" id="pipeHealth"><span class="dot"></span><div><b>Проверяем AI…</b><small>Подключение и модель</small></div></div>
          </section>
          <div class="mr-pipe-tabs">
            <button data-pipe-mode="topic" class="${mode==='topic'?'active':''}">${icon('spark')}<span>Создать по теме</span></button>
            <button data-pipe-mode="similar" class="${mode==='similar'?'active':''}">${icon('clone')}<span>Похожие задачи</span></button>
            <button data-pipe-mode="review">${icon('review')}<span>На проверке</span><b id="pipeReviewCount">0</b></button>
          </div>
          <section id="pipeCreate" class="mr-pipe-card">
            <div class="mr-pipe-head"><span>${icon(mode==='similar'?'clone':'spark')}</span><div><h3 id="pipeCreateTitle"></h3><p id="pipeCreateSub"></p></div></div>
            <div id="pipeTopicMode" class="mr-pipe-form">
              <label><span>Класс</span><select id="pipeGrade"></select></label>
              <label class="wide"><span>Тема</span><select id="pipeTopic"></select></label>
              <label><span>Сложность</span><select id="pipeDifficulty"><option value="basic">Базовая</option><option value="medium" selected>Средняя</option><option value="advanced">Сложная</option><option value="mixed">Смешанная</option></select></label>
              <label><span>Количество</span><select id="pipeCount">${[3,5,7,10].map(n=>`<option value="${n}" ${n===5?'selected':''}>${n} задач</option>`).join('')}</select></label>
            </div>
            <div id="pipeSimilarMode" class="mr-pipe-source-box" style="display:none"></div>
            <div class="mr-pipe-run">
              <div class="mr-pipe-rule"><span>${icon('shield')}</span><div><b>Двойная проверка включена</b><small>AI сначала создаёт задачи, затем отдельным запросом решает их заново и сравнивает ответы.</small></div></div>
              <button id="pipeGenerate" class="mr-pipe-primary">✦ Запустить конвейер</button>
            </div>
            <div id="pipeProgress" class="mr-pipe-progress" hidden><span></span><div><b>Конвейер работает…</b><small>Генерация и независимая проверка могут занять немного времени.</small></div></div>
          </section>
          <section id="pipeQueue" class="mr-pipe-card">
            <div class="mr-pipe-queue-head"><div class="mr-pipe-head compact"><span>${icon('review')}</span><div><h3>Карантин задач</h3><p>В основной банк ничего не попадает без вашего подтверждения</p></div></div><button id="pipeAcceptReady" class="mr-pipe-accept">✓ Принять все надёжные</button></div>
            <div class="mr-pipe-stats" id="pipeStats"></div>
            <div class="mr-pipe-filters"><button data-filter="all" class="active">Все</button><button data-filter="ready">Готовы</button><button data-filter="review">Нужна проверка</button><button data-filter="rejected">Отклонены</button><button data-filter="accepted">Приняты</button></div>
            <div id="pipeCandidates" class="mr-pipe-candidates"><div class="mr-pipe-empty">Загружаем очередь…</div></div>
          </section>
          <section class="mr-pipe-history mr-pipe-card">
            <div class="mr-pipe-head compact"><span>${icon('spark')}</span><div><h3>Последние запуски</h3><p>История генерации и результаты автоматической проверки</p></div></div>
            <div id="pipeJobs"></div>
          </section>
        </div>`,'Пополнить банк задач','Автоматическая генерация, проверка и создание похожих задач',top);
      bindShell();

      q('pipeBack').onclick=()=>{S.view='bank';renderBank()};
      q('pipeRefresh').onclick=()=>reload();
      document.querySelectorAll('[data-pipe-mode]').forEach(b=>b.onclick=()=>{
        mode=b.dataset.pipeMode;
        document.querySelectorAll('[data-pipe-mode]').forEach(x=>x.classList.toggle('active',x===b));
        updateMode();
        if(mode==='review')q('pipeQueue').scrollIntoView({behavior:'smooth',block:'start'});
      });

      const grades=[...new Set((S.topics||[]).map(t=>Number(t.grade)).filter(Boolean))].sort((a,b)=>a-b);
      const sourceTopic=topicById(exerciseById(sourceExerciseId)?.topic_id);
      const defaultGrade=Number(sourceTopic?.grade||S.students?.[0]?.grade||5);
      q('pipeGrade').innerHTML=grades.map(g=>`<option value="${g}" ${g===defaultGrade?'selected':''}>${g} класс</option>`).join('');
      q('pipeGrade').onchange=fillTopics;
      fillTopics();
      if(sourceTopic){q('pipeGrade').value=String(sourceTopic.grade);fillTopics();q('pipeTopic').value=String(sourceTopic.id)}
      updateMode();

      document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{activeFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));drawCandidates()});
      q('pipeGenerate').onclick=runGeneration;
      q('pipeAcceptReady').onclick=acceptReady;

      async function reload(){
        try{
          const h=await sb.functions.invoke('task-pipeline',{body:{action:'health'}});
          const j=await sb.from('task_generation_jobs').select('*').order('created_at',{ascending:false}).limit(30);
          const c=await sb.from('task_candidates').select('*').order('created_at',{ascending:false}).limit(250);
          health=h.error?{ai_configured:false,error:h.error.message||'Ошибка AI'}:(h.data||health);
          if(j.error)throw j.error;if(c.error)throw c.error;
          jobs=j.data||[];candidates=c.data||[];
          drawHealth();drawStats();drawCandidates();drawJobs();
        }catch(e){fail(e)}
      }

      function fillTopics(){
        const grade=Number(q('pipeGrade').value||defaultGrade);
        const rows=(S.topics||[]).filter(t=>Number(t.grade)===grade);
        const current=q('pipeTopic').value;
        q('pipeTopic').innerHTML=rows.length?rows.map(t=>`<option value="${t.id}">${esc(t.section||'Математика')} · ${esc(t.title)}</option>`).join(''):'<option value="">Тем пока нет</option>';
        if(rows.some(t=>String(t.id)===String(current)))q('pipeTopic').value=current;
      }

      function updateMode(){
        const similar=mode==='similar';
        q('pipeTopicMode').style.display=similar?'none':'grid';
        q('pipeSimilarMode').style.display=similar?'block':'none';
        q('pipeCreateTitle').textContent=similar?'Создать похожие задачи':'Создать задачи по теме';
        q('pipeCreateSub').textContent=similar?'Берём математическую идею выбранной задачи и создаём новые варианты':'Выбираем класс, тему, сложность и количество';
        if(similar){
          const src=exerciseById(sourceExerciseId),tp=topicById(src?.topic_id);
          q('pipeSimilarMode').innerHTML=src?`<div class="mr-pipe-source-label">ИСХОДНАЯ ЗАДАЧА</div><h4>${esc(src.title||tp?.title||'Задача')}</h4><div class="mr-pipe-source-text">${nl(src.content||'')}</div><div class="mr-pipe-source-meta"><span>${tp?.grade||'?'} класс</span><span>${esc(tp?.title||'Без темы')}</span><span>${diffLabel(src.difficulty)}</span></div>`:'<div class="mr-pipe-no-source"><b>Сначала выберите исходную задачу</b><p>Откройте «Банк задач» и нажмите «Похожие» у нужной задачи — сюда сразу подставится условие и тема.</p><button id="pipeChooseSource">Перейти в банк задач</button></div>';
          q('pipeChooseSource')?.addEventListener('click',()=>{S.view='bank';renderBank()});
        }
      }

      function drawHealth(){
        const host=q('pipeHealth'),ok=!!health.ai_configured;
        host.classList.toggle('ok',ok);host.classList.toggle('warn',!ok);
        host.innerHTML=`<span class="dot"></span><div><b>${ok?'AI подключён':'Нужен API-ключ'}</b><small>${ok?esc(health.model||'модель')+' · независимая проверка '+esc(health.validator_model||health.model||''):'Инфраструктура готова, генерация пока заблокирована'}</small></div>`;
        q('pipeGenerate').disabled=!ok;
        q('pipeGenerate').title=ok?'':'Добавьте OPENAI_API_KEY в секреты Supabase';
      }

      function drawStats(){
        const count=s=>candidates.filter(x=>x.status===s).length;
        q('pipeReviewCount').textContent=String(count('review')+count('ready'));
        q('pipeStats').innerHTML=`<div><span class="ready"></span><b>${count('ready')}</b><small>готовы</small></div><div><span class="review"></span><b>${count('review')}</b><small>проверить</small></div><div><span class="bad"></span><b>${count('rejected')+count('duplicate')}</b><small>отсеяно</small></div><div><span class="done"></span><b>${count('accepted')}</b><small>в банке</small></div>`;
        q('pipeAcceptReady').disabled=!candidates.some(x=>x.status==='ready');
      }

      function candidateMatch(c){
        if(activeFilter==='all')return true;
        if(activeFilter==='rejected')return c.status==='rejected'||c.status==='duplicate';
        return c.status===activeFilter;
      }

      function checkLine(c){
        const v=c.validation||{},items=[['Ответ',v.answer_match===true],['Однозначность',v.well_posed===true],['Тема/класс',v.curriculum_fit===true],['Не дубликат',Number(v.duplicate_risk||0)<.92]];
        return items.map(([n,ok])=>`<span class="${ok?'ok':'bad'}">${ok?'✓':'×'} ${n}</span>`).join('');
      }

      function drawCandidates(){
        const host=q('pipeCandidates'),arr=candidates.filter(candidateMatch);
        if(!arr.length){host.innerHTML='<div class="mr-pipe-empty">В этой категории пока ничего нет.</div>';return}
        host.innerHTML=arr.map(c=>{
          const tp=topicById(c.topic_id),v=c.validation||{},notes=Array.isArray(v.notes)?v.notes:[],canAccept=['ready','review','rejected'].includes(c.status);
          return `<article class="mr-pipe-candidate status-${c.status}">
            <div class="mr-pipe-candidate-top"><div class="mr-pipe-score"><b>${pct(c.confidence)}%</b><small>уверенность</small></div><div class="mr-pipe-candidate-title"><div><span class="mr-pipe-status">${statusLabel(c.status)}</span><span>${tp?.grade||'?'} класс</span><span>${diffLabel(c.difficulty)}</span></div><h4>${esc(tp?.title||'Без темы')}</h4></div></div>
            <div class="mr-pipe-condition">${nl(c.content)}</div>
            <div class="mr-pipe-answer"><b>Ответ:</b> ${esc(c.answer||'—')}</div>
            <div class="mr-pipe-checks">${checkLine(c)}</div>
            ${notes.length?`<div class="mr-pipe-notes">${notes.slice(0,3).map(n=>`<span>• ${esc(n)}</span>`).join('')}</div>`:''}
            <details><summary>Показать решение и техпроверку</summary><div class="mr-pipe-solution">${nl(c.solution||'Решение не заполнено')}</div><div class="mr-pipe-tech">Независимый ответ: <b>${esc(v.solved_answer||'—')}</b> · риск дубля ${pct(v.duplicate_risk)}%</div></details>
            <div class="mr-pipe-actions">
              ${canAccept?`<button class="accept" data-accept="${c.id}">✓ Принять в банк</button>`:''}
              ${c.status!=='accepted'&&c.status!=='duplicate'?`<button data-reject="${c.id}">Отклонить</button>`:''}
              ${c.status==='accepted'&&c.exercise_id?'<span class="accepted-label">✓ Уже в основном банке</span>':''}
            </div>
          </article>`;
        }).join('');
        host.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>acceptOne(b.dataset.accept,b));
        host.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rejectOne(b.dataset.reject,b));
      }

      function drawJobs(){
        const host=q('pipeJobs');
        if(!jobs.length){host.innerHTML='<div class="mr-pipe-empty small">Запусков ещё не было.</div>';return}
        host.innerHTML=jobs.slice(0,12).map(j=>{
          const tp=topicById(j.topic_id),src=exerciseById(j.source_exercise_id);
          return `<div class="mr-pipe-job"><span class="state ${j.status}"></span><div><b>${j.mode==='similar'?'Похожие':'По теме'} · ${esc(tp?.title||'Тема')}</b><small>${j.mode==='similar'&&src?esc(src.title||String(src.content||'').slice(0,45))+' · ':''}${j.requested_count} шт. · ${diffLabel(j.difficulty)}</small></div><div class="mr-pipe-job-counts"><span>${j.ready_count||0} готово</span><span>${j.review_count||0} проверить</span><span>${j.accepted_count||0} принято</span></div></div>`;
        }).join('');
      }

      async function runGeneration(){
        if(loading||!health.ai_configured)return;
        try{
          let topicId,srcId=null;
          if(mode==='similar'){const src=exerciseById(sourceExerciseId);if(!src)return toast('Сначала выбери исходную задачу в банке');topicId=src.topic_id;srcId=src.id}
          else topicId=q('pipeTopic').value;
          if(!topicId)return toast('Выбери тему');
          loading=true;q('pipeGenerate').disabled=true;q('pipeProgress').hidden=false;
          const body={teacher_id:S.user.id,topic_id:topicId,mode:mode==='similar'?'similar':'topic',source_exercise_id:srcId,difficulty:q('pipeDifficulty').value,requested_count:Number(q('pipeCount').value)||5,status:'queued',params:{source:'mathroom-ui-v1'}};
          const {data:job,error}=await sb.from('task_generation_jobs').insert(body).select().single();
          if(error)throw error;
          const inv=await sb.functions.invoke('task-pipeline',{body:{action:'generate',job_id:job.id}});
          if(inv.error)throw inv.error;if(inv.data?.error)throw new Error(inv.data.error);
          toast(`Готово: ${inv.data?.generated||0} задач прошли конвейер`);
          mode='review';document.querySelectorAll('[data-pipe-mode]').forEach(x=>x.classList.toggle('active',x.dataset.pipeMode==='review'));
          await reload();q('pipeQueue').scrollIntoView({behavior:'smooth',block:'start'});
        }catch(e){const msg=e?.message||String(e);if(/AI_NOT_CONFIGURED|503/.test(msg))toast('AI пока не подключён: нужен OPENAI_API_KEY в Supabase');else fail(e);await reload()}
        finally{loading=false;q('pipeProgress').hidden=true;drawHealth()}
      }

      async function acceptOne(id,button){
        button.disabled=true;
        try{const {data,error}=await sb.functions.invoke('task-pipeline',{body:{action:'accept',candidate_id:id}});if(error)throw error;if(data?.error)throw new Error(data.error);await loadTeacher();toast('Задача добавлена в основной банк');await reload()}
        catch(e){fail(e);button.disabled=false}
      }
      async function rejectOne(id,button){
        button.disabled=true;
        try{const {data,error}=await sb.functions.invoke('task-pipeline',{body:{action:'reject',candidate_id:id}});if(error)throw error;if(data?.error)throw new Error(data.error);toast('Задача отклонена');await reload()}
        catch(e){fail(e);button.disabled=false}
      }
      async function acceptReady(){
        const ready=candidates.filter(x=>x.status==='ready');if(!ready.length)return;
        if(!confirm(`Добавить ${ready.length} надёжных задач в основной банк?`))return;
        q('pipeAcceptReady').disabled=true;
        try{const ids=[...new Set(ready.map(x=>x.job_id))];let total=0;for(const jobId of ids){const {data,error}=await sb.functions.invoke('task-pipeline',{body:{action:'accept_ready',job_id:jobId}});if(error)throw error;if(data?.error)throw new Error(data.error);total+=Number(data?.accepted||0)}await loadTeacher();toast(`В основной банк добавлено: ${total}`);await reload()}
        catch(e){fail(e)}finally{drawStats()}
      }

      await reload();
    }
  };
  window.MathroomTaskPipelineV62=API;
})();