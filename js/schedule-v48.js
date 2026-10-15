(() => {
  'use strict';

  const MR=window.MR||{};
  const S=MR.S||{};
  const sb=MR.sb;
  const esc=MR.esc||((v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const toast=MR.toast||(()=>{});
  const fail=MR.fail||((e)=>console.error(e));
  const legacyEnhancer=window.MathroomEnhanceScheduleWorkspace;
  const observers=new WeakMap();
  const transforming=new WeakSet();
  const localState={mode:null,selectedDay:null};

  function userKey(suffix){return `mathroom.schedule.v48.${suffix}.${S.user?.id||'teacher'}`}
  function loadPrefs(){
    if(!localState.mode){
      try{localState.mode=localStorage.getItem(userKey('mode'))||'week'}catch{localState.mode='week'}
      if(!['week','day'].includes(localState.mode))localState.mode='week';
    }
    if(!localState.selectedDay){
      try{localState.selectedDay=localStorage.getItem(userKey('day'))||''}catch{localState.selectedDay=''}
    }
  }
  function savePrefs(){
    try{
      localStorage.setItem(userKey('mode'),localState.mode||'week');
      if(localState.selectedDay)localStorage.setItem(userKey('day'),localState.selectedDay);
    }catch{}
  }
  function dateKey(d){
    const x=new Date(d),p=n=>String(n).padStart(2,'0');
    return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`;
  }
  function parseDateKey(v){
    const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):null;
  }
  function sameDay(a,b){return a&&b&&a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
  function clock(v){return new Date(v).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
  function studentName(l){return l.students?.name||S.students?.find(x=>String(x.id)===String(l.student_id))?.name||'Ученик'}
  function topicName(l){return l.topics?.title||S.topics?.find(x=>String(x.id)===String(l.topic_id))?.title||'Без темы'}
  function studentFor(l){return S.students?.find(x=>String(x.id)===String(l.student_id))||null}
  function statusMeta(l){
    if(l.status==='completed')return ['Завершён','done'];
    if(l.status==='in_progress')return ['Идёт урок','live'];
    if(l.rescheduled_from&&Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000)return ['Перенесён','moved'];
    return ['Запланирован','planned'];
  }
  function icon(kind){
    const cls='class="mr-sch48-svg" viewBox="0 0 24 24" aria-hidden="true"';
    if(kind==='book')return `<svg ${cls}><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Z"/><path class="accent" d="M20 5.5c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>`;
    if(kind==='people')return `<svg ${cls}><circle cx="9" cy="8" r="3"/><circle class="accent" cx="16.5" cy="9" r="2.5"/><path d="M3.5 19c.7-4 2.6-6 5.7-6 3.2 0 5.2 2 5.8 6"/><path class="accent" d="M14 14c3.6-.5 5.8 1.2 6.5 5"/></svg>`;
    if(kind==='calendar')return `<svg ${cls}><rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><path class="accent" d="M8 14h3M13 14h3M8 17h3"/></svg>`;
    if(kind==='grid')return `<svg ${cls}><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect class="accent" x="14" y="14" width="6" height="6" rx="1.5"/></svg>`;
    if(kind==='list')return `<svg ${cls}><path d="M9 6h11M9 12h11M9 18h11"/><circle class="accent-fill" cx="5" cy="6" r="1.5"/><circle class="accent-fill" cx="5" cy="12" r="1.5"/><circle class="accent-fill" cx="5" cy="18" r="1.5"/></svg>`;
    if(kind==='filter')return `<svg ${cls}><path d="M4 6h16M7 12h10M10 18h4"/><circle class="accent-fill" cx="8" cy="6" r="1.5"/><circle class="accent-fill" cx="15" cy="12" r="1.5"/></svg>`;
    return '';
  }

  function ensureObserver(root){
    if(observers.has(root))return;
    const obs=new MutationObserver(()=>{
      if(transforming.has(root))return;
      clearTimeout(root.__mr48Timer);
      root.__mr48Timer=setTimeout(()=>{if(S.view==='schedule'&&!root.querySelector('.mr-schedule-v48'))upgrade(root)},0);
    });
    obs.observe(root,{childList:true});
    observers.set(root,obs);
  }

  function legacyEngine(root){return root.querySelector('.mr-schedule-v48-engine')}
  function proxyClick(root,selector){
    const btn=legacyEngine(root)?.querySelector(selector);
    if(btn){btn.click();return true}
    return false;
  }

  function weekDaysFromEngine(engine){
    const arr=[...engine.querySelectorAll('.mr-calendar-day[data-cal-day]')].map(x=>parseDateKey(x.dataset.calDay)).filter(Boolean);
    if(arr.length===7)return arr;
    const d=new Date(),day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);
    return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(x.getDate()+i);return x});
  }

  function filteredLessons(engine,days){
    const first=new Date(days[0]);first.setHours(0,0,0,0);
    const end=new Date(days[6]);end.setDate(end.getDate()+1);end.setHours(0,0,0,0);
    const filter=engine.querySelector('#mrScheduleStudentFilter')?.value||'all';
    return (S.lessons||[]).filter(l=>{
      if(!l.scheduled_at||l.status==='cancelled')return false;
      const d=new Date(l.scheduled_at);
      if(d<first||d>=end)return false;
      return filter==='all'||String(l.student_id)===String(filter);
    }).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
  }

  function normalizeSelectedDay(days){
    loadPrefs();
    let selected=parseDateKey(localState.selectedDay);
    if(!selected||!days.some(d=>sameDay(d,selected))){
      const wanted=selected?((selected.getDay()+6)%7):((new Date().getDay()+6)%7);
      selected=days[Math.max(0,Math.min(6,wanted))]||days[0];
      localState.selectedDay=dateKey(selected);savePrefs();
    }
    return selected;
  }

  function weekGridHtml(days,lessons){
    const hours=Array.from({length:15},(_,i)=>8+i);
    return `<section class="mr-sch48-week">
      <div class="mr-sch48-week-scroll">
        <div class="mr-sch48-week-grid">
          <div class="mr-sch48-week-head">
            <div class="mr-sch48-time-corner">Время</div>
            ${days.map(day=>`<button class="mr-sch48-day-head ${sameDay(day,new Date())?'today':''}" data-v48-day="${dateKey(day)}"><span>${day.toLocaleDateString('ru-RU',{weekday:'short'})}</span><b>${day.getDate()}</b><small>${day.toLocaleDateString('ru-RU',{month:'short'})}</small></button>`).join('')}
          </div>
          <div class="mr-sch48-week-body">
            <div class="mr-sch48-time-axis">${hours.map((h,i)=>`<span style="top:${i*56}px">${String(h).padStart(2,'0')}:00</span>`).join('')}</div>
            ${days.map(day=>`<section class="mr-sch48-grid-day ${sameDay(day,new Date())?'today':''}" data-v48-dropday="${dateKey(day)}">${lessons.filter(l=>sameDay(new Date(l.scheduled_at),day)).map(weekCardHtml).join('')}</section>`).join('')}
          </div>
        </div>
      </div>
      <div class="mr-sch48-hint"><b>Неделя</b><span>Перетащи одиночный урок на другой день — время сохранится. Серии переносим через режим «День».</span></div>
    </section>`;
  }

  function weekCardHtml(l){
    const d=new Date(l.scheduled_at),start=d.getHours()*60+d.getMinutes(),base=8*60;
    const top=Math.max(0,Math.min(14*56,(start-base)*56/60));
    const h=Math.max(42,Math.min(Number(l.duration_minutes||60),120)*56/60-4);
    const recurring=!!l.recurrence_series_id;
    return `<article class="mr-sch48-week-card ${l.status==='completed'?'completed':''}" style="top:${top}px;height:${h}px" data-v48-lesson="${esc(l.id)}" draggable="${l.status==='assigned'&&!recurring?'true':'false'}">
      <div><b>${clock(l.scheduled_at)}</b><small>${Number(l.duration_minutes||60)} мин</small></div>
      <strong>${esc(studentName(l))}</strong>
      <span>${esc(topicName(l))}</span>
      ${recurring?'<i>серия</i>':''}
    </article>`;
  }

  function dayHtml(root,engine,days,lessons){
    const selected=normalizeSelectedDay(days);
    const items=lessons.filter(l=>sameDay(new Date(l.scheduled_at),selected));
    return `<section class="mr-sch48-day">
      <div class="mr-sch48-day-strip">${days.map(d=>{const count=lessons.filter(l=>sameDay(new Date(l.scheduled_at),d)).length;return `<button class="mr-sch48-day-tab ${sameDay(d,selected)?'active':''} ${sameDay(d,new Date())?'today':''}" data-v48-day="${dateKey(d)}"><span>${d.toLocaleDateString('ru-RU',{weekday:'short'})}</span><b>${d.getDate()}</b><small>${count} ${count===1?'урок':count>1&&count<5?'урока':'уроков'}</small></button>`}).join('')}</div>
      <div class="mr-sch48-day-title"><div><span>ВЫБРАННЫЙ ДЕНЬ</span><h2>${selected.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</h2></div><b>${items.length}</b></div>
      <div class="mr-sch48-timeline">${items.length?items.map(l=>dayLessonHtml(root,engine,l)).join(''):`<div class="mr-sch48-empty"><span>${icon('calendar')}</span><div><b>Свободный день</b><small>На этот день пока ничего не запланировано.</small></div><button data-v48-add>+ Добавить урок</button></div>`}</div>
    </section>`;
  }

  function dayLessonHtml(root,engine,l){
    const st=studentFor(l),[label,status]=statusMeta(l),id=String(l.id);
    const oldCard=engine.querySelector(`[data-cal-lesson="${CSS.escape(id)}"]`);
    const canStart=!!oldCard?.querySelector('[data-cal-start]');
    const canMove=!!oldCard?.querySelector('[data-cal-move]');
    const canDelete=!!oldCard?.querySelector('[data-cal-delete]');
    const canAttendance=!!oldCard?.querySelector('[data-cal-attendance]');
    return `<article class="mr-sch48-day-row ${status}" data-v48-row="${esc(id)}">
      <div class="mr-sch48-row-time"><b>${clock(l.scheduled_at)}</b><span>${Number(l.duration_minutes||60)} мин</span></div>
      <div class="mr-sch48-row-line"><i></i></div>
      <div class="mr-sch48-row-main"><span class="mr-sch48-row-icon">${icon(st?.group_name?'people':'book')}</span><div><strong>${esc(studentName(l))}</strong><small>${esc(topicName(l))}</small><em class="mr-sch48-status ${status}">${esc(label)}</em></div></div>
      <div class="mr-sch48-row-meta"><b>${st?.grade?esc(st.grade)+' класс':'Индивидуально'}</b><small>${l.recurrence_series_id?'Повторяющееся занятие':'Индивидуальный урок'}</small></div>
      <div class="mr-sch48-row-actions">${canAttendance?`<button class="ghost" data-v48-proxy="[data-cal-attendance='${esc(id)}']">Посещение</button>`:''}${canMove?`<button class="ghost" data-v48-proxy="[data-cal-move='${esc(id)}']">Перенести</button>`:''}${canStart?`<button class="primary" data-v48-proxy="[data-cal-start='${esc(id)}']">${l.status==='in_progress'?'Продолжить':'Начать'}</button>`:''}${canDelete?`<button class="more" data-v48-proxy="[data-cal-delete='${esc(id)}']" title="Удалить">•••</button>`:''}</div>
    </article>`;
  }

  function renderView(root){
    const shell=root.querySelector('.mr-schedule-v48');
    const engine=legacyEngine(root);if(!shell||!engine)return;
    const days=weekDaysFromEngine(engine),lessons=filteredLessons(engine,days);
    const selected=normalizeSelectedDay(days);
    shell.querySelector('[data-v48-slot]').innerHTML=localState.mode==='day'?dayHtml(root,engine,days,lessons):weekGridHtml(days,lessons);
    shell.querySelectorAll('[data-v48-mode]').forEach(b=>b.classList.toggle('active',b.dataset.v48Mode===localState.mode));
    bindDynamic(root,days,lessons,selected);
  }

  function bindDynamic(root,days,lessons){
    const shell=root.querySelector('.mr-schedule-v48'),engine=legacyEngine(root);if(!shell||!engine)return;
    shell.querySelectorAll('[data-v48-day]').forEach(b=>b.onclick=()=>{
      localState.selectedDay=b.dataset.v48Day;localState.mode='day';savePrefs();renderView(root);
    });
    shell.querySelectorAll('[data-v48-proxy]').forEach(b=>b.onclick=()=>proxyClick(root,b.dataset.v48Proxy));
    shell.querySelectorAll('[data-v48-add]').forEach(b=>b.onclick=()=>openCreate(root,true));

    let dragged='';
    shell.querySelectorAll('[data-v48-lesson][draggable="true"]').forEach(card=>{
      card.addEventListener('dragstart',e=>{dragged=card.dataset.v48Lesson;card.classList.add('dragging');try{e.dataTransfer.setData('text/plain',dragged)}catch{}});
      card.addEventListener('dragend',()=>{dragged='';card.classList.remove('dragging');shell.querySelectorAll('[data-v48-dropday]').forEach(x=>x.classList.remove('drop-target'))});
    });
    shell.querySelectorAll('[data-v48-dropday]').forEach(day=>{
      day.addEventListener('dragover',e=>{if(!dragged)return;e.preventDefault();day.classList.add('drop-target')});
      day.addEventListener('dragleave',()=>day.classList.remove('drop-target'));
      day.addEventListener('drop',async e=>{
        e.preventDefault();day.classList.remove('drop-target');
        const id=dragged||e.dataTransfer?.getData('text/plain'),lesson=(S.lessons||[]).find(x=>String(x.id)===String(id));
        if(!lesson||lesson.status!=='assigned'||lesson.recurrence_series_id)return;
        const target=parseDateKey(day.dataset.v48Dropday),old=new Date(lesson.scheduled_at);if(!target)return;
        target.setHours(old.getHours(),old.getMinutes(),0,0);if(sameDay(target,old))return;
        if(!confirm(`Перенести ${studentName(lesson)} на ${target.toLocaleDateString('ru-RU')} в ${clock(target)}?`))return;
        try{
          const oldIso=lesson.scheduled_at,newIso=target.toISOString();
          const {error}=await sb.from('lessons').update({scheduled_at:newIso,rescheduled_from:lesson.rescheduled_from||oldIso,schedule_updated_at:new Date().toISOString()}).eq('id',lesson.id);
          if(error)throw error;
          lesson.rescheduled_from=lesson.rescheduled_from||oldIso;lesson.scheduled_at=newIso;
          toast('Урок перенесён');renderView(root);
        }catch(err){fail(err)}
      });
    });
  }

  function openCreate(root,open){
    const panel=root.querySelector('.mr-schedule-create');
    if(!panel)return;
    panel.hidden=!open;
    root.querySelector('[data-v48-add-main]')?.setAttribute('aria-expanded',open?'true':'false');
    if(open)setTimeout(()=>panel.querySelector('select,input')?.focus(),0);
  }

  function upgrade(root){
    if(!root||root.querySelector('.mr-schedule-v48')||S.view!=='schedule')return;
    transforming.add(root);
    loadPrefs();
    try{
      const legacyChildren=[...root.children];
      const engine=document.createElement('div');engine.className='mr-schedule-v48-engine';engine.hidden=true;
      legacyChildren.forEach(n=>engine.appendChild(n));
      const days=weekDaysFromEngine(engine),selected=normalizeSelectedDay(days);
      const oldTitle=engine.querySelector('.mr-schedule-toolbar p')?.textContent?.trim()||'Текущая неделя';
      const oldMetrics=[...engine.querySelectorAll('.mr-schedule-metrics .metric')].map(x=>x.textContent.trim());
      const oldFilter=engine.querySelector('#mrScheduleStudentFilter');
      const filterOptions=oldFilter?[...oldFilter.options].map(o=>`<option value="${esc(o.value)}" ${o.selected?'selected':''}>${esc(o.textContent)}</option>`).join(''):'<option value="all">Все ученики</option>';

      const shell=document.createElement('div');shell.className='mr-schedule-v48';
      shell.innerHTML=`<section class="mr-sch48-hero"><div class="mr-sch48-hero-copy"><span>РАСПИСАНИЕ</span><h1>Планируйте уроки<br>без лишнего шума</h1><p>Неделя — для общей картины. День — для работы с конкретными занятиями.</p></div><div class="mr-sch48-hero-side"><div class="mr-sch48-hero-metrics"><i><b>${esc(oldMetrics[0]||'0')}</b><small>уроков</small></i><i><b>${esc(oldMetrics[1]||'0')}</b><small>нагрузка</small></i><i><b>${esc(oldMetrics[2]||'0')}</b><small>переносов</small></i></div><button data-v48-add-main aria-expanded="false"><b>+</b> Добавить урок</button></div></section>
        <section class="mr-sch48-controls"><div class="mr-sch48-modes"><button data-v48-mode="week">${icon('grid')}<span>Неделя</span></button><button data-v48-mode="day">${icon('list')}<span>День</span></button></div><div class="mr-sch48-nav"><button data-v48-prev>‹</button><strong>${esc(oldTitle)}</strong><button data-v48-next>›</button><button data-v48-today>Сегодня</button></div><div class="mr-sch48-tools"><label>${icon('filter')}<select data-v48-filter>${filterOptions}</select></label><button data-v48-templates>Шаблоны</button></div></section>
        <div class="mr-sch48-create-slot"></div><div data-v48-slot></div>`;
      root.append(shell);root.append(engine);

      const create=engine.querySelector('.mr-schedule-create');
      if(create){
        create.classList.add('mr-sch48-create-panel');
        const head=create.querySelector('.mr-card-head');
        if(head&&!head.querySelector('[data-v48-create-close]')){
          const close=document.createElement('button');close.type='button';close.className='mr-sch48-create-close';close.dataset.v48CreateClose='1';close.textContent='×';head.appendChild(close);
        }
        shell.querySelector('.mr-sch48-create-slot').append(create);
        create.hidden=true;
      }

      shell.querySelectorAll('[data-v48-mode]').forEach(b=>b.onclick=()=>{localState.mode=b.dataset.v48Mode;savePrefs();renderView(root)});
      shell.querySelector('[data-v48-prev]').onclick=()=>proxyClick(root,'#mrWeekPrev');
      shell.querySelector('[data-v48-next]').onclick=()=>proxyClick(root,'#mrWeekNext');
      shell.querySelector('[data-v48-today]').onclick=()=>{localState.selectedDay=dateKey(new Date());savePrefs();proxyClick(root,'#mrWeekToday')};
      shell.querySelector('[data-v48-templates]').onclick=()=>proxyClick(root,'#mrWeekTemplates');
      shell.querySelector('[data-v48-add-main]').onclick=()=>openCreate(root,root.querySelector('.mr-schedule-create')?.hidden!==false);
      shell.querySelector('[data-v48-create-close]')?.addEventListener('click',()=>openCreate(root,false));
      shell.querySelector('[data-v48-filter]').onchange=e=>{
        const old=engine.querySelector('#mrScheduleStudentFilter');if(!old)return;
        old.value=e.target.value;old.dispatchEvent(new Event('change',{bubbles:true}));
      };

      const prefill=String(root.dataset.schedulePrefillStudent||root.dataset.schedulePrefillTopic||'');
      if(prefill)openCreate(root,true);
      renderView(root);
    }finally{
      transforming.delete(root);
      ensureObserver(root);
    }
  }

  window.MathroomEnhanceScheduleWorkspace=async function(){
    if(typeof legacyEnhancer==='function')await legacyEnhancer();
    const root=document.querySelector('#mrScheduleEnhanced');
    if(root)upgrade(root);
  };

  // Handles restored schedule view on first load and legacy rerenders from prev/next/filter/create.
  const boot=()=>{const root=document.querySelector('#mrScheduleEnhanced');if(root&&S.view==='schedule')upgrade(root)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,0),{once:true});
  else setTimeout(boot,0);
})();