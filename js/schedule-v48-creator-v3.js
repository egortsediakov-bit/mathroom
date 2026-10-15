(() => {
  'use strict';

  const MR=window.MR||{};
  const S=MR.S||{};
  const esc=MR.esc||((v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
  const upgraded=new WeakSet();

  function topicIcon(){
    return '<svg class="mr-v3-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Z"/><path class="accent" d="M20 5.5c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>';
  }
  function clockIcon(){
    return '<svg class="mr-v3-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path class="accent" d="M12 7v5l3 2"/></svg>';
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

  function buildTopicPicker(select){
    const selected=(S.topics||[]).find(x=>String(x.id)===String(select.value));
    const wrap=document.createElement('div');
    wrap.className='mr-v3-topic-picker';
    wrap.dataset.topicBucket='all';
    wrap.innerHTML=`
      <button type="button" class="mr-v3-topic-trigger">
        <span class="icon">${topicIcon()}</span>
        <span class="copy"><b>${esc(selected?.title||'Выбрать тему')}</b><small>${selected?esc(selected.grade)+' класс':'Поиск по теме или классу'}</small></span>
        <span class="chev">⌄</span>
      </button>
      <div class="mr-v3-topic-pop" hidden>
        <label class="mr-v3-topic-search"><span>⌕</span><input type="search" placeholder="Поиск темы или класса..." autocomplete="off"></label>
        <div class="mr-v3-topic-chips">
          <button type="button" class="active" data-bucket="all">Все</button>
          <button type="button" data-bucket="1-4">1–4 кл.</button>
          <button type="button" data-bucket="5-8">5–8 кл.</button>
          <button type="button" data-bucket="9-11">9–11 кл.</button>
        </div>
        <div class="mr-v3-topic-results"></div>
      </div>`;
    select.classList.add('mr-v3-native-hidden');
    select.insertAdjacentElement('afterend',wrap);

    const trigger=wrap.querySelector('.mr-v3-topic-trigger');
    const pop=wrap.querySelector('.mr-v3-topic-pop');
    const search=wrap.querySelector('.mr-v3-topic-search input');
    const results=wrap.querySelector('.mr-v3-topic-results');

    const render=()=>{
      const rows=topicRows(search.value,wrap.dataset.topicBucket||'all');
      results.innerHTML=rows.length?rows.map(t=>`
        <button type="button" class="mr-v3-topic-row ${String(t.id)===String(select.value)?'selected':''}" data-topic-id="${esc(t.id)}">
          <span class="grade">${esc(t.grade)}</span>
          <span class="info"><b>${esc(t.title)}</b><small>${esc(t.section||t.grade+' класс')}</small></span>
          <i>${String(t.id)===String(select.value)?'✓':''}</i>
        </button>`).join(''):'<div class="mr-v3-empty">Ничего не найдено</div>';
    };
    const close=()=>{pop.hidden=true;trigger.classList.remove('open')};
    const open=()=>{pop.hidden=false;trigger.classList.add('open');render();setTimeout(()=>search.focus(),0)};
    trigger.onclick=()=>pop.hidden?open():close();
    search.addEventListener('input',render);
    wrap.querySelectorAll('[data-bucket]').forEach(b=>b.onclick=()=>{
      wrap.dataset.topicBucket=b.dataset.bucket;
      wrap.querySelectorAll('[data-bucket]').forEach(x=>x.classList.toggle('active',x===b));
      render();
    });
    results.addEventListener('click',e=>{
      const row=e.target.closest('[data-topic-id]');if(!row)return;
      select.value=row.dataset.topicId;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      const t=(S.topics||[]).find(x=>String(x.id)===String(select.value));
      trigger.querySelector('.copy b').textContent=t?.title||'Выбрать тему';
      trigger.querySelector('.copy small').textContent=t?`${t.grade} класс`:'Поиск по теме или классу';
      close();
    });
    document.addEventListener('pointerdown',function outside(e){
      if(!document.body.contains(wrap)){document.removeEventListener('pointerdown',outside);return}
      if(!wrap.contains(e.target))close();
    });
  }

  function buildDuration(input){
    input.classList.add('mr-v3-native-hidden');
    const box=document.createElement('div');
    box.className='mr-v3-duration';
    box.innerHTML=`<button type="button" data-minus aria-label="Уменьшить">−</button><span class="clock">${clockIcon()}</span><b data-value>${esc(input.value||60)}</b><em>мин</em><button type="button" data-plus aria-label="Увеличить">+</button>`;
    input.insertAdjacentElement('afterend',box);
    const sync=()=>{
      const v=Math.max(15,Math.min(240,Number(input.value||60)));
      input.value=String(v);box.querySelector('[data-value]').textContent=String(v);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    };
    box.querySelector('[data-minus]').onclick=()=>{input.value=String(Math.max(15,Number(input.value||60)-5));sync()};
    box.querySelector('[data-plus]').onclick=()=>{input.value=String(Math.min(240,Number(input.value||60)+5));sync()};
  }

  function buildRepeat(repeat,interval,field,intervalField){
    repeat.classList.add('mr-v3-native-hidden');
    interval.classList.add('mr-v3-native-hidden');
    intervalField.classList.add('mr-v3-interval-legacy');

    const wrap=document.createElement('div');
    wrap.className='mr-v3-repeat';
    wrap.innerHTML=`
      <div class="mr-v3-repeat-main">
        <button type="button" data-mode="1"><span>◉</span>Один урок</button>
        <button type="button" data-mode="forever"><span>▣</span>Каждую неделю</button>
        <button type="button" data-mode="custom"><span>↻</span>Другое</button>
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
      const v=String(repeat.value||'1');
      wrap.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',(v==='1'&&b.dataset.mode==='1')||(v==='forever'&&b.dataset.mode==='forever')||(!['1','forever'].includes(v)&&b.dataset.mode==='custom')));
      const custom=!['1','forever'].includes(v);
      wrap.querySelector('.mr-v3-repeat-extra').hidden=!custom;
      wrap.querySelectorAll('[data-count]').forEach(b=>b.classList.toggle('active',String(b.dataset.count)===v));
      const disabled=v==='1';
      wrap.querySelector('.mr-v3-interval').classList.toggle('disabled',disabled);
      wrap.querySelectorAll('[data-interval]').forEach(b=>{b.disabled=disabled;b.classList.toggle('active',String(b.dataset.interval)===String(interval.value||'1'))});
    };
    wrap.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
      const mode=b.dataset.mode;
      if(mode==='1'||mode==='forever')repeat.value=mode;
      else if(!['4','8','12','16'].includes(String(repeat.value)))repeat.value='4';
      repeat.dispatchEvent(new Event('change',{bubbles:true}));refresh();
    });
    wrap.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>{
      repeat.value=b.dataset.count;repeat.dispatchEvent(new Event('change',{bubbles:true}));refresh();
    });
    wrap.querySelectorAll('[data-interval]').forEach(b=>b.onclick=()=>{
      interval.value=b.dataset.interval;interval.dispatchEvent(new Event('change',{bubbles:true}));refresh();
    });
    repeat.addEventListener('change',refresh);interval.addEventListener('change',refresh);refresh();
  }

  function enhance(panel){
    if(!panel||upgraded.has(panel))return;
    const topic=panel.querySelector('#mrScTopic');
    const duration=panel.querySelector('#mrScDuration');
    const repeat=panel.querySelector('#mrScRepeat');
    const interval=panel.querySelector('#mrScInterval');
    if(!topic||!duration||!repeat||!interval)return;
    upgraded.add(panel);
    panel.classList.add('mr-sch48-create-v3-polished');

    buildTopicPicker(topic);
    buildDuration(duration);
    buildRepeat(repeat,interval,repeat.closest('.field'),interval.closest('.field'));

    topic.closest('.field')?.classList.add('mr-v3-topic-field');
    duration.closest('.field')?.classList.add('mr-v3-duration-field');
    repeat.closest('.field')?.classList.add('mr-v3-repeat-field');
  }

  function scan(){
    document.querySelectorAll('.mr-sch48-create-v3').forEach(enhance);
  }
  const obs=new MutationObserver(()=>scan());
  obs.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan,{once:true});else scan();
})();