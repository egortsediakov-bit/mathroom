/* Mathroom v29.8.3 — stable PDF task-import card; no mutation feedback loop. */
(() => {
  'use strict';
  const state={busy:false,lastAt:0,signature:''};
  const MR=()=>window.MR||{}, api=()=>window.MathroomTaskImportV298||null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const timeout=(p,ms=12000)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('Сервер отвечает слишком долго. Попробуй ещё раз.')),ms))]);

  function mount(){
    const list=document.getElementById('bankList');if(!list)return null;
    let host=document.getElementById('pdfTaskImportCard');if(host)return host;
    host=document.createElement('div');host.id='pdfTaskImportCard';host.className='notice';host.style.cssText='margin:0 0 12px;display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap';
    list.parentNode.insertBefore(host,list);state.signature='';return host;
  }
  function setHtml(host,html,signature){if(!host||state.signature===signature)return;state.signature=signature;host.innerHTML=html;bind(host);}
  async function copySql(){try{const r=await fetch('./supabase/upgrade-v29.8-task-import.sql',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);await MR().copyText?.(await r.text());MR().toast?.('SQL скопирован');}catch(e){MR().toast?.('Не удалось скопировать SQL: '+String(e?.message||e));}}
  function bind(host){
    host.querySelector('#pdfTaskCopySql')?.addEventListener('click',copySql);
    host.querySelector('#pdfTaskRetry')?.addEventListener('click',()=>render(true));
    host.querySelector('#pdfTaskScan')?.addEventListener('click',async e=>{const b=e.currentTarget;if(state.busy)return;state.busy=true;b.disabled=true;const old=b.textContent;b.textContent='Сканируем…';try{const mod=api();if(!mod)throw new Error('Модуль импорта не загружен');await mod.scanAndImport({force:true,onProgress:m=>MR().toast?.(m)});await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true});state.lastAt=0;await render(true);}catch(err){MR().toast?.(String(err?.message||err));}finally{state.busy=false;if(document.body.contains(b)){b.disabled=false;b.textContent=old;}}});
    host.querySelector('#pdfTaskReview')?.addEventListener('click',async e=>{const b=e.currentTarget;if(state.busy)return;state.busy=true;b.disabled=true;try{const mod=api();if(!mod)throw new Error('Модуль импорта не загружен');await mod.reviewModal();}catch(err){MR().toast?.(String(err?.message||err));}finally{state.busy=false;if(document.body.contains(b))b.disabled=false;}});
  }
  async function render(force=false){
    const host=mount();if(!host||state.busy)return;
    if(!force&&Date.now()-state.lastAt<10000)return;
    const mod=api();if(!mod){setHtml(host,'<div><b>Задачи из PDF</b><div class="small muted">Модуль импорта не загрузился</div></div><div class="actions"><span class="pill">v29.8.3</span></div>','no-module');return;}
    state.busy=true;
    try{
      if(force)setHtml(host,'<div><b>Задачи из PDF</b><div class="small muted">Проверяем подключение…</div></div><div class="actions"><span class="pill">v29.8.3</span></div>','checking');
      const st=await timeout(mod.stats(),12000);state.lastAt=Date.now();
      if(!st?.ready){const reason=st?.reason||'Кабинет ещё загружается';const needSql=/upgrade-v29\.8-task-import\.sql|нужно выполнить/i.test(reason);const sig=`notready:${reason}`;setHtml(host,`<div><b>Задачи из PDF</b><div class="small muted">${esc(reason)}</div>${needSql?'<div class="small muted" style="margin-top:4px">Один раз выполни SQL в Supabase → SQL Editor.</div>':''}</div><div class="actions"><span class="pill">v29.8.3</span>${needSql?'<button class="btn sm" id="pdfTaskCopySql">Скопировать SQL</button>':''}<button class="btn sm" id="pdfTaskRetry">Проверить</button></div>`,sig);return;}
      const sig=`ready:${st.imported||0}:${st.pending||0}:${st.ready||0}:${st.rejected||0}`;
      setHtml(host,`<div><b>Задачи из PDF</b><div class="small muted">Высокая уверенность → сразу в банк; сомнительные → на проверку.</div></div><div class="actions"><span class="pill">Импортировано ${st.imported||0}</span><span class="pill">На проверку ${st.pending||0}</span><button class="btn sm" id="pdfTaskScan">Сканировать библиотеку</button><button class="btn sm" id="pdfTaskReview" ${st.pending?'':'disabled'}>Проверить</button></div>`,sig);
    }catch(e){const msg=String(e?.message||e),sig=`err:${msg}`;setHtml(host,`<div><b>Задачи из PDF</b><div class="small muted">${esc(msg)}</div></div><div class="actions"><span class="pill">v29.8.3</span><button class="btn sm" id="pdfTaskRetry">Повторить</button></div>`,sig);}
    finally{state.busy=false;}
  }
  // Poll gently. No MutationObserver: the old implementation retriggered itself on every innerHTML update.
  setInterval(()=>{if(document.getElementById('bankList')){mount();render(false);}},3000);
  window.addEventListener('focus',()=>{if(document.getElementById('bankList'))render(true);});
  setTimeout(()=>render(true),1200);
  window.MathroomTaskImportUIV2983={version:'29.8.3',state,render,mount};
})();