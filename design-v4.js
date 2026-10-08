(()=> {
  const icons={
    dashboard:'<path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/>',
    schedule:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    students:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    topics:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    textbooks:'<path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3z"/>',
    bank:'<path d="M3 7h18M5 7v12h14V7M9 11h6M9 15h6"/><path d="m9 3 3-2 3 2"/>',
    assignments:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 2.5 2.5L16 9"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    scratch:'<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13 7 4 4"/>',
    board:'<rect x="3" y="4" width="18" height="15" rx="2"/><path d="M8 22h8M12 19v3M7 9h10M7 13h6"/>',
    tasks:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    notes:'<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/>',
    timer:'<circle cx="12" cy="13" r="7.5"/><path d="M12 13V9M9 2h6M12 5V3"/>',
    materials:'<path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3z"/>',
    lesson:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.36.6.72 1 .9.25.1.55.15.85.15H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',
    reset:'<path d="M4 11a8 8 0 1 1 2 6"/><path d="M4 5v6h6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M7 6l1 15h8l1-15M10 10v7M14 10v7"/>',
    fullscreen:'<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    undo:'<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/>',
    redo:'<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/>',
    pen:'<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 7 3.5 3.5"/>',
    eraser:'<path d="m7 21-4-4 9-12a2 2 0 0 1 3-.2l4.2 4.2a2 2 0 0 1-.2 3L10 21z"/><path d="m8 12 5 5M10 21h9"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
    arrowLeft:'<path d="m14 6-6 6 6 6"/><path d="M8 12h11"/>',
    arrowRight:'<path d="m10 6 6 6-6 6"/><path d="M5 12h11"/>',
    arrowUp:'<path d="m6 14 6-6 6 6"/><path d="M12 8v11"/>',
    arrowDown:'<path d="m6 10 6 6 6-6"/><path d="M12 5v11"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    warning:'<path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    later:'<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 5v7h7"/>',
    empty:'<circle cx="12" cy="12" r="7"/>',
    target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
    save:'<path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    terminal:'<path d="m5 7 5 5-5 5"/><path d="M12 17h7"/>',
    logout:'<path d="M10 5H5v14h5"/><path d="m14 8 4 4-4 4M9 12h9"/>',
    stopTimer:'<circle cx="11" cy="12" r="7"/><path d="M11 8v4l2 1"/><rect x="14" y="14" width="7" height="7" rx="1.2"/>',
    list:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    flag:'<path d="M5 21V4"/><path d="M5 5h10l-2 4 2 4H5"/>',
    clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    historyClock:'<path d="M4 12a8 8 0 1 0 3-6"/><path d="M4 4v5h5M12 8v5l3 2"/>',
    bolt:'<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
    download:'<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
    center:'<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><circle cx="12" cy="12" r="2"/>'
  };

  function svg(name,cls=''){
    const fill=name==='dashboard'?'currentColor':'none';
    return '<span class="'+cls+'"><svg viewBox="0 0 24 24" fill="'+fill+'" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||icons.empty)+'</svg></span>';
  }

  function decorateBrand(){
    document.querySelectorAll('.sidebar .brand').forEach(el=>{
      if(el.dataset.v4Brand)return; el.dataset.v4Brand='1';
      el.insertAdjacentHTML('afterbegin','<span class="mr-v4-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V7l4.3 7L12 7l3.7 7L20 7v10"/></svg></span>');
    });
  }

  function decorateNav(){
    document.querySelectorAll('.sidebar .nav button[data-nav]').forEach(b=>{
      if(b.querySelector('.mr-v4-nav-icon'))return;
      const id=b.dataset.nav||'dashboard';
      b.insertAdjacentHTML('afterbegin',svg(icons[id]?id:'dashboard','mr-v4-nav-icon'));
    });
  }

  function decorateRail(){
    const map={tasks:'tasks',notes:'notes',timer:'timer',materials:'materials',lesson:'lesson'};
    document.querySelectorAll('.mr-rail-home-menu [data-rail-open]').forEach(b=>{
      const first=b.querySelector(':scope > span:first-child'); if(!first)return;
      if(!first.dataset.v4Icon){
        first.dataset.v4Icon='1';
        first.classList.add('mr-v4-rail-icon');
        first.innerHTML=svg(map[b.dataset.railOpen]||'lesson','');
      }
    });
  }

  function iconButton(selector,name,opt={}){
    document.querySelectorAll(selector).forEach(b=>{
      if(b.dataset.microIcon===name)return;
      const original=(b.getAttribute('aria-label')||b.textContent||'').trim();
      b.dataset.microIcon=name;
      if(opt.iconOnly){
        b.innerHTML=svg(name,'mr-micro-icon');
        b.classList.add('mr-micro-icon-only');
        if(original)b.setAttribute('aria-label',original);
        if(original)b.title=b.title||original;
        return;
      }
      let label=original;
      if(opt.stripGlyph) label=label.replace(/^[←→↑↓✓✔⚠↩○+⚡■□⏱⏹⟳⟲•]+\s*/u,'').trim();
      b.innerHTML=svg(name,'mr-micro-icon')+'<span class="mr-micro-label">'+label+'</span>';
      b.classList.add('mr-micro-action');
    });
  }

  function decorateLessonControls(){
    iconButton('#timerToggle','play');
    iconButton('#timerReset','reset');
    iconButton('#focusToggle','target');

    iconButton('#mrPrevTask','arrowLeft',{iconOnly:true});
    iconButton('#mrNextTask','arrowRight',{stripGlyph:true});
    iconButton('#mrNextOpen','flag');
    iconButton('#mrMoveUp','arrowUp',{stripGlyph:true});
    iconButton('#mrMoveDown','arrowDown',{stripGlyph:true});
    iconButton('[data-mr-status="solved"]','check',{stripGlyph:true});
    iconButton('[data-mr-status="hard"]','warning',{stripGlyph:true});
    iconButton('[data-mr-status="later"]','later',{stripGlyph:true});
    iconButton('[data-mr-status="pending"]','empty',{stripGlyph:true});
    iconButton('#mrPinnedToBoard','center');

    iconButton('#mrNoteTime','clock',{stripGlyph:true});
    iconButton('#mrNoteCurrent','tasks',{stripGlyph:true});
    iconButton('#mrNoteCheckpoint','historyClock');

    iconButton('#mrStartCustomTimer','play');
    iconButton('#mrStopTaskTimer','stopTimer');

    iconButton('#mrQuickPlan','bolt',{stripGlyph:true});
    iconButton('#mrQueueManager','list');
    iconButton('#mrLessonPlan','target');
    iconButton('#mrLessonHistory','historyClock');
    iconButton('#mrSaveTemplate','download');
    iconButton('#mrOpenTemplates','file');

    iconButton('#mrRailFocus','target');
    iconButton('#mrRailLink','link');
    iconButton('#mrRailSnapshot','save');
    iconButton('#mrRailCommands','terminal');
    iconButton('#mrRailExit','arrowLeft',{stripGlyph:true});
    iconButton('#mrRailFinish','logout');

    document.querySelectorAll('[data-rail-back]').forEach(b=>{
      if(b.dataset.microBack)return;
      b.dataset.microBack='1';
      const label=(b.textContent||'Назад').trim();
      b.innerHTML=svg('arrowLeft','mr-micro-icon');
      b.classList.add('mr-micro-icon-only');
      b.setAttribute('aria-label','Назад');
      b.title='Назад';
    });
  }

  const boardMap=[
    ['#backBoard','undo'],['#redoBoard','redo'],['#clearBoard','trash'],['#addBoardPage','plus'],
    ['#deleteBoardPage','trash'],['#exportPagePdf','image'],['#fullscreenBoard','fullscreen'],
    ['#boardFullscreen','fullscreen'],['#templatesBoard','board']
  ];
  function decorateBoard(){
    boardMap.forEach(([sel,name])=>{
      document.querySelectorAll(sel).forEach(b=>{
        if(b.dataset.v4Icon)return;b.dataset.v4Icon='1';b.classList.add('mr-v4-board-icon-button');
        b.insertAdjacentHTML('afterbegin',svg(name,'mr-v4-inline-icon'));
      });
    });
    document.querySelectorAll('.board-toolbar .btn').forEach(b=>b.classList.add('mr-v4-board-icon-button'));
  }

  function decorateQuick(){
    const b=document.querySelector('#mrQuickJumpButton'); if(!b||b.dataset.v4Icon)return;
    b.dataset.v4Icon='1';
    const s=b.querySelector('span'); if(s){s.innerHTML=svg('search','mr-v4-inline-icon');}
  }

  function sync(){
    decorateBrand();
    decorateNav();
    decorateRail();
    decorateLessonControls();
    decorateBoard();
    decorateQuick();
  }

  new MutationObserver(()=>requestAnimationFrame(sync)).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',sync);
  setTimeout(sync,0);
  setInterval(sync,1200);
})();