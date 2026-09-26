const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const CFG = window.MATHROOM_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(CFG.SUPABASE_URL||'') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR_');
const sb = configured ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
}) : null;

const S={
  user:null, teacher:null, students:[], topics:[], exercises:[], lessons:[],
  view:'dashboard', selectedStudent:'', topic:null, boardCleanup:null, boardController:null,
  access:new URLSearchParams(location.search).get('access')||'', student:null, studentTab:'board'
};

const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const nl=(v='')=>esc(v).replace(/\n/g,'<br>');
const uid=()=>crypto.randomUUID();
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x=>x.toString(16).padStart(2,'0')).join('');
const dateLong=v=>v?new Date(v).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'—';
const diffLabel=v=>({basic:'Базовая',medium:'Средняя',advanced:'Сложная'})[v]||v;
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2400)}
function fail(error){console.error(error);toast(error?.message||String(error||'Ошибка'));}
function copyText(text){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();return Promise.resolve()}
function modal(html){const el=document.createElement('div');el.className='modal-backdrop';el.innerHTML=`<div class="modal">${html}<div class="actions" style="margin-top:16px"><button class="btn" data-close>Закрыть</button></div></div>`;document.body.appendChild(el);el.onclick=e=>{if(e.target===el||e.target.closest('[data-close]'))el.remove()};return el}
function configScreen(){app.innerHTML=`<div class="center-page"><div class="auth-card config-card"><div class="brand">Mathroom Web v3.0</div><h1>Подключи Supabase</h1><p>Сайт уже готов для GitHub Pages, но сначала нужно указать адрес проекта и публичный ключ Supabase.</p><div class="config-code">window.MATHROOM_CONFIG = {\n  SUPABASE_URL: 'https://PROJECT.supabase.co',\n  SUPABASE_ANON_KEY: 'YOUR_PUBLISHABLE_KEY',\n  APP_NAME: 'Mathroom'\n};</div><p class="small muted">Открой <b>config.js</b>, вставь два значения из Supabase → Project Settings → API и обнови страницу.</p></div></div>`}

async function q(table, fn='select', ...args){
  let r=sb.from(table)[fn](...args); const {data,error}=await r; if(error)throw error; return data;
}
async function ensureTeacher(){
  const {data:{user}}=await sb.auth.getUser(); if(!user)return null;
  if(user.is_anonymous)return null;
  await sb.from('teachers').upsert({id:user.id},{onConflict:'id'});
  const {data,error}=await sb.from('teachers').select('*').eq('id',user.id).single(); if(error)throw error; return data;
}
async function loadTeacher(){
  const [{data:students,error:e1},{data:topics,error:e2},{data:exercises,error:e3},{data:lessons,error:e4}]=await Promise.all([
    sb.from('students').select('*').order('created_at'),
    sb.from('topics').select('*').order('grade').order('section').order('title'),
    sb.from('exercises').select('*').order('created_at'),
    sb.from('lessons').select('*,students(name,grade),topics(title)').order('scheduled_at',{ascending:true})
  ]);
  if(e1||e2||e3||e4)throw(e1||e2||e3||e4);
  S.students=students||[];S.topics=topics||[];S.exercises=exercises||[];S.lessons=lessons||[];
  if(!S.selectedStudent&&S.students[0])S.selectedStudent=S.students[0].id;
}

async function boot(){
  if(!configured)return configScreen();
  if(S.access)return bootStudent();
  const {data:{session}}=await sb.auth.getSession();
  if(!session||session.user.is_anonymous)return renderAuth();
  S.user=session.user;
  try{S.teacher=await ensureTeacher();await loadTeacher();renderTeacher()}catch(e){fail(e);renderAuth()}
}

