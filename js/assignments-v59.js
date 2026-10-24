(function(){
  function renderAssignmentsV59(){
    const homeworks=(S.homeworks||[]).map(x=>Object.assign({},x,{kind:'homework'}));
    const tests=(S.tests||[]).map(x=>Object.assign({},x,{kind:'test'}));
    const all=[].concat(homeworks,tests).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
    const now=Date.now();

    const submitted=homeworks.filter(x=>x.status==='submitted');
    const revision=homeworks.filter(x=>x.status==='assigned'&&x.revision_requested_at);
    const overdue=homeworks.filter(x=>x.status==='assigned'&&!x.revision_requested_at&&x.due_at&&new Date(x.due_at).getTime()<now);
    const reviewed=homeworks.filter(x=>x.status==='reviewed');

    function assignmentIcon(kind){
      const common='class="mr-assignment-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
      if(kind==='refresh')return '<svg '+common+'><path d="M19 8a7 7 0 0 0-12-2L4 9"/><path class="accent" d="M4 4v5h5"/><path d="M5 16a7 7 0 0 0 12 2l3-3"/><path class="accent" d="M20 20v-5h-5"/></svg>';
      if(kind==='clock')return '<svg '+common+'><circle cx="12" cy="12" r="8"/><path class="accent" d="M12 7v5l3 2"/></svg>';
      if(kind==='check')return '<svg '+common+'><path class="accent" d="m5 12 4 4L19 6"/></svg>';
      if(kind==='stack')return '<svg '+common+'><path d="m12 4 7 4-7 4-7-4 7-4Z"/><path d="m5 12 7 4 7-4"/><path class="accent" d="m5 16 7 4 7-4"/></svg>';
      if(kind==='pencil')return '<svg '+common+'><path d="M5 19l3.8-.9L18 8.9 15.1 6 5.9 15.2 5 19Z"/><path class="accent" d="m13.7 7.4 2.9 2.9"/></svg>';
      if(kind==='open')return '<svg '+common+'><path d="M9 5H5v14h14v-4"/><path class="accent" d="M12 12 20 4M14 4h6v6"/></svg>';
      return '<svg '+common+'><path d="M6 3.8h9l3 3V20H6z"/><path class="accent" d="M15 3.8V7h3M9 11h6M9 15h5"/></svg>';
    }

    const routeIcon='<svg class="mr-assignment-route-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h9l3 3V20H6z"/><path class="accent" d="M15 3.8V7h3M9 11h6M9 15h5"/></svg>';

    function metric(kind,label,value,klass){
      return '<div class="mr-assignment-metric '+(klass||'')+'"><span class="mr-assignment-metric-icon">'+assignmentIcon(kind)+'</span><div><small>'+label+'</small><b>'+value+'</b></div></div>';
    }

    const metricsHtml=[
      metric('sheet','На проверке',submitted.length,'review'),
      metric('refresh','На доработке',revision.length,'revision'),
      metric('clock','Просрочено',overdue.length,'overdue'),
      metric('check','Проверено',reviewed.length,'reviewed')
    ].join('');

    function cardState(x){
      const isRevision=x.kind==='homework'&&x.status==='assigned'&&x.revision_requested_at;
      const isOverdue=x.kind==='homework'&&x.status==='assigned'&&!isRevision&&x.due_at&&new Date(x.due_at).getTime()<now;
      if(x.status==='submitted')return {key:'submitted',label:'На проверке',className:'review'};
      if(isRevision)return {key:'revision',label:'На доработке',className:'revision'};
      if(isOverdue)return {key:'overdue',label:'Просрочено',className:'overdue'};
      if(x.status==='reviewed')return {key:'reviewed',label:'Проверено',className:'reviewed'};
      return {key:x.status||'assigned',label:statusLabel(x.status),className:'assigned'};
    }

    function dueMeta(x){
      if(x.kind!=='homework'||!x.due_at)return '';
      const due=new Date(x.due_at);
      const state=cardState(x);
      if(state.key==='overdue'){
        const days=Math.max(1,Math.ceil((now-due.getTime())/86400000));
        return 'просрочено на '+days+' '+(days===1?'день':'дн.');
      }
      return 'до '+due.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}).replace('.','');
    }

    function studentGrade(x){
      const direct=x.students&&x.students.grade;
      if(direct)return direct+' класс';
      const st=(S.students||[]).find(s=>String(s.id)===String(x.student_id));
      return st&&st.grade?st.grade+' класс':'';
    }

    function workTitle(x){
      const title=String(x.title||'').trim();
      if(title)return title.replace(/^(Домашняя работа|Мини-тест)\s*·\s*/i,'');
      return x.kind==='homework'?'Домашняя работа':'Тест';
    }

    const hero='<section class="mr-assignment-route-card">'+
      '<div class="mr-assignment-route-main">'+
        '<span class="mr-assignment-route-icon">'+routeIcon+'</span>'+
        '<div><h2>Поток проверки</h2><p>Здесь собраны домашние задания учеников: новые ответы, доработка, просроченные и уже проверенные работы.</p></div>'+
      '</div>'+
      '<div class="mr-assignment-route-metrics">'+metricsHtml+'</div>'+
    '</section>';

    const allWord=all.length===1?'работа':(all.length>=2&&all.length<=4?'работы':'работ');
    const trackHead='<div class="mr-assignment-track-head">'+
      '<div><span class="mr-assignment-track-kicker">ЗАДАНИЯ</span><h2>Все работы</h2></div>'+
      '<span class="mr-assignment-count">'+assignmentIcon('stack')+'<b>'+all.length+' '+allWord+'</b></span>'+
    '</div>';

    const dashboardMetrics='<section class="mr-assignment-metrics">'+metricsHtml+'</section>';

    const filters='<div class="mr-assignment-filterbar">'+
      '<button class="mr-assignment-filter active" data-af="all">Все</button>'+
      '<button class="mr-assignment-filter" data-af="submitted">На проверке</button>'+
      '<button class="mr-assignment-filter" data-af="revision">Доработка</button>'+
      '<button class="mr-assignment-filter" data-af="overdue">Просрочено</button>'+
      '<button class="mr-assignment-filter" data-af="reviewed">Проверено</button>'+
    '</div>';

    app.innerHTML=shell('<div class="mr-assignments-page">'+hero+'<section class="mr-assignment-track">'+trackHead+dashboardMetrics+filters+'<div id="assignmentList"></div></section></div>','Задания','Ответы учеников, попытки и цикл доработки');
    bindShell();

    function draw(filter){
      filter=filter||'all';
      let arr=all;
      if(filter==='submitted')arr=submitted;
      if(filter==='revision')arr=revision;
      if(filter==='overdue')arr=overdue;
      if(filter==='reviewed')arr=reviewed;
      const list=document.getElementById('assignmentList');
      if(!list)return;

      if(!arr.length){
        list.innerHTML='<div class="mr-assignment-empty"><span>'+assignmentIcon('sheet')+'</span><div><h3>В этом разделе заданий нет</h3><p>Как только появятся работы учеников, они будут собраны здесь.</p></div></div>';
        return;
      }

      const rows=arr.map((x,i)=>{
        const state=cardState(x);
        const grade=studentGrade(x);
        const due=dueMeta(x);
        const topic=(x.topics&&x.topics.title)||'';
        const type=x.kind==='homework'?'Домашняя':'Тест';
        const title=workTitle(x);
        const name=(x.students&&x.students.name)||'Ученик';
        const index=String(i+1).padStart(2,'0');
        const meta=[grade,topic,due].filter(Boolean);
        const score=x.score!=null?'<span class="mr-assignment-score">'+esc(x.score)+'%</span>':'';
        const attempts=x.kind==='homework'&&x.attempt_count?'<span class="mr-assignment-attempts">'+esc(x.attempt_count)+' попыт.</span>':'';
        const metaHtml=meta.map((m,idx)=>'<span class="'+(idx===meta.length-1&&state.key==='overdue'?'danger':'')+'">'+esc(m)+'</span>').join('');
        const key=x.kind+':'+x.id;
        return '<article class="mr-assignment-card '+state.className+'">'+
          '<div class="mr-assignment-card-seq">'+index+'</div>'+
          '<div class="mr-assignment-card-icon">'+assignmentIcon('sheet')+'</div>'+
          '<div class="mr-assignment-card-main">'+
            '<span class="mr-assignment-student">'+esc(name)+'</span>'+
            '<div class="mr-assignment-titleline"><h3>'+esc(title)+'</h3><span class="mr-assignment-status '+state.className+'"><i></i>'+esc(state.label)+'</span>'+score+attempts+'</div>'+
            '<div class="mr-assignment-card-meta">'+metaHtml+'</div>'+
            '<span class="mr-assignment-type">'+esc(type)+'</span>'+
          '</div>'+
          '<div class="mr-assignment-card-actions">'+
            '<button class="mr-assignment-check" data-assignment="'+key+'">'+assignmentIcon('pencil')+'<span>'+(x.status==='submitted'?'Проверить':'Открыть')+'</span></button>'+
            '<button class="mr-assignment-open" data-assignment="'+key+'">'+assignmentIcon('open')+'<span>Открыть</span></button>'+
            '<button class="mr-assignment-arrow" data-assignment="'+key+'" aria-label="Открыть работу">→</button>'+
          '</div>'+
        '</article>';
      }).join('');

      list.innerHTML='<div class="mr-assignment-list">'+rows+'</div>';
      list.querySelectorAll('[data-assignment]').forEach(b=>b.onclick=()=>{
        const parts=b.dataset.assignment.split(':');
        openTeacherAssignment(parts[0],parts[1]);
      });
    }

    document.querySelectorAll('[data-af]').forEach(b=>b.onclick=()=>{
      document.querySelectorAll('[data-af]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      draw(b.dataset.af);
    });

    draw('all');
  }

  window.renderAssignments=renderAssignmentsV59;
})();