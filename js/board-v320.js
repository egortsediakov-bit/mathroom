(() => {
  const { sb, S, esc, uid, clamp, toast, fail } = window.MR;
  const SVG='http://www.w3.org/2000/svg';
  const ASSET_BUCKET='board-assets';
  const clone = v => structuredClone(v);
  const svgEl=(tag,attrs={})=>{const n=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n};
  const smoothPathD=(points=[])=>{
    const pts=(points||[]).filter(p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(!pts.length)return'';
    if(pts.length===1){const[x,y]=pts[0];return`M ${x} ${y} L ${x+.01} ${y+.01}`}
    if(pts.length===2)return`M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]}`;
    let d=`M ${pts[0][0]} ${pts[0][1]}`;
    for(let i=1;i<pts.length-1;i++){
      const p=pts[i],n=pts[i+1],mx=(p[0]+n[0])/2,my=(p[1]+n[1])/2;
      d+=` Q ${p[0]} ${p[1]} ${mx} ${my}`;
    }
    const prev=pts[pts.length-2],last=pts[pts.length-1];
    return d+` Q ${prev[0]} ${prev[1]} ${last[0]} ${last[1]}`;
  };
  const assetCache=new Map(), assetPending=new Map();
  const LOCAL_ASSET_PREFIX='mr-local-asset:';
  let localAssetDbPromise=null;

  function openLocalAssetDb(){
    if(localAssetDbPromise)return localAssetDbPromise;
    localAssetDbPromise=new Promise((resolve,reject)=>{
      if(!window.indexedDB)return reject(new Error('Браузер не поддерживает локальное хранилище файлов'));
      const req=indexedDB.open('mathroom-board-assets',1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('assets'))db.createObjectStore('assets',{keyPath:'id'})};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Не удалось открыть локальное хранилище файлов'));
    });
    return localAssetDbPromise;
  }
  async function putLocalAsset(blob,mime='application/octet-stream',name=''){
    const db=await openLocalAssetDb(),id=uid();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('assets','readwrite');
      tx.objectStore('assets').put({id,blob,mime,name,createdAt:Date.now()});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить материал локально'));
      tx.onabort=()=>reject(tx.error||new Error('Локальное сохранение материала отменено'));
    });
    return LOCAL_ASSET_PREFIX+id;
  }
  async function getLocalAsset(path){
    if(!String(path||'').startsWith(LOCAL_ASSET_PREFIX))return null;
    const id=String(path).slice(LOCAL_ASSET_PREFIX.length),db=await openLocalAssetDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('assets','readonly'),req=tx.objectStore('assets').get(id);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||new Error('Не удалось прочитать локальный материал'));
    });
  }

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
      let blob=null;
      if(String(path).startsWith(LOCAL_ASSET_PREFIX)){
        const row=await getLocalAsset(path);
        blob=row?.blob||null;
        if(!blob)throw new Error('Локальный материал не найден');
      }else{
        const {data,error}=await sb.storage.from(ASSET_BUCKET).download(path);
        if(error) throw error;
        blob=data;
      }
      const url=URL.createObjectURL(blob); assetCache.set(path,url); return url;
    })().catch(e=>{console.error('asset',path,e);return null}).finally(()=>assetPending.delete(path));
    assetPending.set(path,p); return p;
  }

  function bounds(o){
    if(!o)return{x:0,y:0,w:0,h:0};
    if(['text','formula'].includes(o.type)){const lines=String(o.text||'').split('\n');const fs=o.fontSize||28;const maxLen=Math.max(1,...lines.map(line=>line.length));return{x:o.x,y:o.y-fs,w:Math.max(100,maxLen*fs*.55),h:Math.max(1,lines.length)*fs*(o.lineHeight||1.25)};}
    if(o.type==='note')return{x:o.x,y:o.y,w:o.w||260,h:o.h||160};
    if(['image','coordinate','graph'].includes(o.type))return{x:o.x,y:o.y,w:o.w||600,h:o.h||420};
    if(o.type==='attachment')return{x:o.x,y:o.y,w:o.w||360,h:o.h||96};
    if(o.type==='compass'||o.type==='arc')return{x:o.cx-o.r,y:o.cy-o.r,w:o.r*2,h:o.r*2};
    if(o.type==='solid3d')return{x:o.x,y:o.y,w:o.w||420,h:o.h||330};
    if(o.type==='protractor')return{x:o.x-o.r,y:o.y-o.r,w:o.r*2,h:o.r};
    if(o.type==='ruler')return{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2)-18,w:Math.max(1,Math.abs(o.x2-o.x1)),h:Math.max(36,Math.abs(o.y2-o.y1)+36)};
    if(o.type==='polygon'){
      const xs=(o.points||[]).map(p=>p[0]),ys=(o.points||[]).map(p=>p[1]);return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    }
    if(o.type==='path'){
      const xs=(o.points||[]).map(p=>p[0]),ys=(o.points||[]).map(p=>p[1]);if(!xs.length)return{x:0,y:0,w:0,h:0};return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    }
    if(['rect','ellipse','line','arrow'].includes(o.type))return{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),w:Math.abs(o.x2-o.x1),h:Math.abs(o.y2-o.y1)};
    return{x:0,y:0,w:0,h:0};
  }


  function marqueeRect(x0,y0,x1,y1){return{x0:Math.min(x0,x1),y0:Math.min(y0,y1),x1:Math.max(x0,x1),y1:Math.max(y0,y1)}}
  function pointInMarquee(x,y,r,pad=0){return x>=r.x0-pad&&x<=r.x1+pad&&y>=r.y0-pad&&y<=r.y1+pad}
  function marqueeContainsBounds(r,b,pad=0){return b.x>=r.x0-pad&&b.y>=r.y0-pad&&b.x+b.w<=r.x1+pad&&b.y+b.h<=r.y1+pad}
  function rectsOverlap(a,b){return a.x0<=b.x1&&a.x1>=b.x0&&a.y0<=b.y1&&a.y1>=b.y0}
  function orient(a,b,c){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
  function onSeg(a,b,p,eps=1e-7){return Math.abs(orient(a,b,p))<=eps&&p.x>=Math.min(a.x,b.x)-eps&&p.x<=Math.max(a.x,b.x)+eps&&p.y>=Math.min(a.y,b.y)-eps&&p.y<=Math.max(a.y,b.y)+eps}
  function segIntersects(a,b,c,d){
    const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b),eps=1e-7;
    if(((o1>eps&&o2<-eps)||(o1<-eps&&o2>eps))&&((o3>eps&&o4<-eps)||(o3<-eps&&o4>eps)))return true;
    return(Math.abs(o1)<=eps&&onSeg(a,b,c))||(Math.abs(o2)<=eps&&onSeg(a,b,d))||(Math.abs(o3)<=eps&&onSeg(c,d,a))||(Math.abs(o4)<=eps&&onSeg(c,d,b));
  }
  function segmentHitsMarquee(a,b,r,pad=0){
    const rr={x0:r.x0-pad,y0:r.y0-pad,x1:r.x1+pad,y1:r.y1+pad};
    if(pointInMarquee(a.x,a.y,rr)||pointInMarquee(b.x,b.y,rr))return true;
    const tl={x:rr.x0,y:rr.y0},tr={x:rr.x1,y:rr.y0},br={x:rr.x1,y:rr.y1},bl={x:rr.x0,y:rr.y1};
    return segIntersects(a,b,tl,tr)||segIntersects(a,b,tr,br)||segIntersects(a,b,br,bl)||segIntersects(a,b,bl,tl);
  }
  function pointInPoly(x,y,pts){
    let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;
      const hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);if(hit)inside=!inside;
    }return inside;
  }
  function polylineHitsMarquee(rawPts,r,{closed=false,filled=false,pad=0}={}){
    const pts=(rawPts||[]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{x:p.x,y:p.y}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(!pts.length)return false;
    if(pts.some(p=>pointInMarquee(p.x,p.y,r,pad)))return true;
    const n=closed?pts.length:pts.length-1;for(let i=0;i<n;i++){const a=pts[i],b=pts[(i+1)%pts.length];if(segmentHitsMarquee(a,b,r,pad))return true}
    if(filled&&pts.length>=3){const corners=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];if(corners.some(([x,y])=>pointInPoly(x,y,pts)))return true}
    return false;
  }
  function sampledEllipse(cx,cy,rx,ry,count=72){const pts=[];for(let i=0;i<count;i++){const a=i/count*Math.PI*2;pts.push({x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)})}return pts}
  function sampledArc(o,count=72){const a=arcPath(o),n=Math.max(8,Math.ceil(count*Math.min(1,a.length/(Math.PI*2))));const pts=[];for(let i=0;i<=n;i++){const t=i/n,ang=Number(o.a1||0)+a.sweep*t;pts.push({x:o.cx+o.r*Math.cos(ang),y:o.cy+o.r*Math.sin(ang)})}return pts}
  function marqueeHitsObject(o,r){
    if(!o||o.type==='board-bg')return false;const b=bounds(o);if(!Number.isFinite(b.x+b.y+b.w+b.h))return false;
    if(marqueeContainsBounds(r,b))return true;
    const pad=Math.max(2,Number(o.width||2)*.65);
    if(o.type==='path')return polylineHitsMarquee(o.points||[],r,{pad});
    if(['line','arrow','ruler'].includes(o.type))return segmentHitsMarquee({x:o.x1,y:o.y1},{x:o.x2,y:o.y2},r,pad+(o.type==='ruler'?8:0));
    if(o.type==='polygon')return polylineHitsMarquee(o.points||[],r,{closed:true,filled:!!o.fill&&o.fill!=='none',pad});
    if(o.type==='rect'){
      const pts=[[o.x1,o.y1],[o.x2,o.y1],[o.x2,o.y2],[o.x1,o.y2]];return polylineHitsMarquee(pts,r,{closed:true,filled:!!o.fill&&o.fill!=='none',pad});
    }
    if(o.type==='ellipse'){
      const cx=(o.x1+o.x2)/2,cy=(o.y1+o.y2)/2,rx=Math.abs(o.x2-o.x1)/2,ry=Math.abs(o.y2-o.y1)/2,pts=sampledEllipse(cx,cy,rx,ry);
      if(polylineHitsMarquee(pts,r,{closed:true,pad}))return true;
      if(o.fill&&o.fill!=='none'){const corners=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];return corners.some(([x,y])=>rx>0&&ry>0&&((x-cx)**2/rx**2+(y-cy)**2/ry**2)<=1)}
      return false;
    }
    if(o.type==='arc')return polylineHitsMarquee(sampledArc(o),r,{pad});
    if(o.type==='compass')return polylineHitsMarquee(sampledEllipse(o.cx,o.cy,o.r,o.r),r,{closed:true,pad});
    if(o.type==='protractor'){
      const pts=[];for(let i=0;i<=48;i++){const a=Math.PI-i/48*Math.PI;pts.push({x:o.x+o.r*Math.cos(a),y:o.y-o.r*Math.sin(a)})}pts.push({x:o.x+o.r,y:o.y},{x:o.x-o.r,y:o.y});return polylineHitsMarquee(pts,r,{closed:true,filled:true,pad});
    }
    if(o.type==='solid3d'){
      const {model,projected}=solidProjection(o);for(const [ia,ib] of model.edges||[])if(segmentHitsMarquee(projected[ia],projected[ib],r,3))return true;
      const corners=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];for(const face of model.faces||[]){const pts=face.map(i=>projected[i]);if(corners.some(([x,y])=>pointInPoly(x,y,pts)))return true}return false;
    }
    if(['text','formula','note','image','coordinate','graph','attachment'].includes(o.type))return rectsOverlap(r,{x0:b.x,y0:b.y,x1:b.x+b.w,y1:b.y+b.h});
    return false;
  }


  /* Precise eraser hit testing. The old eraser reused the broad selection hitbox,
     so an object could disappear even when the visible eraser never touched it. */
  function pointSegmentDistance(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;
    if(l2<=1e-12)return Math.hypot(px-ax,py-ay);
    const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2));
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  function polylineNearPoint(rawPts,x,y,r,{closed=false}={}){
    const pts=(rawPts||[]).map(p=>Array.isArray(p)?{x:p[0],y:p[1]}:{x:p.x,y:p.y}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(!pts.length)return false;
    if(pts.length===1)return Math.hypot(x-pts[0].x,y-pts[0].y)<=r;
    const n=closed?pts.length:pts.length-1;
    for(let i=0;i<n;i++){
      const a=pts[i],b=pts[(i+1)%pts.length];
      if(pointSegmentDistance(x,y,a.x,a.y,b.x,b.y)<=r)return true;
    }
    return false;
  }
  function eraserHitsObject(o,x,y,eraserR){
    if(!o||o.type==='board-bg')return false;
    const strokePad=Math.max(1.5,Number(o.width||2)*.55),r=eraserR+strokePad;
    if(o.type==='path')return polylineNearPoint(o.points||[],x,y,r);
    if(['line','arrow'].includes(o.type))return pointSegmentDistance(x,y,o.x1,o.y1,o.x2,o.y2)<=r;
    if(o.type==='ruler')return pointSegmentDistance(x,y,o.x1,o.y1,o.x2,o.y2)<=eraserR+10;
    if(o.type==='polygon'){
      const pts=(o.points||[]).map(p=>({x:p[0],y:p[1]}));
      if(o.fill&&o.fill!=='none'&&pts.length>=3&&pointInPoly(x,y,pts))return true;
      return polylineNearPoint(pts,x,y,r,{closed:true});
    }
    if(o.type==='rect'){
      const x0=Math.min(o.x1,o.x2),x1=Math.max(o.x1,o.x2),y0=Math.min(o.y1,o.y2),y1=Math.max(o.y1,o.y2);
      if(o.fill&&o.fill!=='none'&&x>=x0&&x<=x1&&y>=y0&&y<=y1)return true;
      return polylineNearPoint([[x0,y0],[x1,y0],[x1,y1],[x0,y1]],x,y,r,{closed:true});
    }
    if(o.type==='ellipse'){
      const cx=(o.x1+o.x2)/2,cy=(o.y1+o.y2)/2,rx=Math.abs(o.x2-o.x1)/2,ry=Math.abs(o.y2-o.y1)/2;
      if(rx<1e-6||ry<1e-6)return Math.hypot(x-cx,y-cy)<=r;
      const norm=((x-cx)*(x-cx))/(rx*rx)+((y-cy)*(y-cy))/(ry*ry);
      if(o.fill&&o.fill!=='none'&&norm<=1)return true;
      return polylineNearPoint(sampledEllipse(cx,cy,rx,ry,96),x,y,r,{closed:true});
    }
    if(o.type==='arc')return polylineNearPoint(sampledArc(o,96),x,y,r);
    if(o.type==='compass')return polylineNearPoint(sampledEllipse(o.cx,o.cy,o.r,o.r,96),x,y,r,{closed:true});
    if(o.type==='protractor'){
      const pts=[];for(let i=0;i<=64;i++){const a=Math.PI-i/64*Math.PI;pts.push({x:o.x+o.r*Math.cos(a),y:o.y-o.r*Math.sin(a)})}
      pts.push({x:o.x+o.r,y:o.y},{x:o.x-o.r,y:o.y});
      return pointInPoly(x,y,pts)||polylineNearPoint(pts,x,y,r,{closed:true});
    }
    if(o.type==='solid3d'){
      const {model,projected}=solidProjection(o);
      for(const [ia,ib] of model.edges||[]){const a=projected[ia],b=projected[ib];if(a&&b&&pointSegmentDistance(x,y,a.x,a.y,b.x,b.y)<=eraserR+3)return true}
      /* Faces are intentionally not treated as one giant invisible rectangle.
         Filled face interiors count only if the pointer is actually inside a projected face. */
      for(const face of model.faces||[]){const pts=face.map(i=>projected[i]).filter(Boolean);if(pts.length>=3&&pointInPoly(x,y,pts))return true}
      return false;
    }
    const b=bounds(o);if(!Number.isFinite(b.x+b.y+b.w+b.h))return false;
    if(['text','formula','note','image','coordinate','graph','attachment'].includes(o.type)){
      return x>=b.x-eraserR&&x<=b.x+b.w+eraserR&&y>=b.y-eraserR&&y<=b.y+b.h+eraserR;
    }
    return false;
  }
  function eraserHit(elements,isTeacher,x,y,eraserR){
    for(let i=elements.length-1;i>=0;i--){
      const o=elements[i];
      if(o?.teacherOnly&&!isTeacher)continue;
      if(eraserHitsObject(o,x,y,eraserR))return o;
    }
    return null;
  }

  function niceTickStep(range,target=6){
    const raw=Math.max(.0001,range/Math.max(2,target)),pow=Math.pow(10,Math.floor(Math.log10(raw))),n=raw/pow;
    const nice=n<=1?1:n<=2?2:n<=5?5:10;return nice*pow;
  }
  function coordinateRanges(o,w,h){
    const baseW=Math.max(120,Number(o.baseW||680)),baseH=Math.max(120,Number(o.baseH||460));
    const baseX=Math.max(1,Number(o.rangeXBase||o.rangeX||10)),baseY=Math.max(1,Number(o.rangeYBase||o.rangeY||7));
    return {rx:Math.max(2,baseX*(w/baseW)),ry:Math.max(2,baseY*(h/baseH))};
  }
  function drawCoordinate(g,o,withGraph=false){
    const x=o.x,y=o.y,w=Math.max(120,o.w||680),h=Math.max(120,o.h||460),{rx,ry}=coordinateRanges(o,w,h);
    const accent=o.color||'#ED591A';
    g.appendChild(svgEl('rect',{x,y,width:w,height:h,rx:10,fill:'#fff',stroke:'#d8d8d4','stroke-width':1}));
    const mx=v=>x+w/2+(v/rx)*(w/2), my=v=>y+h/2-(v/ry)*(h/2),xStep=niceTickStep(rx,6),yStep=niceTickStep(ry,5);
    const xStart=-Math.floor(rx/xStep)*xStep,xEnd=Math.floor(rx/xStep)*xStep,yStart=-Math.floor(ry/yStep)*yStep,yEnd=Math.floor(ry/yStep)*yStep;
    for(let v=xStart;v<=xEnd+xStep*.01;v+=xStep){const zero=Math.abs(v)<xStep*.01;g.appendChild(svgEl('line',{x1:mx(v),y1:y,x2:mx(v),y2:y+h,stroke:zero?'#111':'#ececea','stroke-width':zero?2:1}))}
    for(let v=yStart;v<=yEnd+yStep*.01;v+=yStep){const zero=Math.abs(v)<yStep*.01;g.appendChild(svgEl('line',{x1:x,y1:my(v),x2:x+w,y2:my(v),stroke:zero?'#111':'#ececea','stroke-width':zero?2:1}))}
    const fmt=v=>Math.abs(v)>=1000?Number(v.toPrecision(3)).toString():Number(v.toFixed(Math.abs(v)<1?2:1)).toString();
    for(let v=xStart;v<=xEnd+xStep*.01;v+=xStep){if(Math.abs(v)<xStep*.01)continue;const t=svgEl('text',{x:mx(v)+3,y:my(0)-6,fill:'#777','font-size':11,'font-family':'Inter,Arial,sans-serif'});t.textContent=fmt(v);g.appendChild(t)}
    for(let v=yStart;v<=yEnd+yStep*.01;v+=yStep){if(Math.abs(v)<yStep*.01)continue;const t=svgEl('text',{x:mx(0)+6,y:my(v)-3,fill:'#777','font-size':11,'font-family':'Inter,Arial,sans-serif'});t.textContent=fmt(v);g.appendChild(t)}
    const xLabel=svgEl('text',{x:x+w-18,y:my(0)-8,fill:'#111','font-size':13,'font-weight':700});xLabel.textContent='x';g.appendChild(xLabel);
    const yLabel=svgEl('text',{x:mx(0)+8,y:y+18,fill:'#111','font-size':13,'font-weight':700});yLabel.textContent='y';g.appendChild(yLabel);
    if(withGraph){
      let segs=o.segments||[];try{if(o.expression)segs=graphSegments(o.expression,rx,ry,Math.max(360,Math.min(1200,Math.round(w))))}catch{}
      for(const seg of segs){
        const points=seg.map(([vx,vy])=>`${mx(vx)},${my(vy)}`).join(' ');
        if(points)g.appendChild(svgEl('polyline',{points,fill:'none',stroke:accent,'stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'}));
      }
      const tt=svgEl('text',{x:x+14,y:y+24,fill:accent,'font-size':15,'font-weight':700,'font-family':'Cambria Math,serif'});tt.textContent=`y = ${o.expression||''}`;g.appendChild(tt);
    }
  }


  const solidNames={
    cube:'Куб',cuboid:'Прямоугольный параллелепипед',tri_prism:'Треугольная призма',hex_prism:'Правильная шестиугольная призма',
    tetra:'Тетраэдр',tri_pyramid:'Треугольная пирамида',square_pyramid:'Четырёхугольная пирамида',hex_pyramid:'Правильная шестиугольная пирамида',
    cylinder:'Цилиндр',cone:'Конус',sphere:'Сфера',frustum:'Усечённый конус'
  };

  const iconSvg=body=>`<svg class="board-shape-svg" viewBox="0 0 64 52" aria-hidden="true" focusable="false">${body}</svg>`;
  const uiIconPaths={
    undo:'<path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
    redo:'<path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/>',
    cursor:'<path d="m5 3 13 8-6 2-3 6z"/><path d="m12 13 5 5"/>',
    hand:'<path d="M7 11V7a1.6 1.6 0 0 1 3.2 0v3"/><path d="M10.2 10V5.8a1.6 1.6 0 0 1 3.2 0V10"/><path d="M13.4 10V6.8a1.6 1.6 0 0 1 3.2 0v5"/><path d="M16.6 11V9.4a1.6 1.6 0 0 1 3.2 0v4.3c0 4.1-2.7 7.3-6.7 7.3h-1.2c-2.1 0-3.7-.8-5-2.4L3.8 15a1.7 1.7 0 0 1 2.5-2.2L7 13.5"/>',
    pen:'<path d="M4 20l4.1-1 10.7-10.7-3.1-3.1L5 15.9z"/><path d="m13.8 7.1 3.1 3.1"/><path d="M4 20l1-4.1 3.1 3.1z"/>',
    pencil:'<path d="m4 19 4.2-1 10.2-10.2-3.2-3.2L5 14.8z"/><path d="m13.7 6.1 3.2 3.2"/><path d="M4 19l1.1-4.2 3.1 3.2z"/>',
    marker:'<path d="m6 17 7-7 5 5-7 7H6z"/><path d="m13 10 3-3 5 5-3 3"/><path d="M3 21h9"/>',
    eraser:'<path d="m7 20-4-4L14 5a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L9 20z"/><path d="m10 9 6 6"/><path d="M7 20h13"/>',
    text:'<path d="M5 5h14"/><path d="M12 5v14"/><path d="M8 19h8"/>',
    note:'<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/><path d="M8 9h8M8 13h5"/>',
    compass:'<circle cx="12" cy="5" r="2"/><path d="m10.8 7-4.3 13M13.2 7l4.3 13M8.5 14h7"/>',
    shapes:'<circle cx="8" cy="8" r="4"/><rect x="12" y="12" width="7" height="7" rx="1"/><path d="m4 20 4-7 4 7z"/>',
    insert:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
    lesson:'<path d="M4 5h16v11H4z"/><path d="M8 20h8M12 16v4"/><path d="m10 8 5 2.5L10 13z"/>',
    more:'<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    line:'<path d="M5 19 19 5"/>',
    arrow:'<path d="M5 19 19 5M12 5h7v7"/>',
    ruler:'<path d="m4 16 12-12 4 4-12 12z"/><path d="m10 10 2 2M13 7l2 2M7 13l2 2"/>',
    protractor:'<path d="M4 17a8 8 0 0 1 16 0z"/><path d="M12 17v-5M8 17l1-3M16 17l-1-3"/>',
    laser:'<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
    focus:'<circle cx="12" cy="12" r="5"/><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>',
    eyeOff:'<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.5 5.3A10 10 0 0 1 12 5c5 0 9 7 9 7a15 15 0 0 1-2.1 2.8M6.2 6.2C4.2 7.7 3 12 3 12s4 7 9 7a9 9 0 0 0 3.2-.6"/>',
    eye:'<path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z"/><circle cx="12" cy="12" r="2.5"/>',
    close:'<path d="M6 6l12 12M18 6 6 18"/>',
    copy:'<rect x="8" y="8" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>',
    paste:'<path d="M9 5h6"/><rect x="5" y="6" width="14" height="15" rx="2"/><path d="M9 4h6v4H9z"/>',
    duplicate:'<rect x="7" y="7" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/><path d="M13 11v4M11 13h4"/>',
    pin:'<path d="m9 3 6 0-1 5 3 3-4 1-1 8-2-8-4-1 3-3z"/>',
    up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
    down:'<path d="M12 5v14M6 13l6 6 6-6"/>',
    front:'<path d="M6 8h10v10H6z"/><path d="M9 5h10v10M4 12H2M3 11v2"/>',
    back:'<path d="M8 6h10v10H8z"/><path d="M5 9H3v10h10v-2"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    grid:'<path d="M4 4h16v16H4zM9 4v16M15 4v16M4 9h16M4 15h16"/>',
    magnet:'<path d="M5 4v8a7 7 0 0 0 14 0V4h-5v8a2 2 0 0 1-4 0V4z"/><path d="M5 8h5M14 8h5"/>',
    fit:'<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
    background:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M5 17 17 5M8 20 20 8M4 12 12 4"/>',
    pageCopy:'<path d="M7 3h9l4 4v14H7z"/><path d="M16 3v5h4M4 7H2v14h11"/>',
    left:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
    right:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    reset:'<path d="M4 4v6h6"/><path d="M6.5 17.5A8 8 0 1 0 5 9"/>',
    formula:'<path d="M17 5H8l5 7-5 7h9"/>',
    coords:'<path d="M4 12h16M12 4v16"/><path d="m18 9 2 3-2 3M9 6l3-2 3 2"/>',
    graph:'<path d="M4 18c3-8 5 0 8-7s4-3 8-7"/>',
    template:'<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
    library:'<path d="M5 4h4v16H5zM10 4h4v16h-4zM15 5l4-1 2 15-4 1z"/>',
    screenshot:'<rect x="4" y="6" width="16" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M8 6l1-2h6l1 2"/>',
    upload:'<path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 15v5h14v-5"/>',
    crop:'<path d="M7 3v14a4 4 0 0 0 4 4M3 7h14a4 4 0 0 1 4 4M17 3v4M3 17h4"/>',
    point:'<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    plane:'<path d="M5 8 18 5l1 11-13 3z"/><path d="M8 12h8"/>',
    rotate:'<path d="M5 8V4h4M5 4a9 9 0 1 1-2 10"/>',
    minus:'<path d="M5 12h14"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    home:'<path d="m4 11 8-7 8 7"/><path d="M6 10v10h12V10M10 20v-6h4v6"/>',
    edit:'<path d="m4 20 4-1 10-10-3-3L5 16z"/><path d="m13 8 3 3"/>',
    fullscreen:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
    lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M9 10V7a4 4 0 0 1 7-2"/>',
    fill:'<path d="m7 4 10 10-5 5L2 9z"/><path d="M15 18h6M18 15v6"/>'
  };
  function uiIcon(name,extra=''){
    const body=uiIconPaths[name]||uiIconPaths.more;
    return `<svg class="mr-ui-icon ${extra}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  function shapeIcon(kind){
    const p={
      circle:'<circle cx="32" cy="26" r="17"/>',
      ellipse:'<ellipse cx="32" cy="26" rx="22" ry="14"/>',
      square:'<rect x="14" y="8" width="36" height="36" rx="1"/>',
      rectangle:'<rect x="9" y="13" width="46" height="28" rx="1"/>',
      triangle:'<path d="M32 7 L55 44 H9 Z"/>',
      right:'<path d="M14 8 V44 H54 Z"/><path d="M14 35 H23 V44" class="icon-detail"/>',
      isosceles:'<path d="M32 6 L53 44 H11 Z"/><path d="M23 44 L32 38 L41 44" class="icon-detail"/>',
      equilateral:'<path d="M32 6 L54 44 H10 Z"/><path d="M19 43 L22 38 M42 38 L45 43 M29 11 L35 11" class="icon-detail"/>',
      rhombus:'<path d="M32 6 L55 26 L32 46 L9 26 Z"/>',
      parallelogram:'<path d="M18 10 H55 L46 42 H9 Z"/>',
      trapezoid:'<path d="M20 11 H45 L55 42 H9 Z"/>',
      iso_trapezoid:'<path d="M22 11 H42 L54 42 H10 Z"/><path d="M13 37 L18 39 M46 39 L51 37" class="icon-detail"/>',
      hexagon:'<path d="M18 7 H46 L58 26 L46 45 H18 L6 26 Z"/>'
    };return iconSvg(p[kind]||p.square);
  }
  function solidIcon(kind){
    const p={
      cube:'<path d="M16 15 L37 9 L51 18 L50 39 L29 45 L15 36 Z"/><path d="M16 15 L29 24 L51 18 M29 24 V45 M15 36 L29 24" class="icon-detail"/>',
      cuboid:'<path d="M9 16 L39 10 L55 18 L53 38 L24 44 L8 36 Z"/><path d="M9 16 L24 24 L55 18 M24 24 V44 M8 36 L24 24" class="icon-detail"/>',
      tri_prism:'<path d="M11 37 L23 12 L35 37 Z M29 42 L41 17 L53 42 Z"/><path d="M11 37 L29 42 M23 12 L41 17 M35 37 L53 42" class="icon-detail"/>',
      hex_prism:'<path d="M13 17 L24 10 L37 15 L39 29 L28 36 L15 31 Z M27 23 L38 16 L51 21 L53 35 L42 42 L29 37 Z"/><path d="M13 17 L27 23 M24 10 L38 16 M37 15 L51 21 M39 29 L53 35 M28 36 L42 42 M15 31 L29 37" class="icon-detail"/>',
      tetra:'<path d="M32 7 L10 43 L53 42 Z"/><path d="M32 7 L31 30 M10 43 L31 30 L53 42" class="icon-detail"/>',
      tri_pyramid:'<path d="M32 6 L9 42 L54 42 Z"/><path d="M32 6 L29 29 M9 42 L29 29 L54 42" class="icon-detail"/>',
      square_pyramid:'<path d="M32 6 L10 34 L30 45 L54 33 Z"/><path d="M32 6 L30 45 M10 34 L54 33" class="icon-detail"/>',
      hex_pyramid:'<path d="M32 5 L9 33 L18 44 L42 46 L56 34 L46 25 Z"/><path d="M32 5 L18 44 M32 5 L42 46 M32 5 L56 34 M9 33 L56 34" class="icon-detail"/>',
      cylinder:'<ellipse cx="32" cy="12" rx="18" ry="6"/><path d="M14 12 V39 M50 12 V39"/><ellipse cx="32" cy="39" rx="18" ry="6"/><path d="M14 39 C18 44 46 44 50 39" class="icon-detail"/>',
      cone:'<ellipse cx="32" cy="41" rx="19" ry="6"/><path d="M32 6 L13 41 M32 6 L51 41"/><path d="M13 41 C19 46 45 46 51 41" class="icon-detail"/>',
      frustum:'<ellipse cx="32" cy="13" rx="11" ry="4"/><ellipse cx="32" cy="40" rx="19" ry="6"/><path d="M21 13 L13 40 M43 13 L51 40"/><path d="M13 40 C19 45 45 45 51 40" class="icon-detail"/>',
      sphere:'<circle cx="32" cy="26" r="20"/><ellipse cx="32" cy="26" rx="20" ry="7" class="icon-detail"/><path d="M32 6 C23 14 23 38 32 46 M32 6 C41 14 41 38 32 46" class="icon-detail"/>'
    };return iconSvg(p[kind]||p.cube);
  }
  const shapePalette=[['circle','Окружность'],['ellipse','Эллипс'],['square','Квадрат'],['rectangle','Прямоугольник'],['triangle','Треугольник'],['right','Прямоугольный треугольник'],['isosceles','Равнобедренный'],['equilateral','Равносторонний'],['rhombus','Ромб'],['parallelogram','Параллелограмм'],['trapezoid','Трапеция'],['iso_trapezoid','Равнобедренная трапеция'],['hexagon','Шестиугольник']];
  const solidPalette=[['cube','Куб'],['cuboid','Параллелепипед'],['tri_prism','Треугольная призма'],['hex_prism','Шестиугольная призма'],['tetra','Тетраэдр'],['tri_pyramid','Треугольная пирамида'],['square_pyramid','Четырёхугольная пирамида'],['hex_pyramid','Шестиугольная пирамида'],['cylinder','Цилиндр'],['cone','Конус'],['frustum','Усечённый конус'],['sphere','Сфера']];
  const shapeTile=([kind,label])=>`<button type="button" class="board-shape-icon" data-shape-template="${kind}" title="${esc(label)}" aria-label="${esc(label)}">${shapeIcon(kind)}<span class="board-shape-label">${esc(label)}</span></button>`;
  const solidTile=([kind,label])=>`<button type="button" class="board-shape-icon board-solid-icon" data-solid-template="${kind}" title="${esc(label)}" aria-label="${esc(label)}">${solidIcon(kind)}<span class="board-shape-label">${esc(label)}</span></button>`;
  function prismModel(n=4,depth=1.2,phase=Math.PI/4){
    const vertices=[];for(const z of [-depth/2,depth/2])for(let i=0;i<n;i++){const a=phase+2*Math.PI*i/n;vertices.push([Math.cos(a),Math.sin(a),z])}
    const edges=[],faces=[];for(let i=0;i<n;i++){const j=(i+1)%n;edges.push([i,j],[n+i,n+j],[i,n+i]);faces.push([i,j,n+j,n+i])}
    faces.push([...Array(n).keys()],[...Array(n).keys()].map(i=>n+i));return{vertices,edges,faces};
  }
  function pyramidModel(n=4,phase=Math.PI/4){
    const vertices=[];for(let i=0;i<n;i++){const a=phase+2*Math.PI*i/n;vertices.push([Math.cos(a),Math.sin(a),-.62])}vertices.push([0,0,1]);const apex=n,edges=[],faces=[];for(let i=0;i<n;i++){const j=(i+1)%n;edges.push([i,j],[i,apex]);faces.push([i,j,apex])}faces.push([...Array(n).keys()]);return{vertices,edges,faces};
  }
  function ringModel(kind='cylinder'){
    const n=24,vertices=[],edges=[],faces=[];
    if(kind==='sphere'){
      const latitudes=[-60,-30,0,30,60].map(v=>v*Math.PI/180);
      for(const lat of latitudes)for(let i=0;i<n;i++){const a=2*Math.PI*i/n,c=Math.cos(lat);vertices.push([c*Math.cos(a),Math.sin(lat),c*Math.sin(a)])}
      const south=vertices.length;vertices.push([0,-1,0]);const north=vertices.length;vertices.push([0,1,0]);
      for(let r=0;r<latitudes.length;r++)for(let i=0;i<n;i++){const j=(i+1)%n;edges.push([r*n+i,r*n+j]);if(r<latitudes.length-1&&i%2===0)edges.push([r*n+i,(r+1)*n+i])}
      for(let r=0;r<latitudes.length-1;r++)for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([r*n+i,r*n+j,(r+1)*n+j,(r+1)*n+i])}
      for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([south,j,i]);faces.push([(latitudes.length-1)*n+i,(latitudes.length-1)*n+j,north]);if(i%3===0){edges.push([south,i],[(latitudes.length-1)*n+i,north])}}
      return{vertices,edges,faces,curved:true};
    }
    if(kind==='cone'){
      for(let i=0;i<n;i++){const a=2*Math.PI*i/n;vertices.push([Math.cos(a),-.75,Math.sin(a)])}vertices.push([0,1,0]);
      for(let i=0;i<n;i++){const j=(i+1)%n;edges.push([i,j]);faces.push([i,j,n]);if(i%3===0)edges.push([i,n])}faces.push([...Array(n).keys()]);return{vertices,edges,faces,curved:true};
    }
    const topR=kind==='frustum'?.58:1,bottomR=1;
    for(const [y,r] of [[-.75,bottomR],[.75,topR]])for(let i=0;i<n;i++){const a=2*Math.PI*i/n;vertices.push([r*Math.cos(a),y,r*Math.sin(a)])}
    for(let i=0;i<n;i++){const j=(i+1)%n;edges.push([i,j],[n+i,n+j]);faces.push([i,j,n+j,n+i]);if(i%3===0)edges.push([i,n+i])}
    faces.push([...Array(n).keys()],[...Array(n).keys()].map(i=>n+i));return{vertices,edges,faces,curved:true};
  }
  function solidModel(shape){
    if(shape==='cube')return prismModel(4,1.42,Math.PI/4);
    if(shape==='cuboid'){const m=prismModel(4,1.15,Math.PI/4);m.vertices=m.vertices.map(([x,y,z])=>[x*1.25,y*.82,z]);return m}
    if(shape==='tri_prism')return prismModel(3,1.35,Math.PI/2);
    if(shape==='hex_prism')return prismModel(6,1.25,0);
    if(shape==='tetra'||shape==='tri_pyramid')return pyramidModel(3,Math.PI/2);
    if(shape==='square_pyramid')return pyramidModel(4,Math.PI/4);
    if(shape==='hex_pyramid')return pyramidModel(6,0);
    if(shape==='cylinder')return ringModel('cylinder');
    if(shape==='cone')return ringModel('cone');
    if(shape==='sphere')return ringModel('sphere');
    if(shape==='frustum')return ringModel('frustum');
    return prismModel(4,1.42,Math.PI/4);
  }
  function rotate3(p,rx=0,ry=0,rz=0){
    let[x,y,z]=p;let c=Math.cos(rx),q=Math.sin(rx),yy=y*c-z*q,zz=y*q+z*c;y=yy;z=zz;
    c=Math.cos(ry);q=Math.sin(ry);let xx=x*c+z*q;zz=-x*q+z*c;x=xx;z=zz;
    c=Math.cos(rz);q=Math.sin(rz);xx=x*c-y*q;yy=x*q+y*c;return[xx,yy,z];
  }
  function projectSolidPoint(o,p){
    const r=rotate3(p,Number(o.rotX??-.42),Number(o.rotY??.62),Number(o.rotZ||0)),w=Math.max(120,o.w||420),h=Math.max(110,o.h||330),persp=3.6/(3.6-r[2]*.32);
    return{x:o.x+w/2+r[0]*w*.34*persp,y:o.y+h/2-r[1]*h*.36*persp,z:r[2],p};
  }
  function solidProjection(o){const model=solidModel(o.shape),projected=model.vertices.map(p=>projectSolidPoint(o,p));return{model,projected}}
  function pointToSegment(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(!l2)return{d:Math.hypot(px-a.x,py-a.y),t:0};const t=Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/l2)),x=a.x+t*dx,y=a.y+t*dy;return{d:Math.hypot(px-x,py-y),t}}
  function barycentric2(px,py,a,b,c){
    const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-8)return null;
    const u=((b.y-c.y)*(px-c.x)+(c.x-b.x)*(py-c.y))/den,v=((c.y-a.y)*(px-c.x)+(a.x-c.x)*(py-c.y))/den,w=1-u-v;
    return{u,v,w,inside:u>=-.025&&v>=-.025&&w>=-.025};
  }
  function nearestSolidSurfacePoint(o,x,y){
    const{model,projected}=solidProjection(o);let faceBest=null;
    for(const face of model.faces||[]){if(face.length<3)continue;for(let k=1;k<face.length-1;k++){
      const ids=[face[0],face[k],face[k+1]],a=projected[ids[0]],b=projected[ids[1]],c=projected[ids[2]],bc=barycentric2(x,y,a,b,c);if(!bc?.inside)continue;
      const A=model.vertices[ids[0]],B=model.vertices[ids[1]],C=model.vertices[ids[2]],p=[A[0]*bc.u+B[0]*bc.v+C[0]*bc.w,A[1]*bc.u+B[1]*bc.v+C[1]*bc.w,A[2]*bc.u+B[2]*bc.v+C[2]*bc.w],z=a.z*bc.u+b.z*bc.v+c.z*bc.w;
      if(!faceBest||z>faceBest.z)faceBest={d:0,p,z,kind:'face'};
    }}
    if(faceBest)return faceBest;
    let best=null;for(const [ia,ib] of model.edges){const a=projected[ia],b=projected[ib],q=pointToSegment(x,y,a,b);if(!best||q.d<best.d){const A=model.vertices[ia],B=model.vertices[ib];best={d:q.d,p:[A[0]+(B[0]-A[0])*q.t,A[1]+(B[1]-A[1])*q.t,A[2]+(B[2]-A[2])*q.t],kind:'edge'}}}return best;
  }
  function nearestSolidUserPoint(o,x,y){let best=null;for(const m of o.solidPoints||[]){const p=projectSolidPoint(o,m.p),d=Math.hypot(x-p.x,y-p.y);if(!best||d<best.d)best={...m,d,screen:p}}return best}
  function normalizeAngleDelta(v){while(v<=-Math.PI)v+=Math.PI*2;while(v>Math.PI)v-=Math.PI*2;return v}
  function arcPath(o){
    const r=Math.max(1,o.r||1),a1=Number(o.a1||0);let sweep=Number.isFinite(Number(o.sweep))?Number(o.sweep):normalizeAngleDelta(Number(o.a2??(a1+Math.PI/2))-a1);
    if(Math.abs(sweep)<.015)sweep=(sweep<0?-1:1)*.015;const max=Math.PI*2-.02;sweep=Math.max(-max,Math.min(max,sweep));
    const a2=a1+sweep,sx=o.cx+r*Math.cos(a1),sy=o.cy+r*Math.sin(a1),ex=o.cx+r*Math.cos(a2),ey=o.cy+r*Math.sin(a2),large=Math.abs(sweep)>Math.PI?1:0,dir=sweep>=0?1:0;
    return{d:`M ${sx} ${sy} A ${r} ${r} 0 ${large} ${dir} ${ex} ${ey}`,sx,sy,ex,ey,length:Math.abs(sweep),sweep,a2};
  }
  function planeSectionPoints(model,A,B,C){
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],n=cross(sub(B,A),sub(C,A)),nl=Math.hypot(...n);if(nl<1e-6)return[];
    const normal=n.map(v=>v/nl),eps=.015,pts=[];const add=P=>{if(!pts.some(Q=>Math.hypot(P[0]-Q[0],P[1]-Q[1],P[2]-Q[2])<.025))pts.push(P)};
    for(const [ia,ib] of model.edges||[]){const P=model.vertices[ia],Q=model.vertices[ib],d1=dot(normal,sub(P,A)),d2=dot(normal,sub(Q,A));if(Math.abs(d1)<eps)add(P);if(Math.abs(d2)<eps)add(Q);if(d1*d2<0){const t=d1/(d1-d2);add([P[0]+(Q[0]-P[0])*t,P[1]+(Q[1]-P[1])*t,P[2]+(Q[2]-P[2])*t])}}
    if(pts.length<3)return pts;const center=pts.reduce((r,p)=>[r[0]+p[0],r[1]+p[1],r[2]+p[2]],[0,0,0]).map(v=>v/pts.length),u0=Math.abs(normal[0])<.8?[1,0,0]:[0,1,0],u=cross(normal,u0),ul=Math.hypot(...u)||1,uu=u.map(v=>v/ul),vv=cross(normal,uu);
    return pts.sort((P,Q)=>{const p=sub(P,center),q=sub(Q,center);return Math.atan2(dot(p,vv),dot(p,uu))-Math.atan2(dot(q,vv),dot(q,uu))});
  }
  function drawSolid3D(g,o){
    const color=o.color||'#15171a',accent='#ED591A',proj=solidProjection(o),{model,projected}=proj,n=svgEl('g');
    const faces=(model.faces||[]).map(face=>({face,z:face.reduce((s,i)=>s+projected[i].z,0)/Math.max(1,face.length)})).sort((a,b)=>a.z-b.z),median=faces.length?faces[Math.floor(faces.length/2)].z:0;
    for(const f of faces){if(f.z<median-.18)continue;const poly=svgEl('polygon',{points:f.face.map(i=>`${projected[i].x},${projected[i].y}`).join(' '),fill:f.z>median+.18?'#fff0e8':'#f6f4f1',opacity:model.curved?.11:.19,stroke:'none'});n.appendChild(poly)}
    for(const pl of o.planes||[]){
      const raw=(pl.ids||[]).map(id=>(o.solidPoints||[]).find(p=>p.id===id)).filter(Boolean).map(m=>m.p);if(raw.length<3)continue;
      const A=raw[0],B=raw[1],C=raw[2],planeColor=pl.color||'#292b33',sectionColor=pl.sectionColor||'#ED591A',sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)},u=norm(sub(B,A)),normal=norm(cross(sub(B,A),sub(C,A))),v=norm(cross(normal,u)),center=[(A[0]+B[0]+C[0])/3,(A[1]+B[1]+C[1])/3,(A[2]+B[2]+C[2])/3],coords=raw.map(P=>{const d=sub(P,center);return[dot(d,u),dot(d,v)]}),us=coords.map(q=>q[0]),vs=coords.map(q=>q[1]),pad=.58,umin=Math.min(...us)-pad,umax=Math.max(...us)+pad,vmin=Math.min(...vs)-pad,vmax=Math.max(...vs)+pad,pt=(uu,vv)=>[center[0]+u[0]*uu+v[0]*vv,center[1]+u[1]*uu+v[1]*vv,center[2]+u[2]*uu+v[2]*vv],corners=[[umin,vmin],[umax,vmin],[umax,vmax],[umin,vmax]].map(q=>projectSolidPoint(o,pt(q[0],q[1])));
      n.appendChild(svgEl('polygon',{points:corners.map(p=>`${p.x},${p.y}`).join(' '),fill:planeColor,opacity:.24,stroke:planeColor,'stroke-width':2.2,'stroke-dasharray':'7 5','stroke-linejoin':'round'}));
      const section=planeSectionPoints(model,A,B,C);if(section.length>=3){const sp=section.map(P=>projectSolidPoint(o,P));n.appendChild(svgEl('polygon',{points:sp.map(p=>`${p.x},${p.y}`).join(' '),fill:planeColor,opacity:.34,stroke:sectionColor,'stroke-width':3.2,'stroke-linejoin':'round'}))}
      const lab=projectSolidPoint(o,center),tt=svgEl('text',{x:lab.x+8,y:lab.y-8,fill:planeColor,'font-size':14,'font-weight':900});tt.textContent='α';n.appendChild(tt);
    }
    const edges=model.edges.map(([a,b])=>({a,b,z:(projected[a].z+projected[b].z)/2})).sort((A,B)=>A.z-B.z);for(const e of edges){const a=projected[e.a],b=projected[e.b],hidden=e.z<-.18;n.appendChild(svgEl('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':hidden?1.2:2.2,'stroke-dasharray':hidden?'6 6':'','stroke-linecap':'round',opacity:hidden?.35:.96}))}
    const planePointIds=new Set((o.planes||[]).flatMap(pl=>pl.ids||[]));
    for(const m of o.solidPoints||[]){const p=projectSolidPoint(o,m.p),filled=!!m.pendingPlane||planePointIds.has(m.id);n.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:6.8,fill:filled?accent:'#fff',stroke:filled?'#fff':accent,'stroke-width':filled?1.7:2.3}));if(filled)n.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:8.6,fill:'none',stroke:accent,'stroke-width':1.6,opacity:.8}));const t=svgEl('text',{x:p.x+9,y:p.y-8,fill:filled?'#b93f10':accent,'font-size':15,'font-weight':900,'font-family':'Unbounded,Arial,sans-serif'});t.textContent=m.label||'•';n.appendChild(t)}
    const title=svgEl('text',{x:o.x+10,y:o.y+20,fill:'#73736f','font-size':11,'font-weight':700});title.textContent=solidNames[o.shape]||'3D фигура';n.appendChild(title);g.appendChild(n);return n;
  }

  function drawElements(svg,elements,camera,selected=null,grid=false,onAssetNeeded=null,viewerIsTeacher=true){
    const selectedSet=selected instanceof Set?new Set(selected):new Set(Array.isArray(selected)?selected:(selected?[selected]:[]));
    const selectedList=[...selectedSet];
    const singleSelected=selectedList.length===1?selectedList[0]:null;
    svg.innerHTML='';
    const boardBg=(elements||[]).find(x=>x.type==='board-bg');if(boardBg)svg.appendChild(svgEl('rect',{x:0,y:0,width:'100%',height:'100%',fill:boardBg.color||'#ffffff','pointer-events':'none'}));
    if(grid){
      const defs=svgEl('defs'); const pat=svgEl('pattern',{id:'mrgrid320',width:20,height:20,patternUnits:'userSpaceOnUse'});
      pat.appendChild(svgEl('circle',{cx:1,cy:1,r:1,fill:'#d7dbe0'}));defs.appendChild(pat);svg.appendChild(defs);
      svg.appendChild(svgEl('rect',{x:camera.x-3000,y:camera.y-3000,width:12000,height:12000,fill:'url(#mrgrid320)'}));
    }
    const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);
    for(const o of elements||[]){
      try{
      if(!o||typeof o!=='object'||typeof o.type!=='string')continue;
      if(o.type==='board-bg') continue;
      if(o.teacherOnly && !viewerIsTeacher) continue;
      let n=null;
      if(o.type==='path') n=svgEl('path',{d:smoothPathD(o.points||[]),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round','shape-rendering':'geometricPrecision',opacity:o.opacity==null?1:o.opacity});
      else if(o.type==='line') n=svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'});
      else if(o.type==='rect') n=svgEl('rect',{x:Math.min(o.x1,o.x2),y:Math.min(o.y1,o.y2),width:Math.abs(o.x2-o.x1),height:Math.abs(o.y2-o.y1),fill:o.fill||'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='ellipse') n=svgEl('ellipse',{cx:(o.x1+o.x2)/2,cy:(o.y1+o.y2)/2,rx:Math.abs(o.x2-o.x1)/2,ry:Math.abs(o.y2-o.y1)/2,fill:o.fill||'none',stroke:o.color||'#15171a','stroke-width':o.width||3});
      else if(o.type==='arrow'){
        n=svgEl('g');n.appendChild(svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round'}));
        const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=12+(o.width||3)*2,p1=[o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6)],p2=[o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6)];
        n.appendChild(svgEl('polyline',{points:`${p1.join(',')} ${o.x2},${o.y2} ${p2.join(',')}`,fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'}));
      } else if(o.type==='note'){
        n=svgEl('g');const w=o.w||260,h=o.h||160,fill=o.fill||'#fff3bf';n.appendChild(svgEl('rect',{x:o.x,y:o.y,width:w,height:h,rx:14,fill,stroke:'#e0c65d','stroke-width':1.3}));const fs=o.fontSize||20,maxChars=Math.max(10,Math.floor(w/(fs*.56))),words=String(o.text||'').split(/\s+/),lines=[];let line='';for(const word of words){const test=line?line+' '+word:word;if(test.length>maxChars&&line){lines.push(line);line=word}else line=test}if(line)lines.push(line);lines.slice(0,Math.max(1,Math.floor((h-30)/(fs*1.25)))).forEach((ln,i)=>{const t=svgEl('text',{x:o.x+16,y:o.y+28+i*fs*1.25,fill:o.color||'#3d3515','font-size':fs,'font-family':'Inter,Arial,sans-serif'});t.textContent=ln;n.appendChild(t)});
      } else if(o.type==='text'||o.type==='formula'){
        n=svgEl('text',{x:o.x,y:o.y,fill:o.color||'#15171a','font-size':o.fontSize||28,'font-family':o.fontFamily||(o.type==='formula'?'Cambria Math,Times New Roman,serif':'Inter,Arial,sans-serif'),'font-weight':o.fontWeight||'','font-style':o.fontStyle||''});
        const lineStep=(o.fontSize||28)*(o.lineHeight||1.25);
        String(o.text||'').split('\n').forEach((line,i)=>{const t=svgEl('tspan',{x:o.x,dy:i?lineStep:0});t.textContent=line;n.appendChild(t)});
      } else if(o.type==='polygon') n=svgEl('polygon',{points:(o.points||[]).map(p=>p.join(',')).join(' '),fill:o.fill||'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linejoin':'round'});
      else if(o.type==='coordinate'||o.type==='graph'){n=svgEl('g');drawCoordinate(n,o,o.type==='graph');}
      else if(o.type==='ruler'){
        n=svgEl('g');
        const dx=o.x2-o.x1,dy=o.y2-o.y1,len=Math.max(1,Math.hypot(dx,dy)),ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
        n.appendChild(svgEl('line',{x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2,stroke:o.color||'#0f172a','stroke-width':3,'stroke-linecap':'round'}));
        const ticks=Math.min(40,Math.max(2,Math.floor(len/28)));
        for(let i=0;i<=ticks;i++){const q=i/ticks,x=o.x1+dx*q,y=o.y1+dy*q,t=i%5===0?13:7;n.appendChild(svgEl('line',{x1:x,y1:y,x2:x+nx*t,y2:y+ny*t,stroke:o.color||'#0f172a','stroke-width':1.4}))}
        const label=svgEl('text',{x:(o.x1+o.x2)/2+nx*22,y:(o.y1+o.y2)/2+ny*22,fill:o.color||'#0f172a','font-size':14});label.textContent=`${Math.round(len)} ед.`;n.appendChild(label);
      } else if(o.type==='compass'){
        n=svgEl('g');const c=o.color||'#0f172a',r=Math.max(1,o.r||1),hx=o.cx+r,hy=o.cy;
        n.appendChild(svgEl('circle',{cx:o.cx,cy:o.cy,r,fill:'none',stroke:c,'stroke-width':o.width||2,'stroke-linecap':'round'}));
        n.appendChild(svgEl('line',{x1:o.cx,y1:o.cy,x2:hx,y2:hy,stroke:c,'stroke-width':1,'stroke-dasharray':'6 5',opacity:.45}));
        n.appendChild(svgEl('circle',{cx:o.cx,cy:o.cy,r:5,fill:'#fff',stroke:c,'stroke-width':2}));
        n.appendChild(svgEl('circle',{cx:hx,cy:hy,r:4,fill:c,stroke:'#fff','stroke-width':1.5}));
        n.appendChild(svgEl('path',{d:`M ${o.cx-8} ${o.cy-18} L ${o.cx} ${o.cy-35} L ${o.cx+8} ${o.cy-18}`,fill:'none',stroke:c,'stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.75}));
        const label=svgEl('g');label.appendChild(svgEl('rect',{x:o.cx+10,y:o.cy-r-29,width:Math.max(48,String(Math.round(r)).length*9+32),height:24,rx:9,fill:'#fff',stroke:'#d9dde3','stroke-width':1}));const t=svgEl('text',{x:o.cx+19,y:o.cy-r-12,fill:c,'font-size':12,'font-weight':700});t.textContent=`r ${Math.round(r)}`;label.appendChild(t);n.appendChild(label);
      } else if(o.type==='arc'){
        n=svgEl('g');const c=o.color||'#15171a',r=Math.max(1,o.r||1),a=arcPath(o),draft=!!o.stage;
        if(draft)n.appendChild(svgEl('circle',{cx:o.cx,cy:o.cy,r,fill:'none',stroke:'#9ca3af','stroke-width':1,'stroke-dasharray':'5 6',opacity:.42}));
        if(o.stage==='radius')n.appendChild(svgEl('line',{x1:o.cx,y1:o.cy,x2:a.sx,y2:a.sy,stroke:'#6b7280','stroke-width':1.2,'stroke-dasharray':'5 5',opacity:.55}));
        if(o.stage!=='radius')n.appendChild(svgEl('path',{d:a.d,fill:'none',stroke:c,'stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round'}));
        n.appendChild(svgEl('circle',{cx:o.cx,cy:o.cy,r:4.5,fill:c,stroke:'#fff','stroke-width':1.6}));
        n.appendChild(svgEl('circle',{cx:a.sx,cy:a.sy,r:4,fill:c,stroke:'#fff','stroke-width':1.2}));
        if(o.stage!=='radius')n.appendChild(svgEl('circle',{cx:a.ex,cy:a.ey,r:4,fill:c,stroke:'#fff','stroke-width':1.2}));
      } else if(o.type==='solid3d'){
        n=svgEl('g');drawSolid3D(n,o);
      } else if(o.type==='protractor'){
        n=svgEl('g');const r=Math.max(90,o.r||170),x=o.x,y=o.y,c=o.color||'#0f172a';
        n.appendChild(svgEl('path',{d:`M ${x-r} ${y} A ${r} ${r} 0 0 1 ${x+r} ${y}`,fill:'#fffaf6',opacity:.86,stroke:c,'stroke-width':2.2}));
        n.appendChild(svgEl('line',{x1:x-r,y1:y,x2:x+r,y2:y,stroke:c,'stroke-width':2.2}));
        n.appendChild(svgEl('circle',{cx:x,cy:y,r:4.5,fill:'#fff',stroke:'#ED591A','stroke-width':2}));
        for(let a=0;a<=180;a+=5){
          const rad=Math.PI*a/180,major=a%10===0,very=a%30===0||a===90,inner=r-(very?19:major?13:7),x1=x-r*Math.cos(rad),y1=y-r*Math.sin(rad),x2=x-inner*Math.cos(rad),y2=y-inner*Math.sin(rad);
          n.appendChild(svgEl('line',{x1,y1,x2,y2,stroke:a===90?'#ED591A':c,'stroke-width':very?1.45:major?1.05:.75,opacity:major?1:.62}));
          if(major){const lr=r-(very?34:29),tx=x-lr*Math.cos(rad),ty=y-lr*Math.sin(rad)+3.5,t=svgEl('text',{x:tx,y:ty,fill:a===90?'#ED591A':'#5f625f','font-size':very?10.5:9,'font-weight':very?800:650,'text-anchor':'middle','font-family':'Inter,Arial,sans-serif'});t.textContent=`${a}°`;n.appendChild(t)}
        }
        const centerText=svgEl('text',{x,y:y-8,fill:'#ED591A','font-size':10,'font-weight':800,'text-anchor':'middle'});centerText.textContent='0';n.appendChild(centerText);
      } else if(o.type==='attachment'){
        n=svgEl('g');const w=o.w||360,h=o.h||96,mime=String(o.mime||''),icon=mime.startsWith('video/')?'▶':mime.startsWith('audio/')?'♫':/pdf/.test(mime)?'PDF':/presentation|powerpoint/.test(mime)?'PPT':/spreadsheet|excel/.test(mime)?'XLS':/word|document/.test(mime)?'DOC':'FILE';n.appendChild(svgEl('rect',{x:o.x,y:o.y,width:w,height:h,rx:15,fill:'#fff',stroke:'#d9d9d4','stroke-width':1.3}));n.appendChild(svgEl('rect',{x:o.x+12,y:o.y+14,width:58,height:h-28,rx:11,fill:'#fff0e8',stroke:'#f3c5ae','stroke-width':1}));const ic=svgEl('text',{x:o.x+41,y:o.y+h/2+6,fill:'#ED591A','font-size':icon.length>2?13:24,'font-weight':800,'text-anchor':'middle'});ic.textContent=icon;n.appendChild(ic);const title=svgEl('text',{x:o.x+82,y:o.y+35,fill:'#242424','font-size':16,'font-weight':750});title.textContent=String(o.name||'Файл').slice(0,34);n.appendChild(title);const sub=svgEl('text',{x:o.x+82,y:o.y+59,fill:'#7a7a74','font-size':11});sub.textContent='Двойной клик — открыть файл';n.appendChild(sub);
      } else if(o.type==='image'){
        const url=assetCache.get(o.assetPath);
        if(url)n=svgEl('image',{x:o.x,y:o.y,width:o.w||700,height:o.h||500,href:url,preserveAspectRatio:'xMidYMid meet'});
        else{n=svgEl('g');n.appendChild(svgEl('rect',{x:o.x,y:o.y,width:o.w||700,height:o.h||500,fill:'#f3f4f6',stroke:'#cbd0d8','stroke-width':1}));const t=svgEl('text',{x:o.x+16,y:o.y+30,fill:'#6b7280','font-size':15});t.textContent='Загрузка материала…';n.appendChild(t);onAssetNeeded?.(o.assetPath)}
      }
      if(n){
        let out=n;
        if(Number(o.rotation)){const b=bounds(o),cx=b.x+b.w/2,cy=b.y+b.h/2,wrap=svgEl('g',{transform:`rotate(${Number(o.rotation)||0} ${cx} ${cy})`});wrap.appendChild(n);out=wrap;}
        out.dataset.id=o.id;
        if(o.teacherOnly&&viewerIsTeacher)out.setAttribute('opacity','.35');
        if(singleSelected===o.id)out.setAttribute('opacity','.58');
        g.appendChild(out)
      }
      }catch(err){console.warn('[Mathroom board] пропущен несовместимый объект',o?.type,o?.id,err)}
    }
    const selectedObjects=selectedList.map(id=>(elements||[]).find(x=>x.id===id)).filter(Boolean);
    for(const o of selectedObjects){
      const b=bounds(o),pad=(o.type==='solid3d'?9:6)/camera.zoom,hs=(o.type==='solid3d'?14:9)/camera.zoom;
      const multi=selectedObjects.length>1;
      const frame=svgEl('rect',{x:b.x-pad,y:b.y-pad,width:Math.max(1,b.w)+pad*2,height:Math.max(1,b.h)+pad*2,fill:'none',stroke:o.locked?'#7c7c78':multi?'#f3a27a':'#ED591A','stroke-width':(multi?1.15:1.5)/camera.zoom,'stroke-dasharray':o.locked?`${2/camera.zoom} ${3/camera.zoom}`:`${5/camera.zoom} ${4/camera.zoom}`,'pointer-events':'none'});
      g.appendChild(frame);
      if(!multi){
        const x0=b.x-pad,y0=b.y-pad,x1=b.x+b.w+pad,y1=b.y+b.h+pad,xm=(x0+x1)/2,ym=(y0+y1)/2;
        if(!o.locked){[['nw',x0,y0],['n',xm,y0],['ne',x1,y0],['e',x1,ym],['se',x1,y1],['s',xm,y1],['sw',x0,y1],['w',x0,ym]].forEach(([h,x,y])=>{
          const r=svgEl('rect',{x:x-hs/2,y:y-hs/2,width:hs,height:hs,rx:2/camera.zoom,fill:'#fff',stroke:'#ED591A','stroke-width':1.5/camera.zoom});
          r.dataset.resizeHandle=h;r.style.cursor=({nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize'})[h];
          g.appendChild(r);
        });
        const ry=y0-34/camera.zoom;g.appendChild(svgEl('line',{x1:xm,y1:y0,x2:xm,y2:ry,stroke:'#ED591A','stroke-width':1/camera.zoom,'pointer-events':'none'}));
        const rot=svgEl('circle',{cx:xm,cy:ry,r:6/camera.zoom,fill:'#fff',stroke:'#ED591A','stroke-width':1.5/camera.zoom});rot.dataset.rotateHandle='1';rot.style.cursor='grab';g.appendChild(rot);
        }else{const lt=svgEl('text',{x:x0+6/camera.zoom,y:y0-8/camera.zoom,fill:'#6b6b67','font-size':11/camera.zoom,'font-weight':800});lt.textContent='LOCK';g.appendChild(lt)}
      }
    }
    if(selectedObjects.length>1){
      const boxes=selectedObjects.map(bounds),x0=Math.min(...boxes.map(b=>b.x)),y0=Math.min(...boxes.map(b=>b.y)),x1=Math.max(...boxes.map(b=>b.x+b.w)),y1=Math.max(...boxes.map(b=>b.y+b.h)),pad=10/camera.zoom;
      g.appendChild(svgEl('rect',{x:x0-pad,y:y0-pad,width:Math.max(1,x1-x0)+pad*2,height:Math.max(1,y1-y0)+pad*2,rx:7/camera.zoom,fill:'none',stroke:'#ED591A','stroke-width':2/camera.zoom,'stroke-dasharray':`${7/camera.zoom} ${5/camera.zoom}`,'pointer-events':'none'}));
      const badge=svgEl('g',{'pointer-events':'none'}),label=`${selectedObjects.length} объектов`,bw=Math.max(72,label.length*6.2)/camera.zoom,bh=22/camera.zoom;
      badge.appendChild(svgEl('rect',{x:x0-pad,y:y0-pad-bh-5/camera.zoom,width:bw,height:bh,rx:7/camera.zoom,fill:'#ED591A'}));
      const tx=svgEl('text',{x:x0-pad+7/camera.zoom,y:y0-pad-10/camera.zoom,fill:'#fff','font-size':10.5/camera.zoom,'font-weight':800});tx.textContent=label;badge.appendChild(tx);g.appendChild(badge);
    }
  }

  function translated(orig,dx,dy){
    const o=clone(orig);
    if(['text','formula','note','image','coordinate','graph','attachment'].includes(o.type)){o.x+=dx;o.y+=dy}
    else if(o.type==='path'||o.type==='polygon')o.points=(o.points||[]).map(p=>[p[0]+dx,p[1]+dy]);
    else if(['rect','ellipse','line','arrow','ruler'].includes(o.type)){o.x1+=dx;o.x2+=dx;o.y1+=dy;o.y2+=dy}
    else if(o.type==='compass'||o.type==='arc'){o.cx+=dx;o.cy+=dy}
    else if(o.type==='solid3d'){o.x+=dx;o.y+=dy}
    else if(o.type==='protractor'){o.x+=dx;o.y+=dy}
    return o;
  }

  function scaledToBounds(orig,from,to){
    const o=clone(orig),fw=Math.max(1,from.w),fh=Math.max(1,from.h),tw=Math.max(1,to.w),th=Math.max(1,to.h);
    const sx=tw/fw,sy=th/fh;
    const point=(x,y)=>[to.x+(x-from.x)*sx,to.y+(y-from.y)*sy];
    if(['image','coordinate','graph','note','attachment'].includes(o.type)){
      const [x,y]=point(o.x,o.y);o.x=x;o.y=y;o.w=Math.max(20,(o.w||fw)*sx);o.h=Math.max(20,(o.h||fh)*sy);
    }else if(['text','formula'].includes(o.type)){
      const [x,y]=point(o.x,o.y);o.x=x;o.y=y;o.fontSize=Math.max(10,(o.fontSize||28)*Math.max(.25,Math.min(sx,sy)));
    }else if(o.type==='path'||o.type==='polygon'){
      o.points=(o.points||[]).map(([x,y])=>point(x,y));
    }else if(['rect','ellipse','line','arrow','ruler'].includes(o.type)){
      [o.x1,o.y1]=point(o.x1,o.y1);[o.x2,o.y2]=point(o.x2,o.y2);
    }else if(o.type==='compass'||o.type==='arc'){const [cx,cy]=point(o.cx,o.cy);o.cx=cx;o.cy=cy;o.r=Math.max(8,(o.r||Math.max(from.w,from.h)/2)*Math.max(.25,(sx+sy)/2));
    }else if(o.type==='solid3d'){const [x,y]=point(o.x,o.y);o.x=x;o.y=y;o.w=Math.max(140,(o.w||fw)*sx);o.h=Math.max(120,(o.h||fh)*sy);
    }else if(o.type==='protractor'){const [x,y]=point(o.x,o.y);o.x=x;o.y=y;o.r=Math.max(30,(o.r||from.w/2)*Math.max(.25,sx));
    }
    return o;
  }

  function graphSegments(expr,rangeX=10,rangeY=7,samples=420){
    if(!window.math)throw new Error('Математический движок не загрузился');
    if(!expr||expr.length>120)throw new Error('Слишком длинная функция');
    const code=window.math.compile(expr),rx=Math.max(1,Number(rangeX)||10),ry=Math.max(1,Number(rangeY)||7),count=Math.max(160,Math.min(1400,Math.round(samples)||420));
    const segs=[];let seg=[],prev=null;
    for(let i=0;i<=count;i++){
      const x=-rx+i*(2*rx/count);let y;
      try{y=Number(code.evaluate({x}))}catch{y=NaN}
      const ok=Number.isFinite(y)&&Math.abs(y)<=Math.max(ry*8,80);
      if(!ok){if(seg.length>1)segs.push(seg);seg=[];prev=null;continue}
      if(prev&&Math.abs(y-prev[1])>Math.max(ry*1.7,12)){if(seg.length>1)segs.push(seg);seg=[]}
      seg.push([x,y]);prev=[x,y];
    }
    if(seg.length>1)segs.push(seg);if(!segs.length)throw new Error(`Не удалось построить график на x ∈ [−${Math.round(rx)}; ${Math.round(rx)}]`);return segs;
  }

  async function mountBoard(root,studentId,isTeacher=true,options={}){
    if(!root)throw new Error('Контейнер доски не найден');
    const localOnly=!!options.localOnly;
    const localKey=options.localKey||`mathroom.board.scratch.${S.user?.id||'teacher'}`;
    const assetOwner=localOnly?`scratch/${S.user?.id||'teacher'}`:studentId;
    const normalizeElement=o=>{
      if(!o||typeof o!=='object'||Array.isArray(o)||typeof o.type!=='string')return null;
      const x={...o,id:o.id||uid()};
      if((x.type==='path'||x.type==='polygon')&&!Array.isArray(x.points))x.points=[];
      if(x.type==='solid3d'){
        if(!Array.isArray(x.solidPoints))x.solidPoints=[];
        if(!Array.isArray(x.planes))x.planes=[];
      }
      /* Collaboration metadata is deliberately stored with the object so
         reconnects and cross-device saves preserve authorship/versioning.
         Legacy objects are treated as teacher-owned. */
      x._ownerRole=x._ownerRole||'teacher';
      x._ownerId=String(x._ownerId||x.teacher_id||'teacher');
      x._rev=Math.max(0,Number(x._rev)||0);
      x._updatedAt=Math.max(0,Number(x._updatedAt)||0);
      x._updatedBy=String(x._updatedBy||'');
      return x;
    };
    const normalizePage=(p,i=0)=>{const now=new Date().toISOString(),src=p&&typeof p==='object'&&!Array.isArray(p)?p:{};return {...src,id:src.id||uid(),teacher_id:src.teacher_id||S.user?.id||'',student_id:src.student_id??(localOnly?null:studentId),title:String(src.title||`${localOnly?'Черновик':'Лист'} ${i+1}`),sort_order:Number.isFinite(Number(src.sort_order))?Number(src.sort_order):i,elements:(Array.isArray(src.elements)?src.elements:[]).map(normalizeElement).filter(Boolean),created_at:src.created_at||now,updated_at:src.updated_at||now}};
    const readLocal=()=>{try{const raw=JSON.parse(localStorage.getItem(localKey)||'[]');return Array.isArray(raw)?raw.map(normalizePage):[]}catch(e){console.warn('[Mathroom scratch migrate]',e);try{localStorage.setItem(`${localKey}.broken.${Date.now()}`,localStorage.getItem(localKey)||'')}catch{}return []}};
    const writeLocal=()=>{if(!localOnly)return;try{localStorage.setItem(localKey,JSON.stringify(pages.map((x,i)=>normalizePage({...x,sort_order:i,updated_at:new Date().toISOString()},i))))}catch(e){console.warn('[Mathroom board scratch]',e)}};
    let pages=[];
    if(localOnly){pages=readLocal();if(!pages.length)pages=[normalizePage({title:'Черновик 1',elements:[]},0)];writeLocal()}
    else{const res=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(res.error)throw res.error;pages=(res.data||[]).map(normalizePage);if(!pages.length&&isTeacher){const {data:p,error:e}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title:'Лист 1',sort_order:0}).select().single();if(e)throw e;pages=[normalizePage(p,0)]}}
    if(!pages.length){root.innerHTML='<div class="empty">Доска пока не создана.</div>';return null}

    let current=pages[0],elements=clone(current.elements||[]),tool='pen',color='#15171a',width=3,camera={x:0,y:0,zoom:1},drawing=null,selected=null,selectedIds=new Set(),saveTimer=null,channel=null,pagesChannel=null,grid=true;
    let panStart=null,moveStart=null,resizeStart=null,rotationStart=null,solidRotateStart=null,marqueeSelect=null,clipboardElement=null,transformDirty=false;const undoStack=[],redoStack=[];let busyHistory=false,importBusy=false;
    let snapEnabled=true,laserPoint=null,remoteLaser=null,tempMarks=[],remoteTempMarks=[],focusRect=null,remoteFocusRect=null,focusDraft=null,eraserPoint=null,eraserDown=false,eraserTrail=[],boardFocused=false,compassDraft=null,solidPlanePick=null,remoteCursor=null,lastCursorSent=0,lastViewSent=0,classroomMode=options.permissionMode||'open',followTeacher=options.followTeacher!==false;

    const actorRole=isTeacher?'teacher':'student';
    const actorId=String(isTeacher?(S.user?.id||'teacher'):(studentId||S.user?.id||'student'));
    const actorKey=`${actorRole}:${actorId}`;
    const collabQueueKey=`mathroom.board.pendingOps.${studentId||'local'}.${S.user?.id||actorId}`;
    const offlineSnapshotKey=`mathroom.board.offlineSnapshot.${studentId||'local'}.${S.user?.id||actorId}`;
    let collabBaseline=clone(elements),channelSubscribed=false,lastStateBroadcast=0,lastOpSent=0;
    let pendingOps=[],dbPendingOps=[],deleteJournal=new Map(),remoteLiveStrokes=new Map(),strokeSentIndex=0,lastStrokeSent=0,seenOps=new Set();
    let boardNetworkOnline=navigator.onLine!==false,saveInFlight=false,lastServerSaveAt=0;
    let penActiveUntil=0,touchPointers=new Map(),touchGesture=null;
    try{const q=JSON.parse(localStorage.getItem(collabQueueKey)||'[]');if(Array.isArray(q))pendingOps=q.slice(-800)}catch{}
    const persistPendingOps=()=>{try{if(pendingOps.length)localStorage.setItem(collabQueueKey,JSON.stringify(pendingOps.slice(-800)));else localStorage.removeItem(collabQueueKey)}catch{}};
    const localOwns=o=>!!o&&o._ownerRole===actorRole&&String(o._ownerId||'')===actorId;
    const lastUpdatedByMe=o=>!!o&&o._updatedBy===actorKey;
    const selectionList=()=>{const out=[];if(selected&&elements.some(o=>o.id===selected))out.push(selected);for(const id of selectedIds)if(id!==selected&&elements.some(o=>o.id===id))out.push(id);return out};
    const selectionCount=()=>selectionList().length;
    const selectionHas=id=>!!id&&(selected===id||selectedIds.has(id));
    const clearSelection=()=>{selected=null;selectedIds.clear()};
    const selectOnly=id=>{selected=id||null;selectedIds.clear()};
    const setSelection=ids=>{const clean=[...new Set((ids||[]).filter(id=>elements.some(o=>o.id===id)))];selected=clean[0]||null;selectedIds=new Set(clean.slice(1))};
    const toggleSelection=id=>{if(!id)return;if(selectionHas(id)){const next=selectionList().filter(x=>x!==id);setSelection(next)}else setSelection([...selectionList(),id])};
    const lessonId=options.lessonId||'';const checkpointKey=lessonId?`mathroom.board.checkpoints.${lessonId}`:'';let checkpointTimer=null;
    const templatesKey=`mathroom.board.templates.${S.user?.id||'teacher'}`;const assetLibraryKey=`mathroom.board.assetLibrary.${S.user?.id||'teacher'}`;const scratchStorageKey=`mathroom.teacher.scratch.${S.user?.id||'teacher'}`;const classroomKey=lessonId?`mathroom.board.classroom.${lessonId}`:'';if(isTeacher&&classroomKey){try{const c=JSON.parse(localStorage.getItem(classroomKey)||'null');if(c){classroomMode=c.mode||classroomMode;followTeacher=c.follow!==false}}catch{}}
    const toolPanel=`<div class="board-tools board-tool-groups board-rail">
      <div class="board-quick-tools board-rail-quick board-rail-main">
        <button class="btn sm board-icon-btn board-rail-primary" data-tool="select" title="Выбор · протяни рамку вокруг нескольких объектов · Shift+клик добавляет объект" aria-label="Выбор">${uiIcon('cursor')}</button>
        <button class="btn sm board-icon-btn board-rail-primary" data-tool="hand" title="Рука / перемещение" aria-label="Рука">${uiIcon('hand')}</button>
      </div>
      <details class="board-tool-group" data-category="write"><summary title="Ручка и письмо" aria-label="Ручка и письмо"><span class="board-rail-icon">${uiIcon('pen')}</span></summary><div class="board-tool-popover"><div class="board-popover-head"><div><div class="board-popover-title">Письмо</div><div class="board-popover-subtitle">Рисование и заметки на доске</div></div></div><div class="board-action-grid board-writing-grid"><button class="btn sm active" data-tool="pen">${uiIcon('pen')} <span>Ручка</span></button><button class="btn sm" data-tool="pencil">${uiIcon('pencil')} <span>Карандаш</span></button>${isTeacher?`<button class="btn sm" data-tool="marker">${uiIcon('marker')} <span>Маркер 5с</span></button>`:''}<button class="btn sm" data-tool="text">${uiIcon('text')} <span>Текст</span></button><button class="btn sm" data-tool="note">${uiIcon('note')} <span>Заметка</span></button></div><div class="board-tool-row board-style-row"><div class="board-color-row"><button class="color-dot active" data-color="#15171a" style="background:#15171a" title="Чёрный"></button><button class="color-dot" data-color="#ED591A" style="background:#ED591A" title="Котоматика · оранжевый"></button><button class="color-dot" data-color="#2563eb" style="background:#2563eb" title="Синий"></button><button class="color-dot" data-color="#dc2626" style="background:#dc2626" title="Красный"></button><button class="color-dot" data-color="#15803d" style="background:#15803d" title="Зелёный"></button></div><select id="strokeWidth" class="board-select board-width-select" title="Толщина"><option value="2">Тонко</option><option value="3" selected>Обычно</option><option value="6">Толсто</option></select></div></div></details>
      <button class="btn sm board-icon-btn board-rail-action" data-tool="eraser" id="eraserRail" title="Ластик · E" aria-label="Ластик">${uiIcon('eraser')}</button>
      <details class="board-tool-group" data-category="geometry"><summary title="Геометрия" aria-label="Геометрия"><span class="board-rail-icon">${uiIcon('compass')}</span></summary><div class="board-tool-popover"><div class="board-popover-head"><div><div class="board-popover-title">Геометрия</div><div class="board-popover-subtitle">Инструменты построения</div></div></div><div class="board-action-grid board-geometry-grid"><button class="btn sm" data-tool="line">${uiIcon('line')} <span>Линия</span></button><button class="btn sm" data-tool="arrow">${uiIcon('arrow')} <span>Стрелка</span></button>${isTeacher?`<button class="btn sm" data-tool="ruler">${uiIcon('ruler')} <span>Линейка</span></button><button class="btn sm" data-tool="compass">${uiIcon('compass')} <span>Циркуль</span></button><button class="btn sm" id="protractorTool">${uiIcon('protractor')} <span>Транспортир</span></button>`:''}</div><p class="board-tool-help">Циркуль: кликни центр → кликни радиус → веди дугу по окружности → кликни конец.</p></div></details>
      ${isTeacher?`<details class="board-tool-group" data-category="shapes"><summary title="Фигуры" aria-label="Фигуры"><span class="board-rail-icon">${uiIcon('shapes')}</span></summary><div class="board-tool-popover board-shapes-popover"><div class="board-popover-head"><div><div class="board-popover-title">Фигуры</div><div class="board-popover-subtitle">Планиметрия и стереометрия</div></div></div><div class="board-palette-section"><b>Планиметрия</b><div class="board-palette-grid">${shapePalette.map(shapeTile).join('')}</div></div><div class="board-palette-section"><b>3D фигуры</b><div class="board-palette-grid board-palette-3d">${solidPalette.map(solidTile).join('')}</div></div><div class="board-solid-help">Выбери 3D фигуру. Все инструменты — вращение, точки, плоскость и размер — появятся рядом только после выбора фигуры на доске.</div></div></details><details class="board-tool-group" data-category="insert"><summary title="Вставка" aria-label="Вставка"><span class="board-rail-icon">${uiIcon('insert')}</span></summary><div class="board-tool-popover"><div class="board-popover-head"><div><div class="board-popover-title">Вставка</div><div class="board-popover-subtitle">Материалы, графики и файлы</div></div></div><div class="board-action-grid"><button class="btn sm" id="formulaTool">${uiIcon('formula')} <span>Формула</span></button><button class="btn sm" id="coordinatePlane">${uiIcon('coords')} <span>Координаты</span></button><button class="btn sm" id="functionGraph">${uiIcon('graph')} <span>График</span></button><button class="btn sm" id="templatesBoard">${uiIcon('template')} <span>Шаблоны</span></button><button class="btn sm" id="assetLibrary">${uiIcon('library')} <span>Материалы</span></button><button class="btn sm" id="screenCapture">${uiIcon('screenshot')} <span>Снимок</span></button><button class="btn sm" id="importBoard">${uiIcon('upload')} <span>Файл</span></button><input id="boardFile" type="file" accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv" hidden><button class="btn sm" id="pasteSystemClipboard">${uiIcon('paste')} <span>Буфер</span></button><button class="btn sm" id="cropImage" disabled>${uiIcon('crop')} <span>Обрезать</span></button></div></div></details>
      <details class="board-tool-group" data-category="lesson"><summary title="Урок" aria-label="Урок"><span class="board-rail-icon">${uiIcon('lesson')}</span></summary><div class="board-tool-popover"><div class="board-popover-head"><div><div class="board-popover-title">Урок</div><div class="board-popover-subtitle">Управление вниманием ученика</div></div></div><div class="board-action-grid"><button class="btn sm" data-tool="laser">${uiIcon('laser')} <span>Лазер</span></button><button class="btn sm" data-tool="focus">${uiIcon('focus')} <span>Фокус</span></button><button class="btn sm" id="toggleHidden" disabled>${uiIcon('eyeOff')} <span>Скрыть ученику</span></button><button class="btn sm" id="revealHidden">${uiIcon('eye')} <span>Показать скрытое</span></button><button class="btn sm" id="clearFocus">${uiIcon('close')} <span>Снять фокус</span></button></div></div></details>`:''}
      <details class="board-tool-group" data-category="more"><summary title="Ещё" aria-label="Ещё"><span class="board-rail-icon">${uiIcon('more')}</span></summary><div class="board-tool-popover board-more-popover"><div class="board-popover-head"><div><div class="board-popover-title">Действия с доской</div><div class="board-popover-subtitle">Объекты, листы и отображение</div></div></div><div class="board-action-grid board-more-grid"><button class="btn sm" id="copySelected" disabled title="Скопировать объект в буфер доски — затем можно вставить одну или несколько копий">${uiIcon('copy')} <span>Копировать</span></button><button class="btn sm" id="pasteSelected" disabled>${uiIcon('paste')} <span>Вставить</span></button><button class="btn sm" id="duplicateSelected" disabled title="Сразу создать рядом копию выбранного объекта">${uiIcon('duplicate')} <span>Дубликат</span></button><button class="btn sm" id="lockSelected" disabled>${uiIcon('pin')} <span>Закрепить</span></button><button class="btn sm" id="bringFront" disabled>${uiIcon('front')} <span>На передний план</span></button><button class="btn sm" id="sendBack" disabled>${uiIcon('back')} <span>На задний план</span></button><button class="btn sm danger" id="deleteSelected" disabled>${uiIcon('trash')} <span>Удалить</span></button><button class="btn sm" id="gridToggle">${uiIcon('grid')} <span>Сетка</span></button><button class="btn sm active" id="snapToggle">${uiIcon('magnet')} <span>Магниты</span></button><button class="btn sm" id="fitView">${uiIcon('fit')} <span>Показать всё</span></button>${isTeacher?`<button class="btn sm" id="boardBackground">${uiIcon('background')} <span>Фон</span></button><button class="btn sm" id="duplicatePage">${uiIcon('pageCopy')} <span>Дублировать лист</span></button><button class="btn sm" id="exportPagePng"><span class="board-file-badge">PNG</span> <span>Лист</span></button><button class="btn sm" id="exportAllPdf"><span class="board-file-badge">PDF</span> <span>Доска</span></button><button class="btn sm" id="boardHistory">${uiIcon('history')} <span>История</span></button>${lessonId?`<button class="btn sm" id="resetLessonStart">${uiIcon('reset')} <span>К началу</span></button>`:''}${!localOnly?`<button class="btn sm" id="toScratch">${uiIcon('right')} <span>В черновик</span></button><button class="btn sm" id="fromScratch">${uiIcon('left')} <span>Из черновика</span></button>`:''}<button class="btn sm" id="renamePage">${uiIcon('edit')} <span>Переименовать</span></button>`:''}</div></div></details>
      ${isTeacher?`<div class="board-rail-divider board-rail-divider-bottom"></div><button class="btn sm board-icon-btn board-rail-action board-rail-clear danger" id="clearBoard" title="Очистить текущий лист" aria-label="Очистить лист">${uiIcon('trash')}</button>`:''}
    </div>`;
    root.innerHTML=`<div class="board-card"><div class="board-head"><div class="board-head-title"><strong>${localOnly?'Черновик':'Доска'}</strong><span class="board-status" id="boardStatus">${localOnly?'Локальный черновик':'Подключение…'}</span></div><div class="board-head-actions">${isTeacher&&lessonId?`<button class="btn sm ${followTeacher?'active':''}" id="followTeacherToggle">${uiIcon('focus')} <span>Ведение</span></button><select class="board-select board-permission-select" id="studentBoardMode" title="Права ученика"><option value="open" ${classroomMode==='open'?'selected':''}>Ученик: всё</option><option value="pen" ${classroomMode==='pen'?'selected':''}>Только писать</option><option value="view" ${classroomMode==='view'?'selected':''}>Просмотр</option></select>`:''}<span class="board-head-sep" aria-hidden="true"></span><button class="btn sm board-head-icon" id="undo" title="Отменить · Ctrl+Z">${uiIcon('undo')}<span class="board-head-label">Назад</span></button><button class="btn sm board-head-icon" id="redo" title="Вернуть · Ctrl+Y / Ctrl+Shift+Z">${uiIcon('redo')}<span class="board-head-label">Вперёд</span></button>${isTeacher?`<span class="board-head-sep" aria-hidden="true"></span><button class="btn sm board-head-icon" id="bringForward" disabled title="Поднять выбранный объект на один слой">${uiIcon('up')}<span class="board-head-label">Выше</span></button><button class="btn sm board-head-icon" id="sendBackward" disabled title="Опустить выбранный объект на один слой">${uiIcon('down')}<span class="board-head-label">Ниже</span></button><span class="board-head-sep" aria-hidden="true"></span><button class="btn sm board-head-icon" id="addPage" title="Создать новый лист">${uiIcon('plus')}<span class="board-head-label">Новый</span></button><button class="btn sm board-head-icon danger" id="delPage" title="Удалить текущий лист">${uiIcon('trash')}<span class="board-head-label">Удалить лист</span></button>`:''}<span class="board-head-sep" aria-hidden="true"></span><button class="btn sm board-shortcuts-btn" id="quickCommands" title="Показать быстрые команды">⌨ <span>Команды</span></button><button class="btn sm board-fullscreen-btn" id="fullscreen">${uiIcon('fullscreen')} <span>На весь экран</span></button></div></div><div class="board-page-tabs" id="pageTabs"></div><div class="board-stage" id="stage"><aside class="board-toolbar board-toolbar-side">${toolPanel}</aside><svg id="boardSvg"></svg><div class="board-object-hud" id="objectHud" hidden><button type="button" class="btn sm" data-object-action="duplicate" title="Дублировать">${uiIcon('duplicate')}</button><button type="button" class="btn sm" data-object-action="lock" title="Закрепить">${uiIcon('pin')}</button><button type="button" class="btn sm" data-object-action="front" title="На передний план">${uiIcon('front')}</button><button type="button" class="btn sm" data-object-action="back" title="На задний план">${uiIcon('back')}</button><button type="button" class="btn sm" data-object-action="fill" title="Заливка">${uiIcon('fill')}</button><button type="button" class="btn sm" data-object-action="edit" title="Редактировать">${uiIcon('edit')}</button><button type="button" class="btn sm danger" data-object-action="delete" title="Удалить">${uiIcon('trash')}</button></div><div class="board-follow-badge" id="followBadge" hidden>${uiIcon('focus')} Следуем за преподавателем</div><div class="board-solid-hud" id="solidHud" hidden><button type="button" class="btn sm" data-solid-hud="rotate" title="Вращать 3D">${uiIcon('rotate')}</button><button type="button" class="btn sm" data-solid-hud="point" title="Поставить точку">${uiIcon('point')}</button><button type="button" class="btn sm" data-solid-hud="plane" title="Плоскость по трём точкам">${uiIcon('plane')}</button><span class="board-solid-hud-sep"></span><button type="button" class="btn sm" data-solid-hud="smaller" title="Уменьшить">${uiIcon('minus')}</button><button type="button" class="btn sm" data-solid-hud="larger" title="Увеличить">${uiIcon('plus')}</button><button type="button" class="btn sm" data-solid-hud="reset" title="Стандартный вид">${uiIcon('home')}</button><button type="button" class="btn sm danger" data-solid-hud="clear" title="Удалить точки и плоскости">${uiIcon('trash')}</button></div><div class="board-floating"><button class="btn sm" id="zoomOut" title="Уменьшить">${uiIcon('minus')}</button><span class="btn sm" id="zoomLabel">100%</span><button class="btn sm" id="zoomIn" title="Увеличить">${uiIcon('plus')}</button><button class="btn sm" id="homeView" title="Сбросить вид">${uiIcon('home')}</button></div></div><div class="board-hint">Выбор: протяни рамку вокруг нескольких объектов · Shift+клик — добавить/убрать · Ctrl+Z — отменить · Space + drag — перемещение</div></div>`;
    const svg=root.querySelector('#boardSvg'),status=root.querySelector('#boardStatus'),pageTabs=root.querySelector('#pageTabs'),zoomLabel=root.querySelector('#zoomLabel'),stage=root.querySelector('#stage'),solidHud=root.querySelector('#solidHud'),objectHud=root.querySelector('#objectHud'),followBadge=root.querySelector('#followBadge');
    const boardCard=root.querySelector('.board-card');if(boardCard){boardCard.tabIndex=0;boardCard.setAttribute('aria-label','Интерактивная доска Mathroom')};
    function openQuickCommands(){
      const row=(keys,label,note='')=>`<div style="display:grid;grid-template-columns:minmax(130px,auto) 1fr;gap:14px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)"><div><kbd style="display:inline-flex;align-items:center;min-height:30px;padding:5px 9px;border:1px solid #cfd4dc;border-bottom-width:2px;border-radius:8px;background:#f7f8fa;font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap">${keys}</kbd></div><div><b style="font-size:13px">${label}</b>${note?`<div class="small muted" style="margin-top:3px">${note}</div>`:''}</div></div>`;
      const common=[
        ['Ctrl/⌘ + Z','Отменить последнее действие'],
        ['Ctrl/⌘ + Y','Вернуть действие'],
        ['Ctrl/⌘ + Shift + Z','Вернуть действие','Альтернативная комбинация для macOS и части браузеров'],
        ['V','Выбор объектов'],
        ['P','Перо'],
        ['K','Карандаш'],
        ['E','Ластик'],
        ['T','Текст'],
        ['L','Линия'],
        ['H','Рука / перемещение'],
        ['G','Включить или выключить сетку'],
        ['Space + drag','Временно перемещать доску рукой'],
        ['Shift + клик','Добавить или убрать объект из выделения'],
        ['Delete / Backspace','Удалить выбранный объект'],
        ['Ctrl/⌘ + C','Скопировать выбранное']
      ];
      const teacher=[
        ['Ctrl/⌘ + V','Вставить из системного буфера','Текст или изображение'],
        ['F','Фокус области'],
        ['R','Линейка'],
        ['M','Маркер'],
        ['X','Лазерная указка'],
        ['C','Циркуль'],
        ['Alt + K','Быстрые команды преподавателя','Работает в кабинете и во время урока'],
        ['Alt + M','Микрофон'],
        ['Alt + V','Камера'],
        ['Alt + S','Демонстрация экрана'],
        ['Alt + ← / →','Предыдущая / следующая задача','Во время урока'],
        ['Alt + 1','Отметить текущую задачу: решено'],
        ['Alt + 2','Отметить текущую задачу: сложно'],
        ['Alt + 3','Вернуться к задаче позже'],
        ['Alt + 0','Сбросить статус текущей задачи']
      ];
      const html=`<div class="mr-card-head"><div><span class="pill">Клавиатура</span><h2 style="margin:8px 0 4px">Быстрые команды</h2><p class="muted">Сочетания работают, когда активна доска. Кликни по доске перед использованием команды.</p></div></div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin-top:16px">
          <section><h3 style="margin:0 0 8px">Доска</h3>${common.map(x=>row(...x)).join('')}</section>
          ${isTeacher?`<section><h3 style="margin:0 0 8px">Преподаватель и урок</h3>${teacher.map(x=>row(...x)).join('')}</section>`:''}
        </div>
        <div class="notice" style="margin-top:16px">Русская или английская раскладка не важна для инструментов доски: Mathroom ориентируется на физическую клавишу.</div>`;
      return modal(html,'wide-modal');
    }

    let fileDragDepth=0;
    const isFileDrag=e=>!!e&&Array.from(e.dataTransfer?.types||[]).includes('Files');
    const clearDragOverlay=()=>{fileDragDepth=0;stage?.classList.remove('drag-active')};

    const needAsset=path=>{if(!path||assetCache.has(path)||assetPending.has(path))return;ensureAsset(path).then(()=>render())};
    const visibleElements=()=>elements.filter(o=>isTeacher||!o.teacherOnly);
    function objectCenter(o){const b=bounds(o);return{x:b.x+b.w/2,y:b.y+b.h/2}}
    function geometrySnapPoint(x,y,excludeId=''){if(!snapEnabled)return[x,y];const excluded=new Set(Array.isArray(excludeId)?excludeId:[excludeId].filter(Boolean));let sx=Math.round(x/10)*10,sy=Math.round(y/10)*10,best=14/camera.zoom;for(const o of elements){if(excluded.has(o.id)||(!isTeacher&&o.teacherOnly))continue;const b=bounds(o),pts=[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h],[b.x+b.w/2,b.y+b.h/2]];for(const p of pts){const d=Math.hypot(x-p[0],y-p[1]);if(d<best){best=d;sx=p[0];sy=p[1]}}}return[sx,sy]}
    function drawTransient(){
      const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);const now=Date.now();
      tempMarks=tempMarks.filter(x=>x.expires>now);remoteTempMarks=remoteTempMarks.filter(x=>x.expires>now);
      for(const m of [...remoteTempMarks,...tempMarks])g.appendChild(svgEl('path',{d:smoothPathD(m.points||[]),fill:'none',stroke:m.color||'#f59e0b','stroke-width':m.width||12,'stroke-linecap':'round','stroke-linejoin':'round','shape-rendering':'geometricPrecision',opacity:.45}));

      for(const [id,s] of [...remoteLiveStrokes]){
        if((s.expires||0)<=now){remoteLiveStrokes.delete(id);continue}
        g.appendChild(svgEl('path',{d:smoothPathD(s.points||[]),fill:'none',stroke:s.color||'#15171a','stroke-width':s.width||3,'stroke-linecap':'round','stroke-linejoin':'round','shape-rendering':'geometricPrecision',opacity:s.opacity==null?1:s.opacity,'pointer-events':'none'}));
      }

      if(remoteCursor&&remoteCursor.expires>now){
        const x=remoteCursor.x,y=remoteCursor.y,accent=remoteCursor.role==='teacher'?'#ED591A':'#2563eb';
        g.appendChild(svgEl('circle',{cx:x,cy:y,r:5/camera.zoom,fill:accent,stroke:'#fff','stroke-width':1.5/camera.zoom,'pointer-events':'none'}));
        const label=String(remoteCursor.label||'Участник').slice(0,24),bw=Math.max(54,label.length*6.4+16)/camera.zoom,bh=22/camera.zoom;
        g.appendChild(svgEl('rect',{x:x+9/camera.zoom,y:y+8/camera.zoom,width:bw,height:bh,rx:7/camera.zoom,fill:accent,opacity:.94,'pointer-events':'none'}));
        const tx=svgEl('text',{x:x+17/camera.zoom,y:y+23/camera.zoom,fill:'#fff','font-size':10.5/camera.zoom,'font-weight':800,'font-family':'Inter,Arial,sans-serif','pointer-events':'none'});tx.textContent=label;g.appendChild(tx);
      }

      for(const p of [remoteLaser,laserPoint].filter(Boolean)){g.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:9/camera.zoom,fill:'#ef4444',opacity:.9}));g.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:18/camera.zoom,fill:'none',stroke:'#ef4444','stroke-width':2/camera.zoom,opacity:.35}))}
      const f=remoteFocusRect||focusRect;if(f){const x0=f.x,y0=f.y,x1=f.x+f.w,y1=f.y+f.h,M=100000,attrs={fill:'#0f172a',opacity:.56,'pointer-events':'none'};g.appendChild(svgEl('rect',{x:-M,y:-M,width:2*M,height:y0+M,...attrs}));g.appendChild(svgEl('rect',{x:-M,y:y1,width:2*M,height:M-y1,...attrs}));g.appendChild(svgEl('rect',{x:-M,y:y0,width:x0+M,height:Math.max(0,f.h),...attrs}));g.appendChild(svgEl('rect',{x:x1,y:y0,width:M-x1,height:Math.max(0,f.h),...attrs}));g.appendChild(svgEl('rect',{x:x0,y:y0,width:f.w,height:f.h,fill:'none',stroke:'#fff','stroke-width':2/camera.zoom,'stroke-dasharray':`${7/camera.zoom} ${5/camera.zoom}`}))}

      if(tool==='eraser'&&eraserTrail.length>1)g.appendChild(svgEl('path',{d:smoothPathD(eraserTrail),fill:'none',stroke:'#ef4444','stroke-width':36/camera.zoom,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.10,'pointer-events':'none'}));
      if(tool==='eraser'&&eraserPoint){const rr=18/camera.zoom;g.appendChild(svgEl('circle',{cx:eraserPoint.x,cy:eraserPoint.y,r:rr,fill:'rgba(255,255,255,.78)',stroke:'#ef4444','stroke-width':1.8/camera.zoom,'pointer-events':'none'}));g.appendChild(svgEl('circle',{cx:eraserPoint.x,cy:eraserPoint.y,r:3/camera.zoom,fill:'#ef4444',opacity:.55,'pointer-events':'none'}))}
      if(marqueeSelect){const x=Math.min(marqueeSelect.x0,marqueeSelect.x1),y=Math.min(marqueeSelect.y0,marqueeSelect.y1),w=Math.abs(marqueeSelect.x1-marqueeSelect.x0),h=Math.abs(marqueeSelect.y1-marqueeSelect.y0);g.appendChild(svgEl('rect',{x,y,width:w,height:h,rx:5/camera.zoom,fill:'#ED591A',opacity:.08,stroke:'#ED591A','stroke-width':1.5/camera.zoom,'stroke-dasharray':`${6/camera.zoom} ${4/camera.zoom}`,'pointer-events':'none'}))}
    }
    function syncSelectionButtons(){
      const idsNow=selectionList(),objs=idsNow.map(id=>elements.find(x=>x.id===id)).filter(Boolean),count=objs.length,obj=count===1?objs[0]:null,has=count>0,lockedAny=objs.some(x=>x.locked),allLocked=has&&objs.every(x=>x.locked);
      const ids=['copySelected','duplicateSelected','lockSelected','bringForward','sendBackward','bringFront','sendBack','deleteSelected'];
      ids.forEach(id=>{const b=root.querySelector('#'+id);if(!b)return;b.disabled=!has||(lockedAny&&!['lockSelected','copySelected'].includes(id))||(count>1&&['bringForward','sendBackward','bringFront','sendBack'].includes(id))});
      if(count===1&&!obj.locked){
        const movable=elements.filter(x=>x.type!=='board-bg'),pos=movable.findIndex(x=>x.id===selected),last=movable.length-1;
        const up=root.querySelector('#bringForward'),down=root.querySelector('#sendBackward'),front=root.querySelector('#bringFront'),back=root.querySelector('#sendBack');
        if(up)up.disabled=pos<0||pos>=last;if(front)front.disabled=pos<0||pos>=last;if(down)down.disabled=pos<=0;if(back)back.disabled=pos<=0;
      }
      const pp=root.querySelector('#pasteSelected'),h=root.querySelector('#toggleHidden'),cr=root.querySelector('#cropImage'),lb=root.querySelector('#lockSelected');
      if(!isTeacher)['lockSelected','bringForward','sendBackward','bringFront','sendBack'].forEach(id=>{const b=root.querySelector('#'+id);if(b)b.hidden=true});
      if(pp)pp.disabled=!clipboardElement;
      if(lb&&has)lb.innerHTML=allLocked?`${uiIcon('unlock')} <span>Разблокировать${count>1?' всё':''}</span>`:`${uiIcon('pin')} <span>Закрепить${count>1?' всё':''}</span>`;
      if(h){h.disabled=!has;const allHidden=has&&objs.every(x=>x.teacherOnly);h.innerHTML=allHidden?`${uiIcon('eye')} <span>Показать${count>1?' выбранное':''}</span>`:`${uiIcon('eyeOff')} <span>Скрыть${count>1?' выбранное':''}</span>`}
      if(cr)cr.disabled=!(count===1&&obj?.type==='image')||!!obj?.locked;
    }
    function syncHistoryButtons(){const u=root.querySelector('#undo'),r=root.querySelector('#redo');if(u){u.disabled=!undoStack.length;u.title=undoStack.length?'Отменить последнее действие · Ctrl+Z':'Нечего отменять'}if(r){r.disabled=!redoStack.length;r.title=redoStack.length?'Вернуть действие · Ctrl+Y':'Нечего возвращать'}}
    function syncSolidHud(){
      if(!solidHud||!stage||selectionCount()!==1){if(solidHud)solidHud.hidden=true;return}const o=elements.find(x=>x.id===selected&&x.type==='solid3d');if(!o){solidHud.hidden=true;return}
      solidHud.hidden=false;const b=bounds(o),r=stage.getBoundingClientRect(),left=(b.x-camera.x+b.w)*camera.zoom+12,top=(b.y-camera.y)*camera.zoom;
      const hw=Math.max(250,solidHud.offsetWidth||250),hh=Math.max(44,solidHud.offsetHeight||44),minLeft=82;
      solidHud.style.left=`${Math.max(minLeft,Math.min(Math.max(minLeft,r.width-hw-10),left))}px`;
      solidHud.style.top=`${Math.max(10,Math.min(Math.max(10,r.height-hh-10),top))}px`;
    }
    function currentBackground(){return elements.find(x=>x.type==='board-bg')||null}
    function applyBackground(){
      if(!stage)return;const bg=currentBackground(),kind=bg?.kind||'blank';
      stage.dataset.boardBg=kind;stage.style.setProperty('--board-bg-color',bg?.color||'#ffffff');
    }
    function canUseTool(v){
      if(isTeacher)return true;
      if(classroomMode==='view')return v==='hand';
      if(classroomMode==='pen')return ['pen','pencil','eraser','hand'].includes(v);
      return true;
    }
    function canMutateObject(o){
      if(!o||o.locked)return false;
      if(isTeacher)return true;
      if(classroomMode==='view')return false;
      if(classroomMode==='pen')return localOwns(o);
      return true;
    }
    function canTransformObject(o){return canMutateObject(o)}
    function eraserHitAllowed(x,y,eraserR){
      for(let i=elements.length-1;i>=0;i--){
        const o=elements[i];
        if(o?.teacherOnly&&!isTeacher)continue;
        if(!canMutateObject(o))continue;
        if(eraserHitsObject(o,x,y,eraserR))return o;
      }
      return null;
    }
    function syncObjectHud(){
      if(!objectHud||!stage||selectionCount()!==1){if(objectHud)objectHud.hidden=true;return}const o=elements.find(x=>x.id===selected&&x.type!=='board-bg');if(!o){objectHud.hidden=true;return}
      const editable=['text','formula','graph','note'].includes(o.type),b=bounds(o),r=stage.getBoundingClientRect(),w=Math.max(190,objectHud.offsetWidth||190),h=Math.max(40,objectHud.offsetHeight||40);
      objectHud.hidden=false;objectHud.classList.toggle('locked',!!o.locked);objectHud.style.left=`${Math.max(72,Math.min(Math.max(72,r.width-w-8),(b.x-camera.x)*camera.zoom))}px`;objectHud.style.top=`${Math.max(8,Math.min(Math.max(8,r.height-h-8),(b.y-camera.y)*camera.zoom-h-10))}px`;
      const lock=objectHud.querySelector('[data-object-action="lock"]'),edit=objectHud.querySelector('[data-object-action="edit"]'),fill=objectHud.querySelector('[data-object-action="fill"]');if(lock){lock.textContent=o.locked?'🔓':'🔒';lock.title=o.locked?'Разблокировать':'Закрепить объект';lock.hidden=!isTeacher}if(edit)edit.hidden=!editable||o.locked;if(fill)fill.hidden=o.locked||!['rect','ellipse','polygon','note'].includes(o.type);
      objectHud.querySelectorAll('[data-object-action]').forEach(b=>{if(!isTeacher&&['lock','front','back','delete','duplicate'].includes(b.dataset.objectAction))b.hidden=true});
    }
    function setBackground(kind='blank',color='#ffffff'){
      if(!isTeacher)return;pushElementsHistory();elements=elements.filter(x=>x.type!=='board-bg');elements.unshift({id:uid(),type:'board-bg',kind,color,locked:true});changed();toast('Фон доски изменён');
    }
    function openBackgroundPicker(){
      const bg=currentBackground(),m=modal(`<h2>Фон доски</h2><p class="muted">Фон синхронизируется вместе с листом.</p><div class="board-background-grid"><button data-bg="blank">Белый</button><button data-bg="dots">Точки</button><button data-bg="grid">Клетка</button><button data-bg="lines">Линии</button><button data-bg="cream">Тёплый</button></div><div class="field"><label>Свой цвет</label><input id="boardBgColor" type="color" value="${bg?.color||'#ffffff'}"></div><button class="btn" id="applyBgColor">Применить цвет</button>`);
      m.querySelectorAll('[data-bg]').forEach(b=>b.onclick=()=>{setBackground(b.dataset.bg,b.dataset.bg==='cream'?'#fffaf2':'#ffffff');m.remove()});m.querySelector('#applyBgColor').onclick=()=>{setBackground('color',m.querySelector('#boardBgColor').value);m.remove()};
    }
    function duplicateSelected(){const ids=selectionList(),objs=ids.map(id=>elements.find(x=>x.id===id)).filter(o=>o&&o.type!=='board-bg');if(!objs.length)return;if(objs.some(o=>o.locked)&&!isTeacher)return;pushElementsHistory();const created=[];for(const o of objs){const c=translated(o,32/camera.zoom,32/camera.zoom);c.id=uid();c.locked=false;elements.push(c);created.push(c.id)}setSelection(created);changed();toast(created.length>1?`${created.length} объектов продублировано`:'Объект продублирован')}
    function toggleLockSelected(){if(!isTeacher)return;const ids=selectionList();if(!ids.length)return;const objs=ids.map(id=>elements.find(x=>x.id===id)).filter(Boolean),lock=!objs.every(o=>o.locked);pushElementsHistory();elements=elements.map(o=>ids.includes(o.id)?{...o,locked:lock}:o);changed();toast(ids.length>1?(lock?'Выбранные объекты закреплены':'Выбранные объекты разблокированы'):(lock?'Объект закреплён':'Объект разблокирован'))}
    function reorderSelected(mode){
      if(!isTeacher||!selected)return;
      const i=elements.findIndex(x=>x.id===selected),o=elements[i];
      if(i<0||!o||o.type==='board-bg')return;
      if(o.locked)return toast('Объект закреплён · сначала разблокируйте');
      const movable=elements.map((x,idx)=>({x,idx})).filter(v=>v.x.type!=='board-bg');
      const pos=movable.findIndex(v=>v.x.id===selected);
      if(pos<0)return;
      let targetPos=pos;
      if(mode==='forward')targetPos=Math.min(movable.length-1,pos+1);
      if(mode==='backward')targetPos=Math.max(0,pos-1);
      if(mode==='front')targetPos=movable.length-1;
      if(mode==='back')targetPos=0;
      if(targetPos===pos){
        toast(mode==='forward'||mode==='front'?'Объект уже выше всех':'Объект уже ниже всех');
        return;
      }
      pushElementsHistory();
      const backgrounds=elements.filter(x=>x.type==='board-bg');
      const ordered=movable.map(v=>v.x);
      const [moving]=ordered.splice(pos,1);
      ordered.splice(targetPos,0,moving);
      elements=[...backgrounds,...ordered];
      changed();
      toast(mode==='forward'?'Объект поднят на один слой':mode==='backward'?'Объект опущен на один слой':mode==='front'?'Объект на переднем плане':'Объект на заднем плане');
    }
    function editSelected(){const i=elements.findIndex(x=>x.id===selected),o=elements[i];if(i<0||o.locked||(!isTeacher&&classroomMode!=='open'))return;if(o.type==='text'||o.type==='note'){const v=prompt(o.type==='note'?'Текст заметки:':'Текст:',o.text||'');if(v==null)return;pushElementsHistory();elements[i]={...o,text:v};changed()}else if(o.type==='formula'){const v=prompt('Формула:',o.source||o.text||'');if(v==null)return;pushElementsHistory();elements[i]={...o,source:v,text:prettyFormula(v)};changed()}else if(o.type==='graph'){const v=prompt('Функция y =',o.expression||'');if(v==null)return;try{graphSegments(v);pushElementsHistory();elements[i]={...o,expression:v};changed()}catch(e){fail(e)}}}
    function fillSelected(){const i=elements.findIndex(x=>x.id===selected),o=elements[i];if(i<0||o.locked||!['rect','ellipse','polygon','note'].includes(o.type))return toast('Заливка доступна для фигур и заметок');const m=modal(`<h2>Заливка объекта</h2><div class="board-fill-swatches"><button data-fill="none">Без заливки</button><button data-fill="#fff3bf" style="background:#fff3bf">Жёлтая</button><button data-fill="#ffe6d5" style="background:#ffe6d5">Оранжевая</button><button data-fill="#dbeafe" style="background:#dbeafe">Синяя</button><button data-fill="#dcfce7" style="background:#dcfce7">Зелёная</button></div><div class="field"><label>Свой цвет</label><input type="color" id="customFill" value="${o.fill&&o.fill!=='none'?o.fill:'#fff3bf'}"></div><button class="btn" id="applyCustomFill">Применить</button>`);const apply=v=>{pushElementsHistory();elements[i]={...elements[i],fill:v};m.remove();changed()};m.querySelectorAll('[data-fill]').forEach(b=>b.onclick=()=>apply(b.dataset.fill));m.querySelector('#applyCustomFill').onclick=()=>apply(m.querySelector('#customFill').value)}
    async function duplicateCurrentPage(){if(!isTeacher)return;await save();const p=await createPage(`${current.title||'Лист'} · копия`,clone(elements));await switchPage(p.id)}
    async function moveCurrentPage(delta){if(!isTeacher||pages.length<2)return;await save();const i=pages.findIndex(x=>x.id===current.id),j=Math.max(0,Math.min(pages.length-1,i+delta));if(i===j)return;const [p]=pages.splice(i,1);pages.splice(j,0,p);pages.forEach((x,k)=>x.sort_order=k);if(localOnly)writeLocal();else{const rs=await Promise.all(pages.map(x=>sb.from('board_pages').update({sort_order:x.sort_order}).eq('id',x.id)));const er=rs.find(x=>x.error)?.error;if(er)return fail(er)}renderTabs();pagesChanged();toast('Порядок листов изменён')}
    function persistClassroom(){if(!isTeacher||!classroomKey)return;try{localStorage.setItem(classroomKey,JSON.stringify({mode:classroomMode,follow:followTeacher}))}catch{}broadcastTransient('classroom',{mode:classroomMode,follow:followTeacher});pagesChannel?.send({type:'broadcast',event:'classroom',payload:{mode:classroomMode,follow:followTeacher,pageId:current?.id,camera:{...camera}}}).catch(()=>{})}
    function syncClassroomUi(){const sel=root.querySelector('#studentBoardMode'),btn=root.querySelector('#followTeacherToggle');if(sel)sel.value=classroomMode;if(btn){btn.classList.toggle('active',followTeacher);btn.querySelector('span')&&(btn.querySelector('span').textContent=followTeacher?'Ведение: вкл':'Ведение: выкл')}if(!isTeacher)root.querySelectorAll('[data-tool]').forEach(b=>b.disabled=!canUseTool(b.dataset.tool));if(followBadge)followBadge.hidden=isTeacher||!followTeacher||!lessonId}
    function sendViewport(force=false){if(!isTeacher||!followTeacher||!channel)return;const now=Date.now();if(!force&&now-lastViewSent<60)return;lastViewSent=now;broadcastTransient('viewport',{camera:{...camera}})}
    function sendCursor(x,y){
      if(localOnly||!channelSubscribed||!Number.isFinite(x)||!Number.isFinite(y))return;
      const now=Date.now();if(now-lastCursorSent<45)return;lastCursorSent=now;
      broadcastTransient('cursor',{point:{x,y},role:actorRole,label:isTeacher?'Преподаватель':(options.studentName||'Ученик')});
    }
    function sendStrokeStart(stroke){
      if(!stroke||stroke.type!=='path')return;
      strokeSentIndex=(stroke.points||[]).length;lastStrokeSent=Date.now();
      broadcastTransient('stroke',{phase:'start',strokeId:stroke.id,stroke:{...clone(stroke),points:clone(stroke.points||[])}});
    }
    function sendStrokeChunk(stroke,force=false){
      if(!stroke||stroke.type!=='path')return;
      const now=Date.now();if(!force&&now-lastStrokeSent<32)return;
      const pts=(stroke.points||[]).slice(strokeSentIndex);if(!pts.length&&!force)return;
      if(pts.length)broadcastTransient('stroke',{phase:'chunk',strokeId:stroke.id,points:clone(pts)});
      strokeSentIndex=(stroke.points||[]).length;lastStrokeSent=now;
      if(force)broadcastTransient('stroke',{phase:'end',strokeId:stroke.id});
    }
    function render(){applyBackground();drawElements(svg,elements,camera,selectionList(),grid,needAsset,isTeacher);drawTransient();syncSelectionButtons();syncHistoryButtons();syncSolidHud();syncObjectHud();syncClassroomUi()}
    function clearPendingPlanePoints(){for(const o of elements){if(o?.type==='solid3d'&&Array.isArray(o.solidPoints))for(const p of o.solidPoints)p.pendingPlane=false}}
    function cancelCompassDraft(){if(!compassDraft)return;const id=compassDraft.id;if(id)elements=elements.filter(z=>z.id!==id);compassDraft=null;const last=undoStack[undoStack.length-1];if(last?.type==='elements'&&last.pageId===current.id)undoStack.pop();syncHistoryButtons();render()}
    function setTool(v){if(!canUseTool(v)){toast(classroomMode==='view'?'Доска сейчас в режиме просмотра':'Преподаватель разрешил только письмо');return}if(tool==='compass'&&v!=='compass'&&compassDraft)cancelCompassDraft();if(tool==='solid-plane'&&v!=='solid-plane'){solidPlanePick=null;clearPendingPlanePoints()}tool=v;eraserPoint=v==='eraser'?eraserPoint:null;root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===v));const cats={pen:'write',pencil:'write',marker:'write',text:'write',note:'write',line:'geometry',arrow:'geometry',ruler:'geometry',compass:'geometry','solid-point':'shapes','solid-plane':'shapes','solid-rotate':'shapes',laser:'lesson',focus:'lesson'};root.querySelectorAll('.board-tool-group').forEach(d=>d.classList.toggle('tool-active',d.dataset.category===cats[v]));svg.style.cursor=v==='hand'?'grab':v==='select'?'default':v==='eraser'?'none':'crosshair';stage?.classList.toggle('hand-mode',v==='hand');render()}
    function screenToWorld(cx,cy){const r=svg.getBoundingClientRect();return[(cx-r.left)/camera.zoom+camera.x,(cy-r.top)/camera.zoom+camera.y]}
    function appendFreehandPoints(target,e){
      if(!target?.points)return;
      const samples=typeof e.getCoalescedEvents==='function'?(e.getCoalescedEvents()||[]):[];
      const events=samples.length?samples:[e],minStep=.7/Math.max(.25,camera.zoom);
      for(const ev of events){
        const [px,py]=screenToWorld(ev.clientX,ev.clientY),last=target.points[target.points.length-1];
        if(!last||Math.hypot(px-last[0],py-last[1])>=minStep)target.points.push([px,py]);
      }
    }
    let interactiveFrame=0;
    function renderInteractive(){if(interactiveFrame)return;interactiveFrame=requestAnimationFrame(()=>{interactiveFrame=0;render()})}
    function renderTabs(){pageTabs.innerHTML=pages.map(p=>`<button class="btn sm ${p.id===current.id?'primary':''}" data-page="${p.id}" ${!isTeacher&&lessonId&&followTeacher?'disabled':''}>${esc(p.title)}</button>`).join('');pageTabs.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page))}
    function pagesChanged(){if(localOnly)writeLocal();else pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}
    async function deletePageRecord(id){if(localOnly)return;const {error}=await sb.from('board_pages').delete().eq('id',id);if(error)throw error}
    function setSyncState(state,text=''){
      if(!status)return;
      status.dataset.sync=state;
      status.textContent=text||(state==='online'?'Онлайн':state==='syncing'?'Синхронизация…':state==='offline'?'Офлайн · изменения локально':state==='error'?'Ошибка синхронизации':state==='saved'?'Сохранено':'Подключение…');
    }
    function elementSignature(o){
      if(!o)return'';
      const x={...o};delete x._rev;delete x._updatedAt;delete x._updatedBy;
      return JSON.stringify(x);
    }
    function newerElement(a,b){
      if(!a)return b;if(!b)return a;
      const ar=Number(a._rev||0),br=Number(b._rev||0);if(ar!==br)return ar>br?a:b;
      const at=Number(a._updatedAt||0),bt=Number(b._updatedAt||0);return at>=bt?a:b;
    }
    function stampLocalElement(obj,prev=null){
      if(!obj)return obj;
      if(!obj._ownerRole){obj._ownerRole=actorRole;obj._ownerId=actorId}
      obj._ownerId=String(obj._ownerId||actorId);
      obj._rev=Math.max(Number(obj._rev||0),Number(prev?._rev||0))+1;
      obj._updatedAt=Date.now();obj._updatedBy=actorKey;
      return obj;
    }
    function makeOp(type,element=null,id=''){
      return {opId:`${actorKey}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`,pageId:current?.id||'',type,id:id||element?.id||'',element:element?clone(element):null,actor:actorKey,role:actorRole,actorId,at:Date.now()};
    }
    function diffLocalOps(){
      const before=new Map((collabBaseline||[]).map(o=>[o.id,o])),after=new Map((elements||[]).map(o=>[o.id,o])),ops=[];
      for(let i=0;i<elements.length;i++){
        const obj=elements[i],prev=before.get(obj.id);
        if(!prev){stampLocalElement(obj);const op=makeOp('create',obj);op.index=i;ops.push(op)}
        else if(elementSignature(prev)!==elementSignature(obj)){stampLocalElement(obj,prev);const op=makeOp('update',obj);op.index=i;ops.push(op)}
      }
      for(const [id,prev] of before){
        if(after.has(id))continue;
        const op=makeOp('delete',null,id);op.rev=Math.max(1,Number(prev?._rev||0)+1);deleteJournal.set(id,{actor:actorKey,rev:op.rev,at:op.at});ops.push(op)
      }
      collabBaseline=clone(elements);
      if(ops.length)dbPendingOps.push(...clone(ops));
      return ops;
    }
    function queueOps(ops){
      const known=new Set(pendingOps.map(x=>x.opId));
      for(const op of ops||[])if(op?.opId&&!known.has(op.opId))pendingOps.push(op);
      pendingOps=pendingOps.slice(-800);persistPendingOps();
    }
    function sendOpBatch(ops){
      if(localOnly||!ops?.length)return;
      if(!boardNetworkOnline||!channelSubscribed||!channel){queueOps(ops);setSyncState('offline');return}
      channel.send({type:'broadcast',event:'ops',payload:{pageId:current.id,ops}}).then(()=>{lastOpSent=Date.now();if(!saveInFlight)setSyncState('online')}).catch(e=>{console.warn('[Mathroom board ops]',e);queueOps(ops);setSyncState('offline')});
    }
    async function flushPendingOps(){
      if(localOnly||!boardNetworkOnline||!channelSubscribed||!channel||!pendingOps.length)return;
      const batch=pendingOps.filter(op=>op.pageId===current.id).slice(0,120);if(!batch.length)return;
      try{
        setSyncState('syncing',`Синхронизация · ${pendingOps.length}`);
        await channel.send({type:'broadcast',event:'ops',payload:{pageId:current.id,ops:batch}});
        const ids=new Set(batch.map(x=>x.opId));pendingOps=pendingOps.filter(x=>!ids.has(x.opId));persistPendingOps();
        if(pendingOps.some(x=>x.pageId===current.id))setTimeout(()=>flushPendingOps(),40);else setSyncState('online');
      }catch(e){console.warn('[Mathroom board ops flush]',e);setSyncState('offline')}
    }
    function mergeForPersistence(serverRaw,localRaw){
      const server=(Array.isArray(serverRaw)?serverRaw:[]).map(normalizeElement).filter(Boolean),local=(Array.isArray(localRaw)?localRaw:[]).map(normalizeElement).filter(Boolean);
      const sm=new Map(server.map(x=>[x.id,x])),lm=new Map(local.map(x=>[x.id,x])),order=[...local.map(x=>x.id),...server.map(x=>x.id).filter(id=>!lm.has(id))],out=[];
      for(const id of order){const candidate=newerElement(lm.get(id),sm.get(id)),t=deleteJournal.get(id);if(!candidate)continue;if(t&&Number(t.rev||0)>Number(candidate._rev||0))continue;out.push(candidate)}
      return out;
    }
    async function save(){
      clearTimeout(saveTimer);if(!current)return;
      const p=pages.find(x=>x.id===current.id);if(p){p.elements=clone(elements);p.updated_at=new Date().toISOString()}
      if(localOnly){writeLocal();setSyncState('saved','Черновик сохранён');return}
      if(!boardNetworkOnline){try{localStorage.setItem(offlineSnapshotKey,JSON.stringify({pageId:current.id,elements,at:Date.now()}))}catch{}setSyncState('offline');return}
      if(saveInFlight){scheduleSave();return}
      saveInFlight=true;setSyncState('syncing');
      const pageId=current.id,localSnapshot=clone(elements),cutSet=new Set(dbPendingOps.map(x=>x.opId));
      try{
        const latest=await sb.from('board_pages').select('elements').eq('id',pageId).single();if(latest.error)throw latest.error;
        const merged=mergeForPersistence(latest.data?.elements||[],localSnapshot);
        const res=await sb.from('board_pages').update({elements:merged,updated_at:new Date().toISOString()}).eq('id',pageId);if(res.error)throw res.error;
        dbPendingOps=dbPendingOps.filter(op=>!cutSet.has(op.opId));lastServerSaveAt=Date.now();try{localStorage.removeItem(offlineSnapshotKey)}catch{}
        setSyncState('saved');setTimeout(()=>{if(status?.dataset.sync==='saved')setSyncState('online')},700);
      }catch(error){console.error('[Mathroom board save]',error);try{localStorage.setItem(offlineSnapshotKey,JSON.stringify({pageId,elements:localSnapshot,at:Date.now()}))}catch{}setSyncState('error')}
      finally{saveInFlight=false}
    }
    function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,420)}
    function broadcast(){const ops=diffLocalOps();if(ops.length)sendOpBatch(ops)}
    function broadcastState(force=false){
      if(localOnly||!channel||!channelSubscribed)return;
      const now=Date.now();if(!force&&now-lastStateBroadcast<5000)return;lastStateBroadcast=now;
      channel.send({type:'broadcast',event:'state',payload:{pageId:current.id,elements,protocol:2,actor:actorKey}}).catch(()=>{});
    }
    function changed(){render();broadcast();scheduleSave();sendViewport()}
    function remoteOpAllowed(op,existing){
      if(!op||op.actor===actorKey)return false;
      if(op.role!=='student')return true;
      if(classroomMode==='view')return false;
      if(op.type==='create'){
        if(classroomMode==='pen')return op.element?.type==='path';
        return true;
      }
      if(!existing)return op.type==='delete';
      if(classroomMode==='pen')return existing._ownerRole==='student'&&String(existing._ownerId||'')===String(op.actorId||'');
      return !existing.locked;
    }
    function applyRemoteOps(ops){
      if(!Array.isArray(ops)||!ops.length)return;
      let dirty=false;
      for(const op of ops){
        if(!op?.opId||seenOps.has(op.opId))continue;
        seenOps.add(op.opId);if(seenOps.size>2500)seenOps=new Set([...seenOps].slice(-1500));
        if(op.pageId!==current?.id)continue;
        const idx=elements.findIndex(x=>x.id===op.id),existing=idx>=0?elements[idx]:null;
        if(!remoteOpAllowed(op,existing))continue;
        if(op.type==='delete'){
          const incomingRev=Math.max(1,Number(op.rev||0));
          if(existing&&incomingRev>=Number(existing._rev||0)){
            elements.splice(idx,1);deleteJournal.set(op.id,{actor:op.actor,rev:incomingRev,at:Number(op.at||Date.now())});dirty=true;
          }
          continue;
        }
        const incoming=normalizeElement(op.element);if(!incoming)continue;
        const tomb=deleteJournal.get(incoming.id);if(tomb&&Number(tomb.rev||0)>Number(incoming._rev||0))continue;
        if(!existing){
          const pos=Number.isFinite(op.index)?Math.max(0,Math.min(elements.length,op.index)):elements.length;
          elements.splice(pos,0,incoming);dirty=true;
        }else{
          const winner=newerElement(existing,incoming);
          if(winner===incoming&&elementSignature(existing)!==elementSignature(incoming)){elements[idx]=incoming;dirty=true}
        }
      }
      if(!dirty)return;
      collabBaseline=clone(elements);
      const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);
      render();scheduleSave();setSyncState(boardNetworkOnline?'online':'offline');
    }
    function applyStateSnapshot(raw){
      const incoming=(Array.isArray(raw)?raw:[]).map(normalizeElement).filter(Boolean);
      if(!incoming.length&&elements.length)return;
      const im=new Map(incoming.map(x=>[x.id,x])),cm=new Map(elements.map(x=>[x.id,x]));
      const order=[...elements.map(x=>x.id),...incoming.map(x=>x.id).filter(id=>!cm.has(id))],next=[];
      for(const id of order){
        const local=cm.get(id),remote=im.get(id),tomb=deleteJournal.get(id),winner=newerElement(local,remote);
        if(!winner)continue;if(tomb&&Number(tomb.rev||0)>Number(winner._rev||0))continue;next.push(winner);
      }
      elements=next;collabBaseline=clone(elements);
      const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);
      render();
    }
    function applySafeSnapshot(target){
      const targetList=(target||[]).map(normalizeElement).filter(Boolean);
      const tm=new Map(targetList.map(x=>[x.id,x])),cm=new Map(elements.map(x=>[x.id,x]));
      const next=[];let changedAny=false;
      const all=[...new Set([...elements.map(x=>x.id),...targetList.map(x=>x.id)])];
      for(const id of all){
        const cur=cm.get(id),want=tm.get(id),tomb=deleteJournal.get(id);
        if(cur&&want){
          if(elementSignature(cur)===elementSignature(want)){next.push(cur);continue}
          if(lastUpdatedByMe(cur)||localOwns(cur)){next.push(clone(want));changedAny=true}else next.push(cur);
        }else if(cur&&!want){
          if(lastUpdatedByMe(cur)||localOwns(cur))changedAny=true;else next.push(cur);
        }else if(!cur&&want){
          if(tomb?.actor===actorKey||localOwns(want)){next.push(clone(want));changedAny=true}
        }
      }
      if(changedAny){elements=next;clearSelection()}
      return changedAny;
    }
    function pushElementsHistory(){if(busyHistory)return;undoStack.push({type:'elements',pageId:current.id,elements:clone(elements),actor:actorKey});if(undoStack.length>140)undoStack.shift();redoStack.length=0;syncHistoryButtons()}
    async function switchPage(id,{skipSave=false,fromLeader=false}={}){if(current?.id===id)return;if(!skipSave)await save();const p=pages.find(x=>x.id===id);if(!p)return;current=p;elements=clone(p.elements||[]).map(normalizeElement).filter(Boolean);collabBaseline=clone(elements);clearSelection();camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';renderTabs();render();joinChannel();if(isTeacher&&followTeacher&&!fromLeader)pagesChannel?.send({type:'broadcast',event:'navigate',payload:{pageId:id}}).catch(()=>{});sendViewport(true)}
    function hit(x,y){for(let i=elements.length-1;i>=0;i--){const o=elements[i];if(o.type==='board-bg')continue;if(o.teacherOnly&&!isTeacher)continue;const b=bounds(o);if(x>=b.x-20&&x<=b.x+b.w+20&&y>=b.y-20&&y<=b.y+b.h+20)return o}return null}
    async function restorePage(p){let data;if(localOnly){data={...clone(p),updated_at:new Date().toISOString()}}else{const row={id:p.id,teacher_id:p.teacher_id,student_id:p.student_id,title:p.title,sort_order:p.sort_order,elements:p.elements||[],created_at:p.created_at,updated_at:new Date().toISOString()};const res=await sb.from('board_pages').insert(row).select().single();if(res.error)throw res.error;data=res.data}pages.push(data);pages.sort((a,b)=>a.sort_order-b.sort_order);pagesChanged();await switchPage(data.id,{skipSave:true})}
    async function createPage(title,initialElements=[]){let data;if(localOnly){data={id:uid(),teacher_id:S.user?.id||'',student_id:null,title,sort_order:pages.length,elements:clone(initialElements),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}}else{const res=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title,sort_order:pages.length,elements:initialElements}).select().single();if(res.error)throw res.error;data=res.data}undoStack.push({type:'createPage',page:clone(data)});redoStack.length=0;pages.push(data);renderTabs();pagesChanged();return data}
    async function undo(){const action=undoStack.pop();if(!action){syncHistoryButtons();return}busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);const redo={type:'elements',pageId:p.id,elements:clone(elements),actor:actorKey};if(applySafeSnapshot(action.elements)){redoStack.push(redo);changed()}}else if(action.type==='deletePage'){redoStack.push({type:'deletePage',page:clone(action.page)});await restorePage(action.page)}else if(action.type==='createPage'){const p=pages.find(x=>x.id===action.page.id);if(p){redoStack.push({type:'createPage',page:clone(p)});await deletePageRecord(p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]).map(normalizeElement).filter(Boolean);collabBaseline=clone(elements);renderTabs();render();joinChannel();pagesChanged()}}}catch(e){fail(e)}finally{busyHistory=false;syncHistoryButtons()}}
    async function redo(){const action=redoStack.pop();if(!action){syncHistoryButtons();return}busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);const undoAction={type:'elements',pageId:p.id,elements:clone(elements),actor:actorKey};if(applySafeSnapshot(action.elements)){undoStack.push(undoAction);changed()}}else if(action.type==='deletePage'){const p=pages.find(x=>x.id===action.page.id);if(p){undoStack.push({type:'deletePage',page:clone(p)});await deletePageRecord(p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]).map(normalizeElement).filter(Boolean);collabBaseline=clone(elements);renderTabs();render();joinChannel();pagesChanged()}}else if(action.type==='createPage'){undoStack.push({type:'createPage',page:clone(action.page)});await restorePage(action.page)}}catch(e){fail(e)}finally{busyHistory=false;syncHistoryButtons()}}

    async function uploadBlob(blob,mime='image/png',ext='png'){
      if(localOnly){
        const path=await putLocalAsset(blob,mime,`${uid()}.${ext}`);
        return path;
      }
      const path=`${assetOwner}/${uid()}.${ext}`;const {error}=await sb.storage.from(ASSET_BUCKET).upload(path,blob,{contentType:mime,upsert:false,cacheControl:'3600'});if(error)throw error;return path;
    }
    async function importImage(file){
      if(file.size>15*1024*1024)throw new Error('Изображение больше 15 МБ');
      const bitmap=await createImageBitmap(file),scale=Math.min(1,900/bitmap.width),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');
      const path=await uploadBlob(file,file.type||'image/png',ext);rememberAsset({assetPath:path,name:file.name,mime:file.type||'image/png',type:'image',w,h});pushElementsHistory();const obj={id:uid(),type:'image',assetPath:path,x:camera.x+180/camera.zoom,y:camera.y+70/camera.zoom,w,h,name:file.name};elements.push(obj);selectOnly(obj.id);setTool('select');changed();ensureAsset(path).then(()=>render());return obj;
    }
    function assetLibrary(){try{const a=JSON.parse(localStorage.getItem(assetLibraryKey)||'[]');return Array.isArray(a)?a:[]}catch{return[]}}
    function rememberAsset(meta){try{const list=assetLibrary().filter(x=>x.assetPath!==meta.assetPath);list.unshift({...meta,id:meta.id||uid(),createdAt:new Date().toISOString()});localStorage.setItem(assetLibraryKey,JSON.stringify(list.slice(0,60)))}catch{}}
    function openAssetLibrary(){const list=assetLibrary(),m=modal(`<div class="mr-card-head"><div><h2>Материалы</h2><p class="muted">Недавно загруженные изображения и файлы. Их можно повторно вставлять на любую доску.</p></div></div><div class="list">${list.length?list.map(a=>`<div class="row"><div><b>${esc(a.name||'Материал')}</b><div class="small muted">${esc(a.mime||a.type||'файл')} · ${a.createdAt?new Date(a.createdAt).toLocaleDateString('ru-RU'):''}</div></div><div class="actions"><button class="btn sm primary" data-asset-use="${a.id}">Вставить</button><button class="btn sm danger" data-asset-remove="${a.id}">Убрать</button></div></div>`).join(''):'<div class="empty">Материалов пока нет. Перетащите файл на доску или нажмите «Файл».</div>'}</div>`,'wide-modal');m.querySelectorAll('[data-asset-use]').forEach(b=>b.onclick=()=>{const a=list.find(x=>x.id===b.dataset.assetUse);if(!a)return;pushElementsHistory();let obj;if(a.type==='image')obj={id:uid(),type:'image',assetPath:a.assetPath,x:camera.x+180/camera.zoom,y:camera.y+70/camera.zoom,w:a.w||640,h:a.h||420,name:a.name};else obj={id:uid(),type:'attachment',assetPath:a.assetPath,x:camera.x+190/camera.zoom,y:camera.y+100/camera.zoom,w:380,h:100,name:a.name,mime:a.mime};elements.push(obj);selectOnly(obj.id);m.remove();setTool('select');changed();ensureAsset(a.assetPath).then(render)});m.querySelectorAll('[data-asset-remove]').forEach(b=>b.onclick=()=>{const next=list.filter(x=>x.id!==b.dataset.assetRemove);localStorage.setItem(assetLibraryKey,JSON.stringify(next));b.closest('.row')?.remove()})}
    async function importAttachment(file){if(file.size>60*1024*1024)throw new Error('Файл больше 60 МБ');const ext=(file.name.split('.').pop()||'bin').replace(/[^a-z0-9]/gi,'').toLowerCase()||'bin',path=await uploadBlob(file,file.type||'application/octet-stream',ext);rememberAsset({assetPath:path,name:file.name,mime:file.type||'application/octet-stream',type:'attachment'});pushElementsHistory();const obj={id:uid(),type:'attachment',assetPath:path,x:camera.x+190/camera.zoom,y:camera.y+100/camera.zoom,w:380,h:100,name:file.name,mime:file.type||'application/octet-stream'};elements.push(obj);selectOnly(obj.id);setTool('select');changed();toast('Файл добавлен на доску · двойной клик откроет его')}
    async function importPdfBlob(blob,opts={}){
      if(!window.pdfjsLib)throw new Error('PDF.js не загрузился');
      const size=Number(blob?.size||0);
      if(size>80*1024*1024)throw new Error('PDF больше 80 МБ. Сожми файл перед вставкой на доску.');
      const name=String(opts.name||blob?.name||'Учебник.pdf');
      status.textContent='Читаем PDF…';
      const data=blob instanceof ArrayBuffer?blob:await blob.arrayBuffer();
      const doc=await window.pdfjsLib.getDocument({data}).promise;
      let pageFrom=Math.max(1,Math.min(doc.numPages,Number(opts.pageFrom)||1));
      let pageTo=opts.pageTo==null?doc.numPages:Math.max(pageFrom,Math.min(doc.numPages,Number(opts.pageTo)||pageFrom));
      const count=pageTo-pageFrom+1;
      if(opts.maxPages&&count>opts.maxPages)throw new Error(`За один раз можно добавить не больше ${opts.maxPages} страниц. Выбери меньший диапазон.`);
      if(opts.newSheet){
        await save();
        const clean=name.replace(/\.pdf$/i,'');
        const title=opts.sheetTitle||`${clean} · стр. ${pageFrom}${pageTo!==pageFrom?`–${pageTo}`:''}`;
        const p=await createPage(title,[]);
        await switchPage(p.id,{skipSave:true});
      }
      pushElementsHistory();
      let y=camera.y+60/camera.zoom,first=null;const x=camera.x+110/camera.zoom,gap=30;
      for(let i=pageFrom;i<=pageTo;i++){
        status.textContent=`PDF: страница ${i} · ${i-pageFrom+1}/${count}`;
        const page=await doc.getPage(i),vp=page.getViewport({scale:1.55}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});
        canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvasContext:ctx,viewport:vp}).promise;
        const rendered=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Не удалось создать изображение страницы')),'image/jpeg',.9));
        if(localOnly)status.textContent=`PDF: сохраняем страницу ${i} локально · ${i-pageFrom+1}/${count}`;
        const path=await uploadBlob(rendered,'image/jpeg','jpg'),scale=Math.min(1,980/canvas.width),w=Math.round(canvas.width*scale),h=Math.round(canvas.height*scale),obj={id:uid(),type:'image',assetPath:path,x,y,w,h,name:`${name} · стр. ${i}`};
        elements.push(obj);if(!first)first=obj;y+=h+gap;ensureAsset(path);
      }
      if(first){selectOnly(first.id);setTool('select');changed()}
      status.textContent=`Учебник на доске · стр. ${pageFrom}${pageTo!==pageFrom?`–${pageTo}`:''}`;
      toast(count===1?`Страница ${pageFrom} добавлена на доску`:`Страницы ${pageFrom}–${pageTo} добавлены на доску`);
      return {count,pageFrom,pageTo};
    }
    async function importPdf(file){
      if(file.size>35*1024*1024)throw new Error('PDF больше 35 МБ');
      return importPdfBlob(file,{name:file.name,pageFrom:1,pageTo:null});
    }
    async function handleImport(file){if(importBusy||!file)return;importBusy=true;try{if(file.type==='application/pdf'||/\.pdf$/i.test(file.name))await importPdf(file);else if(file.type.startsWith('image/'))await importImage(file);else if(file.type.startsWith('video/')||file.type.startsWith('audio/')||/\.(docx?|pptx?|xlsx?|txt|csv)$/i.test(file.name))await importAttachment(file);else throw new Error('Формат файла пока не поддерживается')}catch(e){fail(e)}finally{importBusy=false;const input=root.querySelector('#boardFile');if(input)input.value=''}}

    function contentBounds(list=elements){
      const boxes=(list||[]).filter(o=>o.type!=='board-bg').map(bounds).filter(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)&&Number.isFinite(b.w)&&Number.isFinite(b.h));
      if(!boxes.length)return{x:0,y:0,w:900,h:560};
      const x1=Math.min(...boxes.map(b=>b.x)),y1=Math.min(...boxes.map(b=>b.y)),x2=Math.max(...boxes.map(b=>b.x+b.w)),y2=Math.max(...boxes.map(b=>b.y+b.h));
      return{x:x1,y:y1,w:Math.max(80,x2-x1),h:Math.max(80,y2-y1)};
    }
    function cameraForBounds(list,w,h,pad=70){
      const b=contentBounds(list),usableW=Math.max(100,w-pad*2),usableH=Math.max(100,h-pad*2),zoom=Math.max(.05,Math.min(3,usableW/b.w,usableH/b.h));
      return{x:b.x-pad/zoom,y:b.y-pad/zoom,zoom};
    }
    function fitAll(){const r=svg.getBoundingClientRect();camera=cameraForBounds(elements.filter(x=>x.type!=='board-bg'),Math.max(500,r.width),Math.max(350,r.height),55);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render();sendViewport(true)}
    const blobToDataUrl=blob=>new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(blob)});
    async function exportSvgMarkup(list,w=1600,h=1000){
      const assetPaths=[...new Set((list||[]).filter(x=>x.type==='image'&&x.assetPath).map(x=>x.assetPath))];
      await Promise.all(assetPaths.map(x=>ensureAsset(x)));
      const temp=svgEl('svg',{xmlns:SVG,width:w,height:h,viewBox:`0 0 ${w} ${h}`});
      drawElements(temp,list||[],cameraForBounds(list,w,h,70),null,true);
      for(const img of temp.querySelectorAll('image')){const href=img.getAttribute('href');if(href?.startsWith('blob:')){try{const data=await blobToDataUrl(await fetch(href).then(r=>r.blob()));img.setAttribute('href',data)}catch{}}}
      return new XMLSerializer().serializeToString(temp);
    }
    async function pagePngData(list,w=1600,h=1000){
      const markup=await exportSvgMarkup(list,w,h),url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml;charset=utf-8'}));
      try{const img=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url});const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);return canvas.toDataURL('image/png',.96)}finally{URL.revokeObjectURL(url)}
    }
    function downloadDataUrl(dataUrl,name){const a=document.createElement('a');a.href=dataUrl;a.download=name;document.body.appendChild(a);a.click();a.remove()}
    async function exportCurrentPng(){try{await save();status.textContent='Экспорт PNG…';const data=await pagePngData(elements);downloadDataUrl(data,`${(current.title||'mathroom-board').replace(/[^a-zа-яё0-9_-]+/gi,'_')}.png`);status.textContent=localOnly?'Черновик сохранён':'Сохранено';toast('Лист экспортирован в PNG')}catch(e){fail(e)}}
    async function exportAllPdf(){
      try{await save();const JsPDF=window.jspdf?.jsPDF;if(!JsPDF)throw new Error('Модуль PDF не загрузился. Обнови страницу и попробуй ещё раз.');status.textContent='Экспорт PDF…';const doc=new JsPDF({orientation:'landscape',unit:'pt',format:'a4'}),pw=doc.internal.pageSize.getWidth(),ph=doc.internal.pageSize.getHeight();
        for(let i=0;i<pages.length;i++){const pg=pages[i],list=pg.id===current.id?elements:(pg.elements||[]);const data=await pagePngData(list,1600,1000);if(i)doc.addPage('a4','landscape');const margin=24,ratio=Math.min((pw-margin*2)/1600,(ph-margin*2)/1000),dw=1600*ratio,dh=1000*ratio;doc.addImage(data,'PNG',(pw-dw)/2,(ph-dh)/2,dw,dh,undefined,'FAST')}
        doc.save(localOnly?'mathroom-scratch-board.pdf':'mathroom-board.pdf');status.textContent=localOnly?'Черновик сохранён':'Сохранено';toast('Доска экспортирована в PDF')
      }catch(e){fail(e)}
    }
    function copySelected(){const ids=selectionList(),objs=ids.map(id=>elements.find(x=>x.id===id)).filter(Boolean);if(!objs.length)return;clipboardElement=clone(objs);syncSelectionButtons();toast(objs.length>1?`${objs.length} объектов скопировано`:'Объект скопирован')}
    function pasteSelected(){if(!clipboardElement)return;const list=Array.isArray(clipboardElement)?clipboardElement:[clipboardElement];pushElementsHistory();const created=[];for(const src of list){let o=translated(src,32/camera.zoom,32/camera.zoom);o.id=uid();elements.push(o);created.push(o.id)}setSelection(created);changed();setTool('select');toast(created.length>1?`${created.length} объектов вставлено`:'Объект вставлен')}
    function deleteSelected(){const ids=selectionList();if(!ids.length)return;const objs=ids.map(id=>elements.find(x=>x.id===id)).filter(Boolean);if(objs.some(o=>o.locked))return toast('В выделении есть закреплённый объект · сначала разблокируйте');if(!isTeacher&&classroomMode!=='open')return toast('Редактирование объектов сейчас ограничено');pushElementsHistory();const set=new Set(ids);elements=elements.filter(x=>!set.has(x.id));clearSelection();changed();toast(ids.length>1?`${ids.length} объектов удалено`:'Объект удалён')}
    async function importClipboardBlob(blob,name='clipboard.png'){const type=blob.type||'image/png';const file=blob instanceof File?blob:new File([blob],name,{type});await importImage(file);toast('Изображение вставлено из буфера')}
    async function readSystemClipboard(){if(!isTeacher)return;try{if(!navigator.clipboard?.read)throw new Error('Браузер не поддерживает чтение изображений из буфера по кнопке. Используй Ctrl+V.');const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){await importClipboardBlob(await item.getType(type));return}}const text=await navigator.clipboard.readText().catch(()=> '');if(text){addText(text,{fontSize:26});toast('Текст вставлен из буфера');return}toast('В буфере нет изображения или текста')}catch(e){fail(e)}}
    async function pasteExternal(e){
      if(!isTeacher)return;const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;const items=[...(e.clipboardData?.items||[])],files=[...(e.clipboardData?.files||[])];const imageItem=items.find(x=>x.type?.startsWith('image/')),imageFile=files.find(x=>x.type?.startsWith('image/'));if(imageItem||imageFile){e.preventDefault();const file=imageItem?.getAsFile?.()||imageFile;if(file)await importClipboardBlob(file,file.name||'clipboard.png');return}
      const text=e.clipboardData?.getData('text/plain');if(text){e.preventDefault();addText(text,{fontSize:26});toast('Текст вставлен на доску');return}
      if(clipboardElement){e.preventDefault();pasteSelected()}
    }
    async function cropSelectedImage(){const o=elements.find(x=>x.id===selected);if(!o||o.type!=='image')return;try{const url=await ensureAsset(o.assetPath);if(!url)throw new Error('Не удалось загрузить изображение');const m=modal(`<h2>Обрезать изображение</h2><p class="muted">Укажи, сколько процентов убрать с каждой стороны.</p><div class="board-crop-preview"><img src="${url}"></div><div class="grid cols4"><div class="field"><label>Слева %</label><input id="cropL" type="number" min="0" max="45" value="0"></div><div class="field"><label>Сверху %</label><input id="cropT" type="number" min="0" max="45" value="0"></div><div class="field"><label>Справа %</label><input id="cropR" type="number" min="0" max="45" value="0"></div><div class="field"><label>Снизу %</label><input id="cropB" type="number" min="0" max="45" value="0"></div></div><button class="btn primary" id="cropApply">Применить</button>`,'wide-modal');m.querySelector('#cropApply').onclick=async()=>{try{const vals=['L','T','R','B'].map(k=>clamp(Number(m.querySelector('#crop'+k).value||0),0,45)),[l,t,r,b]=vals;if(l+r>=90||t+b>=90)return toast('Слишком сильная обрезка');const blob=await fetch(url).then(x=>x.blob()),img=await createImageBitmap(blob),sx=Math.round(img.width*l/100),sy=Math.round(img.height*t/100),sw=Math.max(1,Math.round(img.width*(1-(l+r)/100))),sh=Math.max(1,Math.round(img.height*(1-(t+b)/100))),c=document.createElement('canvas');c.width=sw;c.height=sh;c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);const out=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error('Не удалось обрезать')),'image/png',.94)),path=await uploadBlob(out,'image/png','png');pushElementsHistory();const idx=elements.findIndex(x=>x.id===o.id);elements[idx]={...o,assetPath:path,w:o.w*(sw/img.width),h:o.h*(sh/img.height)};m.remove();changed();ensureAsset(path).then(render);toast('Изображение обрезано')}catch(e){fail(e)}}}catch(e){fail(e)}}
    async function captureBoardFallback(){
      try{
        const r=svg.getBoundingClientRect(),w=Math.max(640,Math.round(r.width||1280)),h=Math.max(420,Math.round(r.height||720));
        const assetPaths=[...new Set(elements.filter(x=>x.type==='image'&&x.assetPath).map(x=>x.assetPath))];
        await Promise.all(assetPaths.map(x=>ensureAsset(x)));
        const temp=svgEl('svg',{xmlns:SVG,width:w,height:h,viewBox:`0 0 ${w} ${h}`});
        const bg=currentBackground(),bgColor=bg?.color||(bg?.kind==='cream'?'#fffaf2':'#ffffff');
        temp.appendChild(svgEl('rect',{x:0,y:0,width:w,height:h,fill:bgColor||'#ffffff'}));
        drawElements(temp,elements,camera,null,true);
        for(const img of temp.querySelectorAll('image')){const href=img.getAttribute('href');if(href?.startsWith('blob:')){try{const data=await blobToDataUrl(await fetch(href).then(r=>r.blob()));img.setAttribute('href',data)}catch{}}}
        const markup=new XMLSerializer().serializeToString(temp),url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml;charset=utf-8'}));
        try{
          const image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url});
          const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=bgColor||'#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);
          const blob=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error('Не удалось создать снимок доски')),'image/png',.94));
          await importClipboardBlob(blob,'board-screenshot.png');
          toast('Системный захват экрана требует HTTPS · добавлен снимок текущего вида доски');
        }finally{URL.revokeObjectURL(url)}
      }catch(e){fail(e)}
    }
    async function captureScreen(){
      if(!navigator.mediaDevices?.getDisplayMedia){await captureBoardFallback();return}
      let stream=null;
      try{
        stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
        const v=document.createElement('video');v.srcObject=stream;v.muted=true;await v.play();await new Promise(r=>setTimeout(r,180));
        const track=stream.getVideoTracks()[0],settings=track.getSettings(),w=settings.width||v.videoWidth||1280,h=settings.height||v.videoHeight||720,c=document.createElement('canvas');
        c.width=w;c.height=h;c.getContext('2d').drawImage(v,0,0,w,h);
        const blob=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error('Не удалось сделать снимок')),'image/png',.94));
        await importClipboardBlob(blob,'screenshot.png');
        if(confirm('Обрезать снимок до нужной области?'))await cropSelectedImage();
      }catch(e){
        if(e?.name==='NotAllowedError'||e?.name==='AbortError')return;
        if(e?.name==='NotSupportedError'||e?.name==='SecurityError'){await captureBoardFallback();return}
        fail(e)
      }finally{stream?.getTracks().forEach(t=>t.stop())}
    }
    function boardTemplates(){try{return JSON.parse(localStorage.getItem(templatesKey)||'[]')||[]}catch{return[]}}
    function saveBoardTemplates(list){localStorage.setItem(templatesKey,JSON.stringify(list.slice(0,40)))}
    function openTemplates(){
      const list=boardTemplates();
      const built=[
        {id:'blank',name:'Чистый лист',desc:'Очистить лист и начать с нуля'},
        {id:'grid',name:'Клетка',desc:'Чистый лист с включённой сеткой'},
        {id:'coords',name:'Координатная плоскость',desc:'Готовые оси для графиков'},
        {id:'geometry',name:'Геометрия',desc:'Линейка, транспортир и место для чертежа'},
        {id:'exam',name:'ОГЭ / ЕГЭ · задача',desc:'Заголовок и рабочая область'}
      ];
      const m=modal(`<div class="mr-card-head"><div><h2>Шаблоны доски</h2><p class="muted">Быстрые заготовки и собственные сохранённые листы.</p></div><button class="btn primary sm" id="saveBoardTemplate">+ Сохранить текущий лист</button></div><h3>Быстрые шаблоны</h3><div class="board-template-grid">${built.map(t=>`<button class="board-template-card" data-built-template="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></button>`).join('')}</div><h3>Мои шаблоны</h3><div class="list" id="boardTemplateList">${list.length?list.map(t=>`<div class="row"><div><b>${esc(t.name)}</b><div class="small muted">${t.elements?.length||0} объектов</div></div><div class="actions"><button class="btn sm primary" data-use-template="${t.id}">Вставить</button><button class="btn sm danger" data-del-template="${t.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Пользовательских шаблонов пока нет.</div>'}</div>`,'wide-modal');
      m.querySelector('#saveBoardTemplate').onclick=()=>{const name=prompt('Название шаблона:',current.title||'Шаблон');if(!name)return;const next=[{id:uid(),name:name.trim(),elements:clone(elements),createdAt:new Date().toISOString()},...boardTemplates()];saveBoardTemplates(next);m.remove();toast('Шаблон сохранён')};
      m.querySelectorAll('[data-built-template]').forEach(b=>b.onclick=()=>{
        const id=b.dataset.builtTemplate;if((id==='blank'||id==='grid')&&elements.length&&!confirm('Очистить текущий лист?'))return;pushElementsHistory();
        if(id==='blank'||id==='grid'){elements=[];clearSelection();grid=id==='grid';root.querySelector('#gridToggle')?.classList.toggle('active',grid)}
        if(id==='coords')elements.push({id:uid(),type:'coordinate',x:camera.x+190/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,baseW:680,baseH:460,rangeXBase:10,rangeYBase:7,rangeX:10,rangeY:7});
        if(id==='geometry'){const x=camera.x+200/camera.zoom,y=camera.y+80/camera.zoom;elements.push({id:uid(),type:'text',x,y,text:'ГЕОМЕТРИЯ · чертёж',color:'#15171a',fontSize:28},{id:uid(),type:'ruler',x1:x,y1:y+90,x2:x+520,y2:y+90,color:'#15171a',width:2},{id:uid(),type:'protractor',x:x+650,y:y+210,r:120,color:'#15171a',width:2})}
        if(id==='exam'){const x=camera.x+190/camera.zoom,y=camera.y+70/camera.zoom;elements.push({id:uid(),type:'text',x,y,text:'Задача №___',color:'#15171a',fontSize:32},{id:uid(),type:'line',x1:x,y1:y+55,x2:x+820,y2:y+55,color:'#15171a',width:2},{id:uid(),type:'text',x,y:y+105,text:'Условие / решение:',color:'#666',fontSize:22})}
        m.remove();changed();fitAll();toast('Шаблон применён')
      });
      m.querySelectorAll('[data-use-template]').forEach(b=>b.onclick=()=>{const t=list.find(x=>x.id===b.dataset.useTemplate);if(!t)return;pushElementsHistory();const add=(t.elements||[]).map(x=>({...clone(x),id:uid()}));elements.push(...add);m.remove();changed();fitAll();toast('Шаблон вставлен')});
      m.querySelectorAll('[data-del-template]').forEach(b=>b.onclick=()=>{saveBoardTemplates(list.filter(x=>x.id!==b.dataset.delTemplate));b.closest('.row')?.remove();toast('Шаблон удалён')})
    }
    function scratchPages(){try{const v=JSON.parse(localStorage.getItem(scratchStorageKey)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
    function copyToScratch(){const arr=scratchPages();arr.push({id:uid(),teacher_id:S.user?.id||'',student_id:null,title:`${options.studentName||'Ученик'} · ${current.title||'Лист'}`,sort_order:arr.length,elements:clone(elements),created_at:new Date().toISOString(),updated_at:new Date().toISOString()});localStorage.setItem(scratchStorageKey,JSON.stringify(arr));toast('Лист скопирован в черновик преподавателя')}
    function copyFromScratch(){const arr=scratchPages();if(!arr.length)return toast('Черновик пуст');const m=modal(`<h2>Вставить из черновика</h2><div class="list">${arr.map(p=>`<div class="row"><div><b>${esc(p.title||'Черновик')}</b><span class="small muted">${(p.elements||[]).length} объектов</span></div><button class="btn sm primary" data-scratch-page="${p.id}">Вставить</button></div>`).join('')}</div>`);m.querySelectorAll('[data-scratch-page]').forEach(b=>b.onclick=()=>{const p=arr.find(x=>x.id===b.dataset.scratchPage);if(!p)return;pushElementsHistory();elements.push(...(p.elements||[]).map(x=>({...clone(x),id:uid()})));m.remove();changed();fitAll();toast('Черновик добавлен на доску ученика')})}
    function readCheckpoints(){if(!checkpointKey)return[];try{const v=JSON.parse(localStorage.getItem(checkpointKey)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
    async function saveCheckpoint(label='Автосохранение'){if(!checkpointKey)return;await save();const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);const rows=readCheckpoints();rows.push({id:uid(),at:new Date().toISOString(),label,pages:clone(pages),currentId:current.id});while(rows.length>30)rows.shift();try{localStorage.setItem(checkpointKey,JSON.stringify(rows))}catch(e){console.warn('[board checkpoint]',e)}}
    async function restoreCheckpoint(cp){if(!cp?.pages?.length)return;try{if(localOnly){pages=clone(cp.pages);writeLocal()}else{for(const pg of cp.pages){const found=pages.find(x=>x.id===pg.id);if(found){const{error}=await sb.from('board_pages').update({title:pg.title,sort_order:pg.sort_order,elements:pg.elements||[],updated_at:new Date().toISOString()}).eq('id',pg.id);if(error)throw error}else{const{error}=await sb.from('board_pages').insert({id:pg.id,teacher_id:S.user.id,student_id:studentId,title:pg.title,sort_order:pg.sort_order,elements:pg.elements||[]});if(error)throw error}}pages=clone(cp.pages)}current=pages.find(x=>x.id===cp.currentId)||pages[0];elements=clone(current.elements||[]);clearSelection();renderTabs();render();joinChannel();pagesChanged();toast('Состояние доски восстановлено')}catch(e){fail(e)}}
    function openBoardHistory(){
      const rows=readCheckpoints().slice().reverse();
      const m=modal(`<div class="mr-card-head"><div><h2>История доски</h2><p class="muted">Контрольные точки, восстановление и просмотр хода урока.</p></div><div class="actions"><button class="btn sm primary" id="checkpointNow">Сохранить сейчас</button><button class="btn sm" id="checkpointReplay" ${rows.length>1?'':'disabled'}>▶ Воспроизвести</button><button class="btn sm danger" id="checkpointClear" ${rows.length?'':'disabled'}>Удалить историю</button></div></div><div class="list">${rows.length?rows.map(x=>`<div class="row"><div><b>${esc(x.label||'Снимок')}</b><div class="small muted">${new Date(x.at).toLocaleString('ru-RU')} · ${x.pages?.length||0} лист.</div></div><div class="actions"><button class="btn sm" data-restore-cp="${x.id}">Восстановить</button><button class="btn sm danger" data-delete-cp="${x.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Контрольных точек пока нет.</div>'}</div>`,'wide-modal');
      m.querySelector('#checkpointNow').onclick=async()=>{await saveCheckpoint('Ручная точка');m.remove();toast('Контрольная точка сохранена')};
      m.querySelector('#checkpointClear')?.addEventListener('click',()=>{if(!confirm('Удалить всю историю доски для этого урока?'))return;localStorage.removeItem(checkpointKey);m.remove();toast('История доски удалена')});
      m.querySelector('#checkpointReplay')?.addEventListener('click',()=>{
        const frames=readCheckpoints().slice().sort((a,b)=>String(a.at).localeCompare(String(b.at)));if(frames.length<2)return;let i=0,timer=null;
        const rm=modal(`<div class="mr-card-head"><div><h2>Воспроизведение доски</h2><p class="muted" id="replayMeta"></p></div><div class="actions"><button class="btn sm" id="replayPrev">←</button><button class="btn sm primary" id="replayPlay">▶</button><button class="btn sm" id="replayNext">→</button></div></div><input id="replayRange" type="range" min="0" max="${frames.length-1}" value="0" step="1" style="width:100%;margin:8px 0 12px"><div id="replayRoot"></div>`,'snapshot-modal');
        const show=()=>{const f=frames[i],rr=rm.querySelector('#replayRoot');rr.innerHTML='';rm.querySelector('#replayRange').value=String(i);rm.querySelector('#replayMeta').textContent=`${i+1}/${frames.length} · ${new Date(f.at).toLocaleString('ru-RU')} · ${f.label||'Снимок'}`;mountSnapshot(rr,f.pages||[])};
        const stop=()=>{if(timer){clearInterval(timer);timer=null}const b=rm.querySelector('#replayPlay');if(b)b.textContent='▶'};
        rm.querySelector('#replayPrev').onclick=()=>{stop();i=Math.max(0,i-1);show()};rm.querySelector('#replayNext').onclick=()=>{stop();i=Math.min(frames.length-1,i+1);show()};rm.querySelector('#replayRange').oninput=e=>{stop();i=Number(e.target.value);show()};rm.querySelector('#replayPlay').onclick=()=>{if(timer)return stop();rm.querySelector('#replayPlay').textContent='⏸';timer=setInterval(()=>{if(i>=frames.length-1){stop();return}i++;show()},1200)};rm.querySelector('[data-close]')?.addEventListener('click',stop);show();
      });
      m.querySelectorAll('[data-delete-cp]').forEach(b=>b.onclick=()=>{if(!confirm('Удалить эту контрольную точку?'))return;const next=readCheckpoints().filter(x=>x.id!==b.dataset.deleteCp);localStorage.setItem(checkpointKey,JSON.stringify(next));m.remove();openBoardHistory()});
      m.querySelectorAll('[data-restore-cp]').forEach(b=>b.onclick=async()=>{const cp=rows.find(x=>x.id===b.dataset.restoreCp);if(!cp||!confirm('Восстановить это состояние доски? Текущее состояние сначала будет сохранено.'))return;await saveCheckpoint('Перед восстановлением');m.remove();await restoreCheckpoint(cp)})
    }
    async function resetToLessonStart(){const cp=readCheckpoints().find(x=>x.label==='Начало урока');if(!cp)return toast('Начальная контрольная точка не найдена');if(confirm('Вернуть доску к состоянию на начало урока?')){await saveCheckpoint('Перед возвратом к началу');await restoreCheckpoint(cp)}}
    function toggleHidden(){const ids=selectionList();if(!ids.length)return;const objs=ids.map(id=>elements.find(x=>x.id===id)).filter(Boolean),hide=!objs.every(o=>o.teacherOnly);pushElementsHistory();elements=elements.map(o=>ids.includes(o.id)?{...o,teacherOnly:hide}:o);changed();toast(ids.length>1?(hide?'Выбранные объекты скрыты от ученика':'Выбранные объекты показаны ученику'):(hide?'Объект скрыт от ученика':'Объект показан ученику'))}
    function revealNextHidden(){const idx=elements.findIndex(x=>x.teacherOnly);if(idx<0)return toast('Скрытых объектов нет');pushElementsHistory();elements[idx]={...elements[idx],teacherOnly:false};selectOnly(elements[idx].id);changed();toast('Следующий скрытый объект открыт ученику')}

    svg.onpointerdown=e=>{
      clearDragOverlay();
      boardFocused=true;root.querySelector('.board-card')?.focus?.({preventScroll:true});const ae=document.activeElement;if(ae&&['INPUT','TEXTAREA','SELECT','BUTTON'].includes(ae.tagName))ae.blur?.();
      svg.setPointerCapture(e.pointerId);
      let[x,y]=screenToWorld(e.clientX,e.clientY);sendCursor(x,y);
      if(!['pen','pencil','marker','laser','eraser','compass','solid-rotate'].includes(tool))[x,y]=geometrySnapPoint(x,y,selectionList());
      if(tool==='hand'){e.preventDefault();document.getSelection?.()?.removeAllRanges?.();panStart={cx:e.clientX,cy:e.clientY,x:camera.x,y:camera.y};svg.style.cursor='grabbing';return}
      if(tool==='laser'){laserPoint={x,y};broadcastTransient('laser',{point:laserPoint});render();return}
      if(tool==='marker'){drawing={id:uid(),type:'marker-temp',points:[[x,y]],color:'#f59e0b',width:14,expires:Date.now()+5000};tempMarks.push(drawing);render();return}
      if(tool==='focus'){focusDraft={x0:x,y0:y,x1:x,y1:y};focusRect={x,y,w:1,h:1};render();return}
      if(tool==='eraser'){eraserPoint={x,y};eraserTrail=[[x,y]];eraserDown=true;pushElementsHistory();const o=eraserHitAllowed(x,y,18/camera.zoom);if(o&&!o.locked){elements=elements.filter(z=>z.id!==o.id);if(selectionHas(o.id)){const next=selectionList().filter(id=>id!==o.id);setSelection(next)}changed()}else render();return}
      if(tool==='text'){const text=prompt('Текст:');if(text){pushElementsHistory();elements.push({id:uid(),type:'text',x,y,text,color,fontSize:28});changed()}return}
      if(tool==='note'){const text=prompt('Текст заметки:');if(text){pushElementsHistory();const obj={id:uid(),type:'note',x,y,w:280,h:170,text,color:'#3d3515',fill:'#fff3bf',fontSize:20};elements.push(obj);selectOnly(obj.id);setTool('select');changed()}return}
      if(tool==='solid-point'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Сначала кликните по 3D фигуре');const q=nearestSolidSurfacePoint(o,x,y);if(!q||q.d>34/camera.zoom)return toast('Кликните по грани или ближе к ребру фигуры');pushElementsHistory();const idx=elements.findIndex(z=>z.id===o.id),copy=clone(o),n=(copy.solidPoints||[]).length,label=n<26?String.fromCharCode(65+n):`P${n+1}`;copy.solidPoints=[...(copy.solidPoints||[]),{id:uid(),label,p:q.p}];elements[idx]=copy;selectOnly(copy.id);changed();toast(`Точка ${label} добавлена`);return;
      }
      if(tool==='solid-plane'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Выберите 3D фигуру с отмеченными точками');const q=nearestSolidUserPoint(o,x,y);if(!q||q.d>24/camera.zoom)return toast('Кликните по одной из отмеченных точек');if(!solidPlanePick||solidPlanePick.solidId!==o.id){clearPendingPlanePoints();solidPlanePick={solidId:o.id,ids:[]}};const idx=elements.findIndex(z=>z.id===o.id);if(idx<0)return;if(!solidPlanePick.ids.includes(q.id))solidPlanePick.ids.push(q.id);const live=elements[idx];if(Array.isArray(live.solidPoints)){const pt=live.solidPoints.find(m=>m.id===q.id);if(pt)pt.pendingPlane=true}selectOnly(o.id);if(solidPlanePick.ids.length<3){render();broadcast();toast(`Плоскость: выбрано ${solidPlanePick.ids.length}/3 · выбранные точки закрашены`);return}clearPendingPlanePoints();pushElementsHistory();const copy=clone(elements[idx]);copy.solidPoints=(copy.solidPoints||[]).map(m=>({...m,pendingPlane:false}));copy.planes=[...(copy.planes||[]),{id:uid(),ids:solidPlanePick.ids.slice(0,3),color:'#292b33',sectionColor:'#ED591A'}];elements[idx]=copy;solidPlanePick=null;changed();toast('Плоскость через три точки построена');return;
      }
      if(tool==='solid-rotate'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Кликните и тяните по 3D фигуре');selectOnly(o.id);pushElementsHistory();solidRotateStart={id:o.id,cx:e.clientX,cy:e.clientY,rotX:Number(o.rotX??-.42),rotY:Number(o.rotY??.62)};return;
      }
      if(tool==='select'){
        const handle=e.target?.dataset?.resizeHandle,rot=e.target?.dataset?.rotateHandle,additive=!!(e.shiftKey||e.ctrlKey||e.metaKey);
        const chosen=selectionCount()===1?elements.find(z=>z.id===selected):null;
        if(rot&&chosen){if(!canTransformObject(chosen))return toast(chosen.locked?'Объект закреплён':'Редактирование ограничено');pushElementsHistory();const c=objectCenter(chosen);rotationStart={orig:clone(chosen),cx:c.x,cy:c.y,start:Math.atan2(y-c.y,x-c.x),base:Number(chosen.rotation||0)};return}
        if(handle&&chosen){if(!canTransformObject(chosen))return toast(chosen.locked?'Объект закреплён':'Редактирование ограничено');pushElementsHistory();resizeStart={handle,orig:clone(chosen),b:bounds(chosen)};return}
        const o=hit(x,y);
        if(o){
          if(additive){toggleSelection(o.id);render();return}
          if(!selectionHas(o.id))selectOnly(o.id);
          const ids=selectionList(),objs=ids.map(id=>elements.find(z=>z.id===id)).filter(Boolean);
          if(objs.length&&objs.every(canTransformObject)){
            pushElementsHistory();
            moveStart={x,y,group:objs.map(obj=>({id:obj.id,orig:clone(obj)}))};
          }
          render();return;
        }
        marqueeSelect={x0:x,y0:y,x1:x,y1:y,baseIds:additive?selectionList():[],additive};
        if(!additive)clearSelection();
        render();return;
      }
      if(tool==='compass'){
        e.preventDefault();
        if(!compassDraft){
          pushElementsHistory();
          compassDraft={id:uid(),type:'arc',cx:x,cy:y,r:1,a1:0,a2:.015,sweep:.015,color:'#15171a',width:3,stage:'radius'};
          elements.push(compassDraft);render();toast('Циркуль: центр выбран · наведи радиус и кликни точку начала дуги');return;
        }
        if(compassDraft.stage==='radius'){
          const r=Math.hypot(x-compassDraft.cx,y-compassDraft.cy);if(r<8)return toast('Сделай радиус немного больше');
          compassDraft.r=r;compassDraft.a1=Math.atan2(y-compassDraft.cy,x-compassDraft.cx);compassDraft.a2=compassDraft.a1+.015;compassDraft.sweep=.015;compassDraft.stage='arc';compassDraft.lastRaw=compassDraft.a1;compassDraft.total=0;render();toast('Начальная точка зафиксирована · веди курсор по окружности и кликни конечную точку');return;
        }
        if(compassDraft.stage==='arc'){
          if(Math.abs(compassDraft.total||0)<.04)return toast('Проведи дугу по окружности перед фиксацией');
          delete compassDraft.stage;delete compassDraft.lastRaw;delete compassDraft.total;compassDraft=null;changed();toast('Дуга построена');return;
        }
      }
      pushElementsHistory();drawing={id:uid(),type:tool,color,width};
      if(tool==='pen'||tool==='pencil'){drawing.type='path';drawing.points=[[x,y]];if(tool==='pencil'){drawing.color=color==='#15171a'?'#4b5563':color;drawing.width=Math.max(1.5,width*.72);drawing.opacity=.72}}else Object.assign(drawing,{x1:x,y1:y,x2:x,y2:y});
      elements.push(drawing);render();
    };
    svg.onpointermove=e=>{
      let[x,y]=screenToWorld(e.clientX,e.clientY);sendCursor(x,y);
      if(!['pen','pencil','marker','laser','eraser','compass','solid-rotate'].includes(tool))[x,y]=geometrySnapPoint(x,y,selectionList());
      if(marqueeSelect&&tool==='select'){marqueeSelect.x1=x;marqueeSelect.y1=y;renderInteractive();return}
      if(tool==='eraser'){eraserPoint={x,y};if(eraserDown){const last=eraserTrail[eraserTrail.length-1];if(!last||Math.hypot(x-last[0],y-last[1])>2/camera.zoom)eraserTrail.push([x,y]);const o=eraserHitAllowed(x,y,18/camera.zoom);if(o&&!o.locked){elements=elements.filter(z=>z.id!==o.id);if(selectionHas(o.id)){const next=selectionList().filter(id=>id!==o.id);setSelection(next)}changed()}else renderInteractive()}else renderInteractive();return}
      if(tool==='laser'&&laserPoint){laserPoint={x,y};broadcastTransient('laser',{point:laserPoint});renderInteractive();return}
      if(tool==='marker'&&drawing?.type==='marker-temp'){appendFreehandPoints(drawing,e);renderInteractive();broadcastTransient('marker',{mark:{...drawing,expires:Date.now()+5000}});return}
      if(tool==='focus'&&focusDraft){focusDraft.x1=x;focusDraft.y1=y;focusRect={x:Math.min(focusDraft.x0,x),y:Math.min(focusDraft.y0,y),w:Math.abs(x-focusDraft.x0),h:Math.abs(y-focusDraft.y0)};render();return}
      if(compassDraft&&tool==='compass'&&!drawing){
        if(compassDraft.stage==='radius'){
          compassDraft.r=Math.max(1,Math.hypot(x-compassDraft.cx,y-compassDraft.cy));
          compassDraft.a1=Math.atan2(y-compassDraft.cy,x-compassDraft.cx);compassDraft.a2=compassDraft.a1+.015;compassDraft.sweep=.015;renderInteractive();return;
        }
        if(compassDraft.stage==='arc'){
          const raw=Math.atan2(y-compassDraft.cy,x-compassDraft.cx),delta=normalizeAngleDelta(raw-Number(compassDraft.lastRaw??compassDraft.a1)),max=Math.PI*2-.03;
          compassDraft.total=Math.max(-max,Math.min(max,Number(compassDraft.total||0)+delta));compassDraft.lastRaw=raw;
          const sw=Math.abs(compassDraft.total)<.015?(compassDraft.total<0?-.015:.015):compassDraft.total;compassDraft.sweep=sw;compassDraft.a2=compassDraft.a1+sw;renderInteractive();return;
        }
      }
      if(solidRotateStart){const idx=elements.findIndex(z=>z.id===solidRotateStart.id);if(idx<0)return;transformDirty=true;const copy=clone(elements[idx]);copy.rotY=solidRotateStart.rotY+(e.clientX-solidRotateStart.cx)*.012;copy.rotX=solidRotateStart.rotX+(e.clientY-solidRotateStart.cy)*.012;elements[idx]=copy;renderInteractive();broadcast();return}
      if(panStart){e.preventDefault();document.getSelection?.()?.removeAllRanges?.();camera.x=panStart.x-(e.clientX-panStart.cx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.cy)/camera.zoom;render();sendViewport();return}
      if(rotationStart&&selected){const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;transformDirty=true;const a=Math.atan2(y-rotationStart.cy,x-rotationStart.cx),deg=rotationStart.base+(a-rotationStart.start)*180/Math.PI;elements[idx]={...rotationStart.orig,rotation:e.shiftKey?Math.round(deg/15)*15:deg};render();broadcast();return}
      if(resizeStart&&selected){
        const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;transformDirty=true;
        const b=resizeStart.b,min=18/camera.zoom;let x0=b.x,y0=b.y,x1=b.x+b.w,y1=b.y+b.h,h=resizeStart.handle;
        if(h.includes('w'))x0=Math.min(x,x1-min);if(h.includes('e'))x1=Math.max(x,x0+min);
        if(h.includes('n'))y0=Math.min(y,y1-min);if(h.includes('s'))y1=Math.max(y,y0+min);
        elements[idx]=scaledToBounds(resizeStart.orig,b,{x:x0,y:y0,w:x1-x0,h:y1-y0});render();broadcast();return;
      }
      if(moveStart&&selected){let dx=x-moveStart.x,dy=y-moveStart.y;if(Math.abs(dx)>.01||Math.abs(dy)>.01)transformDirty=true;if(snapEnabled){dx=Math.round(dx/10)*10;dy=Math.round(dy/10)*10}if(Array.isArray(moveStart.group)){for(const item of moveStart.group){const idx=elements.findIndex(z=>z.id===item.id);if(idx>=0)elements[idx]=translated(item.orig,dx,dy)}}else{const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;elements[idx]=translated(moveStart.orig,dx,dy)}render();broadcast();return}
      if(!drawing)return;
      if(drawing.type==='path'){appendFreehandPoints(drawing,e);renderInteractive();broadcast();return}
      if(drawing.type==='compass')drawing.r=Math.max(1,Math.hypot(x-drawing.cx,y-drawing.cy));else{let xx=x,yy=y;if(e.shiftKey&&['line','arrow','ruler'].includes(drawing.type)){const dx=x-drawing.x1,dy=y-drawing.y1,a=Math.atan2(dy,dx),step=Math.PI/4,aa=Math.round(a/step)*step,len=Math.hypot(dx,dy);xx=drawing.x1+Math.cos(aa)*len;yy=drawing.y1+Math.sin(aa)*len}drawing.x2=xx;drawing.y2=yy}render();broadcast();
    };
    const finishPointer=()=>{
      if(marqueeSelect){
        const m=marqueeSelect;marqueeSelect=null;const x0=Math.min(m.x0,m.x1),y0=Math.min(m.y0,m.y1),x1=Math.max(m.x0,m.x1),y1=Math.max(m.y0,m.y1),tiny=Math.abs(x1-x0)<3/camera.zoom&&Math.abs(y1-y0)<3/camera.zoom;
        if(tiny){setSelection(m.baseIds||[])}else{
          const mr=marqueeRect(x0,y0,x1,y1);const hitIds=elements.filter(o=>o.type!=='board-bg'&&(!o.teacherOnly||isTeacher)).filter(o=>marqueeHitsObject(o,mr)).map(o=>o.id);
          setSelection([...(m.baseIds||[]),...hitIds]);
          if(selectionCount()>1)toast(`${selectionCount()} объектов выбрано`);
        }
        render();return;
      }
      if(eraserDown){eraserDown=false;scheduleSave();broadcast();render();setTimeout(()=>{eraserTrail=[];if(tool==='eraser')render()},260)}
      if(tool==='laser'&&laserPoint){laserPoint=null;broadcastTransient('laser',{point:null});render()}
      if(tool==='marker'&&drawing?.type==='marker-temp'){const mark={...drawing,expires:Date.now()+5000};drawing=null;broadcastTransient('marker',{mark});setTimeout(render,5100)}
      if(tool==='focus'&&focusDraft){focusDraft=null;if(focusRect?.w<5||focusRect?.h<5)focusRect=null;broadcastTransient('focus',{rect:focusRect});render()}
      const hadTransform=!!(moveStart||resizeStart||rotationStart||solidRotateStart);
      if(hadTransform&&!transformDirty){const last=undoStack[undoStack.length-1];if(last?.type==='elements'&&last.pageId===current.id&&JSON.stringify(last.elements)===JSON.stringify(elements))undoStack.pop();syncHistoryButtons()}
      if(drawing&&drawing.type!=='marker-temp'||hadTransform){drawing=null;moveStart=null;resizeStart=null;rotationStart=null;solidRotateStart=null;if(!hadTransform||transformDirty)changed();else render()}
      transformDirty=false;if(panStart&&tool==='hand')svg.style.cursor='grab';panStart=null;
    };
    svg.onpointerup=finishPointer;
    svg.onpointercancel=finishPointer;
    svg.onpointerleave=()=>{if(!eraserDown&&eraserPoint){eraserPoint=null;render()}};
    svg.onwheel=e=>{e.preventDefault();const[wx,wy]=screenToWorld(e.clientX,e.clientY),nz=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3),r=svg.getBoundingClientRect();camera.x=wx-(e.clientX-r.left)/nz;camera.y=wy-(e.clientY-r.top)/nz;camera.zoom=nz;zoomLabel.textContent=Math.round(nz*100)+'%';render();sendViewport()};
    svg.ondblclick=async e=>{const[x,y]=screenToWorld(e.clientX,e.clientY),o=hit(x,y);if(!o)return;if(o.type==='attachment'){const url=await ensureAsset(o.assetPath);if(url)window.open(url,'_blank','noopener');return}if(o.type==='solid3d'){selectOnly(o.id);setTool('solid-rotate');toast('Режим вращения 3D: зажмите фигуру и тяните мышью');return}if(['text','formula','graph','note'].includes(o.type)){selectOnly(o.id);editSelected()}};

    const ctl=s=>root.querySelector(s),bind=(s,ev,fn)=>{const el=ctl(s);if(!el){console.warn('[Mathroom board] control missing',s);return null}el.addEventListener(ev,fn);return el};
    root.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>{setTool(b.dataset.tool);b.closest('.board-tool-group')?.removeAttribute('open')}));
    const positionPopover=d=>{const pop=d.querySelector('.board-tool-popover'),summary=d.querySelector('summary');if(!pop||!summary)return;requestAnimationFrame(()=>{const r=summary.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight,left=Math.max(8,Math.min(vw-260,r.right+10)),available=Math.max(220,vh-24),desired=Math.min(pop.scrollHeight||460,available),top=Math.max(12,Math.min(r.top,vh-desired-12));pop.style.setProperty('--mr-pop-left',`${left}px`);pop.style.setProperty('--mr-pop-top',`${top}px`);pop.style.setProperty('--mr-pop-maxh',`${Math.max(220,vh-top-12)}px`)})};
    root.querySelectorAll('.board-tool-group').forEach(d=>{
      d.addEventListener('toggle',()=>{if(!d.open)return;root.querySelectorAll('.board-tool-group').forEach(x=>{if(x!==d)x.removeAttribute('open')});positionPopover(d)});
      const pop=d.querySelector('.board-tool-popover');
      if(pop)pop.addEventListener('click',e=>{const button=e.target.closest?.('button');if(!button||button.disabled)return;setTimeout(()=>d.removeAttribute('open'),0)});
    });
    root.querySelectorAll('[data-color]').forEach(b=>b.addEventListener('click',()=>{color=b.dataset.color;root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b))}));
    bind('#strokeWidth','change',e=>width=Number(e.target.value));
    bind('#undo','click',()=>undo());bind('#redo','click',()=>redo());bind('#copySelected','click',copySelected);bind('#pasteSelected','click',pasteSelected);bind('#duplicateSelected','click',duplicateSelected);bind('#lockSelected','click',toggleLockSelected);bind('#bringForward','click',()=>reorderSelected('forward'));bind('#sendBackward','click',()=>reorderSelected('backward'));bind('#bringFront','click',()=>reorderSelected('front'));bind('#sendBack','click',()=>reorderSelected('back'));bind('#pasteSystemClipboard','click',readSystemClipboard);bind('#deleteSelected','click',deleteSelected);
    bind('#gridToggle','click',()=>{grid=!grid;ctl('#gridToggle')?.classList.toggle('active',grid);render()});ctl('#gridToggle')?.classList.add('active');bind('#snapToggle','click',()=>{snapEnabled=!snapEnabled;ctl('#snapToggle')?.classList.toggle('active',snapEnabled);toast(snapEnabled?'Привязка включена':'Привязка выключена')});bind('#fitView','click',fitAll);

    let boardFullscreenVideoState=null;
    const moveLessonVideoIntoFullscreen=()=>{
      const card=root.querySelector('.board-card');
      const video=document.querySelector('#mrVideoPanel');
      if(!card||!video||card.contains(video)||!video.classList.contains('joined'))return;
      const savedPosition={};
      for(const prop of ['left','top','right','bottom']){
        savedPosition[prop]={
          value:video.style.getPropertyValue(prop),
          priority:video.style.getPropertyPriority(prop)
        };
        video.style.removeProperty(prop);
      }
      boardFullscreenVideoState={video,parent:video.parentNode,next:video.nextSibling,savedPosition};
      video.classList.add('mr-board-fullscreen-video');
      card.appendChild(video);
    };
    const restoreLessonVideoAfterFullscreen=()=>{
      const state=boardFullscreenVideoState;
      if(!state)return;
      const {video,parent,next,savedPosition}=state;
      video.classList.remove('mr-board-fullscreen-video');
      if(parent?.isConnected){
        if(next&&next.parentNode===parent)parent.insertBefore(video,next);
        else parent.appendChild(video);
      }
      for(const prop of ['left','top','right','bottom']){
        video.style.removeProperty(prop);
        const saved=savedPosition?.[prop];
        if(saved?.value)video.style.setProperty(prop,saved.value,saved.priority||'');
      }
      boardFullscreenVideoState=null;
      requestAnimationFrame(()=>{
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new CustomEvent('mathroom:board-video-restored'));
      });
    };
    const toggleBoardFullscreen=async()=>{
      const card=root.querySelector('.board-card');
      if(!card)return;
      if(!document.fullscreenElement){
        moveLessonVideoIntoFullscreen();
        try{await card.requestFullscreen?.()}
        catch(e){restoreLessonVideoAfterFullscreen();throw e}
      }else{
        await document.exitFullscreen?.();
      }
    };
    document.addEventListener('fullscreenchange',()=>{
      const card=root.querySelector('.board-card');
      if(document.fullscreenElement===card){
        card.querySelector('#mrVideoPanel')?.classList.add('mr-board-fullscreen-video');
      }else{
        restoreLessonVideoAfterFullscreen();
      }
    });

    bind('#zoomIn','click',()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render();sendViewport(true)});bind('#zoomOut','click',()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render();sendViewport(true)});bind('#homeView','click',()=>{camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';render();sendViewport(true)});bind('#quickCommands','click',openQuickCommands);bind('#fullscreen','click',()=>{toggleBoardFullscreen().catch(fail)});
    root.querySelectorAll('[data-object-action]').forEach(b=>b.onclick=()=>{const a=b.dataset.objectAction;if(a==='duplicate')duplicateSelected();else if(a==='lock')toggleLockSelected();else if(a==='front')reorderSelected('front');else if(a==='back')reorderSelected('back');else if(a==='fill')fillSelected();else if(a==='edit')editSelected();else if(a==='delete')deleteSelected()});
    const isMathroomTaskDrag=e=>[...(e.dataTransfer?.types||[])].includes('application/x-mathroom-task');
    stage.addEventListener('dragenter',e=>{if(!isTeacher||(!isFileDrag(e)&&!isMathroomTaskDrag(e)))return;e.preventDefault();fileDragDepth++;stage.classList.add('drag-active')});
    stage.addEventListener('dragover',e=>{if(!isTeacher||(!isFileDrag(e)&&!isMathroomTaskDrag(e)))return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';stage.classList.add('drag-active')});
    stage.addEventListener('dragleave',e=>{if(!isTeacher||(!isFileDrag(e)&&!isMathroomTaskDrag(e)))return;fileDragDepth=Math.max(0,fileDragDepth-1);const next=e.relatedTarget;if(fileDragDepth===0||!stage.contains(next))clearDragOverlay()});
    stage.addEventListener('drop',async e=>{
      if(!isTeacher)return;
      const taskDrag=isMathroomTaskDrag(e);
      if(isFileDrag(e)||taskDrag)e.preventDefault();
      clearDragOverlay();
      const files=[...(e.dataTransfer?.files||[])];
      if(files.length){for(const f of files)await handleImport(f);return}
      if(taskDrag){
        try{
          const raw=e.dataTransfer?.getData('application/x-mathroom-task');
          const task=raw?JSON.parse(raw):null;
          if(task?.prompt||task?.title){
            const [x,y]=screenToWorld(e.clientX,e.clientY);
            addText(`${task.title||'Задача'}\n${task.prompt||''}`,{fontSize:25,x,y});
            toast('Задача добавлена в выбранное место');
            return;
          }
        }catch(err){console.warn('[Mathroom board task drop]',err)}
      }
      const text=e.dataTransfer?.getData('text/plain');
      if(text){const [x,y]=screenToWorld(e.clientX,e.clientY);addText(text,{fontSize:26,x,y})}
    });
    stage.addEventListener('pointerdown',clearDragOverlay,true);
    stage.addEventListener('selectstart',e=>{if(tool==='hand'||tool==='select'||tool==='pen'||tool==='pencil'||tool==='eraser'||tool==='compass')e.preventDefault()});
    stage.addEventListener('dragstart',e=>{if(tool==='hand')e.preventDefault()});
    window.addEventListener('dragend',clearDragOverlay,true);
    window.addEventListener('drop',clearDragOverlay,true);

    if(isTeacher){
      root.querySelector('#boardBackground')&&(root.querySelector('#boardBackground').onclick=openBackgroundPicker);
      root.querySelector('#duplicatePage')&&(root.querySelector('#duplicatePage').onclick=()=>duplicateCurrentPage().catch(fail));root.querySelector('#pageLeft')&&(root.querySelector('#pageLeft').onclick=()=>moveCurrentPage(-1).catch(fail));root.querySelector('#pageRight')&&(root.querySelector('#pageRight').onclick=()=>moveCurrentPage(1).catch(fail));
      root.querySelector('#followTeacherToggle')&&(root.querySelector('#followTeacherToggle').onclick=()=>{followTeacher=!followTeacher;persistClassroom();syncClassroomUi();sendViewport(true);toast(followTeacher?'Ученик следует за вашей областью доски':'Свободное перемещение ученика')});
      root.querySelector('#studentBoardMode')&&(root.querySelector('#studentBoardMode').onchange=e=>{classroomMode=e.target.value;persistClassroom();toast(classroomMode==='open'?'Ученик может редактировать доску':classroomMode==='pen'?'Ученик может только писать':'Доска ученика заблокирована')});
      bind('#formulaTool','click',()=>{const raw=prompt('Формула:','x^2 + y^2 = r^2');if(!raw)return;pushElementsHistory();elements.push({id:uid(),type:'formula',x:camera.x+200/camera.zoom,y:camera.y+110/camera.zoom,text:prettyFormula(raw),source:raw,color,fontSize:32});changed()});
      bind('#protractorTool','click',()=>{pushElementsHistory();const obj={id:uid(),type:'protractor',x:camera.x+360/camera.zoom,y:camera.y+300/camera.zoom,r:180,color};elements.push(obj);selectOnly(obj.id);changed();setTool('select')});
      bind('#templatesBoard','click',openTemplates);root.querySelector('#assetLibrary')&&(root.querySelector('#assetLibrary').onclick=openAssetLibrary);bind('#toggleHidden','click',toggleHidden);bind('#revealHidden','click',revealNextHidden);bind('#cropImage','click',cropSelectedImage);bind('#screenCapture','click',captureScreen);bind('#boardHistory','click',openBoardHistory);root.querySelector('#resetLessonStart')&&(root.querySelector('#resetLessonStart').onclick=resetToLessonStart);bind('#clearFocus','click',()=>{focusRect=null;remoteFocusRect=null;broadcastTransient('focus',{rect:null});render()});
      root.querySelector('#toScratch')&&(root.querySelector('#toScratch').onclick=copyToScratch);root.querySelector('#fromScratch')&&(root.querySelector('#fromScratch').onclick=copyFromScratch);
      bind('#coordinatePlane','click',()=>{pushElementsHistory();const obj={id:uid(),type:'coordinate',x:camera.x+190/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,baseW:680,baseH:460,rangeXBase:10,rangeYBase:7,rangeX:10,rangeY:7};elements.push(obj);selectOnly(obj.id);setTool('select');changed();toast('Координатная плоскость добавлена · при растягивании шкала автоматически продолжается до больших значений')});
      bind('#functionGraph','click',()=>{const expr=prompt('Функция y =','x^2 - 4');if(!expr)return;try{const segments=graphSegments(expr);pushElementsHistory();const obj={id:uid(),type:'graph',x:camera.x+190/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,baseW:680,baseH:460,rangeXBase:10,rangeYBase:7,rangeX:10,rangeY:7,expression:expr,segments,color:'#ED591A'};elements.push(obj);selectOnly(obj.id);setTool('select');changed();toast('График добавлен · растягивайте рамку: диапазон осей и сам график продолжатся автоматически')}catch(e){fail(e)}});
      const insertShapeTemplate=v=>{if(!v)return;const x=camera.x+260/camera.zoom,y=camera.y+130/camera.zoom;let pts=null,obj=null;if(v==='triangle')pts=[[x+160,y],[x,y+250],[x+320,y+250]];if(v==='right')pts=[[x,y],[x,y+250],[x+320,y+250]];if(v==='isosceles')pts=[[x+160,y],[x+30,y+250],[x+290,y+250]];if(v==='equilateral')pts=[[x+160,y],[x+20,y+242],[x+300,y+242]];if(v==='rectangle')obj={id:uid(),type:'rect',x1:x,y1:y,x2:x+340,y2:y+220,color,width};if(v==='square')pts=[[x,y],[x+260,y],[x+260,y+260],[x,y+260]];if(v==='rhombus')pts=[[x+160,y],[x+320,y+150],[x+160,y+300],[x,y+150]];if(v==='parallelogram')pts=[[x+70,y],[x+330,y],[x+260,y+220],[x,y+220]];if(v==='trapezoid')pts=[[x+80,y],[x+260,y],[x+340,y+220],[x,y+220]];if(v==='iso_trapezoid')pts=[[x+90,y],[x+250,y],[x+330,y+220],[x+10,y+220]];if(v==='circle')obj={id:uid(),type:'ellipse',x1:x,y1:y,x2:x+260,y2:y+260,color,width};if(v==='ellipse')obj={id:uid(),type:'ellipse',x1:x,y1:y+30,x2:x+340,y2:y+220,color,width};if(v==='hexagon'){pts=[];for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;pts.push([x+170+150*Math.cos(a),y+150+150*Math.sin(a)])}}if(pts)obj={id:uid(),type:'polygon',points:pts,color,width};if(obj){pushElementsHistory();elements.push(obj);selectOnly(obj.id);setTool('select');changed()}};
      const insertSolidTemplate=v=>{if(!v)return;pushElementsHistory();const obj={id:uid(),type:'solid3d',shape:v,x:camera.x+210/camera.zoom,y:camera.y+80/camera.zoom,w:440,h:340,rotX:-.42,rotY:.62,rotZ:0,color:'#15171a',solidPoints:[],planes:[]};elements.push(obj);selectOnly(obj.id);setTool('select');changed();toast(`${solidNames[v]||'3D фигура'} добавлена · тяните за оранжевые маркеры рамки для изменения размера`)};
      const scaleSelectedSolid=f=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');pushElementsHistory();const o=clone(elements[idx]),cx=o.x+(o.w||440)/2,cy=o.y+(o.h||340)/2,nw=clamp((o.w||440)*f,160,1600),nh=clamp((o.h||340)*f,130,1200);o.x=cx-nw/2;o.y=cy-nh/2;o.w=nw;o.h=nh;elements[idx]=o;changed()};
      root.addEventListener('click',e=>{const shapeBtn=e.target.closest?.('[data-shape-template]'),solidBtn=e.target.closest?.('[data-solid-template]');if(shapeBtn&&root.contains(shapeBtn)){e.preventDefault();e.stopPropagation();insertShapeTemplate(shapeBtn.dataset.shapeTemplate);shapeBtn.closest('.board-tool-group')?.removeAttribute('open');return}if(solidBtn&&root.contains(solidBtn)){e.preventDefault();e.stopPropagation();insertSolidTemplate(solidBtn.dataset.solidTemplate);solidBtn.closest('.board-tool-group')?.removeAttribute('open')}},true);
      const resetSelectedSolid=()=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');pushElementsHistory();elements[idx]={...elements[idx],rotX:-.42,rotY:.62,rotZ:0};changed();toast('Вид 3D фигуры сброшен')};
      const clearSelectedSolid=()=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');if(!confirm('Удалить все точки и построенные плоскости на этой 3D фигуре?'))return;pushElementsHistory();elements[idx]={...elements[idx],solidPoints:[],planes:[]};solidPlanePick=null;changed();toast('Точки и плоскости очищены')};
      root.querySelectorAll('[data-solid-hud]').forEach(b=>b.onclick=()=>{const a=b.dataset.solidHud;if(a==='rotate')setTool('solid-rotate');else if(a==='point')setTool('solid-point');else if(a==='plane')setTool('solid-plane');else if(a==='smaller')scaleSelectedSolid(.9);else if(a==='larger')scaleSelectedSolid(1.12);else if(a==='reset')resetSelectedSolid();else if(a==='clear')clearSelectedSolid()});
      bind('#importBoard','click',()=>ctl('#boardFile')?.click());bind('#boardFile','change',e=>handleImport(e.target.files?.[0]));bind('#exportPagePng','click',exportCurrentPng);bind('#exportAllPdf','click',exportAllPdf);
      bind('#addPage','click',async()=>{const title=prompt('Название листа:',`Лист ${pages.length+1}`);if(!title)return;try{const p=await createPage(title,[]);await switchPage(p.id)}catch(e){fail(e)}});
      bind('#renamePage','click',async()=>{const title=prompt('Название листа:',current.title);if(!title||title===current.title)return;if(!localOnly){const {error}=await sb.from('board_pages').update({title}).eq('id',current.id);if(error)return fail(error)}current.title=title;renderTabs();pagesChanged()});
      bind('#delPage','click',async()=>{if(pages.length<=1)return toast('Нельзя удалить единственный лист');if(!confirm('Удалить этот лист? Ctrl+Z сможет вернуть его.'))return;await save();const deleted=clone(current);undoStack.push({type:'deletePage',page:deleted});redoStack.length=0;try{await deletePageRecord(current.id)}catch(e){return fail(e)}pages=pages.filter(p=>p.id!==deleted.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChanged()});
      bind('#clearBoard','click',()=>{if(!elements.length||!confirm('Очистить текущий лист?'))return;pushElementsHistory();elements=[];clearSelection();changed()});
    }

    async function refreshPages(){if(localOnly){const stored=readLocal();if(!stored.length)return;const old=current?.id;pages=stored;const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();return}const {data}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(!data)return;const old=current?.id;pages=data.map(normalizePage);const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();joinChannel()}
    function broadcastTransient(kind,payload){channel?.send({type:'broadcast',event:'transient',payload:{pageId:current?.id,kind,...payload}}).catch(()=>{})}
    function joinChannel(){
      if(channel)sb.removeChannel(channel);channel=null;channelSubscribed=false;
      if(!current)return;
      if(localOnly){setSyncState('saved','Локальный черновик');return}
      setSyncState(boardNetworkOnline?'connecting':'offline');
      channel=sb.channel(`board:${current.id}`,{config:{private:true}})
        .on('broadcast',{event:'ops'},({payload})=>{
          if(payload?.pageId!==current.id)return;
          applyRemoteOps(payload.ops||[]);
        })
        .on('broadcast',{event:'state'},({payload})=>{
          if(payload?.pageId!==current.id||payload?.actor===actorKey)return;
          applyStateSnapshot(payload.elements||[]);
          setSyncState(boardNetworkOnline?'online':'offline');
        })
        .on('broadcast',{event:'transient'},({payload})=>{
          if(payload.pageId!==current.id)return;
          if(payload.kind==='laser')remoteLaser=payload.point||null;
          if(payload.kind==='focus')remoteFocusRect=payload.rect||null;
          if(payload.kind==='cursor'){
            remoteCursor=payload.point?{...payload.point,label:payload.label||(!isTeacher?'Преподаватель':'Ученик'),role:payload.role||'',expires:Date.now()+1800}:null;
            if(remoteCursor)setTimeout(()=>{if(remoteCursor&&remoteCursor.expires<=Date.now()){remoteCursor=null;render()}},1900);
          }
          if(payload.kind==='stroke'){
            const sid=payload.strokeId||payload.stroke?.id;
            if(sid){
              if(payload.phase==='start'){
                const s=normalizeElement(payload.stroke||{id:sid,type:'path',points:[]});
                if(s)remoteLiveStrokes.set(sid,{...s,points:[...(s.points||[])],expires:Date.now()+3500});
              }else if(payload.phase==='chunk'){
                const s=remoteLiveStrokes.get(sid);
                if(s){s.points.push(...(payload.points||[]));s.expires=Date.now()+3500}
              }else if(payload.phase==='end')remoteLiveStrokes.delete(sid);
            }
          }
          if(payload.kind==='marker'&&payload.mark){const i=remoteTempMarks.findIndex(x=>x.id===payload.mark.id),mark={...payload.mark,expires:Date.now()+5000};if(i>=0)remoteTempMarks[i]=mark;else remoteTempMarks.push(mark);setTimeout(render,5100)}
          if(payload.kind==='classroom'&&!isTeacher){classroomMode=payload.mode||'open';followTeacher=payload.follow!==false;if(classroomMode==='view')setTool('hand');else if(classroomMode==='pen'&&!['pen','pencil','eraser','hand'].includes(tool))setTool('pen');renderTabs();toast(classroomMode==='open'?'Доска открыта для совместной работы':classroomMode==='pen'?'Режим: только свои записи':'Режим: просмотр');}
          if(payload.kind==='viewport'&&!isTeacher&&followTeacher&&payload.camera){camera={...payload.camera};zoomLabel.textContent=Math.round(camera.zoom*100)+'%';}
          if(payload.kind==='hello'&&isTeacher){persistClassroom();sendViewport(true);broadcastState(true)}
          render();
        })
        .subscribe(s=>{
          channelSubscribed=s==='SUBSCRIBED';
          setSyncState(channelSubscribed?'online':(boardNetworkOnline?'connecting':'offline'));
          if(channelSubscribed){
            flushPendingOps();
            if(isTeacher){persistClassroom();sendViewport(true);broadcastState(true)}
            else broadcastTransient('hello',{role:'student'});
          }
        })
    }
    function wrapBoardText(text,maxChars=38){
      const parts=[];
      String(text||'').split('\n').forEach(rawLine=>{
        const line=String(rawLine||'').trim();
        if(!line){parts.push('');return}
        const words=line.split(/\s+/);
        let current='';
        words.forEach(word=>{
          const test=current?`${current} ${word}`:word;
          if(test.length>maxChars&&current){parts.push(current);current=word;}
          else current=test;
        });
        if(current)parts.push(current);
      });
      return parts.join('\n').replace(/\n{3,}/g,'\n\n').trim();
    }
    function theoryCardPalette(title=''){
      const key=String(title||'').toLowerCase();
      if(key.includes('суть'))return {fill:'#fff1e8',stroke:'#f2c2a8',title:'#b64d1f',text:'#1f2937'};
      if(key.includes('как'))return {fill:'#eef7ff',stroke:'#bfd9f7',title:'#1d4e89',text:'#1f2937'};
      if(key.includes('пример'))return {fill:'#f4f0ff',stroke:'#d8caf7',title:'#5b3ea8',text:'#1f2937'};
      if(key.includes('запомни'))return {fill:'#ecfdf3',stroke:'#b8e9c8',title:'#18794e',text:'#1f2937'};
      if(key.includes('ошиб'))return {fill:'#fff4db',stroke:'#f3d28a',title:'#b45309',text:'#1f2937'};
      return {fill:'#f7f7f6',stroke:'#d8d8d4',title:'#2b3240',text:'#1f2937'};
    }
    function addTheoryCards(title,blocks=[],opts={}){
      const items=Array.isArray(blocks)?blocks.filter(b=>b&&(b.title||b.body)):[];
      if(!items.length)return addText(title,{fontSize:28});
      pushElementsHistory();
      const boardW=960, gap=18, cardW=(boardW-gap)/2, titleH=92;
      const visibleW=Math.max(320,stage.clientWidth||svg.clientWidth||1200)/camera.zoom;
      const visibleH=Math.max(320,stage.clientHeight||svg.clientHeight||720)/camera.zoom;
      const startX=(opts.x!=null?opts.x:camera.x+Math.max(24/camera.zoom,(visibleW-boardW)/2));
      let y=(opts.y!=null?opts.y:camera.y+Math.max(34/camera.zoom,visibleH*.16));
      elements.push({id:uid(),type:'rect',x1:startX,y1:y,x2:startX+boardW,y2:y+titleH,color:'#f3b08f',fill:'#fff3ec',width:2});
      elements.push({id:uid(),type:'text',x:startX+26,y:y+36,text:'Тема урока',color:'#c56a3b',fontSize:15,fontWeight:700});
      elements.push({id:uid(),type:'text',x:startX+26,y:y+69,text:wrapBoardText(title,42),color:'#15171a',fontSize:30,fontWeight:800,lineHeight:1.18});
      y+=titleH+18;

      const lead=items[0];
      const leadPalette=theoryCardPalette(lead.title);
      const leadText=wrapBoardText(lead.body||'', 62);
      const leadLines=Math.max(1, leadText.split('\n').length);
      const leadH=Math.max(120, 64 + leadLines*24);
      elements.push({id:uid(),type:'rect',x1:startX,y1:y,x2:startX+boardW,y2:y+leadH,color:leadPalette.stroke,fill:leadPalette.fill,width:2});
      if(lead.title)elements.push({id:uid(),type:'text',x:startX+20,y:y+34,text:lead.title,color:leadPalette.title,fontSize:24,fontWeight:800});
      elements.push({id:uid(),type:'text',x:startX+22,y:y+70,text:leadText,color:leadPalette.text,fontSize:21,fontWeight:500,lineHeight:1.32});
      y+=leadH+18;

      let colY=[y,y];
      items.slice(1).forEach((block,idx)=>{
        const col=idx%2;
        const x=startX+col*(cardW+gap);
        const textWrapped=wrapBoardText(block.body||'', 28);
        const lines=Math.max(1,textWrapped.split('\n').length);
        const h=Math.max(128, 60 + lines*23);
        const pal=theoryCardPalette(block.title);
        const top=colY[col];
        elements.push({id:uid(),type:'rect',x1:x,y1:top,x2:x+cardW,y2:top+h,color:pal.stroke,fill:pal.fill,width:2});
        if(block.title)elements.push({id:uid(),type:'text',x:x+18,y:top+34,text:block.title,color:pal.title,fontSize:22,fontWeight:800});
        elements.push({id:uid(),type:'text',x:x+18,y:top+68,text:textWrapped,color:pal.text,fontSize:19,fontWeight:500,lineHeight:1.32});
        colY[col]=top+h+16;
      });
      changed();
    }
    function addText(text,opts={}){
      pushElementsHistory();
      const visibleW=Math.max(320,stage.clientWidth||svg.clientWidth||1200)/camera.zoom;
      const visibleH=Math.max(320,stage.clientHeight||svg.clientHeight||720)/camera.zoom;
      const x=opts.x!=null?opts.x:camera.x+visibleW*.5-220/camera.zoom;
      const y=opts.y!=null?opts.y:camera.y+visibleH*.48;
      elements.push({id:uid(),type:'text',x,y,text,color:opts.color||'#15171a',fontSize:opts.fontSize||28,fontWeight:opts.fontWeight||'',lineHeight:opts.lineHeight||1.25,fontFamily:opts.fontFamily||''});
      changed();
    }
    const isEditableTarget=el=>!!(el&&(el.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(el.tagName)));
    const activateBoardShortcuts=e=>{
      const target=e?.target;
      if(isEditableTarget(target)){boardFocused=false;return}
      if(target&&root.contains(target)){
        boardFocused=true;
        const ae=document.activeElement;
        if(isEditableTarget(ae)&&ae!==target)ae.blur?.();
      }
    };
    const deactivateBoardShortcuts=e=>{if(isEditableTarget(e?.target))boardFocused=false};
    const outsideBoardPointer=e=>{if(e?.target&&!root.contains(e.target))boardFocused=false};
    const key=e=>{
      if(e.key==='Escape'){solidPlanePick=null;clearPendingPlanePoints();if(compassDraft)cancelCompassDraft()}
      const ae=document.activeElement,isEditing=isEditableTarget(ae);
      const cmd=e.ctrlKey||e.metaKey,k=String(e.key||'').toLowerCase(),code=String(e.code||'');
      const undoKey=cmd&&(k==='z'||code==='KeyZ'),redoKey=cmd&&(k==='y'||code==='KeyY');
      if(undoKey&&boardFocused&&!isEditing){e.preventDefault();e.stopImmediatePropagation?.();e.shiftKey?redo():undo();return}
      if(redoKey&&boardFocused&&!isEditing){e.preventDefault();e.stopImmediatePropagation?.();redo();return}
      if(!boardFocused||isEditing)return;
      if(cmd&&(k==='c'||code==='KeyC')&&selected){e.preventDefault();copySelected()}
      else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();deleteSelected()}
      else if(e.code==='Space'&&!e.repeat){e.preventDefault();svg.dataset.prevTool=tool;setTool('hand')}
      else if(!cmd&&!e.altKey&&!e.shiftKey){
        const map={KeyP:'pen',KeyK:'pencil',KeyE:'eraser',KeyT:'text',KeyL:'line',KeyV:'select',KeyH:'hand',KeyF:'focus',KeyR:'ruler',KeyM:'marker',KeyX:'laser',KeyC:'compass'};
        const next=map[code]||({p:'pen',k:'pencil',e:'eraser',t:'text',l:'line',v:'select',h:'hand',f:'focus',r:'ruler',m:'marker',x:'laser',c:'compass'})[k];
        if(next&&(!['focus','ruler','marker','laser','compass'].includes(next)||isTeacher)){e.preventDefault();setTool(next)}
        else if(k==='g'||code==='KeyG'){e.preventDefault();grid=!grid;root.querySelector('#gridToggle').classList.toggle('active',grid);render()}
      }
    };
    const keyup=e=>{if(e.code==='Space'&&svg.dataset.prevTool){setTool(svg.dataset.prevTool);delete svg.dataset.prevTool}};
    root.addEventListener('pointerdown',activateBoardShortcuts,true);
    root.addEventListener('focusin',deactivateBoardShortcuts,true);
    document.addEventListener('pointerdown',outsideBoardPointer,true);
    window.addEventListener('keydown',key,true);
    window.addEventListener('keyup',keyup);
    window.addEventListener('paste',pasteExternal);
    if(!localOnly)pagesChannel=sb.channel(`student:${studentId}:pages`,{config:{private:true}}).on('broadcast',{event:'pages'},()=>refreshPages()).on('broadcast',{event:'navigate'},({payload})=>{if(!isTeacher&&followTeacher&&payload?.pageId)switchPage(payload.pageId,{fromLeader:true}).catch(()=>{})}).on('broadcast',{event:'hello'},()=>{if(isTeacher)persistClassroom()}).on('broadcast',{event:'classroom'},({payload})=>{if(isTeacher)return;classroomMode=payload?.mode||'open';followTeacher=payload?.follow!==false;if(followTeacher&&payload?.pageId&&payload.pageId!==current?.id)switchPage(payload.pageId,{fromLeader:true}).then(()=>{if(payload.camera){camera={...payload.camera};zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()}}).catch(()=>{});else if(payload?.camera&&followTeacher){camera={...payload.camera};zoomLabel.textContent=Math.round(camera.zoom*100)+'%'};if(classroomMode==='view')setTool('hand');else if(classroomMode==='pen'&&!['pen','pencil','eraser','hand'].includes(tool))setTool('pen');renderTabs();render()}).subscribe(s=>{if(s==='SUBSCRIBED'){if(isTeacher)persistClassroom();else pagesChannel?.send({type:'broadcast',event:'hello',payload:{role:'student'}}).catch(()=>{})}});renderTabs();render();joinChannel();
    if(lessonId&&isTeacher){if(!readCheckpoints().length)setTimeout(()=>saveCheckpoint('Начало урока'),800);checkpointTimer=setInterval(()=>saveCheckpoint('Авто · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})).catch(()=>{}),5*60*1000)}
    const cleanup=()=>{clearTimeout(saveTimer);clearInterval(checkpointTimer);root.removeEventListener('pointerdown',activateBoardShortcuts,true);root.removeEventListener('focusin',deactivateBoardShortcuts,true);document.removeEventListener('pointerdown',outsideBoardPointer,true);window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',keyup);window.removeEventListener('paste',pasteExternal);window.removeEventListener('dragend',clearDragOverlay,true);window.removeEventListener('drop',clearDragOverlay,true);if(channel)sb.removeChannel(channel);if(pagesChannel)sb.removeChannel(pagesChannel)};S.boardCleanup=cleanup;
    return {addText,addTheoryCards,importPdfBlob,undo,redo,save,fitAll,exportPage:exportCurrentPng,exportAll:exportAllPdf,getPages:()=>pages.map(p=>({...p,elements:p.id===current.id?clone(elements):clone(p.elements||[])})),checkpoint:saveCheckpoint,restoreStart:resetToLessonStart,copyToScratch,copyFromScratch,setTool,readClipboard:readSystemClipboard,clearFocus:()=>{focusRect=null;broadcastTransient('focus',{rect:null});render()}};
  }

  function mountSnapshot(root,pages){
    if(!pages?.length){root.innerHTML='<div class="empty">В этой версии нет листов.</div>';return}
    let current=pages[0],camera={x:0,y:0,zoom:1},pan=null;
    root.innerHTML=`<div class="board-card readonly"><div class="board-page-tabs" id="snapTabs"></div><div class="board-toolbar"><span class="pill">Только просмотр</span><span class="board-status">Сохранённая версия</span></div><div class="board-stage"><svg id="snapSvg"></svg><div class="board-floating"><button class="btn sm" id="snapOut">−</button><span class="btn sm" id="snapZoom">100%</span><button class="btn sm" id="snapIn">+</button><button class="btn sm" id="snapHome">⌂</button></div></div></div>`;
    const svg=root.querySelector('#snapSvg'),tabs=root.querySelector('#snapTabs'),zl=root.querySelector('#snapZoom');
    const need=path=>{if(!path||assetCache.has(path)||assetPending.has(path))return;ensureAsset(path).then(()=>render())};const render=()=>drawElements(svg,current.elements||[],camera,null,true,need,true);
    const renderTabs=()=>{tabs.innerHTML=pages.map(p=>`<button class="btn sm ${p===current?'primary':''}">${esc(p.title||'Лист')}</button>`).join('');[...tabs.children].forEach((b,i)=>b.onclick=()=>{current=pages[i];camera={x:0,y:0,zoom:1};zl.textContent='100%';renderTabs();render()})};
    svg.onpointerdown=e=>{svg.setPointerCapture(e.pointerId);pan={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y}};svg.onpointermove=e=>{if(!pan)return;camera.x=pan.cx-(e.clientX-pan.x)/camera.zoom;camera.y=pan.cy-(e.clientY-pan.y)/camera.zoom;render()};svg.onpointerup=()=>pan=null;svg.onwheel=e=>{e.preventDefault();camera.zoom=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};
    root.querySelector('#snapIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zl.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#snapHome').onclick=()=>{camera={x:0,y:0,zoom:1};zl.textContent='100%';render()};renderTabs();render();
  }

  window.MathroomBoard={mountBoard,mountSnapshot};
})();