function renderAuth(){
  app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Облачный кабинет</h1><p>Вход преподавателя через Supabase Auth.</p><form id="loginForm"><div class="field"><label>Email</label><input id="email" type="email" required></div><div class="field"><label>Пароль</label><input id="password" type="password" minlength="6" required></div><div class="actions"><button class="btn primary">Войти</button><button type="button" class="btn" id="register">Создать аккаунт</button></div></form><div id="authMsg" class="small muted" style="margin-top:12px"></div></div></div>`;
  loginForm.onsubmit=async e=>{e.preventDefault();const {data,error}=await sb.auth.signInWithPassword({email:email.value,password:password.value});if(error)return authMsg.textContent=error.message;S.user=data.user;S.teacher=await ensureTeacher();await loadTeacher();renderTeacher()};
  register.onclick=async()=>{const {data,error}=await sb.auth.signUp({email:email.value,password:password.value});if(error)return authMsg.textContent=error.message;if(!data.session){authMsg.textContent='Аккаунт создан. Подтверди email по письму Supabase, затем войди.';return}S.user=data.user;S.teacher=await ensureTeacher();await loadTeacher();renderTeacher()};
}

const nav=[['dashboard','Главная'],['schedule','Расписание'],['students','Ученики'],['topics','Темы'],['bank','Банк задач'],['board','Доска']];
function shell(content,title,sub=''){
  return `<div class="layout"><aside class="sidebar"><div class="brand">Mathroom <span class="cloud-badge">☁ cloud</span></div><nav class="nav">${nav.map(([id,n])=>`<button data-nav="${id}" class="${S.view===id?'active':''}">${n}</button>`).join('')}</nav><div class="sidebar-footer"><button class="btn ghost sm" id="logout">Выйти</button></div></aside><main class="content"><div class="topbar"><div><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div></div>${content}</main></div>`;
}
function bindShell(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{cleanupBoard();S.view=b.dataset.nav;S.topic=null;renderTeacher()});
  const l=document.getElementById('logout');if(l)l.onclick=async()=>{cleanupBoard();await sb.auth.signOut();S.user=S.teacher=null;renderAuth()};
}
function cleanupBoard(){if(S.boardCleanup){S.boardCleanup();S.boardCleanup=null;S.boardController=null}}
function renderTeacher(){cleanupBoard();if(S.view==='students')return renderStudents();if(S.view==='topics')return S.topic?renderTopic():renderTopics();if(S.view==='bank')return renderBank();if(S.view==='schedule')return renderSchedule();if(S.view==='board')return renderBoardPage();if(S.view==='lesson')return renderLesson();return renderDashboard()}

function renderDashboard(){
  const now=Date.now();const upcoming=S.lessons.filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=now).slice(0,5);
  app.innerHTML=shell(`<div class="grid cols3"><div class="card"><div class="muted">Ученики</div><div class="metric">${S.students.length}</div></div><div class="card"><div class="muted">Темы</div><div class="metric">${S.topics.length}</div></div><div class="card"><div class="muted">Задачи</div><div class="metric">${S.exercises.filter(x=>x.kind==='task').length}</div></div></div><div class="section-title"><h2>Ближайшие уроки</h2></div><div class="list">${upcoming.length?upcoming.map(l=>`<div class="row"><div><h3>${esc(l.students?.name||'Ученик')} · ${esc(l.topics?.title||'Без темы')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин</p></div><button class="btn primary sm" data-start="${l.id}">Начать</button></div>`).join(''):'<div class="empty">Добавь первое занятие в разделе «Расписание».</div>'}</div>`,'Кабинет преподавателя','GitHub Pages + Supabase');bindShell();
  document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>{const l=S.lessons.find(x=>x.id===b.dataset.start);S.selectedStudent=l.student_id;S.topic=S.topics.find(x=>x.id===l.topic_id)||null;S.activeLesson=l;S.view='lesson';renderTeacher()});
}

function studentLink(st){return `${location.origin}${location.pathname}?access=${encodeURIComponent(st.access_token)}`}
function renderStudents(){
  app.innerHTML=shell(`<div class="form-card"><h2>Добавить ученика</h2><form id="studentForm" class="form-grid"><div class="field"><label>Имя</label><input id="stName" required placeholder="Иван"></div><div class="field"><label>Класс</label><select id="stGrade">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><button class="btn primary">Добавить</button></form></div><div class="list">${S.students.length?S.students.map(st=>`<div class="row"><div class="row-main"><h3>${esc(st.name)} · ${st.grade} класс</h3><div class="token-link">${esc(studentLink(st))}</div></div><div class="actions"><button class="btn sm" data-copy="${st.id}">Копировать</button><button class="btn sm" data-board="${st.id}">Доска</button><button class="btn sm" data-rotate="${st.id}">Новая ссылка</button><button class="btn sm danger" data-delete="${st.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Учеников пока нет.</div>'}</div>`,'Ученики','Ты создаёшь аккаунт ученика сам, ученик входит по персональной ссылке');bindShell();
  studentForm.onsubmit=async e=>{e.preventDefault();const body={teacher_id:S.user.id,name:stName.value.trim(),grade:Number(stGrade.value),access_token:token()};const {error}=await sb.from('students').insert(body);if(error)return fail(error);await loadTeacher();renderStudents();toast('Ученик создан')};
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const st=S.students.find(x=>x.id===b.dataset.copy);await copyText(studentLink(st));toast('Ссылка скопирована')});
  document.querySelectorAll('[data-board]').forEach(b=>b.onclick=()=>{S.selectedStudent=b.dataset.board;S.view='board';renderTeacher()});
  document.querySelectorAll('[data-rotate]').forEach(b=>b.onclick=async()=>{if(!confirm('Старая ссылка перестанет работать. Продолжить?'))return;const {data,error}=await sb.rpc('rotate_student_access',{p_student_id:b.dataset.rotate});if(error)return fail(error);await loadTeacher();renderStudents();toast('Новая ссылка создана')});
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить ученика и его доски?'))return;const {error}=await sb.from('students').delete().eq('id',b.dataset.delete);if(error)return fail(error);await loadTeacher();renderStudents()});
}

