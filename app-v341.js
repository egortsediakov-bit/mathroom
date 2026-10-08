(() => {
const {app,configured,sb,S,esc,nl,token,dateLong,dateShort,diffLabel,statusLabel,statusClass,toast,fail,copyText,modal,cleanupAll,cleanupBoard,cleanupLive,studentLink,configScreen,avg,shuffle}=window.MR;
const {mountBoard,mountSnapshot}=window.MathroomBoard;

function activeLessonStorageKey(){return S.user?.id?`mathroom.activeLesson.${S.user.id}`:'mathroom.activeLesson'}
function rememberActiveLesson(id){try{if(id)localStorage.setItem(activeLessonStorageKey(),id)}catch{}}
function forgetActiveLesson(){try{localStorage.removeItem(activeLessonStorageKey())}catch{}}
function restoreActiveLesson(){
  try{
    const id=localStorage.getItem(activeLessonStorageKey());
    if(!id)return false;
    const l=S.lessons.find(x=>x.id===id&&x.status==='in_progress');
    if(!l){localStorage.removeItem(activeLessonStorageKey());return false}
    S.activeLesson=l;S.selectedStudent=l.student_id;S.topic=S.topics.find(x=>x.id===l.topic_id)||null;S.view='lesson';return true;
  }catch{return false}
}

async function ensureTeacher(){
  const {data:{user}}=await sb.auth.getUser(); if(!user||user.is_anonymous)return null;
  await sb.from('teachers').upsert({id:user.id},{onConflict:'id'});
  const {data,error}=await sb.from('teachers').select('*').eq('id',user.id).single(); if(error)throw error; return data;
}
async function loadTeacher(){
  const reqs=await Promise.all([
    sb.from('students').select('*').order('created_at'),
    sb.from('topics').select('*').order('grade').order('section').order('title'),
    sb.from('exercises').select('*').order('created_at'),
    sb.from('lessons').select('*,students(name,grade),topics(title)').order('scheduled_at',{ascending:true}),
    sb.from('homeworks').select('*,students(name,grade),topics(title)').order('created_at',{ascending:false}),
    sb.from('tests').select('*,students(name,grade),topics(title)').order('created_at',{ascending:false}),
    sb.from('lesson_board_versions').select('*').order('created_at',{ascending:false})
  ]);
  const err=reqs.find(x=>x.error)?.error;if(err)throw err;
  [S.students,S.topics,S.exercises,S.lessons,S.homeworks,S.tests,S.versions]=reqs.map(x=>x.data||[]);
  const bank=window.MathroomCurriculumBank;if(bank?.compareTopics)S.topics.sort(bank.compareTopics);
  try{
    const [tb,tl]=await Promise.all([
      sb.from('textbooks').select('*').order('created_at',{ascending:false}),
      sb.from('textbook_topic_links').select('*')
    ]);
    S.textbooksFeatureAvailable=!tb.error&&!tl.error;S.textbooks=tb.data||[];S.textbookLinks=tl.data||[];
  }catch{S.textbooksFeatureAvailable=false;S.textbooks=[];S.textbookLinks=[]}
  if(!S.selectedStudent&&S.students[0])S.selectedStudent=S.students[0].id;
}
let curriculumSyncPromise=null;
function curriculumSeeded(){
  const bank=window.MathroomCurriculumBank,tag=bank?.SYNC_TAG||bank?.BANK_TAG;
  return !!tag && (S.exercises||[]).some(x=>(x.tags||[]).includes(tag));
}
async function syncCurriculumBank({manual=false}={}){
  const bank=window.MathroomCurriculumBank;
  if(!bank||!S.user)return null;
  if(curriculumSyncPromise)return curriculumSyncPromise;
  if(!manual&&curriculumSeeded())return null;
  curriculumSyncPromise=(async()=>{
    if(manual)toast('Обновляю готовую базу тем и задач…');
    try{
      const result=await bank.seed({sb,teacherId:S.user.id,topics:S.topics,exercises:S.exercises});
      if(result.topicsAdded||result.tasksAdded||result.theoriesAdded){
        await loadTeacher();
        if(['topics','bank','dashboard'].includes(S.view))renderTeacher();
        toast(`База готова · ${result.totalTopics} тем · ${result.totalTasks} задач`);
      }else if(manual)toast('База уже загружена и актуальна');
      return result;
    }catch(e){
      console.error('curriculum seed',e);
      if(manual)fail(e); else toast('Готовую базу не удалось загрузить автоматически. Открой «Банк задач» и нажми «Обновить базу».');
      return null;
    }finally{curriculumSyncPromise=null}
  })();
  return curriculumSyncPromise;
}
function curriculumBank(){return window.MathroomCurriculumBank||null}
function topicMeta(t){return curriculumBank()?.metaFor?.(t)||null}
function topicSourceMeta(t){return curriculumBank()?.sourceFor?.(t)||''}
function textbookAutoSyncPlan({bookIds=null}={}){
  const engine=window.MathroomTextbookSyncV290;if(!engine)return {rows:[],recognized:[],unrecognized:[],exactPages:0};
  const ids=bookIds?new Set(bookIds.map(String)):null;
  const books=(S.textbooks||[]).filter(b=>!ids||ids.has(String(b.id)));
  return engine.buildCandidates({books,topics:S.topics||[],sourceFor:topicSourceMeta});
}
async function syncTextbooksWithTopics({silent=false,bookIds=null}={}){
  if(!S.textbooksFeatureAvailable)throw new Error('Библиотека учебников не подключена');
  const plan=textbookAutoSyncPlan({bookIds}),existing=S.textbookLinks||[],existingByKey=new Map(existing.map(x=>[`${x.textbook_id}|${x.topic_id}`,x]));
  const bodies=[];let skippedManual=0,created=0,updated=0;
  for(const row of plan.rows){
    const key=`${row.book.id}|${row.topic.id}`,old=existingByKey.get(key),autoOld=old&&String(old.note||'').startsWith('Автопривязка ·');
    if(old&&!autoOld){skippedManual++;continue}
    const pageFrom=row.page_from ?? (autoOld?old.page_from:null),pageTo=row.page_to ?? (autoOld?old.page_to:null);
    const body={teacher_id:S.user.id,textbook_id:row.book.id,topic_id:row.topic.id,page_from:pageFrom||null,page_to:pageTo||null,note:row.note||'Автопривязка'};
    if(!old)created++;else if(String(old.page_from||'')!==String(body.page_from||'')||String(old.page_to||'')!==String(body.page_to||'')||String(old.note||'')!==String(body.note||''))updated++;
    bodies.push(body);
  }
  for(let i=0;i<bodies.length;i+=150){const {error}=await sb.from('textbook_topic_links').upsert(bodies.slice(i,i+150),{onConflict:'textbook_id,topic_id'});if(error)throw error}
  // v29.1: удаляем только устаревшие АВТО-связи. Ручные связи пользователя не трогаем.
  const plannedKeys=new Set(plan.rows.map(r=>`${r.book.id}|${r.topic.id}`));
  const targetBookIds=new Set(plan.recognized.map(x=>String(x.book.id)));
  const staleAuto=existing.filter(x=>targetBookIds.has(String(x.textbook_id))&&String(x.note||'').startsWith('Автопривязка ·')&&!plannedKeys.has(`${x.textbook_id}|${x.topic_id}`));
  let removed=0;
  for(let i=0;i<staleAuto.length;i+=100){const ids=staleAuto.slice(i,i+100).map(x=>x.id).filter(Boolean);if(!ids.length)continue;const {error}=await sb.from('textbook_topic_links').delete().in('id',ids);if(error)throw error;removed+=ids.length}
  await loadTeacher();
  const result={...plan,created,updated,removed,skippedManual,total:bodies.length};
  if(!silent){
    const unknown=plan.unrecognized.length,unresolved=plan.rows.filter(r=>!r.exactPages);
    const unresolvedHtml=unresolved.length?`<details class="card" style="margin-top:14px"><summary><b>Без точных страниц: ${unresolved.length}</b></summary><div style="margin-top:10px">${unresolved.map(r=>`<div class="muted" style="padding:6px 0;border-bottom:1px solid var(--line,#e8e8e8)">${esc(r.bookMeta?.label||'Учебник')} · ${Number(r.bookMeta?.grade)||'—'} класс${r.bookMeta?.part?` · часть ${r.bookMeta.part}`:''} — <b>${esc(r.topic?.title||'Тема')}</b></div>`).join('')}</div></details>`:`<div class="notice" style="margin-top:14px"><b>Все ${plan.rows.length} автоматических связей имеют точные страницы PDF.</b></div>`;
    const text=`<h2>Синхронизация завершена</h2><div class="grid cols3"><div class="card"><div class="muted">Распознано учебников</div><div class="metric">${plan.recognized.length}</div></div><div class="card"><div class="muted">Связей с темами</div><div class="metric">${plan.rows.length}</div></div><div class="card"><div class="muted">С точными страницами</div><div class="metric">${plan.exactPages}</div></div></div><div class="notice">Создано новых связей: <b>${created}</b> · обновлено: <b>${updated}</b>${removed?` · удалено устаревших авто-связей: <b>${removed}</b>`:''}${skippedManual?` · ручные связи сохранены: <b>${skippedManual}</b>`:''}${unknown?`<br>Не распознано учебников: <b>${unknown}</b> — их можно привязать вручную.`:''}</div>${unresolvedHtml}<p class="muted">v29.2 закрывает карту физических PDF-страниц для текущего набора Петерсон, Виленкина и Дорофеева–Петерсон. Для тем, распределённых по всему учебнику, используется проверенный основной или репрезентативный блок. Номера относятся именно к страницам PDF.</p>`;
    modal(text,'wide-modal');
  }
  return result;
}
function topicTrack(t){return topicMeta(t)?.track||curriculumBank()?.schoolTrack?.(t)||'Математика'}
function nextCurriculumTopic(t){return curriculumBank()?.nextTopic?.(t,S.topics||[])||null}
function firstCurriculumTopic(grade,track=''){return curriculumBank()?.firstTopic?.(grade,S.topics||[],track)||null}
function topicPosition(t){
  const track=topicTrack(t),rows=(S.topics||[]).filter(x=>Number(x.grade)===Number(t.grade)&&topicTrack(x)===track).sort(curriculumBank()?.compareTopics||(()=>0));
  const ix=rows.findIndex(x=>String(x.id)===String(t.id));return {index:ix>=0?ix+1:0,total:rows.length,track};
}
function parseTheoryBlocks(raw=''){
  const text=String(raw||'').trim();
  if(!text)return [];
  const blocks=[];let title='',lines=[];
  const flush=()=>{if(title||lines.length){blocks.push({title:(title||'').trim(),body:lines.join('\n').trim()});title='';lines=[]}};
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/^##\s+(.+)$/);
    if(m){flush();title=m[1].trim();}
    else lines.push(line);
  }
  flush();
  if(!blocks.length&&text) return [{title:'',body:text}];
  return blocks.filter(b=>b.title||b.body);
}
function theoryHtml(raw=''){
  const blocks=parseTheoryBlocks(raw);
  if(!blocks.length)return '<div class="empty">Теория пока не добавлена.</div>';
  if(blocks.length<=1&&!blocks[0]?.title)return `<div class="prewrap">${nl(blocks[0].body||'')}</div>`;
  return `<div class="mr-theory-grid">${blocks.map((b,i)=>`<section class="mr-theory-block ${i===0?'lead':''}">${b.title?`<h3>${esc(b.title)}</h3>`:''}<div class="mr-theory-body">${nl(b.body)}</div></section>`).join('')}</div>`;
}
function plainTheory(raw=''){return parseTheoryBlocks(raw).map(b=>[b.title,b.body].filter(Boolean).join('\n')).join('\n\n').trim()}
function sendTheoryToBoard(ctrl,topic){
  if(!ctrl||!topic)return;
  if(typeof ctrl.addTheoryCards==='function') return ctrl.addTheoryCards(topic.title, parseTheoryBlocks(topic.theory||''));
  return ctrl.addText(`${topic.title}\n\n${plainTheory(topic.theory)}`,{fontSize:24});
}
function lastCompletedLessonForStudent(studentId){return (S.lessons||[]).filter(x=>x.student_id===studentId&&x.status==='completed'&&x.topic_id).sort((a,b)=>String(b.completed_at||b.scheduled_at||'').localeCompare(String(a.completed_at||a.scheduled_at||'')))[0]||null}
function suggestedTopicForStudent(studentId){
  const st=(S.students||[]).find(x=>x.id===studentId);if(!st)return null;
  const last=lastCompletedLessonForStudent(studentId),current=last?S.topics.find(t=>t.id===last.topic_id):null;
  if(current){const next=nextCurriculumTopic(current);if(next)return {topic:next,after:current}}
  const first=firstCurriculumTopic(st.grade);return first?{topic:first,after:null}:null;
}
function textbookLinksForTopic(topicId){return (S.textbookLinks||[]).filter(x=>String(x.topic_id)===String(topicId)).map(l=>({...l,textbook:(S.textbooks||[]).find(t=>String(t.id)===String(l.textbook_id))})).filter(x=>x.textbook)}
async function signedTextbookUrl(book,page=0){
  const {data,error}=await sb.storage.from('textbooks').createSignedUrl(book.file_path,3600);if(error)throw error;
  return data.signedUrl+(page?`#page=${Number(page)}`:'');
}
async function openTextbook(book,page=0){try{const url=await signedTextbookUrl(book,page);window.open(url,'_blank','noopener,noreferrer')}catch(e){fail(e)}}
async function downloadTextbookBlob(book){
  const {data,error}=await sb.storage.from('textbooks').download(book.file_path);
  if(error)throw error;
  return data;
}
async function waitForBoardController(timeout=10000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    if(S.boardController?.importPdfBlob)return S.boardController;
    await new Promise(r=>setTimeout(r,120));
  }
  throw new Error('Доска не успела загрузиться. Попробуй ещё раз.');
}
async function textbookPagesToBoardModal(link,{controller=null}={}){
  const book=link?.textbook||(S.textbooks||[]).find(x=>String(x.id)===String(link?.textbook_id));
  if(!book)return toast('Учебник не найден');
  const initialFrom=Math.max(1,Number(link?.page_from)||1),initialTo=Math.max(initialFrom,Number(link?.page_to)||initialFrom);
  const m=modal(`<div class="mr-card-head"><div><span class="pill">PDF → доска</span><h2>${esc(book.title)}</h2><p class="muted">Выбери, какие страницы добавить. На доске они станут изображениями — поверх можно писать, выделять и рисовать.</p></div></div><div class="grid cols2"><div class="field"><label>Страница от</label><input id="tbBoardFrom" type="number" min="1" value="${initialFrom}"></div><div class="field"><label>Страница до</label><input id="tbBoardTo" type="number" min="1" value="${initialTo}"></div></div><div class="notice">До 20 страниц за одну вставку. Во время урока страницы попадут на текущую онлайн-доску. Из раздела «Темы» — в Черновик. «На новый лист» создаст отдельный лист и разместит выбранные страницы вертикально.</div><div class="actions mr-textbook-board-actions"><button class="btn" data-tb-board-mode="single">Эта страница</button><button class="btn primary" data-tb-board-mode="range">Страницы темы</button><button class="btn" data-tb-board-mode="new">На новый лист</button></div><div class="small muted" id="tbBoardState"></div>`,'wide-modal');
  const state=m.querySelector('#tbBoardState'),buttons=[...m.querySelectorAll('[data-tb-board-mode]')];
  const run=async mode=>{
    const from=Math.max(1,Number(m.querySelector('#tbBoardFrom').value)||1);
    let to=Math.max(from,Number(m.querySelector('#tbBoardTo').value)||from);
    if(mode==='single')to=from;
    if(to-from+1>20)return toast('Выбери не больше 20 страниц за одну вставку');
    buttons.forEach(b=>b.disabled=true);state.textContent='Скачиваем PDF из библиотеки…';
    try{
      const blob=await downloadTextbookBlob(book);
      let ctrl=controller;
      if(!ctrl?.importPdfBlob){
        state.textContent='Открываем доску…';
        m.remove();S.boardController=null;S.selectedStudent='__scratch__';S.view='scratch';renderTeacher();
        ctrl=await waitForBoardController();
      }
      if(!ctrl?.importPdfBlob)throw new Error('Обнови страницу: модуль вставки PDF на доску не загрузился');
      state.textContent='Добавляем страницы на доску…';
      await ctrl.importPdfBlob(blob,{name:`${book.title}.pdf`,pageFrom:from,pageTo:to,newSheet:mode==='new',maxPages:20,sheetTitle:`${book.title} · стр. ${from}${to!==from?`–${to}`:''}`});
      if(m.isConnected)m.remove();
    }catch(e){buttons.forEach(b=>b.disabled=false);state.textContent='';fail(e)}
  };
  buttons.forEach(b=>b.onclick=()=>run(b.dataset.tbBoardMode));
}
async function linkTextbookModal({topicId='',textbookId=''}={}){
  if(!S.textbooksFeatureAvailable)return toast('Сначала подключи библиотеку учебников через SQL v28.2');
  if(!(S.textbooks||[]).length)return toast('Сначала добавь PDF в разделе «Учебники»');
  const topics=(S.topics||[]).slice().sort(curriculumBank()?.compareTopics||(()=>0));
  const books=(S.textbooks||[]);
  const m=modal(`<h2>Привязать учебник к теме</h2><div class="grid cols2"><div class="field"><label>Учебник</label><select id="ltBook">${books.map(x=>`<option value="${x.id}" ${String(x.id)===String(textbookId)?'selected':''}>${esc(x.title)}${x.author?` · ${esc(x.author)}`:''}</option>`).join('')}</select></div><div class="field"><label>Тема</label><select id="ltTopic">${topics.map(x=>`<option value="${x.id}" ${String(x.id)===String(topicId)?'selected':''}>${x.grade} кл. · ${esc(topicTrack(x))} · ${esc(x.title)}</option>`).join('')}</select></div></div><div class="grid cols3"><div class="field"><label>Страница от</label><input id="ltFrom" type="number" min="1" placeholder="42"></div><div class="field"><label>Страница до</label><input id="ltTo" type="number" min="1" placeholder="47"></div><div class="field"><label>Комментарий</label><input id="ltNote" placeholder="§ 12, примеры 1–3"></div></div><div class="notice">Укажи страницы, на которых раскрывается эта тема. После этого ссылка на учебник появится прямо в теме.</div><button class="btn primary" id="ltSave">Привязать</button>`,'wide-modal');
  m.querySelector('#ltSave').onclick=async()=>{const body={teacher_id:S.user.id,textbook_id:m.querySelector('#ltBook').value,topic_id:m.querySelector('#ltTopic').value,page_from:Number(m.querySelector('#ltFrom').value)||null,page_to:Number(m.querySelector('#ltTo').value)||null,note:m.querySelector('#ltNote').value.trim()};const {error}=await sb.from('textbook_topic_links').upsert(body,{onConflict:'textbook_id,topic_id'});if(error)return fail(error);m.remove();await loadTeacher();if(S.topic)S.topic=S.topics.find(x=>x.id===S.topic.id)||S.topic;renderTeacher();toast('Учебник привязан к теме')};
}

