(function(){
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtDate=(value)=>{
    if(!value)return 'Дата не указана';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return 'Дата не указана';
    return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  };
  const fmtTime=(value)=>{
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '';
    return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  };
  const addMinutes=(value,minutes)=>{
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '';
    d.setMinutes(d.getMinutes()+Number(minutes||60));
    return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  };
  const icon=(symbol)=>'<span class="mr-finish-v58-icon" aria-hidden="true">'+symbol+'</span>';
  const stat=(symbol,label,value,klass)=>'<div class="mr-finish-v58-stat '+(klass||'')+'">'+icon(symbol)+'<div><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div></div>';
  const editor=(id,title,subtitle,symbol,value,placeholder,extra)=>{
    const safe=String(value??'');
    return '<article class="mr-finish-v58-editor '+(extra||'')+'">'+
      '<div class="mr-finish-v58-editor-head">'+icon(symbol)+'<div><h3>'+esc(title)+'</h3><p>'+esc(subtitle)+'</p></div></div>'+
      '<div class="mr-finish-v58-input-shell"><span class="mr-finish-v58-pencil">⌁</span>'+
      '<textarea id="'+id+'" maxlength="1000" placeholder="'+esc(placeholder||'')+'">'+esc(safe)+'</textarea>'+
      '<span class="mr-finish-v58-count" data-finish-count="'+id+'">'+safe.length+'/1000</span></div>'+
    '</article>';
  };
  function render(data){
    const lesson=data.lesson||{};
    const student=data.student||{};
    const topic=data.topic||{};
    const counts=data.counts||{};
    const mins=Number(data.minutes||0);
    const completion=Number(data.completion||0);
    const start=fmtTime(lesson.scheduled_at);
    const end=addMinutes(lesson.scheduled_at,lesson.duration_minutes||60);
    const timeRange=start?(start+(end?' – '+end:'')):'Время не указано';
    const topicTitle=topic.title||lesson.topic_title||'Тема не указана';
    const grade=student.grade?student.grade+' класс':'Класс не указан';
    const total=Number(counts.total||0);
    const reviewed=Number(counts.solved||0)+Number(counts.hard||0)+Number(counts.later||0);
    const trialNote=data.isCrmTrial?'<div class="mr-finish-v58-trial">Для пробного занятия CRM отметит урок проведённым только при «Был» или «Опоздал». При «Не был» потребуется назначить новую дату.</div>':'';
    return '<div class="mr-finish-v58-page">'+
      '<header class="mr-finish-v58-head">'+
        '<div class="mr-finish-v58-title">'+
          '<span class="mr-finish-v58-kicker">ЗАВЕРШЕНИЕ УРОКА</span>'+
          '<h2>Завершение урока</h2>'+
          '<p>Занятие: '+esc(student.name||'Ученик')+' · '+esc(grade)+' · '+esc(topicTitle)+'</p>'+
          '<div class="mr-finish-v58-meta"><span>▣ '+esc(fmtDate(lesson.scheduled_at))+'</span><span>◷ '+esc(timeRange)+'</span><span>● '+esc(mins+' мин')+'</span></div>'+
        '</div>'+
        '<div class="mr-finish-v58-student">'+
          '<span class="mr-finish-v58-avatar">◯</span>'+
          '<div><b>'+esc(student.name||'Ученик')+'</b><span>'+esc(grade)+'</span></div>'+
        '</div>'+
      '</header>'+
      '<section class="mr-finish-v58-top-grid">'+
        '<div class="mr-finish-v58-attendance">'+
          '<div class="mr-finish-v58-section-title"><div><span>ПОСЕЩАЕМОСТЬ</span><h3>Ученик был на уроке?</h3></div><em>Обязательно</em></div>'+
          '<div class="mr-finish-v58-attendance-options">'+
            '<button type="button" data-finish-attendance="present" class="'+(data.currentAttendance==='present'?'active':'')+'"><b>✓</b><span>Был</span><small>Присутствовал на занятии</small></button>'+
            '<button type="button" data-finish-attendance="late" class="'+(data.currentAttendance==='late'?'active':'')+'"><b>◷</b><span>Опоздал</span><small>Пришёл после начала урока</small></button>'+
            '<button type="button" data-finish-attendance="absent" class="'+(data.currentAttendance==='absent'?'active':'')+'"><b>×</b><span>Не был</span><small>Ученик не присутствовал</small></button>'+
          '</div>'+trialNote+
        '</div>'+
        '<div class="mr-finish-v58-side-summary">'+
          '<div class="mr-finish-v58-mini"><span>ВРЕМЯ ЗАНЯТИЯ</span><div><b>'+esc(mins+' мин')+'</b><small>'+esc(timeRange)+'<br>'+esc(fmtDate(lesson.scheduled_at))+'</small></div></div>'+
          '<div class="mr-finish-v58-mini"><span>ЗАДАЧИ НА УРОКЕ</span><div><b>'+esc(reviewed+' / '+total)+'</b><i><u style="width:'+Math.max(0,Math.min(100,completion))+'%"></u></i><small>'+esc(completion+'%')+'</small></div></div>'+
        '</div>'+
      '</section>'+
      '<section class="mr-finish-v58-stats">'+
        stat('▤','Задач всего',total)+
        stat('✓','Решено',Number(counts.solved||0),'ok')+
        stat('▥','Сложные',Number(counts.hard||0),'hard')+
        stat('◷','Позже',Number(counts.later||0),'later')+
        stat('◌','Разобрано',completion+'%')+
        stat('◴','Время',mins+' мин','dark')+
      '</section>'+
      '<section class="mr-finish-v58-editors">'+
        editor('finishHighlights','Что сегодня получилось','Опиши, какие темы разобрали и что получилось хорошо','↗',data.highlights,'Например: разобрали понятие выражений, научились упрощать, ученик уверенно решал простые примеры…')+
        editor('finishFocus','Что повторить','Что требует дополнительного закрепления','↻',data.focusText,'Например: ещё потренировать раскрытие скобок, больше задач на порядок действий…')+
        editor('finishSummary','Итоги ученику','Краткая оценка урока и прогресс ученика','☆',data.summary,'Например: ученик активно работал, хорошо справлялся с заданиями, есть прогресс…')+
        editor('finishPlan','К следующему уроку','Домашнее задание или план на следующее занятие','▣',data.plan,'Например: решить задания из учебника, повторить правила, подготовиться к следующей теме…')+
        editor('finishPrivate','Приватная заметка','Видна только преподавателю. Не отображается ученику и родителям.','●',data.privateNote,'Рабочие наблюдения преподавателя…','private')+
      '</section>'+
      '<footer class="mr-finish-v58-footer">'+
        '<div class="mr-finish-v58-private-mark"><span>●</span><div><b>Приватная заметка</b><small>Остаётся только в кабинете преподавателя</small></div></div>'+
        '<div class="mr-finish-v58-footer-actions"><button type="button" class="mr-finish-v58-close" data-close>Закрыть</button>'+
        '<button type="button" class="mr-finish-v58-submit" id="finishConfirm" '+(data.currentAttendance?'':'disabled')+'><span>✓</span>Завершить и сохранить отчёт</button></div>'+
      '</footer>'+
    '</div>';
  }
  function bind(root){
    if(!root)return;
    root.querySelectorAll('textarea[maxlength]').forEach((el)=>{
      const counter=root.querySelector('[data-finish-count="'+el.id+'"]');
      const update=()=>{if(counter)counter.textContent=String(el.value.length)+'/1000';};
      el.addEventListener('input',update);
      update();
    });
  }
  window.MathroomFinishV58={render,bind};
})();