(() => {
const {app,configured,sb,S,AUTH_STORAGE_KEY,authStorage,authStorageAvailable,esc,nl,token,dateLong,dateShort,diffLabel,statusLabel,statusClass,toast,fail,copyText,modal,cleanupAll,cleanupBoard,cleanupLive,studentLink,configScreen,avg,shuffle}=window.MR;
const {mountBoard,mountSnapshot}=window.MathroomBoard;

const AUTH_SESSION_TTL_MS=24*60*60*1000;
const AUTH_SESSION_EXPIRY_KEY='mathroom.authSessionExpiresAt';
async function authSessionExpiry(){
  try{return Number(await authStorage.getItem(AUTH_SESSION_EXPIRY_KEY))||0}catch{return 0}
}
async function rememberAuthSession(){
  try{await authStorage.setItem(AUTH_SESSION_EXPIRY_KEY,String(Date.now()+AUTH_SESSION_TTL_MS))}catch(e){console.warn('[Mathroom auth ttl:set]',e)}
}
async function clearAuthSession(){
  try{await authStorage.removeItem(AUTH_SESSION_EXPIRY_KEY)}catch(e){console.warn('[Mathroom auth ttl:remove]',e)}
}
async function authSessionIsFresh(){
  const expiresAt=await authSessionExpiry();
  return expiresAt>Date.now();
}

let teacherAccessWatch=null;
let teacherAccessCheckBusy=false;
function teacherAccessDisabledError(message='Доступ к Mathroom отключён администратором.'){
  const e=new Error(message);
  e.code='MATHROOM_ACCESS_DISABLED';
  return e;
}
function isTeacherAccessDisabledError(error){
  const text=String(error?.message||error||'').toLocaleLowerCase('ru');
  return error?.code==='MATHROOM_ACCESS_DISABLED'||/bann|заблок|доступ.*отключ|user.*disabled/.test(text);
}
async function clearTeacherLogin(){
  if(teacherAccessWatch){clearInterval(teacherAccessWatch);teacherAccessWatch=null}
  try{await clearAuthSession()}catch{}
  try{await authStorage.removeItem(AUTH_STORAGE_KEY)}catch{}
  try{await sb.auth.signOut()}catch{}
  S.user=S.teacher=null;
}
function renderTeacherAccessDisabled(){
  app.innerHTML=`<div class="center-page"><div class="auth-card mr-access-disabled-card"><div class="brand">Mathroom</div><span class="pill warn">Доступ отключён</span><h1>Вход в кабинет приостановлен</h1><p>Администратор временно отключил доступ к Mathroom. Ученики, уроки, доски и история сохранены.</p><div class="actions"><button class="btn primary" id="disabledAccessLogin">Вернуться ко входу</button></div><div class="small muted" style="margin-top:12px">После повторного включения доступа можно войти тем же email и паролем.</div></div></div>`;
  document.getElementById('disabledAccessLogin').onclick=()=>renderAuth();
}
async function verifyTeacherAccess({kick=false}={}){
  if(S.access||!S.user||teacherAccessCheckBusy)return true;
  teacherAccessCheckBusy=true;
  try{
    const {data,error}=await sb.from('teachers').select('access_enabled').eq('id',S.user.id).maybeSingle();
    const denied=!data||data.access_enabled===false;
    const authDenied=!!error&&/jwt|unauthor|bann|session|token/i.test(String(error.message||''));
    if(denied||authDenied){
      if(kick){
        cleanupAll();
        forgetActiveLesson();
        await clearTeacherLogin();
        renderTeacherAccessDisabled();
      }
      return false;
    }
    return true;
  }catch{
    return true;
  }finally{
    teacherAccessCheckBusy=false;
  }
}
function startTeacherAccessWatch(){
  if(teacherAccessWatch)clearInterval(teacherAccessWatch);
  teacherAccessWatch=setInterval(()=>verifyTeacherAccess({kick:true}),30000);
}
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&S.user&&!S.access)verifyTeacherAccess({kick:true});
});

const TEACHER_VIEW_STORAGE_PREFIX='mathroom.teacherView.';
const RESTORABLE_TEACHER_VIEWS=new Set(['dashboard','schedule','students','topics','textbooks','bank','assignments','history','scratch','board']);
function teacherViewStorageKey(){
  return S.user?.id?`${TEACHER_VIEW_STORAGE_PREFIX}${S.user.id}`:`${TEACHER_VIEW_STORAGE_PREFIX}anonymous`;
}
function rememberTeacherView(view=S.view){
  if(!RESTORABLE_TEACHER_VIEWS.has(view)||!S.user)return;
  try{sessionStorage.setItem(teacherViewStorageKey(),view)}catch{}
}
function restoreTeacherView(){
  if(!S.user)return false;
  try{
    const view=sessionStorage.getItem(teacherViewStorageKey())||'';
    if(!RESTORABLE_TEACHER_VIEWS.has(view))return false;
    S.view=view;
    return true;
  }catch{return false}
}

