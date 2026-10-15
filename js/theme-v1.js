(()=>{
  const KEY='mathroom.theme';
  const root=document.documentElement;
  const meta=document.querySelector('meta[name="theme-color"]');

  const current=()=>root.dataset.theme==='dark'?'dark':'light';
  const icon=theme=>theme==='dark'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 15.3A8.5 8.5 0 0 1 8.7 3.2 8.8 8.8 0 1 0 20.8 15.3Z"/></svg>';

  const apply=(theme,{persist=true}={})=>{
    const next=theme==='dark'?'dark':'light';
    root.dataset.theme=next;
    root.style.colorScheme=next;
    if(meta)meta.setAttribute('content',next==='dark'?'#0d0f12':'#f1f3f5');
    if(persist){
      try{localStorage.setItem(KEY,next)}catch{}
    }
    document.querySelectorAll('[data-mr-theme-toggle]').forEach(btn=>{
      const isDark=next==='dark';
      btn.classList.toggle('is-dark',isDark);
      btn.setAttribute('aria-pressed',String(isDark));
      btn.setAttribute('aria-label',isDark?'Включить светлую тему':'Включить тёмную тему');
      btn.title=isDark?'Светлая тема':'Тёмная тема';
      const ico=btn.querySelector('.mr-theme-icon');
      if(ico&&ico.dataset.themeIcon!==next){
        ico.dataset.themeIcon=next;
        ico.innerHTML=icon(next);
      }
      const label=btn.querySelector('.mr-theme-label');
      const labelText=isDark?'Светлая тема':'Тёмная тема';
      if(label&&label.textContent!==labelText)label.textContent=labelText;
    });
    window.dispatchEvent(new CustomEvent('mathroom:theme-change',{detail:{theme:next}}));
  };

  const toggle=()=>apply(current()==='dark'?'light':'dark');
  const button=(compact=true)=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='mr-theme-toggle'+(compact?' compact':'');
    b.dataset.mrThemeToggle='1';
    b.innerHTML='<span class="mr-theme-icon"></span>'+(compact?'':'<span class="mr-theme-label"></span>');
    b.addEventListener('click',toggle);
    return b;
  };

  function injectTeacher(){
    document.querySelectorAll('.layout .topbar').forEach(bar=>{
      const wrap=bar.querySelector(':scope > .mr-topbar-tools');
      let b=bar.querySelector('.mr-theme-toggle');
      if(!b)b=button(true);
      if(wrap){
        if(b.parentElement!==wrap)wrap.insertBefore(b,wrap.firstChild);
      }else if(b.parentElement!==bar){
        bar.appendChild(b);
      }else if(!b.isConnected){
        bar.appendChild(b);
      }
    });
  }

  function injectStudentDesktop(){
    document.querySelectorAll('.mr-student-desktop-topbar .mr-desk-topbar-actions').forEach(actions=>{
      if(actions.querySelector('.mr-theme-toggle'))return;
      actions.insertBefore(button(true),actions.firstChild);
    });
    document.querySelectorAll('.student-desktop-lesson-mode .mr-student-desktop-lesson-meta.topbar').forEach(bar=>{
      if(bar.querySelector(':scope > .mr-theme-toggle'))return;
      bar.appendChild(button(true));
    });
  }

  function injectStudentMobile(){
    document.querySelectorAll('.student-mobile-shell .mr-mobile-menu-list').forEach(menu=>{
      if(menu.querySelector('[data-mr-theme-toggle]'))return;
      const b=button(false);
      b.classList.add('mr-theme-mobile-menu');
      b.innerHTML='<span class="mr-mobile-menu-icon mr-theme-icon"></span><span><b class="mr-theme-label"></b><small>Переключить оформление Mathroom</small></span><i>›</i>';
      menu.appendChild(b);
    });
  }

  function injectAuthOrStandalone(){
    const hasPrimary=document.querySelector('.layout .topbar,.mr-student-desktop-topbar,.student-mobile-shell');
    let b=document.querySelector('.mr-theme-floating');
    const needs=!hasPrimary&&!!document.querySelector('.auth-card,.student-prelesson-mode,.student-home:not(.mr-student-desktop-shell)');
    if(needs&&!b){
      b=button(true);
      b.classList.add('mr-theme-floating');
      document.body.appendChild(b);
    }else if(!needs&&b){
      b.remove();
    }
  }

  let raf=0;
  function sync(){
    if(raf)return;
    raf=requestAnimationFrame(()=>{
      raf=0;
      injectTeacher();
      injectStudentDesktop();
      injectStudentMobile();
      injectAuthOrStandalone();
      apply(current(),{persist:false});
    });
  }

  window.MathroomTheme={get:current,set:theme=>apply(theme),toggle};

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('[data-mr-theme-toggle]');
    if(btn&&!btn.__mrThemeBound){
      btn.__mrThemeBound=true;
    }
  });

  new MutationObserver(sync).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',sync);
  sync();
})();