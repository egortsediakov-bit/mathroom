(() => {
  const { sb, S, esc, uid, clamp, toast, fail } = window.MR;
  const SVG='http://www.w3.org/2000/svg';
  const ASSET_BUCKET='board-assets';
  const clone = v => structuredClone(v);
  const svgEl=(tag,attrs={})=>{const n=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};
  const assetCache=new Map(), assetPending=new Map();

  if(window.pdfjsLib){
    try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; }catch{}
  }

  function prettyFormula(v=''){
    return String(v)
      .replace(/sqrt\(([^()]*)\)/g,'√($1)')
      .replace(/\bpi\b/gi,'π').replace(/<=/g,'≤').replace(/>=/g,'≥').replace(/!=/g,'≠')
      .replace(/->/g,'→').replace(/\*/g,'·')
      .replace(/\^2\b/g,'²').replace(/\^3\b/g,'³');
  }

  async function ensureAsset(path){
    if(!path) return null;
    if(assetCache.has(path)) return assetCache.get(path);
    if(assetPending.has(path)) return assetPending.get(path);
    const p=(async()=>{
      const {data,error}=await sb.storage.from(ASSET_BUCKET).download(path);
      if(error) throw error;
      const url=URL.createObjectURL(data); assetCache.set(path,url); return url;
    })().catch(e=>{console.error('asset',path,e);return null}).finally(()=>assetPending.delete(path));
    assetPending.set(path,p); return p;
  }

  function bounds(o){
    if(!o)return{x:0,y:0,w:0,h:0};
    if(['text','formula'].includes(o.type))return{x:o.x,y:o.y-(o.fontSize||28),w:Math.max(100,String(o.text||'').length*(o.fontSize||28)*.55),h:(o.fontSize||28)*1.5};
    if(['image','coordinate','graph'].includes(o.type))return{x:o.x,y:o.y,w:o.w||600,h:o.h||420};
    if(o.type==='polygon'){
      const xs=(o.points||[]).map(p=>p[0]),ys=(o.points||[]).map(p=>p[1]);return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    }
    if(o.type==='path'){
      const xs=(o.points||[]).map(p=>p[0]),ys=(o.points||[]).map(p=>p[1]);if(!xs.length)return{x:0,y:0,w:0,h:0};return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    }
    if(['rect','ellipse','line','arrow'].includes(o.type))return{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),w:Math.abs(o.x2-o.x1),h:Math.abs(o.y2-o.y1)};
    return{x:0,y:0,w:0,h:0};
  }

  function drawCoordinate(g,o,withGraph=false){
    const x=o.x,y=o.y,w=o.w||640,h=o.h||440,rx=o.rangeX||10,ry=o.rangeY||7;
    g.appendChild(svgEl('rect',{x,y,width:w,height:h,fill:'#fff',stroke:'#c7ccd3','stroke-width':1}));
    const mx=v=>x+w/2+(v/rx)*(w/2), my=v=>y+h/2-(v/ry)*(h/2);
    for(let i=-rx;i<=rx;i++)g.appendChild(svgEl('line',{x1:mx(i),y1:y,x2:mx(i),y2:y+h,stroke:i===0?'#4b5563':'#e5e7eb','stroke-width':i===0?2:1}));
    for(let i=-ry;i<=ry;i++)g.appendChild(svgEl('line',{x1:x,y1:my(i),x2:x+w,y2:my(i),stroke:i===0?'#4b5563':'#e5e7eb','stroke-width':i===0?2:1}));
    for(let i=-rx;i<=rx;i+=2){if(!i)continue;const t=svgEl('text',{x:mx(i)+3,y:my(0)-5,fill:'#6b7280','font-size':12});t.textContent=i;g.appendChild(t)}
    for(let i=-ry;i<=ry;i+=2){if(!i)continue;const t=svgEl('text',{x:mx(0)+5,y:my(i)-3,fill:'#6b7280','font-size':12});t.textContent=i;g.appendChild(t)}
    if(withGraph){
      for(const seg of o.segments||[]){
        const points=seg.map(([vx,vy])=>`${mx(vx)},${my(vy)}`).join(' ');
        if(points)g.appendChild(svgEl('polyline',{points,fill:'none',stroke:o.color||'#2563eb','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'}));
      }
      const tt=svgEl('text',{x:x+12,y:y+24,fill:o.color||'#2563eb','font-size':16,'font-family':'Cambria Math,serif'});tt.textContent=`y = ${o.expression||''}`;g.appendChild(tt);
    }
  }

  function drawElements(svg,elements,camera,selected=null,grid=false,onAssetNeeded=null){
    svg.innerHTML='';
    if(grid){
      const defs=svgEl('defs'); const pat=svgEl('pattern',{id:'mrgrid320',width:20,height:20,patternUnits:'userSpaceOnUse'});
      pat.appendChild(svgEl('circle',{cx:1,cy:1,r:1,fill:'#d7dbe0'}));defs.appendChild(pat);svg.appendChild(defs);
      svg.appendChild(svgEl('rect',{x:camera.x-3000,y:camera.y-3000,width:12000,height:12000,fill:'url(#mrgrid320)'}));
    }
    const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);
    for(const o of elements||[]){
      let n=null;
      if(o.type==='path') n=svgEl('polyline',{points:(o.points||[]).map(p=>p.join(',')).join(' '),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'});
      else if(o.type==='line') n=svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'});
      else if(o.type==='rect') n=svgEl('rect',{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),width:Math.abs(o.x2-o.x1),height:Math.abs(o.y2-o.y1),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='ellipse') n=svgEl('ellipse',{cx:(o.x1+o.x2)/2,cy:(o.y1+o.y2)/2,rx:Math.abs(o.x2-o.x1)/2,ry:Math.abs(o.y2-o.y1)/2,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='arrow'){
        n=svgEl('g');n.appendChild(svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'}));
        const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=12+(o.width||3)*2,p1=[o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6)],p2=[o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6)];
        n.appendChild(svgEl('polyline',{points:`${p1.join(',')} ${o.x2},${o.y2} ${p2.join(',')}`,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'}));
      } else if(o.type==='text'||o.type==='formula'){
        n=svgEl('text',{x:o.x,y:o.y,fill:o.color||'#15171a','font-size':o.fontSize||28,'font-family':o.type==='formula'?'Cambria Math,Times New Roman,serif':'Inter,Arial,sans-serif'});
        String(o.text||'').split('\n').forEach((line,i)=>{const t=svgEl('tspan',{x:o.x,dy:i?((o.fontSize||28)*1.25):0});t.textContent=line;n.appendChild(t)});
      } else if(o.type==='polygon') n=svgEl('polygon',{points:(o.points||[]).map(p=>p.join(',')).join(' '),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linejoin':'round'});
      else if(o.type==='coordinate'||o.type==='graph'){n=svgEl('g');drawCoordinate(n,o,o.type==='graph');}
      else if(o.type==='image'){
        const url=assetCache.get(o.assetPath);
        if(url)n=svgEl('image',{x:o.x,y:o.y,width:o.w||700,height:o.h||500,href:url,preserveAspectRatio:'xMidYMid meet'});
        else{n=svgEl('g');n.appendChild(svgEl('rect',{x:o.x,y:o.y,width:o.w||700,height:o.h||500,fill:'#f3f4f6',stroke:'#cbd0d8','stroke-width':1}));const t=svgEl('text',{x:o.x+16,y:o.y+30,fill:'#6b7280','font-size':15});t.textContent='Загрузка материала…';n.appendChild(t);onAssetNeeded?.(o.assetPath)}
      }
      if(n){n.dataset.id=o.id;if(selected===o.id)n.setAttribute('opacity','.58');g.appendChild(n)}
    }
  }

  function translated(orig,dx,dy){
    const o=clone(orig);
    if(['text','formula','image','coordinate','graph'].includes(o.type)){o.x+=dx;o.y+=dy}
    else if(o.type==='path'||o.type==='polygon')o.points=(o.points||[]).map(p=>[p[0]+dx,p[1]+dy]);
    else if(['rect','ellipse','line','arrow'].includes(o.type)){o.x1+=dx;o.x2+=dx;o.y1+=dy;o.y2+=dy}
    return o;
  }

  function graphSegments(expr){
    if(!window.math)throw new Error('Математический движок не загрузился');
    if(!expr||expr.length>120)throw new Error('Слишком длинная функция');
    const code=window.math.compile(expr);
    const segs=[];let seg=[],prev=null;
    for(let i=0;i<=300;i++){
      const x=-10+i*(20/300);let y;
      try{y=Number(code.evaluate({x}))}catch{y=NaN}
      const ok=Number.isFinite(y)&&Math.abs(y)<=80;
      if(!ok){if(seg.length>1)segs.push(seg);seg=[];prev=null;continue}
      if(prev&&Math.abs(y-prev[1])>12){if(seg.length>1)segs.push(seg);seg=[]}
      seg.push([x,y]);prev=[x,y];
    }
    if(seg.length>1)segs.push(seg);if(!segs.length)throw new Error('Не удалось построить график на x ∈ [-10; 10]');return segs;
  }

  async function mountBoard(root,studentId,isTeacher=true,options={}){
    let {data:pages,error}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(error)throw error;
    if(!pages.length&&isTeacher){const {data:p,error:e}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title:'Лист 1',sort_order:0}).select().single();if(e)throw e;pages=[p]}
    if(!pages.length){root.innerHTML='<div class="empty">Доска пока не создана.</div>';return null}

    let current=pages[0],elements=clone(current.elements||[]),tool='pen',color='#15171a',width=3,camera={x:0,y:0,zoom:1},drawing=null,selected=null,saveTimer=null,channel=null,pagesChannel=null,grid=true;
    let panStart=null,moveStart=null;const undoStack=[],redoStack=[];let busyHistory=false,importBusy=false;
    root.innerHTML=`<div class="board-card"><div class="board-page-tabs" id="pageTabs"></div><div class="board-toolbar"><div class="board-tools">
      <button class="btn sm active" data-tool="pen">✎ Перо</button><button class="btn sm" data-tool="select">↖ Выбор</button><button class="btn sm" data-tool="hand">✋ Рука</button>
      <button class="btn sm" data-tool="line">╱</button><button class="btn sm" data-tool="arrow">→</button><button class="btn sm" data-tool="rect">□</button><button class="btn sm" data-tool="ellipse">○</button><button class="btn sm" data-tool="text">T</button>${isTeacher?'<button class="btn sm" id="formulaTool">∑ Формула</button>':''}
      <span class="board-sep"></span><button class="color-dot active" data-color="#15171a" style="background:#15171a"></button><button class="color-dot" data-color="#2563eb" style="background:#2563eb"></button><button class="color-dot" data-color="#dc2626" style="background:#dc2626"></button><button class="color-dot" data-color="#15803d" style="background:#15803d"></button>
      <select id="strokeWidth" class="board-select"><option value="2">Тонко</option><option value="3" selected>Обычно</option><option value="6">Толсто</option></select>
      <button class="btn sm" id="undo">↶ Назад</button><button class="btn sm" id="redo">↷ Вперёд</button><button class="btn sm" id="gridToggle">⌗ Сетка</button><button class="btn sm" id="fullscreen">⛶</button>
      ${isTeacher?'<span class="board-sep"></span><button class="btn sm" id="coordinatePlane">⌗ Координаты</button><button class="btn sm" id="functionGraph">ƒ(x)</button><select class="board-select" id="shapeTemplate"><option value="">＋ Фигура…</option><option value="triangle">Треугольник</option><option value="right">Прямоугольный △</option><option value="square">Квадрат</option><option value="rhombus">Ромб</option><option value="parallelogram">Параллелограмм</option><option value="trapezoid">Трапеция</option></select><button class="btn sm" id="importBoard">⇧ Импорт</button><input id="boardFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf" hidden><button class="btn sm" id="renamePage">Переименовать</button><button class="btn sm" id="addPage">+ Лист</button><button class="btn sm danger" id="delPage">Удалить лист</button><button class="btn sm danger" id="clearBoard">Очистить</button>':''}
    </div><span class="board-status" id="boardStatus">Подключение…</span></div><div class="board-hint">Space + drag — перемещение · колесо — масштаб · Ctrl+Z / Ctrl+Y — назад/вперёд${isTeacher?' · PDF создаёт отдельный лист для каждой страницы':''}</div><div class="board-stage" id="stage"><svg id="boardSvg"></svg><div class="board-floating"><button class="btn sm" id="zoomOut">−</button><span class="btn sm" id="zoomLabel">100%</span><button class="btn sm" id="zoomIn">+</button><button class="btn sm" id="homeView">⌂</button></div></div></div>`;
    const svg=root.querySelector('#boardSvg'),status=root.querySelector('#boardStatus'),pageTabs=root.querySelector('#pageTabs'),zoomLabel=root.querySelector('#zoomLabel');

    const needAsset=path=>{if(!path||assetCache.has(path)||assetPending.has(path))return;ensureAsset(path).then(()=>render())};
    function render(){drawElements(svg,elements,camera,selected,grid,needAsset)}
    function setTool(v){tool=v;root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===v));svg.style.cursor=v==='hand'?'grab':v==='select'?'default':'crosshair'}
    function screenToWorld(cx,cy){const r=svg.getBoundingClientRect();return[(cx-r.left)/camera.zoom+camera.x,(cy-r.top)/camera.zoom+camera.y]}
    function renderTabs(){pageTabs.innerHTML=pages.map(p=>`<button class="btn sm ${p.id===current.id?'primary':''}" data-page="${p.id}">${esc(p.title)}</button>`).join('');pageTabs.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page))}
    async function save(){clearTimeout(saveTimer);if(!current)return;status.textContent='Сохраняем…';const {error}=await sb.from('board_pages').update({elements,updated_at:new Date().toISOString()}).eq('id',current.id);status.textContent=error?'Ошибка сохранения':'Сохранено';if(error)console.error(error);const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements)}
    function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,350)}
    function broadcast(){channel?.send({type:'broadcast',event:'state',payload:{pageId:current.id,elements}}).catch(()=>{})}
    function changed(){render();broadcast();scheduleSave()}
    function pushElementsHistory(){if(busyHistory)return;undoStack.push({type:'elements',pageId:current.id,elements:clone(elements)});if(undoStack.length>140)undoStack.shift();redoStack.length=0}
    async function switchPage(id,{skipSave=false}={}){if(current?.id===id)return;if(!skipSave)await save();const p=pages.find(x=>x.id===id);if(!p)return;current=p;elements=clone(p.elements||[]);selected=null;camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';renderTabs();render();joinChannel()}
    function hit(x,y){for(let i=elements.length-1;i>=0;i--){const o=elements[i],b=bounds(o);if(x>=b.x-20&&x<=b.x+b.w+20&&y>=b.y-20&&y<=b.y+b.h+20)return o}return null}
    async function restorePage(p){const row={id:p.id,teacher_id:p.teacher_id,student_id:p.student_id,title:p.title,sort_order:p.sort_order,elements:p.elements||[],created_at:p.created_at,updated_at:new Date().toISOString()};const {data,error}=await sb.from('board_pages').insert(row).select().single();if(error)throw error;pages.push(data);pages.sort((a,b)=>a.sort_order-b.sort_order);await switchPage(data.id,{skipSave:true});pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}
    async function createPage(title,initialElements=[]){const {data,error}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title,sort_order:pages.length,elements:initialElements}).select().single();if(error)throw error;undoStack.push({type:'createPage',page:clone(data)});redoStack.length=0;pages.push(data);renderTabs();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}});return data}
    async function undo(){const action=undoStack.pop();if(!action)return;busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);redoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed()}else if(action.type==='deletePage'){redoStack.push({type:'deletePage',page:clone(action.page)});await restorePage(action.page)}else if(action.type==='createPage'){const p=pages.find(x=>x.id===action.page.id);if(p){redoStack.push({type:'createPage',page:clone(p)});await sb.from('board_pages').delete().eq('id',p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}}}catch(e){fail(e)}finally{busyHistory=false}}
    async function redo(){const action=redoStack.pop();if(!action)return;busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);undoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed()}else if(action.type==='deletePage'){const p=pages.find(x=>x.id===action.page.id);if(p){undoStack.push({type:'deletePage',page:clone(p)});await sb.from('board_pages').delete().eq('id',p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}}else if(action.type==='createPage'){undoStack.push({type:'createPage',page:clone(action.page)});await restorePage(action.page)}}catch(e){fail(e)}finally{busyHistory=false}}

    async function uploadBlob(blob,mime='image/png',ext='png'){
      const path=`${studentId}/${uid()}.${ext}`;const {error}=await sb.storage.from(ASSET_BUCKET).upload(path,blob,{contentType:mime,upsert:false,cacheControl:'3600'});if(error)throw error;return path;
    }
    async function importImage(file){
      if(file.size>15*1024*1024)throw new Error('Изображение больше 15 МБ');
      const bitmap=await createImageBitmap(file),scale=Math.min(1,900/bitmap.width),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');
      const path=await uploadBlob(file,file.type||'image/png',ext);pushElementsHistory();elements.push({id:uid(),type:'image',assetPath:path,x:camera.x+60/camera.zoom,y:camera.y+70/camera.zoom,w,h,name:file.name});changed();ensureAsset(path).then(()=>render());
    }
    async function importPdf(file){
      if(!window.pdfjsLib)throw new Error('PDF.js не загрузился');if(file.size>25*1024*1024)throw new Error('PDF больше 25 МБ');
      status.textContent='Читаем PDF…';const doc=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise,limit=Math.min(doc.numPages,25);if(doc.numPages>25)toast('Импортированы первые 25 страниц');let first=null;
      for(let i=1;i<=limit;i++){
        status.textContent=`PDF: страница ${i}/${limit}`;const page=await doc.getPage(i),vp=page.getViewport({scale:1.45}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await page.render({canvasContext:ctx,viewport:vp}).promise;
        const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Не удалось создать изображение')),'image/png',.92));const path=await uploadBlob(blob,'image/png','png');const maxW=960,scale=Math.min(1,maxW/canvas.width),w=Math.round(canvas.width*scale),h=Math.round(canvas.height*scale);
        const p=await createPage(`${file.name.replace(/\.pdf$/i,'')} · ${i}`,[{id:uid(),type:'image',assetPath:path,x:45,y:45,w,h,name:`${file.name} · ${i}`}]);if(!first)first=p;ensureAsset(path);
      }
      if(first)await switchPage(first.id);status.textContent='PDF импортирован';
    }
    async function handleImport(file){if(importBusy||!file)return;importBusy=true;try{if(file.type==='application/pdf'||/\.pdf$/i.test(file.name))await importPdf(file);else if(file.type.startsWith('image/'))await importImage(file);else throw new Error('Поддерживаются изображения и PDF')}catch(e){fail(e)}finally{importBusy=false;const input=root.querySelector('#boardFile');if(input)input.value=''}}

    svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);const[x,y]=screenToWorld(e.clientX,e.clientY);if(tool==='hand'){panStart={cx:e.clientX,cy:e.clientY,x:camera.x,y:camera.y};return}if(tool==='text'){const text=prompt('Текст:');if(text){pushElementsHistory();elements.push({id:uid(),type:'text',x,y,text,color,fontSize:28});changed()}return}if(tool==='select'){const o=hit(x,y);selected=o?.id||null;if(o){pushElementsHistory();moveStart={x,y,orig:clone(o)}}render();return}pushElementsHistory();drawing={id:uid(),type:tool,color,width};if(tool==='pen'){drawing.type='path';drawing.points=[[x,y]]}else Object.assign(drawing,{x1:x,y1:y,x2:x,y2:y});elements.push(drawing);render()};
    svg.onpointermove=e=>{const[x,y]=screenToWorld(e.clientX,e.clientY);if(panStart){camera.x=panStart.x-(e.clientX-panStart.cx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.cy)/camera.zoom;render();return}if(moveStart&&selected){const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;elements[idx]=translated(moveStart.orig,x-moveStart.x,y-moveStart.y);render();broadcast();return}if(!drawing)return;if(drawing.type==='path')drawing.points.push([x,y]);else{drawing.x2=x;drawing.y2=y}render();broadcast()};
    svg.onpointerup=()=>{if(drawing||moveStart){drawing=null;moveStart=null;changed()}panStart=null};
    svg.onwheel=e=>{e.preventDefault();const[wx,wy]=screenToWorld(e.clientX,e.clientY),nz=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3),r=svg.getBoundingClientRect();camera.x=wx-(e.clientX-r.left)/nz;camera.y=wy-(e.clientY-r.top)/nz;camera.zoom=nz;zoomLabel.textContent=Math.round(nz*100)+'%';render()};

    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b))});root.querySelector('#strokeWidth').onchange=e=>width=Number(e.target.value);
    root.querySelector('#undo').onclick=()=>undo();root.querySelector('#redo').onclick=()=>redo();root.querySelector('#gridToggle').onclick=()=>{grid=!grid;root.querySelector('#gridToggle').classList.toggle('active',grid);render()};root.querySelector('#gridToggle').classList.add('active');
    root.querySelector('#zoomIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#zoomOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#homeView').onclick=()=>{camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';render()};root.querySelector('#fullscreen').onclick=()=>{if(!document.fullscreenElement)root.querySelector('.board-card').requestFullscreen?.();else document.exitFullscreen?.()};

    if(isTeacher){
      root.querySelector('#formulaTool').onclick=()=>{const raw=prompt('Формула:','x^2 + y^2 = r^2');if(!raw)return;pushElementsHistory();elements.push({id:uid(),type:'formula',x:camera.x+80/camera.zoom,y:camera.y+110/camera.zoom,text:prettyFormula(raw),color,fontSize:32});changed()};
      root.querySelector('#coordinatePlane').onclick=()=>{pushElementsHistory();elements.push({id:uid(),type:'coordinate',x:camera.x+70/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,rangeX:10,rangeY:7});changed()};
      root.querySelector('#functionGraph').onclick=()=>{const expr=prompt('Функция y =','x^2 - 4');if(!expr)return;try{const segments=graphSegments(expr);pushElementsHistory();elements.push({id:uid(),type:'graph',x:camera.x+70/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,rangeX:10,rangeY:7,expression:expr,segments,color:'#2563eb'});changed()}catch(e){fail(e)}};
      root.querySelector('#shapeTemplate').onchange=e=>{const v=e.target.value;e.target.value='';if(!v)return;const x=camera.x+160/camera.zoom,y=camera.y+130/camera.zoom;let pts=null;if(v==='triangle')pts=[[x+160,y],[x,y+250],[x+320,y+250]];if(v==='right')pts=[[x,y],[x,y+250],[x+320,y+250]];if(v==='square')pts=[[x,y],[x+260,y],[x+260,y+260],[x,y+260]];if(v==='rhombus')pts=[[x+160,y],[x+320,y+150],[x+160,y+300],[x,y+150]];if(v==='parallelogram')pts=[[x+70,y],[x+330,y],[x+260,y+220],[x,y+220]];if(v==='trapezoid')pts=[[x+80,y],[x+260,y],[x+340,y+220],[x,y+220]];if(pts){pushElementsHistory();elements.push({id:uid(),type:'polygon',points:pts,color,width});changed()}};
      root.querySelector('#importBoard').onclick=()=>root.querySelector('#boardFile').click();root.querySelector('#boardFile').onchange=e=>handleImport(e.target.files?.[0]);
      root.querySelector('#addPage').onclick=async()=>{const title=prompt('Название листа:',`Лист ${pages.length+1}`);if(!title)return;try{const p=await createPage(title,[]);await switchPage(p.id)}catch(e){fail(e)}};
      root.querySelector('#renamePage').onclick=async()=>{const title=prompt('Название листа:',current.title);if(!title||title===current.title)return;const {error}=await sb.from('board_pages').update({title}).eq('id',current.id);if(error)return fail(error);current.title=title;renderTabs();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})};
      root.querySelector('#delPage').onclick=async()=>{if(pages.length<=1)return toast('Нельзя удалить единственный лист');if(!confirm('Удалить этот лист? Ctrl+Z сможет вернуть его.'))return;await save();const deleted=clone(current);undoStack.push({type:'deletePage',page:deleted});redoStack.length=0;const {error}=await sb.from('board_pages').delete().eq('id',current.id);if(error)return fail(error);pages=pages.filter(p=>p.id!==deleted.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})};
      root.querySelector('#clearBoard').onclick=()=>{if(!elements.length||!confirm('Очистить текущий лист?'))return;pushElementsHistory();elements=[];selected=null;changed()};
    }

    async function refreshPages(){const {data}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(!data)return;const old=current?.id;pages=data;const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();joinChannel()}
    function joinChannel(){if(channel)sb.removeChannel(channel);if(!current)return;channel=sb.channel(`board:${current.id}`,{config:{private:true}}).on('broadcast',{event:'state'},({payload})=>{if(payload.pageId!==current.id)return;elements=clone(payload.elements||[]);const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);render();status.textContent='Онлайн'}).subscribe(s=>{status.textContent=s==='SUBSCRIBED'?'Онлайн':'Подключение…'})}
    function addText(text,opts={}){pushElementsHistory();elements.push({id:uid(),type:'text',x:camera.x+70/camera.zoom,y:camera.y+90/camera.zoom,text,color:opts.color||'#15171a',fontSize:opts.fontSize||28});changed()}
    const key=e=>{const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();pushElementsHistory();elements=elements.filter(x=>x.id!==selected);selected=null;changed()}else if(e.code==='Space'&&!e.repeat){e.preventDefault();svg.dataset.prevTool=tool;setTool('hand')}};
    const keyup=e=>{if(e.code==='Space'&&svg.dataset.prevTool){setTool(svg.dataset.prevTool);delete svg.dataset.prevTool}};window.addEventListener('keydown',key);window.addEventListener('keyup',keyup);
    pagesChannel=sb.channel(`student:${studentId}:pages`,{config:{private:true}}).on('broadcast',{event:'pages'},()=>refreshPages()).subscribe();renderTabs();render();joinChannel();
    const cleanup=()=>{clearTimeout(saveTimer);window.removeEventListener('keydown',key);window.removeEventListener('keyup',keyup);if(channel)sb.removeChannel(channel);if(pagesChannel)sb.removeChannel(pagesChannel)};S.boardCleanup=cleanup;
    return {addText,undo,redo,save,getPages:()=>pages.map(p=>({...p,elements:p.id===current.id?clone(elements):clone(p.elements||[])}))};
  }

  function mountSnapshot(root,pages){
    if(!pages?.length){root.innerHTML='<div class="empty">В этой версии нет листов.</div>';return}
    let current=pages[0],camera={x:0,y:0,zoom:1},pan=null;
    root.innerHTML=`<div class="board-card readonly"><div class="board-page-tabs" id="snapTabs"></div><div class="board-toolbar"><span class="pill">Только просмотр</span><span class="board-status">Сохранённая версия</span></div><div class="board-stage"><svg id="snapSvg"></svg><div class="board-floating"><button class="btn sm" id="snapOut">−</button><span class="btn sm" id="snapZoom">100%</span><button class="btn sm" id="snapIn">+</button><button class="btn sm" id="snapHome">⌂</button></div></div></div>`;
    const svg=root.querySelector('#snapSvg'),tabs=root.querySelector('#snapTabs'),zl=root.querySelector('#snapZoom');
    const need=path=>{if(!path||assetCache.has(path)||assetPending.has(path))return;ensureAsset(path).then(()=>render())};const render=()=>drawElements(svg,current.elements||[],camera,null,true,need);
    const renderTabs=()=>{tabs.innerHTML=pages.map(p=>`<button class="btn sm ${p===current?'primary':''}">${esc(p.title||'Лист')}</button>`).join('');[...tabs.children].forEach((b,i)=>b.onclick=()=>{current=pages[i];camera={x:0,y:0,zoom:1};zl.textContent='100%';renderTabs();render()})};
    svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);pan={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y}};svg.onpointermove=e=>{if(!pan)return;camera.x=pan.cx-(e.clientX-pan.x)/camera.zoom;camera.y=pan.cy-(e.clientY-pan.y)/camera.zoom;render()};svg.onpointerup=()=>pan=null;svg.onwheel=e=>{e.preventDefault();camera.zoom=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};
    root.querySelector('#snapIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapHome').onclick=()=>{camera={x:0,y:0,zoom:1};zl.textContent='100%';render()};renderTabs();render();
  }

  window.MathroomBoard={mountBoard,mountSnapshot};
})();
