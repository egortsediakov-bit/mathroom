(() => {
  const { sb, S, esc, uid, clamp, toast, fail } = window.MR;
  const SVG='http://www.w3.org/2000/svg';
  const clone = v => structuredClone(v);
  const svgEl=(tag,attrs={})=>{const n=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};

  function drawElements(svg,elements,camera,selected=null,grid=false){
    svg.innerHTML='';
    if(grid){
      const defs=svgEl('defs');
      const pat=svgEl('pattern',{id:'mrgrid',width:20,height:20,patternUnits:'userSpaceOnUse'});
      pat.appendChild(svgEl('circle',{cx:1,cy:1,r:1,fill:'#d7dbe0'})); defs.appendChild(pat); svg.appendChild(defs);
      const bg=svgEl('rect',{x:camera.x-2000,y:camera.y-2000,width:8000,height:8000,fill:'url(#mrgrid)'}); svg.appendChild(bg);
    }
    const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`}); svg.appendChild(g);
    for(const o of elements||[]){
      let n=null;
      if(o.type==='path') n=svgEl('polyline',{points:(o.points||[]).map(p=>p.join(',')).join(' '),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'});
      else if(o.type==='line') n=svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'});
      else if(o.type==='rect') n=svgEl('rect',{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),width:Math.abs(o.x2-o.x1),height:Math.abs(o.y2-o.y1),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='ellipse') n=svgEl('ellipse',{cx:(o.x1+o.x2)/2,cy:(o.y1+o.y2)/2,rx:Math.abs(o.x2-o.x1)/2,ry:Math.abs(o.y2-o.y1)/2,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='arrow'){
        n=svgEl('g'); const line=svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'});n.appendChild(line);
        const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=12+(o.width||3)*2;
        const p1=[o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6)],p2=[o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6)];
        n.appendChild(svgEl('polyline',{points:`${p1.join(',')} ${o.x2},${o.y2} ${p2.join(',')}`,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'}));
      } else if(o.type==='text'){
        n=svgEl('text',{x:o.x,y:o.y,fill:o.color||'#15171a','font-size':o.fontSize||28,'font-family':'Inter,Arial,sans-serif'});
        String(o.text||'').split('\n').forEach((line,i)=>{const t=svgEl('tspan',{x:o.x,dy:i?((o.fontSize||28)*1.25):0});t.textContent=line;n.appendChild(t)});
      }
      if(n){n.dataset.id=o.id;if(selected===o.id)n.setAttribute('opacity','.55');g.appendChild(n)}
    }
  }

  async function mountBoard(root,studentId,isTeacher=true,options={}){
    let {data:pages,error}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order'); if(error)throw error;
    if(!pages.length && isTeacher){ const {data:p,error:e}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title:'Лист 1',sort_order:0}).select().single(); if(e)throw e; pages=[p]; }
    if(!pages.length){root.innerHTML='<div class="empty">Доска пока не создана.</div>';return null;}

    let current=pages[0],elements=clone(current.elements||[]),tool='pen',color='#15171a',width=3,camera={x:0,y:0,zoom:1},drawing=null,selected=null,saveTimer=null,channel=null,pagesChannel=null,grid=true;
    let panStart=null,moveStart=null; const undoStack=[],redoStack=[]; let busyHistory=false;
    root.innerHTML=`<div class="board-card"><div class="board-page-tabs" id="pageTabs"></div><div class="board-toolbar"><div class="board-tools">
      <button class="btn sm active" data-tool="pen">✎ Перо</button><button class="btn sm" data-tool="select">↖ Выбор</button><button class="btn sm" data-tool="hand">✋ Рука</button>
      <button class="btn sm" data-tool="line">╱</button><button class="btn sm" data-tool="arrow">→</button><button class="btn sm" data-tool="rect">□</button><button class="btn sm" data-tool="ellipse">○</button><button class="btn sm" data-tool="text">T</button>
      <span class="board-sep"></span><button class="color-dot active" data-color="#15171a" style="background:#15171a" title="Чёрный"></button><button class="color-dot" data-color="#2563eb" style="background:#2563eb" title="Синий"></button><button class="color-dot" data-color="#dc2626" style="background:#dc2626" title="Красный"></button><button class="color-dot" data-color="#15803d" style="background:#15803d" title="Зелёный"></button>
      <select id="strokeWidth" class="board-select"><option value="2">Тонко</option><option value="3" selected>Обычно</option><option value="6">Толсто</option></select>
      <button class="btn sm" id="undo">↶ Назад</button><button class="btn sm" id="redo">↷ Вперёд</button><button class="btn sm" id="gridToggle">⌗ Сетка</button><button class="btn sm" id="fullscreen">⛶</button>
      ${isTeacher?'<button class="btn sm" id="renamePage">Переименовать</button><button class="btn sm" id="addPage">+ Лист</button><button class="btn sm danger" id="delPage">Удалить лист</button><button class="btn sm danger" id="clearBoard">Очистить</button>':''}
    </div><span class="board-status" id="boardStatus">Подключение…</span></div><div class="board-stage" id="stage"><svg id="boardSvg"></svg><div class="board-floating"><button class="btn sm" id="zoomOut">−</button><span class="btn sm" id="zoomLabel">100%</span><button class="btn sm" id="zoomIn">+</button><button class="btn sm" id="homeView">⌂</button></div></div></div>`;
    const svg=root.querySelector('#boardSvg'),stage=root.querySelector('#stage'),status=root.querySelector('#boardStatus'),pageTabs=root.querySelector('#pageTabs'),zoomLabel=root.querySelector('#zoomLabel');

    function render(){drawElements(svg,elements,camera,selected,grid);}
    function setTool(v){tool=v;root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===v));svg.style.cursor=v==='hand'?'grab':v==='select'?'default':'crosshair';}
    function screenToWorld(cx,cy){const r=svg.getBoundingClientRect();return[(cx-r.left)/camera.zoom+camera.x,(cy-r.top)/camera.zoom+camera.y]}
    function renderTabs(){pageTabs.innerHTML=pages.map(p=>`<button class="btn sm ${p.id===current.id?'primary':''}" data-page="${p.id}">${esc(p.title)}</button>`).join('');pageTabs.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));}
    async function save(){clearTimeout(saveTimer);if(!current)return;status.textContent='Сохраняем…';const {error}=await sb.from('board_pages').update({elements,updated_at:new Date().toISOString()}).eq('id',current.id);status.textContent=error?'Ошибка сохранения':'Сохранено';if(error)console.error(error);const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);}
    function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,350)}
    function broadcast(){channel?.send({type:'broadcast',event:'state',payload:{pageId:current.id,elements}}).catch(()=>{})}
    function changed(){render();broadcast();scheduleSave()}
    function pushElementsHistory(){if(busyHistory)return;undoStack.push({type:'elements',pageId:current.id,elements:clone(elements)});if(undoStack.length>120)undoStack.shift();redoStack.length=0;}
    async function switchPage(id,{skipSave=false}={}){if(current?.id===id)return;if(!skipSave)await save();const p=pages.find(x=>x.id===id);if(!p)return;current=p;elements=clone(p.elements||[]);selected=null;camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';renderTabs();render();joinChannel();}
    function hit(x,y){for(let i=elements.length-1;i>=0;i--){const o=elements[i];if(o.type==='text'&&Math.abs(x-o.x)<280&&Math.abs(y-o.y)<85)return o;if(['rect','ellipse','line','arrow'].includes(o.type)){const minx=Math.min(o.x1,o.x2)-18,maxx=Math.max(o.x1,o.x2)+18,miny=Math.min(o.y1,o.y2)-18,maxy=Math.max(o.y1,o.y2)+18;if(x>=minx&&x<=maxx&&y>=miny&&y<=maxy)return o}if(o.type==='path'&&(o.points||[]).some(p=>Math.hypot(p[0]-x,p[1]-y)<20))return o}return null}
    async function restorePage(p){const row={id:p.id,teacher_id:p.teacher_id,student_id:p.student_id,title:p.title,sort_order:p.sort_order,elements:p.elements||[],created_at:p.created_at,updated_at:new Date().toISOString()};const {data,error}=await sb.from('board_pages').insert(row).select().single();if(error)throw error;pages.push(data);pages.sort((a,b)=>a.sort_order-b.sort_order);await switchPage(data.id,{skipSave:true});pagesChannel?.send({type:'broadcast',event:'pages',payload:{}});}
    async function undo(){const action=undoStack.pop();if(!action)return;busyHistory=true;try{
      if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);redoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed();}
      else if(action.type==='deletePage'){redoStack.push({type:'deletePage',page:clone(action.page)});await restorePage(action.page);}
      else if(action.type==='createPage'){const p=pages.find(x=>x.id===action.page.id);if(p){redoStack.push({type:'createPage',page:clone(p)});await sb.from('board_pages').delete().eq('id',p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}}
    }catch(e){fail(e)}finally{busyHistory=false}}
    async function redo(){const action=redoStack.pop();if(!action)return;busyHistory=true;try{
      if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);undoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed();}
      else if(action.type==='deletePage'){const p=pages.find(x=>x.id===action.page.id);if(p){undoStack.push({type:'deletePage',page:clone(p)});await sb.from('board_pages').delete().eq('id',p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}}
      else if(action.type==='createPage'){undoStack.push({type:'createPage',page:clone(action.page)});await restorePage(action.page);}
    }catch(e){fail(e)}finally{busyHistory=false}}

    svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);const[x,y]=screenToWorld(e.clientX,e.clientY);if(tool==='hand'){panStart={cx:e.clientX,cy:e.clientY,x:camera.x,y:camera.y};return}if(tool==='text'){const text=prompt('Текст:');if(text){pushElementsHistory();elements.push({id:uid(),type:'text',x,y,text,color,fontSize:28});changed()}return}if(tool==='select'){const o=hit(x,y);selected=o?.id||null;if(o){pushElementsHistory();moveStart={x,y,orig:clone(o)}}render();return}pushElementsHistory();drawing={id:uid(),type:tool,color,width};if(tool==='pen'){drawing.type='path';drawing.points=[[x,y]]}else Object.assign(drawing,{x1:x,y1:y,x2:x,y2:y});elements.push(drawing);render()};
    svg.onpointermove=e=>{const[x,y]=screenToWorld(e.clientX,e.clientY);if(panStart){camera.x=panStart.x-(e.clientX-panStart.cx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.cy)/camera.zoom;render();return}if(moveStart&&selected){const o=elements.find(z=>z.id===selected);if(!o)return;const dx=x-moveStart.x,dy=y-moveStart.y,b=moveStart.orig;if(o.type==='text'){o.x=b.x+dx;o.y=b.y+dy}else if(o.type==='path'){o.points=b.points.map(p=>[p[0]+dx,p[1]+dy])}else{for(const k of['x1','x2'])o[k]=b[k]+dx;for(const k of['y1','y2'])o[k]=b[k]+dy}render();broadcast();return}if(!drawing)return;if(drawing.type==='path')drawing.points.push([x,y]);else{drawing.x2=x;drawing.y2=y}render();broadcast()};
    svg.onpointerup=()=>{if(drawing||moveStart){drawing=null;moveStart=null;changed()}panStart=null};
    svg.onwheel=e=>{e.preventDefault();const[wx,wy]=screenToWorld(e.clientX,e.clientY),nz=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3),r=svg.getBoundingClientRect();camera.x=wx-(e.clientX-r.left)/nz;camera.y=wy-(e.clientY-r.top)/nz;camera.zoom=nz;zoomLabel.textContent=Math.round(nz*100)+'%';render()};

    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
    root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b))});
    root.querySelector('#strokeWidth').onchange=e=>width=Number(e.target.value);
    root.querySelector('#undo').onclick=()=>undo();root.querySelector('#redo').onclick=()=>redo();
    root.querySelector('#gridToggle').onclick=()=>{grid=!grid;root.querySelector('#gridToggle').classList.toggle('active',grid);render()};root.querySelector('#gridToggle').classList.add('active');
    root.querySelector('#zoomIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};
    root.querySelector('#zoomOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};
    root.querySelector('#homeView').onclick=()=>{camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';render()};
    root.querySelector('#fullscreen').onclick=()=>{if(!document.fullscreenElement)root.querySelector('.board-card').requestFullscreen?.();else document.exitFullscreen?.()};

    if(isTeacher){
      root.querySelector('#addPage').onclick=async()=>{const title=prompt('Название листа:',`Лист ${pages.length+1}`);if(!title)return;const {data,error}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title,sort_order:pages.length,elements:[]}).select().single();if(error)return fail(error);undoStack.push({type:'createPage',page:clone(data)});redoStack.length=0;pages.push(data);renderTabs();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}});await switchPage(data.id)};
      root.querySelector('#renamePage').onclick=async()=>{const title=prompt('Название листа:',current.title);if(!title||title===current.title)return;const {error}=await sb.from('board_pages').update({title}).eq('id',current.id);if(error)return fail(error);current.title=title;renderTabs();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})};
      root.querySelector('#delPage').onclick=async()=>{if(pages.length<=1)return toast('Нельзя удалить единственный лист');if(!confirm('Удалить этот лист? Ctrl+Z сможет вернуть его.'))return;await save();const deleted=clone(current);undoStack.push({type:'deletePage',page:deleted});redoStack.length=0;const {error}=await sb.from('board_pages').delete().eq('id',current.id);if(error)return fail(error);pages=pages.filter(p=>p.id!==deleted.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})};
      root.querySelector('#clearBoard').onclick=()=>{if(!elements.length||!confirm('Очистить текущий лист?'))return;pushElementsHistory();elements=[];selected=null;changed()};
    }

    async function refreshPages(){const {data}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(!data)return;const old=current?.id;pages=data;const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();joinChannel()}
    function joinChannel(){if(channel)sb.removeChannel(channel);if(!current)return;channel=sb.channel(`board:${current.id}`,{config:{private:true}}).on('broadcast',{event:'state'},({payload})=>{if(payload.pageId!==current.id)return;elements=clone(payload.elements||[]);const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);render();status.textContent='Онлайн'}).subscribe(s=>{status.textContent=s==='SUBSCRIBED'?'Онлайн':'Подключение…'})}
    function addText(text,opts={}){pushElementsHistory();elements.push({id:uid(),type:'text',x:camera.x+70/camera.zoom,y:camera.y+90/camera.zoom,text,color:opts.color||'#15171a',fontSize:opts.fontSize||28});changed()}
    const key=e=>{const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();pushElementsHistory();elements=elements.filter(x=>x.id!==selected);selected=null;changed()}else if(e.code==='Space'&&!e.repeat){e.preventDefault();svg.dataset.prevTool=tool;setTool('hand')}};
    const keyup=e=>{if(e.code==='Space'&&svg.dataset.prevTool){setTool(svg.dataset.prevTool);delete svg.dataset.prevTool}};
    window.addEventListener('keydown',key);window.addEventListener('keyup',keyup);
    pagesChannel=sb.channel(`student:${studentId}:pages`,{config:{private:true}}).on('broadcast',{event:'pages'},()=>refreshPages()).subscribe();
    renderTabs();render();joinChannel();
    const cleanup=()=>{clearTimeout(saveTimer);window.removeEventListener('keydown',key);window.removeEventListener('keyup',keyup);if(channel)sb.removeChannel(channel);if(pagesChannel)sb.removeChannel(pagesChannel)};
    S.boardCleanup=cleanup;
    return {addText,undo,redo,save,getPages:()=>pages.map(p=>({...p,elements:p.id===current.id?clone(elements):clone(p.elements||[])}))};
  }

  function mountSnapshot(root,pages){
    if(!pages?.length){root.innerHTML='<div class="empty">В этой версии нет листов.</div>';return;}
    let current=pages[0],camera={x:0,y:0,zoom:1},pan=null;
    root.innerHTML=`<div class="board-card readonly"><div class="board-page-tabs" id="snapTabs"></div><div class="board-toolbar"><span class="pill">Только просмотр</span><span class="board-status">Сохранённая версия</span></div><div class="board-stage"><svg id="snapSvg"></svg><div class="board-floating"><button class="btn sm" id="snapOut">−</button><span class="btn sm" id="snapZoom">100%</span><button class="btn sm" id="snapIn">+</button><button class="btn sm" id="snapHome">⌂</button></div></div></div>`;
    const svg=root.querySelector('#snapSvg'),tabs=root.querySelector('#snapTabs'),zl=root.querySelector('#snapZoom');
    const render=()=>drawElements(svg,current.elements||[],camera,null,true);
    const renderTabs=()=>{tabs.innerHTML=pages.map(p=>`<button class="btn sm ${p===current?'primary':''}" data-id="${esc(p.id||p.title)}">${esc(p.title||'Лист')}</button>`).join('');[...tabs.children].forEach((b,i)=>b.onclick=()=>{current=pages[i];camera={x:0,y:0,zoom:1};zl.textContent='100%';renderTabs();render()})};
    svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);pan={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y}};svg.onpointermove=e=>{if(!pan)return;camera.x=pan.cx-(e.clientX-pan.x)/camera.zoom;camera.y=pan.cy-(e.clientY-pan.y)/camera.zoom;render()};svg.onpointerup=()=>pan=null;
    svg.onwheel=e=>{e.preventDefault();camera.zoom=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};
    root.querySelector('#snapIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapHome').onclick=()=>{camera={x:0,y:0,zoom:1};zl.textContent='100%';render()};
    renderTabs();render();
  }

  window.MathroomBoard={mountBoard,mountSnapshot};
})();