function renderTopics(){
  app.innerHTML=shell(`<div class="form-card"><h2>Новая тема</h2><form id="topicForm"><div class="grid cols3"><div class="field"><label>Класс</label><select id="tpGrade">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><div class="field"><label>Раздел</label><input id="tpSection" placeholder="Алгебра"></div><div class="field"><label>Тема</label><input id="tpTitle" required placeholder="Квадратные уравнения"></div></div><div class="field"><label>Теория</label><textarea id="tpTheory" rows="5"></textarea></div><button class="btn primary">Создать тему</button></form></div><div class="grid cols2">${S.topics.length?S.topics.map(t=>`<div class="card topic-card" data-topic="${t.id}"><span class="pill">${t.grade} класс</span><h3>${esc(t.title)}</h3><p>${esc(t.section||'Без раздела')}</p></div>`).join(''):'<div class="empty">Тем пока нет.</div>'}</div>`,'Темы','Теория, примеры и банк задач');bindShell();
  topicForm.onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('topics').insert({teacher_id:S.user.id,grade:Number(tpGrade.value),section:tpSection.value.trim(),title:tpTitle.value.trim(),theory:tpTheory.value});if(error)return fail(error);await loadTeacher();renderTopics()};
  document.querySelectorAll('[data-topic]').forEach(x=>x.onclick=()=>{S.topic=S.topics.find(t=>t.id===x.dataset.topic);renderTopic()});
}
function renderTopic(){
  const t=S.topic,items=S.exercises.filter(x=>x.topic_id===t.id);const tasks=items.filter(x=>x.kind==='task'),examples=items.filter(x=>x.kind==='example');
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:14px"><button class="btn" id="backTopics">← Темы</button><button class="btn primary" id="startLesson">Начать урок</button></div><div class="card"><span class="pill">${t.grade} класс · ${esc(t.section)}</span><h2>${esc(t.title)}</h2><div class="prewrap">${nl(t.theory||'Теория пока не добавлена')}</div></div><div class="section-title"><h2>Примеры</h2></div><div class="list">${examples.map(x=>`<div class="row"><div><h3>${esc(x.title||'Пример')}</h3><div class="prewrap">${nl(x.content)}</div></div></div>`).join('')||'<div class="empty">Нет примеров.</div>'}</div><div class="form-card"><h2>Добавить материал</h2><form id="itemForm"><div class="grid cols3"><div class="field"><label>Тип</label><select id="itKind"><option value="task">Задача</option><option value="example">Пример</option></select></div><div class="field"><label>Сложность</label><select id="itDiff"><option value="basic">Базовая</option><option value="medium">Средняя</option><option value="advanced">Сложная</option></select></div><div class="field"><label>Категория</label><input id="itCat"></div></div><div class="field"><label>Название</label><input id="itTitle"></div><div class="field"><label>Условие</label><textarea id="itContent" rows="4" required></textarea></div><div class="grid cols2"><div class="field"><label>Ответ</label><input id="itAnswer"></div><div class="field"><label>Теги через запятую</label><input id="itTags"></div></div><button class="btn primary">Добавить</button></form></div><div class="section-title"><h2>Задачи</h2></div><div class="list">${tasks.length?tasks.map(x=>`<div class="row"><div class="row-main"><div class="actions"><span class="pill">${diffLabel(x.difficulty)}</span>${x.category?`<span class="pill">${esc(x.category)}</span>`:''}</div><h3>${esc(x.title||'Задача')}</h3><div class="prewrap">${nl(x.content)}</div><div class="small muted">${(x.tags||[]).map(t=>'#'+esc(t)).join(' ')}</div></div><button class="btn sm danger" data-del-task="${x.id}">Удалить</button></div>`).join(''):'<div class="empty">Задач пока нет.</div>'}</div>`,'Тема',`${t.grade} класс · ${t.section}`);bindShell();
  backTopics.onclick=()=>{S.topic=null;S.view='topics';renderTeacher()};
  itemForm.onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('exercises').insert({teacher_id:S.user.id,topic_id:t.id,kind:itKind.value,title:itTitle.value.trim(),content:itContent.value,answer:itAnswer.value,difficulty:itDiff.value,category:itCat.value.trim(),tags:itTags.value.split(',').map(x=>x.trim()).filter(Boolean)});if(error)return fail(error);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id);renderTopic()};
  document.querySelectorAll('[data-del-task]').forEach(b=>b.onclick=async()=>{await sb.from('exercises').delete().eq('id',b.dataset.delTask);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id);renderTopic()});
  startLesson.onclick=()=>{if(!S.students.length)return toast('Сначала добавь ученика');S.view='lesson';renderTeacher()};
}