async function boot(){
  if(!configured)return configScreen();
  if(S.access)return bootStudent();
  const {data:{session}}=await sb.auth.getSession();
  if(!session||session.user.is_anonymous)return renderAuth();
  S.user=session.user;try{S.teacher=await ensureTeacher();await loadTeacher();restoreActiveLesson();renderTeacher();syncCurriculumBank()}catch(e){fail(e);renderAuth()}
}
function renderAuth(){
  app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Облачный кабинет</h1><p>GitHub Pages + Supabase</p><form id="loginForm"><div class="field"><label>Email</label><input id="email" type="email" required></div><div class="field"><label>Пароль</label><input id="password" type="password" minlength="6" required></div><div class="actions"><button class="btn primary">Войти</button><button type="button" class="btn" id="register">Создать аккаунт</button></div></form><div id="authMsg" class="small muted" style="margin-top:12px"></div></div></div>`;
  document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();const email=document.getElementById('email').value,password=document.getElementById('password').value;const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)return document.getElementById('authMsg').textContent=error.message;S.user=data.user;S.teacher=await ensureTeacher();await loadTeacher();restoreActiveLesson();renderTeacher();syncCurriculumBank()};
  document.getElementById('register').onclick=async()=>{const email=document.getElementById('email').value,password=document.getElementById('password').value;const {data,error}=await sb.auth.signUp({email,password});if(error)return document.getElementById('authMsg').textContent=error.message;if(!data.session){document.getElementById('authMsg').textContent='Аккаунт создан. Подтверди email, затем войди.';return}S.user=data.user;S.teacher=await ensureTeacher();await loadTeacher();restoreActiveLesson();renderTeacher();syncCurriculumBank()};
}

const nav=[['dashboard','Главная'],['schedule','Расписание'],['students','Ученики'],['topics','Темы'],['textbooks','Учебники'],['bank','Банк задач'],['assignments','Задания'],['history','История'],['scratch','Черновик'],['board','Доска']];
function shell(content,title,sub=''){
  const workspace=['scratch','board','lesson'].includes(S.view);
  return `<div class="layout auto-sidebar ${workspace?'workspace-mode':''} view-${S.view}"><aside class="sidebar" aria-label="Главное меню"><div class="brand">Mathroom <span class="cloud-badge">☁ cloud</span></div><nav class="nav">${nav.map(([id,n])=>`<button data-nav="${id}" class="${S.view===id?'active':''}">${n}</button>`).join('')}</nav><div class="sidebar-footer"><button class="btn ghost sm sidebar-help" id="sidebarHelp" type="button">? Справка</button><button class="btn ghost sm" id="logout">Выйти</button></div></aside><main class="content"><div class="topbar"><div><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div></div>${content}</main></div>`;
}
function bindShell(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{cleanupAll();forgetActiveLesson();S.view=b.dataset.nav;S.topic=null;S.activeLesson=null;renderTeacher()});
  const l=document.getElementById('logout');if(l)l.onclick=async()=>{cleanupAll();forgetActiveLesson();await sb.auth.signOut();S.user=S.teacher=null;renderAuth()};
}
function renderTeacher(){
  cleanupAll();
  if(S.view==='students')return renderStudents();
  if(S.view==='profile')return renderStudentProfile(S.selectedStudent);
  if(S.view==='topics')return S.topic?renderTopic():renderTopics();
  if(S.view==='textbooks')return renderTextbooks();
  if(S.view==='bank')return renderBank();
  if(S.view==='schedule')return renderSchedule();
  if(S.view==='assignments')return renderAssignments();
  if(S.view==='history')return renderHistory();
  if(S.view==='scratch'){S.selectedStudent='__scratch__';return renderBoardPage()}
  if(S.view==='board')return renderBoardPage();
  if(S.view==='lesson')return renderLesson();
  return renderDashboard();
}

function renderDashboard(){
  const now=Date.now(),upcoming=S.lessons.filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=now).slice(0,5);
  const pending=S.homeworks.filter(x=>x.status==='submitted').length;
  app.innerHTML=shell(`<div class="grid cols4"><div class="card"><div class="muted">Ученики</div><div class="metric">${S.students.length}</div></div><div class="card"><div class="muted">Темы</div><div class="metric">${S.topics.length}</div></div><div class="card"><div class="muted">Задачи</div><div class="metric">${S.exercises.filter(x=>x.kind==='task').length}</div></div><div class="card"><div class="muted">На проверку</div><div class="metric">${pending}</div></div></div><div class="section-title"><h2>Ближайшие уроки</h2></div><div class="list">${upcoming.length?upcoming.map(l=>`<div class="row"><div><h3>${esc(l.students?.name||'Ученик')} · ${esc(l.topics?.title||'Без темы')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин</p></div><button class="btn primary sm" data-start="${l.id}">Начать</button></div>`).join(''):'<div class="empty">Добавь первое занятие в разделе «Расписание».</div>'}</div>`,'Кабинет преподавателя','Mathroom Web v3.4 · облачная учебная система');bindShell();
  document.querySelectorAll('[data-start]').forEach(b=>b.onclick=async()=>{const l=S.lessons.find(x=>x.id===b.dataset.start);await startLesson(l)});
}

function renderStudents(){
  app.innerHTML=shell(`<div class="form-card"><h2>Добавить ученика</h2><form id="studentForm" class="form-grid"><div class="field"><label>Имя</label><input id="stName" required placeholder="Иван"></div><div class="field"><label>Класс</label><select id="stGrade">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><button class="btn primary">Добавить</button></form></div><div class="list">${S.students.length?S.students.map(st=>`<div class="row"><div class="row-main"><h3>${esc(st.name)} · ${st.grade} класс</h3><div class="token-link">${esc(studentLink(st))}</div></div><div class="actions"><button class="btn sm primary" data-profile="${st.id}">Профиль</button><button class="btn sm" data-copy="${st.id}">Копировать</button><button class="btn sm" data-board="${st.id}">Доска</button><button class="btn sm" data-rotate="${st.id}">Новая ссылка</button><button class="btn sm danger" data-delete="${st.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Учеников пока нет.</div>'}</div>`,'Ученики','Персональные ссылки, прогресс и доски');bindShell();
  document.getElementById('studentForm').onsubmit=async e=>{e.preventDefault();const body={teacher_id:S.user.id,name:document.getElementById('stName').value.trim(),grade:Number(document.getElementById('stGrade').value),access_token:token()};const {error}=await sb.from('students').insert(body);if(error)return fail(error);await loadTeacher();renderStudents();toast('Ученик создан')};
  document.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{S.selectedStudent=b.dataset.profile;S.view='profile';renderTeacher()});
  document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{const st=S.students.find(x=>x.id===b.dataset.copy);await copyText(studentLink(st));toast('Ссылка скопирована')});
  document.querySelectorAll('[data-board]').forEach(b=>b.onclick=()=>{S.selectedStudent=b.dataset.board;S.view='board';renderTeacher()});
  document.querySelectorAll('[data-rotate]').forEach(b=>b.onclick=async()=>{if(!confirm('Старая ссылка перестанет работать. Продолжить?'))return;const {error}=await sb.rpc('rotate_student_access',{p_student_id:b.dataset.rotate});if(error)return fail(error);await loadTeacher();renderStudents();toast('Новая ссылка создана')});
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить ученика и его данные?'))return;const {error}=await sb.from('students').delete().eq('id',b.dataset.delete);if(error)return fail(error);await loadTeacher();renderStudents()});
}

