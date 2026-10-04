/* Mathroom v29.11.0 — source/page badges + full-library index + PDF-task browser loader. */
(() => {
  'use strict';
  const MR=()=>window.MR||{}, S=()=>MR().S||{};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  function metaOf(ex){try{const m=JSON.parse(ex?.generator_spec||'{}');return m?.type==='pdf_import'?m:null;}catch{return null}}
  async function openSource(meta){
    const book=(S().textbooks||[]).find(x=>String(x.id)===String(meta.textbook_id));const sb=MR().sb;if(!book||!sb)return MR().toast?.('Источник PDF не найден');
    try{const {data,error}=await sb.storage.from('textbooks').createSignedUrl(book.file_path,3600);if(error)throw error;window.open(data.signedUrl+`#page=${Number(meta.page_no)||1}`,'_blank','noopener,noreferrer');}catch(e){MR().toast?.('Не удалось открыть PDF: '+String(e.message||e));}
  }
  function decorate(){
    const bank=document.getElementById('bankList');if(!bank)return;
    for(const row of bank.querySelectorAll('.row')){
      if(row.dataset.pdfDecorated==='1')continue;
      const answer=row.querySelector('[data-answer]');if(!answer)continue;
      const ex=(S().exercises||[]).find(x=>String(x.id)===String(answer.dataset.answer));const m=metaOf(ex);if(!m)continue;
      row.dataset.pdfDecorated='1';
      const left=row.firstElementChild;if(left&&!left.querySelector('[data-pdf-source-meta]')){const p=document.createElement('p');p.dataset.pdfSourceMeta='1';p.className='muted';p.innerHTML=`Источник: <b>${esc(m.source_title||'PDF')}</b> · PDF стр. <b>${Number(m.page_no)||'—'}</b>${m.task_no?` · № <b>${esc(m.task_no)}</b>`:''}${m.confidence?` · уверенность ${Math.round(Number(m.confidence)*100)}%`:''}`;left.appendChild(p);}
      const actions=answer.parentElement;if(actions&&!actions.querySelector('[data-pdf-open-source]')){const b=document.createElement('button');b.className='btn sm';b.dataset.pdfOpenSource='1';b.textContent='Источник';b.onclick=()=>openSource(m);actions.insertBefore(b,answer);}
    }
  }

  function loadScript(src,id){
    if(document.getElementById(id))return Promise.resolve();
    return new Promise((resolve,reject)=>{const s=document.createElement('script');s.id=id;s.src=src;s.onload=resolve;s.onerror=reject;document.body.appendChild(s);});
  }
  async function loadExtras(){
    try{
      await loadScript('./js/library-full-index-v2910.js?v=29.10.1','mathroomFullIndex2910');
      await loadScript('./js/library-full-index-ui-v2910.js?v=29.10.1','mathroomFullIndexUI2910');
      await loadScript('./js/library-pdf-tasks-browser-v2911.js?v=29.11.0','mathroomPdfTasksBrowser2911');
    }catch(e){console.warn('[Mathroom 29.11 extras loader]',e);}
  }

  new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(decorate,700);
  setTimeout(loadExtras,900);
  window.MathroomPdfTaskSourceUI={version:'29.11.0',decorate,openSource,loadExtras};
})();