function renderBank(){
  const cats=[...new Set(S.exercises.map(x=>x.category).filter(Boolean))].sort();
  app.innerHTML=shell(`<div class="form-card"><div class="grid cols3"><div class="field"><label>Поиск</label><input id="bankSearch" placeholder="условие, тег, тема..."></div><div class="field"><label>Сложность</label><select id="bankDiff"><option value="">Все</option><option value="basic">Базовые</option><option value="medium">Средние</option><option value="advanced">Сложные</option></select></div><div class="field"><label>Категория</label><select id="bankCat"><option value="">Все</option>${cats.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div></div><div id="bankList"></div>`,'Банк задач','Все задачи из всех тем');bindShell();
  const draw=()=>{const qv=bankSearch.value.toLowerCase(),d=bankDiff.value,c=bankCat.value;const arr=S.exercises.filter(x=>x.kind==='task').filter(x=>(!d||x.difficulty===d)&&(!c||x.category===c)&&(!qv||[x.title,x.content,x.category,...(x.tags||[])].join(' ').toLowerCase().includes(qv)));bankList.innerHTML=`<div class="list">${arr.length?arr.map(x=>{const t=S.topics.find(z=>z.id===x.topic_id);return `<div class="row"><div><div class="actions"><span class="pill">${t?.grade||'?'} кл.</span><span class="pill">${diffLabel(x.difficulty)}</span></div><h3>${esc(x.title||'Задача')}</h3><div class="prewrap">${nl(x.content)}</div><p>${esc(t?.title||'')} ${(x.tags||[]).map(z=>'#'+esc(z)).join(' ')}</p></div></div>`}).join(''):'<div class="empty">Ничего не найдено.</div>'}</div>`};
  [bankSearch,bankDiff,bankCat].forEach(x=>x.oninput=draw);draw();
}