async function profileAnalytics(studentId){
  const hs=S.homeworks.filter(x=>x.student_id===studentId),ts=S.tests.filter(x=>x.student_id===studentId),ls=S.lessons.filter(x=>x.student_id===studentId);
  const idsH=hs.map(x=>x.id),idsT=ts.map(x=>x.id);let items=[];
  if(idsH.length){const {data}=await sb.from('homework_items').select('homework_id,is_correct,category,tags,difficulty').in('homework_id',idsH);items.push(...(data||[]))}
  if(idsT.length){const {data}=await sb.from('test_items').select('test_id,is_correct,category,tags,difficulty').in('test_id',idsT);items.push(...(data||[]))}
  const {data:reportsRaw,error:reportsError}=await sb.from('lesson_reports').select('*').eq('student_id',studentId).order('created_at',{ascending:true});
  const reports=reportsError?[]:(reportsRaw||[]);
  const cats={};for(const x of items.filter(x=>x.is_correct!==null)){const key=x.category||'Без категории';cats[key]??={ok:0,total:0};cats[key].total++;if(x.is_correct)cats[key].ok++}
  const weak=Object.entries(cats).map(([name,v])=>({name,score:Math.round(v.ok*100/v.total),total:v.total})).sort((a,b)=>a.score-b.score).slice(0,5);
  const liveCats={},liveTags={};
  for(const r of reports){
    for(const [name,v] of Object.entries(r.category_stats||{})){const a=liveCats[name]??={solved:0,hard:0,later:0,pending:0,total:0};for(const k of ['solved','hard','later','pending','total'])a[k]+=Number(v?.[k]||0)}
    for(const [name,v] of Object.entries(r.tag_stats||{})){const a=liveTags[name]??={solved:0,hard:0,later:0,pending:0,total:0};for(const k of ['solved','hard','later','pending','total'])a[k]+=Number(v?.[k]||0)}
  }
  const rankFocus=map=>Object.entries(map).map(([name,v])=>{const reviewed=v.solved+v.hard+v.later;const confidence=reviewed?Math.round(v.solved*100/reviewed):0;const attention=v.hard+v.later;return{name,...v,reviewed,confidence,attention}}).filter(x=>x.reviewed>0).sort((a,b)=>b.attention-a.attention||a.confidence-b.confidence).slice(0,6);
  const weakLive=rankFocus(liveCats),weakTags=rankFocus(liveTags);
  const vals=reports.map(r=>Number(r.solved_percent||0));
  const recent=vals.slice(-3),previous=vals.slice(-6,-3);
  const mean=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
  const recentAvg=mean(recent),previousAvg=mean(previous),trendDelta=recentAvg!=null&&previousAvg!=null?recentAvg-previousAvg:null;
  const totalSeconds=reports.reduce((sum,r)=>sum+Number(r.duration_seconds||0),0);
  return {hs,ts,ls,reports,weak,weakLive,weakTags,avgHw:avg(hs.map(x=>x.score)),avgTest:avg(ts.map(x=>x.score)),completed:ls.filter(x=>x.status==='completed').length,recentAvg,previousAvg,trendDelta,totalSeconds};
}
function reportTrendHtml(a){
  const recent=(a.reports||[]).slice(-8);if(!recent.length)return '<div class="empty">Динамика появится после завершённых уроков.</div>';
  return `<div class="mr-trend-chart">${recent.map(r=>{const pct=Math.max(0,Math.min(100,Number(r.solved_percent||0)));const lesson=S.lessons.find(l=>l.id===r.lesson_id);const label=lesson?.topics?.title||'Урок';return `<div class="mr-trend-col" title="${esc(label)} · ${pct}%"><span>${pct}%</span><div class="mr-trend-track"><i style="height:${Math.max(4,pct)}%"></i></div><small>${new Date(r.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</small></div>`}).join('')}</div>`;
}
async function renderStudentProfile(studentId){
  const st=S.students.find(x=>x.id===studentId);if(!st){S.view='students';return renderTeacher()}
  const a=await profileAnalytics(studentId);const upcoming=S.lessons.filter(x=>x.student_id===studentId&&x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at)>new Date()).slice(0,3);
  const focusCats=a.weakLive.length?a.weakLive.map(x=>x.name):a.weak.map(x=>x.name);
  const focusTags=a.weakTags.map(x=>x.name);
  const recommendations=S.exercises.filter(e=>e.kind==='task'&&(focusCats.includes(e.category)||(e.tags||[]).some(t=>focusTags.includes(t)))).sort((x,y)=>(x.use_count||0)-(y.use_count||0)).slice(0,6);
  const trend=a.trendDelta==null?'Недостаточно данных':`${a.trendDelta>0?'↑':a.trendDelta<0?'↓':'→'} ${a.trendDelta>0?'+':''}${a.trendDelta} п.п.`;
  const trendClass=a.trendDelta==null?'':a.trendDelta>0?'good':a.trendDelta<0?'warn':'';
  const hours=(a.totalSeconds/3600).toFixed(a.totalSeconds>=36000?0:1);
  const focusHtml=a.weakLive.length?a.weakLive.map(w=>`<div class="progress-row"><div class="progress-head"><b>${esc(w.name)}</b><b>${w.confidence}% уверенно</b></div><div class="progress-track"><div class="progress-fill" style="width:${w.confidence}%"></div></div><div class="small muted">На уроках: ${w.reviewed} · сложно/позже: ${w.attention}</div></div>`).join(''):(a.weak.length?a.weak.map(w=>`<div class="progress-row"><div class="progress-head"><b>${esc(w.name)}</b><b>${w.score}%</b></div><div class="progress-track"><div class="progress-fill" style="width:${w.score}%"></div></div><div class="small muted">${w.total} проверенных задач</div></div>`).join(''):'<div class="empty">Статистика появится после выполненных работ и уроков.</div>');
  const pathSuggestion=suggestedTopicForStudent(studentId);
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:14px"><button class="btn" id="backStudents">← Ученики</button><button class="btn" id="profileBoard">Доска</button><button class="btn" id="profileLink">Скопировать ссылку</button></div><div class="card student-profile-head"><div><span class="pill">${st.grade} класс</span><h2>${esc(st.name)}</h2></div><div class="profile-edit"><input id="profileName" value="${esc(st.name)}"><select id="profileGrade">${Array.from({length:11},(_,i)=>`<option ${i+1===st.grade?'selected':''}>${i+1}</option>`).join('')}</select><button class="btn sm" id="saveProfile">Сохранить</button></div></div><div class="grid cols4 profile-metrics"><div class="card"><div class="muted">Уроков завершено</div><div class="metric">${a.completed}</div></div><div class="card"><div class="muted">Уверенно за 3 урока</div><div class="metric">${a.recentAvg==null?'—':a.recentAvg+'%'}</div><div class="small ${trendClass}">${trend}</div></div><div class="card"><div class="muted">Средний тест</div><div class="metric">${a.avgTest==null?'—':a.avgTest+'%'}</div></div><div class="card"><div class="muted">Времени занятий</div><div class="metric">${a.totalSeconds?hours+' ч':'—'}</div></div></div>${pathSuggestion?`<div class="card mr-profile-next-topic"><div><span class="pill">Следующая тема по программе</span><h2>${esc(pathSuggestion.topic.title)}</h2><p class="muted">${pathSuggestion.topic.grade} класс · ${esc(topicTrack(pathSuggestion.topic))}${pathSuggestion.after?` · после «${esc(pathSuggestion.after.title)}»`:''}</p></div><div class="actions"><button class="btn" id="profileNextTopic">Открыть тему</button><button class="btn primary" id="profileScheduleNext">Запланировать</button></div></div>`:''}<div class="grid cols2" style="margin-top:16px"><div class="card"><div class="mr-card-head"><h2>Динамика уроков</h2><span class="pill">последние ${Math.min(8,a.reports.length)}</span></div>${reportTrendHtml(a)}</div><div class="card"><h2>Что требует внимания</h2>${focusHtml}${a.weakTags.length?`<div class="mr-tag-cloud">${a.weakTags.slice(0,8).map(t=>`<span class="pill">#${esc(t.name)} · ${t.attention}</span>`).join('')}</div>`:''}</div></div><div class="grid cols2" style="margin-top:16px"><div class="card"><h2>Рекомендации на следующий урок</h2>${recommendations.length?recommendations.map(e=>`<div class="item-box"><b>${esc(e.title||'Задача')}</b><div class="small muted">${esc(e.category||'')} · ${diffLabel(e.difficulty)} ${(e.tags||[]).map(t=>'#'+esc(t)).join(' ')}</div><div class="prewrap">${nl(e.content)}</div></div>`).join(''):'<div class="empty">Пока нет данных для рекомендаций.</div>'}</div><div class="card"><h2>Последние отчёты</h2>${a.reports.length?a.reports.slice(-5).reverse().map(r=>{const l=S.lessons.find(x=>x.id===r.lesson_id);return `<div class="mr-report-mini"><div><b>${esc(l?.topics?.title||'Урок')}</b><span>${new Date(r.created_at).toLocaleDateString('ru-RU')}</span></div><div class="actions"><span class="pill">✓ ${r.solved_count}/${r.queue_total}</span><span class="pill">${Math.round(Number(r.solved_percent||0))}% уверенно</span></div>${r.public_focus?`<p class="small muted">Повторить: ${esc(r.public_focus)}</p>`:''}</div>`}).join(''):'<div class="empty">Отчётов пока нет.</div>'}</div></div><div class="section-title"><h2>Ближайшие уроки</h2></div><div class="list">${upcoming.length?upcoming.map(l=>`<div class="row"><div><h3>${esc(l.topics?.title||'Урок')}</h3><p>${dateLong(l.scheduled_at)}</p></div></div>`).join(''):'<div class="empty">Нет запланированных уроков.</div>'}</div>`,'Профиль ученика','Динамика считается по урокам, домашним и тестам');bindShell();
  document.getElementById('backStudents').onclick=()=>{S.view='students';renderTeacher()};document.getElementById('profileBoard').onclick=()=>{S.view='board';renderTeacher()};document.getElementById('profileLink').onclick=async()=>{await copyText(studentLink(st));toast('Ссылка скопирована')};
  document.getElementById('profileNextTopic')?.addEventListener('click',()=>{S.topic=pathSuggestion.topic;S.topicGradeFilter=Number(pathSuggestion.topic.grade);S.view='topics';renderTeacher()});document.getElementById('profileScheduleNext')?.addEventListener('click',()=>{S.schedulePrefill={studentId:st.id,topicId:pathSuggestion.topic.id};S.view='schedule';renderTeacher()});
  document.getElementById('saveProfile').onclick=async()=>{const {error}=await sb.from('students').update({name:document.getElementById('profileName').value.trim(),grade:Number(document.getElementById('profileGrade').value)}).eq('id',st.id);if(error)return fail(error);await loadTeacher();renderStudentProfile(st.id);toast('Профиль сохранён')};
}

function exerciseSystemTags(tags=[]){return (tags||[]).filter(t=>String(t).startsWith('mathroom-core-bank-v')||String(t).startsWith('mrseed:'))}
function exerciseEditableTags(tags=[]){return (tags||[]).filter(t=>!String(t).startsWith('mathroom-core-bank-v')&&!String(t).startsWith('mrseed:')&&!String(t).startsWith('класс-')&&!String(t).startsWith('тема:'))}
function isSeededExercise(x){return (x?.tags||[]).some(t=>String(t).startsWith('mrseed:')||String(t).startsWith('mathroom-core-bank-v'))}
function editTopicModal(t,{returnToTopic=false}={}){
  const m=modal(`<h2>Редактировать тему</h2><div class="grid cols3"><div class="field"><label>Класс</label><select id="etGrade">${Array.from({length:11},(_,i)=>`<option ${i+1===Number(t.grade)?'selected':''}>${i+1}</option>`).join('')}</select></div><div class="field"><label>Раздел</label><input id="etSection" value="${esc(t.section||'')}"></div><div class="field"><label>Название темы</label><input id="etTitle" value="${esc(t.title||'')}"></div></div><div class="field"><label>Теория</label><textarea id="etTheory" rows="8">${esc(t.theory||'')}</textarea></div><div class="actions"><button class="btn primary" id="saveTopicEdit">Сохранить</button></div>`,'wide-modal');
  m.querySelector('#saveTopicEdit').onclick=async()=>{const title=m.querySelector('#etTitle').value.trim();if(!title)return toast('Укажи название темы');const {error}=await sb.from('topics').update({grade:Number(m.querySelector('#etGrade').value),section:m.querySelector('#etSection').value.trim(),title,theory:m.querySelector('#etTheory').value}).eq('id',t.id);if(error)return fail(error);m.remove();await loadTeacher();if(returnToTopic){S.topic=S.topics.find(x=>x.id===t.id)||null;S.topic?renderTopic():renderTopics()}else renderTopics();toast('Тема обновлена')};
}
async function deleteTopicRow(t,{returnToTopics=true}={}){
  if(!confirm(`Удалить тему «${t.title}» и все связанные с ней задачи?`))return false;
  const {error}=await sb.from('topics').delete().eq('id',t.id);if(error)return fail(error);
  await loadTeacher();if(S.topic?.id===t.id)S.topic=null;if(returnToTopics){S.view='topics';renderTopics()}toast('Тема удалена');return true;
}
function editExerciseModal(x,{onDone}={}){
  const topic=S.topics.find(t=>t.id===x.topic_id),userTags=exerciseEditableTags(x.tags).join(', ');
  const m=modal(`<h2>Редактировать ${x.kind==='example'?'пример':'задачу'}</h2><p class="muted">${esc(topic?.grade||'')} класс · ${esc(topic?.title||'Без темы')}</p><div class="grid cols3"><div class="field"><label>Тип</label><select id="eeKind"><option value="task" ${x.kind==='task'?'selected':''}>Задача</option><option value="example" ${x.kind==='example'?'selected':''}>Пример</option></select></div><div class="field"><label>Сложность</label><select id="eeDiff"><option value="basic" ${x.difficulty==='basic'?'selected':''}>Базовая</option><option value="medium" ${x.difficulty==='medium'?'selected':''}>Средняя</option><option value="advanced" ${x.difficulty==='advanced'?'selected':''}>Сложная</option></select></div><div class="field"><label>Категория</label><input id="eeCat" value="${esc(x.category||'')}"></div></div><div class="field"><label>Название</label><input id="eeTitle" value="${esc(x.title||'')}"></div><div class="field"><label>Условие</label><textarea id="eeContent" rows="7">${esc(x.content||'')}</textarea></div><div class="grid cols2"><div class="field"><label>Ответ</label><input id="eeAnswer" value="${esc(x.answer||'')}"></div><div class="field"><label>Теги через запятую</label><input id="eeTags" value="${esc(userTags)}"></div></div><div class="actions"><button class="btn primary" id="saveExerciseEdit">Сохранить</button></div>`,'wide-modal');
  m.querySelector('#saveExerciseEdit').onclick=async()=>{const content=m.querySelector('#eeContent').value.trim();if(!content)return toast('Условие не может быть пустым');const tags=[...exerciseSystemTags(x.tags)];if(topic){tags.push(`класс-${topic.grade}`,`тема:${topic.title}`)}for(const tag of m.querySelector('#eeTags').value.split(',').map(v=>v.trim()).filter(Boolean)){if(!tags.includes(tag))tags.push(tag)}const body={kind:m.querySelector('#eeKind').value,title:m.querySelector('#eeTitle').value.trim(),content,answer:m.querySelector('#eeAnswer').value.trim(),difficulty:m.querySelector('#eeDiff').value,category:m.querySelector('#eeCat').value.trim(),tags};const {error}=await sb.from('exercises').update(body).eq('id',x.id);if(error)return fail(error);m.remove();await loadTeacher();if(S.topic)S.topic=S.topics.find(t=>t.id===S.topic.id)||S.topic;onDone?.();toast('Материал обновлён')};
}
async function deleteExerciseRow(x,{onDone}={}){
  if(!confirm(`Удалить «${x.title||'задачу'}»?`))return;
  let error;if(isSeededExercise(x)){({error}=await sb.from('exercises').update({kind:'deleted'}).eq('id',x.id))}else({error}=await sb.from('exercises').delete().eq('id',x.id));
  if(error)return fail(error);await loadTeacher();if(S.topic)S.topic=S.topics.find(t=>t.id===S.topic.id)||S.topic;onDone?.();toast('Удалено')
}
function renderTopics(){
  if(!S.topicGradeFilter){try{S.topicGradeFilter=Number(localStorage.getItem('mathroom.topicGradeFilter'))||Number(S.students?.[0]?.grade)||1}catch{S.topicGradeFilter=Number(S.students?.[0]?.grade)||1}}
  const grade=Math.min(11,Math.max(1,Number(S.topicGradeFilter)||1));
  const gradeTopics=(S.topics||[]).filter(t=>Number(t.grade)===grade).slice().sort(curriculumBank()?.compareTopics||(()=>0));
  const groups=new Map();for(const t of gradeTopics){const tr=topicTrack(t);if(!groups.has(tr))groups.set(tr,[]);groups.get(tr).push(t)}
  const gradeTabs=Array.from({length:11},(_,i)=>i+1).map(g=>`<button class="btn sm ${g===grade?'primary':''}" data-topic-grade="${g}">${g}</button>`).join('');
  const groupsHtml=[...groups.entries()].map(([track,rows])=>`<section class="mr-curriculum-track"><div class="mr-curriculum-track-head"><div><span class="pill">${esc(track)}</span><h2>${grade} класс</h2></div><span class="small muted">${rows.length} тем</span></div><div class="mr-curriculum-list">${rows.map((t,i)=>{const count=S.exercises.filter(e=>e.topic_id===t.id&&e.kind==='task').length,meta=topicMeta(t);return `<article class="mr-curriculum-row ${meta?'':'custom'}" data-topic="${t.id}"><div class="mr-curriculum-step">${meta?String(i+1).padStart(2,'0'):'+'}</div><div class="mr-curriculum-main"><div class="small muted">${esc(t.section||track)}</div><h3>${esc(t.title)}</h3><div class="small">${count} задач${t.theory?` · теория готова`:''}${meta?'':' · своя тема'}</div></div><div class="actions"><button class="btn sm" data-edit-topic="${t.id}">Редактировать</button><button class="btn sm danger" data-delete-topic="${t.id}">Удалить</button><span class="mr-row-arrow">→</span></div></article>`}).join('')}</div></section>`).join('');
  app.innerHTML=shell(`<div class="card mr-curriculum-head"><div><h2>Школьный маршрут</h2><p class="muted">Темы идут в учебной последовательности. В 7–11 классах алгебра и геометрия идут отдельными линиями, чтобы их можно было чередовать по расписанию.</p></div><div class="mr-grade-tabs">${gradeTabs}</div></div>${groupsHtml||'<div class="empty">Для этого класса тем пока нет.</div>'}<details class="form-card mr-topic-create"><summary><b>+ Добавить свою тему</b><span class="small muted">Она появится после готовой школьной последовательности</span></summary><form id="topicForm"><div class="grid cols3"><div class="field"><label>Класс</label><select id="tpGrade">${Array.from({length:11},(_,i)=>`<option ${i+1===grade?'selected':''}>${i+1}</option>`).join('')}</select></div><div class="field"><label>Раздел</label><input id="tpSection" placeholder="Алгебра"></div><div class="field"><label>Тема</label><input id="tpTitle" required placeholder="Квадратные уравнения"></div></div><div class="field"><label>Теория</label><textarea id="tpTheory" rows="6" placeholder="Можно использовать блоки: ## Суть, ## Как действовать, ## Пример, ## Запомни, ## Частая ошибка"></textarea></div><button class="btn primary">Создать тему</button></form></details>`,'Темы',`${grade} класс · последовательная программа`);bindShell();
  document.querySelectorAll('[data-topic-grade]').forEach(b=>b.onclick=()=>{S.topicGradeFilter=Number(b.dataset.topicGrade);try{localStorage.setItem('mathroom.topicGradeFilter',S.topicGradeFilter)}catch{}renderTopics()});
  document.getElementById('topicForm').onsubmit=async e=>{e.preventDefault();const {error}=await sb.from('topics').insert({teacher_id:S.user.id,grade:Number(document.getElementById('tpGrade').value),section:document.getElementById('tpSection').value.trim(),title:document.getElementById('tpTitle').value.trim(),theory:document.getElementById('tpTheory').value});if(error)return fail(error);await loadTeacher();S.topicGradeFilter=Number(document.getElementById('tpGrade').value);renderTopics()};
  document.querySelectorAll('[data-topic]').forEach(x=>x.onclick=e=>{if(e.target.closest('button'))return;S.topic=S.topics.find(t=>t.id===x.dataset.topic);renderTopic()});
  document.querySelectorAll('[data-edit-topic]').forEach(b=>b.onclick=e=>{e.stopPropagation();const t=S.topics.find(x=>x.id===b.dataset.editTopic);if(t)editTopicModal(t)});
  document.querySelectorAll('[data-delete-topic]').forEach(b=>b.onclick=async e=>{e.stopPropagation();const t=S.topics.find(x=>x.id===b.dataset.deleteTopic);if(t)await deleteTopicRow(t)});
}

async function createAssignment(kind,studentId,topicId,count){
  const tasks=shuffle(S.exercises.filter(x=>x.topic_id===topicId&&x.kind==='task'&&x.answer.trim())).slice(0,count);if(!tasks.length)return toast('В теме нет задач с заполненными ответами');
  const t=S.topics.find(x=>x.id===topicId),base={teacher_id:S.user.id,student_id:studentId,topic_id:topicId,title:`${kind==='homework'?'Домашняя работа':'Мини-тест'} · ${t?.title||''}`};
  const table=kind==='homework'?'homeworks':'tests',itemsTable=kind==='homework'?'homework_items':'test_items';
  const {data:parent,error}=await sb.from(table).insert(base).select().single();if(error)return fail(error);
  const rows=tasks.map((x,i)=>({[kind==='homework'?'homework_id':'test_id']:parent.id,prompt:x.content,correct_answer:x.answer,position:i,source_exercise_id:x.id,difficulty:x.difficulty,category:x.category||'',tags:x.tags||[]}));
  const {error:e2}=await sb.from(itemsTable).insert(rows);if(e2)return fail(e2);await loadTeacher();toast(kind==='homework'?'Домашняя назначена':'Тест назначен');
}
function renderTopic(){
  const t=S.topic;if(!t)return renderTopics();const items=S.exercises.filter(x=>x.topic_id===t.id),tasks=items.filter(x=>x.kind==='task'),examples=items.filter(x=>x.kind==='example'),next=nextCurriculumTopic(t),pos=topicPosition(t),sources=textbookLinksForTopic(t.id),curriculumSource=topicSourceMeta(t);
  const studentOpts=S.students.map(s=>`<option value="${s.id}">${esc(s.name)} · ${s.grade} кл.</option>`).join('');
  const examplesHtml=examples.length?examples.map(x=>`<div class="row"><div><h3>${esc(x.title||'Пример')}</h3><div class="prewrap">${nl(x.content)}</div></div><div class="actions"><button class="btn sm" data-edit-material="${x.id}">Редактировать</button><button class="btn sm danger" data-delete-material="${x.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Нет примеров.</div>';
  const tasksHtml=tasks.length?tasks.map(x=>`<div class="row"><div class="row-main"><div class="actions"><span class="pill">${diffLabel(x.difficulty)}</span>${x.category?`<span class="pill">${esc(x.category)}</span>`:''}</div><h3>${esc(x.title||'Задача')}</h3><div class="prewrap">${nl(x.content)}</div><div class="small muted">Ответ: ${esc(x.answer||'—')} · ${exerciseEditableTags(x.tags).map(z=>'#'+esc(z)).join(' ')}</div></div><div class="actions"><button class="btn sm" data-edit-material="${x.id}">Редактировать</button><button class="btn sm danger" data-delete-material="${x.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Задач пока нет.</div>';
  const sourcesHtml=sources.length?sources.map(x=>`<div class="mr-textbook-source"><div><b>${esc(x.textbook.title)}</b>${x.textbook.author?`<span>${esc(x.textbook.author)}</span>`:''}<small>${x.page_from?`стр. ${x.page_from}${x.page_to&&x.page_to!==x.page_from?`–${x.page_to}`:''}`:'страницы не указаны'}${x.note?` · ${esc(x.note)}`:''}</small></div><div class="actions"><button class="btn sm" data-open-source="${x.textbook.id}" data-page="${x.page_from||''}">Открыть PDF</button><button class="btn sm primary" data-board-source="${x.id}">На доску</button><button class="btn sm danger" data-unlink-source="${x.id}">Убрать</button></div></div>`).join(''):'<div class="empty">Учебник к теме пока не привязан.</div>';
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:14px"><button class="btn" id="backTopics">← Темы</button><button class="btn" id="editCurrentTopic">Редактировать тему</button><button class="btn danger" id="deleteCurrentTopic">Удалить тему</button><button class="btn primary" id="startLesson">Начать урок</button><select id="assignStudent" class="search" style="width:auto">${studentOpts}</select><input id="assignCount" class="search" type="number" min="1" max="20" value="5" style="width:80px"><button class="btn" id="makeHw">+ Домашняя</button><button class="btn" id="makeTest">+ Тест</button></div><div class="card mr-topic-hero"><div class="mr-card-head"><div><span class="pill">${t.grade} класс · ${esc(pos.track)}</span>${pos.index?`<span class="pill">тема ${pos.index} из ${pos.total}</span>`:''}<h2>${esc(t.title)}</h2><p class="muted">${esc(t.section||'')}</p></div>${next?`<div class="mr-next-topic-mini"><small>Дальше по программе</small><b>${esc(next.title)}</b><div class="actions"><button class="btn sm" id="openNextTopic">Открыть</button><button class="btn sm primary" id="scheduleNextTopic">В расписание</button></div></div>`:''}</div></div><div class="card mr-theory-card"><div class="mr-card-head"><div><h2>Теория</h2><p class="small muted">Короткий конспект: смысл → алгоритм → пример → что запомнить.</p>${curriculumSource?`<div class="mr-theory-source"><b>Основа конспекта:</b> ${esc(curriculumSource)}</div>`:''}</div><button class="btn sm" id="theoryBoardTopic">На доску</button></div>${theoryHtml(t.theory)}</div><div class="card mr-topic-sources"><div class="mr-card-head"><div><h2>Учебники и источники</h2><p class="small muted">Можно привязать PDF и конкретные страницы к этой теме.</p></div><button class="btn sm" id="linkTextbookTopic">+ Привязать учебник</button></div>${curriculumSource?`<div class="mr-curriculum-source"><span class="pill">Учебный маршрут</span><div><b>${esc(curriculumSource)}</b><small>Конспект адаптирован для Mathroom, а не скопирован из учебника дословно.</small></div></div>`:''}${sourcesHtml}</div><div class="section-title"><h2>Примеры</h2></div><div class="list">${examplesHtml}</div><div class="form-card"><h2>Добавить материал</h2><form id="itemForm"><div class="grid cols3"><div class="field"><label>Тип</label><select id="itKind"><option value="task">Задача</option><option value="example">Пример</option></select></div><div class="field"><label>Сложность</label><select id="itDiff"><option value="basic">Базовая</option><option value="medium">Средняя</option><option value="advanced">Сложная</option></select></div><div class="field"><label>Категория</label><input id="itCat"></div></div><div class="field"><label>Название</label><input id="itTitle"></div><div class="field"><label>Условие</label><textarea id="itContent" rows="4" required></textarea></div><div class="grid cols2"><div class="field"><label>Ответ</label><input id="itAnswer"></div><div class="field"><label>Теги через запятую</label><input id="itTags"></div></div><button class="btn primary">Добавить</button></form></div><div class="section-title"><h2>Задачи · ${tasks.length}</h2></div><div class="list">${tasksHtml}</div>`,'Тема',`${t.grade} класс · ${pos.track}`);bindShell();
  document.getElementById('backTopics').onclick=()=>{S.topic=null;S.view='topics';S.topicGradeFilter=Number(t.grade);renderTeacher()};
  document.getElementById('editCurrentTopic').onclick=()=>editTopicModal(t,{returnToTopic:true});
  document.getElementById('deleteCurrentTopic').onclick=()=>deleteTopicRow(t,{returnToTopics:true});
  document.getElementById('theoryBoardTopic').onclick=()=>{S.view='scratch';renderTeacher();setTimeout(()=>sendTheoryToBoard(S.boardController,t),250)};
  document.getElementById('linkTextbookTopic').onclick=()=>linkTextbookModal({topicId:t.id});
  document.querySelectorAll('[data-open-source]').forEach(b=>b.onclick=()=>{const book=S.textbooks.find(x=>String(x.id)===String(b.dataset.openSource));if(book)openTextbook(book,Number(b.dataset.page)||0)});
  document.querySelectorAll('[data-board-source]').forEach(b=>b.onclick=()=>{const link=sources.find(x=>String(x.id)===String(b.dataset.boardSource));if(link)textbookPagesToBoardModal(link)});
  document.querySelectorAll('[data-unlink-source]').forEach(b=>b.onclick=async()=>{if(!confirm('Убрать привязку учебника к этой теме?'))return;const {error}=await sb.from('textbook_topic_links').delete().eq('id',b.dataset.unlinkSource);if(error)return fail(error);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id)||t;renderTopic()});
  if(next){document.getElementById('openNextTopic').onclick=()=>{S.topic=next;renderTopic()};document.getElementById('scheduleNextTopic').onclick=()=>{S.schedulePrefill={studentId:document.getElementById('assignStudent').value||S.students?.[0]?.id||'',topicId:next.id};S.view='schedule';S.topic=null;renderTeacher()}};
  document.getElementById('itemForm').onsubmit=async e=>{e.preventDefault();const tags=document.getElementById('itTags').value.split(',').map(x=>x.trim()).filter(Boolean);tags.unshift(`тема:${t.title}`);tags.unshift(`класс-${t.grade}`);const {error}=await sb.from('exercises').insert({teacher_id:S.user.id,topic_id:t.id,kind:document.getElementById('itKind').value,title:document.getElementById('itTitle').value.trim(),content:document.getElementById('itContent').value,answer:document.getElementById('itAnswer').value,difficulty:document.getElementById('itDiff').value,category:document.getElementById('itCat').value.trim(),tags:[...new Set(tags)]});if(error)return fail(error);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id);renderTopic()};
  const rerender=()=>{S.topic=S.topics.find(x=>x.id===t.id)||null;S.topic?renderTopic():renderTopics()};
  document.querySelectorAll('[data-edit-material]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(e=>e.id===b.dataset.editMaterial);if(x)editExerciseModal(x,{onDone:rerender})});
  document.querySelectorAll('[data-delete-material]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(e=>e.id===b.dataset.deleteMaterial);if(x)deleteExerciseRow(x,{onDone:rerender})});
  document.getElementById('startLesson').onclick=async()=>{if(!S.students.length)return toast('Сначала добавь ученика');S.selectedStudent=document.getElementById('assignStudent').value||S.students[0].id;await startLesson(null,t.id,S.selectedStudent)};
  document.getElementById('makeHw').onclick=()=>createAssignment('homework',document.getElementById('assignStudent').value,t.id,Number(document.getElementById('assignCount').value));
  document.getElementById('makeTest').onclick=()=>createAssignment('test',document.getElementById('assignStudent').value,t.id,Number(document.getElementById('assignCount').value));
}


function mrFormatBytes(bytes=0){
  const n=Number(bytes)||0;if(n<1024)return `${n} Б`;if(n<1024*1024)return `${(n/1024).toFixed(1)} КБ`;if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} МБ`;return `${(n/1024/1024/1024).toFixed(2)} ГБ`;
}
function mrFormatEta(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '—';const s=Math.ceil(seconds);if(s<60)return `${s} сек`;const m=Math.floor(s/60),r=s%60;if(m<60)return `${m} мин ${r?`${r} сек`:''}`.trim();const h=Math.floor(m/60),rm=m%60;return `${h} ч ${rm} мин`;
}
function textbookTusEndpoint(){
  try{const u=new URL(CFG.SUPABASE_URL);if(u.hostname.endsWith('.supabase.co'))return `https://${u.hostname.replace(/\.supabase\.co$/,'.storage.supabase.co')}/storage/v1/upload/resumable`;}catch{}
  return `${String(CFG.SUPABASE_URL||'').replace(/\/$/,'')}/storage/v1/upload/resumable`;
}
function textbookResumeKey(file){return `mathroom:textbook-upload:${S.user?.id||'teacher'}:${file.name}:${file.size}:${file.lastModified||0}`}
async function uploadTextbookPdf(file,{onProgress=()=>{},onState=()=>{},onController=()=>{}}={}){
  const key=textbookResumeKey(file);
  let path='';try{path=localStorage.getItem(key)||''}catch{}
  if(!path){path=`${S.user.id}/${Date.now()}-${token()}.pdf`;try{localStorage.setItem(key,path)}catch{}}
  const useTus=file.size>6*1024*1024&&window.tus?.Upload;
  if(!useTus){
    onState(window.tus?.Upload?'Загружаем PDF…':'Загружаем обычным способом…');
    onProgress(0,file.size,{mode:'standard'});
    const up=await sb.storage.from('textbooks').upload(path,file,{contentType:'application/pdf',upsert:false,cacheControl:'3600'});
    if(up.error)throw up.error;onProgress(file.size,file.size,{mode:'standard'});try{localStorage.removeItem(key)}catch{};return {path,resumed:false,mode:'standard'};
  }
  const {data:{session},error:sessionError}=await sb.auth.getSession();if(sessionError)throw sessionError;if(!session?.access_token)throw new Error('Сессия истекла. Войди в кабинет ещё раз.');
  onState('Подготавливаем возобновляемую загрузку…');
  return await new Promise((resolve,reject)=>{
    let paused=false,resumed=false,finished=false;
    const upload=new window.tus.Upload(file,{
      endpoint:textbookTusEndpoint(),
      retryDelays:[0,3000,5000,10000,20000],
      headers:{authorization:`Bearer ${session.access_token}`},
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      metadata:{bucketName:'textbooks',objectName:path,contentType:'application/pdf',cacheControl:'3600'},
      chunkSize:6*1024*1024,
      onError(error){if(paused)return;reject(error)},
      onProgress(bytesUploaded,bytesTotal){onProgress(bytesUploaded,bytesTotal,{mode:'tus',resumed})},
      onSuccess(){finished=true;try{localStorage.removeItem(key)}catch{};resolve({path,resumed,mode:'tus',url:upload.url})}
    });
    const controller={
      pause:async()=>{if(finished||paused)return;paused=true;await upload.abort(false);onState('Пауза · прогресс сохранён');},
      resume:()=>{if(finished||!paused)return;paused=false;onState('Продолжаем загрузку…');upload.start()},
      get paused(){return paused}
    };
    onController(controller);
    upload.findPreviousUploads().then(previous=>{
      if(previous?.length){upload.resumeFromPreviousUpload(previous[0]);resumed=true;onState('Найдена незавершённая загрузка · продолжаем с сохранённого места…')}
      else onState('Загружаем PDF частями по 6 МБ…');
      upload.start();
    }).catch(reject);
  });
}


function renderTextbooks(){
  if(!S.textbooksFeatureAvailable){app.innerHTML=shell(`<div class="card mr-textbook-setup"><span class="pill warn">Нужна настройка Supabase</span><h2>Библиотека учебников готова в интерфейсе</h2><p>Чтобы PDF хранились в облаке и открывались на любом устройстве, один раз выполни файл <b>supabase/upgrade-v28.2-textbooks.sql</b> в Supabase SQL Editor.</p><div class="notice">После этого обнови страницу — появится загрузка PDF, привязка к темам и страницы-источники.</div></div>`,'Учебники','PDF-библиотека преподавателя');bindShell();return}
  const books=(S.textbooks||[]),links=S.textbookLinks||[],syncPlan=textbookAutoSyncPlan();
  const syncSummary=books.length?`<div class="card mr-textbook-sync-card"><div><span class="pill">Автопривязка</span><h2>Синхронизировать учебники с темами</h2><p class="muted">Mathroom распознаёт уже загруженные PDF по автору, классу, части и названию, затем связывает их с темами и известными страницами.</p><div class="actions"><span class="pill">Распознано ${syncPlan.recognized.length}/${books.length}</span><span class="pill">Совпадений ${syncPlan.rows.length}</span><span class="pill">Точные страницы ${syncPlan.exactPages}</span><span class="pill">Без страниц ${Math.max(0,syncPlan.rows.length-syncPlan.exactPages)}</span></div></div><div class="actions"><button class="btn primary" id="syncTextbooksTopics">Синхронизировать с темами</button></div></div>`:'';
  const list=books.length?books.map(book=>{const ls=links.filter(x=>String(x.textbook_id)===String(book.id)),meta=window.MathroomTextbookSyncV290?.detectBook?.(book),linked=ls.slice(0,5).map(l=>{const t=S.topics.find(x=>String(x.id)===String(l.topic_id));return t?`<span class="pill">${t.grade} кл. · ${esc(t.title)}${l.page_from?` · с.${l.page_from}${l.page_to&&l.page_to!==l.page_from?`–${l.page_to}`:''}`:''}</span>`:''}).join('');return `<article class="card mr-textbook-card"><div class="mr-card-head"><div><span class="pill">PDF</span>${meta?.recognized?`<span class="pill good">${esc(meta.label)} · ${meta.grade} кл.${meta.part?` · ч.${meta.part}`:''}</span>`:'<span class="pill warn">Нужно уточнить данные</span>'}<h3>${esc(book.title)}</h3><p class="muted">${book.author?esc(book.author)+' · ':''}${esc(book.subject||'Математика')}${book.grade_from?` · ${book.grade_from}${book.grade_to&&book.grade_to!==book.grade_from?`–${book.grade_to}`:''} класс`:''}</p></div><div class="actions"><button class="btn sm primary" data-book-open="${book.id}">Открыть</button><button class="btn sm" data-book-link="${book.id}">Привязать вручную</button><button class="btn sm danger" data-book-delete="${book.id}">Удалить</button></div></div><div class="mr-textbook-links">${linked||'<span class="small muted">Пока не привязан ни к одной теме.</span>'}${ls.length>5?`<span class="small muted">+ ещё ${ls.length-5}</span>`:''}</div></article>`}).join(''):'<div class="empty">Учебников пока нет. Добавь первый PDF выше.</div>';
  app.innerHTML=shell(`${syncSummary}<div class="form-card mr-textbook-upload"><h2>Добавить учебник</h2><form id="textbookForm"><div class="grid cols3"><div class="field"><label>Название</label><input id="tbTitle" required placeholder="Математика. 6 класс"></div><div class="field"><label>Автор</label><input id="tbAuthor" placeholder="Автор / издательство"></div><div class="field"><label>Предмет</label><select id="tbSubject"><option>Математика</option><option>Алгебра</option><option>Геометрия</option></select></div></div><div class="grid cols3"><div class="field"><label>С класса</label><select id="tbFrom">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><div class="field"><label>По класс</label><select id="tbTo">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><div class="field"><label>PDF</label><input id="tbFile" type="file" accept="application/pdf,.pdf" required></div></div><div class="small muted">PDF хранится в закрытом Supabase Storage. Файлы больше 6 МБ загружаются частями и могут продолжиться после обрыва связи.</div><div class="mr-upload-progress" id="tbUploadProgress" hidden><div class="mr-upload-progress-head"><b id="tbUploadState">Подготовка…</b><span id="tbUploadPercent">0%</span></div><div class="mr-upload-track"><i id="tbUploadBar"></i></div><div class="mr-upload-meta"><span id="tbUploadBytes">0 МБ</span><span id="tbUploadSpeed">—</span><span id="tbUploadEta">осталось —</span></div><div class="actions"><button class="btn sm" type="button" id="tbUploadPause" hidden>Пауза</button></div></div><button class="btn primary" id="tbUploadSubmit">Загрузить PDF</button></form></div><div class="section-title"><h2>Моя библиотека · ${books.length}</h2></div><div class="grid cols2">${list}</div>`,'Учебники','PDF автоматически связываются с темами и страницами; ручная привязка остаётся доступна');bindShell();
  document.getElementById('syncTextbooksTopics')?.addEventListener('click',async()=>{
    const btn=document.getElementById('syncTextbooksTopics');btn.disabled=true;btn.textContent='Синхронизируем…';
    try{await syncTextbooksWithTopics();renderTextbooks()}catch(e){fail(e);btn.disabled=false;btn.textContent='Синхронизировать с темами'}
  });
  const tbFile=document.getElementById('tbFile');
  tbFile?.addEventListener('change',()=>{
    const file=tbFile.files?.[0];if(!file)return;
    const detected=window.MathroomTextbooks56V286?.detectFile?.(file.name);
    if(detected){
      const title=document.getElementById('tbTitle'),author=document.getElementById('tbAuthor'),from=document.getElementById('tbFrom'),to=document.getElementById('tbTo'),subject=document.getElementById('tbSubject');
      if(title&&!title.value.trim())title.value=detected.title||`Математика. ${detected.grade} класс${detected.part?`. Часть ${detected.part}`:''}`;
      if(author&&!author.value.trim())author.value=detected.author||'';
      if(from)from.value=String(detected.grade);if(to)to.value=String(detected.grade);if(subject)subject.value=detected.subject||'Математика';
      toast(`Распознано: ${detected.series||'учебник'} · ${detected.grade} класс${detected.part?`, часть ${detected.part}`:''}`);
      return;
    }
    const n=file.name.toLowerCase();let grade=null,part=null;
    let m=n.match(/matematika[_ -]?(\d+)[_ -]?klass.*(?:ch|част)[_ -]?(\d+)/i);
    if(m){grade=Number(m[1]);part=Number(m[2]);}
    if(!grade){m=n.match(/mat(\d)k0?([123])/i);if(m){grade=Number(m[1]);part=Number(m[2]);}}
    if(!grade){m=n.match(/mat(\d+)[-_ ]([123])/i);if(m){grade=Number(m[1]);part=Number(m[2]);}}
    if(!grade){m=n.match(/mat(\d+).*?(?:ch|част)[-_ ]?([123])/i);if(m){grade=Number(m[1]);part=Number(m[2]);}}
    if(grade>=1&&grade<=11){
      const title=document.getElementById('tbTitle'),author=document.getElementById('tbAuthor'),from=document.getElementById('tbFrom'),to=document.getElementById('tbTo'),subject=document.getElementById('tbSubject');
      if(title&&!title.value.trim())title.value=`Математика. ${grade} класс${part?`. Часть ${part}`:''}`;
      if(author&&!author.value.trim())author.value='Л. Г. Петерсон';
      if(from)from.value=String(grade);if(to)to.value=String(grade);if(subject)subject.value='Математика';
      toast(`Распознано: ${grade} класс${part?`, часть ${part}`:''}`);
    }
  });

  document.getElementById('textbookForm').onsubmit=async e=>{
    e.preventDefault();
    const file=document.getElementById('tbFile').files?.[0];if(!file)return toast('Выбери PDF');
    if(file.type&&file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf'))return toast('Нужен файл PDF');
    if(file.size>100*1024*1024)return toast('PDF больше 100 МБ. Лучше сжать файл.');
    const form=e.currentTarget,submit=document.getElementById('tbUploadSubmit'),box=document.getElementById('tbUploadProgress'),bar=document.getElementById('tbUploadBar'),percent=document.getElementById('tbUploadPercent'),bytesEl=document.getElementById('tbUploadBytes'),speedEl=document.getElementById('tbUploadSpeed'),etaEl=document.getElementById('tbUploadEta'),stateEl=document.getElementById('tbUploadState'),pauseBtn=document.getElementById('tbUploadPause');
    box.hidden=false;submit.disabled=true;submit.textContent='Загружаем…';
    let controller=null,lastBytes=null,lastAt=null,speed=0;
    const setState=msg=>{if(stateEl)stateEl.textContent=msg};
    const setProgress=(uploaded,total,meta={})=>{
      const pct=total?Math.max(0,Math.min(100,uploaded/total*100)):0;if(bar)bar.style.width=`${pct}%`;if(percent)percent.textContent=`${pct.toFixed(pct<10?1:0)}%`;if(bytesEl)bytesEl.textContent=`${mrFormatBytes(uploaded)} / ${mrFormatBytes(total)}`;
      const now=performance.now();if(lastBytes!=null&&lastAt!=null&&uploaded>=lastBytes){const dt=(now-lastAt)/1000,delta=uploaded-lastBytes;if(dt>.15&&delta>0){const inst=delta/dt;speed=speed?speed*.72+inst*.28:inst}}lastBytes=uploaded;lastAt=now;
      if(speedEl)speedEl.textContent=speed?`${mrFormatBytes(speed)}/с`:(meta.resumed?'возобновление':'—');if(etaEl)etaEl.textContent=`осталось ${speed?mrFormatEta((total-uploaded)/speed):'—'}`;
    };
    const setController=c=>{controller=c;if(!pauseBtn)return;pauseBtn.hidden=!c;pauseBtn.textContent='Пауза';pauseBtn.onclick=async()=>{if(!controller)return;if(controller.paused){controller.resume();pauseBtn.textContent='Пауза'}else{await controller.pause();pauseBtn.textContent='Продолжить'}}};
    let path='';
    try{
      const uploaded=await uploadTextbookPdf(file,{onProgress:setProgress,onState:setState,onController:setController});path=uploaded.path;
      setState('PDF загружен · сохраняем учебник…');if(pauseBtn)pauseBtn.hidden=true;
      const body={teacher_id:S.user.id,title:document.getElementById('tbTitle').value.trim(),author:document.getElementById('tbAuthor').value.trim(),subject:document.getElementById('tbSubject').value,grade_from:Number(document.getElementById('tbFrom').value),grade_to:Number(document.getElementById('tbTo').value),file_path:path,file_name:file.name,file_size:file.size};
      const {data:createdBook,error}=await sb.from('textbooks').insert(body).select('*').single();if(error){await sb.storage.from('textbooks').remove([path]);throw error}
      setState('PDF загружен · связываем с темами…');await loadTeacher();let autoResult=null;try{autoResult=await syncTextbooksWithTopics({silent:true,bookIds:[createdBook.id]})}catch(syncErr){console.warn('textbook auto sync',syncErr)}
      setState('Готово');if(bar)bar.style.width='100%';if(percent)percent.textContent='100%';renderTextbooks();const linked=autoResult?.created||0;toast(`${uploaded.resumed?'Учебник загружен · загрузка успешно продолжена':'Учебник загружен'}${linked?` · автоматически привязано тем: ${linked}`:''}`);
    }catch(err){console.error(err);setState('Не удалось завершить загрузку');submit.disabled=false;submit.textContent='Продолжить загрузку';if(pauseBtn)pauseBtn.hidden=true;fail(err)}
  };
  document.querySelectorAll('[data-book-open]').forEach(b=>b.onclick=()=>{const book=books.find(x=>String(x.id)===String(b.dataset.bookOpen));if(book)openTextbook(book)});
  document.querySelectorAll('[data-book-link]').forEach(b=>b.onclick=()=>linkTextbookModal({textbookId:b.dataset.bookLink}));
  document.querySelectorAll('[data-book-delete]').forEach(b=>b.onclick=async()=>{const book=books.find(x=>String(x.id)===String(b.dataset.bookDelete));if(!book||!confirm(`Удалить учебник «${book.title}»?`))return;try{await sb.storage.from('textbooks').remove([book.file_path]);const {error}=await sb.from('textbooks').delete().eq('id',book.id);if(error)throw error;await loadTeacher();renderTextbooks();toast('Учебник удалён')}catch(err){fail(err)}});
}


function renderBank(){
  const bank=window.MathroomCurriculumBank,bankTag=bank?.BANK_TAG;
  const isSystemBankTag=z=>String(z).startsWith('mathroom-core-bank-v')||String(z).startsWith('mrseed:');
  const cats=[...new Set(S.exercises.filter(x=>x.kind==='task').map(x=>x.category).filter(Boolean))].sort(),tags=[...new Set(S.exercises.filter(x=>x.kind==='task').flatMap(x=>x.tags||[]).filter(x=>!isSystemBankTag(x)&&!String(x).startsWith('класс-')&&!String(x).startsWith('тема:')))].sort();
  const grades=[...new Set(S.topics.map(x=>Number(x.grade)).filter(Boolean))].sort((a,b)=>a-b),builtIn=(S.exercises||[]).filter(x=>x.kind==='task'&&(x.tags||[]).some(t=>String(t).startsWith('mathroom-core-bank-v'))).length;
  app.innerHTML=shell(`<div class="actions bank-summary" style="margin-bottom:12px"><span class="pill">${S.exercises.filter(x=>x.kind==='task').length} задач</span><span class="pill">${builtIn} из готовой базы</span><button class="btn sm" id="syncCurriculumBank">Обновить базу 1–11</button></div><div class="form-card"><div class="grid cols4"><div class="field"><label>Поиск</label><input id="bankSearch" placeholder="условие, тег, тема..."></div><div class="field"><label>Класс</label><select id="bankGrade"><option value="">Все</option>${grades.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div><div class="field"><label>Сложность</label><select id="bankDiff"><option value="">Все</option><option value="basic">Базовые</option><option value="medium">Средние</option><option value="advanced">Сложные</option></select></div><div class="field"><label>Категория</label><select id="bankCat"><option value="">Все</option>${cats.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div><div class="field" style="margin-top:10px"><label>Тег</label><select id="bankTag"><option value="">Все</option>${tags.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div><div id="bankList"></div>`,'Банк задач','Задачи можно редактировать и удалять');bindShell();
  document.getElementById('syncCurriculumBank').onclick=()=>syncCurriculumBank({manual:true});
  const draw=()=>{const qv=document.getElementById('bankSearch').value.toLowerCase(),g=document.getElementById('bankGrade').value,d=document.getElementById('bankDiff').value,c=document.getElementById('bankCat').value,tag=document.getElementById('bankTag').value;const arr=S.exercises.filter(x=>x.kind==='task').filter(x=>{const t=S.topics.find(z=>z.id===x.topic_id);return(!g||String(t?.grade)===g)&&(!d||x.difficulty===d)&&(!c||x.category===c)&&(!tag||(x.tags||[]).includes(tag))&&(!qv||[x.title,x.content,x.category,t?.title,t?.section,...(x.tags||[])].join(' ').toLowerCase().includes(qv))});document.getElementById('bankList').innerHTML=`<div class="list">${arr.length?arr.map(x=>{const t=S.topics.find(z=>z.id===x.topic_id);const visibleTags=exerciseEditableTags(x.tags);return `<div class="row"><div><div class="actions"><span class="pill">${t?.grade||'?'} кл.</span><span class="pill">${diffLabel(x.difficulty)}</span>${x.category?`<span class="pill">${esc(x.category)}</span>`:''}</div><h3>${esc(x.title||'Задача')}</h3><div class="prewrap">${nl(x.content)}</div><p>${esc(t?.section||'')} · ${esc(t?.title||'')} ${visibleTags.map(z=>'#'+esc(z)).join(' ')} · использована ${x.use_count||0} раз</p></div><div class="actions"><button class="btn sm" data-answer="${x.id}">Ответ</button><button class="btn sm" data-bank-edit="${x.id}">Редактировать</button><button class="btn sm danger" data-bank-delete="${x.id}">Удалить</button></div></div>`}).join(''):'<div class="empty">Ничего не найдено.</div>'}</div>`;document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{const e=S.exercises.find(x=>x.id===b.dataset.answer);modal(`<h2>${esc(e.title||'Ответ')}</h2><div class="notice mono">${esc(e.answer||'Ответ не заполнен')}</div>`)});document.querySelectorAll('[data-bank-edit]').forEach(b=>b.onclick=()=>{const e=S.exercises.find(x=>x.id===b.dataset.bankEdit);if(e)editExerciseModal(e,{onDone:renderBank})});document.querySelectorAll('[data-bank-delete]').forEach(b=>b.onclick=()=>{const e=S.exercises.find(x=>x.id===b.dataset.bankDelete);if(e)deleteExerciseRow(e,{onDone:renderBank})})};
  ['bankSearch','bankGrade','bankDiff','bankCat','bankTag'].forEach(id=>document.getElementById(id).oninput=draw);draw();
}

function renderSchedule(){
  const pre=S.schedulePrefill||{};S.schedulePrefill=null;
  const optsStudents=S.students.map(s=>`<option value="${s.id}" ${String(s.id)===String(pre.studentId||'')?'selected':''}>${esc(s.name)} · ${s.grade} кл.</option>`).join('');
  const sortedTopics=(S.topics||[]).slice().sort(curriculumBank()?.compareTopics||(()=>0));
  const groups=new Map();for(const t of sortedTopics){const key=`${t.grade} класс · ${topicTrack(t)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t)}
  const optsTopics=[...groups.entries()].map(([label,rows])=>`<optgroup label="${esc(label)}">${rows.map(t=>`<option value="${t.id}" ${String(t.id)===String(pre.topicId||'')?'selected':''}>${esc(t.title)}</option>`).join('')}</optgroup>`).join('');
  const suggested=pre.studentId?suggestedTopicForStudent(pre.studentId):null;
  app.innerHTML=shell(`${suggested&&!pre.topicId?`<div class="card mr-schedule-suggestion"><span class="pill">Следующая по программе</span><h3>${esc(suggested.topic.title)}</h3><p class="muted">${suggested.topic.grade} класс · ${esc(topicTrack(suggested.topic))}${suggested.after?` · после «${esc(suggested.after.title)}»`:''}</p><button class="btn sm primary" id="useSuggestedTopic">Выбрать эту тему</button></div>`:''}<div class="form-card"><h2>Добавить урок</h2><form id="lessonForm" class="schedule-form"><div class="field"><label>Ученик</label><select id="lsStudent">${optsStudents}</select></div><div class="field"><label>Тема</label><select id="lsTopic">${optsTopics}</select></div><div class="field"><label>Дата и время</label><input id="lsWhen" type="datetime-local" required></div><div class="field"><label>Минут</label><input id="lsDuration" type="number" value="60" min="15" step="5"></div><button class="btn primary">Добавить</button></form></div><div class="list">${S.lessons.length?S.lessons.map(l=>`<div class="row"><div><h3>${esc(l.students?.name||'')} · ${esc(l.topics?.title||'Без темы')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин · <span class="pill ${statusClass(l.status)}">${statusLabel(l.status)}</span></p></div><div class="actions">${l.status!=='completed'?`<button class="btn sm primary" data-open-lesson="${l.id}">${l.status==='in_progress'?'Продолжить':'Начать'}</button>`:''}<button class="btn sm danger" data-del-lesson="${l.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Уроков пока нет.</div>'}</div>`,'Расписание','Темы отсортированы по школьной последовательности');bindShell();
  document.getElementById('useSuggestedTopic')?.addEventListener('click',()=>{document.getElementById('lsTopic').value=suggested.topic.id});
  document.getElementById('lsStudent')?.addEventListener('change',e=>{const sug=suggestedTopicForStudent(e.target.value);if(sug)document.getElementById('lsTopic').value=sug.topic.id});
  document.getElementById('lessonForm').onsubmit=async e=>{e.preventDefault();if(!document.getElementById('lsStudent').value||!document.getElementById('lsTopic').value)return toast('Добавь ученика и тему');const {error}=await sb.from('lessons').insert({teacher_id:S.user.id,student_id:document.getElementById('lsStudent').value,topic_id:document.getElementById('lsTopic').value,scheduled_at:new Date(document.getElementById('lsWhen').value).toISOString(),duration_minutes:Number(document.getElementById('lsDuration').value)});if(error)return fail(error);await loadTeacher();renderSchedule()};
  document.querySelectorAll('[data-open-lesson]').forEach(b=>b.onclick=async()=>startLesson(S.lessons.find(x=>x.id===b.dataset.openLesson)));
  document.querySelectorAll('[data-del-lesson]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить урок?'))return;await sb.from('lessons').delete().eq('id',b.dataset.delLesson);await loadTeacher();renderSchedule()});
}


