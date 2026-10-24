(()=>{
  const ICONS={
    plus:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>',
    warn:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    calendar:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
    play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
    book:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5c3.2-1.2 5.9-.7 8 1.1V20c-2.1-1.8-4.8-2.3-8-1.1V5Z"/><path d="M20 5c-3.2-1.2-5.9-.7-8 1.1V20c2.1-1.8 4.8-2.3 8-1.1V5Z"/></svg>',
    arrow:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>'
  };
  const icon=n=>'<span class="mr-dash-icon">'+(ICONS[n]||'')+'</span>';
  const escDash=v=>typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const sameLocalDay=(a,b)=>a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  const time=v=>new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const shortDate=v=>new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  const initials=name=>String(name||'У').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'У';
  const studentById=id=>(S.students||[]).find(x=>String(x.id)===String(id));
  const topicById=id=>(S.topics||[]).find(x=>String(x.id)===String(id));

  function teacherName(){
    const raw=String(S.teacher?.name||S.teacher?.full_name||S.teacher?.display_name||S.teacher?.email||'').trim();
    if(!raw)return '';
    return raw.includes('@')?raw.split('@')[0]:raw.split(/\s+/)[0];
  }
  function lessonStudent(l){return l?.students?.name||studentById(l?.student_id)?.name||'Ученик'}
  function lessonGrade(l){return l?.students?.grade||studentById(l?.student_id)?.grade||''}
  function lessonTopic(l){return l?.topics?.title||topicById(l?.topic_id)?.title||'Без темы'}
  function lessonWhen(l,now){
    if(l?.status==='in_progress')return 'Идёт сейчас';
    const d=new Date(l.scheduled_at),diff=d.getTime()-now;
    if(diff>=0&&diff<60*60*1000){
      const min=Math.max(1,Math.round(diff/60000));
      return 'Через '+min+' '+(min%10===1&&min%100!==11?'минуту':min%10>=2&&min%10<=4&&(min%100<10||min%100>=20)?'минуты':'минут');
    }
    if(sameLocalDay(d,new Date(now)))return 'Сегодня · '+time(l.scheduled_at);
    return shortDate(l.scheduled_at)+' · '+time(l.scheduled_at);
  }
  function todayLessons(){
    const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),now.getDate()),end=new Date(start);end.setDate(end.getDate()+1);
    return (S.lessons||[]).filter(l=>{
      if(!l.scheduled_at||l.status==='cancelled')return false;
      const d=new Date(l.scheduled_at);return d>=start&&d<end;
    }).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  }
  function nextLesson(now){
    return (S.lessons||[]).filter(l=>{
      if(!l.scheduled_at||l.status==='cancelled'||l.status==='completed')return false;
      return l.status==='in_progress'||new Date(l.scheduled_at).getTime()>=now;
    }).sort((a,b)=>{
      if(a.status==='in_progress'&&b.status!=='in_progress')return -1;
      if(b.status==='in_progress'&&a.status!=='in_progress')return 1;
      return new Date(a.scheduled_at)-new Date(b.scheduled_at);
    })[0]||null;
  }
  function attentionItems(now){
    const rows=[];
    const push=(studentId,kind,reason,meta)=>{
      const st=studentById(studentId);
      const name=st?.name||'Ученик';
      const key=String(studentId)+'|'+kind+'|'+reason;
      if(rows.some(x=>x.key===key))return;
      rows.push({key,studentId,kind,name,reason,meta});
    };
    (S.homeworks||[]).forEach(h=>{
      if(h.status==='assigned'&&!h.revision_requested_at&&h.due_at&&new Date(h.due_at).getTime()<now){
        const days=Math.max(1,Math.ceil((now-new Date(h.due_at).getTime())/86400000));
        push(h.student_id,'assignments','Не сдано домашнее задание',days+' '+(days===1?'день':'дн.')+' просрочки');
      }else if(h.status==='submitted'){
        push(h.student_id,'assignments','Домашняя ждёт проверки','На проверке');
      }else if(h.status==='assigned'&&h.revision_requested_at){
        push(h.student_id,'assignments','Работа на доработке','Нужна повторная сдача');
      }
    });
    (S.lessons||[]).forEach(l=>{
      if(['missed','absent','no_show'].includes(String(l.status||''))){
        push(l.student_id,'history','Пропущено занятие',shortDate(l.scheduled_at||new Date()));
      }
    });
    return rows.slice(0,3);
  }
  function openScheduleCreator(){
    S.view='schedule';
    if(typeof renderTeacher==='function')renderTeacher();
    let tries=0;
    const timer=setInterval(()=>{
      const b=document.querySelector('[data-v48-add-main]');
      if(b){clearInterval(timer);b.click();return}
      if(++tries>35)clearInterval(timer);
    },80);
  }
  function navTo(view){
    cleanupAll?.();
    forgetActiveLesson?.();
    S.view=view;
    S.topic=null;
    S.activeLesson=null;
    renderTeacher();
  }
  function nextCard(l,now){
    if(!l)return '<section class="mr-dash-next mr-dash-empty-card"><div class="mr-dash-card-title">'+icon('clock')+'<h2>Ближайший урок</h2></div><div class="mr-dash-empty-copy"><b>Пока ничего не запланировано</b><span>Создай занятие прямо с главной — оно сразу появится в расписании.</span></div><button class="mr-dash-primary" id="mrDashCreateEmpty">'+icon('plus')+'Создать урок сейчас</button></section>';
    const grade=lessonGrade(l);
    return '<section class="mr-dash-next"><div class="mr-dash-card-head"><div class="mr-dash-card-title">'+icon('clock')+'<h2>Ближайший урок</h2></div><span class="mr-dash-next-time">'+escDash(lessonWhen(l,now))+'</span></div><div class="mr-dash-next-body"><div class="mr-dash-avatar large">'+escDash(initials(lessonStudent(l)))+'</div><div class="mr-dash-next-copy"><h3>'+escDash(lessonStudent(l))+'</h3><p>'+escDash(grade?grade+' класс':'Индивидуально')+(grade?' · ':'')+escDash(lessonTopic(l))+'</p><span>'+icon('calendar')+escDash(time(l.scheduled_at))+' · '+Number(l.duration_minutes||50)+' мин</span></div><div class="mr-dash-next-actions"><button class="mr-dash-primary" data-dash-start="'+escDash(l.id)+'">'+icon('play')+(l.status==='in_progress'?'Продолжить урок':'Начать урок')+'</button>'+(l.topic_id?'<button class="mr-dash-secondary" data-dash-topic="'+escDash(l.topic_id)+'">'+icon('book')+'Открыть тему</button>':'')+'</div></div></section>';
  }
  function attentionCard(items){
    return '<section class="mr-dash-attention"><div class="mr-dash-card-head"><div class="mr-dash-card-title">'+icon('warn')+'<h2>Требуют внимания</h2></div>'+(items.length?'<button class="mr-dash-link" id="mrDashAttentionAll">Смотреть все '+icon('arrow')+'</button>':'')+'</div>'+(items.length?'<div class="mr-dash-attention-list">'+items.map(x=>'<button class="mr-dash-attention-row" data-dash-attention="'+escDash(x.kind)+'"><span class="mr-dash-avatar">'+escDash(initials(x.name))+'</span><span class="mr-dash-attention-copy"><b>'+escDash(x.name)+'</b><small>'+escDash(x.reason)+'</small></span><em>'+escDash(x.meta)+'</em></button>').join('')+'</div>':'<div class="mr-dash-calm"><b>Всё спокойно</b><span>Просроченных ДЗ и других срочных сигналов сейчас нет.</span></div>')+'</section>';
  }
  function todayCard(items){
    const d=new Date();
    const dateLabel=d.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'});
    return '<section class="mr-dash-today"><div class="mr-dash-card-head"><div class="mr-dash-card-title">'+icon('calendar')+'<h2>Сегодня</h2><span class="mr-dash-date">'+escDash(dateLabel)+'</span></div><button class="mr-dash-link" id="mrDashSchedule">Открыть расписание '+icon('arrow')+'</button></div>'+(items.length?'<div class="mr-dash-today-list">'+items.map(l=>{
      const done=l.status==='completed',active=l.status==='in_progress';
      return '<article class="mr-dash-today-row '+(active?'active ':'')+(done?'done':'')+'"><div class="mr-dash-today-time"><b>'+escDash(time(l.scheduled_at))+'</b><span>'+Number(l.duration_minutes||50)+' мин</span></div><span class="mr-dash-avatar">'+escDash(initials(lessonStudent(l)))+'</span><div class="mr-dash-today-copy"><b>'+escDash(lessonStudent(l))+'</b><span>'+escDash((lessonGrade(l)?lessonGrade(l)+' класс · ':'')+lessonTopic(l))+'</span></div><div class="mr-dash-today-action">'+(done?'<span class="mr-dash-status">Завершён</span>':'<button class="'+(active?'mr-dash-primary':'mr-dash-secondary')+'" data-dash-start="'+escDash(l.id)+'">'+icon('play')+(active?'Продолжить':'Начать урок')+'</button>')+'</div></article>';
    }).join('')+'</div>':'<div class="mr-dash-calm"><b>На сегодня занятий нет</b><span>Можно спокойно готовиться к следующему уроку или создать новый.</span></div>')+'</section>';
  }

  window.renderDashboard=function(){
    const now=Date.now(),next=nextLesson(now),attention=attentionItems(now),today=todayLessons();
    const name=teacherName();
    const title=name?'Привет, '+escDash(name)+'!':'Главная';
    const content='<div class="mr-dashboard"><div class="mr-dash-grid">'+nextCard(next,now)+attentionCard(attention)+'</div>'+todayCard(today)+'</div>';
    app.innerHTML=shell(content,title,'Хорошего дня и продуктивных уроков!');
    bindShell();

    const top=document.querySelector('.view-dashboard .topbar');
    if(top){
      top.insertAdjacentHTML('beforeend','<div class="mr-dash-top-actions"><button class="mr-dash-primary" id="mrDashCreateNow">'+icon('plus')+'Создать урок сейчас</button><button class="mr-dash-secondary" id="mrDashHelp">?&nbsp;&nbsp;Инструкция</button></div>');
    }

    document.getElementById('mrDashCreateNow')?.addEventListener('click',openScheduleCreator);
    document.getElementById('mrDashCreateEmpty')?.addEventListener('click',openScheduleCreator);
    document.getElementById('mrDashHelp')?.addEventListener('click',()=>document.getElementById('sidebarHelp')?.click());
    document.getElementById('mrDashSchedule')?.addEventListener('click',()=>navTo('schedule'));
    document.getElementById('mrDashAttentionAll')?.addEventListener('click',()=>navTo('assignments'));
    document.querySelectorAll('[data-dash-attention]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.dashAttention==='history'?'history':'assignments')));
    document.querySelectorAll('[data-dash-topic]').forEach(b=>b.addEventListener('click',()=>{
      S.topic=(S.topics||[]).find(x=>String(x.id)===String(b.dataset.dashTopic))||null;
      if(S.topic){S.view='topics';renderTeacher()}
    }));
    document.querySelectorAll('[data-dash-start]').forEach(b=>b.addEventListener('click',async()=>{
      const l=(S.lessons||[]).find(x=>String(x.id)===String(b.dataset.dashStart));
      if(l)await startLesson(l);
    }));
  };
  // If the legacy app rendered the dashboard before this enhancement loaded,
  // repaint it once with the v57 implementation.
  const mrDashBootRerender=()=>{
    if(S?.view==='dashboard'&&document.querySelector('.view-dashboard')){
      try{window.renderDashboard()}catch(e){console.warn('[Mathroom dashboard v57 boot]',e)}
    }
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(mrDashBootRerender,0),{once:true});
  else setTimeout(mrDashBootRerender,0);
})();