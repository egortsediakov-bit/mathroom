(() => {
  'use strict';

  const MR=window.MR||{};
  const S=MR.S||{};
  const upgraded=new WeakSet();
  const esc=MR.esc||((v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const pad=n=>String(n).padStart(2,'0');

  function svg(kind){
    if(kind==='book')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Z"/><path class="accent" d="M20 5.5c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>';
    if(kind==='calendar')return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/><path class="accent" d="M8 14h3M13 14h3M8 17h3"/></svg>';
    if(kind==='clock')return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path class="accent" d="M12 7v5l3 2"/></svg>';
    if(kind==='repeat')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h11l-2.5-2.5"/><path class="accent" d="M19 16H8l2.5 2.5"/><path d="M5 8a7 7 0 0 0 1 8M19 16a7 7 0 0 0-1-8"/></svg>';
    if(kind==='single')return '<svg class="mr-v3-repeat-mode-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="3.5"/><path class="accent" d="M12 8.5v7"/><path class="accent" d="M10.2 10.1 12 8.5l1.8 1.6"/></svg>';
    if(kind==='weekly')return '<svg class="mr-v3-repeat-mode-svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="3.5"/><path class="accent" d="M8.2 12c1.2-2 2.5-3 3.8-3s2.6 1 3.8 3c-1.2 2-2.5 3-3.8 3s-2.6-1-3.8-3Z"/><path d="M8.8 16.7c1 .6 2 .8 3.2.8 3.1 0 5.5-2.5 5.5-5.5"/></svg>';
    if(kind==='custom')return '<svg class="mr-v3-repeat-mode-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="2"/><circle class="accent-fill" cx="17" cy="7" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 12h3c2.2 0 3-1.6 3-3"/><path class="accent" d="M12 12c2.2 0 3 1.6 3 3"/></svg>';
    return '';
  }

  function parseDateTime(raw){
    const m=String(raw||'').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if(m)return {date:new Date(Number(m[1]),Number(m[2])-1,Number(m[3])),hour:Number(m[4]),minute:Number(m[5])};
    const d=new Date();return {date:new Date(d.getFullYear(),d.getMonth(),d.getDate()),hour:16,minute:0};
  }
  function toDateTimeValue(date,hour,minute){
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;
  }
  function formatDate(date){
    return date.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function monthTitle(date){
    const s=date.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    return s.charAt(0).toUpperCase()+s.slice(1);
  }

  function closeOtherPops(except){
    document.querySelectorAll('.mr-v3-pop:not([hidden])').forEach(p=>{if(p!==except)p.hidden=true});
    document.querySelectorAll('.mr-v3-trigger.open').forEach(b=>{if(!except||b.parentElement?.querySelector('.mr-v3-pop')!==except)b.classList.remove('open')});
  }

  function topicRows(query='',bucket='all'){
    const q=String(query||'').trim().toLocaleLowerCase('ru');
    return [...(S.topics||[])].filter(t=>{
      const g=Number(t.grade)||0;
      if(bucket==='1-4'&&!(g>=1&&g<=4))return false;
      if(bucket==='5-8'&&!(g>=5&&g<=8))return false;
      if(bucket==='9-11'&&!(g>=9&&g<=11))return false;
      if(q){
        const hay=[t.title,t.section,g+' класс',g+' кл'].join(' ').toLocaleLowerCase('ru');
        if(!hay.includes(q))return false;
      }
      return true;
    }).sort((a,b)=>Number(a.grade)-Number(b.grade)||String(a.title).localeCompare(String(b.title),'ru'));
  }

  function buildTopic(select){
    if(!select||select.dataset.v3Built==='1')return;
    select.dataset.v3Built='1';select.classList.add('mr-v3-native-hidden');
    const selected=(S.topics||[]).find(x=>String(x.id)===String(select.value));
    const wrap=document.createElement('div');wrap.className='mr-v3-control mr-v3-topic';wrap.dataset.bucket='all';
    wrap.innerHTML=`
      <button type="button" class="mr-v3-trigger mr-v3-topic-trigger">
        <span class="mr-v3-trigger-icon">${svg('book')}</span>
        <span class="mr-v3-trigger-copy"><b>${esc(selected?.title||'Выбрать тему')}</b><small>${selected?esc(selected.grade)+' класс':'Поиск по теме или классу'}</small></span>
        <span class="mr-v3-chevron">⌄</span>
      </button>
      <div class="mr-v3-pop mr-v3-topic-pop" hidden>
        <label class="mr-v3-search"><span>⌕</span><input type="search" placeholder="Поиск темы или класса..." autocomplete="off"></label>
        <div class="mr-v3-chips">
          <button type="button" class="active" data-bucket="all">Все</button>
          <button type="button" data-bucket="1-4">1–4 кл.</button>
          <button type="button" data-bucket="5-8">5–8 кл.</button>
          <button type="button" data-bucket="9-11">9–11 кл.</button>
        </div>
        <div class="mr-v3-topic-results"></div>
      </div>`;
    select.insertAdjacentElement('afterend',wrap);
    const trigger=wrap.querySelector('.mr-v3-trigger'),pop=wrap.querySelector('.mr-v3-pop'),search=wrap.querySelector('.mr-v3-search input'),results=wrap.querySelector('.mr-v3-topic-results');
    const render=()=>{
      const rows=topicRows(search.value,wrap.dataset.bucket||'all');
      results.innerHTML=rows.length?rows.map(t=>`
        <button type="button" class="mr-v3-topic-row ${String(t.id)===String(select.value)?'selected':''}" data-topic="${esc(t.id)}">
          <span class="mr-v3-grade">${esc(t.grade)}</span>
          <span class="mr-v3-row-copy"><b>${esc(t.title)}</b><small>${esc(t.section||t.grade+' класс')}</small></span>
          <i>${String(t.id)===String(select.value)?'✓':''}</i>
        </button>`).join(''):'<div class="mr-v3-empty">Ничего не найдено</div>';
    };
    const close=()=>{pop.hidden=true;trigger.classList.remove('open')};
    trigger.onclick=()=>{
      if(pop.hidden){closeOtherPops(pop);pop.hidden=false;trigger.classList.add('open');render();setTimeout(()=>search.focus(),0)}else close();
    };
    search.addEventListener('input',render);
    wrap.querySelectorAll('[data-bucket]').forEach(b=>b.onclick=()=>{
      wrap.dataset.bucket=b.dataset.bucket;
      wrap.querySelectorAll('[data-bucket]').forEach(x=>x.classList.toggle('active',x===b));render();
    });
    results.addEventListener('click',e=>{
      const row=e.target.closest('[data-topic]');if(!row)return;
      select.value=row.dataset.topic;select.dispatchEvent(new Event('change',{bubbles:true}));
      const t=(S.topics||[]).find(x=>String(x.id)===String(select.value));
      trigger.querySelector('b').textContent=t?.title||'Выбрать тему';
      trigger.querySelector('small').textContent=t?`${t.grade} класс`:'Поиск по теме или классу';
      close();
    });
  }

  function calendarCells(view,selected){
    const y=view.getFullYear(),m=view.getMonth();
    const first=new Date(y,m,1);
    const offset=(first.getDay()+6)%7;
    const start=new Date(y,m,1-offset);
    const today=new Date();
    return Array.from({length:42},(_,i)=>{
      const d=new Date(start);d.setDate(start.getDate()+i);
      const other=d.getMonth()!==m,sel=d.getFullYear()===selected.getFullYear()&&d.getMonth()===selected.getMonth()&&d.getDate()===selected.getDate();
      const isToday=d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();
      return `<button type="button" class="${other?'other ':''}${sel?'selected ':''}${isToday?'today':''}" data-date="${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}">${d.getDate()}</button>`;
    }).join('');
  }

  function buildDateTime(hiddenInput,field){
    if(!hiddenInput||hiddenInput.dataset.v3Built==='1')return;
    hiddenInput.dataset.v3Built='1';hiddenInput.classList.add('mr-v3-native-hidden');
    field.querySelector('.mr-sch48-datetime-split')?.classList.add('mr-v3-native-hidden');

    const state=parseDateTime(hiddenInput.value);
    let selectedDate=state.date,selectedHour=state.hour,selectedMinute=state.minute,monthView=new Date(state.date.getFullYear(),state.date.getMonth(),1);

    const wrap=document.createElement('div');wrap.className='mr-v3-datetime';
    wrap.innerHTML=`
      <div class="mr-v3-control mr-v3-date-control">
        <button type="button" class="mr-v3-trigger mr-v3-date-trigger">
          <span class="mr-v3-trigger-icon">${svg('calendar')}</span>
          <span class="mr-v3-trigger-copy"><small>Дата</small><b data-date-label>${formatDate(selectedDate)}</b></span>
          <span class="mr-v3-chevron">⌄</span>
        </button>
        <div class="mr-v3-pop mr-v3-calendar-pop" hidden>
          <div class="mr-v3-calendar-head"><button type="button" data-prev>‹</button><b data-month></b><button type="button" data-next>›</button></div>
          <div class="mr-v3-weekdays"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
          <div class="mr-v3-calendar-grid"></div>
          <div class="mr-v3-calendar-foot"><button type="button" data-today>Сегодня</button></div>
        </div>
      </div>
      <div class="mr-v3-control mr-v3-time-control">
        <button type="button" class="mr-v3-trigger mr-v3-time-trigger">
          <span class="mr-v3-trigger-icon">${svg('clock')}</span>
          <span class="mr-v3-trigger-copy"><small>Время</small><b data-time-label>${pad(selectedHour)}:${pad(selectedMinute)}</b></span>
          <span class="mr-v3-chevron">⌄</span>
        </button>
        <div class="mr-v3-pop mr-v3-time-pop" hidden>
          <div class="mr-v3-time-head"><b>Выберите время</b><small>Часы и минуты</small></div>
          <div class="mr-v3-time-columns">
            <div><span>Часы</span><div class="mr-v3-time-list" data-hours></div></div>
            <div><span>Минуты</span><div class="mr-v3-time-list" data-minutes></div></div>
          </div>
          <button type="button" class="mr-v3-time-done" data-time-done>Готово</button>
        </div>
      </div>`;
    field.appendChild(wrap);

    const dateTrigger=wrap.querySelector('.mr-v3-date-trigger'),datePop=wrap.querySelector('.mr-v3-calendar-pop');
    const timeTrigger=wrap.querySelector('.mr-v3-time-trigger'),timePop=wrap.querySelector('.mr-v3-time-pop');
    const sync=()=>{
      hiddenInput.value=toDateTimeValue(selectedDate,selectedHour,selectedMinute);
      hiddenInput.dispatchEvent(new Event('input',{bubbles:true}));
      hiddenInput.dispatchEvent(new Event('change',{bubbles:true}));
      wrap.querySelector('[data-date-label]').textContent=formatDate(selectedDate);
      wrap.querySelector('[data-time-label]').textContent=`${pad(selectedHour)}:${pad(selectedMinute)}`;
    };
    const renderCalendar=()=>{
      wrap.querySelector('[data-month]').textContent=monthTitle(monthView);
      wrap.querySelector('.mr-v3-calendar-grid').innerHTML=calendarCells(monthView,selectedDate);
    };
    const renderTime=()=>{
      wrap.querySelector('[data-hours]').innerHTML=Array.from({length:15},(_,i)=>8+i).map(h=>`<button type="button" class="${h===selectedHour?'selected':''}" data-hour="${h}">${pad(h)}</button>`).join('');
      wrap.querySelector('[data-minutes]').innerHTML=[0,15,30,45].map(m=>`<button type="button" class="${m===selectedMinute?'selected':''}" data-minute="${m}">${pad(m)}</button>`).join('');
    };
    const closeDate=()=>{datePop.hidden=true;dateTrigger.classList.remove('open')};
    const closeTime=()=>{timePop.hidden=true;timeTrigger.classList.remove('open')};
    dateTrigger.onclick=()=>{
      if(datePop.hidden){closeOtherPops(datePop);monthView=new Date(selectedDate.getFullYear(),selectedDate.getMonth(),1);renderCalendar();datePop.hidden=false;dateTrigger.classList.add('open')}else closeDate();
    };
    timeTrigger.onclick=()=>{
      if(timePop.hidden){closeOtherPops(timePop);renderTime();timePop.hidden=false;timeTrigger.classList.add('open')}else closeTime();
    };
    wrap.querySelector('[data-prev]').onclick=()=>{monthView=new Date(monthView.getFullYear(),monthView.getMonth()-1,1);renderCalendar()};
    wrap.querySelector('[data-next]').onclick=()=>{monthView=new Date(monthView.getFullYear(),monthView.getMonth()+1,1);renderCalendar()};
    wrap.querySelector('[data-today]').onclick=()=>{const d=new Date();selectedDate=new Date(d.getFullYear(),d.getMonth(),d.getDate());monthView=new Date(d.getFullYear(),d.getMonth(),1);sync();renderCalendar();closeDate()};
    wrap.querySelector('.mr-v3-calendar-grid').addEventListener('click',e=>{
      const b=e.target.closest('[data-date]');if(!b)return;
      const [y,m,d]=b.dataset.date.split('-').map(Number);selectedDate=new Date(y,m-1,d);sync();closeDate();
    });
    wrap.querySelector('[data-hours]').addEventListener('click',e=>{const b=e.target.closest('[data-hour]');if(!b)return;selectedHour=Number(b.dataset.hour);renderTime();sync()});
    wrap.querySelector('[data-minutes]').addEventListener('click',e=>{const b=e.target.closest('[data-minute]');if(!b)return;selectedMinute=Number(b.dataset.minute);renderTime();sync()});
    wrap.querySelector('[data-time-done]').onclick=closeTime;
    sync();
  }

  function buildDuration(input){
    if(!input||input.dataset.v3Built==='1')return;
    input.dataset.v3Built='1';input.classList.add('mr-v3-native-hidden');
    const box=document.createElement('div');box.className='mr-v3-duration';
    box.innerHTML=`<button type="button" data-minus>−</button><span class="mr-v3-duration-icon">${svg('clock')}</span><b data-value>${esc(input.value||60)}</b><em>мин</em><button type="button" data-plus>+</button>`;
    input.insertAdjacentElement('afterend',box);
    const sync=()=>{
      const v=Math.max(15,Math.min(240,Number(input.value||60)));input.value=String(v);
      box.querySelector('[data-value]').textContent=String(v);input.dispatchEvent(new Event('input',{bubbles:true}));
    };
    box.querySelector('[data-minus]').onclick=()=>{input.value=String(Number(input.value||60)-5);sync()};
    box.querySelector('[data-plus]').onclick=()=>{input.value=String(Number(input.value||60)+5);sync()};
    sync();
  }

  function buildRepeat(repeat,interval,repeatField,intervalField){
    if(!repeat||repeat.dataset.v3Built==='1')return;
    repeat.dataset.v3Built='1';repeat.classList.add('mr-v3-native-hidden');
    interval.classList.add('mr-v3-native-hidden');intervalField.classList.add('mr-v3-hide-field');
    const wrap=document.createElement('div');wrap.className='mr-v3-repeat';
    wrap.innerHTML=`
      <div class="mr-v3-repeat-modes">
        <button type="button" data-mode="1"><span class="mr-v3-repeat-mode-icon">${svg('single')}</span>Один урок</button>
        <button type="button" data-mode="forever"><span class="mr-v3-repeat-mode-icon">${svg('weekly')}</span>Каждую неделю</button>
        <button type="button" data-mode="custom"><span class="mr-v3-repeat-mode-icon">${svg('custom')}</span>Другое</button>
      </div>
      <div class="mr-v3-repeat-extra" hidden>
        <span>Количество занятий</span>
        <div><button type="button" data-count="4">4</button><button type="button" data-count="8">8</button><button type="button" data-count="12">12</button><button type="button" data-count="16">16</button></div>
      </div>
      <div class="mr-v3-interval">
        <span>Интервал</span>
        <div><button type="button" data-interval="1">1 неделя</button><button type="button" data-interval="2">2 недели</button></div>
      </div>`;
    repeat.insertAdjacentElement('afterend',wrap);
    const refresh=()=>{
      const v=String(repeat.value||'1'),custom=!['1','forever'].includes(v),disabled=v==='1';
      wrap.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',(v==='1'&&b.dataset.mode==='1')||(v==='forever'&&b.dataset.mode==='forever')||(custom&&b.dataset.mode==='custom')));
      wrap.querySelector('.mr-v3-repeat-extra').hidden=!custom;
      wrap.querySelectorAll('[data-count]').forEach(b=>b.classList.toggle('active',String(b.dataset.count)===v));
      wrap.querySelector('.mr-v3-interval').classList.toggle('disabled',disabled);
      wrap.querySelectorAll('[data-interval]').forEach(b=>{b.disabled=disabled;b.classList.toggle('active',String(b.dataset.interval)===String(interval.value||'1'))});
    };
    wrap.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
      const mode=b.dataset.mode;
      if(mode==='1'||mode==='forever')repeat.value=mode;else if(!['4','8','12','16'].includes(String(repeat.value)))repeat.value='4';
      repeat.dispatchEvent(new Event('change',{bubbles:true}));refresh();
    });
    wrap.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>{repeat.value=b.dataset.count;repeat.dispatchEvent(new Event('change',{bubbles:true}));refresh()});
    wrap.querySelectorAll('[data-interval]').forEach(b=>b.onclick=()=>{interval.value=b.dataset.interval;interval.dispatchEvent(new Event('change',{bubbles:true}));refresh()});
    repeat.addEventListener('change',refresh);interval.addEventListener('change',refresh);refresh();
  }

  function enhance(panel){
    if(!panel||upgraded.has(panel))return;
    const topic=panel.querySelector('#mrScTopic'),when=panel.querySelector('#mrScWhen'),duration=panel.querySelector('#mrScDuration'),repeat=panel.querySelector('#mrScRepeat'),interval=panel.querySelector('#mrScInterval');
    if(!topic||!when||!duration||!repeat||!interval)return;
    upgraded.add(panel);panel.classList.add('mr-v3-polished');
    buildTopic(topic);
    buildDateTime(when,when.closest('.field'));
    buildDuration(duration);
    buildRepeat(repeat,interval,repeat.closest('.field'),interval.closest('.field'));
  }

  function scan(){document.querySelectorAll('.mr-sch48-create-v3').forEach(enhance)}
  document.addEventListener('pointerdown',e=>{
    if(e.target.closest('.mr-v3-control'))return;
    closeOtherPops(null);
  });
  new MutationObserver(scan).observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
})();