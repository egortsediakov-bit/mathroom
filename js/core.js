const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const CFG = window.MATHROOM_CONFIG || {};
const configured = /^https:\/\/.+\.supabase\.co$/.test(CFG.SUPABASE_URL || '') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR_');
const sb = configured ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const S = {
  user: null, teacher: null,
  students: [], topics: [], exercises: [], lessons: [], homeworks: [], tests: [], versions: [],
  view: 'dashboard', selectedStudent: '', topic: null, activeLesson: null,
  boardCleanup: null, boardController: null, liveCleanup: null,
  access: new URLSearchParams(location.search).get('access') || '',
  student: null, studentTab: 'today', studentLive: null
};

const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const nl = (v='') => esc(v).replace(/\n/g, '<br>');

// UUID compatibility layer.
// crypto.randomUUID() is a Secure Context API and may be missing on HTTP/custom-domain
// deployments even when crypto.getRandomValues() is available. The whiteboard relies on
// IDs during initial page normalization, so calling randomUUID() directly could prevent the
// entire board from mounting. Keep RFC 4122 v4 semantics without requiring randomUUID().
function secureRandomBytes(length){
  const bytes=new Uint8Array(length);
  const c=globalThis.crypto;
  if(c&&typeof c.getRandomValues==='function'){
    try{return c.getRandomValues(bytes)}catch(e){console.warn('[Mathroom] getRandomValues fallback',e)}
  }
  for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  return bytes;
}
const uid = () => {
  const c=globalThis.crypto;
  if(c&&typeof c.randomUUID==='function'){
    try{return c.randomUUID()}catch(e){console.warn('[Mathroom] randomUUID fallback',e)}
  }
  const b=secureRandomBytes(16);
  b[6]=(b[6]&0x0f)|0x40;
  b[8]=(b[8]&0x3f)|0x80;
  const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const token = () => Array.from(secureRandomBytes(24)).map(x => x.toString(16).padStart(2,'0')).join('');
const dateLong = v => v ? new Date(v).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const dateShort = v => v ? new Date(v).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
const diffLabel = v => ({basic:'Базовая',medium:'Средняя',advanced:'Сложная'})[v] || v || '—';
const statusLabel = v => ({assigned:'Назначено',submitted:'Выполнено',reviewed:'Проверено',in_progress:'Идёт урок',completed:'Завершён',cancelled:'Отменён'})[v] || v || '—';
const statusClass = v => ({completed:'ok',reviewed:'ok',submitted:'warn',in_progress:'warn',cancelled:'bad'})[v] || '';
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

function toast(msg){ toastEl.textContent = msg; toastEl.classList.add('show'); setTimeout(()=>toastEl.classList.remove('show'),2400); }
function fail(error){ console.error(error); toast(error?.message || String(error || 'Ошибка')); }
function copyText(text){
  if(navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const t=document.createElement('textarea'); t.value=text; t.style.position='fixed'; t.style.opacity='0'; document.body.appendChild(t); t.select();
  try{ document.execCommand('copy'); } finally{ t.remove(); }
  return Promise.resolve();
}
function modal(html, cls=''){
  const key=(cls+'|'+String(html||'').replace(/\s+/g,' ').trim().slice(0,180));
  const existing=document.querySelector('.modal-backdrop');
  if(existing){
    if(existing.dataset.modalKey===key){existing.querySelector('.modal')?.focus?.({preventScroll:true});return existing}
    existing.remove();
  }
  const el=document.createElement('div');el.className='modal-backdrop';el.dataset.modalKey=key;
  el.innerHTML=`<div class="modal ${cls}" tabindex="-1">${html}<div class="actions modal-default-close" style="margin-top:16px"><button class="btn" data-close>Закрыть</button></div></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>el.querySelector('.modal')?.focus?.({preventScroll:true}));
  el.onclick=e=>{if(e.target===el||e.target.closest('[data-close]'))el.remove()};
  return el;
}
function cleanupBoard(){ if(S.boardCleanup){ S.boardCleanup(); S.boardCleanup=null; S.boardController=null; } }
function cleanupLive(){ if(S.liveCleanup){ S.liveCleanup(); S.liveCleanup=null; } }
function cleanupAll(){ cleanupBoard(); cleanupLive(); }
function studentLink(st){ return `${location.origin}${location.pathname}?access=${encodeURIComponent(st.access_token)}`; }
function configScreen(){
  app.innerHTML=`<div class="center-page"><div class="auth-card config-card"><div class="brand">Mathroom Web v3.4</div><h1>Подключи Supabase</h1><p>В репозитории должен остаться твой существующий <b>config.js</b> с Project URL и Publishable key.</p><div class="config-code">window.MATHROOM_CONFIG = {\n  SUPABASE_URL: 'https://PROJECT.supabase.co',\n  SUPABASE_ANON_KEY: 'sb_publishable_...',\n  APP_NAME: 'Mathroom'\n};</div></div></div>`;
}
function avg(nums){ const a=nums.filter(x=>Number.isFinite(Number(x))).map(Number); return a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null; }
function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

window.MR = { app, toastEl, CFG, configured, sb, S, esc, nl, uid, token, dateLong, dateShort, diffLabel, statusLabel, statusClass, clamp, toast, fail, copyText, modal, cleanupBoard, cleanupLive, cleanupAll, studentLink, configScreen, avg, shuffle };
