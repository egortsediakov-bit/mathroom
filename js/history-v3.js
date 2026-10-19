/* Mathroom 54.0 — Lesson History v3: student journal + detailed lesson workspace */
(function(){
  "use strict";
  var MR=window.MR||{};
  var S=MR.S, app=MR.app, sb=MR.sb, esc=MR.esc, nl=MR.nl, dateLong=MR.dateLong, modal=MR.modal, copyText=MR.copyText, toast=MR.toast, fail=MR.fail;
  if(!S||!app)return;
  var API={version:"54.0"};

  function initials(name){
    return String(name||"?").trim().split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x.charAt(0).toUpperCase()}).join("")||"?";
  }
  function dt(value){
    if(!value)return null;
    var d=new Date(value);return Number.isNaN(d.getTime())?null:d;
  }
  function dateCompact(value){
    var d=dt(value);if(!d)return "—";
    return d.toLocaleDateString("ru-RU",{day:"2-digit",month:"short"});
  }
  function timeCompact(value){
    var d=dt(value);if(!d)return "—";
    return d.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
  }
  function durationMinutes(l,report){
    if(report&&Number(report.duration_seconds)>0)return Math.max(1,Math.round(Number(report.duration_seconds)/60));
    if(Number(l.actual_duration_minutes)>0)return Number(l.actual_duration_minutes);
    var a=dt(l.started_at),b=dt(l.completed_at);
    if(a&&b)return Math.max(1,Math.round((b-a)/60000));
    return Number(l.duration_minutes)||null;
  }
  function icon(kind){
    var c='class="mr-history-icon-svg" viewBox="0 0 24 24" aria-hidden="true"';
    if(kind==="search")return '<svg '+c+'><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
    if(kind==="user")return '<svg '+c+'><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4.6 3.2-7 7-7s6.2 2.4 7 7"/></svg>';
    if(kind==="class")return '<svg '+c+'><path d="m3 9.5 9-4.5 9 4.5-9 4.5-9-4.5Z"/><path d="M7 12v4.2c2.8 1.8 7.2 1.8 10 0V12"/></svg>';
    if(kind==="clock")return '<svg '+c+'><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>';
    if(kind==="timeline")return '<svg '+c+'><circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><path d="M7 8v8M11 6h8M11 18h8"/></svg>';
    if(kind==="board")return '<svg '+c+'><rect x="4" y="4" width="16" height="13" rx="2"/><path d="M8 21h8M10 17v4m4-4v4M7 8h4m-4 4h8"/></svg>';
    if(kind==="tasks")return '<svg '+c+'><rect x="5" y="4" width="14" height="16" rx="2"/><path d="m8 9 1.5 1.5L12 8M8 15l1.5 1.5L12 14m2-5h2m-2 6h2"/></svg>';
    if(kind==="notes")return '<svg '+c+'><path d="M5 4h14v13H9l-4 3V4Z"/><path d="M8 8h8M8 12h6"/></svg>';
    if(kind==="chevron")return '<svg '+c+'><path d="m8 10 4 4 4-4"/></svg>';
    if(kind==="more")return '<svg '+c+'><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>';
    if(kind==="play")return '<svg '+c+'><path d="m9 7 8 5-8 5V7Z"/></svg>';
    if(kind==="save")return '<svg '+c+'><path d="M5 4h12l2 2v14H5V4Z"/><path d="M8 4v6h8V4M9 16h6"/></svg>';
    if(kind==="finish")return '<svg '+c+'><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
    if(kind==="copy")return '<svg '+c+'><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5H5v11h3"/></svg>';
    return '<svg '+c+'><circle cx="12" cy="12" r="8"/></svg>';
  }
  function lessonSearchText(l){
    return [l.students&&l.students.name,l.topics&&l.topics.title,l.public_summary,l.homework_plan,l.private_notes,dateLong(l.completed_at||l.started_at||l.scheduled_at)].filter(Boolean).join(" ").toLocaleLowerCase("ru");
  }
  function lessonCountLabel(n){
    var m=n%100;if(m>=11&&m<=14)return n+" уроков";
    var d=n%10;return n+" "+(d===1?"урок":d>=2&&d<=4?"урока":"уроков");
  }
  function groupHtml(studentId,lessons,index){
    var first=lessons[0]||{}, st=(S.students||[]).find(function(x){return String(x.id)===String(studentId)})||first.students||{};
    var topicCount=new Set(lessons.map(function(x){return String(x.topic_id||x.topics&&x.topics.title||"")})).size;
    var latest=first.completed_at||first.started_at||first.scheduled_at;
    var rows=lessons.map(function(l){
      var when=l.completed_at||l.started_at||l.scheduled_at;
      var versions=(S.versions||[]).filter(function(v){return String(v.lesson_id)===String(l.id)}).length;
      return '<div class="mr-history-lesson-row" data-history-row data-student="'+esc(String(studentId))+'" data-grade="'+esc(String(st.grade||l.students&&l.students.grade||""))+'" data-ts="'+(dt(when)?dt(when).getTime():0)+'" data-q="'+esc(lessonSearchText(l))+'">'+
        '<span class="mr-history-row-date"><b>'+esc(dateCompact(when))+'</b><small>'+esc(timeCompact(when))+'</small></span>'+
        '<span class="mr-history-row-topic"><b>'+esc(l.topics&&l.topics.title||"Без темы")+'</b><small>'+(versions?versions+" верс. доски":"Итог урока сохранён")+'</small></span>'+
        '<span class="mr-history-row-status '+attendanceClass(l.attendance_status)+'"><i></i>Завершён'+(attendanceLabel(l.attendance_status)?' · '+esc(attendanceLabel(l.attendance_status)):'')+'</span>'+
        '<span class="mr-history-row-actions"><button type="button" data-history-open="'+esc(String(l.id))+'">Открыть</button><button type="button" class="mr-history-more-trigger" data-history-more="'+esc(String(l.id))+'" aria-label="Ещё">'+icon("more")+'</button></span>'+
      '</div>';
    }).join("");
    return '<details class="mr-history-student-group" data-history-group '+(index===0?"open":"")+'>'+
      '<summary><span class="mr-history-avatar">'+esc(initials(st.name||first.students&&first.students.name))+'</span><span class="mr-history-student-copy"><b>'+esc(st.name||first.students&&first.students.name||"Ученик")+' <em>· '+esc(String(st.grade||first.students&&first.students.grade||"—"))+' класс</em></b><small>'+lessonCountLabel(lessons.length)+' · '+topicCount+' '+(topicCount===1?"тема":"тем")+' · последний '+esc(dateCompact(latest))+'</small></span><span class="mr-history-group-arrow">'+icon("chevron")+'</span></summary>'+
      '<div class="mr-history-group-table"><div class="mr-history-table-head"><span>Дата</span><span>Тема / программа</span><span>Статус</span><span>Действия</span></div>'+rows+'</div>'+
    '</details>';
  }


  function closeHistorySelects(except){
    document.querySelectorAll(".mr-history-select.open").forEach(function(x){if(x!==except)x.classList.remove("open")});
  }
  function upgradeHistorySelect(select){
    if(!select||select.dataset.historyStyled==="1")return;
    select.dataset.historyStyled="1";
    var shell=select.parentElement;
    if(!shell)return;
    shell.classList.add("mr-history-select-shell");
    select.classList.add("mr-history-native-select");
    var ui=document.createElement("div");
    ui.className="mr-history-select";
    ui.innerHTML='<button type="button" class="mr-history-select-trigger" aria-haspopup="listbox"><b></b><span>⌄</span></button><div class="mr-history-select-menu" role="listbox"></div>';
    select.after(ui);
    var trigger=ui.querySelector(".mr-history-select-trigger"),label=trigger.querySelector("b"),menu=ui.querySelector(".mr-history-select-menu");
    function renderOptions(){
      menu.innerHTML="";
      Array.from(select.options).forEach(function(opt){
        var b=document.createElement("button");
        b.type="button";b.dataset.value=opt.value;b.setAttribute("role","option");
        b.innerHTML='<span>'+esc(opt.textContent)+'</span><i>✓</i>';
        b.onclick=function(e){
          e.preventDefault();e.stopPropagation();
          select.value=opt.value;
          select.dispatchEvent(new Event("change",{bubbles:true}));
          ui.classList.remove("open");
          sync();
        };
        menu.appendChild(b);
      });
    }
    function sync(){
      var opt=select.options[select.selectedIndex];
      label.textContent=opt?opt.textContent:"—";
      menu.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",String(b.dataset.value)===String(select.value))});
    }
    trigger.onclick=function(e){
      e.preventDefault();e.stopPropagation();
      var open=!ui.classList.contains("open");
      closeHistorySelects(ui);
      ui.classList.toggle("open",open);
    };
    select.addEventListener("change",sync);
    renderOptions();sync();
  }

  function closeHistoryFloatingMenu(){
    document.querySelector(".mr-history-floating-menu")?.remove();
  }
  function openHistoryFloatingMenu(trigger,id,ctx){
    closeHistoryFloatingMenu();
    var menu=document.createElement("div");
    menu.className="mr-history-floating-menu";
    menu.innerHTML='<button type="button" class="danger">Удалить из истории</button>';
    document.body.appendChild(menu);
    var r=trigger.getBoundingClientRect();
    var menuWidth=190, gap=7;
    var left=Math.min(window.innerWidth-menuWidth-10,Math.max(10,r.right-menuWidth));
    var top=r.bottom+gap;
    if(top+56>window.innerHeight)top=Math.max(10,r.top-56-gap);
    menu.style.left=left+"px";menu.style.top=top+"px";
    menu.querySelector("button").onclick=async function(){
      try{
        closeHistoryFloatingMenu();
        await ctx.deleteCompletedLessonHistory(id);
        await ctx.loadTeacher();
        API.render(ctx);
        toast("Занятие удалено из истории");
      }catch(e){fail(e)}
    };
  }

  API.render=function(ctx){
    API.ctx=ctx||API.ctx||{};
    var all=(S.lessons||[]).filter(function(x){return x.status==="completed"}).slice().sort(function(a,b){
      return String(b.completed_at||b.created_at||"").localeCompare(String(a.completed_at||a.created_at||""));
    });
    if(!all.length){
      app.innerHTML=ctx.shell('<section class="mr-history-empty-v3"><span>'+icon("timeline")+'</span><h2>История пока пустая</h2><p>Завершённые занятия, заметки и версии доски появятся здесь автоматически.</p></section>',"История уроков","Итоги, заметки и сохранённые версии доски");
      ctx.bindShell();return;
    }
    var byStudent=new Map();
    all.forEach(function(l){var key=String(l.student_id||"unknown");if(!byStudent.has(key))byStudent.set(key,[]);byStudent.get(key).push(l)});
    var groups=[...byStudent.entries()].sort(function(a,b){
      var ad=String(a[1][0]&&a[1][0].completed_at||""),bd=String(b[1][0]&&b[1][0].completed_at||"");return bd.localeCompare(ad);
    });
    var studentOptions=groups.map(function(g){
      var l=g[1][0],st=(S.students||[]).find(function(x){return String(x.id)===String(g[0])})||l.students||{};
      return '<option value="'+esc(g[0])+'">'+esc(st.name||"Ученик")+'</option>';
    }).join("");
    var grades=[...new Set(groups.map(function(g){var l=g[1][0],st=(S.students||[]).find(function(x){return String(x.id)===String(g[0])})||l.students||{};return Number(st.grade)||null}).filter(Boolean))].sort(function(a,b){return a-b});
    var html='<div class="mr-history-v3">'+
      '<section class="mr-history-toolbar">'+
        '<label class="mr-history-search">'+icon("search")+'<input id="historyV3Search" type="search" placeholder="Поиск по ученику, теме, заметкам..."></label>'+
        '<div class="mr-history-filters">'+
          '<label>'+icon("user")+'<select id="historyV3Student"><option value="all">Все ученики</option>'+studentOptions+'</select></label>'+
          '<label>'+icon("class")+'<select id="historyV3Grade"><option value="all">Все классы</option>'+grades.map(function(g){return '<option value="'+g+'">'+g+' класс</option>'}).join("")+'</select></label>'+
          '<label>'+icon("clock")+'<select id="historyV3Period"><option value="all">За всё время</option><option value="30">30 дней</option><option value="90">3 месяца</option><option value="365">Год</option></select></label>'+
          '<button type="button" id="historyV3Expand">Развернуть все</button>'+
        '</div>'+
        '<div class="mr-history-toolbar-meta"><b>'+lessonCountLabel(all.length)+'</b><span>'+groups.length+' ученик'+(groups.length===1?"":"ов")+'</span><button type="button" class="danger" id="clearLessonHistory">Очистить историю</button></div>'+
      '</section>'+
      '<section class="mr-history-journal" id="historyV3Journal">'+groups.map(function(g,i){return groupHtml(g[0],g[1],i)}).join("")+'</section>'+
      '<div class="mr-history-empty-filter hidden" id="historyV3Empty">По выбранным фильтрам уроков нет.</div>'+
    '</div>';
    app.innerHTML=ctx.shell(html,"История уроков","Итоги, заметки и сохранённые версии доски");
    ctx.bindShell();

    var search=document.getElementById("historyV3Search"),student=document.getElementById("historyV3Student"),grade=document.getElementById("historyV3Grade"),period=document.getElementById("historyV3Period");
    if(S.historyStudentFilter&&Array.from(student.options).some(function(o){return String(o.value)===String(S.historyStudentFilter)})){
      student.value=String(S.historyStudentFilter);
    }
    [student,grade,period].forEach(upgradeHistorySelect);
    if(window.__mrHistorySelectOutside)document.removeEventListener("pointerdown",window.__mrHistorySelectOutside,true);
    window.__mrHistorySelectOutside=function(e){
      if(!e.target?.closest?.(".mr-history-select"))closeHistorySelects();
      if(!e.target?.closest?.(".mr-history-more-trigger")&&!e.target?.closest?.(".mr-history-floating-menu"))closeHistoryFloatingMenu();
    };
    document.addEventListener("pointerdown",window.__mrHistorySelectOutside,true);

    function apply(){
      var q=String(search.value||"").trim().toLocaleLowerCase("ru"),studentValue=student.value,gradeValue=grade.value,days=period.value==="all"?0:Number(period.value),minTs=days?Date.now()-days*86400000:0,total=0;
      document.querySelectorAll("[data-history-group]").forEach(function(group){
        var visible=0;
        group.querySelectorAll("[data-history-row]").forEach(function(row){
          var ok=(!q||String(row.dataset.q||"").includes(q))&&(studentValue==="all"||row.dataset.student===studentValue)&&(gradeValue==="all"||row.dataset.grade===gradeValue)&&(!minTs||Number(row.dataset.ts)>=minTs);
          row.hidden=!ok;if(ok){visible++;total++}
        });
        group.hidden=visible===0;
        if(visible&&(q||studentValue!=="all"||gradeValue!=="all"||days))group.open=true;
      });
      document.getElementById("historyV3Empty").classList.toggle("hidden",total>0);
    }
    [search,student,grade,period].forEach(function(el){el.addEventListener(el===search?"input":"change",function(){if(el===student)S.historyStudentFilter=student.value==="all"?"":student.value;apply()})});
    apply();
    var expand=document.getElementById("historyV3Expand"),expanded=false;
    expand.onclick=function(){expanded=!expanded;document.querySelectorAll("[data-history-group]:not([hidden])").forEach(function(g){g.open=expanded});expand.textContent=expanded?"Свернуть все":"Развернуть все"};
    var journal=document.getElementById("historyV3Journal");
    if(journal){
      journal.onclick=function(e){
        var openBtn=e.target.closest("[data-history-open]");
        if(openBtn){
          e.preventDefault();e.stopPropagation();
          if(openBtn.dataset.opening==="1")return;
          openBtn.dataset.opening="1";
          var oldText=openBtn.textContent;
          openBtn.textContent="Открываем…";
          Promise.resolve(API.open(openBtn.dataset.historyOpen,API.ctx)).catch(function(err){fail(err)}).finally(function(){
            if(openBtn.isConnected){openBtn.dataset.opening="";openBtn.textContent=oldText}
          });
          return;
        }
        var moreBtn=e.target.closest("[data-history-more]");
        if(moreBtn){
          e.preventDefault();e.stopPropagation();
          openHistoryFloatingMenu(moreBtn,moreBtn.dataset.historyMore,API.ctx);
        }
      };
    }
    document.getElementById("clearLessonHistory").onclick=function(){closeHistoryFloatingMenu();API.ctx.clearCompletedLessonHistory()};
    if(window.__mrHistoryReposition)window.removeEventListener("resize",window.__mrHistoryReposition);
    window.__mrHistoryReposition=function(){closeHistoryFloatingMenu();closeHistorySelects()};
    window.addEventListener("resize",window.__mrHistoryReposition);
  };

  function statusLabel(status){
    return {solved:"Решено",hard:"Сложно",later:"Вернуться позже",pending:"В очереди"}[status]||"В очереди";
  }
  function attendanceLabel(status){
    return {present:"Был",late:"Опоздал",absent:"Не был"}[status]||"";
  }
  function attendanceClass(status){
    return ["present","late","absent"].includes(status)?status:"";
  }
  function statusClass(status){
    return ["solved","hard","later","pending"].includes(status)?status:"pending";
  }
  function timelineHtml(l,versions){
    var events=[];
    var start=l.started_at||l.scheduled_at;if(start)events.push({at:start,type:"play",title:"Урок начался"});
    (versions||[]).forEach(function(v){events.push({at:v.created_at,type:"save",title:"Сохранена версия доски",sub:v.title||""})});
    var end=l.completed_at||l.created_at;if(end)events.push({at:end,type:"finish",title:"Урок завершён"});
    events.sort(function(a,b){return (dt(a.at)||0)-(dt(b.at)||0)});
    return '<div class="mr-history-timeline">'+events.map(function(e){
      return '<div><time>'+esc(timeCompact(e.at))+'</time><span class="mr-history-timeline-dot '+esc(e.type)+'">'+icon(e.type)+'</span><section><b>'+esc(e.title)+'</b>'+(e.sub?'<small>'+esc(e.sub)+'</small>':"")+'</section></div>';
    }).join("")+'</div>';
  }
  function versionHasContent(v){
    return Array.isArray(v&&v.pages)&&v.pages.some(function(p){return Array.isArray(p&&p.elements)&&p.elements.some(function(x){return x&&x.type!=="board-bg"})});
  }
  function boardHtml(versions){
    if(!versions.length)return '<div class="mr-history-panel-empty">'+icon("board")+'<b>Сохранённых версий доски нет</b><span>Версии появляются при сохранении и завершении урока.</span></div>';
    return '<div class="mr-history-board-grid">'+versions.map(function(v,i){
      var pages=Array.isArray(v.pages)?v.pages.length:0,hasContent=versionHasContent(v);
      return '<button type="button" data-history-version="'+esc(String(v.id))+'"><span class="mr-history-board-preview '+(hasContent?"":"empty")+'" data-history-preview="'+esc(String(v.id))+'">'+
        (hasContent?'<span class="mr-history-preview-loading">Загрузка доски…</span>':'<span class="mr-history-preview-empty">'+icon("board")+'<b>Доска пустая</b></span>')+
        '<em>'+String(i+1).padStart(2,"0")+'</em></span><b>'+esc(v.title||"Версия доски")+'</b><small>'+esc(dateCompact(v.created_at))+' · '+esc(timeCompact(v.created_at))+(pages?" · "+pages+" стр.":"")+'</small></button>';
    }).join("")+'</div>';
  }
  function hydrateBoardPreviews(scope,versions,ctx){
    var mount=ctx&&ctx.mountSnapshot||window.MathroomBoard&&window.MathroomBoard.mountSnapshot;
    if(!scope||!mount)return;
    scope.querySelectorAll("[data-history-preview]").forEach(function(root){
      var id=root.dataset.historyPreview;
      var v=(versions||[]).find(function(x){return String(x.id)===String(id)});
      if(!v||!versionHasContent(v)||root.dataset.previewReady==="1")return;
      root.dataset.previewReady="1";
      var pages=(v.pages||[]).slice();
      pages.sort(function(a,b){
        var ac=Array.isArray(a&&a.elements)&&a.elements.some(function(x){return x&&x.type!=="board-bg"})?1:0;
        var bc=Array.isArray(b&&b.elements)&&b.elements.some(function(x){return x&&x.type!=="board-bg"})?1:0;
        return bc-ac;
      });
      root.innerHTML='<span class="mr-history-preview-mount"></span><em>'+String(Math.max(1,(versions||[]).indexOf(v)+1)).padStart(2,"0")+'</em>';
      var host=root.querySelector(".mr-history-preview-mount");
      try{
        mount(host,pages);
        root.classList.add("real");
        var fit=function(){
          var svg=host.querySelector("svg");if(!svg)return;
          var groups=svg.querySelectorAll(":scope > g"),g=groups.length?groups[groups.length-1]:null;
          if(!g)return;
          try{
            var b=g.getBBox();
            if(!(b.width>0&&b.height>0))return;
            var pad=Math.max(18,Math.max(b.width,b.height)*.08);
            svg.setAttribute("viewBox",(b.x-pad)+" "+(b.y-pad)+" "+(b.width+pad*2)+" "+(b.height+pad*2));
            svg.setAttribute("preserveAspectRatio","xMidYMid meet");
          }catch(e){}
        };
        requestAnimationFrame(function(){requestAnimationFrame(fit)});
        var svg=host.querySelector("svg");
        if(svg){
          var observer=new MutationObserver(function(){requestAnimationFrame(fit)});
          observer.observe(svg,{childList:true,subtree:true});
          setTimeout(function(){observer.disconnect();fit()},4500);
        }
      }catch(e){
        console.warn("[Mathroom history preview]",e);
        root.classList.add("empty");
        root.innerHTML='<span class="mr-history-preview-empty">'+icon("board")+'<b>Не удалось показать превью</b></span><em>'+String(Math.max(1,(versions||[]).indexOf(v)+1)).padStart(2,"0")+'</em>';
      }
    });
  }
  function tasksHtml(report,queue){
    var cards=report?'<div class="mr-history-metrics">'+
      '<div class="orange"><span>Разобрано задач</span><b>'+Number(report.queue_total||0)+'</b></div>'+
      '<div class="green"><span>Решено</span><b>'+Number(report.solved_count||0)+'</b></div>'+
      '<div class="red"><span>Сложных</span><b>'+Number(report.hard_count||0)+'</b></div>'+
      '<div class="gray"><span>Вернуться позже</span><b>'+Number(report.later_count||0)+'</b></div>'+
    '</div>':'';
    if(!queue.length)return cards+'<div class="mr-history-panel-empty">'+icon("tasks")+'<b>Задачи урока не сохранились</b><span>Итоги и заметки урока всё равно доступны.</span></div>';
    return cards+'<div class="mr-history-task-list">'+queue.map(function(x,i){
      return '<div><span class="mr-history-task-index">'+String(i+1).padStart(2,"0")+'</span><section><b>'+esc(x.title||"Задача")+'</b><small>'+esc(x.category||x.difficulty||"")+'</small></section><em class="'+statusClass(x.status)+'">'+esc(statusLabel(x.status))+'</em></div>';
    }).join("")+'</div>';
  }
  function notesHtml(l,report){
    var highlights=report&&report.public_highlights||l.public_summary||"—";
    var focus=report&&report.public_focus||l.homework_plan||"—";
    var privateText=report&&report.private_summary||l.private_notes||"—";
    return '<div class="mr-history-notes-grid">'+
      '<article class="mr-history-note-card result"><header><span>01</span><div><small>УЧЕНИКУ</small><b>Итоги урока</b></div></header><div class="mr-history-note-body">'+nl(highlights)+'</div></article>'+
      '<article class="mr-history-note-card next"><header><span>02</span><div><small>СЛЕДУЮЩИЙ ШАГ</small><b>К следующему уроку</b></div></header><div class="mr-history-note-body">'+nl(focus)+'</div></article>'+
      '<article class="mr-history-note-card private wide"><header><span>03</span><div><small>ТОЛЬКО ПРЕПОДАВАТЕЛЮ</small><b>Приватные заметки</b></div></header><div class="mr-history-note-body">'+nl(privateText)+'</div></article>'+
    '</div>';
  }

  API.open=async function(id,ctx){
    ctx=ctx||API.ctx||{};API.ctx=ctx;
    id=String(id||"");
    var l=(S.lessons||[]).find(function(x){return String(x.id)===id});
    if(!l)return toast("Урок уже удалён");
    var versions=(S.versions||[]).filter(function(x){return String(x.lesson_id)===String(id)}).slice().sort(function(a,b){return String(a.created_at).localeCompare(String(b.created_at))});
    var pair=await Promise.all([
      sb.from("lesson_reports").select("*").eq("lesson_id",id).maybeSingle(),
      sb.from("lesson_queue_items").select("*").eq("lesson_id",id).order("position")
    ]);
    var report=pair[0].error?null:pair[0].data;
    var queue=pair[1].error?[]:(pair[1].data||[]);
    var mins=durationMinutes(l,report);
    var when=l.completed_at||l.started_at||l.scheduled_at;
    var st=(S.students||[]).find(function(x){return String(x.id)===String(l.student_id)})||l.students||{};
    var html='<div class="mr-history-modal-head">'+
      '<div class="mr-history-modal-person"><span class="mr-history-avatar large">'+esc(initials(st.name||l.students&&l.students.name))+'</span><div><span class="mr-history-modal-kicker">ЗАВЕРШЁННЫЙ УРОК</span><h2>'+esc(st.name||l.students&&l.students.name||"Ученик")+' · '+esc(l.topics&&l.topics.title||"Без темы")+'</h2><p>'+esc(dateLong(when))+(l.started_at?' · '+esc(timeCompact(l.started_at)):"")+(mins?" · "+mins+" мин":"")+'</p></div></div>'+
      '<div class="mr-history-modal-head-right">'+(attendanceLabel(l.attendance_status)?'<span class="mr-history-attendance '+attendanceClass(l.attendance_status)+'">'+esc(attendanceLabel(l.attendance_status))+'</span>':'')+'<span class="mr-history-completed">Завершён</span><button type="button" id="historyModalClose" aria-label="Закрыть">×</button></div>'+
    '</div>'+
    '<div class="mr-history-modal-layout">'+
      '<nav class="mr-history-modal-nav">'+
        '<button class="active" data-history-tab="timeline">'+icon("timeline")+'<span>Хронология</span></button>'+
        '<button data-history-tab="board">'+icon("board")+'<span>Доска</span><em>'+versions.length+'</em></button>'+
        '<button data-history-tab="tasks">'+icon("tasks")+'<span>Задачи</span><em>'+queue.length+'</em></button>'+
        '<button data-history-tab="notes">'+icon("notes")+'<span>Заметки</span></button>'+
      '</nav>'+
      '<main class="mr-history-modal-main">'+
        '<section class="active" data-history-panel="timeline"><div class="mr-history-panel-title"><div><span>Хронология занятия</span><h3>Что сохранилось за урок</h3></div>'+(mins?'<b>'+mins+' мин</b>':"")+'</div>'+timelineHtml(l,versions)+'<div class="mr-history-board-strip-head"><h3>Сохранённые версии доски</h3><button type="button" data-jump-tab="board">Все версии →</button></div>'+boardHtml(versions)+'</section>'+
        '<section data-history-panel="board"><div class="mr-history-panel-title"><div><span>Доска</span><h3>Сохранённые состояния</h3></div><b>'+versions.length+'</b></div>'+boardHtml(versions)+'</section>'+
        '<section data-history-panel="tasks"><div class="mr-history-panel-title"><div><span>Задачи</span><h3>Работа на уроке</h3></div>'+(report&&report.solved_percent!=null?'<b>'+Math.round(Number(report.solved_percent))+'%</b>':"")+'</div>'+tasksHtml(report,queue)+'</section>'+
        '<section data-history-panel="notes"><div class="mr-history-panel-title"><div><span>Заметки</span><h3>Итоги и следующий шаг</h3></div></div>'+notesHtml(l,report)+'</section>'+
      '</main>'+
    '</div>'+
    '<footer class="mr-history-modal-footer"><button type="button" class="danger ghost" id="deleteHistoryLesson">Удалить из истории</button><span></span><button type="button" id="historyParentReport">'+icon("copy")+'Отчёт родителю</button><button type="button" class="primary" id="historyExpandModal">Открыть полностью</button><button type="button" id="historyCloseBottom">Закрыть</button></footer>';
    var backdrop=modal(html,"wide-modal");
    backdrop.classList.add("mr-history-backdrop-v3");
    var m=backdrop.querySelector(".modal");
    if(!m)return;
    m.classList.add("mr-history-modal-v3");
    function setTab(name){
      m.querySelectorAll("[data-history-tab]").forEach(function(b){b.classList.toggle("active",b.dataset.historyTab===name)});
      m.querySelectorAll("[data-history-panel]").forEach(function(p){p.classList.toggle("active",p.dataset.historyPanel===name)});
      if(name==="timeline"||name==="board")requestAnimationFrame(function(){hydrateBoardPreviews(m,versions,ctx)});
    }
    requestAnimationFrame(function(){hydrateBoardPreviews(m,versions,ctx)});
    m.querySelectorAll("[data-history-tab]").forEach(function(b){b.onclick=function(){setTab(b.dataset.historyTab)}});
    m.querySelectorAll("[data-jump-tab]").forEach(function(b){b.onclick=function(){setTab(b.dataset.jumpTab)}});
    m.querySelectorAll("[data-history-version]").forEach(function(b){b.onclick=function(){
      var v=versions.find(function(x){return String(x.id)===String(b.dataset.historyVersion)});if(!v)return;
      var x=modal('<div class="mr-card-head"><div><span class="koto-eyebrow">ВЕРСИЯ ДОСКИ</span><h2>'+esc(v.title||"Доска")+'</h2><p class="muted">'+esc(dateLong(v.created_at))+(v.note?" · "+esc(v.note):"")+'</p></div></div><div id="snapshotRoot"></div>',"snapshot-modal");
      (ctx.mountSnapshot||window.MathroomBoard&&window.MathroomBoard.mountSnapshot)(x.querySelector("#snapshotRoot"),v.pages||[]);
    }});
    var close=function(){backdrop.remove()};
    m.querySelector("#historyModalClose").onclick=close;
    m.querySelector("#historyCloseBottom").onclick=close;
    m.querySelector("#historyExpandModal").onclick=function(){
      var on=m.classList.toggle("mr-history-modal-expanded");
      this.textContent=on?"Свернуть":"Открыть полностью";
    };
    m.querySelector("#historyParentReport").onclick=async function(){
      var result=report&&report.public_highlights||l.public_summary||"Итоги урока сохранены.";
      var focus=report&&report.public_focus||l.homework_plan||"";
      var text="Отчёт по уроку\n"+(st.name||l.students&&l.students.name||"Ученик")+" · "+(l.topics&&l.topics.title||"Урок")+"\n"+dateLong(when)+"\n\nИтоги:\n"+result+(focus?"\n\nК следующему уроку:\n"+focus:"");
      await copyText(text);toast("Отчёт родителю скопирован");
    };
    m.querySelector("#deleteHistoryLesson").onclick=async function(){
      try{await ctx.deleteCompletedLessonHistory(id);backdrop.remove();await ctx.loadTeacher();ctx.renderHistory();toast("Занятие удалено из истории")}catch(e){fail(e)}
    };
  };

  window.MathroomHistoryV3=API;
})();