function renderSchedule(){
  const optsStudents=S.students.map(s=>`<option value="${s.id}">${esc(s.name)} · ${s.grade} кл.</option>`).join('');const optsTopics=S.topics.map(t=>`<option value="${t.id}">${t.grade} кл. · ${esc(t.title)}</option>`).join('');
  app.innerHTML=shell(`<div class="form-card"><h2>Добавить урок</h2><form id="lessonForm" class="schedule-form"><div class="field"><label>Ученик</label><select id="lsStudent">${optsStudents}</select></div><div class="field"><label>Тема</label><select id="lsTopic">${optsTopics}</select></div><div class="field"><label>Дата и время</label><input id="lsWhen" type="datetime-local" required></div><div class="field"><label>Минут</label><input id="lsDuration" type="number" value="60" min="15" step="5"></div><button class="btn primary">Добавить</button></form></div><div class="list">${S.lessons.length?S.lessons.map(l=>`<div class="row"><div><h3>${esc(l.students?.name||'')} · ${esc(l.topics?.title||'Без темы')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин · ${esc(l.status)}</p></div><div class="actions"><button class="btn sm primary" data-open-lesson="${l.id}">Открыть</button><button class="btn sm danger" data-del-lesson="${l.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Уроков пока нет.</div>'}</div>`,'Расписание','План занятий хранится в Supabase');bindShell();
  lessonForm.onsubmit=async e=>{e.preventDefault();if(!lsStudent.value||!lsTopic.value)return toast('Добавь ученика и тему');const {error}=await sb.from('lessons').insert({teacher_id:S.user.id,student_id:lsStudent.value,topic_id:lsTopic.value,scheduled_at:new Date(lsWhen.value).toISOString(),duration_minutes:Number(lsDuration.value)});if(error)return fail(error);await loadTeacher();renderSchedule()};
  document.querySelectorAll('[data-open-lesson]').forEach(b=>b.onclick=()=>{const l=S.lessons.find(x=>x.id===b.dataset.openLesson);S.selectedStudent=l.student_id;S.topic=S.topics.find(x=>x.id===l.topic_id)||null;S.activeLesson=l;S.view='lesson';renderTeacher()});
  document.querySelectorAll('[data-del-lesson]').forEach(b=>b.onclick=async()=>{await sb.from('lessons').delete().eq('id',b.dataset.delLesson);await loadTeacher();renderSchedule()});
}

function renderLesson(){
  const st=S.students.find(x=>x.id===S.selectedStudent)||S.students[0],t=S.topic||S.topics[0];if(!st||!t){S.view='dashboard';return renderTeacher()}S.selectedStudent=st.id;S.topic=t;
  const items=S.exercises.filter(x=>x.topic_id===t.id);app.innerHTML=shell(`<div class="actions" style="margin-bottom:12px"><button class="btn" id="leaveLesson">← Кабинет</button><select id="lessonStudent" class="search">${S.students.map(s=>`<option value="${s.id}" ${s.id===st.id?'selected':''}>${esc(s.name)} · ${s.grade} кл.</option>`).join('')}</select></div><div class="lesson-cloud-layout"><div class="lesson-cloud-material"><div class="card"><span class="pill">${t.grade} класс · ${esc(t.section)}</span><h2>${esc(t.title)}</h2><div class="prewrap">${nl(t.theory)}</div><button class="btn sm" id="theoryBoard">Теорию на доску</button></div>${items.map(x=>`<div class="item-box"><div class="actions"><span class="pill">${x.kind==='example'?'Пример':diffLabel(x.difficulty)}</span></div><h4>${esc(x.title|| (x.kind==='example'?'Пример':'Задача'))}</h4><div class="prewrap">${nl(x.content)}</div><button class="btn sm" data-to-board="${x.id}">На доску</button></div>`).join('')}</div><div><div id="lessonBoard"></div></div></div>`,'Урок',`${st.name} · ${t.title}`);bindShell();
  leaveLesson.onclick=()=>{S.view='dashboard';renderTeacher()};lessonStudent.onchange=()=>{S.selectedStudent=lessonStudent.value;renderLesson()};
  mountBoard(document.getElementById('lessonBoard'),st.id,true).then(ctrl=>{S.boardController=ctrl;theoryBoard.onclick=()=>ctrl.addText(`${t.title}\n\n${t.theory}`,{fontSize:24});document.querySelectorAll('[data-to-board]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(z=>z.id===b.dataset.toBoard);ctrl.addText(`${x.title||'Задача'}\n${x.content}`,{fontSize:25});sb.from('exercises').update({use_count:(x.use_count||0)+1,last_used_at:new Date().toISOString()}).eq('id',x.id).then(()=>{})})});
}

function renderBoardPage(){
  if(!S.students.length){app.innerHTML=shell('<div class="empty">Сначала добавь ученика.</div>','Доска');bindShell();return}
  const st=S.students.find(x=>x.id===S.selectedStudent)||S.students[0];S.selectedStudent=st.id;
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:12px"><select id="boardStudent" class="search">${S.students.map(s=>`<option value="${s.id}" ${s.id===st.id?'selected':''}>${esc(s.name)} · ${s.grade} кл.</option>`).join('')}</select></div><div id="boardRoot"></div>`,'Общая доска',`${st.name} · realtime через Supabase`);bindShell();boardStudent.onchange=()=>{S.selectedStudent=boardStudent.value;renderBoardPage()};mountBoard(boardRoot,st.id,true).then(c=>S.boardController=c);
}

async function mountBoard(root,studentId,isTeacher){
  let {data:pages,error}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(error)throw error;
  if(!pages.length&&isTeacher){const {data:p,error:e}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title:'Лист 1',sort_order:0}).select().single();if(e)throw e;pages=[p]}
  let current=pages[0],elements=structuredClone(current?.elements||[]),tool='pen',color='#15171a',width=3,camera={x:0,y:0,zoom:1},drawing=null,selected=null,history=[],future=[],saveTimer=null,channel=null,pagesChannel=null,destroyed=false;
  root.innerHTML=`<div class="board-card"><div class="board-page-tabs" id="pageTabs"></div><div class="board-toolbar"><div class="board-tools"><button class="btn sm active" data-tool="pen">✎ Перо</button><button class="btn sm" data-tool="select">↖ Выбор</button><button class="btn sm" data-tool="hand">✋ Рука</button><button class="btn sm" data-tool="line">╱ Линия</button><button class="btn sm" data-tool="rect">□</button><button class="btn sm" data-tool="ellipse">○</button><button class="btn sm" data-tool="text">T</button><button class="btn sm" id="undo">↶ Назад</button><button class="btn sm" id="redo">↷ Вперёд</button>${isTeacher?'<button class="btn sm" id="addPage">+ Лист</button><button class="btn sm danger" id="delPage">Удалить лист</button>':''}</div><span class="board-status" id="boardStatus">Подключение…</span></div><div class="board-stage" id="stage"><svg id="boardSvg"></svg><div class="board-floating"><button class="btn sm" id="zoomOut">−</button><span class="btn sm" id="zoomLabel">100%</span><button class="btn sm" id="zoomIn">+</button><button class="btn sm" id="homeView">⌂</button></div></div></div>`;
  const svg=root.querySelector('#boardSvg'),stage=root.querySelector('#stage'),status=root.querySelector('#boardStatus');
  const pageTabs=root.querySelector('#pageTabs');
  function snapshot(){history.push(structuredClone(elements));if(history.length>80)history.shift();future=[]}
  function setTool(v){tool=v;root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===v));svg.style.cursor=v==='hand'?'grab':v==='select'?'default':'crosshair'}
  function screenToWorld(clientX,clientY){const r=svg.getBoundingClientRect();return [(clientX-r.left)/camera.zoom+camera.x,(clientY-r.top)/camera.zoom+camera.y]}
  function el(tag,attrs={}){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));return n}
  function draw(){svg.innerHTML='';const g=el('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);for(const o of elements){let n;if(o.type==='path'){n=el('polyline',{points:(o.points||[]).map(p=>p.join(',')).join(' '),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'})}else if(o.type==='line'){n=el('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3})}else if(o.type==='rect'){n=el('rect',{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),width:Math.abs(o.x2-o.x1),height:Math.abs(o.y2-o.y1),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3})}else if(o.type==='ellipse'){n=el('ellipse',{cx:(o.x1+o.x2)/2,cy:(o.y1+o.y2)/2,rx:Math.abs(o.x2-o.x1)/2,ry:Math.abs(o.y2-o.y1)/2,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3})}else if(o.type==='text'){n=el('text',{x:o.x,y:o.y,fill:o.color||'#15171a','font-size':o.fontSize||28,'font-family':'Arial, sans-serif'});String(o.text||'').split('\n').forEach((line,i)=>{const t=el('tspan',{x:o.x,dy:i?((o.fontSize||28)*1.25):0});t.textContent=line;n.appendChild(t)})}if(n){n.dataset.id=o.id;if(selected===o.id)n.setAttribute('opacity','.65');g.appendChild(n)}}}
  function renderTabs(){pageTabs.innerHTML=pages.map(p=>`<button class="btn sm ${p.id===current.id?'primary':''}" data-page="${p.id}">${esc(p.title)}</button>`).join('');pageTabs.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page))}
  async function save(){clearTimeout(saveTimer);status.textContent='Сохраняем…';const {error}=await sb.from('board_pages').update({elements,updated_at:new Date().toISOString()}).eq('id',current.id);status.textContent=error?'Ошибка сохранения':'Сохранено';if(error)console.error(error)}
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,350)}
  function broadcast(){if(channel)channel.send({type:'broadcast',event:'state',payload:{pageId:current.id,elements}}).catch(()=>{})}
  function changed(){draw();broadcast();scheduleSave()}
  function undo(){if(!history.length)return;future.push(structuredClone(elements));elements=history.pop();selected=null;changed()}
  function redo(){if(!future.length)return;history.push(structuredClone(elements));elements=future.pop();selected=null;changed()}
  async function switchPage(id){if(current?.id===id)return;await save();const p=pages.find(x=>x.id===id);if(!p)return;current=p;elements=structuredClone(p.elements||[]);history=[];future=[];selected=null;renderTabs();draw();joinChannel()}
  function hit(x,y){for(let i=elements.length-1;i>=0;i--){const o=elements[i];if(o.type==='text'&&Math.abs(x-o.x)<260&&Math.abs(y-o.y)<70)return o;if(['rect','ellipse','line'].includes(o.type)){const minx=Math.min(o.x1,o.x2)-15,maxx=Math.max(o.x1,o.x2)+15,miny=Math.min(o.y1,o.y2)-15,maxy=Math.max(o.y1,o.y2)+15;if(x>=minx&&x<=maxx&&y>=miny&&y<=maxy)return o}if(o.type==='path'&&(o.points||[]).some(p=>Math.hypot(p[0]-x,p[1]-y)<18))return o}return null}
  let panStart=null,moveStart=null;
  svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);const [x,y]=screenToWorld(e.clientX,e.clientY);if(tool==='hand'){panStart={cx:e.clientX,cy:e.clientY,x:camera.x,y:camera.y};return}if(tool==='text'){const text=prompt('Текст:');if(text){snapshot();elements.push({id:uid(),type:'text',x,y,text,color,fontSize:28});changed()}return}if(tool==='select'){const o=hit(x,y);selected=o?.id||null;if(o){snapshot();moveStart={x,y,orig:structuredClone(o)}}draw();return}snapshot();drawing={id:uid(),type:tool,color,width};if(tool==='pen'){drawing.points=[[x,y]]}else Object.assign(drawing,{x1:x,y1:y,x2:x,y2:y});elements.push(drawing);draw()};
  svg.onpointermove=e=>{const [x,y]=screenToWorld(e.clientX,e.clientY);if(panStart){camera.x=panStart.x-(e.clientX-panStart.cx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.cy)/camera.zoom;draw();return}if(moveStart&&selected){const o=elements.find(z=>z.id===selected);if(!o)return;const dx=x-moveStart.x,dy=y-moveStart.y,Object0=moveStart.orig;if(o.type==='text'){o.x=Object0.x+dx;o.y=Object0.y+dy}else if(o.type==='path'){o.points=Object0.points.map(p=>[p[0]+dx,p[1]+dy])}else{for(const k of ['x1','x2'])o[k]=Object0[k]+dx;for(const k of ['y1','y2'])o[k]=Object0[k]+dy}draw();broadcast();return}if(!drawing)return;if(drawing.type==='pen')drawing.points.push([x,y]);else{drawing.x2=x;drawing.y2=y}draw();broadcast()};
  svg.onpointerup=()=>{if(drawing||moveStart){drawing=null;moveStart=null;changed()}panStart=null};
  svg.onwheel=e=>{e.preventDefault();const [wx,wy]=screenToWorld(e.clientX,e.clientY),nz=Math.max(.25,Math.min(3,camera.zoom*(e.deltaY<0?1.12:.89)));const r=svg.getBoundingClientRect();camera.x=wx-(e.clientX-r.left)/nz;camera.y=wy-(e.clientY-r.top)/nz;camera.zoom=nz;zoomLabel.textContent=Math.round(nz*100)+'%';draw()};
  root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));root.querySelector('#undo').onclick=undo;root.querySelector('#redo').onclick=redo;root.querySelector('#zoomIn').onclick=()=>{camera.zoom=Math.min(3,camera.zoom*1.2);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';draw()};root.querySelector('#zoomOut').onclick=()=>{camera.zoom=Math.max(.25,camera.zoom/1.2);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';draw()};root.querySelector('#homeView').onclick=()=>{camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';draw()};
  if(isTeacher){root.querySelector('#addPage').onclick=async()=>{const title=prompt('Название листа:',`Лист ${pages.length+1}`);if(!title)return;const {data,error}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title,sort_order:pages.length}).select().single();if(error)return fail(error);pages.push(data);renderTabs();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}});await switchPage(data.id)};root.querySelector('#delPage').onclick=async()=>{if(pages.length<=1)return toast('Нельзя удалить единственный лист');if(!confirm('Удалить этот лист?'))return;const id=current.id;const {error}=await sb.from('board_pages').delete().eq('id',id);if(error)return fail(error);pages=pages.filter(p=>p.id!==id);current=pages[0];elements=structuredClone(current.elements||[]);renderTabs();draw();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}}
  async function refreshPages(){const {data}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(!data)return;const active=data.find(x=>x.id===current?.id);pages=data;if(active){current=active;if(document.activeElement?.tagName!=='SVG'){} }renderTabs()}
  function joinChannel(){if(channel)sb.removeChannel(channel);if(!current)return;channel=sb.channel(`board:${current.id}`,{config:{private:true}}).on('broadcast',{event:'state'},({payload})=>{if(payload.pageId!==current.id)return;elements=structuredClone(payload.elements||[]);draw();status.textContent='Онлайн'}).subscribe(s=>{status.textContent=s==='SUBSCRIBED'?'Онлайн':'Подключение…'})}
  function addText(text,opts={}){snapshot();elements.push({id:uid(),type:'text',x:camera.x+70/camera.zoom,y:camera.y+90/camera.zoom,text,color:opts.color||'#15171a',fontSize:opts.fontSize||28});changed()}
  const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if((e.key==='Delete'||e.key==='Backspace')&&selected&&document.activeElement===document.body){e.preventDefault();snapshot();elements=elements.filter(x=>x.id!==selected);selected=null;changed()}};window.addEventListener('keydown',key);
  pagesChannel=sb.channel(`student:${studentId}:pages`,{config:{private:true}}).on('broadcast',{event:'pages'},()=>refreshPages()).subscribe();
  renderTabs();draw();joinChannel();
  S.boardCleanup=()=>{destroyed=true;clearTimeout(saveTimer);window.removeEventListener('keydown',key);if(channel)sb.removeChannel(channel);if(pagesChannel)sb.removeChannel(pagesChannel)};
  return {addText,undo,redo};
}

