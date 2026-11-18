/* Mathroom v92: browser-only PDF canvas crop; no PDF uploaded. */
(()=>{
  'use strict';
  const API={};
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const CSS_TEXT=[
    '.mr-c92{position:fixed;inset:0;z-index:1000000;background:#111d;display:flex;align-items:center;justify-content:center;padding:12px}',
    '.mr-c92 *{box-sizing:border-box}',
    '.mr-c92-panel{background:white;color:#171717;border-radius:16px;display:flex;flex-direction:column;width:min(1100px,100%);max-height:96vh;overflow:hidden}',
    '.mr-c92-header,.mr-c92-footer{padding:14px 18px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center}',
    '.mr-c92-header{border-bottom:1px solid #ddd}.mr-c92-footer{border-top:1px solid #ddd}',
    '.mr-c92-header b{font-size:19px}.mr-c92 p{color:#555;margin:4px 0;font-size:13px}',
    '.mr-c92-scroll{overflow:auto;min-height:0;flex:1;padding:14px;background:#f3f3f3}',
    '.mr-c92-page{width:max-content;max-width:100%;position:relative;margin:0 auto;touch-action:none;cursor:crosshair;line-height:0}',
    '.mr-c92 canvas{max-width:100%;height:auto;display:block;background:white;box-shadow:0 2px 14px #0002}',
    '.mr-c92-selection{position:absolute;display:none;box-shadow:0 0 0 100vmax #0003;border:2px solid #ff7900;pointer-events:none}',
    '.mr-c92-buttons{display:flex;gap:8px}.mr-c92 button{cursor:pointer;border:1px solid #ddd;border-radius:9px;padding:9px 12px;background:white;color:#111}',
    '.mr-c92 button.primary{background:#ff7900;border-color:#ff7900;font-weight:700}',
    '.mr-c92 button:disabled{opacity:.4;cursor:default}'
  ].join('');
  const ensureStyle=()=>{
    if(document.getElementById('mrCrop92Style'))return;
    const style=document.createElement('style');style.id='mrCrop92Style';style.textContent=CSS_TEXT;document.head.appendChild(style);
  };
  API.capture=({file,pageNumber,suggestion})=>new Promise(async resolve=>{
    if(!file||!window.pdfjsLib)return resolve(null);
    ensureStyle();
    const overlay=document.createElement('div');overlay.className='mr-c92';
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
    overlay.innerHTML='<div class="mr-c92-panel"><div class="mr-c92-header"><div><b>Фрагмент из PDF — страница '+Number(pageNumber)+'</b><p>Выдели мышью или пальцем формулу, таблицу, чертёж либо всё условие.</p></div><div class="mr-c92-buttons"><button data-close>Закрыть</button></div></div>'+
      '<div class="mr-c92-scroll"><div class="mr-c92-page"><canvas></canvas><div class="mr-c92-selection"></div></div></div>'+
      '<div class="mr-c92-footer"><p data-status>Открываем страницу PDF…</p><div class="mr-c92-buttons"><button data-reset>Сбросить</button><button data-ok class="primary" disabled>Прикрепить фрагмент</button></div></div></div>';
    document.body.appendChild(overlay);
    const canvas=overlay.querySelector('canvas'),sel=overlay.querySelector('.mr-c92-selection'),
      status=overlay.querySelector('[data-status]'),ok=overlay.querySelector('[data-ok]');
    const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    let pdf=null,rect=null,pointer=null,done=false;
    const exit=value=>{
      if(done)return;done=true;
      try{pdf?.destroy()}catch{}
      overlay.remove();document.body.style.overflow=oldOverflow;
      document.removeEventListener('keydown',onKey,true);
      resolve(value||null);
    };
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();exit(null)}};
    document.addEventListener('keydown',onKey,true);
    overlay.querySelector('[data-close]').onclick=()=>exit(null);
    overlay.querySelector('[data-reset]').onclick=()=>{rect=null;sel.style.display='none';ok.disabled=true};
    const xy=e=>{
      const b=canvas.getBoundingClientRect();
      return [clamp((e.clientX-b.left)/b.width,0,1),clamp((e.clientY-b.top)/b.height,0,1)];
    };
    const refresh=()=>{
      if(!rect){sel.style.display='none';ok.disabled=true;return}
      const [a,b,c,d]=rect,w=Math.abs(c-a),h=Math.abs(d-b),box=canvas.getBoundingClientRect();
      sel.style.left=(Math.min(a,c)*100)+'%';sel.style.top=(Math.min(b,d)*100)+'%';
      sel.style.width=(w*100)+'%';sel.style.height=(h*100)+'%';sel.style.display='block';
      ok.disabled=!(box.width*w>=16&&box.height*h>=16&&canvas.width*w>=30&&canvas.height*h>=20);
    };
    canvas.onpointerdown=e=>{
      if(pointer!==null||!canvas.width)return;
      pointer=e.pointerId;canvas.setPointerCapture(pointer);
      const [x,y]=xy(e);rect=[x,y,x,y];refresh();e.preventDefault();
    };
    canvas.onpointermove=e=>{
      if(pointer!==e.pointerId||!rect)return;
      const [x,y]=xy(e);rect[2]=x;rect[3]=y;refresh();e.preventDefault();
    };
    const end=e=>{
      if(pointer!==e.pointerId)return;
      if(rect){const [x,y]=xy(e);rect[2]=x;rect[3]=y;refresh();}
      pointer=null;e.preventDefault();
    };
    canvas.onpointerup=end;canvas.onpointercancel=end;
    ok.onclick=async()=>{
      if(!rect||ok.disabled||done)return;
      ok.disabled=true;
      try{
        const [a,b,c,d]=rect;
        const sx=Math.floor(Math.min(a,c)*canvas.width),sy=Math.floor(Math.min(b,d)*canvas.height);
        const sw=Math.min(canvas.width-sx,Math.ceil(Math.abs(c-a)*canvas.width));
        const sh=Math.min(canvas.height-sy,Math.ceil(Math.abs(d-b)*canvas.height));
        if(sw<30||sh<20)throw new Error('Область слишком маленькая');
        const out=document.createElement('canvas');out.width=sw;out.height=sh;
        out.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
        const blob=await new Promise((yes,no)=>out.toBlob(b=>b?yes(b):no(new Error('Ошибка изображения')),'image/png'));
        if(blob.size>14*1024*1024)throw new Error('Фрагмент больше 14 МБ');
        exit({blob,width:sw,height:sh,rect:[sx,sy,sw,sh],page:Number(pageNumber)});
      }catch(e){status.textContent=String(e?.message||e);ok.disabled=false}
    };
    try{
      const data=new Uint8Array(await file.arrayBuffer());
      window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      pdf=await window.pdfjsLib.getDocument({data}).promise;
      const page=await pdf.getPage(Number(pageNumber)),natural=page.getViewport({scale:1});
      const scale=Math.min(2,1600/natural.width,2200/natural.height);
      const view=page.getViewport({scale});
      canvas.width=Math.round(view.width);canvas.height=Math.round(view.height);
      await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:view}).promise;
      page.cleanup();await pdf.destroy();pdf=null;
      if(Array.isArray(suggestion)&&suggestion.length===4&&suggestion.every(x=>Number.isFinite(x))){
        rect=suggestion.map(x=>clamp(x,0,1));refresh();
      }
      status.textContent='Изображение сохраняется в закрытом хранилище только вместе с черновиком.';
    }catch(e){status.textContent='Не удалось открыть страницу: '+String(e?.message||e);}
  });
  window.MathroomPdfCaptureV92=API;
})();
