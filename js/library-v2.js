/* Mathroom v52.7 — textbook library polish.
   Real PDF covers, custom Mathroom selectors, larger typography and stronger black accents. */
(function(){
  var MR=window.MR||{};
  var S=MR.S||window.S;
  var sb=MR.sb||window.sb;
  if(!S)return;

  var coverCache=window.__MathroomTextbookCoverCache||(window.__MathroomTextbookCoverCache=new Map());
  var coverPromises=window.__MathroomTextbookCoverPromises||(window.__MathroomTextbookCoverPromises=new Map());
  var coverQueue=[];
  var coverActive=0;
  var MAX_COVER_JOBS=2;

  function esc2(value){
    return String(value==null?"":value).replace(/[&<>"']/g,function(ch){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];
    });
  }
  function norm(value){
    return String(value||"").trim().toLocaleLowerCase("ru").replace(/ё/g,"е").replace(/\s+/g," ");
  }
  function fmtBytes(value){
    var n=Number(value)||0;if(!n)return "—";
    var units=["Б","КБ","МБ","ГБ"],i=0;
    while(n>=1024&&i<units.length-1){n/=1024;i++}
    return (i<2?Math.round(n):n.toFixed(n>=10?1:2).replace(".",","))+" "+units[i];
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
  function filtersState(){
    if(!S.libraryV2Filters)S.libraryV2Filters={subject:"all",grade:"all",sort:"default"};
    return S.libraryV2Filters;
  }

  function coverHtml(book,variant){
    variant=variant||"card";
    return '<div class="mr-lib2-cover real '+variant+'" data-mr-pdf-cover="'+esc2(book&&book.id||"")+'">'+
      '<div class="mr-lib2-cover-skeleton"><span>PDF</span><i></i><i></i><i></i></div>'+
    '</div>';
  }
  async function createCover(book){
    if(!book||!book.id||!book.file_path||!sb||!window.pdfjsLib)return null;
    var key=String(book.id);
    if(coverCache.has(key))return coverCache.get(key);
    var signed=await sb.storage.from("textbooks").createSignedUrl(book.file_path,900);
    if(signed.error)throw signed.error;
    if(window.pdfjsLib.GlobalWorkerOptions&&!window.pdfjsLib.GlobalWorkerOptions.workerSrc){
      window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    var task=window.pdfjsLib.getDocument({
      url:signed.data.signedUrl,
      rangeChunkSize:65536,
      disableAutoFetch:true
    });
    var pdf=await task.promise;
    var page=await pdf.getPage(1);
    var raw=page.getViewport({scale:1});
    var target=220;
    var scale=Math.max(.35,Math.min(2,target/Math.max(1,raw.width)));
    var viewport=page.getViewport({scale:scale});
    var canvas=document.createElement("canvas");
    var ctx=canvas.getContext("2d",{alpha:false});
    var dpr=Math.min(1.6,window.devicePixelRatio||1);
    canvas.width=Math.max(1,Math.floor(viewport.width*dpr));
    canvas.height=Math.max(1,Math.floor(viewport.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    await page.render({canvasContext:ctx,viewport:viewport}).promise;
    var dataUrl=canvas.toDataURL("image/jpeg",.84);
    coverCache.set(key,dataUrl);
    try{page.cleanup()}catch(e){}
    try{await pdf.destroy()}catch(e){}
    return dataUrl;
  }
  function pumpCovers(){
    while(coverActive<MAX_COVER_JOBS&&coverQueue.length){
      var job=coverQueue.shift();coverActive++;
      createCover(job.book).then(job.resolve,job.reject).finally(function(){coverActive--;pumpCovers()});
    }
  }
  function loadCover(book){
    var key=String(book&&book.id||"");
    if(!key)return Promise.resolve(null);
    if(coverCache.has(key))return Promise.resolve(coverCache.get(key));
    if(coverPromises.has(key))return coverPromises.get(key);
    var p=new Promise(function(resolve,reject){coverQueue.push({book:book,resolve:resolve,reject:reject});pumpCovers()})
      .finally(function(){coverPromises.delete(key)});
    coverPromises.set(key,p);
    return p;
  }
  function paintCover(el,book){
    if(!el||!book)return;
    var cached=coverCache.get(String(book.id));
    if(cached){
      el.innerHTML='<img src="'+cached+'" alt="" loading="lazy">';
      el.classList.add("loaded");return;
    }
    el.classList.add("loading");
    loadCover(book).then(function(src){
      if(!src||!el.isConnected)return;
      el.innerHTML='<img src="'+src+'" alt="" loading="lazy">';
      el.classList.remove("loading");el.classList.add("loaded");
    }).catch(function(err){
      console.warn("[Mathroom PDF cover]",book.title,err);
      if(!el.isConnected)return;
      el.classList.remove("loading");el.classList.add("failed");
      el.innerHTML='<div class="mr-lib2-cover-fallback"><b>PDF</b><span>'+esc2(gradeLabel(book))+' класс</span></div>';
    });
  }
  function hydrateCovers(scope){
    if(!scope)return;
    var nodes=Array.from(scope.querySelectorAll("[data-mr-pdf-cover]"));
    if(!nodes.length)return;
    var all=S.textbooks||[];
    if(!("IntersectionObserver" in window)){
      nodes.forEach(function(el){var b=all.find(function(x){return String(x.id)===String(el.dataset.mrPdfCover)});paintCover(el,b)});
      return;
    }
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting)return;
        io.unobserve(entry.target);
        var b=all.find(function(x){return String(x.id)===String(entry.target.dataset.mrPdfCover)});
        paintCover(entry.target,b);
      });
    },{rootMargin:"240px 0px"});
    nodes.forEach(function(el){io.observe(el)});
  }

  function detailHtml(book){
    if(!book)return '<div class="mr-lib2-detail-empty">Выберите учебник слева, чтобы увидеть темы, страницы и действия.</div>';
    var ls=linksFor(book),meta=detect(book),isMine=mine(book),isAdded=added(book);
    var status=isMine?"Мой PDF":isAdded?"В моей библиотеке":"Из общей библиотеки";
    var statusClass=isMine||isAdded?"own":"shared";
    var items=ls.slice(0,12).map(function(l,i){
      var pages=l.page_from?"Стр. "+l.page_from+(l.page_to&&l.page_to!==l.page_from?"–"+l.page_to:""):"Страницы не указаны";
      return '<div class="mr-lib2-topic"><span>'+(i+1)+'</span><div><b>'+esc2(topicTitle(l))+'</b><small>'+esc2(pages)+'</small></div><i>›</i></div>';
    }).join("");
    if(!items)items='<div class="mr-lib2-detail-empty compact">Для этого учебника темы пока не привязаны.</div>';
    var actions='<button class="btn primary" data-lib2-action="open" data-id="'+book.id+'"><span class="mr-lib2-btn-icon">▣</span>Открыть PDF</button>';
    if(isMine){
      actions+='<button class="btn" data-lib2-action="link" data-id="'+book.id+'">Темы и страницы</button>';
      actions+='<button class="btn library" data-lib2-action="share" data-id="'+book.id+'">'+(book.is_shared?"Убрать из общей":"В общую библиотеку")+'</button>';
    }else if(isAdded){
      actions+='<button class="btn" data-lib2-action="link" data-id="'+book.id+'">Темы и страницы</button>';
      actions+='<button class="btn danger" data-lib2-action="remove" data-id="'+book.id+'">Убрать из моей</button>';
    }else{
      actions+='<button class="btn library" data-lib2-action="add" data-id="'+book.id+'"><span class="mr-lib2-btn-icon">＋</span>Добавить в мою библиотеку</button>';
    }
    return '<div class="mr-lib2-detail-top">'+coverHtml(book,"detail")+'<div class="mr-lib2-detail-copy"><h2>'+esc2(book.title||"Учебник")+'</h2><p>'+esc2(book.author||"Автор не указан")+'</p><div class="mr-lib2-meta"><span>'+esc2(gradeLabel(book))+' класс</span><span>'+esc2(subjectLabel(book))+'</span>'+(meta&&meta.part?'<span>Часть '+esc2(meta.part)+'</span>':"")+'</div><em class="mr-lib2-status '+statusClass+'">'+status+'</em></div></div>'+
      '<div class="mr-lib2-stats"><div><span>Темы привязаны</span><b>'+ls.length+'</b></div><div><span>Размер файла</span><b>'+fmtBytes(book.file_size)+'</b></div></div>'+
      '<div class="mr-lib2-detail-actions">'+actions+'</div>'+
      '<div class="mr-lib2-divider"></div>'+
      '<div class="mr-lib2-detail-heading"><h3>'+(isMine||isAdded?"Мои темы и страницы":"Общие темы и страницы")+'</h3>'+(ls.length>12?'<span>12 из '+ls.length+'</span>':"")+'</div>'+
      '<div class="mr-lib2-topics">'+items+'</div>'+
      (!isMine&&!isAdded?'<div class="mr-lib2-note">Это общая эталонная карта. После добавления учебника Mathroom скопирует темы и страницы в вашу личную версию — дальше их можно менять независимо.</div>':"");
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
    hydrateCovers(detail);
  }

  function subjectIcon(value){
    var q=norm(value);
    if(value==="all")return '<svg viewBox="0 0 24 24"><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Zm16 0c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>';
    if(q.indexOf("геометр")>=0)return '<svg viewBox="0 0 24 24"><path d="m12 4 8 15H4L12 4Z"/><circle cx="12" cy="14" r="1.5"/></svg>';
    if(q.indexOf("алгеб")>=0||q.indexOf("анализ")>=0)return '<svg viewBox="0 0 24 24"><path d="M18 5H8l5 7-5 7h10"/></svg>';
    return '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 8h8M8 12h2m3 0h3m-8 4h2m3 0h3"/></svg>';
  }
  function filterIcon(kind){
    if(kind==="grade")return '<svg viewBox="0 0 24 24"><path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M7 13v4c3 2 7 2 10 0v-4"/></svg>';
    return '<svg viewBox="0 0 24 24"><path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3"/></svg>';
  }
  function dropdownMarkup(key,label,options,value,icon){
    var selected=options.find(function(o){return String(o.value)===String(value)})||options[0];
    return '<div class="mr-lib2-field"><span class="mr-lib2-field-label">'+esc2(label)+'</span><div class="mr-lib2-select" data-lib2-select="'+key+'">'+
      '<button type="button" class="mr-lib2-select-trigger" aria-haspopup="listbox"><span class="mr-lib2-select-icon">'+icon+'</span><b data-lib2-select-text>'+esc2(selected.label)+'</b><span class="mr-lib2-chevron">⌄</span></button>'+
      '<div class="mr-lib2-select-menu" role="listbox">'+options.map(function(o){
        var active=String(o.value)===String(value);
        var itemIcon=key==="subject"?subjectIcon(o.value):icon;
        return '<button type="button" role="option" data-value="'+esc2(o.value)+'" class="'+(active?"active":"")+'"><span>'+itemIcon+'</span><b>'+esc2(o.label)+'</b><i>✓</i></button>';
      }).join("")+'</div></div></div>';
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

    var allBooks=S.textbooks||[];
    var state=filtersState();
    var subjects=Array.from(new Set(allBooks.map(subjectLabel).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,"ru")});
    var subjectOptions=[{value:"all",label:"Все предметы"}].concat(subjects.map(function(x){return {value:x,label:x}}));
    var gradeOptions=[{value:"all",label:"Все классы"}].concat(Array.from({length:11},function(_,i){return {value:String(i+1),label:(i+1)+" класс"}}));
    var sortOptions=[{value:"default",label:"По умолчанию"},{value:"title",label:"По названию"},{value:"topics",label:"По числу тем"}];

    root.classList.add("mr-lib2-root");
    personalTitle.classList.add("mr-lib2-personal-title");
    personalGrid.classList.add("mr-lib2-personal-grid");
    var personal=document.createElement("section");
    personal.className="mr-lib2-personal";
    personalTitle.parentNode.insertBefore(personal,personalTitle);
    personal.appendChild(personalTitle);
    personal.appendChild(personalGrid);

    var head=document.createElement("div");
    head.className="mr-lib2-head";
    head.innerHTML='<div class="mr-lib2-heading"><span class="mr-lib2-eyebrow">MATHROOM · МАТЕРИАЛЫ</span><h1>Библиотека учебников</h1><p>Используйте учебники из общей базы или добавляйте свои. Все привязанные темы и страницы сохраняются.</p></div>'+
      '<div class="mr-lib2-head-actions"><label class="mr-lib2-search"><span>⌕</span><input id="mrLib2Search" value="'+esc2(S.libraryV2Query||"")+'" placeholder="Поиск по названию, автору, классам…"></label><button class="btn primary" id="mrLib2Upload">＋ Добавить учебник</button></div>';
    root.insertBefore(head,root.firstChild);

    var tabs=document.createElement("div");
    tabs.className="mr-lib2-tabs";
    tabs.innerHTML='<button data-lib2-tab="mine">Моя библиотека <span>'+countFor("mine")+'</span></button>'+
      '<button data-lib2-tab="shared">Общая библиотека <span>'+countFor("shared")+'</span></button>'+
      '<button data-lib2-tab="review">Нуждаются в уточнении <span>'+countFor("review")+'</span></button>';
    head.after(tabs);

    var filters=document.createElement("div");
    filters.className="mr-lib2-filters";
    filters.innerHTML=dropdownMarkup("subject","Предмет",subjectOptions,state.subject,subjectIcon(state.subject))+
      dropdownMarkup("grade","Класс",gradeOptions,state.grade,filterIcon("grade"))+
      dropdownMarkup("sort","Сортировка",sortOptions,state.sort,filterIcon("sort"))+
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
      card.insertAdjacentHTML("afterbegin",coverHtml(book,"card"));
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

    function visibleCards(){
      var scope=currentTab()==="shared"?shared:personal;
      return Array.from(scope.querySelectorAll(".mr-lib2-card")).filter(function(c){return !c.hidden});
    }
    function updateCounter(){
      var counter=filters.querySelector(".mr-lib2-counter");
      if(counter)counter.innerHTML='<b>'+visibleCards().length+'</b><span> учебников</span>';
    }
    function applyFilters(){
      var tab=currentTab();
      var scope=tab==="shared"?shared:personal;
      var query=norm(S.libraryV2Query||"");
      scope.querySelectorAll(".mr-lib2-card").forEach(function(card){
        var id=card.getAttribute("data-lib2-book"),book=allBooks.find(function(x){return String(x.id)===String(id)});
        var show=!!book;
        if(tab==="review")show=show&&mine(book)&&!(detect(book)&&detect(book).recognized);
        if(query){
          var hay=norm([book&&book.title,book&&book.author,book&&book.subject,book&&book.grade_from,book&&book.grade_to].filter(Boolean).join(" "));
          show=show&&hay.indexOf(query)>=0;
        }
        if(state.subject!=="all")show=show&&subjectLabel(book)===state.subject;
        if(state.grade!=="all"){
          var g=Number(state.grade),a=Number(book&&book.grade_from)||0,b=Number(book&&book.grade_to)||a;
          show=show&&a&&g>=a&&g<=b;
        }
        card.hidden=!show;
      });
      updateCounter();
      hydrateCovers(scope);
    }
    function sortCards(){
      var scope=currentTab()==="shared"?shared.querySelector(".grid"):personalGrid;
      if(!scope)return;
      var cards=Array.from(scope.querySelectorAll(".mr-lib2-card"));
      cards.sort(function(a,b){
        var ba=allBooks.find(function(x){return String(x.id)===String(a.getAttribute("data-lib2-book"))});
        var bb=allBooks.find(function(x){return String(x.id)===String(b.getAttribute("data-lib2-book"))});
        if(state.sort==="title")return String(ba&&ba.title||"").localeCompare(String(bb&&bb.title||""),"ru");
        if(state.sort==="topics")return linksFor(bb).length-linksFor(ba).length;
        return 0;
      });
      cards.forEach(function(c){scope.appendChild(c)});
    }
    function setTab(tab){
      S.libraryV2Tab=tab;
      tabs.querySelectorAll("[data-lib2-tab]").forEach(function(b){b.classList.toggle("active",b.getAttribute("data-lib2-tab")===tab)});
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
      sortCards();applyFilters();
    }

    function closeSelects(except){
      filters.querySelectorAll(".mr-lib2-select.open").forEach(function(x){if(x!==except)x.classList.remove("open")});
    }
    filters.querySelectorAll(".mr-lib2-select").forEach(function(box){
      var key=box.dataset.lib2Select;
      var trigger=box.querySelector(".mr-lib2-select-trigger");
      trigger.onclick=function(e){
        e.stopPropagation();
        var willOpen=!box.classList.contains("open");
        closeSelects(box);box.classList.toggle("open",willOpen);
      };
      box.querySelectorAll(".mr-lib2-select-menu button").forEach(function(opt){
        opt.onclick=function(e){
          e.stopPropagation();
          state[key]=opt.dataset.value;
          box.querySelectorAll(".mr-lib2-select-menu button").forEach(function(x){x.classList.toggle("active",x===opt)});
          box.querySelector("[data-lib2-select-text]").textContent=opt.querySelector("b").textContent;
          box.classList.remove("open");
          if(key==="sort")sortCards();
          applyFilters();
        };
      });
    });
    document.addEventListener("click",function(){closeSelects()}, {once:false});

    tabs.querySelectorAll("[data-lib2-tab]").forEach(function(btn){btn.onclick=function(){setTab(btn.dataset.lib2Tab)}});
    var search=head.querySelector("#mrLib2Search");
    search.oninput=function(){S.libraryV2Query=search.value;applyFilters()};
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
    hydrateCovers(root);
  }

  window.MathroomLibraryV2={enhance:enhance,hydrateCovers:hydrateCovers};
  var run=function(){try{enhance()}catch(e){console.error("[Mathroom library v2]",e)}};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});
  else setTimeout(run,0);
})();