function activeLessonStorageKey(){return S.user?.id?`mathroom.activeLesson.${S.user.id}`:'mathroom.activeLesson'}
function activeLessonSessionKey(){return S.user?.id?`mathroom.activeLesson.session.${S.user.id}`:'mathroom.activeLesson.session'}
function lessonIdFromHash(){
  try{
    const m=String(location.hash||'').match(/^#lesson=(.+)$/);
    return m?decodeURIComponent(m[1]):'';
  }catch{return ''}
}
function rememberActiveLesson(id){
  if(!id)return;
  const value=String(id);
  try{localStorage.setItem(activeLessonStorageKey(),value)}catch{}
  try{sessionStorage.setItem(activeLessonSessionKey(),value)}catch{}
  /* Keep the active lesson in the URL as well. This makes a browser refresh
     deterministic even if storage is cleared or delayed by the browser. */
  if(!S.access){
    try{
      const next=`${location.pathname}${location.search}#lesson=${encodeURIComponent(value)}`;
      if(location.hash!==`#lesson=${encodeURIComponent(value)}`)history.replaceState(history.state,'',next);
    }catch{}
  }
}
function forgetActiveLesson(){
  try{localStorage.removeItem(activeLessonStorageKey())}catch{}
  try{sessionStorage.removeItem(activeLessonSessionKey())}catch{}
  if(!S.access&&lessonIdFromHash()){
    try{history.replaceState(history.state,'',`${location.pathname}${location.search}`)}catch{}
  }
}
function restoreActiveLesson(){
  try{
    const candidates=[
      lessonIdFromHash(),
      sessionStorage.getItem(activeLessonSessionKey())||'',
      localStorage.getItem(activeLessonStorageKey())||''
    ].filter(Boolean);
    const id=[...new Set(candidates.map(String))].find(v=>(S.lessons||[]).some(x=>String(x.id)===v&&x.status==='in_progress'));
    if(!id){
      /* Only clear stale storage. Do not erase a valid #lesson route before
         loadTeacher has had a chance to populate S.lessons. */
      if((S.lessons||[]).length){
        try{localStorage.removeItem(activeLessonStorageKey())}catch{}
        try{sessionStorage.removeItem(activeLessonSessionKey())}catch{}
        if(lessonIdFromHash())try{history.replaceState(history.state,'',`${location.pathname}${location.search}`)}catch{}
      }
      return false;
    }
    const l=S.lessons.find(x=>String(x.id)===String(id)&&x.status==='in_progress');
    if(!l)return false;
    S.activeLesson=l;
    S.selectedStudent=l.student_id;
    S.topic=S.topics.find(x=>x.id===l.topic_id)||null;
    S.view='lesson';
    rememberActiveLesson(l.id);
    return true;
  }catch{return false}
}

async function ensureTeacher(){
  const {data:{user},error:userError}=await sb.auth.getUser();
  if(userError){
    if(isTeacherAccessDisabledError(userError))throw teacherAccessDisabledError();
    throw userError;
  }
  if(!user||user.is_anonymous)return null;
  const {data,error}=await sb.from('teachers').select('*').eq('id',user.id).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Нет доступа преподавателя. Попроси администратора Mathroom добавить этот аккаунт.');
  if(data.access_enabled===false)throw teacherAccessDisabledError();
  return data;
}
async function loadTeacher(){
  const reqs=await Promise.all([
    sb.from('students').select('*').order('created_at'),
    sb.from('topics').select('*').order('grade').order('section').order('title'),
    sb.from('exercises').select('*').order('created_at'),
    sb.from('lessons').select('*,students(name,grade),topics(title)').order('scheduled_at',{ascending:true}),
    sb.from('homeworks').select('*,students(name,grade),topics(title)').order('created_at',{ascending:false}),
    sb.from('tests').select('*,students(name,grade),topics(title)').order('created_at',{ascending:false}),
    sb.from('lesson_board_versions').select('*').order('created_at',{ascending:false}),
    sb.from('shared_materials').select('*').order('created_at',{ascending:false})
  ]);
  const err=reqs.find(x=>x.error)?.error;if(err)throw err;
  [S.students,S.topics,S.exercises,S.lessons,S.homeworks,S.tests,S.versions,S.sharedMaterials]=reqs.map(x=>x.data||[]);
  const bank=window.MathroomCurriculumBank;if(bank?.compareTopics)S.topics.sort(bank.compareTopics);
  try{
    const [tb,tl,lib]=await Promise.all([
      sb.from('textbooks').select('*').order('created_at',{ascending:false}),
      sb.from('textbook_topic_links').select('*'),
      sb.from('teacher_textbook_library').select('*')
    ]);
    S.textbooksFeatureAvailable=!tb.error&&!tl.error&&!lib.error;S.textbooks=tb.data||[];S.textbookLinks=tl.data||[];S.teacherTextbookLibrary=lib.data||[];
  }catch{S.textbooksFeatureAvailable=false;S.textbooks=[];S.textbookLinks=[];S.teacherTextbookLibrary=[]}
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
  const books=(S.textbooks||[]).filter(b=>String(b.teacher_id)===String(S.user?.id)).filter(b=>!ids||ids.has(String(b.id)));
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
function theoryCardKind(title='',i=0){
  const q=String(title||'').toLocaleLowerCase('ru');
  if(/суть|смысл|идея/.test(q))return 'essence';
  if(/как действовать|алгоритм|шаг/.test(q))return 'steps';
  if(/пример/.test(q))return 'example';
  if(/запомни|что запомнить|важно/.test(q))return 'remember';
  if(/ошиб/.test(q))return 'error';
  return i===0?'essence':'note';
}
function theoryCardIcon(kind){
  const common='class="mr-theory-v2-svg" viewBox="0 0 24 24" aria-hidden="true"';
  if(kind==='essence')return `<svg ${common}><circle cx="12" cy="12" r="7.5"/><circle class="accent" cx="12" cy="12" r="3.5"/><path class="accent" d="M12 2.5v3M21.5 12h-3M12 21.5v-3M2.5 12h3"/></svg>`;
  if(kind==='steps')return `<svg ${common}><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><path class="accent" d="M10 12h4"/></svg>`;
  if(kind==='example')return `<svg ${common}><path d="M4.5 8h15M4.5 16h15"/><path class="accent" d="M8 4.5v7M16 12.5v7"/></svg>`;
  if(kind==='remember')return `<svg ${common}><path d="M7 4h10v16l-5-3-5 3V4Z"/><path class="accent" d="M10 8h4"/></svg>`;
  if(kind==='error')return `<svg ${common}><path d="m12 3 9 16H3L12 3Z"/><path class="accent" d="M12 9v4M12 16h.01"/></svg>`;
  return `<svg ${common}><rect x="5" y="4" width="14" height="16" rx="3"/><path class="accent" d="M8 9h8M8 13h5"/></svg>`;
}
function theoryCardVisual(kind,body=''){
  const text=String(body||'');
  const eq=text.match(/(\d+\s*=\s*\d+\s*[+\-×:·]\s*\d+)/);
  const two=text.match(/\b(\d{2,3})\b/);
  if((kind==='example'||kind==='steps')&&eq){
    const formula=eq[1].replace(/\s+/g,' ');
    const parts=formula.match(/(\d+)\s*=\s*(\d+)\s*([+\-×:·])\s*(\d+)/);
    if(parts)return `<div class="mr-theory-v2-formula"><b>${esc(parts[2])}</b><span>${esc(parts[3])}</span><b>${esc(parts[4])}</b><i>= ${esc(parts[1])}</i></div>`;
    return `<div class="mr-theory-v2-formula single"><strong>${esc(formula)}</strong></div>`;
  }
  if(kind==='remember'&&two){
    const n=two[1],a=n.slice(0,-1),b=n.slice(-1);
    return `<div class="mr-theory-v2-digits"><b>${esc(a)}</b><b>${esc(b)}</b><small>десятки&nbsp;&nbsp;&nbsp;единицы</small></div>`;
  }
  if(kind==='error')return `<div class="mr-theory-v2-warning">!</div>`;
  if(kind==='essence')return `<div class="mr-theory-v2-orbit"><i></i><i></i><i></i></div>`;
  return '';
}
function theoryHtml(raw=''){
  const blocks=parseTheoryBlocks(raw);
  if(!blocks.length)return '<div class="empty">Теория пока не добавлена.</div>';
  if(blocks.length<=1&&!blocks[0]?.title)return `<div class="prewrap">${nl(blocks[0].body||'')}</div>`;
  return `<div class="mr-theory-grid">${blocks.map((b,i)=>{
    const kind=theoryCardKind(b.title,i),visual=theoryCardVisual(kind,b.body);
    return `<section class="mr-theory-block mr-theory-v2-block kind-${kind} ${i===0?'lead':''}">
      <div class="mr-theory-v2-copy">
        <div class="mr-theory-v2-title">${b.title?`<span class="mr-theory-v2-icon">${theoryCardIcon(kind)}</span><h3>${esc(b.title)}</h3>`:''}</div>
        <div class="mr-theory-body">${nl(b.body)}</div>
      </div>
      ${visual?`<div class="mr-theory-v2-art">${visual}</div>`:''}
    </section>`;
  }).join('')}</div>`;
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
function textbookLinksForTopic(topicId){
  const topic=(S.topics||[]).find(t=>String(t.id)===String(topicId));if(!topic)return [];
  const booksById=new Map((S.textbooks||[]).map(b=>[String(b.id),b]));
  const direct=(S.textbookLinks||[])
    .filter(x=>String(x.topic_id)===String(topicId))
    .map(l=>({...l,textbook:booksById.get(String(l.textbook_id)),shared_master:false}))
    .filter(x=>x.textbook);
  const directBookIds=new Set(direct.map(x=>String(x.textbook_id)));
  const inherited=(S.textbookLinks||[])
    .map(l=>({link:l,book:booksById.get(String(l.textbook_id))}))
    .filter(({link,book})=>
      !!book&&book.is_shared&&!textbookIsMine(book)&&
      String(link.teacher_id)===String(book.teacher_id)&&
      !directBookIds.has(String(book.id))&&
      String(localTopicForSharedLink(link)?.id||'')===String(topic.id)
    )
    .map(({link,book})=>({...link,textbook:book,shared_master:true}));
  return [...direct,...inherited];
}
function textbookIsMine(book){return String(book?.teacher_id||'')===String(S.user?.id||'')}
function textbookInPersonalLibrary(book){
  if(!book)return false;
  return textbookIsMine(book)||(S.teacherTextbookLibrary||[]).some(x=>String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(S.user?.id));
}
function textbookMasterLinks(book){
  if(!book?.is_shared)return [];
  return (S.textbookLinks||[]).filter(x=>String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(book.teacher_id));
}
function textbookPersonalLinks(book){
  if(!book)return [];
  return (S.textbookLinks||[]).filter(x=>String(x.textbook_id)===String(book.id)&&String(x.teacher_id)===String(S.user?.id));
}
function topicIdentityValue(v){return String(v||'').trim().toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ')}
function localTopicForSharedLink(link){
  const grade=Number(link?.topic_grade)||0,title=topicIdentityValue(link?.topic_title),section=topicIdentityValue(link?.topic_section);
  let rows=(S.topics||[]).filter(t=>!grade||Number(t.grade)===grade);
  if(title){const exact=rows.find(t=>topicIdentityValue(t.title)===title&&(!section||topicIdentityValue(t.section)===section));if(exact)return exact}
  if(title){const byTitle=rows.find(t=>topicIdentityValue(t.title)===title);if(byTitle)return byTitle}
  return null;
}
async function addSharedTextbookToPersonalLibrary(book,{refresh=true,render=true,notify=true}={}){
  if(!book||textbookIsMine(book)||!book.is_shared)return false;
  if(textbookInPersonalLibrary(book)){if(notify)toast('Учебник уже в личной библиотеке');return true}
  const master=textbookMasterLinks(book);
  const {error:libError}=await sb.from('teacher_textbook_library').insert({teacher_id:S.user.id,textbook_id:book.id});
  if(libError)return fail(libError);
  const rows=[],missing=[];
  for(const link of master){
    const topic=localTopicForSharedLink(link);
    if(!topic){missing.push(link);continue}
    rows.push({
      teacher_id:S.user.id,textbook_id:book.id,topic_id:topic.id,
      page_from:link.page_from||null,page_to:link.page_to||null,note:link.note||'',
      topic_grade:Number(topic.grade)||null,topic_section:topic.section||'',topic_title:topic.title||''
    });
  }
  try{
    for(let i=0;i<rows.length;i+=150){
      const {error}=await sb.from('textbook_topic_links').upsert(rows.slice(i,i+150),{onConflict:'textbook_id,topic_id'});
      if(error)throw error;
    }
  }catch(e){
    await sb.from('teacher_textbook_library').delete().eq('teacher_id',S.user.id).eq('textbook_id',book.id);
    return fail(e);
  }
  if(refresh)await loadTeacher();
  if(render)renderTextbooks();
  if(notify)toast(`Учебник добавлен · перенесено привязок: ${rows.length}${missing.length?` · без совпавшей темы: ${missing.length}`:''}`);
  return true;
}
async function removeSharedTextbookFromPersonalLibrary(book){
  if(!book||textbookIsMine(book))return;
  if(!confirm(`Убрать «${book.title}» из моей библиотеки? Личные изменения страниц и тем для этого учебника будут удалены.`))return;
  const personalIds=textbookPersonalLinks(book).map(x=>x.id).filter(Boolean);
  for(let i=0;i<personalIds.length;i+=100){
    const {error}=await sb.from('textbook_topic_links').delete().in('id',personalIds.slice(i,i+100));
    if(error)return fail(error);
  }
  const {error}=await sb.from('teacher_textbook_library').delete().eq('teacher_id',S.user.id).eq('textbook_id',book.id);
  if(error)return fail(error);
  await loadTeacher();renderTextbooks();toast('Учебник убран из личной библиотеки');
}
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
async function linkTextbookModal({topicId='',textbookId='',sourceLink=null}={}){
  if(!S.textbooksFeatureAvailable)return toast('Сначала подключи библиотеку учебников через SQL v28.2');
  if(!(S.textbooks||[]).length)return toast('В библиотеке пока нет PDF');
  const topics=(S.topics||[]).slice().sort(curriculumBank()?.compareTopics||(()=>0));
  const books=(S.textbooks||[]).filter(b=>textbookIsMine(b)||b.is_shared);
  const bookLabel=b=>`${esc(b.title)}${b.author?` · ${esc(b.author)}`:''}${!textbookIsMine(b)?(textbookInPersonalLibrary(b)?' · из общей / моя копия':' · общая библиотека'):''}`;
  const initialFrom=Number(sourceLink?.page_from)||'',initialTo=Number(sourceLink?.page_to)||'',initialNote=sourceLink?.note||'';
  const m=modal(`<h2>Привязать учебник к теме</h2><div class="grid cols2"><div class="field"><label>Учебник</label><select id="ltBook">${books.map(x=>`<option value="${x.id}" ${String(x.id)===String(textbookId)?'selected':''}>${bookLabel(x)}</option>`).join('')}</select></div><div class="field"><label>Тема</label><select id="ltTopic">${topics.map(x=>`<option value="${x.id}" ${String(x.id)===String(topicId)?'selected':''}>${x.grade} кл. · ${esc(topicTrack(x))} · ${esc(x.title)}</option>`).join('')}</select></div></div><div class="grid cols3"><div class="field"><label>Страница от</label><input id="ltFrom" type="number" min="1" placeholder="42" value="${initialFrom}"></div><div class="field"><label>Страница до</label><input id="ltTo" type="number" min="1" placeholder="47" value="${initialTo}"></div><div class="field"><label>Комментарий</label><input id="ltNote" placeholder="§ 12, примеры 1–3" value="${esc(initialNote)}"></div></div><div class="notice" id="ltMappingHint">Общий учебник можно использовать сразу. Если для темы уже есть общая привязка, страницы подставятся автоматически. Сохранение создаёт вашу независимую копию.</div><button class="btn primary" id="ltSave">Сохранить мою привязку</button>`,'wide-modal');
  const fillFromSharedMapping=({force=false}={})=>{
    if(sourceLink&&!force)return;
    const book=(S.textbooks||[]).find(x=>String(x.id)===String(m.querySelector('#ltBook').value));
    const topic=(S.topics||[]).find(x=>String(x.id)===String(m.querySelector('#ltTopic').value));
    const from=m.querySelector('#ltFrom'),to=m.querySelector('#ltTo'),note=m.querySelector('#ltNote'),hint=m.querySelector('#ltMappingHint');
    if(!book||!topic||!book.is_shared){if(hint)hint.textContent='Укажи страницы, на которых раскрывается эта тема.';return}
    const master=textbookMasterLinks(book).find(link=>String(localTopicForSharedLink(link)?.id||'')===String(topic.id));
    if(!master){if(hint)hint.textContent='В общей карте для этой темы страницы не указаны — можно задать свою привязку вручную.';return}
    if(force||!from.value)from.value=master.page_from||'';
    if(force||!to.value)to.value=master.page_to||master.page_from||'';
    if(force||!note.value)note.value=master.note||'';
    if(hint)hint.innerHTML=`Найдена общая привязка: <b>${master.page_from?`стр. ${master.page_from}${master.page_to&&master.page_to!==master.page_from?`–${master.page_to}`:''}`:'страницы не указаны'}</b>. Можно использовать её как есть или изменить в личной копии.`;
  };
  m.querySelector('#ltBook').addEventListener('change',()=>fillFromSharedMapping({force:true}));
  m.querySelector('#ltTopic').addEventListener('change',()=>fillFromSharedMapping({force:true}));
  fillFromSharedMapping();
  m.querySelector('#ltSave').onclick=async()=>{
    const book=(S.textbooks||[]).find(x=>String(x.id)===String(m.querySelector('#ltBook').value));
    const topic=(S.topics||[]).find(x=>String(x.id)===String(m.querySelector('#ltTopic').value));
    if(!book||!topic)return toast('Выбери учебник и тему');
    if(!textbookIsMine(book)&&book.is_shared&&!textbookInPersonalLibrary(book)){
      const ok=await addSharedTextbookToPersonalLibrary(book,{refresh:true,render:false,notify:false});if(!ok)return;
    }
    const body={teacher_id:S.user.id,textbook_id:book.id,topic_id:topic.id,page_from:Number(m.querySelector('#ltFrom').value)||null,page_to:Number(m.querySelector('#ltTo').value)||null,note:m.querySelector('#ltNote').value.trim(),topic_grade:Number(topic.grade)||null,topic_section:topic.section||'',topic_title:topic.title||''};
    const {error}=await sb.from('textbook_topic_links').upsert(body,{onConflict:'textbook_id,topic_id'});if(error)return fail(error);
    m.remove();await loadTeacher();if(S.topic)S.topic=S.topics.find(x=>x.id===S.topic.id)||S.topic;renderTeacher();toast('Личная привязка сохранена');
  };
}

async function boot(){
  if(!configured)return configScreen();
  if(S.access)return bootStudent();
  if(!(await authStorageAvailable?.())){
    app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Браузер не сохраняет вход</h1><p>Для работы кабинета разреши локальное хранилище / данные сайта для Mathroom.</p></div></div>`;
    return;
  }
  const {data:{session},error:sessionError}=await sb.auth.getSession();
  if(sessionError)console.warn('[Mathroom getSession]',sessionError);
  if(!session||session.user.is_anonymous){
    await clearAuthSession();
    return renderAuth();
  }
  /* Older sessions existed before the 24-hour policy. Keep the currently signed-in
     teacher instead of unexpectedly logging them out, and start the 24-hour window now. */
  if(!(await authSessionExpiry()))await rememberAuthSession();
  if(!(await authSessionIsFresh())){
    await clearAuthSession();
    try{await sb.auth.signOut()}catch{}
    return renderAuth();
  }
  S.user=session.user;
  try{
    S.teacher=await ensureTeacher();
    await loadTeacher();
    const lessonRestored=restoreActiveLesson();
    if(!lessonRestored)restoreTeacherView();
    renderTeacher();
    startTeacherAccessWatch();
    syncCurriculumBank();
  }catch(e){
    console.error('[Mathroom teacher boot]',e);
    if(isTeacherAccessDisabledError(e)){
      await clearTeacherLogin();
      return renderTeacherAccessDisabled();
    }
    renderTeacherLoadError(e);
  }
}
function renderTeacherLoadError(error){
  const message=error?.message||'Не удалось загрузить кабинет.';
  app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Не удалось открыть кабинет</h1><p>${esc(message)}</p><div class="actions"><button class="btn primary" id="retryTeacherBoot">Повторить</button><button class="btn" id="loadErrorLogout">Выйти</button></div><div class="small muted" style="margin-top:12px">Авторизация сохранена. Повторно вводить пароль из-за ошибки загрузки не нужно.</div></div></div>`;
  document.getElementById('retryTeacherBoot').onclick=()=>boot().catch(e=>renderTeacherLoadError(e));
  document.getElementById('loadErrorLogout').onclick=async()=>{await clearAuthSession();try{await sb.auth.signOut()}catch{}S.user=S.teacher=null;renderAuth()};
}
function renderAuth(){
  app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Вход для преподавателя</h1><p>Доступ выдаётся администратором Mathroom.</p><form id="loginForm"><div class="field"><label>Email</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label>Пароль</label><input id="password" type="password" autocomplete="current-password" minlength="6" required></div><div class="actions"><button class="btn primary">Войти</button></div></form><div id="authMsg" class="small muted" style="margin-top:12px"></div></div></div>`;
  document.getElementById('loginForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const submit=form.querySelector('button[type="submit"],button:not([type])');
    const email=document.getElementById('email').value,password=document.getElementById('password').value,msg=document.getElementById('authMsg');
    if(submit?.disabled)return;
    if(!(await authStorageAvailable?.()))return msg.textContent='Браузер не дал открыть защищённое хранилище Mathroom. Разреши данные сайта и повтори вход.';
    if(submit){submit.disabled=true;submit.textContent='Входим…'}
    msg.textContent='';
    try{
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      if(error){
        if(isTeacherAccessDisabledError(error))throw teacherAccessDisabledError();
        throw error;
      }
      if(!data.session?.access_token||!data.session?.refresh_token)throw new Error('Supabase не вернул сессию входа');
      // signInWithPassword already persists the session when persistSession=true.
      // Calling setSession again here can serialize on the same auth lock and make
      // the UI look frozen after a successful password request.
      await new Promise(r=>setTimeout(r,0));
      const stored=await authStorage.getItem(AUTH_STORAGE_KEY);
      if(!stored)throw new Error('Браузер не сохранил сессию Mathroom в IndexedDB.');
      await rememberAuthSession();
      S.user=data.session.user||data.user;
      S.teacher=await ensureTeacher();
      await loadTeacher();
      const lessonRestored=restoreActiveLesson();
      if(!lessonRestored)restoreTeacherView();
      renderTeacher();
      startTeacherAccessWatch();
      syncCurriculumBank();
    }catch(err){
      console.error('[Mathroom teacher login]',err);
      if(isTeacherAccessDisabledError(err)){
        await clearTeacherLogin();
        return renderTeacherAccessDisabled();
      }
      msg.textContent=err?.message||'Не удалось открыть кабинет';
      if(submit){submit.disabled=false;submit.textContent='Войти'}
    }
  };
}

const nav=[['dashboard','Главная'],['schedule','Расписание'],['students','Ученики'],['topics','Темы'],['textbooks','Библиотека'],['bank','Банк задач'],['assignments','Задания'],['history','История'],['scratch','Черновик']];
function shell(content,title,sub=''){
  const workspace=['scratch','board','lesson'].includes(S.view);
  return `<div class="layout auto-sidebar ${workspace?'workspace-mode':''} view-${S.view}"><aside class="sidebar" aria-label="Главное меню"><div class="brand">Mathroom <span class="cloud-badge">☁ cloud</span></div><nav class="nav">${nav.map(([id,n])=>`<button data-nav="${id}" class="${S.view===id?'active':''}">${n}</button>`).join('')}</nav><div class="sidebar-footer"><button class="btn ghost sm sidebar-help" id="sidebarHelp" type="button">? Справка</button><button class="btn ghost sm" id="logout">Выйти</button></div></aside><main class="content"><div class="topbar"><div><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div></div>${content}</main></div>`;
}
function bindShell(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{cleanupAll();forgetActiveLesson();S.view=b.dataset.nav;S.topic=null;S.activeLesson=null;renderTeacher()});
  const l=document.getElementById('logout');if(l)l.onclick=async()=>{cleanupAll();forgetActiveLesson();if(teacherAccessWatch){clearInterval(teacherAccessWatch);teacherAccessWatch=null}await clearAuthSession();await sb.auth.signOut();S.user=S.teacher=null;renderAuth()};
}
function renderTeacher(){
  cleanupAll();
  if(S.view!=='lesson')rememberTeacherView(S.view);
  if(S.view==='students')return renderStudents();
  if(S.view==='profile')return renderStudentProfile(S.selectedStudent);
  if(S.view==='topics')return S.topic?renderTopic():renderTopics();
  if(S.view==='textbooks')return renderTextbooks();
  if(S.view==='bank')return renderBank();
  if(S.view==='schedule')return renderSchedule();
  if(S.view==='assignments')return renderAssignments();
  if(S.view==='history')return renderHistory();
  if(S.view==='scratch'){S.selectedStudent='__scratch__';return renderBoardPage()}
  if(S.view==='board'){S.view='scratch';S.selectedStudent='__scratch__';return renderBoardPage();}
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
  const all=(S.students||[]).slice();
  const classes=[...new Set(all.map(s=>Number(s.grade)).filter(Boolean))].sort((a,b)=>a-b);
  const namedGroups=[...new Set(all.map(s=>String(s.group_name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const activeCount=all.filter(s=>s.active!==false).length;
  const activePct=all.length?Math.round(activeCount*100/all.length):0;
  const state={query:'',grade:'all',group:'all',status:'all',sort:'grade',collapsed:new Set()};

  const initials=name=>String(name||'?').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x.charAt(0).toUpperCase()).join('')||'?';
  const studentLessons=id=>(S.lessons||[]).filter(l=>String(l.student_id)===String(id));
  const studentMeta=st=>{
    const lessons=studentLessons(st.id);
    const completed=lessons.filter(l=>l.status==='completed');
    const total=lessons.filter(l=>['assigned','in_progress','completed'].includes(l.status)).length;
    const progress=total?Math.round(completed.length*100/total):0;
    const dates=lessons.map(l=>l.completed_at||l.started_at||l.scheduled_at).filter(Boolean).map(v=>new Date(v)).filter(d=>!Number.isNaN(d.getTime())).sort((a,b)=>b-a);
    return {completed:completed.length,total,progress,last:dates[0]||null};
  };
  const ago=d=>{
    if(!d)return 'Нет занятий';
    const ms=Date.now()-d.getTime();
    if(ms<0)return dateLong(d.toISOString());
    const min=Math.floor(ms/60000);
    if(min<2)return 'Только что';
    if(min<60)return `${min} мин назад`;
    const h=Math.floor(min/60);
    if(h<24)return `${h} ч назад`;
    const days=Math.floor(h/24);
    if(days<30)return `${days} дн. назад`;
    return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:d.getFullYear()!==new Date().getFullYear()?'numeric':undefined});
  };
  const gradeTone=()=> 'brand';
  const studentStatIcon=kind=>{
    const common='class="mr-stat-icon-svg" viewBox="0 0 56 56" aria-hidden="true" focusable="false"';
    if(kind==='people')return `<svg ${common}>
      <circle class="mr-stat-orange-fill" cx="22" cy="20" r="8"/>
      <circle class="mr-stat-orange-fill" cx="36" cy="20" r="8"/>
      <path class="mr-stat-orange-fill" d="M10 45c1.2-10.2 7.1-15.5 14.5-15.5S37.8 34.8 39 45H10Z"/>
      <circle class="mr-stat-ink" cx="19" cy="18" r="7"/>
      <circle class="mr-stat-ink" cx="35" cy="18" r="7"/>
      <path class="mr-stat-ink" d="M8.5 44c.9-10 6.3-15.2 13.6-15.2 4.6 0 8.3 1.9 10.7 5.7"/>
      <path class="mr-stat-ink" d="M28.3 34.5c2.4-3.8 5.7-5.7 9.7-5.7 6.2 0 10.7 4.4 11.5 15.2"/>
      <path class="mr-stat-ink" d="M8.5 44h41"/>
    </svg>`;
    if(kind==='class')return `<svg ${common}>
      <rect class="mr-stat-orange-fill" x="29" y="8" width="17" height="40" rx="5"/>
      <rect class="mr-stat-orange-fill" x="21" y="12" width="17" height="40" rx="5" opacity=".72"/>
      <path class="mr-stat-ink" d="M8 12.5c7.8-2.8 15.2-1.7 20 2.4v32.2c-4.8-4.1-12.2-5.2-20-2.4V12.5Z"/>
      <path class="mr-stat-ink" d="M48 12.5c-7.8-2.8-15.2-1.7-20 2.4v32.2c4.8-4.1 12.2-5.2 20-2.4V12.5Z"/>
      <path class="mr-stat-ink" d="M28 15v32"/>
    </svg>`;
    if(kind==='group')return `<svg ${common}>
      <circle class="mr-stat-orange" cx="37.5" cy="18" r="7"/>
      <circle class="mr-stat-orange" cx="41" cy="35" r="10"/>
      <circle class="mr-stat-ink" cx="20" cy="18" r="7"/>
      <circle class="mr-stat-ink" cx="34" cy="19" r="6"/>
      <path class="mr-stat-ink" d="M7.5 44c1-9.3 5.7-14 12.7-14 7.2 0 11.9 4.7 12.8 14H7.5Z"/>
      <path class="mr-stat-ink" d="M29.5 32.4c1.8-2.2 4.4-3.4 7.5-3.4 6.2 0 10.3 4.7 11.2 14.1"/>
    </svg>`;
    return `<svg ${common}>
      <rect class="mr-stat-ink" x="7" y="30" width="9" height="17" rx="4.5"/>
      <rect class="mr-stat-ink" x="21" y="21" width="9" height="26" rx="4.5"/>
      <rect class="mr-stat-orange-fill" x="35" y="8" width="10" height="39" rx="5"/>
      <rect class="mr-stat-ink" x="38" y="16" width="9" height="31" rx="4.5"/>
    </svg>`;
  };
  const studentUiIcon=kind=>{
    const common='class="mr-student-ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    if(kind==='chevron')return `<svg ${common}><path d="M9 6l6 6-6 6"/></svg>`;
    if(kind==='collapse')return `<svg ${common}><path d="M6 14l6-6 6 6"/></svg>`;
    if(kind==='link')return `<svg ${common}><path d="M9.4 14.6l5.2-5.2"/><path d="M7.1 17.8l-1 .9a4 4 0 0 1-5.7-5.6l3.1-3.2a4 4 0 0 1 5.7 0"/><path d="M16.9 6.2l1-.9a4 4 0 0 1 5.7 5.6l-3.1 3.2a4 4 0 0 1-5.7 0"/></svg>`;
    if(kind==='profile')return `<svg ${common}><circle cx="10" cy="8" r="3"/><path d="M4 19c.7-4 2.7-6 6-6s5.3 2 6 6"/><path class="mr-ui-icon-accent" d="M18 9v6M15 12h6"/></svg>`;
    if(kind==='refresh')return `<svg ${common}><path d="M19 7V3l-2 2a8 8 0 1 0 2.2 8"/><path class="mr-ui-icon-accent" d="M19 3h-4"/></svg>`;
    if(kind==='more')return `<svg ${common}><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>`;
    return '';
  };

  const filterGlyph=kind=>{
    const common='class="mr-student-filter-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    if(kind==='grade')return `<svg ${common}><path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z"/><path d="M7 12v4.2c2.8 1.8 7.2 1.8 10 0V12"/><path class="accent" d="M20 10v5"/></svg>`;
    if(kind==='group')return `<svg ${common}><circle cx="9" cy="8" r="3"/><circle class="accent" cx="16.5" cy="9" r="2.5"/><path d="M3.5 19c.7-4 2.6-6 5.7-6 3.2 0 5.2 2 5.8 6"/><path class="accent" d="M14 14c3.6-.5 5.8 1.2 6.5 5"/></svg>`;
    return `<svg ${common}><circle cx="12" cy="12" r="7.5"/><path class="accent" d="m8.7 12.2 2.1 2.1 4.6-5"/></svg>`;
  };
  const classFilterRows=[{value:'all',label:'Все классы',count:all.length},...classes.map(g=>({value:String(g),label:`${g} класс`,count:all.filter(s=>Number(s.grade)===g).length}))];
  const groupFilterRows=[{value:'all',label:'Все группы',count:all.length},{value:'__none__',label:'Без группы',count:all.filter(s=>!String(s.group_name||'').trim()).length},...namedGroups.map(g=>({value:g,label:g,count:all.filter(s=>String(s.group_name||'').trim()===g).length}))];
  const statusFilterRows=[
    {value:'all',label:'Все ученики',count:all.length},
    {value:'active',label:'Активные',count:activeCount},
    {value:'inactive',label:'Неактивные',count:all.length-activeCount}
  ];
  const filterControlHtml=(id,kind,title,rows)=>`<div class="mr-student-segment-filter" data-student-filter="${kind}">
    <span class="mr-student-filter-label">${title}</span>
    <select id="${id}" class="mr-student-filter-native" tabindex="-1" aria-hidden="true">${rows.map(r=>`<option value="${esc(r.value)}">${esc(r.label)}</option>`).join('')}</select>
    <button class="mr-student-filter-trigger" type="button" data-student-filter-trigger aria-expanded="false">
      <span class="mr-student-filter-trigger-icon">${filterGlyph(kind)}</span>
      <span class="mr-student-filter-trigger-copy"><b data-student-filter-value>${esc(rows[0]?.label||'')}</b><small>${kind==='grade'?'Фильтр по классу':kind==='group'?'Фильтр по группе':'Фильтр по статусу'}</small></span>
      <span class="mr-student-filter-chevron">⌄</span>
    </button>
    <div class="mr-student-filter-popover" data-student-filter-popover hidden>
      <div class="mr-student-filter-pop-head"><span>${filterGlyph(kind)}</span><div><b>${title}</b><small>${rows.length} вариантов</small></div></div>
      <div class="mr-student-filter-segments">${rows.map((r,i)=>`<button type="button" class="${i===0?'active':''}" data-student-filter-option="${esc(r.value)}"><span>${esc(r.label)}</span><em>${r.count}</em></button>`).join('')}</div>
    </div>
  </div>`;

  const content=`
    <div class="mr-students-directory">
      <section class="mr-students-commandbar">
        <label class="mr-students-search"><span aria-hidden="true">⌕</span><input id="studentDirectorySearch" type="search" autocomplete="off" placeholder="Поиск по имени, классу или группе..."><kbd>Ctrl K</kbd></label>
        <button class="btn primary mr-students-add" id="addStudentDirectory">+&nbsp;&nbsp;Добавить ученика</button>
      </section>
      <section class="mr-students-overview">
        <div class="mr-student-stat"><span class="icon people">${studentStatIcon('people')}</span><div><b>${all.length}</b><small>Всего учеников</small></div></div>
        <div class="mr-student-stat"><span class="icon class">${studentStatIcon('class')}</span><div><b>${classes.length}</b><small>Классов</small></div></div>
        <div class="mr-student-stat"><span class="icon group">${studentStatIcon('group')}</span><div><b>${namedGroups.length}</b><small>Групп</small></div></div>
        <div class="mr-student-stat"><span class="icon active">${studentStatIcon('active')}</span><div><b>${activePct}%</b><small>Активных</small></div></div>
        <div class="mr-student-filters mr-student-filters-v5">
          ${filterControlHtml('studentGradeFilter','grade','Класс',classFilterRows)}
          ${filterControlHtml('studentGroupFilter','group','Группа',groupFilterRows)}
          ${filterControlHtml('studentStatusFilter','status','Статус',statusFilterRows)}
        </div>
      </section>
      <section class="mr-students-classes">
        <div class="mr-students-section-head"><div><h2>Классы</h2><span class="mr-students-count">${classes.length}</span></div><label class="mr-students-sort">Сортировка<select id="studentSort"><option value="grade">По классу</option><option value="name">По имени</option><option value="activity">По активности</option></select></label></div>
        <div class="mr-class-card-grid" id="studentClassCards"></div>
      </section>
      <section class="mr-students-list-section">
        <div class="mr-students-section-head"><div><h2>Список учеников</h2><span class="mr-students-count" id="studentFoundCount">${all.length}</span></div><button class="mr-students-clear-filter" id="studentClearFilters" type="button">Сбросить фильтры</button></div>
        <div id="studentDirectoryResults"></div>
      </section>
    </div>`;

  app.innerHTML=shell(content,'Ученики','Управляйте учениками, классами, группами и доступами к Mathroom');
  bindShell();

  const search=document.getElementById('studentDirectorySearch');
  const gradeFilter=document.getElementById('studentGradeFilter');
  const groupFilter=document.getElementById('studentGroupFilter');
  const statusFilter=document.getElementById('studentStatusFilter');
  const sort=document.getElementById('studentSort');
  const results=document.getElementById('studentDirectoryResults');
  const classCards=document.getElementById('studentClassCards');
  const found=document.getElementById('studentFoundCount');

  const closeStudentMoreMenus=(except=null)=>{
    document.querySelectorAll('.mr-student-more.is-open').forEach(menu=>{
      if(menu===except)return;
      menu.classList.remove('is-open');
      const trigger=menu.querySelector('[data-student-more-trigger]');
      const panel=menu.querySelector('[data-student-more-panel]');
      if(trigger)trigger.setAttribute('aria-expanded','false');
      if(panel)panel.hidden=true;
    });
  };
  if(window.__mrStudentMoreOutsideHandler){
    document.removeEventListener('pointerdown',window.__mrStudentMoreOutsideHandler,true);
    document.removeEventListener('focusin',window.__mrStudentMoreOutsideHandler,true);
  }
  if(window.__mrStudentMoreEscapeHandler){
    document.removeEventListener('keydown',window.__mrStudentMoreEscapeHandler,true);
  }
  window.__mrStudentMoreOutsideHandler=function studentMoreOutside(e){
    if(S.view!=='students')return;
    if(e.target?.closest?.('[data-student-more-trigger]'))return;
    if(e.target?.closest?.('[data-student-more-panel]'))return;
    closeStudentMoreMenus();
  };
  window.__mrStudentMoreEscapeHandler=function studentMoreEscape(e){
    if(S.view==='students'&&e.key==='Escape')closeStudentMoreMenus();
  };
  document.addEventListener('pointerdown',window.__mrStudentMoreOutsideHandler,true);
  document.addEventListener('focusin',window.__mrStudentMoreOutsideHandler,true);
  document.addEventListener('keydown',window.__mrStudentMoreEscapeHandler,true);

  const filterRowsByKind={grade:classFilterRows,group:groupFilterRows,status:statusFilterRows};
  const syncStudentFilterWidget=(select)=>{
    const widget=select?.closest('.mr-student-segment-filter');if(!widget)return;
    const rows=filterRowsByKind[widget.dataset.studentFilter]||[];
    const current=rows.find(r=>String(r.value)===String(select.value))||rows[0];
    const valueEl=widget.querySelector('[data-student-filter-value]');if(valueEl)valueEl.textContent=current?.label||'';
    widget.querySelectorAll('[data-student-filter-option]').forEach(b=>b.classList.toggle('active',String(b.dataset.studentFilterOption)===String(select.value)));
  };
  const bindStudentFilterWidget=(select)=>{
    const widget=select?.closest('.mr-student-segment-filter');if(!widget)return;
    const trigger=widget.querySelector('[data-student-filter-trigger]');
    const pop=widget.querySelector('[data-student-filter-popover]');
    const close=()=>{pop.hidden=true;trigger.classList.remove('open');trigger.setAttribute('aria-expanded','false')};
    const open=()=>{document.querySelectorAll('.mr-student-filter-popover:not([hidden])').forEach(x=>{if(x!==pop)x.hidden=true});document.querySelectorAll('.mr-student-filter-trigger.open').forEach(x=>{if(x!==trigger){x.classList.remove('open');x.setAttribute('aria-expanded','false')}});pop.hidden=false;trigger.classList.add('open');trigger.setAttribute('aria-expanded','true')};
    trigger.onclick=()=>pop.hidden?open():close();
    widget.querySelectorAll('[data-student-filter-option]').forEach(b=>b.onclick=()=>{select.value=b.dataset.studentFilterOption;select.dispatchEvent(new Event('change',{bubbles:true}));syncStudentFilterWidget(select);close()});
    document.addEventListener('pointerdown',function outside(e){if(!document.body.contains(widget)){document.removeEventListener('pointerdown',outside);return}if(!widget.contains(e.target))close()});
    syncStudentFilterWidget(select);
  };
  [gradeFilter,groupFilter,statusFilter].forEach(bindStudentFilterWidget);
  const syncAllStudentFilters=()=>[gradeFilter,groupFilter,statusFilter].forEach(syncStudentFilterWidget);

  const openStudentEditor=(st=null)=>{
    const groupOptions=[...new Set((S.students||[]).map(x=>String(x.group_name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const m=modal(`
      <div class="mr-card-head"><div><span class="pill">${st?'Профиль':'Новый ученик'}</span><h2>${st?'Изменить ученика':'Добавить ученика'}</h2><p class="muted">Имя, класс и группа используются для быстрого поиска и организации списка.</p></div></div>
      <form id="studentDirectoryForm" class="mr-student-edit-form">
        <div class="field"><label>Имя</label><input id="sdName" required autocomplete="off" value="${st?esc(st.name):''}" placeholder="Иван Петров"></div>
        <div class="grid cols2">
          <div class="field"><label>Класс</label><select id="sdGrade">${Array.from({length:11},(_,i)=>`<option value="${i+1}" ${Number(st?.grade)===i+1?'selected':''}>${i+1} класс</option>`).join('')}</select></div>
          <div class="field"><label>Группа</label><input id="sdGroup" list="studentGroupNames" value="${st?esc(st.group_name||''):''}" placeholder="Например, ОГЭ или Олимпиада"><datalist id="studentGroupNames">${groupOptions.map(g=>`<option value="${esc(g)}"></option>`).join('')}</datalist></div>
        </div>
        ${st?`<div class="field"><label>Статус</label><select id="sdActive"><option value="1" ${st.active!==false?'selected':''}>Активный ученик</option><option value="0" ${st.active===false?'selected':''}>Неактивный</option></select></div>`:''}
        <div class="actions"><button class="btn primary" type="submit">${st?'Сохранить':'Добавить ученика'}</button><button class="btn" type="button" id="studentDirectoryCancel">Отмена</button></div>
      </form>`,'wide-modal');
    m.querySelector('#studentDirectoryCancel').onclick=()=>m.remove();
    m.querySelector('#studentDirectoryForm').onsubmit=async e=>{
      e.preventDefault();
      const name=m.querySelector('#sdName').value.trim();
      if(!name)return toast('Укажи имя ученика');
      const body={name,grade:Number(m.querySelector('#sdGrade').value),group_name:m.querySelector('#sdGroup').value.trim()};
      if(st)body.active=m.querySelector('#sdActive').value==='1';
      else{body.teacher_id=S.user.id;body.access_token=token()}
      const req=st?sb.from('students').update(body).eq('id',st.id):sb.from('students').insert(body);
      const {error}=await req;
      if(error)return fail(error);
      m.remove();await loadTeacher();renderStudents();toast(st?'Ученик обновлён':'Ученик создан');
    };
    setTimeout(()=>m.querySelector('#sdName')?.focus(),0);
  };

  const bindRowActions=()=>{
    results.querySelectorAll('.mr-student-more').forEach(menu=>{
      const trigger=menu.querySelector('[data-student-more-trigger]');
      const panel=menu.querySelector('[data-student-more-panel]');
      if(!trigger||!panel)return;
      trigger.onclick=e=>{
        e.preventDefault();e.stopPropagation();
        const wasOpen=menu.classList.contains('is-open');
        closeStudentMoreMenus();
        if(!wasOpen){
          menu.classList.add('is-open');
          trigger.setAttribute('aria-expanded','true');
          panel.hidden=false;
        }
      };
    });
    results.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{closeStudentMoreMenus();S.selectedStudent=b.dataset.profile;S.view='profile';renderTeacher()});
    results.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{closeStudentMoreMenus();const st=S.students.find(x=>x.id===b.dataset.copy);if(!st)return;await copyText(studentLink(st));toast('Ссылка скопирована')});
    results.querySelectorAll('[data-edit-student]').forEach(b=>b.onclick=()=>{closeStudentMoreMenus();const st=S.students.find(x=>x.id===b.dataset.editStudent);if(st)openStudentEditor(st)});
    results.querySelectorAll('[data-rotate]').forEach(b=>b.onclick=async()=>{if(!confirm('Старая ссылка перестанет работать. Продолжить?'))return;const {error}=await sb.rpc('rotate_student_access',{p_student_id:b.dataset.rotate});if(error)return fail(error);await loadTeacher();renderStudents();toast('Новая ссылка создана')});
    results.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить ученика и его данные?'))return;const {error}=await sb.from('students').delete().eq('id',b.dataset.delete);if(error)return fail(error);await loadTeacher();renderStudents();toast('Ученик удалён')});
    results.querySelectorAll('[data-class-toggle]').forEach(b=>b.onclick=()=>{const g=String(b.dataset.classToggle);if(state.collapsed.has(g))state.collapsed.delete(g);else state.collapsed.add(g);paint()});
  };

  const paint=()=>{
    syncAllStudentFilters();
    const q=state.query.trim().toLocaleLowerCase('ru');
    let rows=(S.students||[]).filter(st=>{
      const group=String(st.group_name||'').trim();
      const hay=[st.name,`${st.grade} класс`,`${st.grade} кл`,group].join(' ').toLocaleLowerCase('ru');
      if(q&&!hay.includes(q))return false;
      if(state.grade!=='all'&&Number(st.grade)!==Number(state.grade))return false;
      if(state.group==='__none__'&&group)return false;
      if(state.group!=='all'&&state.group!=='__none__'&&group!==state.group)return false;
      if(state.status==='active'&&st.active===false)return false;
      if(state.status==='inactive'&&st.active!==false)return false;
      return true;
    });
    rows.sort((a,b)=>{
      if(state.sort==='name')return String(a.name).localeCompare(String(b.name),'ru');
      if(state.sort==='activity'){const am=studentMeta(a).last?.getTime()||0,bm=studentMeta(b).last?.getTime()||0;return bm-am||String(a.name).localeCompare(String(b.name),'ru')}
      return Number(a.grade)-Number(b.grade)||String(a.name).localeCompare(String(b.name),'ru');
    });
    found.textContent=String(rows.length);

    classCards.innerHTML=classes.map(g=>{
      const members=(S.students||[]).filter(s=>Number(s.grade)===g);
      const active=members.filter(s=>s.active!==false).length;
      const pct=members.length?Math.round(active*100/members.length):0;
      const selected=state.grade!=='all'&&Number(state.grade)===g;
      return `<button class="mr-class-card tone-${gradeTone(g)} ${selected?'selected':''}" data-grade-card="${g}" type="button"><span class="mr-class-icon">${g}</span><span class="mr-class-copy"><b>${g} класс</b><small>${members.length} ${members.length===1?'ученик':members.length<5?'ученика':'учеников'}</small><em><i style="width:${pct}%"></i></em><small>${pct}% активных</small></span><span class="mr-class-arrow">${studentUiIcon('chevron')}</span></button>`;
    }).join('')||'<div class="empty">Классов пока нет.</div>';
    classCards.querySelectorAll('[data-grade-card]').forEach(b=>b.onclick=()=>{const g=b.dataset.gradeCard;state.grade=state.grade===g?'all':g;gradeFilter.value=state.grade;paint()});

    const grouped=new Map();
    for(const st of rows){const g=Number(st.grade)||0;if(!grouped.has(g))grouped.set(g,[]);grouped.get(g).push(st)}
    results.innerHTML=rows.length?[...grouped.entries()].map(([g,members])=>{
      const collapsed=state.collapsed.has(String(g));
      return `<section class="mr-student-grade-block ${collapsed?'collapsed':''}">
        <button class="mr-student-grade-head" data-class-toggle="${g}" type="button"><span class="mr-grade-chip tone-${gradeTone(g)}">${g}</span><span><b>${g} класс</b><small>${members.length} ${members.length===1?'ученик':members.length<5?'ученика':'учеников'}</small></span><span class="mr-grade-chevron">${studentUiIcon('collapse')}</span></button>
        <div class="mr-student-table">
          <div class="mr-student-table-head"><span>Ученик</span><span>Группа</span><span>Прогресс</span><span>Последняя активность</span><span>Доступ</span><span>Действия</span></div>
          ${members.map(st=>{
            const meta=studentMeta(st),group=String(st.group_name||'').trim();
            return `<article class="mr-student-directory-row ${st.active===false?'inactive':''}">
              <div class="mr-student-identity"><span class="mr-student-avatar tone-${gradeTone(st.grade)}">${esc(initials(st.name))}</span><div><b>${esc(st.name)}</b><small>${st.grade} класс${st.active===false?' · неактивен':''}</small></div></div>
              <div class="mr-student-group-cell">${group?`<span>${esc(group)}</span>`:'<span class="empty-group">Без группы</span>'}</div>
              <div class="mr-student-progress-cell"><b>${meta.completed} завершено</b><div><i style="width:${meta.progress}%"></i></div><small>${meta.total?meta.progress+'%':'нет уроков'}</small></div>
              <div class="mr-student-activity-cell"><span class="${st.active===false?'off':'on'}"></span><div><b>${esc(ago(meta.last))}</b><small>${meta.last?meta.last.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}):'—'}</small></div></div>
              <div class="mr-student-link-cell"><button type="button" data-copy="${st.id}" title="Скопировать персональную ссылку" aria-label="Скопировать персональную ссылку">${studentUiIcon('link')}</button></div>
              <div class="mr-student-row-actions"><button class="btn sm primary mr-student-profile-action" data-profile="${st.id}">${studentUiIcon('profile')}<span>Профиль</span></button><button class="btn sm mr-student-refresh-action" data-rotate="${st.id}">${studentUiIcon('refresh')}<span>Новая ссылка</span></button><div class="mr-student-more"><button type="button" class="mr-student-more-trigger" data-student-more-trigger aria-haspopup="menu" aria-expanded="false" title="Ещё" aria-label="Ещё действия">${studentUiIcon('more')}</button><div class="mr-student-more-popover" data-student-more-panel role="menu" hidden><button type="button" data-edit-student="${st.id}" role="menuitem">Редактировать</button><button type="button" data-copy="${st.id}" role="menuitem">Копировать ссылку</button><button type="button" class="danger" data-delete="${st.id}" role="menuitem">Удалить ученика</button></div></div></div>
            </article>`;
          }).join('')}
        </div>
      </section>`;
    }).join(''):'<div class="mr-students-empty"><span>⌕</span><h3>Ничего не найдено</h3><p>Измени запрос или сбрось фильтры.</p></div>';
    bindRowActions();
  };

  search.oninput=()=>{state.query=search.value;paint()};
  gradeFilter.onchange=()=>{state.grade=gradeFilter.value;paint()};
  groupFilter.onchange=()=>{state.group=groupFilter.value;paint()};
  statusFilter.onchange=()=>{state.status=statusFilter.value;paint()};
  sort.onchange=()=>{state.sort=sort.value;paint()};
  document.getElementById('studentClearFilters').onclick=()=>{state.query='';state.grade='all';state.group='all';state.status='all';state.sort='grade';search.value='';gradeFilter.value='all';groupFilter.value='all';statusFilter.value='all';sort.value='grade';syncAllStudentFilters();paint()};
  document.getElementById('addStudentDirectory').onclick=()=>openStudentEditor();
  document.addEventListener('keydown',function studentDirectoryShortcut(e){if(S.view!=='students'){document.removeEventListener('keydown',studentDirectoryShortcut);return}if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='k'){e.preventDefault();search.focus();search.select()}});
  paint();
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
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:14px"><button class="btn" id="backStudents">← Ученики</button><button class="btn" id="profileLink">Скопировать ссылку</button></div><div class="card student-profile-head"><div><span class="pill">${st.grade} класс</span><h2>${esc(st.name)}</h2></div><div class="profile-edit"><input id="profileName" value="${esc(st.name)}"><select id="profileGrade">${Array.from({length:11},(_,i)=>`<option ${i+1===st.grade?'selected':''}>${i+1}</option>`).join('')}</select><input id="profileGroup" value="${esc(st.group_name||'')}" placeholder="Группа"><button class="btn sm" id="saveProfile">Сохранить</button></div></div><div class="grid cols4 profile-metrics"><div class="card"><div class="muted">Уроков завершено</div><div class="metric">${a.completed}</div></div><div class="card"><div class="muted">Уверенно за 3 урока</div><div class="metric">${a.recentAvg==null?'—':a.recentAvg+'%'}</div><div class="small ${trendClass}">${trend}</div></div><div class="card"><div class="muted">Средний тест</div><div class="metric">${a.avgTest==null?'—':a.avgTest+'%'}</div></div><div class="card"><div class="muted">Времени занятий</div><div class="metric">${a.totalSeconds?hours+' ч':'—'}</div></div></div>${pathSuggestion?`<div class="card mr-profile-next-topic"><div><span class="pill">Следующая тема по программе</span><h2>${esc(pathSuggestion.topic.title)}</h2><p class="muted">${pathSuggestion.topic.grade} класс · ${esc(topicTrack(pathSuggestion.topic))}${pathSuggestion.after?` · после «${esc(pathSuggestion.after.title)}»`:''}</p></div><div class="actions"><button class="btn" id="profileNextTopic">Открыть тему</button><button class="btn primary" id="profileScheduleNext">Запланировать</button></div></div>`:''}<div class="grid cols2" style="margin-top:16px"><div class="card"><div class="mr-card-head"><h2>Динамика уроков</h2><span class="pill">последние ${Math.min(8,a.reports.length)}</span></div>${reportTrendHtml(a)}</div><div class="card"><h2>Что требует внимания</h2>${focusHtml}${a.weakTags.length?`<div class="mr-tag-cloud">${a.weakTags.slice(0,8).map(t=>`<span class="pill">#${esc(t.name)} · ${t.attention}</span>`).join('')}</div>`:''}</div></div><div class="grid cols2" style="margin-top:16px"><div class="card"><h2>Рекомендации на следующий урок</h2>${recommendations.length?recommendations.map(e=>`<div class="item-box"><b>${esc(e.title||'Задача')}</b><div class="small muted">${esc(e.category||'')} · ${diffLabel(e.difficulty)} ${(e.tags||[]).map(t=>'#'+esc(t)).join(' ')}</div><div class="prewrap">${nl(e.content)}</div></div>`).join(''):'<div class="empty">Пока нет данных для рекомендаций.</div>'}</div><div class="card"><h2>Последние отчёты</h2>${a.reports.length?a.reports.slice(-5).reverse().map(r=>{const l=S.lessons.find(x=>x.id===r.lesson_id);return `<div class="mr-report-mini"><div><b>${esc(l?.topics?.title||'Урок')}</b><span>${new Date(r.created_at).toLocaleDateString('ru-RU')}</span></div><div class="actions"><span class="pill">✓ ${r.solved_count}/${r.queue_total}</span><span class="pill">${Math.round(Number(r.solved_percent||0))}% уверенно</span></div>${r.public_focus?`<p class="small muted">Повторить: ${esc(r.public_focus)}</p>`:''}</div>`}).join(''):'<div class="empty">Отчётов пока нет.</div>'}</div></div><div class="section-title"><h2>Ближайшие уроки</h2></div><div class="list">${upcoming.length?upcoming.map(l=>`<div class="row"><div><h3>${esc(l.topics?.title||'Урок')}</h3><p>${dateLong(l.scheduled_at)}</p></div></div>`).join(''):'<div class="empty">Нет запланированных уроков.</div>'}</div>`,'Профиль ученика','Динамика считается по урокам, домашним и тестам');bindShell();
  document.getElementById('backStudents').onclick=()=>{S.view='students';renderTeacher()};document.getElementById('profileLink').onclick=async()=>{await copyText(studentLink(st));toast('Ссылка скопирована')};
  document.getElementById('profileNextTopic')?.addEventListener('click',()=>{S.topic=pathSuggestion.topic;S.topicGradeFilter=Number(pathSuggestion.topic.grade);S.view='topics';renderTeacher()});document.getElementById('profileScheduleNext')?.addEventListener('click',()=>{S.schedulePrefill={studentId:st.id,topicId:pathSuggestion.topic.id};S.view='schedule';renderTeacher()});
  document.getElementById('saveProfile').onclick=async()=>{const {error}=await sb.from('students').update({name:document.getElementById('profileName').value.trim(),grade:Number(document.getElementById('profileGrade').value),group_name:document.getElementById('profileGroup').value.trim()}).eq('id',st.id);if(error)return fail(error);await loadTeacher();renderStudentProfile(st.id);toast('Профиль сохранён')};
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
  const topicCardIcon=t=>{
    const q=(String(t.title||'')+' '+String(t.section||'')).toLocaleLowerCase('ru');
    const common='class="mr-topic-card-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    if(/сравнен/.test(q))return `<svg ${common}><circle cx="7" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/><path class="accent" d="m12 7 5-3v6l-5-3Zm0 10 5-3v6l-5-3Z"/></svg>`;
    if(/состав чис/.test(q))return `<svg ${common}><circle cx="12" cy="6" r="2.5"/><circle cx="7" cy="16" r="2.5"/><circle class="accent" cx="17" cy="16" r="2.5"/><path d="m10.7 8.2-2.3 4.6m4.9-4.6 2.3 4.6"/></svg>`;
    if(/сложен|вычитан/.test(q))return `<svg ${common}><path d="M4 8h7M7.5 4.5v7"/><path class="accent" d="M14 16h6"/></svg>`;
    if(/переход|десят/.test(q))return `<svg ${common}><path d="M4.5 17.5a7.5 7.5 0 0 1 15 0"/><path d="M8 17.5a4 4 0 0 1 8 0"/><path class="accent" d="M12 17.5h.01"/></svg>`;
    if(/100|сот/.test(q))return `<svg ${common}><text x="3" y="16.5" class="mr-topic-svg-text">100</text></svg>`;
    if(/задач/.test(q))return `<svg ${common}><path d="M6 3.8h9l3 3V20H6z"/><path class="accent" d="M15 3.8V7h3M9 11h6M9 15h5"/></svg>`;
    if(/длина|метр|сантим/.test(q))return `<svg ${common}><path d="m5 17 12-12 3 3L8 20z"/><path class="accent" d="m10 12 2 2m1-5 2 2m-8 4 2 2"/></svg>`;
    if(/время|час/.test(q))return `<svg ${common}><circle cx="12" cy="12" r="8"/><path class="accent" d="M12 7v5l3 2"/></svg>`;
    if(/периметр|фигур|геометр/.test(q))return `<svg ${common}><path d="m12 3 7 4v10l-7 4-7-4V7z"/><path class="accent" d="m5 7 7 4 7-4M12 11v10"/></svg>`;
    return `<svg ${common}><rect x="5" y="4" width="14" height="16" rx="3"/><path class="accent" d="M8 9h8M8 13h5"/></svg>`;
  };
  const routeIcon=`<svg class="mr-topic-route-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.3-1.2 6-.6 8 1.1v12c-2-1.7-4.7-2.3-8-1.1v-12Z"/><path d="M20 5.5c-3.3-1.2-6-.6-8 1.1v12c2-1.7 4.7-2.3 8-1.1v-12Z"/><path class="accent" d="M12 6.6v12"/></svg>`;
  const editTopicIcon=`<svg class="mr-topic-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l3.8-.9L18 8.9 15.1 6 5.9 15.2 5 19Z"/><path class="accent" d="m13.7 7.4 2.9 2.9"/></svg>`;
  const deleteTopicIcon=`<svg class="mr-topic-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.7 12h7.6l.7-12"/><path class="accent" d="M10 11v4M14 11v4"/></svg>`;
  const countTopicIcon=`<svg class="mr-topic-count-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 7 4-7 4-7-4 7-4Z"/><path d="m5 12 7 4 7-4"/><path class="accent" d="m5 16 7 4 7-4"/></svg>`;
  const gradeTabs=Array.from({length:11},(_,i)=>i+1).map(g=>`<button class="mr-topic-grade-tab ${g===grade?'active':''}" data-topic-grade="${g}">${g}</button>`).join('');
  const groupsHtml=[...groups.entries()].map(([track,rows])=>`<section class="mr-curriculum-track mr-topic-track-v2">
    <div class="mr-curriculum-track-head mr-topic-track-head-v2"><div><span class="mr-topic-track-kicker">${esc(track)}</span><h2>${grade} класс</h2></div><span class="mr-topic-count">${countTopicIcon}<b>${rows.length} тем</b></span></div>
    <div class="mr-curriculum-list mr-topic-card-grid">${rows.map((t,i)=>{const count=S.exercises.filter(e=>e.topic_id===t.id&&e.kind==='task').length,meta=topicMeta(t);return `<article class="mr-curriculum-row mr-topic-card-v2 ${meta?'':'custom'}" data-topic="${t.id}">
      <div class="mr-topic-seq">${meta?String(i+1).padStart(2,'0'):'+'}</div>
      <div class="mr-topic-card-icon">${topicCardIcon(t)}</div>
      <div class="mr-curriculum-main mr-topic-card-main"><div class="small muted">${esc(t.section||track)}</div><h3>${esc(t.title)}</h3><div class="small mr-topic-card-meta"><span>${count} задач</span><span>${t.theory?'теория готова':'без теории'}</span>${meta?'':'<span>своя тема</span>'}</div></div>
      <div class="actions mr-topic-card-actions"><button class="btn sm mr-topic-edit" data-edit-topic="${t.id}">${editTopicIcon}<span>Редактировать</span></button><button class="btn sm danger mr-topic-delete" data-delete-topic="${t.id}">${deleteTopicIcon}<span>Удалить</span></button><span class="mr-row-arrow">→</span></div>
    </article>`}).join('')}</div>
  </section>`).join('');
  app.innerHTML=shell(`<div class="card mr-curriculum-head mr-topic-route-card">
    <div class="mr-topic-route-main"><span class="mr-topic-route-icon">${routeIcon}</span><div><h2>Школьный маршрут</h2><p class="muted">Темы идут в учебной последовательности. В 7–11 классах алгебра и геометрия идут отдельными линиями, чтобы их можно было чередовать по расписанию.</p></div></div>
    <div class="mr-grade-tabs mr-topic-grade-tabs">${gradeTabs}</div>
  </div>
  ${groupsHtml||'<div class="empty">Для этого класса тем пока нет.</div>'}
  <details class="form-card mr-topic-create"><summary><b>+ Добавить свою тему</b><span class="small muted">Она появится после готовой школьной последовательности</span></summary><form id="topicForm"><div class="grid cols3"><div class="field"><label>Класс</label><select id="tpGrade">${Array.from({length:11},(_,i)=>`<option ${i+1===grade?'selected':''}>${i+1}</option>`).join('')}</select></div><div class="field"><label>Раздел</label><input id="tpSection" placeholder="Алгебра"></div><div class="field"><label>Тема</label><input id="tpTitle" required placeholder="Квадратные уравнения"></div></div><div class="field"><label>Теория</label><textarea id="tpTheory" rows="6" placeholder="Можно использовать блоки: ## Суть, ## Как действовать, ## Пример, ## Запомни, ## Частая ошибка"></textarea></div><button class="btn primary">Создать тему</button></form></details>`,'Темы',`${grade} класс · последовательная программа`);bindShell();
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

function sharedMaterialForExercise(exerciseId){
  return (S.sharedMaterials||[]).find(x=>
    String(x.source_exercise_id||'')===String(exerciseId||'') &&
    String(x.published_by||'')===String(S.user?.id||'')
  )||null;
}
function sharedMaterialUserTags(tags=[]){
  return (tags||[]).filter(tag=>{
    const v=String(tag||'');
    return v&&!v.startsWith('mathroom-core-bank-v')&&!v.startsWith('mrseed:')&&!v.startsWith('класс-')&&!v.startsWith('тема:');
  });
}
async function publishExerciseToSharedLibrary(exercise,{onDone}={}){
  if(!exercise||!S.user)return;
  const topic=(S.topics||[]).find(t=>String(t.id)===String(exercise.topic_id));
  if(!topic)return toast('Не найдена тема материала');
  const old=sharedMaterialForExercise(exercise.id);
  const body={
    published_by:S.user.id,
    source_exercise_id:exercise.id,
    kind:exercise.kind==='example'?'example':'task',
    title:exercise.title||'',
    content:exercise.content||'',
    answer:exercise.answer||'',
    difficulty:exercise.difficulty||'basic',
    category:exercise.category||'',
    tags:sharedMaterialUserTags(exercise.tags),
    grade:Number(topic.grade)||null,
    section:topic.section||'',
    topic_title:topic.title||''
  };
  const q=old
    ? sb.from('shared_materials').update({...body,updated_at:new Date().toISOString()}).eq('id',old.id)
    : sb.from('shared_materials').insert(body);
  const {error}=await q;if(error)return fail(error);
  await loadTeacher();onDone?.();
  toast(old?'Версия в общей библиотеке обновлена':'Материал добавлен в общую библиотеку');
}
async function unpublishExerciseFromSharedLibrary(exercise,{onDone}={}){
  const old=sharedMaterialForExercise(exercise?.id);if(!old)return;
  if(!confirm('Убрать этот материал из общей библиотеки? Личные копии других преподавателей останутся у них.'))return;
  const {error}=await sb.from('shared_materials').delete().eq('id',old.id);if(error)return fail(error);
  await loadTeacher();onDone?.();toast('Материал убран из общей библиотеки');
}
function importSharedMaterial(shared,{onDone}={}){
  if(!shared)return;
  const topics=(S.topics||[]).slice().sort(curriculumBank()?.compareTopics||(()=>0));
  const sameGrade=topics.filter(t=>Number(t.grade)===Number(shared.grade));
  const ordered=[...sameGrade,...topics.filter(t=>Number(t.grade)!==Number(shared.grade))];
  if(!ordered.length)return toast('Сначала создай тему, куда добавить материал');
  const m=modal(`<div class="mr-card-head"><div><span class="pill">Общая библиотека</span><h2>Добавить себе</h2><p class="muted">Создаст независимую копию. Дальнейшие изменения не затронут других преподавателей.</p></div></div>
    <div class="card mr-library-import-preview"><span class="pill">${shared.kind==='example'?'Пример':'Задача'} · ${shared.grade||'?'} класс</span><h3>${esc(shared.title||'Материал')}</h3><div class="prewrap">${nl(shared.content||'')}</div></div>
    <div class="field"><label>В какую мою тему добавить</label><select id="sharedImportTopic">${ordered.map(t=>`<option value="${t.id}">${t.grade} кл. · ${esc(t.section||'Математика')} · ${esc(t.title)}</option>`).join('')}</select></div>
    <div class="actions"><button class="btn primary" id="sharedImportSave">Добавить личную копию</button></div>`,'wide-modal');
  m.querySelector('#sharedImportSave').onclick=async()=>{
    const topic=(S.topics||[]).find(t=>String(t.id)===String(m.querySelector('#sharedImportTopic').value));
    if(!topic)return toast('Выбери тему');
    const tags=[`класс-${topic.grade}`,`тема:${topic.title}`,...sharedMaterialUserTags(shared.tags)];
    const body={
      teacher_id:S.user.id,topic_id:topic.id,kind:shared.kind==='example'?'example':'task',
      title:shared.title||'',content:shared.content||'',answer:shared.answer||'',
      difficulty:shared.difficulty||'basic',category:shared.category||'',tags:[...new Set(tags)]
    };
    const {error}=await sb.from('exercises').insert(body);if(error)return fail(error);
    m.remove();await loadTeacher();onDone?.();toast('Личная копия добавлена');
  };
}

function renderTopic(){
  const t=S.topic;if(!t)return renderTopics();const items=S.exercises.filter(x=>x.topic_id===t.id),tasks=items.filter(x=>x.kind==='task'),examples=items.filter(x=>x.kind==='example'),next=nextCurriculumTopic(t),pos=topicPosition(t),sources=textbookLinksForTopic(t.id),curriculumSource=topicSourceMeta(t);
  const studentOpts=S.students.map(s=>`<option value="${s.id}">${esc(s.name)} · ${s.grade} кл.</option>`).join('');
  const topicMaterialIcon=kind=>{
    const common='class="mr-topic-material-svg" viewBox="0 0 24 24" aria-hidden="true"';
    if(kind==='example')return `<svg ${common}><path d="M5 8h14M5 16h14"/><path class="accent" d="M8 5v6M16 13v6"/></svg>`;
    if(kind==='task')return `<svg ${common}><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M8 9h8M8 13h5"/><path class="accent" d="m8 16 1.5 1.5L12 15"/></svg>`;
    if(kind==='book')return `<svg ${common}><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Z"/><path class="accent" d="M20 5.5c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>`;
    if(kind==='edit')return `<svg ${common}><path d="M5 19l3.8-.9L18 8.9 15.1 6 5.9 15.2 5 19Z"/><path class="accent" d="m13.7 7.4 2.9 2.9"/></svg>`;
    if(kind==='trash')return `<svg ${common}><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.7 12h7.6l.7-12"/><path class="accent" d="M10 11v4M14 11v4"/></svg>`;
    if(kind==='board')return `<svg ${common}><rect x="4" y="5" width="16" height="11" rx="2.5"/><path class="accent" d="M9 20h6M12 16v4"/></svg>`;
    if(kind==='pdf')return `<svg ${common}><path d="M6 4h9l3 3v13H6z"/><path class="accent" d="M15 4v4h4M9 12h6M9 16h4"/></svg>`;
    return '';
  };
  const examplesHtml=examples.length?examples.map((x,i)=>`<article class="mr-topic-practice-card example">
    <div class="mr-topic-practice-index">${String(i+1).padStart(2,'0')}</div>
    <div class="mr-topic-practice-icon">${topicMaterialIcon('example')}</div>
    <div class="mr-topic-practice-main"><span class="mr-topic-practice-kicker">Пример</span><h3>${esc(x.title||`Пример ${i+1}`)}</h3><div class="prewrap">${nl(x.content)}</div></div>
    <div class="mr-topic-practice-actions">${sharedMaterialForExercise(x.id)?`<button type="button" class="library" data-share-material="${x.id}"><span>↻</span><span>Обновить общую</span></button><button type="button" class="danger subtle" data-unshare-material="${x.id}"><span>×</span><span>Убрать из общей</span></button>`:`<button type="button" class="library" data-share-material="${x.id}"><span>＋</span><span>В общую</span></button>`}<button type="button" data-edit-material="${x.id}">${topicMaterialIcon('edit')}<span>Редактировать</span></button><button type="button" class="danger" data-delete-material="${x.id}">${topicMaterialIcon('trash')}<span>Удалить</span></button></div>
  </article>`).join(''):`<div class="mr-topic-empty-state"><span>${topicMaterialIcon('example')}</span><div><b>Примеров пока нет</b><small>Добавь первый пример через редактор ниже.</small></div></div>`;
  const tasksHtml=tasks.length?tasks.map((x,i)=>`<article class="mr-topic-practice-card task">
    <div class="mr-topic-practice-index">${String(i+1).padStart(2,'0')}</div>
    <div class="mr-topic-practice-icon">${topicMaterialIcon('task')}</div>
    <div class="mr-topic-practice-main">
      <div class="mr-topic-practice-meta"><span>${diffLabel(x.difficulty)}</span>${x.category?`<span>${esc(x.category)}</span>`:''}</div>
      <h3>${esc(x.title||`Задача ${i+1}`)}</h3><div class="prewrap">${nl(x.content)}</div>
      <div class="mr-topic-practice-answer"><b>Ответ</b><span>${esc(x.answer||'—')}</span>${exerciseEditableTags(x.tags).length?`<small>${exerciseEditableTags(x.tags).map(z=>'#'+esc(z)).join(' ')}</small>`:''}</div>
    </div>
    <div class="mr-topic-practice-actions">${sharedMaterialForExercise(x.id)?`<button type="button" class="library" data-share-material="${x.id}"><span>↻</span><span>Обновить общую</span></button><button type="button" class="danger subtle" data-unshare-material="${x.id}"><span>×</span><span>Убрать из общей</span></button>`:`<button type="button" class="library" data-share-material="${x.id}"><span>＋</span><span>В общую</span></button>`}<button type="button" data-edit-material="${x.id}">${topicMaterialIcon('edit')}<span>Редактировать</span></button><button type="button" class="danger" data-delete-material="${x.id}">${topicMaterialIcon('trash')}<span>Удалить</span></button></div>
  </article>`).join(''):`<div class="mr-topic-empty-state"><span>${topicMaterialIcon('task')}</span><div><b>Задач пока нет</b><small>Добавь первую задачу в редакторе материала.</small></div></div>`;
  const sourcesHtml=sources.length?sources.map(x=>{
    const inherited=!!x.shared_master,added=textbookInPersonalLibrary(x.textbook);
    const extraAction=inherited
      ? (added?`<button type="button" data-personalize-source="${x.id}">${topicMaterialIcon('edit')}<span>Настроить у себя</span></button>`:`<button type="button" class="library" data-add-source-book="${x.textbook.id}"><span>＋</span><span>В мою библиотеку</span></button>`)
      : `<button type="button" class="danger" data-unlink-source="${x.id}">${topicMaterialIcon('trash')}<span>Убрать</span></button>`;
    return `<article class="mr-topic-source-card">
      <div class="mr-topic-source-cover">${topicMaterialIcon('book')}<small>PDF</small></div>
      <div class="mr-topic-source-main"><span class="mr-topic-source-kicker">${inherited?'Общая библиотека':'Учебник'}</span><h3>${esc(x.textbook.title)}</h3>${x.textbook.author?`<p>${esc(x.textbook.author)}</p>`:''}<div class="mr-topic-source-tags"><span>${x.page_from?`стр. ${x.page_from}${x.page_to&&x.page_to!==x.page_from?`–${x.page_to}`:''}`:'страницы не указаны'}</span>${x.note?`<span>${esc(x.note)}</span>`:''}${inherited?'<span>общая привязка</span>':''}</div></div>
      <div class="mr-topic-source-actions"><button type="button" data-open-source="${x.textbook.id}" data-page="${x.page_from||''}">${topicMaterialIcon('pdf')}<span>Открыть PDF</span></button><button type="button" class="primary" data-board-source="${x.id}">${topicMaterialIcon('board')}<span>На доску</span></button>${extraAction}</div>
    </article>`;
  }).join(''):`<div class="mr-topic-empty-state source"><span>${topicMaterialIcon('book')}</span><div><b>Учебники по теме не найдены</b><small>Можно привязать свой PDF или выбрать учебник из общей библиотеки вручную.</small></div></div>`;
  const topicUiIcon=kind=>{
    const common='class="mr-topic-detail-icon" viewBox="0 0 24 24" aria-hidden="true"';
    if(kind==='edit')return `<svg ${common}><path d="M5 19l3.8-.9L18 8.9 15.1 6 5.9 15.2 5 19Z"/><path class="accent" d="m13.7 7.4 2.9 2.9"/></svg>`;
    if(kind==='trash')return `<svg ${common}><path d="M5 7h14M9 7V4.8h6V7M7.5 7l.7 12h7.6l.7-12"/><path class="accent" d="M10 11v4M14 11v4"/></svg>`;
    if(kind==='play')return `<svg ${common}><rect x="4" y="4" width="16" height="16" rx="5"/><path class="accent-fill" d="m10 8.5 6 3.5-6 3.5z"/></svg>`;
    if(kind==='book')return `<svg ${common}><path d="M4 5.5c3.4-1.3 6.1-.7 8 1v12c-1.9-1.7-4.6-2.3-8-1V5.5Z"/><path class="accent" d="M20 5.5c-3.4-1.3-6.1-.7-8 1v12c1.9-1.7 4.6-2.3 8-1V5.5Z"/></svg>`;
    if(kind==='task')return `<svg ${common}><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M8 9h8M8 13h5"/><path class="accent" d="m8 16 1.5 1.5L12 15"/></svg>`;
    if(kind==='example')return `<svg ${common}><path d="M5 8h14M5 16h14"/><path class="accent" d="M8 5v6M16 13v6"/></svg>`;
    if(kind==='source')return `<svg ${common}><path d="M6 4h9l3 3v13H6z"/><path class="accent" d="M15 4v4h4M9 12h6M9 16h4"/></svg>`;
    if(kind==='board')return `<svg ${common}><rect x="4" y="5" width="16" height="11" rx="2.5"/><path class="accent" d="M9 20h6M12 16v4"/></svg>`;
    return '';
  };
  app.innerHTML=shell(`
    <div class="mr-topic-detail-v2">
      <section class="mr-topic-detail-hero">
        <div class="mr-topic-detail-hero-top">
          <button class="mr-topic-detail-back" id="backTopics">← <span>Темы</span></button>
          <div class="mr-topic-detail-hero-actions">
            <button class="mr-topic-detail-action" id="editCurrentTopic">${topicUiIcon('edit')}<span>Редактировать</span></button>
            <button class="mr-topic-detail-action danger" id="deleteCurrentTopic">${topicUiIcon('trash')}<span>Удалить</span></button>
            <button class="mr-topic-detail-action primary" id="startLesson">${topicUiIcon('play')}<span>Начать урок</span></button>
          </div>
        </div>
        <div class="mr-topic-detail-hero-main">
          <div class="mr-topic-detail-title">
            <div class="mr-topic-detail-badges"><span>${t.grade} класс</span><span>${esc(pos.track)}</span>${pos.index?`<span>Тема ${pos.index} из ${pos.total}</span>`:''}</div>
            <h1>${esc(t.title)}</h1>
            <p>${esc(t.section||'')}</p>
          </div>
          <div class="mr-topic-detail-art"><span>x²</span><i></i><b>${t.grade}</b></div>
        </div>
        ${next?`<div class="mr-topic-next-v2"><span class="mr-topic-next-icon">${topicUiIcon('book')}</span><div><small>Дальше по программе</small><b>${esc(next.title)}</b></div><div class="mr-topic-next-actions"><button id="openNextTopic">Открыть</button><button class="primary" id="scheduleNextTopic">В расписание</button><span>→</span></div></div>`:''}
      </section>

      <section class="mr-topic-detail-toolbar">
        <div class="mr-topic-detail-tabs">
          <button class="active" data-topic-scroll="topicTheory">${topicUiIcon('book')}<span>Теория</span></button>
          <button data-topic-scroll="topicTasks">${topicUiIcon('task')}<span>Задачи</span></button>
          <button data-topic-scroll="topicExamples">${topicUiIcon('example')}<span>Примеры</span></button>
          <button data-topic-scroll="topicSources">${topicUiIcon('source')}<span>Учебники</span></button>
        </div>
        <button class="mr-topic-board-btn" id="theoryBoardTopic">${topicUiIcon('board')}<span>На доску</span></button>
      </section>

      <section class="card mr-theory-card mr-topic-theory-v2" id="topicTheory">
        <div class="mr-topic-section-head">
          <div><span class="mr-topic-section-kicker">Короткий конспект</span><h2>Теория <em class="mr-topic-private-label">личная</em></h2><p>Смысл → алгоритм → пример → что запомнить. Изменения видишь только ты.</p></div>
          ${curriculumSource?`<div class="mr-topic-source-pill">${topicUiIcon('book')}<span><b>Основа конспекта</b><small>${esc(curriculumSource)}</small></span></div>`:''}
        </div>
        ${theoryHtml(t.theory)}
      </section>

      <section class="card mr-topic-sources mr-topic-sources-v2" id="topicSources">
        <div class="mr-topic-section-head compact">
          <div><span class="mr-topic-section-kicker">Материалы</span><h2>Учебники и источники</h2><p>PDF и конкретные страницы, связанные с этой темой.</p></div>
          <button class="mr-topic-secondary-btn" id="linkTextbookTopic">+ Привязать учебник</button>
        </div>
        ${curriculumSource?`<div class="mr-curriculum-source"><span class="pill">Учебный маршрут</span><div><b>${esc(curriculumSource)}</b><small>Конспект адаптирован для Mathroom, а не скопирован из учебника дословно.</small></div></div>`:''}
        ${sourcesHtml}
      </section>

      <section class="mr-topic-content-section" id="topicExamples">
        <div class="mr-topic-section-title"><div><span class="mr-topic-section-kicker">Практика</span><h2>Примеры</h2></div><span>${examples.length}</span></div>
        <div class="list mr-topic-list-v2">${examplesHtml}</div>
      </section>

      <section class="form-card mr-topic-material-create">
        <div class="mr-topic-editor-head">
          <div><span class="mr-topic-section-kicker">Редактор</span><h2>Добавить материал</h2><p>Собери задачу или пример — без системных белых селектов.</p></div>
          <div class="mr-topic-editor-mark"><span>+</span><small>новый<br>материал</small></div>
        </div>
        <form id="itemForm" class="mr-topic-editor-form">
          <div class="mr-topic-editor-top">
            <div class="mr-topic-editor-choice">
              <label>Тип материала</label>
              <select id="itKind" class="mr-topic-hidden-select" tabindex="-1" aria-hidden="true"><option value="task">Задача</option><option value="example">Пример</option></select>
              <div class="mr-topic-editor-segments" data-editor-choice="itKind">
                <button type="button" class="active" data-value="task">${topicMaterialIcon('task')}<span><b>Задача</b><small>Для банка и назначений</small></span></button>
                <button type="button" data-value="example">${topicMaterialIcon('example')}<span><b>Пример</b><small>Для разбора на уроке</small></span></button>
              </div>
            </div>
            <div class="mr-topic-editor-choice">
              <label>Сложность</label>
              <select id="itDiff" class="mr-topic-hidden-select" tabindex="-1" aria-hidden="true"><option value="basic">Базовая</option><option value="medium">Средняя</option><option value="advanced">Сложная</option></select>
              <div class="mr-topic-difficulty-segments" data-editor-choice="itDiff">
                <button type="button" class="active" data-value="basic"><i></i><span>Базовая</span></button>
                <button type="button" data-value="medium"><i></i><span>Средняя</span></button>
                <button type="button" data-value="advanced"><i></i><span>Сложная</span></button>
              </div>
            </div>
            <div class="mr-topic-editor-field">
              <label>Категория</label>
              <div class="mr-topic-input-shell"><span>#</span><input id="itCat" placeholder="Например: Разряды"></div>
            </div>
          </div>
          <div class="mr-topic-editor-field wide"><label>Название</label><input id="itTitle" placeholder="Короткое понятное название"></div>
          <div class="mr-topic-editor-field wide statement"><label>Условие</label><textarea id="itContent" rows="4" required placeholder="Напиши условие задачи или текст примера..."></textarea><span class="mr-topic-editor-corner">↘</span></div>
          <div class="mr-topic-editor-bottom">
            <div class="mr-topic-editor-field"><label>Ответ</label><div class="mr-topic-input-shell answer"><span>=</span><input id="itAnswer" placeholder="Ответ"></div></div>
            <div class="mr-topic-editor-field"><label>Теги</label><div class="mr-topic-input-shell"><span>#</span><input id="itTags" placeholder="разряды, числа, базовая"></div></div>
          </div>
          <div class="mr-topic-editor-footer"><span>Материал сразу появится в текущей теме.</span><button class="mr-topic-editor-submit" type="submit"><b>+</b> Добавить материал</button></div>
        </form>
      </section>

      <section class="mr-topic-content-section" id="topicTasks">
        <div class="mr-topic-section-title"><div><span class="mr-topic-section-kicker">Банк</span><h2>Задачи</h2></div><span>${tasks.length}</span></div>
        <div class="list mr-topic-list-v2">${tasksHtml}</div>
      </section>

      <section class="mr-topic-assignment-bar mr-topic-assignment-v2">
        <div class="mr-topic-assignment-copy"><span class="mr-topic-assignment-icon">${topicUiIcon('task')}</span><div><b>Назначить по теме</b><small>Ученик, количество и формат — в одной панели.</small></div></div>
        <div class="mr-topic-student-picker" data-topic-student-picker>
          <select id="assignStudent" class="mr-topic-hidden-select" tabindex="-1" aria-hidden="true">${studentOpts}</select>
          <button type="button" class="mr-topic-student-trigger" data-topic-student-trigger>
            <span class="avatar">${S.students[0]?esc(String(S.students[0].name||'?').trim().charAt(0).toUpperCase()):'?'}</span>
            <span class="copy"><b>${S.students[0]?esc(S.students[0].name):'Нет учеников'}</b><small>${S.students[0]?`${S.students[0].grade} класс`:'Добавь ученика'}</small></span><span class="chev">⌄</span>
          </button>
          <div class="mr-topic-student-popover" data-topic-student-popover hidden>
            <label class="mr-topic-student-search"><span>⌕</span><input type="search" placeholder="Поиск ученика или класса..." data-topic-student-search></label>
            <div class="mr-topic-student-results" data-topic-student-results>${S.students.map((s,i)=>`<button type="button" class="${i===0?'selected':''}" data-student-id="${esc(s.id)}" data-student-name="${esc(s.name)}" data-student-grade="${esc(s.grade)}"><span>${esc(String(s.name||'?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(s.name)}</b><small>${esc(s.grade)} класс</small></div><i>${i===0?'✓':''}</i></button>`).join('')||'<div class="mr-topic-empty-mini">Учеников пока нет</div>'}</div>
          </div>
        </div>
        <div class="mr-topic-count-stepper"><button type="button" data-count-minus>−</button><div><b id="assignCountDisplay">5</b><small>заданий</small></div><button type="button" data-count-plus>+</button><input id="assignCount" type="number" min="1" max="20" value="5" hidden></div>
        <button class="mr-topic-assign-btn homework" id="makeHw"><span>⌂</span><div><b>Домашняя</b><small>назначить</small></div></button>
        <button class="mr-topic-assign-btn test" id="makeTest"><span>✓</span><div><b>Тест</b><small>создать</small></div></button>
      </section>
    </div>`,'Тема',`${t.grade} класс · ${pos.track}`);bindShell();
    document.querySelectorAll('[data-topic-scroll]').forEach(b=>b.onclick=()=>{
      const target=document.getElementById(b.dataset.topicScroll);
      if(!target)return;
      document.querySelectorAll('[data-topic-scroll]').forEach(x=>x.classList.toggle('active',x===b));
      target.scrollIntoView({behavior:'smooth',block:'start'});
    });
    document.querySelectorAll('[data-editor-choice]').forEach(group=>{
      const select=document.getElementById(group.dataset.editorChoice);if(!select)return;
      group.querySelectorAll('[data-value]').forEach(btn=>btn.onclick=()=>{
        select.value=btn.dataset.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        group.querySelectorAll('[data-value]').forEach(x=>x.classList.toggle('active',x===btn));
      });
    });
    const studentPicker=document.querySelector('[data-topic-student-picker]');
    if(studentPicker){
      const select=document.getElementById('assignStudent'),trigger=studentPicker.querySelector('[data-topic-student-trigger]'),pop=studentPicker.querySelector('[data-topic-student-popover]'),search=studentPicker.querySelector('[data-topic-student-search]'),results=studentPicker.querySelector('[data-topic-student-results]');
      const close=()=>{pop.hidden=true;trigger.classList.remove('open')};
      const applyRow=row=>{
        select.value=row.dataset.studentId;
        const av=trigger.querySelector('.avatar'),copy=trigger.querySelector('.copy');
        av.textContent=String(row.dataset.studentName||'?').trim().charAt(0).toUpperCase();
        copy.querySelector('b').textContent=row.dataset.studentName||'Ученик';
        copy.querySelector('small').textContent=`${row.dataset.studentGrade||''} класс`;
        results.querySelectorAll('[data-student-id]').forEach(x=>{x.classList.toggle('selected',x===row);x.querySelector('i').textContent=x===row?'✓':''});
        close();
      };
      trigger.onclick=()=>{const opening=pop.hidden;if(opening){pop.hidden=false;trigger.classList.add('open');setTimeout(()=>search?.focus(),0)}else close()};
      results?.addEventListener('click',e=>{const row=e.target.closest('[data-student-id]');if(row)applyRow(row)});
      search?.addEventListener('input',()=>{
        const q=search.value.trim().toLocaleLowerCase('ru');
        results.querySelectorAll('[data-student-id]').forEach(row=>{const hay=(row.dataset.studentName+' '+row.dataset.studentGrade+' класс').toLocaleLowerCase('ru');row.hidden=!!q&&!hay.includes(q)});
      });
      document.addEventListener('pointerdown',function outside(e){if(!document.body.contains(studentPicker)){document.removeEventListener('pointerdown',outside);return}if(!studentPicker.contains(e.target))close()});
    }
    const countInput=document.getElementById('assignCount'),countDisplay=document.getElementById('assignCountDisplay');
    const syncCount=()=>{const v=Math.max(1,Math.min(20,Number(countInput.value)||1));countInput.value=String(v);countDisplay.textContent=String(v)};
    document.querySelector('[data-count-minus]')?.addEventListener('click',()=>{countInput.value=String((Number(countInput.value)||1)-1);syncCount()});
    document.querySelector('[data-count-plus]')?.addEventListener('click',()=>{countInput.value=String((Number(countInput.value)||1)+1);syncCount()});
    syncCount();
  document.getElementById('backTopics').onclick=()=>{S.topic=null;S.view='topics';S.topicGradeFilter=Number(t.grade);renderTeacher()};
  document.getElementById('editCurrentTopic').onclick=()=>editTopicModal(t,{returnToTopic:true});
  document.getElementById('deleteCurrentTopic').onclick=()=>deleteTopicRow(t,{returnToTopics:true});
  document.getElementById('theoryBoardTopic').onclick=()=>{S.view='scratch';renderTeacher();setTimeout(()=>sendTheoryToBoard(S.boardController,t),250)};
  document.getElementById('linkTextbookTopic').onclick=()=>linkTextbookModal({topicId:t.id});
  document.querySelectorAll('[data-open-source]').forEach(b=>b.onclick=()=>{const book=S.textbooks.find(x=>String(x.id)===String(b.dataset.openSource));if(book)openTextbook(book,Number(b.dataset.page)||0)});
  document.querySelectorAll('[data-board-source]').forEach(b=>b.onclick=()=>{const link=sources.find(x=>String(x.id)===String(b.dataset.boardSource));if(link)textbookPagesToBoardModal(link)});
  document.querySelectorAll('[data-add-source-book]').forEach(b=>b.onclick=async()=>{const book=S.textbooks.find(x=>String(x.id)===String(b.dataset.addSourceBook));if(!book)return;const ok=await addSharedTextbookToPersonalLibrary(book,{refresh:true,render:false,notify:true});if(!ok)return;S.topic=S.topics.find(x=>x.id===t.id)||t;renderTopic()});
  document.querySelectorAll('[data-personalize-source]').forEach(b=>b.onclick=()=>{const link=sources.find(x=>String(x.id)===String(b.dataset.personalizeSource));if(link)linkTextbookModal({topicId:t.id,textbookId:link.textbook.id,sourceLink:link})});
  document.querySelectorAll('[data-unlink-source]').forEach(b=>b.onclick=async()=>{if(!confirm('Убрать привязку учебника к этой теме?'))return;const {error}=await sb.from('textbook_topic_links').delete().eq('id',b.dataset.unlinkSource);if(error)return fail(error);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id)||t;renderTopic()});
  if(next){document.getElementById('openNextTopic').onclick=()=>{S.topic=next;renderTopic()};document.getElementById('scheduleNextTopic').onclick=()=>{S.schedulePrefill={studentId:document.getElementById('assignStudent').value||S.students?.[0]?.id||'',topicId:next.id};S.view='schedule';S.topic=null;renderTeacher()}};
  document.getElementById('itemForm').onsubmit=async e=>{e.preventDefault();const tags=document.getElementById('itTags').value.split(',').map(x=>x.trim()).filter(Boolean);tags.unshift(`тема:${t.title}`);tags.unshift(`класс-${t.grade}`);const {error}=await sb.from('exercises').insert({teacher_id:S.user.id,topic_id:t.id,kind:document.getElementById('itKind').value,title:document.getElementById('itTitle').value.trim(),content:document.getElementById('itContent').value,answer:document.getElementById('itAnswer').value,difficulty:document.getElementById('itDiff').value,category:document.getElementById('itCat').value.trim(),tags:[...new Set(tags)]});if(error)return fail(error);await loadTeacher();S.topic=S.topics.find(x=>x.id===t.id);renderTopic()};
  const rerender=()=>{S.topic=S.topics.find(x=>x.id===t.id)||null;S.topic?renderTopic():renderTopics()};
  document.querySelectorAll('[data-share-material]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(e=>e.id===b.dataset.shareMaterial);if(x)publishExerciseToSharedLibrary(x,{onDone:rerender})});
  document.querySelectorAll('[data-unshare-material]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(e=>e.id===b.dataset.unshareMaterial);if(x)unpublishExerciseFromSharedLibrary(x,{onDone:rerender})});
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
  const allBooks=(S.textbooks||[]),ownedBooks=allBooks.filter(textbookIsMine),addedSharedBooks=allBooks.filter(b=>!textbookIsMine(b)&&textbookInPersonalLibrary(b)),books=[...ownedBooks,...addedSharedBooks],sharedBooks=allBooks.filter(b=>b.is_shared&&!textbookIsMine(b)),links=S.textbookLinks||[],syncPlan=textbookAutoSyncPlan();
  const syncSummary=ownedBooks.length?`<div class="card mr-textbook-sync-card"><div><span class="pill">Автопривязка</span><h2>Синхронизировать мои учебники с темами</h2><p class="muted">Mathroom распознаёт загруженные вами PDF по автору, классу, части и названию, затем связывает их с темами и известными страницами.</p><div class="actions"><span class="pill">Распознано ${syncPlan.recognized.length}/${ownedBooks.length}</span><span class="pill">Совпадений ${syncPlan.rows.length}</span><span class="pill">Точные страницы ${syncPlan.exactPages}</span><span class="pill">Без страниц ${Math.max(0,syncPlan.rows.length-syncPlan.exactPages)}</span></div></div><div class="actions"><button class="btn primary" id="syncTextbooksTopics">Синхронизировать с темами</button></div></div>`:'';
  const list=books.length?books.map(book=>{
    const mine=textbookIsMine(book),ls=textbookPersonalLinks(book),meta=window.MathroomTextbookSyncV290?.detectBook?.(book);
    const linked=ls.slice(0,5).map(l=>{const t=S.topics.find(x=>String(x.id)===String(l.topic_id));return t?`<span class="pill">${t.grade} кл. · ${esc(t.title)}${l.page_from?` · с.${l.page_from}${l.page_to&&l.page_to!==l.page_from?`–${l.page_to}`:''}`:''}</span>`:''}).join('');
    const actions=mine
      ? `<button class="btn sm primary" data-book-open="${book.id}">Открыть</button><button class="btn sm" data-book-link="${book.id}">Привязать вручную</button><button class="btn sm library" data-book-share="${book.id}">${book.is_shared?'Убрать из общей':'＋ В общую библиотеку'}</button><button class="btn sm danger" data-book-delete="${book.id}">Удалить</button>`
      : `<button class="btn sm primary" data-book-open="${book.id}">Открыть</button><button class="btn sm" data-book-link="${book.id}">Изменить мои темы/страницы</button><button class="btn sm danger" data-book-remove-personal="${book.id}">Убрать из моей</button>`;
    return `<article class="card mr-textbook-card"><div class="mr-card-head"><div><span class="pill">${mine?'Мой PDF':'Из общей'}</span>${meta?.recognized?`<span class="pill good">${esc(meta.label)} · ${meta.grade} кл.${meta.part?` · ч.${meta.part}`:''}</span>`:'<span class="pill warn">Нужно уточнить данные</span>'}<h3>${esc(book.title)}</h3><p class="muted">${book.author?esc(book.author)+' · ':''}${esc(book.subject||'Математика')}${book.grade_from?` · ${book.grade_from}${book.grade_to&&book.grade_to!==book.grade_from?`–${book.grade_to}`:''} класс`:''}</p></div><div class="actions">${actions}</div></div><div class="mr-textbook-links">${linked||'<span class="small muted">Пока не привязан ни к одной моей теме.</span>'}${ls.length>5?`<span class="small muted">+ ещё ${ls.length-5}</span>`:''}</div></article>`;
  }).join(''):'<div class="empty">Учебников пока нет. Добавь свой PDF или возьми учебник из общей библиотеки.</div>';
  const sharedList=sharedBooks.length?sharedBooks.map(book=>{
    const master=textbookMasterLinks(book),added=textbookInPersonalLibrary(book);
    const shown=master.slice(0,7).map(l=>`<span class="pill">${l.topic_grade||'?'} кл. · ${esc(l.topic_title||'Тема')}${l.page_from?` · с.${l.page_from}${l.page_to&&l.page_to!==l.page_from?`–${l.page_to}`:''}`:''}</span>`).join('');
    return `<article class="card mr-textbook-card mr-shared-textbook-card">
      <div class="mr-card-head"><div><span class="pill library">Общая библиотека</span><span class="pill">PDF</span>${added?'<span class="pill good">Добавлен мне</span>':''}<h3>${esc(book.title)}</h3><p class="muted">${book.author?esc(book.author)+' · ':''}${esc(book.subject||'Математика')}${book.grade_from?` · ${book.grade_from}${book.grade_to&&book.grade_to!==book.grade_from?`–${book.grade_to}`:''} класс`:''}</p></div>
      <div class="actions"><button class="btn sm primary" data-book-open="${book.id}">Открыть</button>${added?`<button class="btn sm" data-book-link="${book.id}">Мои настройки</button><button class="btn sm danger" data-book-remove-personal="${book.id}">Убрать из моей</button>`:`<button class="btn sm library" data-book-add-personal="${book.id}">＋ Добавить в мою библиотеку</button>`}</div></div>
      <div class="mr-textbook-links">${shown||'<span class="small muted">У общего учебника пока нет привязанных тем.</span>'}${master.length>7?`<span class="small muted">+ ещё ${master.length-7}</span>`:''}</div>
      <div class="small muted" style="margin-top:10px">${added?'Эти связи уже скопированы в вашу личную версию: их можно менять независимо.':'Показаны общие темы и страницы автора библиотеки. При добавлении они скопируются в вашу личную версию.'}</div>
    </article>`;
  }).join(''):'<div class="empty">Другие преподаватели пока не добавили учебники в общую библиотеку.</div>';
  app.innerHTML=shell(`${syncSummary}<div class="form-card mr-textbook-upload"><h2>Добавить учебник</h2><form id="textbookForm"><div class="grid cols3"><div class="field"><label>Название</label><input id="tbTitle" required placeholder="Математика. 6 класс"></div><div class="field"><label>Автор</label><input id="tbAuthor" placeholder="Автор / издательство"></div><div class="field"><label>Предмет</label><select id="tbSubject"><option>Математика</option><option>Алгебра</option><option>Геометрия</option></select></div></div><div class="grid cols3"><div class="field"><label>С класса</label><select id="tbFrom">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><div class="field"><label>По класс</label><select id="tbTo">${Array.from({length:11},(_,i)=>`<option>${i+1}</option>`).join('')}</select></div><div class="field"><label>PDF</label><input id="tbFile" type="file" accept="application/pdf,.pdf" required></div></div><div class="small muted">PDF хранится в закрытом Supabase Storage. Файлы больше 6 МБ загружаются частями и могут продолжиться после обрыва связи. OCR страниц отключён: PDF используется напрямую, без лишней фоновой обработки.</div><div class="mr-upload-progress" id="tbUploadProgress" hidden><div class="mr-upload-progress-head"><b id="tbUploadState">Подготовка…</b><span id="tbUploadPercent">0%</span></div><div class="mr-upload-track"><i id="tbUploadBar"></i></div><div class="mr-upload-meta"><span id="tbUploadBytes">0 МБ</span><span id="tbUploadSpeed">—</span><span id="tbUploadEta">осталось —</span></div><div class="actions"><button class="btn sm" type="button" id="tbUploadPause" hidden>Пауза</button></div></div><button class="btn primary" id="tbUploadSubmit">Загрузить PDF</button></form></div><div class="section-title"><h2>Моя библиотека · ${books.length}</h2><span class="small muted">Личные учебники и ваши настройки</span></div><div class="grid cols2">${list}</div><section class="mr-shared-books-section"><div class="section-title"><div><span class="mr-topic-section-kicker">Для команды</span><h2>Общая библиотека · ${sharedBooks.length}</h2></div></div><div class="notice mr-library-note"><b>Общий PDF + общая эталонная карта тем.</b> До добавления вы видите те же темы и страницы, что задал автор. После «Добавить в мою библиотеку» карта копируется вам и дальше редактируется независимо.</div><div class="grid cols2">${sharedList}</div></section>`,'Учебники','PDF автоматически связываются с темами и страницами; ручная привязка остаётся доступна');bindShell();
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
    if(file.size>50*1024*1024)return toast('PDF больше 50 МБ. Сожми файл перед загрузкой.');
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
      const titleValue=document.getElementById('tbTitle').value.trim();
      let gradeFrom=Number(document.getElementById('tbFrom').value),gradeTo=Number(document.getElementById('tbTo').value);
      const explicitGrade=titleValue.match(/(?:^|[^0-9])(10|11|[1-9])\s*(?:класс(?:а|ы|ов)?|кл\.?)(?:[^0-9]|$)/i);
      if(explicitGrade&&gradeFrom===gradeTo&&gradeFrom!==Number(explicitGrade[1])){
        gradeFrom=gradeTo=Number(explicitGrade[1]);
        const fromEl=document.getElementById('tbFrom'),toEl=document.getElementById('tbTo');
        if(fromEl)fromEl.value=String(gradeFrom);if(toEl)toEl.value=String(gradeTo);
      }
      const body={teacher_id:S.user.id,title:titleValue,author:document.getElementById('tbAuthor').value.trim(),subject:document.getElementById('tbSubject').value,grade_from:gradeFrom,grade_to:gradeTo,file_path:path,file_name:file.name,file_size:file.size};
      const {data:createdBook,error}=await sb.from('textbooks').insert(body).select('*').single();if(error){await sb.storage.from('textbooks').remove([path]);throw error}
      setState('PDF загружен · связываем с темами…');await loadTeacher();let autoResult=null;try{autoResult=await syncTextbooksWithTopics({silent:true,bookIds:[createdBook.id]})}catch(syncErr){console.warn('textbook auto sync',syncErr)}
      setState('Готово');if(bar)bar.style.width='100%';if(percent)percent.textContent='100%';renderTextbooks();const linked=autoResult?.created||0;toast(`${uploaded.resumed?'Учебник загружен · загрузка успешно продолжена':'Учебник загружен'}${linked?` · автоматически привязано тем: ${linked}`:''}`);
    }catch(err){console.error(err);setState('Не удалось завершить загрузку');submit.disabled=false;submit.textContent='Продолжить загрузку';if(pauseBtn)pauseBtn.hidden=true;fail(err)}
  };
  document.querySelectorAll('[data-book-open]').forEach(b=>b.onclick=()=>{const book=allBooks.find(x=>String(x.id)===String(b.dataset.bookOpen));if(book)openTextbook(book)});
  document.querySelectorAll('[data-book-link]').forEach(b=>b.onclick=()=>linkTextbookModal({textbookId:b.dataset.bookLink}));
  document.querySelectorAll('[data-book-add-personal]').forEach(b=>b.onclick=()=>{const book=allBooks.find(x=>String(x.id)===String(b.dataset.bookAddPersonal));if(book)addSharedTextbookToPersonalLibrary(book)});
  document.querySelectorAll('[data-book-remove-personal]').forEach(b=>b.onclick=()=>{const book=allBooks.find(x=>String(x.id)===String(b.dataset.bookRemovePersonal));if(book)removeSharedTextbookFromPersonalLibrary(book)});
  document.querySelectorAll('[data-book-share]').forEach(b=>b.onclick=async()=>{
    const book=ownedBooks.find(x=>String(x.id)===String(b.dataset.bookShare));if(!book)return;
    const next=!book.is_shared;
    if(!next&&!confirm('Убрать учебник из общей библиотеки? Привязки других преподавателей к этому общему учебнику будут удалены.'))return;
    const {error}=await sb.from('textbooks').update({is_shared:next,shared_at:next?new Date().toISOString():null}).eq('id',book.id);
    if(error)return fail(error);await loadTeacher();renderTextbooks();toast(next?'Учебник добавлен в общую библиотеку':'Учебник убран из общей библиотеки');
  });
  document.querySelectorAll('[data-book-delete]').forEach(b=>b.onclick=async()=>{const book=ownedBooks.find(x=>String(x.id)===String(b.dataset.bookDelete));if(!book)return;if(book.is_shared)return toast('Сначала убери учебник из общей библиотеки');if(!confirm(`Удалить учебник «${book.title}»?`))return;try{await sb.storage.from('textbooks').remove([book.file_path]);const {error}=await sb.from('textbooks').delete().eq('id',book.id);if(error)throw error;await loadTeacher();renderTextbooks();toast('Учебник удалён')}catch(err){fail(err)}});
  try{window.MathroomLibraryV2?.enhance?.()}catch(err){console.error('[Mathroom library v2 hook]',err)}
}


function renderBank(){
  const bank=window.MathroomCurriculumBank;
  const isSystemBankTag=z=>String(z).startsWith('mathroom-core-bank-v')||String(z).startsWith('mrseed:');
  const own=S.exercises||[],shared=S.sharedMaterials||[];
  const mode=S.bankLibraryMode==='shared'?'shared':'mine';
  const builtIn=own.filter(x=>x.kind==='task'&&(x.tags||[]).some(t=>String(t).startsWith('mathroom-core-bank-v'))).length;
  const categories=[...new Set([...own.map(x=>x.category),...shared.map(x=>x.category)].filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
  const tags=[...new Set([...own.flatMap(x=>x.tags||[]),...shared.flatMap(x=>x.tags||[])].filter(x=>x&&!isSystemBankTag(x)&&!String(x).startsWith('класс-')&&!String(x).startsWith('тема:')))].sort((a,b)=>String(a).localeCompare(String(b),'ru'));
  const grades=[...new Set([...(S.topics||[]).map(x=>Number(x.grade)),...shared.map(x=>Number(x.grade))].filter(Boolean))].sort((a,b)=>a-b);
  const publishedByMe=shared.filter(x=>String(x.published_by)===String(S.user?.id)).length;
  app.innerHTML=shell(`
    <section class="mr-library-hero">
      <div><span>МАТЕРИАЛЫ</span><h1>Личная и общая библиотека</h1><p>Личные материалы редактируешь только ты. В общую библиотеку публикуется отдельная версия — чужие изменения твою копию не затрагивают.</p></div>
      <div class="mr-library-hero-stats"><div><b>${own.length}</b><small>личных</small></div><div><b>${shared.length}</b><small>в общей</small></div><div><b>${publishedByMe}</b><small>опубликовано вами</small></div></div>
    </section>
    <div class="mr-library-tabs">
      <button class="${mode==='mine'?'active':''}" data-library-mode="mine"><span>Мои материалы</span><b>${own.length}</b></button>
      <button class="${mode==='shared'?'active':''}" data-library-mode="shared"><span>Общая библиотека</span><b>${shared.length}</b></button>
    </div>
    <div class="actions bank-summary mr-library-summary">
      <span class="pill">${own.filter(x=>x.kind==='task').length} задач</span>
      <span class="pill">${own.filter(x=>x.kind==='example').length} примеров</span>
      <span class="pill">${builtIn} из готовой базы</span>
      <button class="btn sm" id="syncCurriculumBank">Обновить базу 1–11</button>
    </div>
    <div class="form-card mr-library-filters">
      <div class="grid cols4">
        <div class="field"><label>Поиск</label><input id="bankSearch" placeholder="условие, тег, тема..."></div>
        <div class="field"><label>Тип</label><select id="bankKind"><option value="">Все</option><option value="task">Задачи</option><option value="example">Примеры</option></select></div>
        <div class="field"><label>Класс</label><select id="bankGrade"><option value="">Все</option>${grades.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
        <div class="field"><label>Сложность</label><select id="bankDiff"><option value="">Все</option><option value="basic">Базовые</option><option value="medium">Средние</option><option value="advanced">Сложные</option></select></div>
      </div>
      <div class="grid cols2" style="margin-top:10px">
        <div class="field"><label>Категория</label><select id="bankCat"><option value="">Все</option>${categories.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
        <div class="field"><label>Тег</label><select id="bankTag"><option value="">Все</option>${tags.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div>
      </div>
    </div>
    <div id="bankList"></div>`,'Библиотека материалов','Задачи и примеры: личные копии + общая библиотека преподавателей');
  bindShell();
  document.getElementById('syncCurriculumBank').onclick=()=>syncCurriculumBank({manual:true});
  document.querySelectorAll('[data-library-mode]').forEach(b=>b.onclick=()=>{S.bankLibraryMode=b.dataset.libraryMode;renderBank()});

  const readFilters=()=>({
    q:document.getElementById('bankSearch').value.trim().toLocaleLowerCase('ru'),
    kind:document.getElementById('bankKind').value,
    grade:document.getElementById('bankGrade').value,
    diff:document.getElementById('bankDiff').value,
    cat:document.getElementById('bankCat').value,
    tag:document.getElementById('bankTag').value
  });
  const match=(row,f,isShared=false)=>{
    const topic=isShared?null:(S.topics||[]).find(z=>String(z.id)===String(row.topic_id));
    const grade=isShared?row.grade:topic?.grade;
    const section=isShared?row.section:topic?.section;
    const topicTitle=isShared?row.topic_title:topic?.title;
    return (!f.kind||row.kind===f.kind)&&(!f.grade||String(grade)===f.grade)&&(!f.diff||row.difficulty===f.diff)&&(!f.cat||row.category===f.cat)&&(!f.tag||(row.tags||[]).includes(f.tag))&&(!f.q||[row.title,row.content,row.category,section,topicTitle,...(row.tags||[])].join(' ').toLocaleLowerCase('ru').includes(f.q));
  };

  const draw=()=>{
    const f=readFilters(),host=document.getElementById('bankList');
    if(S.bankLibraryMode==='shared'){
      const arr=shared.filter(x=>match(x,f,true));
      host.innerHTML=`<div class="mr-shared-library-grid">${arr.length?arr.map(x=>{
        const mine=String(x.published_by)===String(S.user?.id);
        const visibleTags=sharedMaterialUserTags(x.tags);
        return `<article class="mr-shared-material-card">
          <div class="mr-shared-material-top"><span class="mr-shared-kind ${x.kind}">${x.kind==='example'?'Пример':'Задача'}</span><span class="pill">${x.grade||'?'} класс</span>${mine?'<span class="pill good">Опубликовано вами</span>':''}</div>
          <h3>${esc(x.title|| (x.kind==='example'?'Пример':'Задача'))}</h3>
          <div class="prewrap">${nl(x.content)}</div>
          <div class="mr-shared-material-meta"><span>${esc(x.section||'Математика')}</span><b>→</b><span>${esc(x.topic_title||'Без темы')}</span></div>
          ${visibleTags.length?`<div class="mr-library-tags">${visibleTags.slice(0,8).map(z=>`<span>#${esc(z)}</span>`).join('')}</div>`:''}
          <div class="mr-shared-material-actions"><button class="btn sm" data-shared-answer="${x.id}">Ответ</button><button class="btn sm primary" data-shared-import="${x.id}">${mine?'Добавить ещё одну личную копию':'Добавить себе'}</button></div>
        </article>`;
      }).join(''):'<div class="empty">По этим фильтрам в общей библиотеке пока ничего нет.</div>'}</div>`;
      host.querySelectorAll('[data-shared-answer]').forEach(b=>b.onclick=()=>{const x=shared.find(v=>String(v.id)===String(b.dataset.sharedAnswer));if(x)modal(`<h2>${esc(x.title||'Ответ')}</h2><div class="notice mono">${esc(x.answer||'Ответ не заполнен')}</div>`)});
      host.querySelectorAll('[data-shared-import]').forEach(b=>b.onclick=()=>{const x=shared.find(v=>String(v.id)===String(b.dataset.sharedImport));if(x)importSharedMaterial(x,{onDone:renderBank})});
      return;
    }

    const arr=own.filter(x=>match(x,f,false));
    host.innerHTML=`<div class="list mr-personal-library-list">${arr.length?arr.map(x=>{
      const t=(S.topics||[]).find(z=>String(z.id)===String(x.topic_id));
      const visibleTags=exerciseEditableTags(x.tags),published=sharedMaterialForExercise(x.id);
      return `<div class="row mr-library-own-row"><div><div class="actions"><span class="pill">${x.kind==='example'?'Пример':'Задача'}</span><span class="pill">${t?.grade||'?'} кл.</span><span class="pill">${diffLabel(x.difficulty)}</span>${x.category?`<span class="pill">${esc(x.category)}</span>`:''}${published?'<span class="pill good">в общей библиотеке</span>':''}</div><h3>${esc(x.title||(x.kind==='example'?'Пример':'Задача'))}</h3><div class="prewrap">${nl(x.content)}</div><p>${esc(t?.section||'')} · ${esc(t?.title||'')} ${visibleTags.map(z=>'#'+esc(z)).join(' ')} · использован ${x.use_count||0} раз</p></div><div class="actions mr-library-own-actions"><button class="btn sm" data-answer="${x.id}">Ответ</button>${published?`<button class="btn sm library" data-bank-share="${x.id}">Обновить общую</button><button class="btn sm danger" data-bank-unshare="${x.id}">Убрать из общей</button>`:`<button class="btn sm library" data-bank-share="${x.id}">＋ В общую</button>`}<button class="btn sm" data-bank-edit="${x.id}">Редактировать</button><button class="btn sm danger" data-bank-delete="${x.id}">Удалить</button></div></div>`;
    }).join(''):'<div class="empty">Ничего не найдено.</div>'}</div>`;
    host.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{const e=own.find(x=>String(x.id)===String(b.dataset.answer));if(e)modal(`<h2>${esc(e.title||'Ответ')}</h2><div class="notice mono">${esc(e.answer||'Ответ не заполнен')}</div>`)});
    host.querySelectorAll('[data-bank-share]').forEach(b=>b.onclick=()=>{const e=own.find(x=>String(x.id)===String(b.dataset.bankShare));if(e)publishExerciseToSharedLibrary(e,{onDone:renderBank})});
    host.querySelectorAll('[data-bank-unshare]').forEach(b=>b.onclick=()=>{const e=own.find(x=>String(x.id)===String(b.dataset.bankUnshare));if(e)unpublishExerciseFromSharedLibrary(e,{onDone:renderBank})});
    host.querySelectorAll('[data-bank-edit]').forEach(b=>b.onclick=()=>{const e=own.find(x=>String(x.id)===String(b.dataset.bankEdit));if(e)editExerciseModal(e,{onDone:renderBank})});
    host.querySelectorAll('[data-bank-delete]').forEach(b=>b.onclick=()=>{const e=own.find(x=>String(x.id)===String(b.dataset.bankDelete));if(e)deleteExerciseRow(e,{onDone:renderBank})});
  };
  ['bankSearch','bankKind','bankGrade','bankDiff','bankCat','bankTag'].forEach(id=>document.getElementById(id).oninput=draw);
  draw();
}

function renderSchedule(){
  const pre=S.schedulePrefill||{};
  app.innerHTML=shell(`<section id="mrScheduleEnhanced" class="mr-schedule-enhanced" data-schedule-prefill-student="${esc(pre.studentId||'')}" data-schedule-prefill-topic="${esc(pre.topicId||'')}"><div class="card mr-schedule-loading"><h2>Расписание</h2><p class="muted">Загружаем недельный календарь…</p></div></section>`,'Расписание','Темы отсортированы по школьной последовательности');
  bindShell();
  if(typeof window.MathroomEnhanceScheduleWorkspace==='function'){
    Promise.resolve(window.MathroomEnhanceScheduleWorkspace()).catch(e=>console.warn('[Mathroom schedule render]',e));
  }
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
  const {data:pages,error}=await sb.from('board_pages').select('id,title,sort_order,elements').eq('student_id',lesson.student_id).eq('lesson_id',lesson.id).order('sort_order');if(error)throw error;
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
  if(window.MathroomHistoryV3?.render)return window.MathroomHistoryV3.render({shell,bindShell,deleteCompletedLessonHistory,clearCompletedLessonHistory,loadTeacher});
  const all=S.lessons.filter(x=>x.status==='completed').sort((a,b)=>String(b.completed_at||b.created_at).localeCompare(String(a.completed_at||a.created_at)));
  const top=all.length?`<div class="history-tools card"><div><span class="koto-eyebrow">АРХИВ</span><h2>История занятий</h2><p class="muted">${all.length} завершён${all.length===1?'ное занятие':all.length<5?'ных занятия':'ных занятий'} · поиск по ученику, теме и заметкам.</p></div><button class="btn danger" id="clearLessonHistory">Очистить историю</button></div><div class="history-search-wrap"><input class="search" id="lessonHistorySearch" placeholder="Поиск: ученик, тема, итог, домашняя работа…"></div>`:'';
  const rows=all.length?all.map(l=>{const q=[l.students?.name,l.topics?.title,l.public_summary,l.homework_plan,l.private_notes,dateLong(l.completed_at||l.started_at)].filter(Boolean).join(' ').toLowerCase();return `<div class="row history-row" data-history-search="${esc(q)}"><div><div class="actions"><span class="pill koto-pill">Завершено</span><span class="small muted">${dateLong(l.completed_at||l.started_at)}</span></div><h3>${esc(l.students?.name||'')} · ${esc(l.topics?.title||'')}</h3>${l.public_summary?`<p>${esc(l.public_summary.slice(0,150))}</p>`:''}</div><div class="actions"><button class="btn sm" data-history="${l.id}">Открыть</button><button class="btn sm danger" data-history-delete="${l.id}" title="Удалить занятие из истории">Удалить</button></div></div>`}).join(''):'<div class="empty">История чистая. Завершённые занятия появятся здесь.</div>';
  app.innerHTML=shell(`${top}<div class="list history-list" id="lessonHistoryList">${rows}</div><div class="empty hidden" id="historySearchEmpty">Ничего не найдено.</div>`,'История уроков','Итоги, заметки и сохранённые версии доски');bindShell();
  document.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>openHistoryLesson(b.dataset.history));document.querySelectorAll('[data-history-delete]').forEach(b=>b.onclick=async()=>{try{await deleteCompletedLessonHistory(b.dataset.historyDelete);await loadTeacher();renderHistory();toast('Занятие удалено из истории')}catch(e){fail(e)}});document.getElementById('clearLessonHistory')?.addEventListener('click',clearCompletedLessonHistory);
  const search=document.getElementById('lessonHistorySearch');if(search)search.oninput=()=>{const q=search.value.trim().toLowerCase();let visible=0;document.querySelectorAll('[data-history-search]').forEach(r=>{const ok=!q||r.dataset.historySearch.includes(q);r.classList.toggle('hidden',!ok);if(ok)visible++});document.getElementById('historySearchEmpty')?.classList.toggle('hidden',visible>0)};
}
async function openHistoryLesson(id){
  if(window.MathroomHistoryV3?.open)return window.MathroomHistoryV3.open(id,{deleteCompletedLessonHistory,renderHistory,loadTeacher,mountSnapshot});
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
window.MathroomStartLesson=startLesson;

async function ensureLiveState(lesson){
  const {data,error}=await sb.from('lesson_live_state').upsert({lesson_id:lesson.id,teacher_id:S.user.id,student_id:lesson.student_id},{onConflict:'lesson_id'}).select().single();if(error)throw error;return data;
}
function elapsedSeconds(live){let n=live?.timer_elapsed_seconds||0;if(live?.timer_running&&live.timer_started_at)n+=Math.max(0,Math.floor((Date.now()-new Date(live.timer_started_at).getTime())/1000));return n}
function fmtTime(s){s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
async function renderLesson(){
  const lesson=S.activeLesson||S.lessons.find(x=>x.status==='in_progress'&&x.student_id===S.selectedStudent&&(S.topic?.id?x.topic_id===S.topic.id:true));if(!lesson){forgetActiveLesson();S.view='dashboard';return renderTeacher()}
  S.activeLesson=lesson;
  rememberActiveLesson(lesson.id);
  const st=S.students.find(x=>x.id===lesson.student_id);
  if(!st){S.view='dashboard';return renderTeacher()}
  const realTopic=S.topics.find(x=>x.id===lesson.topic_id)||null;
  const t=realTopic||{id:null,grade:st.grade||'',section:'',title:'Без темы',theory:''};
  const [{data:queue,error:qErr},live]=await Promise.all([sb.from('lesson_queue_items').select('*').eq('lesson_id',lesson.id).order('position'),ensureLiveState(lesson)]);if(qErr)return fail(qErr);
  const items=realTopic?S.exercises.filter(x=>x.topic_id===realTopic.id):[],tasks=items.filter(x=>x.kind==='task'),examples=items.filter(x=>x.kind==='example'),lessonSources=realTopic?textbookLinksForTopic(realTopic.id):[];let liveState=live,current=(queue||[]).find(x=>x.id===liveState.current_queue_item_id)||null;
  const lessonSourcesHtml=lessonSources.length?`<h3>Учебник</h3>${lessonSources.map(x=>`<div class="item-box mr-lesson-textbook"><div><b>${esc(x.textbook.title)}</b><div class="small muted">${x.page_from?`стр. ${x.page_from}${x.page_to&&x.page_to!==x.page_from?`–${x.page_to}`:''}`:'страницы не указаны'}${x.note?` · ${esc(x.note)}`:''}</div></div><div class="actions"><button class="btn sm" data-lesson-source-open="${x.id}">Открыть PDF</button><button class="btn sm primary" data-lesson-source-board="${x.id}">На доску</button></div></div>`).join('')}`:'';
  const queueHtml=(queue||[]).length?(queue||[]).map((x,i)=>`<div class="lesson-queue-row ${current?.id===x.id?'current':''} status-${x.status}"><button class="queue-select" data-current="${x.id}"><span class="queue-status">${x.status==='solved'?'✓':x.status==='hard'?'!':x.status==='later'?'↩':'○'}</span><span><b>${i+1}. ${esc(x.title||'Задача')}</b><small>${esc(x.prompt)}</small></span></button><button class="icon-btn" data-remove-queue="${x.id}">×</button></div>`).join(''):'<div class="small muted">Очередь пока пустая.</div>';
  app.innerHTML=shell(`<div class="actions" style="margin-bottom:12px"><button class="btn" id="leaveLesson">← Кабинет</button><button class="btn" id="copyLessonLink">Ссылка ученика</button><button class="btn" id="saveVersion">Сохранить версию доски</button><button class="btn primary" id="completeLesson">Завершить урок</button></div><div class="lesson-live-card" id="lessonControl"><div class="lesson-live-top"><div class="lesson-timer-block"><span class="muted">Время урока</span><span class="lesson-timer" id="lessonTimer">${fmtTime(elapsedSeconds(liveState))}</span></div><div class="actions"><button class="btn sm" id="timerToggle">${liveState.timer_running?'Пауза':'Начать урок'}</button><button class="btn sm" id="timerReset">Сброс</button><button class="btn sm ${liveState.focus_enabled?'active':''}" id="focusToggle">Фокус ученика: ${liveState.focus_enabled?'вкл':'выкл'}</button></div></div><div class="lesson-current-task"><div class="lesson-task-kicker">Текущая задача</div>${current?`<h3>${esc(current.title)}</h3><div class="lesson-task-prompt">${nl(current.prompt)}</div><div class="small muted lesson-answer">Ответ: ${esc(current.correct_answer||'—')}</div>`:'<div class="muted">Выбери задачу из очереди.</div>'}</div>${current?`<div class="lesson-task-status-actions"><button class="btn sm ${current.status==='solved'?'active':''}" data-status="solved">✓ Решено</button><button class="btn sm ${current.status==='hard'?'warn':''}" data-status="hard">⚠ Сложно</button><button class="btn sm ${current.status==='later'?'active':''}" data-status="later">↩ Вернуться позже</button><button class="btn sm" id="currentToBoard">На доску</button><button class="btn sm" id="currentToHomework">→ В домашнюю</button>${current.homework_added?'<span class="small homework-added">✓ Уже в домашней</span>':''}</div>`:''}<details class="lesson-queue" open><summary><b>Очередь на сегодня</b><span class="pill">${(queue||[]).length}</span></summary><div class="lesson-queue-list">${queueHtml}</div></details></div><div class="lesson-cloud-layout" style="margin-top:12px"><div class="lesson-cloud-material">${realTopic?`<div class="card"><span class="pill">${t.grade} класс · ${esc(t.section)}</span><h2>${esc(t.title)}</h2>${theoryHtml(t.theory)}<button class="btn sm" id="theoryBoard">Теорию на доску</button></div>`:`<div class="card"><span class="pill">${st.grade||'—'} класс</span><h2>Без темы</h2><div class="notice"><b>Тема для этого занятия не назначена.</b><br>Урок всё равно доступен: видео, доска, таймер и очередь задач работают. Тему можно назначить позже в расписании.</div></div>`}${lessonSourcesHtml}<h3>Примеры</h3>${examples.map(x=>`<div class="item-box"><b>${esc(x.title||'Пример')}</b><div class="prewrap">${nl(x.content)}</div><button class="btn sm" data-to-board="${x.id}">На доску</button></div>`).join('')||'<div class="muted">Нет примеров</div>'}<h3>Задачи</h3>${tasks.map(x=>`<div class="item-box"><div class="actions" style="justify-content:space-between"><b>${esc(x.title||'Задача')}</b><span class="pill">${diffLabel(x.difficulty)}</span></div><div class="prewrap">${nl(x.content)}</div><div class="actions"><button class="btn sm" data-queue-task="${x.id}">+ В очередь</button><button class="btn sm" data-focus-task="${x.id}">В фокус</button><button class="btn sm" data-to-board="${x.id}">На доску</button></div></div>`).join('')||'<div class="muted">Нет задач</div>'}</div><div><div id="lessonBoard"></div></div></div>`,'Урок',`${st.name} · ${t.title}`);bindShell();
  let ctrl=await mountBoard(document.getElementById('lessonBoard'),st.id,true,{lessonId:lesson.id,studentName:st.name});S.boardController=ctrl;
  const updateLive=async patch=>{const {data,error}=await sb.from('lesson_live_state').update({...patch,updated_at:new Date().toISOString()}).eq('lesson_id',lesson.id).select().single();if(error)return fail(error);liveState=data;};
  const setCurrent=async q=>{await updateLive({current_queue_item_id:q?.id||null,current_title:q?.title||'',current_prompt:q?.prompt||'',current_position:q?.position||0});renderLesson()};
  const addQueue=async(exercise,makeCurrent=false)=>{const existing=(queue||[]).find(x=>x.exercise_id===exercise.id);let q=existing;if(!q){const {data,error}=await sb.from('lesson_queue_items').insert({teacher_id:S.user.id,lesson_id:lesson.id,exercise_id:exercise.id,title:exercise.title||'Задача',prompt:exercise.content,correct_answer:exercise.answer,difficulty:exercise.difficulty,category:exercise.category||'',tags:exercise.tags||[],position:(queue||[]).length}).select().single();if(error)return fail(error);q=data}if(makeCurrent)await setCurrent(q);else{toast('Добавлено в очередь');renderLesson()}};
  document.getElementById('leaveLesson').onclick=()=>{forgetActiveLesson();S.activeLesson=null;S.view='dashboard';renderTeacher()};document.getElementById('copyLessonLink').onclick=async()=>{await copyText(studentLink(st));toast('Ссылка скопирована')};const theoryBoardBtn=document.getElementById('theoryBoard');if(theoryBoardBtn&&realTopic)theoryBoardBtn.onclick=()=>sendTheoryToBoard(ctrl,realTopic);
  document.querySelectorAll('[data-lesson-source-open]').forEach(b=>b.onclick=()=>{const link=lessonSources.find(x=>String(x.id)===String(b.dataset.lessonSourceOpen));if(link?.textbook)openTextbook(link.textbook,Number(link.page_from)||0)});
  document.querySelectorAll('[data-lesson-source-board]').forEach(b=>b.onclick=()=>{const link=lessonSources.find(x=>String(x.id)===String(b.dataset.lessonSourceBoard));if(link)textbookPagesToBoardModal(link,{controller:ctrl})});
  document.querySelectorAll('[data-to-board]').forEach(b=>b.onclick=()=>{const x=S.exercises.find(z=>z.id===b.dataset.toBoard);ctrl.addText(`${x.title||'Задача'}\n${x.content}`,{fontSize:25});sb.from('exercises').update({use_count:(x.use_count||0)+1,last_used_at:new Date().toISOString()}).eq('id',x.id).then(()=>{})});
  document.querySelectorAll('[data-queue-task]').forEach(b=>b.onclick=()=>addQueue(S.exercises.find(x=>x.id===b.dataset.queueTask),false));document.querySelectorAll('[data-focus-task]').forEach(b=>b.onclick=()=>addQueue(S.exercises.find(x=>x.id===b.dataset.focusTask),true));
  document.querySelectorAll('[data-current]').forEach(b=>b.onclick=()=>setCurrent((queue||[]).find(x=>x.id===b.dataset.current)));document.querySelectorAll('[data-remove-queue]').forEach(b=>b.onclick=async()=>{await sb.from('lesson_queue_items').delete().eq('id',b.dataset.removeQueue);if(liveState.current_queue_item_id===b.dataset.removeQueue)await updateLive({current_queue_item_id:null,current_title:'',current_prompt:''});renderLesson()});
  document.querySelectorAll('[data-status]').forEach(b=>b.onclick=async()=>{if(!current)return;await sb.from('lesson_queue_items').update({status:b.dataset.status}).eq('id',current.id);renderLesson()});
  if(current){document.getElementById('currentToBoard').onclick=()=>ctrl.addText(`${current.title}\n${current.prompt}`,{fontSize:25});document.getElementById('currentToHomework').onclick=async()=>{if(!realTopic)return toast('Сначала назначь тему урока, чтобы добавить задачу в домашнюю');let hw=S.homeworks.find(x=>x.lesson_id===lesson.id&&x.status==='assigned');if(!hw){const {data,error}=await sb.from('homeworks').insert({teacher_id:S.user.id,student_id:st.id,topic_id:realTopic.id,lesson_id:lesson.id,title:`Домашняя после урока · ${realTopic.title}`}).select().single();if(error)return fail(error);hw=data}const {data:dup}=await sb.from('homework_items').select('id').eq('homework_id',hw.id).eq('source_queue_item_id',current.id).maybeSingle();if(!dup){const {error}=await sb.from('homework_items').insert({homework_id:hw.id,prompt:current.prompt,correct_answer:current.correct_answer,position:999,source_exercise_id:current.exercise_id,source_queue_item_id:current.id,difficulty:current.difficulty,category:current.category,tags:current.tags||[]});if(error)return fail(error)}await sb.from('lesson_queue_items').update({homework_added:true}).eq('id',current.id);await loadTeacher();renderLesson();toast('Добавлено в домашнюю')}}
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
  const isCrmTrial=lesson.lesson_type==='trial'||String(lesson.crm_event_key||'').startsWith('crm-trial:');
  const currentAttendance=['present','late','absent'].includes(lesson.attendance_status)?lesson.attendance_status:'';
  let selectedAttendance=currentAttendance;
  const attendanceHtml=`<section class="mr-finish-attendance">
    <div class="mr-finish-attendance-head"><div><span>ПОСЕЩАЕМОСТЬ</span><h3>Ученик был на уроке?</h3></div><em>Обязательно</em></div>
    <div class="mr-finish-attendance-options">
      <button type="button" data-finish-attendance="present" class="${currentAttendance==='present'?'active':''}"><b>✓</b><span>Был</span><small>Присутствовал на занятии</small></button>
      <button type="button" data-finish-attendance="late" class="${currentAttendance==='late'?'active':''}"><b>↘</b><span>Опоздал</span><small>Пришёл после начала урока</small></button>
      <button type="button" data-finish-attendance="absent" class="${currentAttendance==='absent'?'active':''}"><b>×</b><span>Не был</span><small>Ученик не присутствовал</small></button>
    </div>
    ${isCrmTrial?'<div class="mr-finish-attendance-note">Для пробного CRM отметит занятие проведённым только при «Был» или «Опоздал». При «Не был» потребуется назначить новую дату.</div>':''}
  </section>`;
  const m=modal(`<div class="mr-finish-modal-head"><span>ЗАВЕРШЕНИЕ УРОКА</span><h2>Итоги занятия</h2><p>Перед сохранением отметь посещаемость и проверь итоговые заметки.</p></div>${attendanceHtml}<div class="lesson-report-preview"><div class="report-stats"><span>Задач: ${counts.total}</span><span>Решено: ${counts.solved}</span><span>Сложно: ${counts.hard}</span><span>Позже: ${counts.later}</span><span>Разобрано: ${completion}%</span><span>Время: ${mins} мин</span></div></div><div class="grid cols2"><div class="field"><label>Что сегодня получилось</label><textarea id="finishHighlights">${esc(strengths?`Хорошо получалось: ${strengths}.`:`Уверенно решено ${counts.solved} из ${counts.total} задач.`)}</textarea></div><div class="field"><label>Что повторить</label><textarea id="finishFocus">${esc(focus?`Повторить: ${focus}.`:counts.later?`Вернуться к ${counts.later} отложенным задачам.`:'Закрепить материал по необходимости.')}</textarea></div></div><div class="field"><label>Итоги ученику</label><textarea id="finishSummary">${esc(summary)}</textarea></div><div class="field"><label>К следующему уроку</label><textarea id="finishPlan">${esc(plan)}</textarea></div><div class="field"><label>Приватная заметка</label><textarea id="finishPrivate">${esc(lesson.private_notes||`Очередь: ${counts.total}; решено: ${counts.solved}; сложно: ${counts.hard}; позже: ${counts.later}; таймер: ${mins} мин.`)}</textarea></div><button class="btn primary mr-finish-submit" id="finishConfirm" ${currentAttendance?'':'disabled'}>Завершить и сохранить доску</button>`);
  const finishConfirm=m.querySelector('#finishConfirm');
  m.querySelectorAll('[data-finish-attendance]').forEach(choice=>choice.onclick=()=>{
    selectedAttendance=choice.dataset.finishAttendance||'';
    m.querySelectorAll('[data-finish-attendance]').forEach(x=>x.classList.toggle('active',x===choice));
    if(finishConfirm)finishConfirm.disabled=!['present','late','absent'].includes(selectedAttendance);
  });
  m.querySelector('#finishConfirm').onclick=async()=>{
    const btn=m.querySelector('#finishConfirm');
    if(!btn||btn.dataset.busy==='1')return;

    /* Read form values before any async work can rerender/remove the modal. */
    const publicSummary=m.querySelector('#finishSummary')?.value||'';
    const homeworkPlan=m.querySelector('#finishPlan')?.value||'';
    const privateNotes=m.querySelector('#finishPrivate')?.value||'';
    const publicHighlights=m.querySelector('#finishHighlights')?.value||'';
    const publicFocus=m.querySelector('#finishFocus')?.value||'';
    const attendance=selectedAttendance;
    if(!['present','late','absent'].includes(attendance)){
      fail(new Error('Перед завершением урока обязательно отметьте посещаемость ученика'));
      return;
    }

    const originalText=btn.textContent;
    btn.dataset.busy='1';
    btn.disabled=true;
    btn.textContent='Сохраняем доску…';

    const withTimeout=(promise,ms,label)=>Promise.race([
      Promise.resolve(promise),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' · превышено время ожидания')),ms))
    ]);

    try{
      /* First flush the board, but don't let a stalled realtime save freeze the
         entire Finish button forever. The in-memory pages below are the source
         of truth for the final lesson snapshot. */
      if(S.boardController?.save){
        try{await withTimeout(S.boardController.save(),7000,'Сохранение доски')}catch(e){
          console.warn('[Mathroom finish board flush]',e);
        }
      }

      try{
        await withTimeout(S.boardController?.checkpoint?.('Финал урока'),5000,'Контрольная точка');
      }catch(e){
        console.warn('[Mathroom finish checkpoint]',e);
      }

      btn.textContent='Сохраняем итог…';

      /* Save exactly what is currently visible on the board, even if the
         background board_pages sync is still finishing. */
      let pages=S.boardController?.getPages?.()||null;
      if(!Array.isArray(pages)||!pages.length){
        const {data,error}=await sb.from('board_pages')
          .select('id,title,sort_order,elements')
          .eq('student_id',lesson.student_id)
          .eq('lesson_id',lesson.id)
          .order('sort_order');
        if(error)throw error;
        pages=data||[];
      }

      const {error:versionError}=await sb.from('lesson_board_versions').insert({
        teacher_id:S.user.id,
        lesson_id:lesson.id,
        title:'Итог урока',
        note:'Автоматически сохранено при завершении',
        pages
      });
      if(versionError)throw versionError;

      const completedAt=new Date().toISOString();
      const lessonCompletionPatch={
        status:'completed',
        completed_at:completedAt,
        public_summary:publicSummary,
        homework_plan:homeworkPlan,
        private_notes:privateNotes,
        attendance_status:attendance,
        attendance_marked_at:completedAt,
        actual_duration_minutes:attendance==='absent'?0:Math.max(0,mins)
      };
      const {error}=await sb.from('lessons').update(lessonCompletionPatch).eq('id',lesson.id);
      if(error)throw error;

      const report={
        teacher_id:S.user.id,
        lesson_id:lesson.id,
        student_id:lesson.student_id,
        topic_id:lesson.topic_id||null,
        duration_seconds:seconds,
        queue_total:counts.total,
        solved_count:counts.solved,
        hard_count:counts.hard,
        later_count:counts.later,
        pending_count:counts.pending,
        homework_count:counts.hw,
        completion_percent:completion,
        solved_percent:solvedPct,
        category_stats:categories,
        tag_stats:tags,
        public_highlights:publicHighlights,
        public_focus:publicFocus,
        private_summary:privateNotes,
        updated_at:completedAt
      };

      /* Report/live-state are secondary metadata. A failure here must not make
         a successfully saved lesson look like the Finish button did nothing. */
      const {error:reportError}=await sb.from('lesson_reports').upsert(report,{onConflict:'lesson_id'});
      if(reportError)console.warn('[Mathroom finish report]',reportError);

      const {error:liveError}=await sb.from('lesson_live_state').update({
        focus_enabled:false,
        timer_running:false,
        timer_started_at:null,
        timer_elapsed_seconds:seconds
      }).eq('lesson_id',lesson.id);
      if(liveError)console.warn('[Mathroom finish live state]',liveError);

      btn.textContent='Завершаем урок…';

      try{window.MathroomLessonSuite?.stopPhaseTimer?.()}catch{}
      try{await window.MathroomLiveCall?.stopRecording?.(true)}catch{}
      try{
        await window.MathroomLiveCall?.send?.(
          'lesson-ended',
          {lessonId:lesson.id,endedAt:completedAt},
          'student'
        );
      }catch{}
      try{await window.MathroomLiveCall?.end?.()}catch{}

      m.remove();
      forgetActiveLesson();
      await loadTeacher();
      S.activeLesson=null;
      S.view='history';
      renderTeacher();
      toast('Урок завершён · доска и отчёт сохранены');

      window.dispatchEvent(new CustomEvent('mathroom:teacher-lesson-completed',{
        detail:{lessonId:lesson.id,studentId:lesson.student_id,completedAt,attendanceStatus:attendance}
      }));

      if(nextTopic){
        const freshNext=S.topics.find(x=>String(x.id)===String(nextTopic.id))||nextTopic;
        const n=modal(`<span class="pill">Следующая тема по программе</span><h2>${esc(freshNext.title)}</h2><p class="muted">${freshNext.grade} класс · ${esc(topicTrack(freshNext))}</p><p>Можно сразу открыть тему или подставить её в форму следующего урока.</p><div class="actions"><button class="btn" id="finishOpenNext">Открыть тему</button><button class="btn primary" id="finishScheduleNext">Запланировать следующий урок</button></div>`);
        n.querySelector('#finishOpenNext').onclick=()=>{n.remove();S.topic=freshNext;S.topicGradeFilter=Number(freshNext.grade);S.view='topics';renderTeacher()};
        n.querySelector('#finishScheduleNext').onclick=()=>{n.remove();S.schedulePrefill={studentId:lesson.student_id,topicId:freshNext.id};S.view='schedule';renderTeacher()};
      }
    }catch(e){
      console.error('[Mathroom finish lesson]',e);
      btn.dataset.busy='';
      btn.disabled=false;
      btn.textContent='Повторить завершение';
      fail(e);
      setTimeout(()=>{
        if(btn?.isConnected && btn.dataset.busy!=='1')btn.textContent=originalText;
      },2500);
    }
  };
}

async function renderBoardPage(){
  S.view='scratch';
  S.selectedStudent='__scratch__';
  const teacherKey=S.user?.id||S.teacher?.id||'teacher';
  app.innerHTML=shell(`<div id="boardRoot"><div class="card board-loading-card"><div class="muted">Загружаем черновик…</div></div></div>`,'Черновик','Личная рабочая доска преподавателя');
  bindShell();
  const root=document.getElementById('boardRoot');
  try{
    const scratchKey=`mathroom.teacher.scratch.${teacherKey}`;
    let controller=null;
    try{controller=await mountBoard(root,'teacher-scratch',true,{localOnly:true,localKey:scratchKey})}
    catch(firstError){
      console.warn('[Mathroom scratch] первая загрузка не удалась, восстанавливаем чистое рабочее состояние',firstError);
      try{const old=localStorage.getItem(scratchKey);if(old)localStorage.setItem(`${scratchKey}.backup.${Date.now()}`,old);localStorage.removeItem(scratchKey)}catch{}
      root.innerHTML='';
      controller=await mountBoard(root,'teacher-scratch',true,{localOnly:true,localKey:scratchKey});
      toast('Черновик восстановлен. Старые данные сохранены в резервной копии браузера.');
    }
    S.boardController=controller||null;
    if(!controller){
      root.innerHTML=`<div class="card"><h2>Не удалось открыть черновик</h2><p class="muted">Попробуй обновить страницу. Если проблема повторится, перезапусти черновик кнопкой ниже.</p><div class="actions"><button class="btn primary" id="retryBoardMount">Обновить черновик</button></div></div>`;
      root.querySelector('#retryBoardMount')?.addEventListener('click',()=>renderBoardPage());
    }
  }catch(e){
    console.error('[Mathroom scratch board page]',e);
    root.innerHTML=`<div class="card"><h2>Ошибка загрузки черновика</h2><p class="muted">Личный черновик преподавателя не смог загрузиться. Навигация сохранена — можно быстро перезапустить доску.</p><div class="actions"><button class="btn primary" id="retryBoardMount">Перезапустить черновик</button></div></div>`;
    root.querySelector('#retryBoardMount')?.addEventListener('click',()=>renderBoardPage());
  }
}

async function bootStudent(){
  if(!configured)return configScreen();let {data:{session}}=await sb.auth.getSession();if(session&&!session.user.is_anonymous){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Открой ссылку ученика отдельно</h1><p>В этом браузере уже выполнен вход преподавателя. Открой ссылку ученика в режиме инкогнито или на другом устройстве.</p></div></div>`;return}if(!session){const {data,error}=await sb.auth.signInAnonymously();if(error){app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Нужно включить Anonymous Sign-Ins</h1><p>${esc(error.message)}</p></div></div>`;return}session=data.session}
  const {data:claimed,error:claimErr}=await sb.rpc('claim_student_access',{p_token:S.access});if(claimErr){app.innerHTML=`<div class="center-page"><div class="auth-card"><div class="brand">Mathroom</div><h1>Ссылка недействительна</h1><p>Попроси преподавателя прислать новую ссылку.</p></div></div>`;return}const {data:student,error}=await sb.from('students').select('id,name,grade').eq('id',claimed.id).single();if(error)return fail(error);S.student=student;renderStudent();
}
async function getStudentData(){
  const [{data:lessons},{data:homeworks},{data:tests},{data:reports}]=await Promise.all([sb.rpc('get_my_lessons'),sb.from('homeworks').select('id,title,status,score,comment,created_at,submitted_at,due_at,source,attempt_count,last_attempt_at,reviewed_at,revision_requested_at,revision_message,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),sb.from('tests').select('id,title,status,score,source,created_at,submitted_at,topics(title)').eq('student_id',S.student.id).order('created_at',{ascending:false}),sb.rpc('get_my_lesson_reports')]);
  const lessonRows=Array.isArray(lessons)?lessons:[];
  let versions=[];
  try{
    const ids=lessonRows.filter(x=>x.status==='completed').map(x=>x.id);
    if(ids.length){
      const vr=await sb.from('lesson_board_versions').select('id,lesson_id,title,note,pages,created_at').in('lesson_id',ids).order('created_at',{ascending:false});
      if(!vr.error)versions=vr.data||[];
    }
  }catch(e){console.info('[Mathroom student board archive] unavailable',e)}
  return {lessons:lessonRows,homeworks:homeworks||[],tests:tests||[],reports:Array.isArray(reports)?reports:[],versions};
}
function studentPreLessonGate(lessons){
  const now=Date.now();
  return (lessons||[])
    .filter(x=>x.status==='assigned'&&x.scheduled_at)
    .map(x=>({lesson:x,at:new Date(x.scheduled_at).getTime()}))
    .filter(x=>Number.isFinite(x.at)&&now>=x.at-5*60000&&now<=x.at+Math.max(90,Number(x.lesson.duration_minutes||60)+30)*60000)
    .sort((a,b)=>a.at-b.at)[0]?.lesson||null;
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
function studentMobileNavIcon(name){
  const icons={
    home:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.2 12 4l8 7.2"/><path d="M6.5 10.3V20h11v-9.7"/><path d="M9.5 20v-5.5h5V20"/></svg>',
    tasks:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="m8 10 1.6 1.6L12.5 8.7M8 15h8"/></svg>',
    board:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="13" rx="2"/><path d="M8 21h8M12 17.5V21"/><path d="m8 13 2.1-2.1 1.8 1.8L16 8.6"/></svg>',
    more:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
    progress:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-7"/></svg>',
    lessons:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>'
  };
  return icons[name]||icons.more;
}
function studentMobileAssignmentsHtml(d){
  const all=[...d.homeworks.map(x=>({...x,kind:'homework'})),...d.tests.map(x=>({...x,kind:'test'}))].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const open=all.filter(x=>x.status==='assigned'),done=all.filter(x=>x.status!=='assigned');
  const card=x=>{
    const revision=x.kind==='homework'&&x.status==='assigned'&&x.revision_requested_at;
    const overdue=x.kind==='homework'&&x.due_at&&x.status==='assigned'&&!revision&&new Date(x.due_at).getTime()<Date.now();
    const meta=[x.topics?.title||'',x.kind==='homework'&&x.due_at?`до ${new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}`:'',x.score!=null?`${x.score}%`:''].filter(Boolean).join(' · ');
    return `<article class="mr-mobile-assignment ${revision?'revision':''} ${overdue?'overdue':''}">
      <div class="mr-mobile-assignment-main"><span class="mr-mobile-kicker">${x.kind==='homework'?'Домашняя работа':'Тест'}${revision?' · доработка':overdue?' · просрочено':''}</span><h3>${esc(x.title)}</h3><p>${esc(meta||statusLabel(x.status))}</p></div>
      <button class="btn ${x.status==='assigned'?'primary':''}" data-student-assignment="${x.kind}:${x.id}">${x.status==='assigned'?(revision?'Исправить':'Открыть'):'Посмотреть'}</button>
    </article>`;
  };
  return `<section class="mr-mobile-page-head"><div><span class="mr-mobile-kicker">Мои задания</span><h1>Задания</h1></div><span class="mr-mobile-count">${open.length}</span></section>
    <section class="mr-mobile-section"><div class="mr-mobile-section-title"><h2>Нужно сделать</h2><span>${open.length}</span></div><div class="mr-mobile-list">${open.length?open.map(card).join(''):'<div class="mr-mobile-empty">Сейчас активных заданий нет.</div>'}</div></section>
    ${done.length?`<section class="mr-mobile-section"><div class="mr-mobile-section-title"><h2>Готово</h2><span>${done.length}</span></div><div class="mr-mobile-list compact">${done.slice(0,8).map(card).join('')}</div></section>`:''}`;
}
function studentLessonRecordingUrl(l){
  const raw=String(l?.recording_url||l?.video_url||l?.recordingUrl||'').trim();
  return /^https?:\/\//i.test(raw)?raw:'';
}
function openStudentLessonBoardArchive(version){
  if(!version)return;
  const m=modal(`<div class="mr-card-head"><div><span class="koto-eyebrow">ДОСКА УРОКА</span><h2>${esc(version.title||'Доска урока')}</h2><p class="muted">${esc(version.note||'Сохранено преподавателем после занятия')}</p></div></div><div id="studentLessonSnapshot"></div>`,'snapshot-modal');
  mountSnapshot(m.querySelector('#studentLessonSnapshot'),version.pages||[]);
}
function studentMobileLessonsHtml(d){
  const lessons=[...d.lessons].filter(x=>x.status==='completed').sort((a,b)=>String(b.completed_at||b.scheduled_at||'').localeCompare(String(a.completed_at||a.scheduled_at||'')));
  const versions=d.versions||[];
  return `<section class="mr-mobile-page-head"><div><span class="mr-mobile-kicker">Архив занятий</span><h1>Уроки</h1></div><span class="mr-mobile-count">${lessons.length}</span></section>
    <p class="mr-mobile-page-intro">Здесь остаются материалы после занятия: запись урока, сохранённая доска и короткий итог преподавателя.</p>
    <div class="mr-mobile-list">${lessons.length?lessons.map(l=>{
      const r=(d.reports||[]).find(x=>x.lesson_id===l.id);
      const boardVersions=versions.filter(v=>v.lesson_id===l.id);
      const board=boardVersions[0]||null;
      const recording=studentLessonRecordingUrl(l);
      return `<article class="mr-mobile-lesson-card archive">
        <div class="mr-mobile-lesson-main"><span class="mr-mobile-kicker">${esc(dateLong(l.completed_at||l.scheduled_at))}</span><h3>${esc(l.topics?.title||'Урок')}</h3><p>${l.duration_minutes||60} мин · занятие завершено</p></div>
        ${r?`<div class="mr-mobile-lesson-score"><b>${Math.round(Number(r.solved_percent||0))}%</b><span>уверенно</span></div>`:''}
        <div class="mr-mobile-lesson-assets">
          ${recording?`<button class="mr-mobile-lesson-asset video ready" data-lesson-recording="${esc(recording)}"><span>▶</span><div><b>Видеозапись</b><small>Посмотреть урок</small></div><i>›</i></button>`:`<div class="mr-mobile-lesson-asset video disabled"><span>▶</span><div><b>Видеозапись</b><small>Ещё не загружена</small></div></div>`}
          ${board?`<button class="mr-mobile-lesson-asset board ready" data-lesson-board-version="${board.id}"><span>⌁</span><div><b>Доска урока</b><small>${boardVersions.length>1?`${boardVersions.length} версии`:'Открыть сохранённую доску'}</small></div><i>›</i></button>`:`<div class="mr-mobile-lesson-asset board disabled"><span>⌁</span><div><b>Доска урока</b><small>Версия не сохранена</small></div></div>`}
        </div>
        ${r?.public_highlights?`<div class="mr-mobile-lesson-note"><b>Получилось</b><p>${nl(r.public_highlights)}</p></div>`:''}
        ${r?.public_focus?`<div class="mr-mobile-lesson-note warn"><b>Повторить</b><p>${nl(r.public_focus)}</p></div>`:''}
      </article>`;
    }).join(''):'<div class="mr-mobile-empty">После первого завершённого урока здесь появятся его материалы.</div>'}</div>`;
}
function studentMobileMoreHtml(){
  return `<section class="mr-mobile-page-head"><div><span class="mr-mobile-kicker">Кабинет</span><h1>Ещё</h1></div></section>
    <section class="mr-mobile-profile-card"><div class="mr-mobile-avatar">${esc(String(S.student.name||'?').trim().charAt(0).toUpperCase())}</div><div><b>${esc(S.student.name)}</b><span>${esc(String(S.student.grade))} класс</span></div></section>
    <div class="mr-mobile-menu-list">
      <button data-mobile-tab="progress"><span class="mr-mobile-menu-icon">${studentMobileNavIcon('progress')}</span><span><b>Прогресс</b><small>результаты, сильные темы и что повторить</small></span><i>›</i></button>
    </div>`;
}
function studentMobileBottomNav(activeTab){
  const moreActive=['more','progress'].includes(activeTab);
  return `<nav class="mr-mobile-student-nav" aria-label="Навигация кабинета">
    <button data-mobile-tab="today" class="${activeTab==='today'?'active':''}">${studentMobileNavIcon('home')}<span>Главная</span></button>
    <button data-mobile-tab="tasks" class="${activeTab==='tasks'?'active':''}">${studentMobileNavIcon('tasks')}<span>Задания</span></button>
    <button data-mobile-tab="lessons" class="${activeTab==='lessons'?'active':''}">${studentMobileNavIcon('lessons')}<span>Уроки</span></button>
    <button data-mobile-tab="more" class="${moreActive?'active':''}">${studentMobileNavIcon('more')}<span>Ещё</span></button>
  </nav>`;
}

function studentDeskIcon(name){
  const icons={
    spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M7.1 7.1l2.1 2.1M14.8 14.8l2.1 2.1M16.9 7.1l-2.1 2.1M9.2 14.8l-2.1 2.1"/><circle cx="12" cy="12" r="3"/>',
    ruler:'<path d="M4 18.5 16.5 6 20 9.5 7.5 22H4z"/><path d="m12 10 2 2M9 13l2 2M6 16l2 2"/>',
    clipboard:'<path d="M9 5h6"/><rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v4H9zM8.5 12h7M8.5 16h5"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/>',
    book:'<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23zM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23z"/>',
    trophy:'<path d="M8 4h8v5a4 4 0 0 1-8 0zM10 15h4M12 13v5M8 21h8"/><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(icons[name]||icons.spark)+'</svg>';
}
function studentDeskEmpty(icon,title,text,tab,label){
  return '<div class="mr-desk-empty-state"><div class="mr-desk-empty-icon">'+studentDeskIcon(icon)+'</div><div><b>'+esc(title)+'</b><p>'+esc(text)+'</p></div>'+(tab?'<button class="btn sm" data-desktop-tab="'+tab+'">'+esc(label||'Открыть')+' '+studentDeskIcon('arrow')+'</button>':'')+'</div>';
}
function studentDesktopSidebar(activeTab,d){
  const openAssignments=[...(d?.homeworks||[]),...(d?.tests||[])].filter(x=>x.status==='assigned').length;
  const item=(tab,icon,label,badge='')=>'<button data-desktop-tab="'+tab+'" class="'+(activeTab===tab?'active':'')+'">'+studentMobileNavIcon(icon)+'<span class="mr-desk-nav-label">'+label+'</span>'+(badge?'<span class="mr-desk-nav-badge">'+badge+'</span>':'')+'</button>';
  return '<aside class="mr-student-desktop-sidebar">'+
    '<div class="mr-student-desktop-brand"><span class="brand">Mathroom <i></i><i></i></span><small>Личный кабинет</small></div>'+
    '<nav>'+
      item('today','home','Главная')+
      item('tasks','tasks','Задания',openAssignments?String(Math.min(openAssignments,99)):'')+
      item('lessons','lessons','Уроки')+
      item('progress','progress','Прогресс')+
      item('more','more','Ещё')+
    '</nav>'+
    '<div class="mr-desk-sidebar-tip"><span>'+studentDeskIcon('spark')+'</span><div><b>Маленькими шагами</b><small>Регулярность важнее скорости.</small></div></div>'+
    '<div class="mr-student-desktop-profile">'+
      '<div class="mr-student-desktop-avatar">'+esc(String(S.student.name||'?').trim().charAt(0).toUpperCase())+'</div>'+
      '<div><b>'+esc(S.student.name)+'</b><span>'+esc(String(S.student.grade))+' класс</span></div>'+
    '</div>'+
  '</aside>';
}
function studentDesktopProgressSummary(d){
  const reports=(d.reports||[]).slice(0,6);
  const avgRecent=reports.length?Math.round(reports.reduce((s,r)=>s+Number(r.solved_percent||0),0)/reports.length):null;
  const hws=d.homeworks.filter(x=>x.score!=null),tests=d.tests.filter(x=>x.score!=null);
  return {overall:avgRecent,homework:avg(hws.map(x=>x.score)),tests:avg(tests.map(x=>x.score)),lessons:reports.length};
}
function studentDesktopHomeHtml(d){
  const now=Date.now();
  const next=d.lessons.filter(x=>x.status==='assigned'&&x.scheduled_at&&new Date(x.scheduled_at).getTime()>=now-5*60000).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at))[0]||null;
  const open=[...d.homeworks.map(x=>({...x,kind:'homework'})),...d.tests.map(x=>({...x,kind:'test'}))].filter(x=>x.status==='assigned').sort((a,b)=>String(a.due_at||'2999').localeCompare(String(b.due_at||'2999')));
  const current=open[0]||null;
  const completed=d.lessons.filter(x=>x.status==='completed').sort((a,b)=>String(b.completed_at||b.scheduled_at||'').localeCompare(String(a.completed_at||a.scheduled_at||''))).slice(0,4);
  const upcoming=d.lessons.filter(x=>x.status==='assigned'&&x.scheduled_at).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,4);
  const latest=(d.reports||[]).slice().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null;
  const ps=studentDesktopProgressSummary(d);
  const firstName=esc(String(S.student.name||'').split(/\s+/)[0]||'');
  const nextDate=next?new Date(next.scheduled_at):null;
  return '<div class="mr-student-desktop-home-grid">'+
    '<section class="mr-student-desktop-main">'+
      '<section class="mr-desk-hero-welcome">'+
        '<div class="mr-desk-hero-copy"><span class="mr-desk-soft-badge">Mathroom · твой учебный кабинет</span><p>Привет, '+firstName+'!</p><h1>Продолжаем учиться<br>и открывать новое</h1><small>Уроки, задания и твой прогресс — всё собрано в одном месте.</small>'+
        '<div class="mr-desk-hero-actions">'+(next?'<button class="btn primary" data-desktop-tab="lessons">К следующему уроку '+studentDeskIcon('arrow')+'</button>':open.length?'<button class="btn primary" data-desktop-tab="tasks">Продолжить задание '+studentDeskIcon('arrow')+'</button>':'<button class="btn primary" data-desktop-tab="progress">Посмотреть прогресс '+studentDeskIcon('arrow')+'</button>')+'<button class="btn ghost" data-desktop-tab="lessons">Все уроки</button></div></div>'+
        '<div class="mr-desk-hero-art" aria-hidden="true"><span class="mr-desk-art-orb">'+studentDeskIcon('spark')+'</span><b>x² + y²</b><i>π</i><em>✓</em><span class="mr-desk-art-card">'+studentDeskIcon('book')+'</span></div>'+
      '</section>'+
      '<div class="mr-student-desktop-hero-grid">'+
        '<article class="mr-desk-card mr-desk-next">'+
          '<div class="mr-desk-card-head"><div><span class="mr-mobile-kicker">Следующий урок</span><h2>'+(next?esc(next.topics?.title||'Урок'):'Пока урок не назначен')+'</h2></div>'+(next?'<span class="mr-desk-date-chip"><b>'+nextDate.toLocaleDateString('ru-RU',{day:'2-digit'})+'</b><small>'+nextDate.toLocaleDateString('ru-RU',{month:'short'}).replace('.','')+'</small></span>':'')+'</div>'+
          '<div class="mr-desk-feature-row"><span class="mr-desk-feature-icon">'+studentDeskIcon('ruler')+'</span><div><p>'+(next?esc(dateLong(next.scheduled_at))+' · '+Number(next.duration_minutes||60)+' мин':'Как только преподаватель назначит занятие, оно появится здесь.')+'</p>'+(next?'<small>Подготовь тетрадь и подключись за пару минут до начала.</small>':'<small>А пока можно выполнить задания или посмотреть прогресс.</small>')+'</div></div>'+
          '<div class="mr-desk-hero-actions">'+(next?'<button class="btn primary" id="mrDeskPrepareLesson">Подготовиться '+studentDeskIcon('arrow')+'</button>':'<button class="btn primary" data-desktop-tab="lessons">Открыть уроки '+studentDeskIcon('arrow')+'</button>')+'<button class="btn" data-desktop-tab="lessons">Материалы</button></div>'+
        '</article>'+
        '<article class="mr-desk-card mr-desk-current-task">'+
          '<div class="mr-desk-card-head"><div><span class="mr-mobile-kicker">Текущее задание</span><h2>'+(current?esc(current.title):'Заданий нет')+'</h2></div>'+(current?'<span class="mr-desk-status-chip">В работе</span>':'')+'</div>'+
          '<div class="mr-desk-feature-row"><span class="mr-desk-feature-icon task">'+studentDeskIcon('clipboard')+'</span><div><p>'+(current?esc(current.topics?.title||'Домашняя работа')+(current.due_at?' · до '+new Date(current.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}):''):'Все обязательные задания уже выполнены.')+'</p><small>'+(current?'Лучше сделать понемногу сейчас, чем всё перед уроком.':'Можно спокойно повторить тему или посмотреть материалы уроков.')+'</small></div></div>'+
          (current?'<button class="btn primary" data-student-assignment="'+current.kind+':'+current.id+'">Продолжить '+studentDeskIcon('arrow')+'</button>':'<button class="btn" data-desktop-tab="progress">Посмотреть прогресс '+studentDeskIcon('arrow')+'</button>')+
        '</article>'+
      '</div>'+
      (latest?.public_highlights||latest?.public_focus?'<article class="mr-desk-card mr-desk-feedback"><div class="mr-desk-card-head"><div><span class="mr-mobile-kicker">Обратная связь</span><h2>После последнего урока</h2></div><span class="mr-desk-feedback-mark">'+studentDeskIcon('check')+'</span></div>'+(latest.public_highlights?'<div><b>Получилось</b><p>'+nl(latest.public_highlights)+'</p></div>':'')+(latest.public_focus?'<div class="warn"><b>Повторить</b><p>'+nl(latest.public_focus)+'</p></div>':'')+'</article>':'')+
      '<section class="mr-desk-card mr-desk-tasks-section"><div class="mr-desk-section-head"><div><span class="mr-mobile-kicker">Задания</span><h2>Что нужно сделать</h2></div><button data-desktop-tab="tasks">Все задания '+studentDeskIcon('arrow')+'</button></div>'+
        (open.length?'<div class="mr-desk-task-strip">'+open.slice(0,4).map((x,i)=>'<button data-student-assignment="'+x.kind+':'+x.id+'"><span class="mr-desk-task-number">'+String(i+1).padStart(2,'0')+'</span><div><b>'+esc(x.title)+'</b><small>'+esc(x.topics?.title||'')+(x.due_at?' · до '+new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}):'')+'</small></div><i>'+studentDeskIcon('arrow')+'</i></button>').join('')+'</div>':studentDeskEmpty('check','Всё готово','Новых заданий сейчас нет. Отличный момент немного отдохнуть.','lessons','К урокам'))+
      '</section>'+
      '<section class="mr-desk-card mr-desk-recent-section"><div class="mr-desk-section-head"><div><span class="mr-mobile-kicker">Недавние уроки</span><h2>Записи и материалы</h2></div><button data-desktop-tab="lessons">Все уроки '+studentDeskIcon('arrow')+'</button></div>'+
        (completed.length?'<div class="mr-desk-recent-lessons">'+completed.map(l=>{const r=(d.reports||[]).find(x=>x.lesson_id===l.id);return '<button data-desktop-tab="lessons"><span class="mr-desk-mini-icon">'+studentDeskIcon('book')+'</span><div><span>'+new Date(l.completed_at||l.scheduled_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})+'</span><b>'+esc(l.topics?.title||'Урок')+'</b><small>'+(r?Math.round(Number(r.solved_percent||0))+'% уверенно · ':'')+'запись и доска</small></div><i>'+studentDeskIcon('arrow')+'</i></button>'}).join('')+'</div>':studentDeskEmpty('book','Архив пока пуст','После первого завершённого урока здесь появятся запись и доска.'))+
      '</section>'+
    '</section>'+
    '<aside class="mr-student-desktop-rail">'+
      '<article class="mr-desk-card mr-desk-progress-summary"><div class="mr-desk-section-head"><div><span class="mr-mobile-kicker">Мой прогресс</span><h2>'+(ps.overall==null?'Начинаем':ps.overall+'%')+'</h2></div><button data-desktop-tab="progress">Подробнее '+studentDeskIcon('arrow')+'</button></div><div class="mr-desk-progress-ring" style="--p:'+(ps.overall||0)+'"><span><b>'+(ps.overall==null?'—':ps.overall+'%')+'</b><small>пройдено</small></span></div><div class="mr-desk-progress-stats"><div><b>'+ps.lessons+'</b><span>уроков</span></div><div><b>'+(ps.homework==null?'—':ps.homework+'%')+'</b><span>домашние</span></div><div><b>'+(ps.tests==null?'—':ps.tests+'%')+'</b><span>тесты</span></div></div></article>'+
      '<article class="mr-desk-card mr-desk-upcoming-card"><div class="mr-desk-section-head"><div><span class="mr-mobile-kicker">Ближайшие занятия</span><h2>Расписание</h2></div><button data-desktop-tab="lessons">Все '+studentDeskIcon('arrow')+'</button></div><div class="mr-desk-upcoming">'+(upcoming.length?upcoming.map(l=>{const dt=new Date(l.scheduled_at);return '<div><span class="mr-desk-date-box"><b>'+dt.toLocaleDateString('ru-RU',{day:'2-digit'})+'</b><small>'+dt.toLocaleDateString('ru-RU',{month:'short'}).replace('.','')+'</small></span><div><b>'+esc(l.topics?.title||'Урок')+'</b><small>'+dt.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+' · '+Number(l.duration_minutes||60)+' мин</small></div><i>'+studentDeskIcon('calendar')+'</i></div>'}).join(''):'<div class="mr-desk-empty-mini"><span>'+studentDeskIcon('calendar')+'</span><p>На этой неделе занятий пока нет.</p></div>')+'</div></article>'+
      '<article class="mr-desk-card mr-desk-micro-tip"><span class="mr-desk-feature-icon">'+studentDeskIcon('spark')+'</span><div><span class="mr-mobile-kicker">Полезная подсказка</span><b>'+(open.length?'Начни с самого короткого задания':'Повтори тему 10 минут')+'</b><p>'+(open.length?'Так проще войти в ритм и не откладывать всё на потом.':'Небольшое повторение помогает лучше закрепить материал.')+'</p></div></article>'+
    '</aside>'+
  '</div>';
}
function studentDesktopTasksHtml(d){
  const all=[...d.homeworks.map(x=>({...x,kind:'homework'})),...d.tests.map(x=>({...x,kind:'test'}))].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  return '<div class="mr-desk-page-head"><div><span class="mr-desk-soft-badge">Учебный план</span><h1>Задания</h1><p>Домашние работы, тесты и задания на доработку.</p></div></div>'+
    (all.length?'<div class="mr-desk-assignment-list">'+all.map(x=>{const revision=x.kind==='homework'&&x.status==='assigned'&&x.revision_requested_at;const overdue=x.kind==='homework'&&x.due_at&&x.status==='assigned'&&!revision&&new Date(x.due_at)<new Date();const done=x.status!=='assigned';return '<article class="'+(revision?'revision ':'')+(overdue?'overdue ':'')+(done?'done':'')+'"><span class="mr-desk-feature-icon task">'+studentDeskIcon(x.kind==='test'?'check':'clipboard')+'</span><div class="mr-desk-assignment-copy"><div class="mr-desk-assignment-tags"><span>'+(x.kind==='homework'?'Домашняя работа':'Тест')+'</span>'+(revision?'<i>Нужна доработка</i>':overdue?'<i>Просрочено</i>':done?'<i class="good">Выполнено</i>':'<i>В работе</i>')+'</div><h3>'+esc(x.title)+'</h3><p>'+esc(x.topics?.title||'')+(x.due_at?' · срок '+new Date(x.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}):'')+(x.score!=null?' · результат '+x.score+'%':'')+'</p></div><button class="btn '+(x.status==='assigned'?'primary':'')+'" data-student-assignment="'+x.kind+':'+x.id+'">'+(x.status==='assigned'?(revision?'Исправить':'Открыть'):'Посмотреть')+' '+studentDeskIcon('arrow')+'</button></article>'}).join('')+'</div>':studentDeskEmpty('clipboard','Заданий пока нет','Когда преподаватель выдаст домашнюю работу или тест, они появятся здесь.','lessons','Перейти к урокам'));
}
function studentDesktopLessonsHtml(d){
  return `<div class="mr-desk-page-head"><div><span class="mr-mobile-kicker">Архив занятий</span><h1>Уроки</h1><p>Видеозаписи, сохранённые доски и итоги проведённых занятий.</p></div></div><div class="mr-desk-lessons-grid">${studentMobileLessonsHtml(d).replace(/^<section[\s\S]*?<\/section>\s*<p[\s\S]*?<\/p>/,'').replace('<div class="mr-mobile-list">','').replace(/<\/div>\s*$/,'')}</div>`;
}
function studentDesktopMoreHtml(){
  return '<div class="mr-desk-page-head"><div><span class="mr-desk-soft-badge">Кабинет</span><h1>Ещё</h1><p>Профиль и дополнительные разделы.</p></div></div>'+
    '<div class="mr-desk-more-grid"><article class="mr-desk-card mr-desk-profile-card"><div class="mr-student-desktop-avatar large">'+esc(String(S.student.name||'?').trim().charAt(0).toUpperCase())+'</div><div><span class="mr-mobile-kicker">Профиль ученика</span><h2>'+esc(S.student.name)+'</h2><p>'+esc(String(S.student.grade))+' класс</p></div></article>'+
    '<article class="mr-desk-card mr-desk-materials-shortcuts"><button data-desktop-tab="progress"><span class="mr-desk-mini-icon">'+studentDeskIcon('trophy')+'</span><div><b>Прогресс</b><small>Результаты и динамика</small></div><i>'+studentDeskIcon('arrow')+'</i></button><button data-desktop-tab="lessons"><span class="mr-desk-mini-icon">'+studentDeskIcon('book')+'</span><div><b>Архив уроков</b><small>Записи и сохранённые доски</small></div><i>'+studentDeskIcon('arrow')+'</i></button></article></div>';
}
async function renderStudent(){
  cleanupAll();const d=await getStudentData(),{active,live}=await currentStudentLive(d.lessons);S.studentLive=live;
  const preLesson=active?null:studentPreLessonGate(d.lessons);
  S.studentPreLesson=preLesson||null;

  if(preLesson){
    const startsAt=new Date(preLesson.scheduled_at);
    const seconds=Math.max(0,Math.ceil((startsAt.getTime()-Date.now())/1000));
    const countdown=seconds>0?('До начала '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')):'Можно подключаться';
    app.innerHTML=`<div class="student-home student-prelesson-mode">
      <div id="mrStudentVideoMount" class="mr-student-video-top" hidden></div>
      <header class="mr-prelesson-header">
        <div><span class="brand">Mathroom</span><small>Урок скоро начнётся</small></div>
        <span class="mr-prelesson-countdown" id="mrPreLessonCountdown">${esc(countdown)}</span>
      </header>
      <section class="mr-prelesson-connect">
        <div>
          <span class="mr-mobile-kicker">Через несколько минут</span>
          <h1>${esc(preLesson.topics?.title||'Урок')}</h1>
          <p>${esc(dateLong(preLesson.scheduled_at))} · ${Number(preLesson.duration_minutes||60)} мин</p>
        </div>
        <button class="btn primary" id="mrStudentPreLessonJoin">Подключиться к уроку</button>
      </section>
      <section class="mr-prelesson-board">
        <div class="mr-prelesson-board-head"><div><span class="mr-mobile-kicker">Онлайн-доска</span><h2>Можно подготовиться к занятию</h2></div><span>Изменения сохраняются автоматически</span></div>
        <div id="studentPreLessonBoard"></div>
      </section>
    </div>`;
    await mountBoard(document.getElementById('studentPreLessonBoard'),S.student.id,false,{lessonId:preLesson.id,studentName:S.student.name,followTeacher:true,teacherId:preLesson.teacher_id||''});
    const updateCountdown=()=>{
      const el=document.getElementById('mrPreLessonCountdown');if(!el)return;
      const left=Math.max(0,Math.ceil((startsAt.getTime()-Date.now())/1000));
      el.textContent=left>0?('До начала '+String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0')):'Можно подключаться';
    };
    const countdownTimer=setInterval(updateCountdown,1000);
    S.liveCleanup=()=>clearInterval(countdownTimer);
    const join=document.getElementById('mrStudentPreLessonJoin');
    if(join)join.onclick=()=>{
      let tries=0;
      const open=()=>{
        const liveCall=window.MathroomLiveCall;
        if(liveCall?.openPrejoin)return liveCall.openPrejoin();
        if(tries++<12)return setTimeout(open,120);
        toast('Подключение ещё готовится. Попробуй ещё раз через секунду.');
      };
      open();
    };
    return;
  }

  const ua=String(navigator.userAgent||'');
  const touch=Number(navigator.maxTouchPoints||0)>0;
  const mobileUA=/iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(ua);
  const iPadOS=/Macintosh/i.test(ua)&&touch;
  const viewportW=Math.max(Number(window.innerWidth||0),Number(document.documentElement?.clientWidth||0));
  // Desktop/laptop mode is selected by the actual viewport, not by touch capability.
  // This prevents touchscreen Windows laptops from being incorrectly forced into the mobile student UI.
  /* Keep the existing compact cabinet breakpoint, but let active lessons
     use the responsive desktop workspace on small desktop/laptop windows. */
  const compactLessonUI=(mobileUA||iPadOS||viewportW<=1100);
  const compactActiveLessonUI=(mobileUA||iPadOS||viewportW<=760);

  if(active&&live&&compactActiveLessonUI){
    S.studentTab='board';
    app.innerHTML=`<div class="student-home student-lesson-mode ${live.focus_enabled?'student-focus-enabled':''}"><div id="studentLessonTaskMount">${studentLessonTaskCard(live)}</div><div id="studentLessonBoard"></div></div>`;
    await mountBoard(document.getElementById('studentLessonBoard'),S.student.id,false,{lessonId:active.id,studentName:S.student.name,followTeacher:true});
    mountStudentLessonTimer(live,active);
    subscribeStudentLive(active.id);
    return;
  }

  if(compactLessonUI){
    if(!S.mobileStudentShellInitialized){
      S.studentTab='today';
      S.mobileStudentShellInitialized=true;
    }
    if(!['today','tasks','more','progress','lessons'].includes(S.studentTab))S.studentTab='today';
    const tab=S.studentTab;
    app.innerHTML=`<div class="student-home student-mobile-shell tab-${tab}">
      ${tab==='progress'
        ? `<header class="mr-mobile-web-head mr-progress-sticky-head"><button type="button" id="mrProgressBackToMore" class="mr-progress-head-back" aria-label="Назад в раздел Ещё"><span aria-hidden="true">←</span><b>Ещё</b></button><div class="mr-progress-head-title"><b>Прогресс</b><small>Результаты и динамика</small></div></header>`
        : `<header class="mr-mobile-web-head"><div><span class="brand">Mathroom</span><small>Кабинет ученика</small></div><div class="mr-mobile-student-mini"><b>${esc(S.student.name)}</b><span>${esc(String(S.student.grade))} класс</span></div></header>`}
      <main id="studentContent" class="mr-mobile-student-content"></main>
      ${studentMobileBottomNav(tab)}
    </div>`;
    const content=document.getElementById('studentContent');
    if(tab==='today'){
      content.innerHTML=`<section class="mr-mobile-welcome"><span>Привет, ${esc(String(S.student.name||'').split(/\s+/)[0]||'')}</span><h1>Что сегодня?</h1><p>Урок, задания и следующий шаг — в одном месте.</p></section><div id="mrStudentToday" class="mr-student-today"><div class="mr-mobile-skeleton-card"></div><div class="mr-mobile-skeleton-card small"></div></div>`;
    }else if(tab==='tasks'){
      content.innerHTML=studentMobileAssignmentsHtml(d);
      content.querySelectorAll('[data-student-assignment]').forEach(b=>b.onclick=()=>openStudentAssignment(...b.dataset.studentAssignment.split(':')));
    }else if(tab==='progress'){
      content.innerHTML=`<div class="mr-mobile-progress-wrap">${studentProgressHtml(d)}</div>`;
    }else if(tab==='lessons'){
      content.innerHTML=studentMobileLessonsHtml(d);
    }else{
      content.innerHTML=studentMobileMoreHtml();
    }
    app.querySelectorAll('[data-mobile-tab]').forEach(b=>b.onclick=()=>{S.studentTab=b.dataset.mobileTab;renderStudent()});
    const progressBack=app.querySelector('#mrProgressBackToMore');
    if(progressBack)progressBack.onclick=()=>{S.studentTab='more';renderStudent()};
    app.querySelectorAll('[data-lesson-board-version]').forEach(b=>b.onclick=()=>openStudentLessonBoardArchive((d.versions||[]).find(v=>v.id===b.dataset.lessonBoardVersion)));
    app.querySelectorAll('[data-lesson-recording]').forEach(b=>b.onclick=()=>{const url=b.dataset.lessonRecording;if(/^https?:\/\//i.test(url||''))window.open(url,'_blank','noopener')});
    return;
  }

  if(active&&live&&!compactActiveLessonUI){
    S.studentTab='lessons';
    const taskLeft=taskTimerRemaining(live);
    app.innerHTML=`<div class="student-home student-lesson-mode student-desktop-lesson-mode mr-student-teacher-design mr-desktop-lesson-unified mr-lesson-role-student ${live.focus_enabled?'student-focus-enabled':''}">
      <div id="mrStudentLessonAddon" class="mr-lesson-addon mr-lesson-video-top mr-desktop-video-shell"><div id="mrStudentVideoMount"></div></div>
      <div class="mr-student-desktop-lesson-meta mr-desktop-lesson-meta topbar"><div><span class="mr-mobile-kicker">Урок идёт</span><h1>${esc(active.topics?.title||'Урок')}</h1></div><div class="mr-student-desktop-live-dot"><span></span>Онлайн</div></div>
      <div class="mr-student-desktop-workspace mr-teacher-workspace mr-desktop-workspace-unified">
        <aside class="mr-student-desktop-lesson-rail mr-teacher-rail">
          <section id="studentLessonTaskMount" class="mr-student-rail-section">${studentLessonTaskCard(live)}</section>
          <section class="mr-student-desktop-timer-card mr-student-rail-section"><div class="mr-desk-section-head"><div><span class="mr-mobile-kicker">Таймер</span><h2>Время урока</h2></div></div><div class="mr-student-desktop-timers"><div><span>Урок</span><b id="studentTimer">${fmtTime(elapsedSeconds(live))}</b></div><div id="studentTaskTimerWrap" class="${live.task_timer_running?'active':''}"><span>На задачу</span><b id="studentTaskTimer">${live.task_timer_running?fmtTime(taskLeft):'—'}</b></div></div></section>
        </aside>
        <div class="mr-student-desktop-board mr-lesson-board-main"><div id="studentLessonBoard"></div></div>
      </div>
    </div>`;
    await mountBoard(document.getElementById('studentLessonBoard'),S.student.id,false,{lessonId:active.id,studentName:S.student.name,followTeacher:true,teacherReplica:true,teacherId:active.teacher_id||live.teacher_id||''});
    subscribeStudentLive(active.id);
    return;
  }

  // Original desktop focus mode and cabinet remain unchanged.
  if(active&&live?.focus_enabled){
    app.innerHTML=`<div class="student-home student-focus">${studentLiveCard(active,live)}<div id="focusBoard"></div></div>`;
    await mountBoard(document.getElementById('focusBoard'),S.student.id,false,{lessonId:active.id,studentName:S.student.name,followTeacher:true,teacherId:active.teacher_id||live.teacher_id||''});
    subscribeStudentLive(active.id);
    return;
  }

  if(!['today','tasks','lessons','progress','more'].includes(S.studentTab))S.studentTab='today';
  const desktopTab=S.studentTab;
  const pageTitle={today:'Главная',tasks:'Задания',lessons:'Уроки',progress:'Прогресс',more:'Ещё'}[desktopTab]||'Главная';
  app.innerHTML=`<div class="student-home mr-student-desktop-shell tab-${desktopTab}">
    ${studentDesktopSidebar(desktopTab,d)}
    <section class="mr-student-desktop-body">
      <header class="mr-student-desktop-topbar"><div class="mr-desk-topbar-title"><span class="mr-mobile-kicker">Mathroom · кабинет ученика</span><h1>${esc(pageTitle)}</h1></div><div class="mr-desk-topbar-actions"><span class="mr-desk-online-pill"><i></i>Всё сохранено</span><div class="mr-student-desktop-top-profile"><div class="mr-student-desktop-avatar small">${esc(String(S.student.name||'?').trim().charAt(0).toUpperCase())}</div><div><b>${esc(S.student.name)}</b><span>${esc(String(S.student.grade))} класс</span></div></div></div></header>
      <main id="studentContent" class="mr-student-desktop-content"></main>
    </section>
  </div>`;
  const cc=document.getElementById('studentContent');
  if(desktopTab==='today')cc.innerHTML=studentDesktopHomeHtml(d);
  else if(desktopTab==='tasks')cc.innerHTML=studentDesktopTasksHtml(d);
  else if(desktopTab==='lessons')cc.innerHTML=studentDesktopLessonsHtml(d);
  else if(desktopTab==='progress')cc.innerHTML=`<div class="mr-desk-page-head"><div><span class="mr-mobile-kicker">Результаты</span><h1>Прогресс</h1><p>Динамика, сильные стороны и темы для повторения.</p></div></div><div class="mr-student-desktop-progress">${studentProgressHtml(d)}</div>`;
  else cc.innerHTML=studentDesktopMoreHtml();

  app.querySelectorAll('[data-desktop-tab]').forEach(b=>b.onclick=()=>{S.studentTab=b.dataset.desktopTab;renderStudent()});
  app.querySelectorAll('[data-student-assignment]').forEach(b=>b.onclick=()=>openStudentAssignment(...b.dataset.studentAssignment.split(':')));
  app.querySelectorAll('[data-lesson-board-version]').forEach(b=>b.onclick=()=>openStudentLessonBoardArchive((d.versions||[]).find(v=>v.id===b.dataset.lessonBoardVersion)));
  app.querySelectorAll('[data-lesson-recording]').forEach(b=>b.onclick=()=>{const url=b.dataset.lessonRecording;if(/^https?:\/\//i.test(url||''))window.open(url,'_blank','noopener')});
  const prep=app.querySelector('#mrDeskPrepareLesson');if(prep)prep.onclick=()=>{toast('Перед уроком проверь камеру и микрофон. Когда преподаватель начнёт занятие, откроется рабочая комната.')};
}
window.renderStudent=renderStudent;
function subscribeStudentLive(lessonId){
  cleanupLive();
  const patchLiveUi=live=>{
    const el=document.getElementById('studentTimer');if(el)el.textContent=fmtTime(elapsedSeconds(live));
    const tt=document.getElementById('studentTaskTimer');if(tt)tt.textContent=live?.task_timer_running?fmtTime(taskTimerRemaining(live)):'—';
    const tw=document.getElementById('studentTaskTimerWrap');if(tw)tw.classList.toggle('active',!!live?.task_timer_running);
  };
  let timerInt=setInterval(()=>patchLiveUi(S.studentLive),1000);
  const ch=sb.channel(`student-live:${lessonId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'lesson_live_state',filter:`lesson_id=eq.${lessonId}`},payload=>{
    const prev=S.studentLive||{},next=payload.new||{};
    S.studentLive=next;

    /* 46.3 audit: changing the current task used to rerender the entire student
       lesson, destroying/recreating the board and rebinding the video. That is
       unnecessary and can interrupt a stroke on phones. Patch the task card in
       place; only Focus mode changes the page geometry. */
    const focusChanged=prev.focus_enabled!==next.focus_enabled;
    if(focusChanged){
      renderStudent();
      return;
    }

    const taskChanged=
      prev.current_queue_item_id!==next.current_queue_item_id||
      prev.current_title!==next.current_title||
      prev.current_prompt!==next.current_prompt;
    if(taskChanged){
      const mount=document.getElementById('studentLessonTaskMount');
      if(mount)mount.innerHTML=studentLessonTaskCard(next);
    }
    patchLiveUi(next);
  }).subscribe();
  S.liveCleanup=()=>{clearInterval(timerInt);sb.removeChannel(ch)};
}
async function openStudentAssignment(kind,id){
  const rpc=kind==='homework'?'get_student_homework':'get_student_test',arg=kind==='homework'?{p_homework_id:id}:{p_test_id:id};const {data,error}=await sb.rpc(rpc,arg);if(error)return fail(error);const assigned=data.status==='assigned',revision=kind==='homework'&&assigned&&data.revision_requested_at;
  const revisionNotice=revision?`<div class="notice warn"><b>Работа возвращена на доработку</b><br>${nl(data.revision_message||'Исправь отмеченные задания и отправь работу ещё раз.')}</div>`:'';
  const meta=kind==='homework'?`<div class="actions assignment-student-meta">${data.due_at?`<span class="pill">срок ${new Date(data.due_at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})}</span>`:''}${data.attempt_count?`<span class="pill">попытка ${data.attempt_count+(assigned?1:0)}</span>`:''}${data.reviewed_at?'<span class="pill good">проверено преподавателем</span>':''}</div>`:'';
  const m=modal(`<h2>${esc(data.title)}</h2>${meta}${revisionNotice}${data.score!=null?`<div class="score">${data.score}%</div>`:''}<form id="studentAnswerForm" class="answers">${(data.items||[]).map((x,i)=>`<div class="answer-item ${x.is_correct===true?'correct':x.is_correct===false?'wrong':''}"><b>${i+1}. ${esc(x.prompt)}</b><div class="field"><label>Ответ</label><input name="ans_${x.id}" value="${esc(x.student_answer||'')}" ${assigned?'':'disabled'}></div>${x.is_correct!==null&&x.is_correct!==undefined?`<div class="small">${x.is_correct?'✓ Верно':'✕ Нужно исправить'}</div>`:''}${x.teacher_feedback?`<div class="notice"><b>Комментарий к задаче</b><br>${nl(x.teacher_feedback)}</div>`:''}</div>`).join('')}${assigned?`<button class="btn primary">${revision?'Отправить исправления':'Отправить'}</button>`:''}</form>${data.comment?`<div class="notice"><b>Комментарий преподавателя</b><br>${nl(data.comment)}</div>`:''}`,'wide-modal');if(assigned)m.querySelector('#studentAnswerForm').onsubmit=async e=>{e.preventDefault();const answers={};for(const x of data.items||[])answers[x.id]=m.querySelector(`[name="ans_${x.id}"]`).value;const submitRpc=kind==='homework'?'submit_homework':'submit_test',args=kind==='homework'?{p_homework_id:id,p_answers:answers}:{p_test_id:id,p_answers:answers};const {data:res,error:er}=await sb.rpc(submitRpc,args);if(er)return fail(er);toast(kind==='homework'?`Работа отправлена · ${res.score}%`:`Результат: ${res.score}%`);m.remove();renderStudent()};
}

window.addEventListener('mathroom:lesson-ended',async()=>{
  if(!S.access||!S.student)return;
  S.studentLive=null;
  S.studentTab='today';
  try{await renderStudent()}catch(err){console.warn('[Mathroom lesson end render]',err)}
});
window.addEventListener('mathroom:refresh-lesson',()=>{if(S.view==='lesson'&&S.activeLesson)renderLesson()});

boot().catch(e=>{console.error(e);app.innerHTML=`<div class="center-page"><div class="auth-card"><h1>Ошибка запуска</h1><p>${esc(e.message)}</p></div></div>`});
})();
