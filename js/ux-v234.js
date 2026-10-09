(() => {
  const MR = window.MR;
  if (!MR) return;
  const { S, modal, esc } = MR;
  const VERSION = '27.1';
  const helpSeenKey = () => `mathroom.help.seen.${S.access ? 'student' : 'teacher'}`;
  const key = (name) => `mathroom.ux.${VERSION}.${name}.${S.access ? 'student' : 'teacher'}`;

  function safeStoreGet(k){ try { return localStorage.getItem(k); } catch { return null; } }
  function safeStoreSet(k,v){ try { localStorage.setItem(k,v); } catch {} }
  function percent(done,total){ return total ? Math.round(done * 100 / total) : 0; }

  function goTeacher(view){ document.querySelector(`[data-nav="${view}"]`)?.click(); }
  function goStudent(tab){
    const ids = { today:'studentTodayTab', board:'studentBoardTab', lessons:'studentLessonsTab', progress:'studentProgressTab' };
    document.getElementById(ids[tab])?.click();
  }

  function openGuide(){
    safeStoreSet(helpSeenKey(),'done');
    document.getElementById('mrHelpButton')?.remove();
    const teacher = !S.access;
    const html = teacher ? `
      <div class="mr-guide-head"><div><span class="pill">Быстрый старт</span><h2>Как работать в Mathroom</h2><p class="muted">Главная идея: расписание → открыть урок → видеосвязь и доска → завершить урок.</p></div></div>
      <div class="mr-guide-grid">
        <article><b>1. Ученики</b><p>Добавь ученика один раз. Его персональная ссылка остаётся постоянной.</p><button class="btn sm" data-guide-go="students">Открыть учеников</button></article>
        <article><b>2. Расписание</b><p>Создай разовый урок или еженедельную серию. Серия продолжается, пока ты её не остановишь.</p><button class="btn sm" data-guide-go="schedule">Открыть расписание</button></article>
        <article><b>3. Начало урока</b><p>Открой урок и нажми «Запустить всё». Камеру можно включить отдельно. Подключение обычно занимает несколько секунд.</p></article>
        <article><b>4. Доска</b><p>Используй несколько листов, вставку Ctrl+V, PDF, шаблоны, черновик преподавателя и экспорт.</p><button class="btn sm" data-guide-go="board">Открыть доску</button></article>
      </div>
      <div class="mr-guide-section"><h3>Если видеосвязь не появилась сразу</h3><div class="mr-guide-steps"><span><i>1</i> Камера включена у обоих</span><span><i>2</i> В статусе есть «сигналинг DB»</span><span><i>3</i> Подожди 5–10 секунд</span><span><i>4</i> Если связи нет — «Переподключить»</span></div></div>
      <div class="mr-guide-section"><h3>Полезные клавиши</h3><div class="mr-shortcuts"><span><kbd>Alt K</kbd> быстрые команды</span><span><kbd>Alt M</kbd> микрофон</span><span><kbd>Alt V</kbd> камера</span><span><kbd>Alt S</kbd> демонстрация экрана</span><span><kbd>F1</kbd> эта справка</span></div></div>` : `
      <div class="mr-guide-head"><div><span class="pill">Быстрый старт</span><h2>Как проходит урок</h2><p class="muted">Ничего настраивать заранее не нужно: когда преподаватель начнёт урок, Mathroom покажет его автоматически.</p></div></div>
      <div class="mr-guide-grid">
        <article><b>1. Дождись урока</b><p>Открытая страница сама увидит начало занятия. Обновлять её не требуется.</p><button class="btn sm" data-guide-student="today">На «Сегодня»</button></article>
        <article><b>2. Включи камеру</b><p>Разреши браузеру камеру и микрофон. После этого Mathroom сам повторяет попытки соединения.</p></article>
        <article><b>3. Работай на доске</b><p>Все изменения доски синхронизируются во время занятия.</p><button class="btn sm" data-guide-student="board">Открыть доску</button></article>
        <article><b>4. Если связь пропала</b><p>Нажми «Переподключить». Страницу обычно перезагружать не нужно.</p></article>
      </div>
      <div class="mr-guide-section"><h3>Важно</h3><p class="muted">Mathroom используется как рабочее пространство урока. Основное общение с преподавателем происходит во время занятия.</p></div>`;
    const m = modal(html, 'wide-modal mr-guide-modal');
    m.querySelectorAll('[data-guide-go]').forEach(b => b.onclick = () => { m.remove(); goTeacher(b.dataset.guideGo); });
    m.querySelectorAll('[data-guide-student]').forEach(b => b.onclick = () => { m.remove(); goStudent(b.dataset.guideStudent); });
  }

  function ensureHelpButton(){
    // Floating "Как пользоваться" button intentionally disabled.
    document.getElementById('mrHelpButton')?.remove();
  }
  function bindSidebarHelp(){
    const b=document.getElementById('sidebarHelp');
    if(!b||b.dataset.guideBound==='1')return;
    b.dataset.guideBound='1';b.onclick=openGuide;
  }

  function teacherWelcome(){
    if (S.access || S.view !== 'dashboard' || safeStoreGet(key('welcome')) === 'done') return;
    const content = document.querySelector('.content'); if (!content || document.getElementById('mrFirstMinutes')) return;
    const hasStudents = (S.students || []).length > 0;
    const hasLessons = (S.lessons || []).length > 0;
    const hasActive = (S.lessons || []).some(x => x.status === 'in_progress');
    const checks = [hasStudents, hasLessons, hasActive]; const done = checks.filter(Boolean).length;
    const card = document.createElement('section'); card.id='mrFirstMinutes'; card.className='card mr-first-minutes';
    card.innerHTML = `<div class="mr-card-head"><div><span class="pill">Первые минуты</span><h2>Быстрый старт</h2><p class="small muted">Три шага, чтобы провести первый урок без поиска функций по сайту.</p></div><button class="btn sm ghost" id="mrHideFirstMinutes">Скрыть</button></div>
      <div class="mr-first-progress"><i style="width:${percent(done,3)}%"></i></div>
      <div class="mr-first-grid">
        <button class="mr-first-step ${hasStudents?'done':''}" data-first-go="students"><span>${hasStudents?'✓':'1'}</span><div><b>Добавь ученика</b><small>${hasStudents?'Готово':'Создай ученика и получи его ссылку'}</small></div></button>
        <button class="mr-first-step ${hasLessons?'done':''}" data-first-go="schedule"><span>${hasLessons?'✓':'2'}</span><div><b>Поставь урок</b><small>${hasLessons?'В расписании есть занятия':'Разовый или каждую неделю'}</small></div></button>
        <button class="mr-first-step ${hasActive?'done':''}" data-first-go="schedule"><span>${hasActive?'✓':'3'}</span><div><b>Открой урок</b><small>${hasActive?'Урок сейчас идёт':'Видео, доска и таймер находятся внутри урока'}</small></div></button>
      </div><div class="actions"><button class="btn sm" id="mrOpenFullGuide">Показать инструкцию</button></div>`;
    const top = content.querySelector('.topbar'); top ? top.insertAdjacentElement('afterend',card) : content.prepend(card);
    card.querySelector('#mrHideFirstMinutes').onclick = () => { safeStoreSet(key('welcome'),'done'); card.remove(); };
    card.querySelector('#mrOpenFullGuide').onclick = openGuide;
    card.querySelectorAll('[data-first-go]').forEach(b => b.onclick = () => goTeacher(b.dataset.firstGo));
  }

  function studentWelcome(){
    if (!S.access || S.studentTab !== 'today' || safeStoreGet(key('welcome')) === 'done') return;
    const root = document.querySelector('#studentContent') || document.querySelector('.student-home');
    if (!root || document.getElementById('mrStudentFirstMinutes')) return;
    const desktop=!!document.querySelector('.mr-student-desktop-shell');
    const card = document.createElement('section'); card.id='mrStudentFirstMinutes'; card.className=desktop?'card mr-first-minutes mr-student-first-minutes mr-desk-onboarding':'card mr-first-minutes mr-student-first-minutes';
    if(desktop){
      card.innerHTML = '<div class="mr-desk-onboarding-row"><div><span class="mr-desk-soft-badge">Первый раз в Mathroom?</span><h2>Здесь всё просто</h2><p>Три вещи, которые стоит знать перед первым занятием.</p></div><div class="mr-first-grid"><div class="mr-first-step static"><span>1</span><div><b>Дождись старта</b><small>Урок появится сам</small></div></div><div class="mr-first-step static"><span>2</span><div><b>Включи камеру</b><small>Разреши доступ браузеру</small></div></div><div class="mr-first-step static"><span>3</span><div><b>Работай на доске</b><small>Всё внутри занятия</small></div></div></div><button class="btn sm ghost" id="mrHideStudentFirst" aria-label="Скрыть подсказку">×</button></div>';
      root.append(card);
    }else{
      card.innerHTML = '<div class="mr-card-head"><div><span class="pill">Первый вход</span><h2>Здесь всё просто</h2><p class="small muted">Когда преподаватель начнёт занятие, урок появится сам — страницу обновлять не нужно.</p></div><button class="btn sm ghost" id="mrHideStudentFirst">Понятно</button></div><div class="mr-first-grid"><div class="mr-first-step static"><span>1</span><div><b>Дождись старта</b><small>Mathroom сам обнаружит активный урок</small></div></div><div class="mr-first-step static"><span>2</span><div><b>Включи камеру</b><small>Разреши камеру и микрофон браузеру</small></div></div><div class="mr-first-step static"><span>3</span><div><b>Работай на доске</b><small>Всё нужное находится внутри занятия</small></div></div></div>';
      root.prepend(card);
    }
    card.querySelector('#mrHideStudentFirst').onclick=()=>{safeStoreSet(key('welcome'),'done');card.remove()};
  }

  
function ensureVideoCoach(){
    const panel = document.getElementById('mrVideoPanel'); if (!panel) return;
    let c = panel.querySelector('#mrVideoCoach');
    if (!c && safeStoreGet(key('videoCoach')) !== 'done') {
      c=document.createElement('div');c.id='mrVideoCoach';c.className='mr-video-coach';
      c.innerHTML=`<span class="mr-video-coach-icon">i</span><div><b id="mrVideoCoachTitle">Как подключиться</b><small id="mrVideoCoachText">Включи камеру на обоих устройствах. Mathroom сам повторяет signaling и ICE.</small></div><button class="btn sm ghost" id="mrVideoCoachHide">Скрыть</button>`;
      panel.querySelector('.mr-video-head')?.insertAdjacentElement('afterend',c);
      c.querySelector('#mrVideoCoachHide').onclick=()=>{safeStoreSet(key('videoCoach'),'done');c.remove()};
    }
    if (!c) return;
    const status = panel.querySelector('#mrVideoStatus')?.textContent || '';
    const title=c.querySelector('#mrVideoCoachTitle'), text=c.querySelector('#mrVideoCoachText');
    c.classList.remove('ok','warn');
    if (/Соединено/i.test(status)){c.classList.add('ok');title.textContent='Связь установлена';text.textContent='Видео и звук подключены. Перезагрузка страницы не нужна.'}
    else if (/Ошибка|не установлено|недоступен/i.test(status)){c.classList.add('warn');title.textContent='Связь ещё не установлена';text.textContent='Нажми «Переподключить». Если статус сигналинга DB виден, Mathroom продолжит попытки автоматически.'}
    else if (/Ожидаем|Подключение|Проверяем|Отправляем|Повторяем/i.test(status)){title.textContent='Соединяем участников';text.textContent='Обычно это занимает 2–10 секунд. Не обновляй страницу — повторные попытки выполняются автоматически.'}
    else {title.textContent='Как подключиться';text.textContent='Включи камеру на обоих устройствах. После этого дождись статуса «Соединено».'}
  }

  function improveAccessibility(){
    const labels = {
      mrVideoStart:'Включить или переподключить видеосвязь', mrVideoMic:'Включить или выключить микрофон', mrVideoCam:'Включить или выключить камеру',
      mrVideoSound:'Разрешить воспроизведение звука', mrVideoPiP:'Открыть видео в Picture-in-Picture', mrVideoScreen:'Показать экран', mrVideoEnd:'Завершить видеосвязь'
    };
    for (const [id,label] of Object.entries(labels)){const el=document.getElementById(id);if(el&&!el.title){el.title=label;el.setAttribute('aria-label',label)}}
  }

  function sync(){
    ensureHelpButton(); bindSidebarHelp(); teacherWelcome(); studentWelcome(); ensureVideoCoach(); improveAccessibility();
  }

  // Unified tactile feedback for every real button. This is visual only and never
  // prevents the native click, so existing onclick/addEventListener handlers keep working.
  const pressSelector='button:not(:disabled),.btn:not(:disabled),.tabs button:not(:disabled),.nav button:not(:disabled),[role="button"]:not([aria-disabled="true"])';
  let pressedControl=null;
  const releasePress=()=>{if(pressedControl){pressedControl.classList.remove('is-pressed');pressedControl=null}};
  document.addEventListener('pointerdown',e=>{
    const el=e.target?.closest?.(pressSelector);
    if(!el)return;
    releasePress();pressedControl=el;el.classList.add('is-pressed');
  },true);
  document.addEventListener('pointerup',releasePress,true);
  document.addEventListener('pointercancel',releasePress,true);
  window.addEventListener('blur',releasePress);

  window.addEventListener('keydown', e => {
    if (e.key === 'F1') { e.preventDefault(); openGuide(); }
  });
  document.addEventListener('mathroom:refresh-lesson', () => setTimeout(sync, 0));
  setInterval(sync, 900);
  setTimeout(sync, 60);
})();