async function bootStudent(){
  if(!configured)return configScreen();
  let {data:{session}}=await sb.auth.getSession();
  if(session&&!session.user.is_anonymous){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Открой ссылку ученика отдельно</h1><p>В этом браузере уже выполнен вход преподавателя. Открой персональную ссылку ученика в режиме инкогнито или на другом устройстве, чтобы не выйти из кабинета.</p></div></div>`;return}
  if(!session){const {data,error}=await sb.auth.signInAnonymously();if(error){app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Нужно включить Anonymous Sign-Ins</h1><p>${esc(error.message)}</p><p class="small muted">Supabase → Authentication → Providers → Anonymous Sign-Ins.</p></div></div>`;return}session=data.session}
  const {data:claimed,error:claimErr}=await sb.rpc('claim_student_access',{p_token:S.access});if(claimErr){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Ссылка недействительна</h1><p>Попроси преподавателя прислать новую ссылку.</p></div></div>`;return}
  const {data:student,error}=await sb.from('students').select('id,name,grade').eq('id',claimed.id).single();if(error)return fail(error);S.student=student;renderStudent();
}
async function renderStudent(){cleanupBoard();const {data:lessons}=await sb.from('lessons').select('*,topics(title)').eq('student_id',S.student.id).order('scheduled_at',{ascending:true});app.innerHTML=`<div class="student-home"><div class="student-top"><div><div class="brand">Mathroom</div><h1>${esc(S.student.name)}</h1><p class="muted">${S.student.grade} класс · персональный кабинет</p></div><div class="tabs"><button id="studentBoardTab" class="${S.studentTab==='board'?'active':''}">Доска</button><button id="studentLessonsTab" class="${S.studentTab==='lessons'?'active':''}">Уроки</button></div></div><div id="studentContent"></div></div>`;document.getElementById('studentBoardTab').onclick=()=>{S.studentTab='board';renderStudent()};document.getElementById('studentLessonsTab').onclick=()=>{S.studentTab='lessons';renderStudent()};const studentContent=document.getElementById('studentContent');if(S.studentTab==='lessons'){studentContent.innerHTML=`<div class="list">${(lessons||[]).length?(lessons||[]).map(l=>`<div class="row"><div><h3>${esc(l.topics?.title||'Урок')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин</p>${l.public_summary?`<div class="notice">${nl(l.public_summary)}</div>`:''}</div></div>`).join(''):'<div class="empty">Запланированных уроков пока нет.</div>'}</div>`}else{await mountBoard(studentContent,S.student.id,false)} }

boot().catch(e=>{console.error(e);app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Ошибка запуска</h1><p>${esc(e.message)}</p></div></div>`});
