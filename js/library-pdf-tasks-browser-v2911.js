/* Mathroom v29.11.0 — browse tasks imported from PDF separately from the bounded bank page. */
(() => {
  'use strict';
  const MR=()=>window.MR||{}, S=()=>MR().S||{}, sb=()=>MR().sb||null;
  const state={count:null,rows:[],loaded:false,busy:false};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parseMeta=x=>{try{return JSON.parse(x||'{}')}catch{return {}}};

  async function count(){
    const c=sb(),uid=S()?.user?.id;if(!c||!uid)return 0;
    const {count,error}=await c.from('exercises').select('*',{count:'exact',head:true})
      .eq('teacher_id',uid).eq('kind','task').contains('tags',['mathroom-core-bank-v29.8-pdf']);
    if(error)throw error;state.count=count||0;return state.count;
  }

  async function loadAll(){
    if(state.busy)return state.rows;
    state.busy=true;
    try{
      const c=sb(),uid=S()?.user?.id;if(!c||!uid)return [];
      const out=[];
      for(let from=0;from<30000;from+=500){
        const {data,error}=await c.from('exercises')
          .select('id,title,content,answer,difficulty,category,tags,generator_spec,topic_id,created_at')
          .eq('teacher_id',uid).eq('kind','task')
          .contains('tags',['mathroom-core-bank-v29.8-pdf'])
          .order('created_at',{ascending:false}).range(from,from+499);
        if(error)throw error;const rows=data||[];out.push(...rows);if(rows.length<500)break;
      }
      state.rows=out;state.loaded=true;state.count=out.length;return out;
    }finally{state.busy=false;}
  }

  function close(){document.getElementById('pdfTasksBrowserModal')?.remove();}
  function renderList(query=''){
    const body=document.getElementById('pdfTasksBrowserList');if(!body)return;
    const q=String(query||'').trim().toLowerCase();
    const rows=state.rows.filter(r=>!q||`${r.title||''} ${r.content||''} ${r.category||''}`.toLowerCase().includes(q));
    body.innerHTML=rows.length?rows.map(r=>{
      const m=parseMeta(r.generator_spec),src=m.source_title||'PDF',page=Number(m.page_no)||'—',no=m.task_no||'';
      return `<div style="border:1px solid var(--line,#ddd);border-radius:14px;padding:14px;margin:0 0 10px;background:#fff">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:7px"><span class="pill">${esc(r.category||'Без темы')}</span><span class="pill">PDF стр. ${esc(page)}</span>${no?`<span class="pill">№ ${esc(no)}</span>`:''}</div>
        <div style="font-weight:800;margin-bottom:6px">${esc(r.title||'Задача')}</div>
        <div style="white-space:pre-wrap;line-height:1.45">${esc(r.content||'')}</div>
        <div class="small muted" style="margin-top:8px">Источник: ${esc(src)}</div>
      </div>`;
    }).join(''):'<div class="muted">Ничего не найдено.</div>';
    const badge=document.getElementById('pdfTasksBrowserCount');if(badge)badge.textContent=`${rows.length} из ${state.rows.length}`;
  }

  async function open(){
    close();
    const wrap=document.createElement('div');wrap.id='pdfTasksBrowserModal';wrap.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px';
    wrap.innerHTML=`<div style="width:min(1100px,96vw);max-height:92vh;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 30px 90px #0003;display:flex;flex-direction:column">
      <div style="padding:20px 22px;border-bottom:1px solid var(--line,#ddd);display:flex;gap:12px;align-items:center;justify-content:space-between"><div><h2 style="margin:0">Задачи из PDF</h2><div class="small muted">Все импортированные задачи, независимо от лимита 1000 в основном банке.</div></div><button class="btn" id="pdfTasksBrowserClose">Закрыть</button></div>
      <div style="padding:14px 22px;border-bottom:1px solid var(--line,#ddd);display:flex;gap:10px;align-items:center"><input id="pdfTasksBrowserSearch" placeholder="Поиск по задаче или теме" style="flex:1;min-width:0;padding:12px 14px;border:1px solid var(--line,#ddd);border-radius:12px;font:inherit"><span class="pill" id="pdfTasksBrowserCount">...</span></div>
      <div id="pdfTasksBrowserList" style="padding:16px 22px;overflow:auto"><div class="muted">Загружаем…</div></div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click',e=>{if(e.target===wrap)close()});
    wrap.querySelector('#pdfTasksBrowserClose').onclick=close;
    wrap.querySelector('#pdfTasksBrowserSearch').oninput=e=>renderList(e.target.value);
    try{await loadAll();renderList('');}catch(e){wrap.querySelector('#pdfTasksBrowserList').innerHTML=`<div class="muted">Ошибка загрузки: ${esc(e.message||e)}</div>`;}
  }

  function mountButton(){
    const host=document.getElementById('pdfTaskImportCard');if(!host)return;
    const actions=host.querySelector('.actions');if(!actions||actions.querySelector('#pdfTasksBrowse'))return;
    const b=document.createElement('button');b.className='btn sm';b.id='pdfTasksBrowse';b.textContent='Показать PDF-задачи';b.onclick=open;actions.prepend(b);
  }
  async function refreshCount(){try{await count();mountButton();}catch(e){console.warn('[Mathroom PDF tasks browser count]',e)}}
  setInterval(()=>{mountButton();if(document.getElementById('bankList'))refreshCount();},12000);
  new MutationObserver(mountButton).observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>{mountButton();refreshCount();},1800);
  window.MathroomPdfTasksBrowser2911={version:'29.11.0',state,open,loadAll,refreshCount};
})();
