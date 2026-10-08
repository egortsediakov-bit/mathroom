(()=> {
  const NS='http://www.w3.org/2000/svg';
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
    tasks:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    notes:'<path d="M4 20h4l11-11-4-4L4 16z"/><path d="m13 7 4 4"/>',
    timer:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    materials:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
    lesson:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    play:'<path d="m8 5 11 7-11 7z"/>',
    reset:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M7 6l1 15h8l1-15M10 10v7M14 10v7"/>',
    fullscreen:'<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    undo:'<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/>',
    redo:'<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6"/>',
    pen:'<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10z"/><path d="m13.5 7 3.5 3.5"/>',
    eraser:'<path d="m7 21-4-4 9-12a2 2 0 0 1 3-.2l4.2 4.2a2 2 0 0 1-.2 3L10 21z"/><path d="m8 12 5 5M10 21h9"/>',
    image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>'
  };
  function svg(name,cls=''){
    const fill=name==='dashboard'||name==='lesson'?'currentColor':'none';
    return '<span class="'+cls+'"><svg viewBox="0 0 24 24" fill="'+fill+'" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||icons.lesson)+'</svg></span>';
  }
  function decorateBrand(){
    document.querySelectorAll('.sidebar .brand').forEach(el=>{
      if(el.dataset.v4Brand)return; el.dataset.v4Brand='1';
      el.insertAdjacentHTML('afterbegin','<span class="mr-v4-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V7l4.3 7L12 7l3.7 7L20 7v10"/></svg></span>');
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
      const first=b.querySelector(':scope > span:first-child'); if(!first||first.dataset.v4Icon)return;
      first.dataset.v4Icon='1'; first.classList.add('mr-v4-rail-icon'); first.innerHTML=svg(map[b.dataset.railOpen]||'lesson','');
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
      })
    });
    document.querySelectorAll('.board-toolbar .btn').forEach(b=>b.classList.add('mr-v4-board-icon-button'));
  }
  function decorateQuick(){
    const b=document.querySelector('#mrQuickJumpButton'); if(!b||b.dataset.v4Icon)return;
    b.dataset.v4Icon='1';
    const s=b.querySelector('span'); if(s){s.innerHTML=svg('search','mr-v4-inline-icon');}
  }
  function sync(){decorateBrand();decorateNav();decorateRail();decorateBoard();decorateQuick();}
  new MutationObserver(()=>requestAnimationFrame(sync)).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',sync);setTimeout(sync,0);setInterval(sync,1500);
})();