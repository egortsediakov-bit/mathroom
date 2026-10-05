/* Mathroom v29.16.1 — source/page badges + canonical School 57 task pipeline. */
(() => {
  'use strict';
  const MR=()=>window.MR||{}, S=()=>MR().S||{};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  function metaOf(ex){try{const m=JSON.parse(ex?.generator_spec||'{}');return m?.type==='pdf_import'?m:null}catch{return null}}
  async function openSource(meta){const book=(S().textbooks||[]).find(x=>String(x.id)===String(meta.textbook_id));const sb=MR().sb;if(!book||!sb)return MR().toast?.('Источник PDF не найден');try{const{data,error}=await sb.storage.from('textbooks').createSignedUrl(book.file_path,3600);if(error)throw error;window.open(data.signedUrl+`#page=${Number(meta.page_no)||1}`,'_blank','noopener,noreferrer')}catch(e){MR().toast?.('Не удалось открыть PDF: '+String(e.message||e))}}
  function decorate(){const bank=document.getElementById('bankList');if(!bank)return;for(const row of bank.querySelectorAll('.row')){if(row.dataset.pdfDecorated==='1')continue;const answer=row.querySelector('[data-answer]');if(!answer)continue;const ex=(S().exercises||[]).find(x=>String(x.id)===String(answer.dataset.answer));const m=metaOf(ex);if(!m)continue;row.dataset.pdfDecorated='1';const left=row.firstElementChild;if(left&&!left.querySelector('[data-pdf-source-meta]')){const p=document.createElement('p');p.dataset.pdfSourceMeta='1';p.className='muted';p.innerHTML=`Источник: <b>${esc(m.source_title||'PDF')}</b> · PDF стр. <b>${Number(m.page_no)||'—'}</b>${m.task_no?` · № <b>${esc(m.task_no)}</b>`:''}`;left.appendChild(p)}const actions=answer.parentElement;if(actions&&!actions.querySelector('[data-pdf-open-source]')){const b=document.createElement('button');b.className='btn sm';b.dataset.pdfOpenSource='1';b.textContent='Источник';b.onclick=()=>openSource(m);actions.insertBefore(b,answer)}}}
  function loadScript(src,id){if(document.getElementById(id))return Promise.resolve();return new Promise((resolve,reject)=>{const s=document.createElement('script');s.id=id;s.src=src;s.onload=resolve;s.onerror=reject;document.body.appendChild(s)})}
  async function loadExtras(){try{
      await loadScript('./js/bank-core-retire-v2915.js?v=29.16.1','mathroomCoreBankRetire2915');
      await loadScript('./js/library-task-source-policy-v2913.js?v=29.16.1','mathroomTaskSourcePolicy2913');
      await loadScript('./js/library-taskbook-repair-v2914.js?v=29.16.1','mathroomTaskbookRepair2914');
      try{await window.MathroomTaskbookRepair2914?.repair?.()}catch(e){console.warn('[Mathroom 29.16.1 taskbook repair]',e)}
      await loadScript('./js/library-taskbook-canonical-v29151.js?v=29.16.1','mathroomTaskbookCanonical29151');
      try{await window.MathroomTaskbookCanonical29151?.run?.()}catch(e){console.warn('[Mathroom 29.16.1 taskbook canonical]',e)}
      await loadScript('./js/library-school57-import-v2916.js?v=29.16.1','mathroomSchool57Import2916');
      await loadScript('./js/library-full-index-v2910.js?v=29.16.1','mathroomFullIndex2910');
      await loadScript('./js/library-full-index-ui-v2910.js?v=29.16.1','mathroomFullIndexUI2910');
      await loadScript('./js/library-pdf-tasks-browser-v2911.js?v=29.16.1','mathroomPdfTasksBrowser2911');
      await loadScript('./js/library-task-strict-gate-v29111.js?v=29.16.1','mathroomTaskStrictGate29111');
      await loadScript('./js/library-index-finalizer-v2916.js?v=29.16.1','mathroomIndexFinalizer2916');
      await loadScript('./js/library-pdf-reset-v2912.js?v=29.16.1','mathroomPdfReset2912');
      setTimeout(()=>window.MathroomTaskImportV298?.scanAndImport?.({force:true,onProgress:m=>MR().toast?.(m)}).catch(e=>console.warn('[Mathroom 29.16.1 initial scan]',e)),2200);
    }catch(e){console.warn('[Mathroom 29.16.1 extras loader]',e)}}
  new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});setTimeout(decorate,700);setTimeout(loadExtras,900);window.MathroomPdfTaskSourceUI={version:'29.16.1',decorate,openSource,loadExtras};
})();
