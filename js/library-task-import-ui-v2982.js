/* Mathroom v29.8.2 — keep the PDF task-import card live after auth/view rendering. */
(() => {
  'use strict';
  const state={busy:false,lastAt:0};
  const MR=()=>window.MR||{};
  const api=()=>window.MathroomTaskImportV298||null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=async text=>{try{await MR().copyText?.(text);MR().toast?.('SQL скопирован')}catch{}}

  async function copySql(){
    try{const r=await fetch('./supabase/upgrade-v29.8-task-import.sql',{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);await copy(await r.text());}
    catch(e){MR().toast?.('Не удалось скопировать SQL: '+String(e?.message||e));}
  }
  async function render(){
    const host=document.getElementById('pdfTaskImportCard'),mod=api(),user=MR().S?.user;
    if(!host||!mod)return;if(state.busy)return;
    if(!user?.id){host.innerHTML='<div><b>Задачи из PDF</b><div class="small muted">Подключаем кабинет преподавателя…</div></div><div class="actions"><span class="pill">v29.8.2</span></div>';return;}
    state.busy=true;
    try{
      const st=await mod.stats?.();state.lastAt=Date.now();
      if(!st?.ready){
        const reason=st?.reason||'Модуль ещё не готов';
        const needSql=/upgrade-v29\.8-task-import\.sql|нужно выполнить/i.test(reason);
        host.innerHTML=`<div><b>Задачи из PDF</b><div class="small muted">${esc(reason)}</div>${needSql?'<div class="small muted" style="margin-top:4px">Один раз выполни SQL в Supabase → SQL Editor. После этого обновлять сайт не потребуется.</div>':''}</div><div class="actions"><span class="pill">v29.8.2</span>${needSql?'<button class="btn sm" id="pdfTaskCopySql">Скопировать SQL</button>':''}<button class="btn sm" id="pdfTaskRetry">Проверить</button></div>`;
        document.getElementById('pdfTaskCopySql')?.addEventListener('click',copySql);
        document.getElementById('pdfTaskRetry')?.addEventListener('click',render);
        return;
      }
      host.innerHTML=`<div><b>Задачи из PDF</b><div class="small muted">Высокая уверенность → сразу в банк; сомнительные → на проверку.</div></div><div class="actions"><span class="pill">Импортировано ${st.imported||0}</span><span class="pill">На проверку ${st.pending||0}</span><button class="btn sm" id="pdfTaskScan">Сканировать библиотеку</button><button class="btn sm" id="pdfTaskReview" ${st.pending?'':'disabled'}>Проверить</button></div>`;
      document.getElementById('pdfTaskScan')?.addEventListener('click',async()=>{const b=document.getElementById('pdfTaskScan');if(b)b.disabled=true;try{await mod.scanAndImport?.({force:true,onProgress:m=>MR().toast?.(m)});await window.MathroomBankAllExercisesV2982?.hydrate?.({rerender:true});}finally{if(b)b.disabled=false;setTimeout(render,250);}});
      document.getElementById('pdfTaskReview')?.addEventListener('click',()=>mod.reviewModal?.());
    }catch(e){host.innerHTML=`<div><b>Задачи из PDF</b><div class="small muted">${esc(e?.message||e)}</div></div><div class="actions"><button class="btn sm" id="pdfTaskRetry">Повторить</button></div>`;document.getElementById('pdfTaskRetry')?.addEventListener('click',render);}
    finally{state.busy=false;}
  }
  let t=null;function schedule(){clearTimeout(t);t=setTimeout(()=>{if(document.getElementById('pdfTaskImportCard'))render();},240);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('focus',schedule);setInterval(()=>{if(document.getElementById('pdfTaskImportCard')&&Date.now()-state.lastAt>5000)render();},5000);
  setTimeout(schedule,900);
  window.MathroomTaskImportUIV2982={version:'29.8.2',render,state};
})();