async function openTeacherAssignment(kind,id){
  const table=kind==='homework'?'homeworks':'tests',itemsTable=kind==='homework'?'homework_items':'test_items',fk=kind==='homework'?'homework_id':'test_id';
  const parent=(kind==='homework'?S.homeworks:S.tests).find(x=>x.id===id);if(!parent)return toast('Задание не найдено');
  const {data:items,error}=await sb.from(itemsTable).select('*').eq(fk,id).order('position');if(error)return fail(error);
  if(kind!=='homework'){
    const html=`<h2>${esc(parent.title)}</h2><p class="muted">${esc(parent.students?.name||'')} · ${esc(parent.topics?.title||'')} · ${statusLabel(parent.status)}${parent.score!=null?` · ${parent.score}%`:''}</p><div class="answers">${(items||[]).map((x,i)=>`<div class="answer-item ${x.is_correct===true?'correct':x.is_correct===false?'wrong':''}"><b>${i+1}. ${esc(x.prompt)}</b><div class="small">Ответ ученика: <b>${esc(x.student_answer||'—')}</b></div><div class="small muted">Правильный: ${esc(x.correct_answer||'—')}</div></div>`).join('')}</div>`;
    modal(html);return;
  }
  const {data:attempts,error:attemptErr}=await sb.from('homework_attempts').select('id,attempt_no,auto_score,final_score,submitted_at,reviewed_at').eq('homework_id',id).order('attempt_no',{ascending:false});if(attemptErr)return fail(attemptErr);
  const due=parent.due_at?new Date(parent.due_at):null,last=parent.last_attempt_at||parent.submitted_at;const late=!!(due&&last&&new Date(last)>due);const revision=parent.status==='assigned'&&!!parent.revision_requested_at;
  const itemHtml=(items||[]).map((x,i)=>`<div class="answer-item mr-review-answer ${x.is_correct===true?'correct':x.is_correct===false?'wrong':''}" data-review-item="${x.id}"><div class="mr-review-answer-head"><b>${i+1}. ${esc(x.prompt)}</b><select data-review-correct="${x.id}"><option value="true" ${x.is_correct===true?'selected':''}>✓ Верно</option><option value="false" ${x.is_correct===false?'selected':''}>✕ Ошибка</option></select></div><div class="grid cols2"><div class="small">Ответ ученика: <b>${esc(x.student_answer||'—')}</b></div><div class="small muted">Правильный: <b>${esc(x.correct_answer||'—')}</b></div></div><div class="field"><label>Подсказка / комментарий к задаче</label><input data-review-feedback="${x.id}" value="${esc(x.teacher_feedback||'')}" placeholder="Например: проверь знак перед b"></div></div>`).join('');
  const attemptsHtml=(attempts||[]).length?`<div class="mr-attempt-list">${attempts.map(x=>`<div><b>Попытка ${x.attempt_no}</b><span>${new Date(x.submitted_at).toLocaleString('ru-RU')}</span><span>${x.final_score??x.auto_score}%${x.reviewed_at?' · проверено':''}</span></div>`).join('')}</div>`:'<div class="small muted">Попыток пока нет.</div>';
  const html=`<div class="mr-card-head"><div><h2>${esc(parent.title)}</h2><p class="muted">${esc(parent.students?.name||'')} · ${esc(parent.topics?.title||'')} · ${statusLabel(parent.status)}</p></div><div class="actions"><span class="pill">${parent.attempt_count||0} попыт.</span>${late?'<span class="pill warn">сдано после срока</span>':''}${revision?'<span class="pill warn">доработка</span>':''}</div></div>${revision&&parent.revision_message?`<div class="notice warn"><b>Возвращено на доработку</b><br>${nl(parent.revision_message)}</div>`:''}<div class="answers">${itemHtml}</div><div class="grid cols2"><div class="field"><label>Общий комментарий ученику</label><textarea id="reviewComment">${esc(parent.comment||'')}</textarea></div><div class="field"><label>Что исправить, если вернуть на доработку</label><textarea id="revisionMessage" placeholder="Коротко перечисли, что нужно исправить">${esc(parent.revision_message||'')}</textarea></div></div><div class="actions mr-review-actions">${parent.status==='submitted'?'<button class="btn primary" id="acceptHomework">✓ Принять работу</button><button class="btn" id="returnHomework">↩ Вернуть на доработку</button>':'<button class="btn primary" id="saveHomeworkReview">Сохранить комментарии</button>'}${(parent.status==='assigned'&&parent.due_at)||(revision)?'<button class="btn" id="copyHomeworkReminder">Скопировать напоминание</button>':''}</div><div class="hr"></div><h3>История попыток</h3>${attemptsHtml}`;
  const m=modal(html,'wide-modal');
  const readItems=()=> (items||[]).map(x=>({id:x.id,is_correct:m.querySelector(`[data-review-correct="${x.id}"]`)?.value==='true',teacher_feedback:m.querySelector(`[data-review-feedback="${x.id}"]`)?.value.trim()||''}));
  const saveItems=async()=>{for(const x of readItems()){const {error:e}=await sb.from('homework_items').update({is_correct:x.is_correct,teacher_feedback:x.teacher_feedback}).eq('id',x.id);if(e)throw e}};
  const calcScore=()=>{const rr=readItems();return rr.length?Math.round(rr.filter(x=>x.is_correct).length*1000/rr.length)/10:0};
  const refresh=async(msg)=>{m.remove();await loadTeacher();renderAssignments();toast(msg)};
  m.querySelector('#acceptHomework')?.addEventListener('click',async()=>{try{await saveItems();const score=calcScore(),now=new Date().toISOString();const {error:e}=await sb.from('homeworks').update({comment:m.querySelector('#reviewComment').value.trim(),status:'reviewed',score,reviewed_at:now,revision_requested_at:null,revision_message:''}).eq('id',id);if(e)throw e;const latest=(attempts||[])[0];if(latest)await sb.from('homework_attempts').update({final_score:score,reviewed_at:now}).eq('id',latest.id);await refresh('Домашняя принята') }catch(e){fail(e)}});
  m.querySelector('#returnHomework')?.addEventListener('click',async()=>{try{await saveItems();const message=m.querySelector('#revisionMessage').value.trim()||'Исправь отмеченные задания и отправь работу ещё раз.';const {error:e}=await sb.from('homeworks').update({comment:m.querySelector('#reviewComment').value.trim(),status:'assigned',score:null,reviewed_at:null,revision_requested_at:new Date().toISOString(),revision_message:message}).eq('id',id);if(e)throw e;await refresh('Работа возвращена на доработку')}catch(e){fail(e)}});
  m.querySelector('#saveHomeworkReview')?.addEventListener('click',async()=>{try{await saveItems();const score=parent.status==='reviewed'?calcScore():parent.score;const {error:e}=await sb.from('homeworks').update({comment:m.querySelector('#reviewComment').value.trim(),revision_message:m.querySelector('#revisionMessage').value.trim(),score}).eq('id',id);if(e)throw e;await refresh('Комментарии сохранены')}catch(e){fail(e)}});
  m.querySelector('#copyHomeworkReminder')?.addEventListener('click',async()=>{const name=parent.students?.name||'ученик';const when=parent.due_at?new Date(parent.due_at).toLocaleString('ru-RU'):'без указанного срока';const extra=revision?(m.querySelector('#revisionMessage').value.trim()||parent.revision_message||'Нужно исправить отмеченные задания.'):'';await copyText(`Привет, ${name}! Напоминаю про «${parent.title}». ${revision?`Нужна доработка: ${extra}`:`Срок: ${when}.`} Если что-то не получается — напиши.`);toast('Напоминание скопировано')});
}
function renderAssignments(){
  const h=S.homeworks.map(x=>({...x,kind:'homework'})),t=S.tests.map(x=>({...x,kind:'test'})),all=[...h,...t].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));const now=Date.now();
  const submitted=h.filter(x=>x.status==='submitted'),revision=h.filter(x=>x.status==='assigned'&&x.revision_requested_at),overdue=h.filter(x=>x.status==='assigned'&&!x.revision_requested_at&&x.due_at&&new Date(x.due_at).getTime()<now),reviewed=h.filter(x=>x.status==='reviewed');
  app.innerHTML=shell(`<div class="grid cols4 assignment-metrics"><div class="card"><div class="muted">На проверке</div><div class="metric">${submitted.length}</div></div><div class="card"><div class="muted">На доработке</div><div class="metric">${revision.length}</div></div><div class="card"><div class="muted">Просрочено</div><div class="metric">${overdue.length}</div></div><div class="card"><div class="muted">Проверено ДЗ</div><div class="metric">${reviewed.length}</div></div></div><div class="actions assignment-filterbar" style="margin:16px 0"><button class="btn sm primary" data-af="all">Все</button><button class="btn sm" data-af="submitted">На проверке</button><button class="btn sm" data-af="revision">Доработка</button><button class="btn sm" data-af="overdue">Просрочено</button><button class="btn sm" data-af="reviewed">Проверено</button></div><div id="assignmentList"></div>`,'Задания','Ответы учеников, попытки и цикл доработки');bindShell();
  const draw=(filter='all')=>{let arr=all;if(filter==='submitted')arr=submitted;if(filter==='revision')arr=revision;if(filter==='overdue')arr=overdue;if(filter==='reviewed')arr=reviewed;document.getElementById('assignmentList').innerHTML=`<div class="list">${arr.length?arr.map(x=>{const rev=x.kind==='homework'&&x.status==='assigned'&&x.revision_requested_at;const isOver=x.kind==='homework'&&x.status==='assigned'&&!rev&&x.due_at&&new Date(x.due_at).getTime()<now;return `<div class="row assignment"><div><h3>${x.kind==='homework'?'Домашняя':x.source==='diagnostic'?'Диагностика':'Тест'} · ${esc(x.title)}</h3><p>${esc(x.students?.name||'')} · ${esc(x.topics?.title||'')} · ${dateShort(x.created_at)}${x.kind==='homework'&&x.due_at?` · срок ${new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:''}</p><span class="pill ${statusClass(x.status)}">${statusLabel(x.status)}</span>${x.score!=null?` <span class="pill">${x.score}%</span>`:''}${x.kind==='homework'&&x.source==='smart_review'?` <span class="pill">умное ДЗ</span>`:''}${rev?' <span class="pill warn">доработка</span>':''}${isOver?' <span class="pill warn">просрочено</span>':''}${x.kind==='homework'&&x.attempt_count?` <span class="pill">${x.attempt_count} попыт.</span>`:''}</div><button class="btn sm ${x.status==='submitted'?'primary':''}" data-assignment="${x.kind}:${x.id}">${x.status==='submitted'?'Проверить':'Открыть'}</button></div>`}).join(''):'<div class="empty">В этом разделе заданий нет.</div>'}</div>`;document.querySelectorAll('[data-assignment]').forEach(b=>b.onclick=()=>{const[k,id]=b.dataset.assignment.split(':');openTeacherAssignment(k,id)})};
  document.querySelectorAll('[data-af]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-af]').forEach(x=>x.classList.remove('primary'));b.classList.add('primary');draw(b.dataset.af)});draw();
}

async function saveSnapshot(lesson,title='Итог урока',note=''){
  if(S.boardController?.save) await S.boardController.save();
  const {data:pages,error}=await sb.from('board_pages').select('id,title,sort_order,elements').eq('student_id',lesson.student_id).order('sort_order');if(error)throw error;
  const {error:e2}=await sb.from('lesson_board_versions').insert({teacher_id:S.user.id,lesson_id:lesson.id,title,note,pages:pages||[]});if(e2)throw e2;
}
async function deleteCompletedLessonHistory(id,{ask=true}={}){
  const lesson=S.lessons.find(x=>x.id===id&&x.status==='completed');if(!lesson)return;
  if(ask&&!confirm(`Удалить занятие «${lesson.topics?.title||'Без темы'}» из истории?\n\nБудут удалены запись завершённого урока и сохранённые версии его доски. Это действие нельзя отменить.`))return;
  const vr=await sb.from('lesson_board_versions').delete().eq('lesson_id',id);if(vr.error)throw vr.error;
  const lr=await sb.from('lessons').delete().eq('id',id);if(lr.error)throw lr.error;
}
async function clearCompletedLessonHistory(){
  const ids=S.lessons.filter(x=>x.status==='completed').map(x=>x.id);if(!ids.length)return toast('История уже пустая');
  if(!confirm(`Очистить всю историю занятий (${ids.length})?\n\nЗавершённые уроки и их сохранённые версии доски будут удалены без возможности восстановления.`))return;
  try{const vr=await sb.from('lesson_board_versions').delete().in('lesson_id',ids);if(vr.error)throw vr.error;const lr=await sb.from('lessons').delete().in('id',ids);if(lr.error)throw lr.error;await loadTeacher();renderHistory();toast('История занятий очищена')}catch(e){fail(e)}
}
function renderHistory(){
  const all=S.lessons.filter(x=>x.status==='completed').sort((a,b)=>String(b.completed_at||b.created_at).localeCompare(String(a.completed_at||a.created_at)));
  const top=all.length?`<div class="history-tools card"><div><span class="koto-eyebrow">АРХИВ</span><h2>История занятий</h2><p class="muted">${all.length} завершён${all.length===1?'ное занятие':all.length<5?'ных занятия':'ных занятий'} · поиск по ученику, теме и заметкам.</p></div><button class="btn danger" id="clearLessonHistory">Очистить историю</button></div><div class="history-search-wrap"><input class="search" id="lessonHistorySearch" placeholder="Поиск: ученик, тема, итог, домашняя работа…"></div>`:'';
  const rows=all.length?all.map(l=>{const q=[l.students?.name,l.topics?.title,l.public_summary,l.homework_plan,l.private_notes,dateLong(l.completed_at||l.started_at)].filter(Boolean).join(' ').toLowerCase();return `<div class="row history-row" data-history-search="${esc(q)}"><div><div class="actions"><span class="pill koto-pill">Завершено</span><span class="small muted">${dateLong(l.completed_at||l.started_at)}</span></div><h3>${esc(l.students?.name||'')} · ${esc(l.topics?.title||'')}</h3>${l.public_summary?`<p>${esc(l.public_summary.slice(0,150))}</p>`:''}</div><div class="actions"><button class="btn sm" data-history="${l.id}">Открыть</button><button class="btn sm danger" data-history-delete="${l.id}" title="Удалить занятие из истории">Удалить</button></div></div>`}).join(''):'<div class="empty">История чистая. Завершённые занятия появятся здесь.</div>';
  app.innerHTML=shell(`${top}<div class="list history-list" id="lessonHistoryList">${rows}</div><div class="empty hidden" id="historySearchEmpty">Ничего не найдено.</div>`,'История уроков','Итоги, заметки и сохранённые версии доски');bindShell();
  document.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openHistoryLesson(b.dataset.history));document.querySelectorAll('[data-history-delete]').forEach(b=>b.onclick=async()=>{try{await deleteCompletedLessonHistory(b.dataset.historyDelete);await loadTeacher();renderHistory();toast('Занятие удалено из истории')}catch(e){fail(e)}});document.getElementById('clearLessonHistory')?.addEventListener('click',clearCompletedLessonHistory);
  const search=document.getElementById('lessonHistorySearch');if(search)search.oninput=()=>{const q=search.value.trim().toLowerCase();let visible=0;document.querySelectorAll('[data-history-search]').forEach(r=>{const ok=!q||r.dataset.historySearch.includes(q);r.classList.toggle('hidden',!ok);if(ok)visible++});document.getElementById('historySearchEmpty')?.classList.toggle('hidden',visible>0)};
}
async function openHistoryLesson(id){
  const l=S.lessons.find(x=>x.id===id),versions=S.versions.filter(x=>x.lesson_id===id);if(!l)return toast('Урок уже удалён');const m=modal(`<div class="mr-card-head"><div><span class="koto-eyebrow">ЗАВЕРШЁННЫЙ УРОК</span><h2>${esc(l.students?.name||'')} · ${esc(l.topics?.title||'')}</h2></div><button class="btn sm danger" id="deleteHistoryLesson">Удалить из истории</button></div><div class="grid cols2"><div class="notice"><b>Итоги ученику</b><div class="prewrap">${nl(l.public_summary||'—')}</div></div><div class="notice"><b>К следующему уроку</b><div class="prewrap">${nl(l.homework_plan||'—')}</div></div></div><div class="notice"><b>Приватные заметки</b><div class="prewrap">${nl(l.private_notes||'—')}</div></div><h3>Версии доски</h3><div class="list">${versions.length?versions.map(v=>`<div class="row"><div><b>${esc(v.title)}</b><div class="small muted">${dateLong(v.created_at)}${v.note?' · '+esc(v.note):''}</div></div><button class="btn sm" data-version="${v.id}">Открыть</button></div>`).join(''):'<div class="empty">Версий доски нет.</div>'}</div>`,'wide-modal');
  m.querySelectorAll('[data-version]').forEach(b=>b.onclick=()=>{const v=versions.find(x=>x.id===b.dataset.version);m.remove();const x=modal(`<h2>${esc(v.title)}</h2><p class="muted">${esc(v.note||'Сохранённая версия')}</p><div id="snapshotRoot"></div>`,'snapshot-modal');mountSnapshot(x.querySelector('#snapshotRoot'),v.pages||[])});
  m.querySelector('#deleteHistoryLesson')?.addEventListener('click',async()=>{try{await deleteCompletedLessonHistory(id);m.remove();await loadTeacher();renderHistory();toast('Занятие удалено из истории')}catch(e){fail(e)}});
}

async function startLesson(existing=null,topicId=null,studentId=null){
  let l=existing;
  if(!l){const sid=studentId||S.selectedStudent||S.students[0]?.id,tid=topicId||S.topic?.id||S.topics[0]?.id;if(!sid||!tid)return toast('Нужны ученик и тема');const {data,error}=await sb.from('lessons').insert({teacher_id:S.user.id,student_id:sid,topic_id:tid,status:'in_progress',started_at:new Date().toISOString()}).select('*,students(name,grade),topics(title)').single();if(error)return fail(error);l=data;await loadTeacher();}
  else if(l.status!=='in_progress'){const {data,error}=await sb.from('lessons').update({status:'in_progress',started_at:l.started_at||new Date().toISOString()}).eq('id',l.id).select('*,students(name,grade),topics(title)').single();if(error)return fail(error);l=data;await loadTeacher()}
  S.activeLesson=l;S.selectedStudent=l.student_id;S.topic=S.topics.find(x=>x.id===l.topic_id)||S.topic;S.view='lesson';rememberActiveLesson(l.id);renderTeacher();
}
async function ensureLiveState(lesson){
  const {data,error}=await sb.from('lesson_live_state').upsert({lesson_id:lesson.id,teacher_id:S.user.id,student_id:lesson.student_id},{onConflict:'lesson_id'}).select().single();if(error)throw error;return data;
}
function elapsedSeconds(live){let n=live?.timer_elapsed_seconds||0;if(live?.timer_running&&live.timer_started_at)n+=Math.max(0,Math.floor((Date.now()-new Date(live.timer_started_at).getTime())/1000));return n}
function fmtTime(s){s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
async function renderLesson(){
  const lesson=S.activeLesson||S.lessons.find(x=>x.status==='in_progress'&&x.student_id===S.selectedStudent&&x.topic_id===S.topic?.id);if(!lesson){S.view='dashboard';return renderTeacher()}
  S.activeLesson=lesson;const st=S.students.find(x=>x.id===lesson.student_id),t=S.topics.find(x=>x.id===lesson.topic_id);if(!st||!t){S.view='dashboard';return renderTeacher()}
  const [{data:queue,error:qErr},live]=await Promise.all([sb.from('lesson_queue_items').select('*').eq('lesson_id',lesson.id).order('position'),ensureLiveState(lesson)]);if(qErr)return fail(qErr);
  const items=S.exercises.filter(x=>x.topic_id===t.id),tasks=items.filter(x=>x.kind==='task'),examples=items.filter(x=>x.kind==='example'),lessonSources=textbookLinksForTopic(t.id);let liveState=live,current=(queue||[]).find(x=>x.id===liveState.current_queue_item_id)||null;
  const lessonSourcesHtml=lessonSources.length?`<h3>Учебник</h3>${lessonSources.map(x=>`<div class="item-box mr-lesson-textbook"><div><b>${esc(x.textbook.title)}</b><div class="small muted">${x.page_from?`стр. ${x.page_from}${x.page_to&&x.page_to!==x.page_from?`–${x.page_to}`:''}`:'страницы не указаны'}${x.note?` · ${esc(x.note)}`:''}</div></div><div class="actions"><button class="btn sm" data-lesson-source-open="${x.id}">Открыть PDF</button><button class="btn sm primary" data-lesson-source-board="${x.id}">На доску</button></div></div>`).join('')}`:'';
  const queueHtml=(queue||[]).length?(queue||[]).map((x,i)=>`<div class="lesson-queue-row ${current?.id===x.id?'current':''} status-${x.status}"><button class="queue-select" data-current="${x.id}"><span class="queue-status">${x.status==='solved'?'✓':x.status==='hard'?'!':x.status==='later'?'↩':'○'}</span><span><b>${i+1}. ${esc(x.title||'Задача')}</b><small>${esc(x.prompt)}</small></span></button><button class="icon-btn" data-remove-queue="${x.id}">×</button></div>`).join(''):'<div class="small muted">Очередь пока пустая.</div>';
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:12px"><button class="btn" id="leaveLesson">← Кабинет</button><button class="btn" id="copyLessonLink">Ссылка ученика</button><button class="btn" id="saveVersion">Сохранить версию доски</button><button class="btn primary" id="completeLesson">Завершить урок</button></div><div class="lesson-live-card" id="lessonControl"><div class="lesson-live-top"><div class="lesson-timer-block"><span class="muted">Время урока</span><span class="lesson-timer" id="lessonTimer">${fmtTime(elapsedSeconds(liveState))}</span></div><div class="actions"><button class="btn sm" id="timerToggle">${liveState.timer_running?'Пауза':'Начать урок'}</button><button class="btn sm" id="timerReset">Сброс</button><button class="btn sm ${liveState.focus_enabled?'active':''}" id="focusToggle">Фокус ученика: ${liveState.focus_enabled?'вкл':'выкл'}</button></div></div><div class="lesson-current-task"><div class="lesson-task-kicker">Текущая задача</div>${current?`<h3>${esc(current.title)}</h3><div class="lesson-task-prompt">${nl(current.prompt)}</div><div class="small muted lesson-answer">Ответ: ${esc(current.correct_answer||'—')}</div>`:'<div class="muted">Выбери задачу из очереди.</div>'}</div>${current?`<div class="lesson-task-status-actions"><button class="btn sm ${current.status==='solved'?'active':''}" data-status="solved">✓ Решено</button><button class="btn sm ${current.status==='hard'?'warn':''}" data-status="hard">⚠ Сложно</button><button class="btn sm ${current.status==='later'?'active':''}" data-status="later">↩ Вернуться позже</button><button class="btn sm" id="currentToBoard">На доску</button><button class="btn sm" id="currentToHomework">→ В домашнюю</button>${current.homework_added?'<span class="small homework-added">✓ Уже в домашней</span>':''}</div>`:''}<details class="lesson-queue" open><summary><b>Очередь на сегодня</b><span class="pill">${(queue||[]).length}</span></summary><div class="lesson-queue-list">${queueHtml}</div></details></div><div class="lesson-cloud-layout" style="margin-top:12px"><div class="lesson-cloud-material"><div class="card"><span class="pill">${t.grade} класс · ${esc(t.section)}</span><h2>${esc(t.title)}</h2>${theoryHtml(t.theory)}<button class="btn sm" id="theoryBoard">Теорию на доску</button></div>${lessonSourcesHtml}<h3>Примеры</h3>${examples.map(x=>`<div class="item-box"><b>${esc(x.title||'Пример')}</b><div class="prewrap">${nl(x.content)}</div><button class="btn sm" data-to-board="${x.id}">На доску</button></div>`).join('')||'<div class="muted">Нет примеров</div>'}<h3>Задачи</h3>${tasks.map(x=>`<div class="item-box"><div class="actions" style="justify-content:space-between"><b>${esc(x.title||'Задача')}</b><span class="pill">${diffLabel(x.difficulty)}</span></div><div class="prewrap">${nl(x.content)}</div><div class="actions"><button class="btn sm" data-queue-task="${x.id}">+ В очередь</button><button class="btn sm" data-focus-task="${x.id}">В фокус</button><button class="btn sm" data-to-board="${x.id}">На доску</button></div></div>`).join('')||'<div class="muted">Нет задач</div>'}</div><div><div id="lessonBoard"></div></div></div>`,'Урок',`${st.name} · ${t.title}`);bindShell();
  let ctrl=await mountBoard(document.getElementById('lessonBoard'),st.id,true,{lessonId:lesson.id,studentName:st.name});S.boardController=ctrl;
  const updateLive=async patch=>{const {data,error}=await sb.from('lesson_live_state').update({...patch,updated_at:new Date().toISOString()}).eq('lesson_id',lesson.id).select().single();if(error)return fail(error);liveState=data;};
  const setCurrent=async q=>{await updateLive({current_queue_item_id:q?.id||null,current_title:q?.title||'',current_prompt:q?.prompt||'',current_position:q?.position||0});renderLesson()};
  const addQueue=async(exercise,makeCurrent=false)=>{const existing=(queue||[]).find(x=>x.exercise_id===exercise.id);let q=existing;if(!q){const {data,error}=await sb.from('lesson_queue_items').insert({teacher_id:S.user.id,lesson_id:lesson.id,exercise_id:exercise.id,title:exercise.title||'Задача',prompt:exercise.content,correct_answer:exercise.answer,difficulty:exercise.difficulty,category:exercise.category||'',tags:exercise.tags||[],position:(queue||[]).length}).select().single();if(error)return fail(error);q=data}if(makeCurrent)await setCurrent(q);else{toast('Добавлено в очередь');renderLesson()}};
  document.getElementById('leaveLesson').onclick=()=>{forgetActiveLesson();S.activeLesson=null;S.view='dashboard';renderTeacher()};document.getElementById('copyLessonLink').onclick=async()=>{await copyText(studentLink(st));toast('Ссылка скопирована')};document.getElementById('theoryBoard').onclick=()=>sendTheoryToBoard(ctrl,t);
  document.querySelectorAll('[data-lesson-source-open]').forEach(b=>b.onclick=()=>{const link=lessonSources.find(x=>String(x.id)===String(b.dataset.lessonSourceOpen));if(link?.textbook)openTextbook(link.textbook,Number(link.page_from)||0)});
  document.querySelectorAll('[data-lesson-source-board]').forEach(b=>b.onclick=()=>{const link=lessonSources.find(x=>String(x.id)===String(b.dataset.lessonSourceBoard));if(link)textbookPagesToBoardModal(link,{controller:ctrl})});
  document.querySelectorAll('[data-to-board]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(z=>z.id===b.dataset.toBoard);ctrl.addText(`${x.title||'Задача'}\n${x.content}`,{fontSize:25});sb.from('exercises').update({use_count:(x.use_count||0)+1,last_used_at:new Date().toISOString()}).eq('id',x.id).then(()=>{})});
  document.querySelectorAll('[data-queue-task]').forEach(b=>b.onclick=()=>addQueue(S.exercises.find(x=>x.id===b.dataset.queueTask),false));document.querySelectorAll('[data-focus-task]').forEach(b=>b.onclick=()=>addQueue(S.exercises.find(x=>x.id===b.dataset.focusTask),true));
  document.querySelectorAll('[data-current]').forEach(b=>b.onclick=()=>setCurrent((queue||[]).find(x=>x.id===b.dataset.current)));document.querySelectorAll('[data-remove-queue]').forEach(b=>b.onclick=async()=>{await sb.from('lesson_queue_items').delete().eq('id',b.dataset.removeQueue);if(liveState.current_queue_item_id===b.dataset.removeQueue)await updateLive({current_queue_item_id:null,current_title:'',current_prompt:''});renderLesson()});
  document.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{if(!current)return;await sb.from('lesson_queue_items').update({status:b.dataset.status}).eq('id',current.id);renderLesson()});
  if(current){document.getElementById('currentToBoard').onclick=()=>ctrl.addText(`${current.title}\n${current.prompt}`,{fontSize:25});document.getElementById('currentToHomework').onclick=async()=>{let hw=S.homeworks.find(x=>x.lesson_id===lesson.id&&x.status==='assigned');if(!hw){const {data,error}=await sb.from('homeworks').insert({teacher_id:S.user.id,student_id:st.id,topic_id:t.id,lesson_id:lesson.id,title:`Домашняя после урока · ${t.title}`}).select().single();if(error)return fail(error);hw=data}const {data:dup}=await sb.from('homework_items').select('id').eq('homework_id',hw.id).eq('source_queue_item_id',current.id).maybeSingle();if(!dup){const {error}=await sb.from('homework_items').insert({homework_id:hw.id,prompt:current.prompt,correct_answer:current.correct_answer,position:999,source_exercise_id:current.exercise_id,source_queue_item_id:current.id,difficulty:current.difficulty,category:current.category,tags:current.tags||[]});if(error)return fail(error)}await sb.from('lesson_queue_items').update({homework_added:true}).eq('id',current.id);await loadTeacher();renderLesson();toast('Добавлено в домашнюю')}}
  document.getElementById('focusToggle').onclick=async()=>{const next=!liveState.focus_enabled;await updateLive({focus_enabled:next});const b=document.getElementById('focusToggle');if(b){b.textContent=`Фокус ученика: ${next?'вкл':'выкл'}`;b.classList.toggle('active',next)}toast(next?'Фокус включён только у ученика':'Фокус ученика выключен')};document.getElementById('timerToggle').onclick=async()=>{const b=document.getElementById('timerToggle');if(liveState.timer_running){const e=elapsedSeconds(liveState);await updateLive({timer_running:false,timer_started_at:null,timer_elapsed_seconds:e});if(b)b.textContent='Начать урок'}else{await updateLive({timer_running:true,timer_started_at:new Date().toISOString()});if(b)b.textContent='Пауза'}};document.getElementById('timerReset').onclick=async()=>{await updateLive({timer_running:false,timer_started_at:null,timer_elapsed_seconds:0});const b=document.getElementById('timerToggle');if(b)b.textContent='Начать урок';const el=document.getElementById('lessonTimer');if(el)el.textContent='00:00'};
  const interval=setInterval(()=>{const el=document.getElementById('lessonTimer');if(el)el.textContent=fmtTime(elapsedSeconds(liveState))},1000);S.liveCleanup=()=>clearInterval(interval);
  document.getElementById('saveVersion').onclick=async()=>{const title=prompt('Название версии:',`Версия · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`);if(title===null)return;const note=prompt('Заметка к версии:','')||'';try{await saveSnapshot(lesson,title||'Версия доски',note);await loadTeacher();toast('Версия сохранена')}catch(e){fail(e)}};
  document.getElementById('completeLesson').onclick=()=>completeLesson(lesson,queue||[],liveState);
}
function queueStats(queue){
  const counts={solved:0,hard:0,later:0,pending:0,total:queue.length,hw:0},categories={},tags={};
  const add=(map,key,status)=>{if(!key)return;const a=map[key]??={total:0,solved:0,hard:0,later:0,pending:0};a.total++;a[status]=(a[status]||0)+1};
  for(const q of queue){const st=['solved','hard','later'].includes(q.status)?q.status:'pending';counts[st]++;if(q.homework_added)counts.hw++;add(categories,q.category||'Без категории',st);for(const t of q.tags||[])add(tags,t,st)}
  return {counts,categories,tags};
}
function insightText(stats,type='focus'){
  const rows=Object.entries(stats||{}).map(([name,v])=>{const reviewed=(v.solved||0)+(v.hard||0)+(v.later||0);return{name,v,reviewed,confidence:reviewed?Math.round((v.solved||0)*100/reviewed):0,attention:(v.hard||0)+(v.later||0)}}).filter(x=>x.reviewed>0);
  if(type==='strength')return rows.filter(x=>x.v.solved>0).sort((a,b)=>b.confidence-a.confidence||b.v.solved-a.v.solved).slice(0,3).map(x=>x.name).join(', ');
  return rows.filter(x=>x.attention>0).sort((a,b)=>b.attention-a.attention||a.confidence-b.confidence).slice(0,3).map(x=>x.name).join(', ');
}
async function completeLesson(lesson,queue,live){
  const currentTopic=S.topics.find(x=>x.id===lesson.topic_id)||null,nextTopic=currentTopic?nextCurriculumTopic(currentTopic):null;
  const {counts,categories,tags}=queueStats(queue);const seconds=elapsedSeconds(live),mins=Math.round(seconds/60),completion=counts.total?Math.round((counts.solved+counts.hard+counts.later)*100/counts.total):0,solvedPct=counts.total?Math.round(counts.solved*100/counts.total):0;
  const strengths=insightText(categories,'strength'),focus=insightText(categories,'focus')||insightText(tags,'focus');
  const summary=`На уроке разобрали ${counts.total} задач. Уверенно решено: ${counts.solved}. Сложными отмечено: ${counts.hard}. Вернуться позже: ${counts.later}.${strengths?` Лучше всего сегодня получалось: ${strengths}.`:''}`;
  const plan=`${counts.hw?`В домашнюю добавлено ${counts.hw} задач. `:''}${focus?`Повторить: ${focus}. `:''}${counts.later?`Вернуться к ${counts.later} отложенным задачам. `:'Закрепить материал по необходимости. '}${nextTopic?`Следующая тема по программе: ${nextTopic.title}.`:''}`.trim();
  const m=modal(`<h2>Завершить урок</h2><div class="lesson-report-preview"><div class="report-stats"><span>Задач: ${counts.total}</span><span>Решено: ${counts.solved}</span><span>Сложно: ${counts.hard}</span><span>Позже: ${counts.later}</span><span>Разобрано: ${completion}%</span><span>Время: ${mins} мин</span></div></div><div class="grid cols2"><div class="field"><label>Что сегодня получилось</label><textarea id="finishHighlights">${esc(strengths?`Хорошо получалось: ${strengths}.`:`Уверенно решено ${counts.solved} из ${counts.total} задач.`)}</textarea></div><div class="field"><label>Что повторить</label><textarea id="finishFocus">${esc(focus?`Повторить: ${focus}.`:counts.later?`Вернуться к ${counts.later} отложенным задачам.`:'Закрепить материал по необходимости.')}</textarea></div></div><div class="field"><label>Итоги ученику</label><textarea id="finishSummary">${esc(summary)}</textarea></div><div class="field"><label>К следующему уроку</label><textarea id="finishPlan">${esc(plan)}</textarea></div><div class="field"><label>Приватная заметка</label><textarea id="finishPrivate">${esc(lesson.private_notes||`Очередь: ${counts.total}; решено: ${counts.solved}; сложно: ${counts.hard}; позже: ${counts.later}; таймер: ${mins} мин.`)}</textarea></div><button class="btn primary" id="finishConfirm">Завершить и сохранить доску</button>`);
  m.querySelector('#finishConfirm').onclick=async()=>{try{
    await S.boardController?.checkpoint?.('Финал урока');
    try{await window.MathroomLiveCall?.stopRecording?.(true)}catch{}
    try{window.MathroomLessonSuite?.stopPhaseTimer?.()}catch{}
    try{await window.MathroomLiveCall?.end?.()}catch{}
    await saveSnapshot(lesson,'Итог урока','Автоматически сохранено при завершении');
    const publicSummary=m.querySelector('#finishSummary').value,homeworkPlan=m.querySelector('#finishPlan').value,privateNotes=m.querySelector('#finishPrivate').value,publicHighlights=m.querySelector('#finishHighlights').value,publicFocus=m.querySelector('#finishFocus').value;
    const {error}=await sb.from('lessons').update({status:'completed',completed_at:new Date().toISOString(),public_summary:publicSummary,homework_plan:homeworkPlan,private_notes:privateNotes}).eq('id',lesson.id);if(error)throw error;
    const report={teacher_id:S.user.id,lesson_id:lesson.id,student_id:lesson.student_id,topic_id:lesson.topic_id||null,duration_seconds:seconds,queue_total:counts.total,solved_count:counts.solved,hard_count:counts.hard,later_count:counts.later,pending_count:counts.pending,homework_count:counts.hw,completion_percent:completion,solved_percent:solvedPct,category_stats:categories,tag_stats:tags,public_highlights:publicHighlights,public_focus:publicFocus,private_summary:privateNotes,updated_at:new Date().toISOString()};
    const {error:reportError}=await sb.from('lesson_reports').upsert(report,{onConflict:'lesson_id'});if(reportError)throw reportError;
    await sb.from('lesson_live_state').update({focus_enabled:false,timer_running:false,timer_started_at:null,timer_elapsed_seconds:seconds}).eq('lesson_id',lesson.id);
    m.remove();forgetActiveLesson();await loadTeacher();S.activeLesson=null;S.view='history';renderTeacher();toast('Урок завершён и отчёт сохранён');
    if(nextTopic){
      const freshNext=S.topics.find(x=>String(x.id)===String(nextTopic.id))||nextTopic;
      const n=modal(`<span class="pill">Следующая тема по программе</span><h2>${esc(freshNext.title)}</h2><p class="muted">${freshNext.grade} класс · ${esc(topicTrack(freshNext))}</p><p>Можно сразу открыть тему или подставить её в форму следующего урока.</p><div class="actions"><button class="btn" id="finishOpenNext">Открыть тему</button><button class="btn primary" id="finishScheduleNext">Запланировать следующий урок</button></div>`);
      n.querySelector('#finishOpenNext').onclick=()=>{n.remove();S.topic=freshNext;S.topicGradeFilter=Number(freshNext.grade);S.view='topics';renderTeacher()};
      n.querySelector('#finishScheduleNext').onclick=()=>{n.remove();S.schedulePrefill={studentId:lesson.student_id,topicId:freshNext.id};S.view='schedule';renderTeacher()};
    }
  }catch(e){fail(e)}};
}

