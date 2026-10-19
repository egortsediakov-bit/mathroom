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

    function upgradeUploadForm(){
      var form=upload.querySelector("#textbookForm");
      if(!form||form.dataset.lib2Ready==="1")return;
      form.dataset.lib2Ready="1";
      upload.classList.add("mr-lib2-upload-pro");

      var titleEl=upload.querySelector(":scope > h2");
      if(titleEl){
        var intro=document.createElement("div");
        intro.className="mr-lib2-upload-intro";
        intro.innerHTML='<span class="mr-lib2-upload-kicker">НОВЫЙ МАТЕРИАЛ</span><p>Добавьте PDF — Mathroom распознает учебник, класс и попробует сразу связать его с темами.</p>';
        titleEl.after(intro);
      }

      var grids=Array.from(form.querySelectorAll(":scope > .grid.cols3"));
      if(grids[0])grids[0].classList.add("mr-lib2-upload-grid","primary");
      if(grids[1])grids[1].classList.add("mr-lib2-upload-grid","secondary");

      function uploadIcon(kind){
        if(kind==="subject")return '<svg viewBox="0 0 24 24"><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Zm16 0c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>';
        return '<svg viewBox="0 0 24 24"><path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M7 13v4c3 2 7 2 10 0v-4"/></svg>';
      }
      function upgradeNativeSelect(id,kind){
        var select=upload.querySelector("#"+id);
        if(!select||select.dataset.lib2Custom==="1")return;
        select.dataset.lib2Custom="1";
        select.classList.add("mr-lib2-native-select");
        var wrap=document.createElement("div");
        wrap.className="mr-lib2-upload-select";
        wrap.innerHTML='<button type="button" class="mr-lib2-upload-select-trigger"><span class="mr-lib2-upload-select-icon">'+uploadIcon(kind)+'</span><b></b><span class="mr-lib2-upload-chevron">⌄</span></button><div class="mr-lib2-upload-select-menu"></div>';
        select.after(wrap);
        var trigger=wrap.querySelector(".mr-lib2-upload-select-trigger");
        var textEl=trigger.querySelector("b");
        var menu=wrap.querySelector(".mr-lib2-upload-select-menu");

        function sync(){
          var opt=select.options[select.selectedIndex];
          textEl.textContent=opt?opt.textContent:"—";
          menu.querySelectorAll("button[data-value]").forEach(function(btn){
            btn.classList.toggle("active",String(btn.dataset.value)===String(select.value));
          });
        }
        Array.from(select.options).forEach(function(opt){
          var btn=document.createElement("button");
          btn.type="button";
          btn.dataset.value=opt.value;
          btn.innerHTML='<span class="mr-lib2-upload-option-icon">'+uploadIcon(kind)+'</span><b>'+esc2(opt.textContent)+'</b><i>✓</i>';
          btn.onclick=function(e){
            e.stopPropagation();
            select.value=opt.value;
            select.dispatchEvent(new Event("change",{bubbles:true}));
            wrap.classList.remove("open");
            sync();
          };
          menu.appendChild(btn);
        });
        trigger.onclick=function(e){
          e.stopPropagation();
          upload.querySelectorAll(".mr-lib2-upload-select.open").forEach(function(x){if(x!==wrap)x.classList.remove("open")});
          wrap.classList.toggle("open");
        };
        select.addEventListener("change",sync);
        sync();
      }
      upgradeNativeSelect("tbSubject","subject");
      upgradeNativeSelect("tbFrom","grade");
      upgradeNativeSelect("tbTo","grade");

      function extraIcon(kind,value){
        if(kind==="level"){
          if(value==="advanced")return '<svg viewBox="0 0 24 24"><path d="M12 3 19 7v8l-7 4-7-4V7l7-4Z"/><path d="m8.5 13 3.5-4 3.5 4"/><path d="m9.5 15 2.5-2.8 2.5 2.8"/></svg>';
          if(value==="profile")return '<svg viewBox="0 0 24 24"><path d="M12 3 19 7v8l-7 4-7-4V7l7-4Z"/><path d="m12 7 1.2 2.4 2.8.4-2 1.9.5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-1.9 2.8-.4L12 7Z"/></svg>';
          if(value==="mixed")return '<svg viewBox="0 0 24 24"><path d="m12 4 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/></svg>';
          return '<svg viewBox="0 0 24 24"><path d="M12 3 19 7v8l-7 4-7-4V7l7-4Z"/><path d="m8.5 12 2.3 2.3 4.8-5.1"/></svg>';
        }
        return '<svg viewBox="0 0 24 24"><path d="M4 6h16v14H4z"/><path d="M8 6V4h8v2M8 11h8M8 15h5"/></svg>';
      }
      function upgradeExtraSelect(select,kind){
        if(!select||select.dataset.lib2ExtraCustom==="1")return;
        select.dataset.lib2ExtraCustom="1";
        select.classList.add("mr-lib2-native-select","mr-lib2-extra-native");
        var box=document.createElement("div");
        box.className="mr-lib2-upload-select mr-lib2-extra-select";
        box.innerHTML='<button type="button" class="mr-lib2-upload-select-trigger"><span class="mr-lib2-upload-select-icon">'+extraIcon(kind,select.value)+'</span><b></b><span class="mr-lib2-upload-chevron">⌄</span></button><div class="mr-lib2-upload-select-menu"></div>';
        select.after(box);
        var trigger=box.querySelector(".mr-lib2-upload-select-trigger");
        var textEl=trigger.querySelector("b");
        var triggerIcon=trigger.querySelector(".mr-lib2-upload-select-icon");
        var menu=box.querySelector(".mr-lib2-upload-select-menu");
        function sync(){
          var opt=select.options[select.selectedIndex];
          textEl.textContent=opt?opt.textContent:"—";
          if(triggerIcon)triggerIcon.innerHTML=extraIcon(kind,select.value);
          menu.querySelectorAll("button[data-value]").forEach(function(btn){
            btn.classList.toggle("active",String(btn.dataset.value)===String(select.value));
          });
        }
        Array.from(select.options).forEach(function(opt){
          var btn=document.createElement("button");
          btn.type="button";btn.dataset.value=opt.value;
          btn.innerHTML='<span class="mr-lib2-upload-option-icon">'+extraIcon(kind,opt.value)+'</span><b>'+esc2(opt.textContent)+'</b><i>✓</i>';
          btn.onclick=function(e){
            e.stopPropagation();
            select.value=opt.value;
            select.dispatchEvent(new Event("input",{bubbles:true}));
            select.dispatchEvent(new Event("change",{bubbles:true}));
            box.classList.remove("open");sync();
          };
          menu.appendChild(btn);
        });
        trigger.onclick=function(e){
          e.stopPropagation();
          upload.querySelectorAll(".mr-lib2-upload-select.open").forEach(function(x){if(x!==box)x.classList.remove("open")});
          box.classList.toggle("open");
        };
        select.addEventListener("change",sync);
        sync();
      }
      function upgradeMetaExtras(){
        var extras=upload.querySelector("[data-m2968-extra]");
        if(!extras)return false;
        extras.classList.add("mr-lib2-meta-extra");
        var level=extras.querySelector('[data-m2968="level"]');
        var kind=extras.querySelector('[data-m2968="kind"]');
        upgradeExtraSelect(level,"level");
        upgradeExtraSelect(kind,"kind");
        ["year","part","publisher"].forEach(function(name){
          var input=extras.querySelector('[data-m2968="'+name+'"]');
          if(input)input.classList.add("mr-lib2-meta-input");
        });
        return true;
      }
      upgradeMetaExtras();
      var extrasObserver=new MutationObserver(function(){upgradeMetaExtras()});
      extrasObserver.observe(form,{childList:true,subtree:true});

      var file=upload.querySelector("#tbFile");
      if(file&&!file.dataset.lib2Custom){
        file.dataset.lib2Custom="1";
        file.classList.add("mr-lib2-native-file");
        var drop=document.createElement("label");
        drop.className="mr-lib2-file-drop";
        drop.setAttribute("for","tbFile");
        drop.innerHTML='<span class="mr-lib2-file-icon"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5"/></svg></span><span class="mr-lib2-file-copy"><b data-file-title>Выберите PDF</b><small data-file-note>Нажмите или перетащите файл сюда · до 50 МБ</small></span><span class="mr-lib2-file-action">Выбрать файл</span>';
        file.after(drop);
        var updateFile=function(){
          var f=file.files&&file.files[0];
          var title=drop.querySelector("[data-file-title]"),note=drop.querySelector("[data-file-note]");
          drop.classList.toggle("has-file",!!f);
          if(f){
            title.textContent=f.name;
            var tooLarge=f.size>50*1024*1024;
            drop.classList.toggle("oversize",tooLarge);
            note.textContent=tooLarge?"Файл больше 50 МБ · сожми PDF перед загрузкой":fmtBytes(f.size)+" · PDF готов к загрузке";
          }else{
            drop.classList.remove("oversize");
            title.textContent="Выберите PDF";
            note.textContent="Нажмите или перетащите файл сюда · до 50 МБ";
          }
        };
        file.addEventListener("change",updateFile);
        ["dragenter","dragover"].forEach(function(name){drop.addEventListener(name,function(e){e.preventDefault();drop.classList.add("drag")})});
        ["dragleave","drop"].forEach(function(name){drop.addEventListener(name,function(e){e.preventDefault();drop.classList.remove("drag")})});
        drop.addEventListener("drop",function(e){
          var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
          if(!f)return;
          var dt=new DataTransfer();dt.items.add(f);file.files=dt.files;
          file.dispatchEvent(new Event("change",{bubbles:true}));
        });
      }

      var helper=form.querySelector(":scope > .small.muted");
      if(helper){
        helper.classList.add("mr-lib2-upload-helper");
        helper.innerHTML='<span><b>PDF</b> хранится в закрытом Storage</span><span><b>50 МБ</b> максимальный размер</span><span><b>OCR</b> отключён</span><span><b>Автосвязь</b> тем после загрузки</span>';
      }

      var submit=upload.querySelector("#tbUploadSubmit");
      if(submit){
        submit.innerHTML='<span class="mr-lib2-submit-icon">↑</span><span>Загрузить PDF</span>';
        submit.classList.add("mr-lib2-upload-submit");
      }

      document.addEventListener("click",function(){
        upload.querySelectorAll(".mr-lib2-upload-select.open").forEach(function(x){x.classList.remove("open")});
      });
    }

    upgradeUploadForm();

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