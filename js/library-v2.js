/* Mathroom v52.5 — approved textbook library visual direction #2.
   This layer keeps the proven textbook/upload logic from app-v341.js and only
   enhances the library presentation and selection workflow. */
(function(){

  function esc2(value){
    return String(value==null?"":value).replace(/[&<>"']/g,function(ch){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];
    });
  }
  function norm(value){
    return String(value||"").trim().toLocaleLowerCase("ru").replace(/ё/g,"е").replace(/\s+/g," ");
  }
  function mine(book){return String(book&&book.teacher_id||"")===String(S.user&&S.user.id||"")}
  function added(book){
    if(!book)return false;
    if(mine(book))return true;
    return (S.teacherTextbookLibrary||[]).some(function(x){
      return String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(S.user&&S.user.id);
    });
  }
  function linksFor(book){
    if(!book)return [];
    if(mine(book)||added(book)){
      return (S.textbookLinks||[]).filter(function(x){
        return String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(S.user&&S.user.id);
      });
    }
    return (S.textbookLinks||[]).filter(function(x){
      return String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(book.teacher_id);
    });
  }
  function topicTitle(link){
    var local=(S.topics||[]).find(function(t){return String(t.id)===String(link.topic_id)});
    return local&&local.title||link.topic_title||"Тема";
  }
  function gradeLabel(book){
    var a=Number(book&&book.grade_from)||0,b=Number(book&&book.grade_to)||a;
    if(!a)return "—";
    return a===b?String(a):String(a)+"–"+String(b);
  }
  function subjectLabel(book){return String(book&&book.subject||"Математика")}
  function coverKind(book){
    var q=norm(subjectLabel(book)+" "+String(book&&book.title||""));
    if(q.indexOf("геометр")>=0)return "geometry";
    if(q.indexOf("алгеб")>=0)return "algebra";
    return "math";
  }
  function coverHtml(book){
    return '<div class="mr-lib2-cover '+coverKind(book)+'"><span>'+esc2(subjectLabel(book))+'</span><b>'+esc2(gradeLabel(book))+'</b><small>класс</small></div>';
  }
  function detect(book){
    try{return window.MathroomTextbookSyncV290&&window.MathroomTextbookSyncV290.detectBook?window.MathroomTextbookSyncV290.detectBook(book):null}catch(e){return null}
  }
  function currentTab(){
    if(!S.libraryV2Tab)S.libraryV2Tab="mine";
    return S.libraryV2Tab;
  }
  function booksForTab(tab){
    var all=S.textbooks||[];
    if(tab==="shared")return all.filter(function(b){return b.is_shared&&!mine(b)});
    if(tab==="review")return all.filter(function(b){return mine(b)&&!(detect(b)&&detect(b).recognized)});
    return all.filter(function(b){return mine(b)||added(b)});
  }
  function countFor(tab){return booksForTab(tab).length}

  function detailHtml(book){
    if(!book)return '<div class="mr-lib2-detail-empty">Выберите учебник слева, чтобы увидеть темы, страницы и действия.</div>';
    var ls=linksFor(book),meta=detect(book),isMine=mine(book),isAdded=added(book);
    var status=isMine?"Мой PDF":isAdded?"В моей библиотеке":"Из общей библиотеки";
    var statusClass=isMine||isAdded?"own":"shared";
    var items=ls.slice(0,9).map(function(l,i){
      var pages=l.page_from?"Стр. "+l.page_from+(l.page_to&&l.page_to!==l.page_from?"–"+l.page_to:""):"Страницы не указаны";
      return '<div class="mr-lib2-topic"><span>'+(i+1)+'</span><div><b>'+esc2(topicTitle(l))+'</b><small>'+esc2(pages)+'</small></div></div>';
    }).join("");
    if(!items)items='<div class="mr-lib2-detail-empty compact">Для этого учебника темы пока не привязаны.</div>';
    var actions='<button class="btn primary" data-lib2-action="open" data-id="'+book.id+'">Открыть PDF</button>';
    if(isMine){
      actions+='<button class="btn" data-lib2-action="link" data-id="'+book.id+'">Редактировать темы и страницы</button>';
      actions+='<button class="btn library" data-lib2-action="share" data-id="'+book.id+'">'+(book.is_shared?"Убрать из общей":"В общую библиотеку")+'</button>';
    }else if(isAdded){
      actions+='<button class="btn" data-lib2-action="link" data-id="'+book.id+'">Редактировать темы и страницы</button>';
      actions+='<button class="btn danger" data-lib2-action="remove" data-id="'+book.id+'">Убрать из моей</button>';
    }else{
      actions+='<button class="btn library" data-lib2-action="add" data-id="'+book.id+'">Добавить в мою библиотеку</button>';
    }
    return '<div class="mr-lib2-detail-top">'+coverHtml(book)+'<div><h2>'+esc2(book.title||"Учебник")+'</h2><p>'+esc2(book.author||"Автор не указан")+'</p><div class="mr-lib2-meta"><span>'+esc2(gradeLabel(book))+' класс</span><span>'+esc2(subjectLabel(book))+'</span>'+(meta&&meta.part?'<span>Часть '+esc2(meta.part)+'</span>':"")+'</div><em class="mr-lib2-status '+statusClass+'">'+status+'</em></div></div>'+
      '<div class="mr-lib2-stats"><div><span>Темы привязаны</span><b>'+ls.length+'</b></div><div><span>Размер файла</span><b>'+(book.file_size&&typeof mrFormatBytes==="function"?mrFormatBytes(Number(book.file_size)):"—")+'</b></div></div>'+
      '<div class="mr-lib2-detail-actions">'+actions+'</div>'+
      '<div class="mr-lib2-divider"></div>'+
      '<div class="mr-lib2-detail-heading"><h3>'+(isMine||isAdded?"Мои темы и страницы":"Общие темы и страницы")+'</h3>'+(ls.length>9?'<span>9 из '+ls.length+'</span>':"")+'</div>'+
      '<div class="mr-lib2-topics">'+items+'</div>'+
      (!isMine&&!isAdded?'<div class="mr-lib2-note">Это эталонные привязки общей библиотеки. После добавления Mathroom скопирует их в вашу личную версию — дальше страницы и темы можно менять независимо.</div>':"");
  }

  function triggerLegacy(root,selector){
    var button=root.querySelector(selector);
    if(button){button.click();return true}
    return false;
  }
  function bindDetail(root,detail){
    detail.querySelectorAll("[data-lib2-action]").forEach(function(btn){
      btn.onclick=function(){
        var id=btn.getAttribute("data-id"),act=btn.getAttribute("data-lib2-action");
        if(act==="open")triggerLegacy(root,'[data-book-open="'+id+'"]');
        if(act==="link")triggerLegacy(root,'[data-book-link="'+id+'"]');
        if(act==="add")triggerLegacy(root,'[data-book-add-personal="'+id+'"]');
        if(act==="remove")triggerLegacy(root,'[data-book-remove-personal="'+id+'"]');
        if(act==="share")triggerLegacy(root,'[data-book-share="'+id+'"]');
      };
    });
  }

  function applyFilters(root){
    var tab=currentTab();
    var scope=tab==="shared"?root.querySelector(".mr-shared-books-section"):root.querySelector(".mr-lib2-personal");
    if(!scope)return;
    var query=norm((root.querySelector("#mrLib2Search")||{}).value||"");
    var subject=(root.querySelector("#mrLib2Subject")||{}).value||"all";
    var grade=(root.querySelector("#mrLib2Grade")||{}).value||"all";
    scope.querySelectorAll(".mr-textbook-card").forEach(function(card){
      var id=card.getAttribute("data-lib2-book"),book=(S.textbooks||[]).find(function(x){return String(x.id)===String(id)});
      var show=!!book;
      if(tab==="review")show=show&&mine(book)&&!(detect(book)&&detect(book).recognized);
      if(query){
        var hay=norm([book&&book.title,book&&book.author,book&&book.subject,book&&book.grade_from,book&&book.grade_to].filter(Boolean).join(" "));
        show=show&&hay.indexOf(query)>=0;
      }
      if(subject!=="all")show=show&&subjectLabel(book)===subject;
      if(grade!=="all"){
        var g=Number(grade),a=Number(book&&book.grade_from)||0,b=Number(book&&book.grade_to)||a;
        show=show&&a&&g>=a&&g<=b;
      }
      card.hidden=!show;
    });
  }

  function enhance(){
    var root=document.querySelector(".view-textbooks .content");
    if(!root||root.querySelector(".mr-lib2-head"))return;

    var upload=root.querySelector(".mr-textbook-upload");
    var shared=root.querySelector(".mr-shared-books-section");
    if(!upload||!shared)return;
    var personalTitle=upload.nextElementSibling;
    var personalGrid=personalTitle&&personalTitle.nextElementSibling;
    if(!personalTitle||!personalGrid)return;

    root.classList.add("mr-lib2-root");
    personalTitle.classList.add("mr-lib2-personal-title");
    personalGrid.classList.add("mr-lib2-personal-grid");
    var personal=document.createElement("section");
    personal.className="mr-lib2-personal";
    personalTitle.parentNode.insertBefore(personal,personalTitle);
    personal.appendChild(personalTitle);
    personal.appendChild(personalGrid);

    var allBooks=S.textbooks||[];
    var subjects=Array.from(new Set(allBooks.map(subjectLabel).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,"ru")});
    var head=document.createElement("div");
    head.className="mr-lib2-head";
    head.innerHTML='<div><h1>Библиотека учебников</h1><p>Используйте учебники из общей базы или добавляйте свои. Все привязанные темы и страницы сохраняются.</p></div>'+
      '<div class="mr-lib2-head-actions"><label class="mr-lib2-search"><span>⌕</span><input id="mrLib2Search" placeholder="Поиск по названию, автору, классам…"></label><button class="btn primary" id="mrLib2Upload">＋ Добавить учебник</button></div>';
    root.insertBefore(head,root.firstChild);

    var tabs=document.createElement("div");
    tabs.className="mr-lib2-tabs";
    tabs.innerHTML='<button data-lib2-tab="mine">Моя библиотека <span>'+countFor("mine")+'</span></button>'+
      '<button data-lib2-tab="shared">Общая библиотека <span>'+countFor("shared")+'</span></button>'+
      '<button data-lib2-tab="review">Нуждаются в уточнении <span>'+countFor("review")+'</span></button>';
    head.after(tabs);

    var filters=document.createElement("div");
    filters.className="mr-lib2-filters";
    filters.innerHTML='<label><span>Предмет</span><select id="mrLib2Subject"><option value="all">Все предметы</option>'+subjects.map(function(x){return '<option value="'+esc2(x)+'">'+esc2(x)+'</option>'}).join("")+'</select></label>'+
      '<label><span>Класс</span><select id="mrLib2Grade"><option value="all">Все классы</option>'+Array.from({length:11},function(_,i){return '<option value="'+(i+1)+'">'+(i+1)+' класс</option>'}).join("")+'</select></label>'+
      '<label><span>Сортировка</span><select id="mrLib2Sort"><option value="default">По умолчанию</option><option value="title">По названию</option><option value="topics">По числу тем</option></select></label>'+
      '<div class="mr-lib2-counter"></div>';
    tabs.after(filters);

    var workspace=document.createElement("div");
    workspace.className="mr-lib2-workspace";
    personal.parentNode.insertBefore(workspace,personal);
    var main=document.createElement("main");
    main.className="mr-lib2-main";
    workspace.appendChild(main);
    main.appendChild(personal);
    main.appendChild(shared);
    var detail=document.createElement("aside");
    detail.className="mr-lib2-detail";
    workspace.appendChild(detail);

    root.querySelectorAll(".mr-textbook-card").forEach(function(card){
      var open=card.querySelector("[data-book-open]");
      var id=open&&open.getAttribute("data-book-open");
      if(!id)return;
      var book=allBooks.find(function(x){return String(x.id)===String(id)});
      if(!book)return;
      card.classList.add("mr-lib2-card");
      card.setAttribute("data-lib2-book",id);
      card.setAttribute("data-lib2-title",norm(book.title));
      card.insertAdjacentHTML("afterbegin",coverHtml(book));
      var actions=card.querySelector(".mr-card-head>.actions");
      if(actions)actions.classList.add("mr-lib2-card-actions");
      card.onclick=function(e){
        if(e.target.closest("button"))return;
        S.libraryV2SelectedBook=id;
        root.querySelectorAll(".mr-lib2-card").forEach(function(x){x.classList.toggle("selected",String(x.getAttribute("data-lib2-book"))===String(id))});
        detail.innerHTML=detailHtml(book);
        bindDetail(root,detail);
      };
    });

    function setTab(tab){
      S.libraryV2Tab=tab;
      tabs.querySelectorAll("button").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-lib2-tab")===tab)});
      personal.hidden=tab==="shared";
      shared.hidden=tab!=="shared";
      if(tab==="review")personal.hidden=false;
      var available=booksForTab(tab);
      var selected=available.find(function(b){return String(b.id)===String(S.libraryV2SelectedBook)});
      if(!selected)selected=available[0]||null;
      S.libraryV2SelectedBook=selected&&selected.id||null;
      root.querySelectorAll(".mr-lib2-card").forEach(function(card){card.classList.toggle("selected",String(card.getAttribute("data-lib2-book"))===String(S.libraryV2SelectedBook))});
      detail.innerHTML=detailHtml(selected);
      bindDetail(root,detail);
      applyFilters(root);
      updateCounter();
    }
    function visibleCards(){
      var scope=currentTab()==="shared"?shared:personal;
      return Array.from(scope.querySelectorAll(".mr-lib2-card")).filter(function(c){return !c.hidden});
    }
    function updateCounter(){
      var counter=filters.querySelector(".mr-lib2-counter");
      if(counter)counter.textContent=visibleCards().length+" учебников";
    }
    function sortCards(){
      var scope=currentTab()==="shared"?shared.querySelector(".grid"):personalGrid;
      if(!scope)return;
      var mode=filters.querySelector("#mrLib2Sort").value;
      var cards=Array.from(scope.querySelectorAll(".mr-lib2-card"));
      cards.sort(function(a,b){
        var ba=allBooks.find(function(x){return String(x.id)===String(a.getAttribute("data-lib2-book"))});
        var bb=allBooks.find(function(x){return String(x.id)===String(b.getAttribute("data-lib2-book"))});
        if(mode==="title")return String(ba&&ba.title||"").localeCompare(String(bb&&bb.title||""),"ru");
        if(mode==="topics")return linksFor(bb).length-linksFor(ba).length;
        return 0;
      });
      cards.forEach(function(c){scope.appendChild(c)});
    }

    tabs.querySelectorAll("[data-lib2-tab]").forEach(function(btn){btn.onclick=function(){setTab(btn.getAttribute("data-lib2-tab"))}});
    ["mrLib2Search","mrLib2Subject","mrLib2Grade"].forEach(function(id){
      var el=root.querySelector("#"+id);
      if(el)el.addEventListener(id==="mrLib2Search"?"input":"change",function(){applyFilters(root);updateCounter()});
    });
    filters.querySelector("#mrLib2Sort").onchange=function(){sortCards();applyFilters(root);updateCounter()};
    head.querySelector("#mrLib2Upload").onclick=function(){
      upload.classList.add("mr-lib2-upload-open");
      upload.scrollIntoView({behavior:"smooth",block:"start"});
      var title=upload.querySelector("#tbTitle");if(title)setTimeout(function(){title.focus()},250);
    };

    upload.classList.add("mr-lib2-upload");
    var close=document.createElement("button");
    close.type="button";close.className="mr-lib2-upload-close";close.textContent="×";
    close.onclick=function(){upload.classList.remove("mr-lib2-upload-open")};
    upload.insertBefore(close,upload.firstChild);

    shared.querySelector(".notice.mr-library-note")&&shared.querySelector(".notice.mr-library-note").classList.add("mr-lib2-shared-note");
    setTab(currentTab());
  }

  window.MathroomLibraryV2={enhance:enhance};
  var run=function(){try{enhance()}catch(e){console.error("[Mathroom library v2]",e)}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});
  else setTimeout(run,0);
})();