async function renderBoardPage(){
  const scratch=S.selectedStudent==='__scratch__'||!S.students.length;
  const st=scratch?null:(S.students.find(x=>x.id===S.selectedStudent)||S.students[0]);
  if(st)S.selectedStudent=st.id;else S.selectedStudent='__scratch__';
  const teacherKey=S.user?.id||S.teacher?.id||'teacher';
  const studentOptions=S.students.map(s=>`<option value="${s.id}" ${(!scratch&&st?.id===s.id)?'selected':''}>${esc(s.name)} · ${s.grade} кл.</option>`).join('');
  app.innerHTML=shell(`<div class="actions board-mode-switch" style="margin-bottom:12px"><select id="boardStudent" class="search"><option value="__scratch__" ${scratch?'selected':''}>Моя доска-черновик</option>${studentOptions}</select><span class="small muted">${scratch?'Черновик виден только в этом браузере преподавателя и открывается сразу как отдельная рабочая доска.':'Доска ученика синхронизируется в реальном времени.'}</span></div><div id="boardRoot"><div class="card board-loading-card"><div class="muted">Загружаем доску…</div></div></div>`,'Доска',scratch?'Личный черновик преподавателя':`${st.name} · совместная доска урока`);
  bindShell();
  const selector=document.getElementById('boardStudent');
  selector.onchange=()=>{const v=selector.value;S.selectedStudent=v;S.view=v==='__scratch__'?'scratch':'board';renderBoardPage()};
  const root=document.getElementById('boardRoot');
  try{
    let controller=null;
    if(scratch){
      const scratchKey=`mathroom.teacher.scratch.${teacherKey}`;
      try{controller=await mountBoard(root,'teacher-scratch',true,{localOnly:true,localKey:scratchKey})}
      catch(firstError){
        console.warn('[Mathroom scratch] первая загрузка не удалась, восстанавливаем чистое рабочее состояние',firstError);
        try{const old=localStorage.getItem(scratchKey);if(old)localStorage.setItem(`${scratchKey}.backup.${Date.now()}`,old);localStorage.removeItem(scratchKey)}catch{}
        root.innerHTML='';
        controller=await mountBoard(root,'teacher-scratch',true,{localOnly:true,localKey:scratchKey});
        toast('Черновик восстановлен. Старые данные сохранены в резервной копии браузера.');
      }
    }else{
      controller=await mountBoard(root,st.id,true,{studentName:st.name});
    }
    S.boardController=controller||null;
    if(!controller){
      root.innerHTML=`<div class="card"><h2>Не удалось открыть доску</h2><p class="muted">Попробуй обновить страницу. Если проблема повторится, переключись на другой режим доски и вернись обратно.</p><div class="actions"><button class="btn primary" id="retryBoardMount">Обновить доску</button></div></div>`;
      root.querySelector('#retryBoardMount')?.addEventListener('click',()=>renderBoardPage());
    }
  }catch(e){
    console.error('[Mathroom board page]',e);
    root.innerHTML=`<div class="card"><h2>Ошибка загрузки доски</h2><p class="muted">Черновик или доска ученика не смогли загрузиться. Мы сохранили навигацию и даём быстрый перезапуск страницы доски.</p><div class="actions"><button class="btn primary" id="retryBoardMount">Перезапустить доску</button></div></div>`;
    root.querySelector('#retryBoardMount')?.addEventListener('click',()=>renderBoardPage());
  }
}

async function bootStudent(){
  if(!configured)return configScreen();let {data:{session}}=await sb.auth.getSession();if(session&&!session.user.is_anonymous){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Открой ссылку ученика отдельно</h1><p>В этом браузере уже выполнен вход преподавателя. Открой ссылку ученика в режиме инкогнито или на другом устройстве.</p></div></div>`;return}if(!session){const {data,error}=await sb.auth.signInAnonymously();if(error){app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Нужно включить Anonymous Sign-Ins</h1><p>${esc(error.message)}</p></div></div>`;return}session=data.session}
  const {data:claimed,error:claimErr}=await sb.rpc('claim_student_access',{p_token:S.access});if(claimErr){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Ссылка недействительна</h1><p>Попроси преподавателя прислать новую ссылку.</p></div></div>`;return}const {data:student,error}=await sb.from('students').select('id,name,grade').eq('id',claimed.id).single();if(error)return fail(error);S.student=student;renderStudent();
}
async function getStudentData(){
  const [{data:lessons},{data:homeworks},{data:tests},{data:reports}]=await Promise.all([sb.rpc('get_my_lessons'),sb.from('homeworks').select('id,title,status,score,comment,created_at,submitted_at,due_at,source,attempt_count,last_attempt_at,reviewed_at,revision_requested_at,revision_message,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),sb.from('tests').select('id,title,status,score,source,created_at,submitted_at,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),sb.rpc('get_my_lesson_reports')]);
  return {lessons:Array.isArray(lessons)?lessons:[],homeworks:homeworks||[],tests:tests||[],reports:Array.isArray(reports)?reports:[]};
}
async function currentStudentLive(lessons){
  const active=lessons.find(x=>x.status==='in_progress');if(!active)return {active:null,live:null};const {data}=await sb.from('lesson_live_state').select('*').eq('lesson_id',active.id).maybeSingle();return {active,live:data};
}
function taskTimerRemaining(live){
  if(!live?.task_timer_running||!live?.task_timer_end_at)return 0;
  return Math.max(0,Math.ceil((new Date(live.task_timer_end_at).getTime()-Date.now())/1000));
}
function studentLiveCard(active,live){
  if(!active||!live)return '';
  const taskLeft=taskTimerRemaining(live);
  return `<div class="student-live-mount"><div class="lesson-live-card mr-student-lesson-strip"><div class="lesson-live-top"><div><div class="lesson-task-kicker">Идёт урок</div><b>${esc(active.topics?.title||'Урок')}</b></div><div class="mr-student-live-times"><div><span class="small muted">Урок</span><div class="lesson-timer" id="studentTimer">${fmtTime(elapsedSeconds(live))}</div></div><div class="mr-student-task-timer ${live.task_timer_running?'active':''}" id="studentTaskTimerWrap"><span class="small muted">На задачу</span><div class="lesson-timer" id="studentTaskTimer">${live.task_timer_running?fmtTime(taskLeft):'—'}</div></div></div></div></div></div>`;
}
function studentLessonTaskCard(live){
  const title=String(live?.current_title||'').trim();
  const prompt=String(live?.current_prompt||'').trim();
  if(!title&&!prompt)return '<section class="mr-student-current-task empty-task"><span class="lesson-task-kicker">Текущая задача</span><b>Преподаватель скоро выберет задачу</b></section>';
  return `<section class="mr-student-current-task"><div class="mr-student-current-task-head"><div><span class="lesson-task-kicker">Текущая задача</span><h2>${esc(title||'Задача')}</h2></div></div>${prompt?`<div class="mr-student-current-prompt">${nl(prompt)}</div>`:''}</section>`;
}
function mountStudentLessonTimer(live,active){
  const board=document.querySelector('#studentLessonBoard .board-card');
  const actions=board?.querySelector('.board-head-actions');
  if(!actions||actions.querySelector('#studentTimerDock'))return;
  const taskLeft=taskTimerRemaining(live);
  const dock=document.createElement('div');
  dock.id='studentTimerDock';
  dock.className='mr-student-board-timer';
  dock.title=active?.topics?.title||'Урок';
  dock.innerHTML=`<span class="mr-student-board-timer-label">Урок</span><b id="studentTimer">${fmtTime(elapsedSeconds(live))}</b><span class="mr-student-board-task-timer ${live?.task_timer_running?'active':''}" id="studentTaskTimerWrap"><small>Задача</small><b id="studentTaskTimer">${live?.task_timer_running?fmtTime(taskLeft):'—'}</b></span>`;
  actions.prepend(dock);
}
function studentProgressHtml(d){
  const reports=d.reports||[],recent=reports.slice(0,8),vals=recent.map(r=>Number(r.solved_percent||0));
  const mean=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null,last3=mean(vals.slice(0,3)),prev3=mean(vals.slice(3,6)),delta=last3!=null&&prev3!=null?last3-prev3:null;
  const focus={},strength={};
  for(const r of reports.slice(0,12))for(const [name,v] of Object.entries(r.category_stats||{})){const hard=Number(v.hard||0)+Number(v.later||0),solved=Number(v.solved||0);focus[name]=(focus[name]||0)+hard;strength[name]=(strength[name]||0)+solved}
  const topFocus=Object.entries(focus).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,4),topStrength=Object.entries(strength).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const lessonName=id=>d.lessons.find(l=>l.id===id)?.topics?.title||'Урок';
  return `<div class="grid cols4 profile-metrics"><div class="card"><div class="muted">Уроков с отчётом</div><div class="metric">${reports.length}</div></div><div class="card"><div class="muted">Последние 3 урока</div><div class="metric">${last3==null?'—':last3+'%'}</div><div class="small ${delta>0?'good':delta<0?'warn':''}">${delta==null?'Нужно больше уроков':`${delta>0?'↑':delta<0?'↓':'→'} ${delta>0?'+':''}${delta} п.п.`}</div></div><div class="card"><div class="muted">Домашние</div><div class="metric">${avg(d.homeworks.map(x=>x.score))??'—'}${avg(d.homeworks.map(x=>x.score))!=null?'%':''}</div></div><div class="card"><div class="muted">Тесты</div><div class="metric">${avg(d.tests.map(x=>x.score))??'—'}${avg(d.tests.map(x=>x.score))!=null?'%':''}</div></div></div><div class="grid cols2" style="margin-top:16px"><div class="card"><h2>Что получается лучше</h2>${topStrength.length?`<div class="mr-tag-cloud">${topStrength.map(([n,v])=>`<span class="pill good">${esc(n)} · ${v}</span>`).join('')}</div>`:'<div class="empty">Пока недостаточно данных.</div>'}<div class="mr-student-insights">${reports.filter(r=>r.public_highlights).slice(0,3).map(r=>`<div class="notice"><b>${esc(lessonName(r.lesson_id))}</b><br>${nl(r.public_highlights)}</div>`).join('')}</div></div><div class="card"><h2>Что повторить</h2>${topFocus.length?`<div class="mr-tag-cloud">${topFocus.map(([n,v])=>`<span class="pill warn">${esc(n)} · ${v}</span>`).join('')}</div>`:'<div class="empty">Сложные места пока не отмечены.</div>'}<div class="mr-student-insights">${reports.filter(r=>r.public_focus).slice(0,3).map(r=>`<div class="notice"><b>${esc(lessonName(r.lesson_id))}</b><br>${nl(r.public_focus)}</div>`).join('')}</div></div></div><div class="card" style="margin-top:16px"><div class="mr-card-head"><h2>Динамика</h2><span class="pill">последние ${recent.length}</span></div>${recent.length?`<div class="mr-trend-chart student">${[...recent].reverse().map(r=>{const p=Math.max(0,Math.min(100,Number(r.solved_percent||0)));return `<div class="mr-trend-col" title="${esc(lessonName(r.lesson_id))} · ${p}%"><span>${p}%</span><div class="mr-trend-track"><i style="height:${Math.max(4,p)}%"></i></div><small>${new Date(r.created_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</small></div>`}).join('')}</div>`:'<div class="empty">После следующих уроков здесь появится график прогресса.</div>'}</div>`;
}
async function renderStudent(){
  cleanupAll();const d=await getStudentData(),{active,live}=await currentStudentLive(d.lessons);S.studentLive=live;

  // Dedicated lesson workspace is only for phones and tablets.
  // Desktop keeps the original student cabinet / lesson layout.
  const ua=String(navigator.userAgent||'');
  const coarse=window.matchMedia?.('(pointer: coarse)')?.matches||false;
  const touch=Number(navigator.maxTouchPoints||0)>0;
  const sw=Math.max(Number(screen?.width||0),Number(screen?.height||0));
  const sh=Math.min(Number(screen?.width||0),Number(screen?.height||0));
  const mobileUA=/iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(ua);
  const iPadOS=/Macintosh/i.test(ua)&&touch;
  /* Use physical device characteristics, not current viewport width.
     Rotating a phone must never turn the live lesson into desktop mode. */
  const compactLessonUI=(mobileUA||iPadOS||((coarse||touch)&&sw<=1366&&sh<=1024));
  /* On phones/tablets the first student view after every page load is Board.
     Keep it as an in-memory one-shot so the student can still switch tabs
     afterwards without being forced back to Board on every render. */
  if(compactLessonUI&&!S.mobileBoardDefaultApplied){
    S.studentTab='board';
    S.mobileBoardDefaultApplied=true;
  }
  if(active&&live&&compactLessonUI){
    S.studentTab='board';
    app.innerHTML=`<div class="student-home student-lesson-mode"><div id="studentLessonTaskMount">${studentLessonTaskCard(live)}</div><div id="studentLessonBoard"></div></div>`;
    await mountBoard(document.getElementById('studentLessonBoard'),S.student.id,false);
    mountStudentLessonTimer(live,active);
    subscribeStudentLive(active.id);
    return;
  }

  // Original desktop focus mode.
  if(active&&live?.focus_enabled){
    app.innerHTML=`<div class="student-home student-focus">${studentLiveCard(active,live)}<div id="focusBoard"></div></div>`;
    await mountBoard(document.getElementById('focusBoard'),S.student.id,false);
    subscribeStudentLive(active.id);
    return;
  }

  // Original desktop/student cabinet layout.
  app.innerHTML=`<div class="student-home"><div class="student-top"><div><div class="brand">Mathroom</div><h1>${esc(S.student.name)}</h1><p class="muted">${S.student.grade} класс · персональный кабинет</p></div><div class="tabs"><button id="studentTodayTab" class="${S.studentTab==='today'?'active':''}">Сегодня</button><button id="studentBoardTab" class="${S.studentTab==='board'?'active':''}">Доска</button><button id="studentTasksTab" class="${S.studentTab==='tasks'?'active':''}">Задания</button><button id="studentLessonsTab" class="${S.studentTab==='lessons'?'active':''}">Уроки</button><button id="studentProgressTab" class="${S.studentTab==='progress'?'active':''}">Прогресс</button></div></div>${studentLiveCard(active,live)}<div id="studentContent"></div></div>`;
  document.getElementById('studentTodayTab').onclick=()=>{S.studentTab='today';renderStudent()};document.getElementById('studentBoardTab').onclick=()=>{S.studentTab='board';renderStudent()};document.getElementById('studentTasksTab').onclick=()=>{S.studentTab='tasks';renderStudent()};document.getElementById('studentLessonsTab').onclick=()=>{S.studentTab='lessons';renderStudent()};document.getElementById('studentProgressTab').onclick=()=>{S.studentTab='progress';renderStudent()};
  const c=document.getElementById('studentContent');if(S.studentTab==='today')c.innerHTML=`<div id="mrStudentToday" class="mr-student-today"><div class="card"><h2>Сегодня</h2><p class="muted">Собираем ближайший урок и следующий шаг…</p></div></div>`;else if(S.studentTab==='progress')c.innerHTML=studentProgressHtml(d);else if(S.studentTab==='lessons')c.innerHTML=`<div class="list">${d.lessons.length?d.lessons.map(l=>{const r=(d.reports||[]).find(x=>x.lesson_id===l.id);return `<div class="row student-lesson"><div><h3>${esc(l.topics?.title||'Урок')}</h3><p>${dateLong(l.scheduled_at)} · ${l.duration_minutes} мин · ${statusLabel(l.status)}</p>${l.rescheduled_from&&Math.abs(new Date(l.rescheduled_from)-new Date(l.scheduled_at))>60000?`<div class="small warn">Перенесено с ${dateLong(l.rescheduled_from)}</div>`:''}${r?`<div class="mr-student-report"><div class="actions"><span class="pill">✓ ${r.solved_count}/${r.queue_total}</span><span class="pill">${Math.round(Number(r.solved_percent||0))}% уверенно</span></div>${r.public_highlights?`<div><b>Получилось:</b> ${nl(r.public_highlights)}</div>`:''}${r.public_focus?`<div><b>Повторить:</b> ${nl(r.public_focus)}</div>`:''}</div>`:''}${l.public_summary?`<div class="notice">${nl(l.public_summary)}</div>`:''}${l.homework_plan?`<div class="small"><b>К следующему уроку:</b> ${esc(l.homework_plan)}</div>`:''}</div></div>`}).join(''):'<div class="empty">Уроков пока нет.</div>'}</div>`;
  else if(S.studentTab==='tasks'){const all=[...d.homeworks.map(x=>({...x,kind:'homework'})),...d.tests.map(x=>({...x,kind:'test'}))].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));c.innerHTML=`<div class="list">${all.length?all.map(x=>{const revision=x.kind==='homework'&&x.status==='assigned'&&x.revision_requested_at;const overdue=x.kind==='homework'&&x.due_at&&x.status==='assigned'&&!revision&&new Date(x.due_at).getTime()<Date.now();return `<div class="row"><div><h3>${x.kind==='homework'?'Домашняя':'Тест'} · ${esc(x.title)}</h3><p>${esc(x.topics?.title||'')} · ${revision?'нужна доработка':statusLabel(x.status)}${x.score!=null?` · ${x.score}%`:''}${x.kind==='homework'&&x.due_at?` · срок ${new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:''}${x.kind==='homework'&&x.attempt_count?` · попыток ${x.attempt_count}`:''}</p>${revision?`<div class="notice warn"><b>Преподаватель вернул работу на доработку.</b>${x.revision_message?`<br>${nl(x.revision_message)}`:''}</div>`:''}${overdue?`<div class="small warn">Срок выполнения прошёл</div>`:''}${x.comment?`<div class="small muted">Комментарий: ${esc(x.comment)}</div>`:''}</div><button class="btn sm primary" data-student-assignment="${x.kind}:${x.id}">${x.status==='assigned'?(revision?'Исправить':'Выполнить'):'Посмотреть'}</button></div>`}).join(''):'<div class="empty">Заданий пока нет.</div>'}</div>`;c.querySelectorAll('[data-student-assignment]').forEach(b=>b.onclick=()=>openStudentAssignment(...b.dataset.studentAssignment.split(':')))}
  else await mountBoard(c,S.student.id,false);
  if(active)subscribeStudentLive(active.id);
}
function subscribeStudentLive(lessonId){
  cleanupLive();let timerInt=setInterval(()=>{const el=document.getElementById('studentTimer');if(el)el.textContent=fmtTime(elapsedSeconds(S.studentLive));const tt=document.getElementById('studentTaskTimer');if(tt)tt.textContent=S.studentLive?.task_timer_running?fmtTime(taskTimerRemaining(S.studentLive)):'—';const tw=document.getElementById('studentTaskTimerWrap');if(tw)tw.classList.toggle('active',!!S.studentLive?.task_timer_running)},1000);const ch=sb.channel(`student-live:${lessonId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'lesson_live_state',filter:`lesson_id=eq.${lessonId}`},payload=>{const prev=S.studentLive||{};const next=payload.new||{};S.studentLive=next;const structural=prev.focus_enabled!==next.focus_enabled||prev.current_queue_item_id!==next.current_queue_item_id||prev.current_title!==next.current_title||prev.current_prompt!==next.current_prompt;if(structural)renderStudent();else{const el=document.getElementById('studentTimer');if(el)el.textContent=fmtTime(elapsedSeconds(next));const tt=document.getElementById('studentTaskTimer');if(tt)tt.textContent=next.task_timer_running?fmtTime(taskTimerRemaining(next)):'—';const tw=document.getElementById('studentTaskTimerWrap');if(tw)tw.classList.toggle('active',!!next.task_timer_running)}}).subscribe();S.liveCleanup=()=>{clearInterval(timerInt);sb.removeChannel(ch)};
}
async function openStudentAssignment(kind,id){
  const rpc=kind==='homework'?'get_student_homework':'get_student_test',arg=kind==='homework'?{p_homework_id:id}:{p_test_id:id};const {data,error}=await sb.rpc(rpc,arg);if(error)return fail(error);const assigned=data.status==='assigned',revision=kind==='homework'&&assigned&&data.revision_requested_at;
  const revisionNotice=revision?`<div class="notice warn"><b>Работа возвращена на доработку</b><br>${nl(data.revision_message||'Исправь отмеченные задания и отправь работу ещё раз.')}</div>`:'';
  const meta=kind==='homework'?`<div class="actions assignment-student-meta">${data.due_at?`<span class="pill">срок ${new Date(data.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</span>`:''}${data.attempt_count?`<span class="pill">попытка ${data.attempt_count+(assigned?1:0)}</span>`:''}${data.reviewed_at?'<span class="pill good">проверено преподавателем</span>':''}</div>`:'';
  const m=modal(`<h2>${esc(data.title)}</h2>${meta}${revisionNotice}${data.score!=null?`<div class="score">${data.score}%</div>`:''}<form id="studentAnswerForm" class="answers">${(data.items||[]).map((x,i)=>`<div class="answer-item ${x.is_correct===true?'correct':x.is_correct===false?'wrong':''}"><b>${i+1}. ${esc(x.prompt)}</b><div class="field"><label>Ответ</label><input name="ans_${x.id}" value="${esc(x.student_answer||'')}" ${assigned?'':'disabled'}></div>${x.is_correct!==null&&x.is_correct!==undefined?`<div class="small">${x.is_correct?'✓ Верно':'✕ Нужно исправить'}</div>`:''}${x.teacher_feedback?`<div class="notice"><b>Комментарий к задаче</b><br>${nl(x.teacher_feedback)}</div>`:''}</div>`).join('')}${assigned?`<button class="btn primary">${revision?'Отправить исправления':'Отправить'}</button>`:''}</form>${data.comment?`<div class="notice"><b>Комментарий преподавателя</b><br>${nl(data.comment)}</div>`:''}`,'wide-modal');if(assigned)m.querySelector('#studentAnswerForm').onsubmit=async e=>{e.preventDefault();const answers={};for(const x of data.items||[])answers[x.id]=m.querySelector(`[name="ans_${x.id}"]`).value;const submitRpc=kind==='homework'?'submit_homework':'submit_test',args=kind==='homework'?{p_homework_id:id,p_answers:answers}:{p_test_id:id,p_answers:answers};const {data:res,error:er}=await sb.rpc(submitRpc,args);if(er)return fail(er);toast(kind==='homework'?`Работа отправлена · ${res.score}%`:`Результат: ${res.score}%`);m.remove();renderStudent()};
}

window.addEventListener('mathroom:refresh-lesson',()=>{if(S.view==='lesson'&&S.activeLesson)renderLesson()});

boot().catch(e=>{console.error(e);app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Ошибка запуска</h1><p>${esc(e.message)}</p></div></div>`});
})();
