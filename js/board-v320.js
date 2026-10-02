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
    return{d:`M ${sx} ${sy} A ${r} ${r} 0 ${large} ${dir} ${ex} ${ey}`,sx,sy,ex,ey,d:Math.abs(sweep),sweep,a2};
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
      const A=raw[0],B=raw[1],C=raw[2],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)},u=norm(sub(B,A)),normal=norm(cross(sub(B,A),sub(C,A))),v=norm(cross(normal,u)),center=[(A[0]+B[0]+C[0])/3,(A[1]+B[1]+C[1])/3,(A[2]+B[2]+C[2])/3],coords=raw.map(P=>{const d=sub(P,center);return[dot(d,u),dot(d,v)]}),us=coords.map(q=>q[0]),vs=coords.map(q=>q[1]),pad=.58,umin=Math.min(...us)-pad,umax=Math.max(...us)+pad,vmin=Math.min(...vs)-pad,vmax=Math.max(...vs)+pad,pt=(uu,vv)=>[center[0]+u[0]*uu+v[0]*vv,center[1]+u[1]*uu+v[1]*vv,center[2]+u[2]*uu+v[2]*vv],corners=[[umin,vmin],[umax,vmin],[umax,vmax],[umin,vmax]].map(q=>projectSolidPoint(o,pt(q[0],q[1])));
      n.appendChild(svgEl('polygon',{points:corners.map(p=>`${p.x},${p.y}`).join(' '),fill:pl.color||accent,opacity:.10,stroke:pl.color||accent,'stroke-width':1.5,'stroke-dasharray':'7 6','stroke-linejoin':'round'}));
      const section=planeSectionPoints(model,A,B,C);if(section.length>=3){const sp=section.map(P=>projectSolidPoint(o,P));n.appendChild(svgEl('polygon',{points:sp.map(p=>`${p.x},${p.y}`).join(' '),fill:pl.color||accent,opacity:.22,stroke:pl.color||accent,'stroke-width':2.8,'stroke-linejoin':'round'}))}
      const lab=projectSolidPoint(o,center),tt=svgEl('text',{x:lab.x+8,y:lab.y-8,fill:pl.color||accent,'font-size':13,'font-weight':800});tt.textContent='α';n.appendChild(tt);
    }
    const edges=model.edges.map(([a,b])=>({a,b,z:(projected[a].z+projected[b].z)/2})).sort((A,B)=>A.z-B.z);for(const e of edges){const a=projected[e.a],b=projected[e.b],hidden=e.z<-.18;n.appendChild(svgEl('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':hidden?1.2:2.2,'stroke-dasharray':hidden?'6 6':'','stroke-linecap':'round',opacity:hidden?.35:.96}))}
    for(const m of o.solidPoints||[]){const p=projectSolidPoint(o,m.p);n.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:6.5,fill:'#fff',stroke:accent,'stroke-width':2.3}));const t=svgEl('text',{x:p.x+9,y:p.y-8,fill:accent,'font-size':15,'font-weight':800,'font-family':'Unbounded,Arial,sans-serif'});t.textContent=m.label||'•';n.appendChild(t)}
    const title=svgEl('text',{x:o.x+10,y:o.y+20,fill:'#73736f','font-size':11,'font-weight':700});title.textContent=solidNames[o.shape]||'3D фигура';n.appendChild(title);g.appendChild(n);return n;
  }

  function drawElements(svg,elements,camera,selected=null,grid=false,onAssetNeeded=null,viewerIsTeacher=true){
    svg.innerHTML='';
    if(grid){
      const defs=svgEl('defs'); const pat=svgEl('pattern',{id:'mrgrid320',width:20,height:20,patternUnits:'userSpaceOnUse'});
      pat.appendChild(svgEl('circle',{cx:1,cy:1,r:1,fill:'#d7dbe0'}));defs.appendChild(pat);svg.appendChild(defs);
      svg.appendChild(svgEl('rect',{x:camera.x-3000,y:camera.y-3000,width:12000,height:12000,fill:'url(#mrgrid320)'}));
    }
    const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);
    for(const o of elements||[]){
      if(o.teacherOnly && !viewerIsTeacher) continue;
      let n=null;
      if(o.type==='path') n=svgEl('path',{d:smoothPathD(o.points||[]),fill:'none',stroke:o.color||'#15171a','stroke-width':o.width||3,'stroke-linecap':'round','stroke-linejoin':'round','shape-rendering':'geometricPrecision',opacity:o.opacity==null?1:o.opacity});
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
        n=svgEl('g');const c=o.color||'#0f172a',r=Math.max(1,o.r||1),a=arcPath(o);
        n.appendChild(svgEl('path',{d:a.d,fill:'none',stroke:c,'stroke-width':o.width||2.5,'stroke-linecap':'round'}));
        n.appendChild(svgEl('line',{x1:o.cx,y1:o.cy,x2:a.sx,y2:a.sy,stroke:c,'stroke-width':1,'stroke-dasharray':'5 5',opacity:.28}));
        n.appendChild(svgEl('line',{x1:o.cx,y1:o.cy,x2:a.ex,y2:a.ey,stroke:c,'stroke-width':1,'stroke-dasharray':'5 5',opacity:.18}));
        n.appendChild(svgEl('circle',{cx:o.cx,cy:o.cy,r:4.5,fill:'#fff',stroke:c,'stroke-width':2}));
        n.appendChild(svgEl('circle',{cx:a.sx,cy:a.sy,r:3.5,fill:c}));n.appendChild(svgEl('circle',{cx:a.ex,cy:a.ey,r:3.5,fill:c}));
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
        if(selected===o.id)out.setAttribute('opacity','.58');
        g.appendChild(out)
      }
    }
    if(selected){
      const o=(elements||[]).find(x=>x.id===selected);
      if(o){
        const b=bounds(o), pad=(o.type==='solid3d'?9:6)/camera.zoom, hs=(o.type==='solid3d'?14:9)/camera.zoom;
        const frame=svgEl('rect',{x:b.x-pad,y:b.y-pad,width:Math.max(1,b.w)+pad*2,height:Math.max(1,b.h)+pad*2,fill:'none',stroke:'#ED591A','stroke-width':1.5/camera.zoom,'stroke-dasharray':`${5/camera.zoom} ${4/camera.zoom}`,'pointer-events':'none'});
        g.appendChild(frame);
        const x0=b.x-pad,y0=b.y-pad,x1=b.x+b.w+pad,y1=b.y+b.h+pad,xm=(x0+x1)/2,ym=(y0+y1)/2;
        [['nw',x0,y0],['n',xm,y0],['ne',x1,y0],['e',x1,ym],['se',x1,y1],['s',xm,y1],['sw',x0,y1],['w',x0,ym]].forEach(([h,x,y])=>{
          const r=svgEl('rect',{x:x-hs/2,y:y-hs/2,width:hs,height:hs,rx:2/camera.zoom,fill:'#fff',stroke:'#ED591A','stroke-width':1.5/camera.zoom});
          r.dataset.resizeHandle=h;r.style.cursor=({nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize'})[h];
          g.appendChild(r);
        });
        const ry=y0-34/camera.zoom;g.appendChild(svgEl('line',{x1:xm,y1:y0,x2:xm,y2:ry,stroke:'#ED591A','stroke-width':1/camera.zoom,'pointer-events':'none'}));
        const rot=svgEl('circle',{cx:xm,cy:ry,r:6/camera.zoom,fill:'#fff',stroke:'#ED591A','stroke-width':1.5/camera.zoom});rot.dataset.rotateHandle='1';rot.style.cursor='grab';g.appendChild(rot);
      }
    }
  }

  function translated(orig,dx,dy){
    const o=clone(orig);
    if(['text','formula','image','coordinate','graph'].includes(o.type)){o.x+=dx;o.y+=dy}
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
    if(['image','coordinate','graph'].includes(o.type)){
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
    const localOnly=!!options.localOnly;
    const localKey=options.localKey||`mathroom.board.scratch.${S.user?.id||'teacher'}`;
    const assetOwner=localOnly?`scratch/${S.user?.id||'teacher'}`:studentId;
    const readLocal=()=>{try{const raw=JSON.parse(localStorage.getItem(localKey)||'[]');return Array.isArray(raw)?raw:[]}catch{return []}};
    const writeLocal=()=>{if(!localOnly)return;try{localStorage.setItem(localKey,JSON.stringify(pages.map((x,i)=>({...x,sort_order:i,updated_at:new Date().toISOString()}))))}catch(e){console.warn('[Mathroom board scratch]',e)}};
    let pages=[];
    if(localOnly){
      pages=readLocal();
      if(!pages.length)pages=[{id:uid(),teacher_id:S.user?.id||'',student_id:null,title:'Черновик 1',sort_order:0,elements:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()}];
      writeLocal();
    }else{
      const res=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(res.error)throw res.error;pages=res.data||[];
      if(!pages.length&&isTeacher){const {data:p,error:e}=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title:'Лист 1',sort_order:0}).select().single();if(e)throw e;pages=[p]}
    }
    if(!pages.length){root.innerHTML='<div class="empty">Доска пока не создана.</div>';return null}

    let current=pages[0],elements=clone(current.elements||[]),tool='pen',color='#15171a',width=3,camera={x:0,y:0,zoom:1},drawing=null,selected=null,saveTimer=null,channel=null,pagesChannel=null,grid=true;
    let panStart=null,moveStart=null,resizeStart=null,rotationStart=null,solidRotateStart=null,clipboardElement=null,transformDirty=false;const undoStack=[],redoStack=[];let busyHistory=false,importBusy=false;
    let snapEnabled=true,laserPoint=null,remoteLaser=null,tempMarks=[],remoteTempMarks=[],focusRect=null,remoteFocusRect=null,focusDraft=null,eraserPoint=null,eraserDown=false,eraserTrail=[],boardFocused=false,compassPending=null,compassSweep=null,solidPlanePick=null;
    const lessonId=options.lessonId||'';const checkpointKey=lessonId?`mathroom.board.checkpoints.${lessonId}`:'';let checkpointTimer=null;
    const templatesKey=`mathroom.board.templates.${S.user?.id||'teacher'}`;const scratchStorageKey=`mathroom.teacher.scratch.${S.user?.id||'teacher'}`;
    const toolPanel=`<div class="board-tools board-tool-groups board-rail">
      <div class="board-quick-tools board-rail-quick">
        <button class="btn sm board-icon-btn" id="undo" title="Отменить · Ctrl+Z" aria-label="Отменить">↶</button>
        <button class="btn sm board-icon-btn" id="redo" title="Вернуть · Ctrl+Y / Ctrl+Shift+Z" aria-label="Вернуть">↷</button>
        <button class="btn sm board-icon-btn" data-tool="select" title="Выбор" aria-label="Выбор">↖</button>
        <button class="btn sm board-icon-btn" data-tool="hand" title="Рука / перемещение" aria-label="Рука">✋</button>
      </div>
      <div class="board-rail-divider"></div>
      <details class="board-tool-group" data-category="write"><summary title="Письмо" aria-label="Письмо"><span class="board-rail-icon">✎</span></summary><div class="board-tool-popover"><div class="board-popover-title">Письмо</div><div class="board-action-grid"><button class="btn sm active" data-tool="pen">✎ <span>Ручка</span></button><button class="btn sm" data-tool="pencil">⌁ <span>Карандаш</span></button>${isTeacher?'<button class="btn sm" data-tool="marker">▰ <span>Маркер 5с</span></button>':''}<button class="btn sm" data-tool="eraser">◇ <span>Ластик</span></button><button class="btn sm" data-tool="text">T <span>Текст</span></button></div><div class="board-tool-row board-style-row"><button class="color-dot active" data-color="#15171a" style="background:#15171a" title="Чёрный"></button><button class="color-dot" data-color="#ED591A" style="background:#ED591A" title="Котоматика · оранжевый"></button><button class="color-dot" data-color="#2563eb" style="background:#2563eb" title="Синий"></button><button class="color-dot" data-color="#dc2626" style="background:#dc2626" title="Красный"></button><button class="color-dot" data-color="#15803d" style="background:#15803d" title="Зелёный"></button><select id="strokeWidth" class="board-select" title="Толщина"><option value="2">Тонко</option><option value="3" selected>Обычно</option><option value="6">Толсто</option></select></div></div></details>
      <details class="board-tool-group" data-category="geometry"><summary title="Геометрия" aria-label="Геометрия"><span class="board-rail-icon">△</span></summary><div class="board-tool-popover"><div class="board-popover-title">Геометрия</div><div class="board-action-grid"><button class="btn sm" data-tool="line">╱ <span>Линия</span></button><button class="btn sm" data-tool="arrow">↗ <span>Стрелка</span></button>${isTeacher?'<button class="btn sm" data-tool="ruler">▭ <span>Линейка</span></button><button class="btn sm" data-tool="compass">◒ <span>Циркуль</span></button><button class="btn sm" id="protractorTool">∠ <span>Транспортир</span></button>':''}</div><p class="board-tool-help">Циркуль: центр → радиус → протяни дугу до нужной точки.</p></div></details>
      ${isTeacher?`<details class="board-tool-group" data-category="shapes"><summary title="Фигуры" aria-label="Фигуры"><span class="board-rail-icon">◇</span></summary><div class="board-tool-popover board-shapes-popover"><div class="board-popover-title">Фигуры</div><div class="board-palette-section"><b>Планиметрия</b><div class="board-palette-grid">${shapePalette.map(shapeTile).join('')}</div></div><div class="board-palette-section"><b>3D фигуры</b><div class="board-palette-grid board-palette-3d">${solidPalette.map(solidTile).join('')}</div></div><div class="board-solid-help">Выберите 3D фигуру. После вставки тяните за оранжевые маркеры рамки, чтобы менять ширину и высоту. Двойной клик по фигуре включает вращение.</div><div class="board-tool-row board-solid-actions"><button type="button" class="btn sm" data-tool="solid-point">• Точка</button><button type="button" class="btn sm" data-tool="solid-plane">▱ Плоскость</button><button type="button" class="btn sm" data-tool="solid-rotate">↻ Вращать</button><button type="button" class="btn sm" id="solidSmaller">− Размер</button><button type="button" class="btn sm" id="solidLarger">＋ Размер</button><button type="button" class="btn sm" id="solidReset">⌂ Вид</button><button type="button" class="btn sm danger" id="solidClear">Очистить</button></div></div></details><details class="board-tool-group" data-category="insert"><summary title="Вставка" aria-label="Вставка"><span class="board-rail-icon">＋</span></summary><div class="board-tool-popover"><div class="board-popover-title">Вставка</div><div class="board-action-grid"><button class="btn sm" id="formulaTool">∑ <span>Формула</span></button><button class="btn sm" id="coordinatePlane">⌗ <span>Координаты</span></button><button class="btn sm" id="functionGraph">ƒ <span>График</span></button><button class="btn sm" id="templatesBoard">▦ <span>Шаблоны</span></button><button class="btn sm" id="screenCapture">▣ <span>Снимок</span></button><button class="btn sm" id="importBoard">⇧ <span>Файл / PDF</span></button><input id="boardFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf" hidden><button class="btn sm" id="pasteSystemClipboard">▤ <span>Буфер</span></button><button class="btn sm" id="cropImage" disabled>✂ <span>Обрезать</span></button></div></div></details>
      <details class="board-tool-group" data-category="lesson"><summary title="Урок" aria-label="Урок"><span class="board-rail-icon">◎</span></summary><div class="board-tool-popover"><div class="board-popover-title">Урок</div><div class="board-action-grid"><button class="btn sm" data-tool="laser">● <span>Лазер</span></button><button class="btn sm" data-tool="focus">◉ <span>Фокус</span></button><button class="btn sm" id="toggleHidden" disabled>🙈 <span>Скрыть</span></button><button class="btn sm" id="revealHidden">👁 <span>Показать</span></button><button class="btn sm" id="clearFocus">× <span>Снять фокус</span></button></div></div></details>`:''}
      <details class="board-tool-group" data-category="more"><summary title="Ещё" aria-label="Ещё"><span class="board-rail-icon">•••</span></summary><div class="board-tool-popover"><div class="board-popover-title">Действия с доской</div><div class="board-action-grid"><button class="btn sm" id="copySelected" disabled>⧉ <span>Копировать</span></button><button class="btn sm" id="pasteSelected" disabled>▤ <span>Вставить</span></button><button class="btn sm danger" id="deleteSelected" disabled>⌫ <span>Удалить</span></button><button class="btn sm" id="gridToggle">⌗ <span>Сетка</span></button><button class="btn sm active" id="snapToggle">⌁ <span>Магниты</span></button><button class="btn sm" id="fitView">⊙ <span>Вписать</span></button>${isTeacher?`<button class="btn sm" id="exportPagePng">PNG <span>Лист</span></button><button class="btn sm" id="exportAllPdf">PDF <span>Доска</span></button><button class="btn sm" id="boardHistory">◷ <span>История</span></button>${lessonId?'<button class="btn sm" id="resetLessonStart">↺ <span>К началу</span></button>':''}${!localOnly?'<button class="btn sm" id="toScratch">→ <span>Черновик</span></button><button class="btn sm" id="fromScratch">← <span>Из черновика</span></button>':''}<button class="btn sm" id="renamePage">✎ <span>Лист</span></button><button class="btn sm" id="addPage">＋ <span>Лист</span></button><button class="btn sm danger" id="delPage">− <span>Лист</span></button><button class="btn sm danger" id="clearBoard">⌫ <span>Очистить</span></button>`:''}</div></div></details>
    </div>`;
    root.innerHTML=`<div class="board-card"><div class="board-head"><div class="board-head-title"><strong>Доска</strong><span class="board-status" id="boardStatus">${localOnly?'Локальный черновик':'Подключение…'}</span></div><button class="btn sm" id="fullscreen">⛶ На весь экран</button></div><div class="board-page-tabs" id="pageTabs"></div><div class="board-stage" id="stage"><aside class="board-toolbar board-toolbar-side">${toolPanel}</aside><svg id="boardSvg"></svg><div class="board-solid-hud" id="solidHud" hidden><button type="button" class="btn sm" data-solid-hud="rotate" title="Вращать 3D">↻</button><button type="button" class="btn sm" data-solid-hud="point" title="Поставить точку">•</button><button type="button" class="btn sm" data-solid-hud="plane" title="Плоскость по трём точкам">▱</button><span class="board-solid-hud-sep"></span><button type="button" class="btn sm" data-solid-hud="smaller" title="Уменьшить">−</button><button type="button" class="btn sm" data-solid-hud="larger" title="Увеличить">＋</button><span class="board-solid-hud-tip">тяните за углы</span></div><div class="board-floating"><button class="btn sm" id="zoomOut">−</button><span class="btn sm" id="zoomLabel">100%</span><button class="btn sm" id="zoomIn">+</button><button class="btn sm" id="homeView">⌂</button></div></div><div class="board-hint">Инструменты всегда слева · Ctrl+Z — отменить · колесо — масштаб · Space + drag — перемещение</div></div>`;
    const svg=root.querySelector('#boardSvg'),status=root.querySelector('#boardStatus'),pageTabs=root.querySelector('#pageTabs'),zoomLabel=root.querySelector('#zoomLabel'),stage=root.querySelector('#stage'),solidHud=root.querySelector('#solidHud');
    const boardCard=root.querySelector('.board-card');if(boardCard){boardCard.tabIndex=0;boardCard.setAttribute('aria-label','Интерактивная доска Mathroom')};

    const needAsset=path=>{if(!path||assetCache.has(path)||assetPending.has(path))return;ensureAsset(path).then(()=>render())};
    const visibleElements=()=>elements.filter(o=>isTeacher||!o.teacherOnly);
    function objectCenter(o){const b=bounds(o);return{x:b.x+b.w/2,y:b.y+b.h/2}}
    function geometrySnapPoint(x,y,excludeId=''){if(!snapEnabled)return[x,y];let sx=Math.round(x/10)*10,sy=Math.round(y/10)*10,best=14/camera.zoom;for(const o of elements){if(o.id===excludeId||(!isTeacher&&o.teacherOnly))continue;const b=bounds(o),pts=[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h],[b.x+b.w/2,b.y+b.h/2]];for(const p of pts){const d=Math.hypot(x-p[0],y-p[1]);if(d<best){best=d;sx=p[0];sy=p[1]}}}return[sx,sy]}
    function drawTransient(){const g=svgEl('g',{transform:`scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`});svg.appendChild(g);const now=Date.now();tempMarks=tempMarks.filter(x=>x.expires>now);remoteTempMarks=remoteTempMarks.filter(x=>x.expires>now);for(const m of [...remoteTempMarks,...tempMarks])g.appendChild(svgEl('path',{d:smoothPathD(m.points||[]),fill:'none',stroke:m.color||'#f59e0b','stroke-width':m.width||12,'stroke-linecap':'round','stroke-linejoin':'round','shape-rendering':'geometricPrecision',opacity:.45}));for(const p of [remoteLaser,laserPoint].filter(Boolean)){g.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:9/camera.zoom,fill:'#ef4444',opacity:.9}));g.appendChild(svgEl('circle',{cx:p.x,cy:p.y,r:18/camera.zoom,fill:'none',stroke:'#ef4444','stroke-width':2/camera.zoom,opacity:.35}))}const f=remoteFocusRect||focusRect;if(f){const x0=f.x,y0=f.y,x1=f.x+f.w,y1=f.y+f.h,M=100000,attrs={fill:'#0f172a',opacity:.56,'pointer-events':'none'};g.appendChild(svgEl('rect',{x:-M,y:-M,width:2*M,height:y0+M,...attrs}));g.appendChild(svgEl('rect',{x:-M,y:y1,width:2*M,height:M-y1,...attrs}));g.appendChild(svgEl('rect',{x:-M,y:y0,width:x0+M,height:Math.max(0,f.h),...attrs}));g.appendChild(svgEl('rect',{x:x1,y:y0,width:M-x1,height:Math.max(0,f.h),...attrs}));g.appendChild(svgEl('rect',{x:x0,y:y0,width:f.w,height:f.h,fill:'none',stroke:'#fff','stroke-width':2/camera.zoom,'stroke-dasharray':`${7/camera.zoom} ${5/camera.zoom}`}))}if(tool==='eraser'&&eraserTrail.length>1)g.appendChild(svgEl('path',{d:smoothPathD(eraserTrail),fill:'none',stroke:'#ef4444','stroke-width':36/camera.zoom,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.10,'pointer-events':'none'}));if(tool==='eraser'&&eraserPoint){const rr=18/camera.zoom;g.appendChild(svgEl('circle',{cx:eraserPoint.x,cy:eraserPoint.y,r:rr,fill:'rgba(255,255,255,.78)',stroke:'#ef4444','stroke-width':1.8/camera.zoom,'pointer-events':'none'}));g.appendChild(svgEl('circle',{cx:eraserPoint.x,cy:eraserPoint.y,r:3/camera.zoom,fill:'#ef4444',opacity:.55,'pointer-events':'none'}))}}
    function syncSelectionButtons(){const obj=elements.find(x=>x.id===selected),has=!!obj;const c=root.querySelector('#copySelected'),d=root.querySelector('#deleteSelected'),pp=root.querySelector('#pasteSelected'),h=root.querySelector('#toggleHidden'),cr=root.querySelector('#cropImage');if(c)c.disabled=!has;if(d)d.disabled=!has;if(pp)pp.disabled=!clipboardElement;if(h){h.disabled=!has;h.textContent=obj?.teacherOnly?'👁 Показать ученику':'🙈 Скрыть ученику'}if(cr)cr.disabled=!(obj?.type==='image')}
    function syncHistoryButtons(){const u=root.querySelector('#undo'),r=root.querySelector('#redo');if(u){u.disabled=!undoStack.length;u.title=undoStack.length?'Отменить последнее действие · Ctrl+Z':'Нечего отменять'}if(r){r.disabled=!redoStack.length;r.title=redoStack.length?'Вернуть действие · Ctrl+Y':'Нечего возвращать'}}
    function syncSolidHud(){
      if(!solidHud||!stage)return;const o=elements.find(x=>x.id===selected&&x.type==='solid3d');if(!o){solidHud.hidden=true;return}
      solidHud.hidden=false;const b=bounds(o),r=stage.getBoundingClientRect(),left=(b.x-camera.x+b.w)*camera.zoom+12,top=(b.y-camera.y)*camera.zoom;
      const hw=Math.max(250,solidHud.offsetWidth||250),hh=Math.max(44,solidHud.offsetHeight||44),minLeft=82;
      solidHud.style.left=`${Math.max(minLeft,Math.min(Math.max(minLeft,r.width-hw-10),left))}px`;
      solidHud.style.top=`${Math.max(10,Math.min(Math.max(10,r.height-hh-10),top))}px`;
    }
    function render(){drawElements(svg,elements,camera,selected,grid,needAsset,isTeacher);drawTransient();syncSelectionButtons();syncHistoryButtons();syncSolidHud()}
    function cancelCompassDraft(){if(!compassPending&&!compassSweep)return;const id=compassPending?.id||compassSweep?.id;if(id)elements=elements.filter(z=>z.id!==id);compassPending=null;compassSweep=null;const last=undoStack[undoStack.length-1];if(last?.type==='elements'&&last.pageId===current.id)undoStack.pop();syncHistoryButtons();render()}
    function setTool(v){if(tool==='compass'&&v!=='compass'&&(compassPending||compassSweep))cancelCompassDraft();tool=v;eraserPoint=v==='eraser'?eraserPoint:null;root.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===v));const cats={pen:'write',pencil:'write',marker:'write',eraser:'write',text:'write',line:'geometry',arrow:'geometry',ruler:'geometry',compass:'geometry','solid-point':'shapes','solid-plane':'shapes','solid-rotate':'shapes',laser:'lesson',focus:'lesson'};root.querySelectorAll('.board-tool-group').forEach(d=>d.classList.toggle('tool-active',d.dataset.category===cats[v]));svg.style.cursor=v==='hand'?'grab':v==='select'?'default':v==='eraser'?'none':'crosshair';render()}
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
    function renderTabs(){pageTabs.innerHTML=pages.map(p=>`<button class="btn sm ${p.id===current.id?'primary':''}" data-page="${p.id}">${esc(p.title)}</button>`).join('');pageTabs.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page))}
    function pagesChanged(){if(localOnly)writeLocal();else pagesChannel?.send({type:'broadcast',event:'pages',payload:{}})}
    async function deletePageRecord(id){if(localOnly)return;const {error}=await sb.from('board_pages').delete().eq('id',id);if(error)throw error}
    async function save(){clearTimeout(saveTimer);if(!current)return;status.textContent=localOnly?'Сохраняем черновик…':'Сохраняем…';const p=pages.find(x=>x.id===current.id);if(p){p.elements=clone(elements);p.updated_at=new Date().toISOString()}if(localOnly){writeLocal();status.textContent='Черновик сохранён';return}const {error}=await sb.from('board_pages').update({elements,updated_at:new Date().toISOString()}).eq('id',current.id);status.textContent=error?'Ошибка сохранения':'Сохранено';if(error)console.error(error)}
    function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(save,350)}
    function broadcast(){channel?.send({type:'broadcast',event:'state',payload:{pageId:current.id,elements}}).catch(()=>{})}
    function changed(){render();broadcast();scheduleSave()}
    function pushElementsHistory(){if(busyHistory)return;undoStack.push({type:'elements',pageId:current.id,elements:clone(elements)});if(undoStack.length>140)undoStack.shift();redoStack.length=0;syncHistoryButtons()}
    async function switchPage(id,{skipSave=false}={}){if(current?.id===id)return;if(!skipSave)await save();const p=pages.find(x=>x.id===id);if(!p)return;current=p;elements=clone(p.elements||[]);selected=null;camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';renderTabs();render();joinChannel()}
    function hit(x,y){for(let i=elements.length-1;i>=0;i--){const o=elements[i];if(o.teacherOnly&&!isTeacher)continue;const b=bounds(o);if(x>=b.x-20&&x<=b.x+b.w+20&&y>=b.y-20&&y<=b.y+b.h+20)return o}return null}
    async function restorePage(p){let data;if(localOnly){data={...clone(p),updated_at:new Date().toISOString()}}else{const row={id:p.id,teacher_id:p.teacher_id,student_id:p.student_id,title:p.title,sort_order:p.sort_order,elements:p.elements||[],created_at:p.created_at,updated_at:new Date().toISOString()};const res=await sb.from('board_pages').insert(row).select().single();if(res.error)throw res.error;data=res.data}pages.push(data);pages.sort((a,b)=>a.sort_order-b.sort_order);pagesChanged();await switchPage(data.id,{skipSave:true})}
    async function createPage(title,initialElements=[]){let data;if(localOnly){data={id:uid(),teacher_id:S.user?.id||'',student_id:null,title,sort_order:pages.length,elements:clone(initialElements),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}}else{const res=await sb.from('board_pages').insert({teacher_id:S.user.id,student_id:studentId,title,sort_order:pages.length,elements:initialElements}).select().single();if(res.error)throw res.error;data=res.data}undoStack.push({type:'createPage',page:clone(data)});redoStack.length=0;pages.push(data);renderTabs();pagesChanged();return data}
    async function undo(){const action=undoStack.pop();if(!action){syncHistoryButtons();return}busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);redoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed()}else if(action.type==='deletePage'){redoStack.push({type:'deletePage',page:clone(action.page)});await restorePage(action.page)}else if(action.type==='createPage'){const p=pages.find(x=>x.id===action.page.id);if(p){redoStack.push({type:'createPage',page:clone(p)});await deletePageRecord(p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChanged()}}}catch(e){fail(e)}finally{busyHistory=false;syncHistoryButtons()}}
    async function redo(){const action=redoStack.pop();if(!action){syncHistoryButtons();return}busyHistory=true;try{if(action.type==='elements'){const p=pages.find(x=>x.id===action.pageId);if(!p)return;if(current.id!==p.id)await switchPage(p.id);undoStack.push({type:'elements',pageId:p.id,elements:clone(elements)});elements=clone(action.elements);changed()}else if(action.type==='deletePage'){const p=pages.find(x=>x.id===action.page.id);if(p){undoStack.push({type:'deletePage',page:clone(p)});await deletePageRecord(p.id);pages=pages.filter(x=>x.id!==p.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChanged()}}else if(action.type==='createPage'){undoStack.push({type:'createPage',page:clone(action.page)});await restorePage(action.page)}}catch(e){fail(e)}finally{busyHistory=false;syncHistoryButtons()}}

    async function uploadBlob(blob,mime='image/png',ext='png'){
      const path=`${assetOwner}/${uid()}.${ext}`;const {error}=await sb.storage.from(ASSET_BUCKET).upload(path,blob,{contentType:mime,upsert:false,cacheControl:'3600'});if(error)throw error;return path;
    }
    async function importImage(file){
      if(file.size>15*1024*1024)throw new Error('Изображение больше 15 МБ');
      const bitmap=await createImageBitmap(file),scale=Math.min(1,900/bitmap.width),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');
      const path=await uploadBlob(file,file.type||'image/png',ext);pushElementsHistory();const obj={id:uid(),type:'image',assetPath:path,x:camera.x+180/camera.zoom,y:camera.y+70/camera.zoom,w,h,name:file.name};elements.push(obj);selected=obj.id;setTool('select');changed();ensureAsset(path).then(()=>render());return obj;
    }
    async function importPdf(file){
      if(!window.pdfjsLib)throw new Error('PDF.js не загрузился');if(file.size>35*1024*1024)throw new Error('PDF больше 35 МБ');
      status.textContent='Читаем PDF…';const doc=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      pushElementsHistory();let y= camera.y+60/camera.zoom,first=null;const x=camera.x+180/camera.zoom,gap=28;
      for(let i=1;i<=doc.numPages;i++){
        status.textContent=`PDF: страница ${i}/${doc.numPages}`;const page=await doc.getPage(i),vp=page.getViewport({scale:1.25}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await page.render({canvasContext:ctx,viewport:vp}).promise;
        const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Не удалось создать изображение')),'image/png',.92)),path=await uploadBlob(blob,'image/png','png'),scale=Math.min(1,900/canvas.width),w=Math.round(canvas.width*scale),h=Math.round(canvas.height*scale),obj={id:uid(),type:'image',assetPath:path,x,y,w,h,name:`${file.name} · ${i}`};
        elements.push(obj);if(!first)first=obj;y+=h+gap;ensureAsset(path);
      }
      if(first){selected=first.id;setTool('select');changed()}status.textContent=`PDF импортирован · ${doc.numPages} стр. на текущий лист`;toast(`PDF полностью добавлен на текущую страницу: ${doc.numPages} стр.`);
    }
    async function handleImport(file){if(importBusy||!file)return;importBusy=true;try{if(file.type==='application/pdf'||/\.pdf$/i.test(file.name))await importPdf(file);else if(file.type.startsWith('image/'))await importImage(file);else throw new Error('Поддерживаются изображения и PDF')}catch(e){fail(e)}finally{importBusy=false;const input=root.querySelector('#boardFile');if(input)input.value=''}}

    function contentBounds(list=elements){
      const boxes=(list||[]).map(bounds).filter(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)&&Number.isFinite(b.w)&&Number.isFinite(b.h));
      if(!boxes.length)return{x:0,y:0,w:900,h:560};
      const x1=Math.min(...boxes.map(b=>b.x)),y1=Math.min(...boxes.map(b=>b.y)),x2=Math.max(...boxes.map(b=>b.x+b.w)),y2=Math.max(...boxes.map(b=>b.y+b.h));
      return{x:x1,y:y1,w:Math.max(80,x2-x1),h:Math.max(80,y2-y1)};
    }
    function cameraForBounds(list,w,h,pad=70){
      const b=contentBounds(list),usableW=Math.max(100,w-pad*2),usableH=Math.max(100,h-pad*2),zoom=Math.max(.05,Math.min(3,usableW/b.w,usableH/b.h));
      return{x:b.x-pad/zoom,y:b.y-pad/zoom,zoom};
    }
    function fitAll(){const r=svg.getBoundingClientRect();camera=cameraForBounds(elements,Math.max(500,r.width),Math.max(350,r.height),55);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()}
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
    function copySelected(){const o=elements.find(x=>x.id===selected);if(!o)return;clipboardElement=clone(o);syncSelectionButtons();toast('Объект скопирован')}
    function pasteSelected(){if(!clipboardElement)return;pushElementsHistory();let o=translated(clipboardElement,32/camera.zoom,32/camera.zoom);o.id=uid();elements.push(o);selected=o.id;changed();setTool('select');toast('Объект вставлен')}
    function deleteSelected(){if(!selected)return;pushElementsHistory();elements=elements.filter(x=>x.id!==selected);selected=null;changed()}
    async function importClipboardBlob(blob,name='clipboard.png'){const type=blob.type||'image/png';const file=blob instanceof File?blob:new File([blob],name,{type});await importImage(file);toast('Изображение вставлено из буфера')}
    async function readSystemClipboard(){if(!isTeacher)return;try{if(!navigator.clipboard?.read)throw new Error('Браузер не поддерживает чтение изображений из буфера по кнопке. Используй Ctrl+V.');const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type){await importClipboardBlob(await item.getType(type));return}}const text=await navigator.clipboard.readText().catch(()=> '');if(text){addText(text,{fontSize:26});toast('Текст вставлен из буфера');return}toast('В буфере нет изображения или текста')}catch(e){fail(e)}}
    async function pasteExternal(e){
      if(!isTeacher)return;const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;const items=[...(e.clipboardData?.items||[])],files=[...(e.clipboardData?.files||[])];const imageItem=items.find(x=>x.type?.startsWith('image/')),imageFile=files.find(x=>x.type?.startsWith('image/'));if(imageItem||imageFile){e.preventDefault();const file=imageItem?.getAsFile?.()||imageFile;if(file)await importClipboardBlob(file,file.name||'clipboard.png');return}
      const text=e.clipboardData?.getData('text/plain');if(text){e.preventDefault();addText(text,{fontSize:26});toast('Текст вставлен на доску');return}
      if(clipboardElement){e.preventDefault();pasteSelected()}
    }
    async function cropSelectedImage(){const o=elements.find(x=>x.id===selected);if(!o||o.type!=='image')return;try{const url=await ensureAsset(o.assetPath);if(!url)throw new Error('Не удалось загрузить изображение');const m=modal(`<h2>Обрезать изображение</h2><p class="muted">Укажи, сколько процентов убрать с каждой стороны.</p><div class="board-crop-preview"><img src="${url}"></div><div class="grid cols4"><div class="field"><label>Слева %</label><input id="cropL" type="number" min="0" max="45" value="0"></div><div class="field"><label>Сверху %</label><input id="cropT" type="number" min="0" max="45" value="0"></div><div class="field"><label>Справа %</label><input id="cropR" type="number" min="0" max="45" value="0"></div><div class="field"><label>Снизу %</label><input id="cropB" type="number" min="0" max="45" value="0"></div></div><button class="btn primary" id="cropApply">Применить</button>`,'wide-modal');m.querySelector('#cropApply').onclick=async()=>{try{const vals=['L','T','R','B'].map(k=>clamp(Number(m.querySelector('#crop'+k).value||0),0,45)),[l,t,r,b]=vals;if(l+r>=90||t+b>=90)return toast('Слишком сильная обрезка');const blob=await fetch(url).then(x=>x.blob()),img=await createImageBitmap(blob),sx=Math.round(img.width*l/100),sy=Math.round(img.height*t/100),sw=Math.max(1,Math.round(img.width*(1-(l+r)/100))),sh=Math.max(1,Math.round(img.height*(1-(t+b)/100))),c=document.createElement('canvas');c.width=sw;c.height=sh;c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,sw,sh);const out=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error('Не удалось обрезать')),'image/png',.94)),path=await uploadBlob(out,'image/png','png');pushElementsHistory();const idx=elements.findIndex(x=>x.id===o.id);elements[idx]={...o,assetPath:path,w:o.w*(sw/img.width),h:o.h*(sh/img.height)};m.remove();changed();ensureAsset(path).then(render);toast('Изображение обрезано')}catch(e){fail(e)}}}catch(e){fail(e)}}
    async function captureScreen(){if(!navigator.mediaDevices?.getDisplayMedia)return toast('Снимок экрана недоступен');let stream=null;try{stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const v=document.createElement('video');v.srcObject=stream;v.muted=true;await v.play();await new Promise(r=>setTimeout(r,180));const track=stream.getVideoTracks()[0],settings=track.getSettings(),w=settings.width||v.videoWidth||1280,h=settings.height||v.videoHeight||720,c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(v,0,0,w,h);const blob=await new Promise((res,rej)=>c.toBlob(x=>x?res(x):rej(new Error('Не удалось сделать снимок')),'image/png',.94));await importClipboardBlob(blob,'screenshot.png');if(confirm('Обрезать снимок до нужной области?'))await cropSelectedImage()}catch(e){if(e?.name!=='NotAllowedError')fail(e)}finally{stream?.getTracks().forEach(t=>t.stop())}}
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
        if(id==='blank'||id==='grid'){elements=[];selected=null;grid=id==='grid';root.querySelector('#gridToggle')?.classList.toggle('active',grid)}
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
    async function restoreCheckpoint(cp){if(!cp?.pages?.length)return;try{if(localOnly){pages=clone(cp.pages);writeLocal()}else{for(const pg of cp.pages){const found=pages.find(x=>x.id===pg.id);if(found){const{error}=await sb.from('board_pages').update({title:pg.title,sort_order:pg.sort_order,elements:pg.elements||[],updated_at:new Date().toISOString()}).eq('id',pg.id);if(error)throw error}else{const{error}=await sb.from('board_pages').insert({id:pg.id,teacher_id:S.user.id,student_id:studentId,title:pg.title,sort_order:pg.sort_order,elements:pg.elements||[]});if(error)throw error}}pages=clone(cp.pages)}current=pages.find(x=>x.id===cp.currentId)||pages[0];elements=clone(current.elements||[]);selected=null;renderTabs();render();joinChannel();pagesChanged();toast('Состояние доски восстановлено')}catch(e){fail(e)}}
    function openBoardHistory(){const rows=readCheckpoints().slice().reverse(),m=modal(`<div class="mr-card-head"><div><h2>История доски</h2><p class="muted">Автоматическая контрольная точка каждые 5 минут во время урока.</p></div><div class="actions"><button class="btn sm primary" id="checkpointNow">Сохранить сейчас</button><button class="btn sm danger" id="checkpointClear" ${rows.length?'':'disabled'}>Удалить историю</button></div></div><div class="list">${rows.length?rows.map(x=>`<div class="row"><div><b>${esc(x.label||'Снимок')}</b><div class="small muted">${new Date(x.at).toLocaleString('ru-RU')} · ${x.pages?.length||0} лист.</div></div><div class="actions"><button class="btn sm" data-restore-cp="${x.id}">Восстановить</button><button class="btn sm danger" data-delete-cp="${x.id}">Удалить</button></div></div>`).join(''):'<div class="empty">Контрольных точек пока нет.</div>'}</div>`,'wide-modal');m.querySelector('#checkpointNow').onclick=async()=>{await saveCheckpoint('Ручная точка');m.remove();toast('Контрольная точка сохранена')};m.querySelector('#checkpointClear')?.addEventListener('click',()=>{if(!confirm('Удалить всю историю доски для этого урока?'))return;localStorage.removeItem(checkpointKey);m.remove();toast('История доски удалена')});m.querySelectorAll('[data-delete-cp]').forEach(b=>b.onclick=()=>{if(!confirm('Удалить эту контрольную точку?'))return;const next=readCheckpoints().filter(x=>x.id!==b.dataset.deleteCp);localStorage.setItem(checkpointKey,JSON.stringify(next));m.remove();openBoardHistory()});m.querySelectorAll('[data-restore-cp]').forEach(b=>b.onclick=async()=>{const cp=rows.find(x=>x.id===b.dataset.restoreCp);if(!cp||!confirm('Восстановить это состояние доски? Текущее состояние сначала будет сохранено.'))return;await saveCheckpoint('Перед восстановлением');m.remove();await restoreCheckpoint(cp)})}
    async function resetToLessonStart(){const cp=readCheckpoints().find(x=>x.label==='Начало урока');if(!cp)return toast('Начальная контрольная точка не найдена');if(confirm('Вернуть доску к состоянию на начало урока?')){await saveCheckpoint('Перед возвратом к началу');await restoreCheckpoint(cp)}}
    function toggleHidden(){const idx=elements.findIndex(x=>x.id===selected);if(idx<0)return;pushElementsHistory();elements[idx]={...elements[idx],teacherOnly:!elements[idx].teacherOnly};changed();toast(elements[idx].teacherOnly?'Объект скрыт от ученика':'Объект показан ученику')}
    function revealNextHidden(){const idx=elements.findIndex(x=>x.teacherOnly);if(idx<0)return toast('Скрытых объектов нет');pushElementsHistory();elements[idx]={...elements[idx],teacherOnly:false};selected=elements[idx].id;changed();toast('Следующий скрытый объект открыт ученику')}

    svg.onpointerdown=e=>{
      boardFocused=true;root.querySelector('.board-card')?.focus?.({preventScroll:true});const ae=document.activeElement;if(ae&&['INPUT','TEXTAREA','SELECT','BUTTON'].includes(ae.tagName))ae.blur?.();
      svg.setPointerCapture(e.pointerId);
      let[x,y]=screenToWorld(e.clientX,e.clientY);
      if(!['pen','pencil','marker','laser','eraser','compass','solid-rotate'].includes(tool))[x,y]=geometrySnapPoint(x,y,selected||'');
      if(tool==='hand'){panStart={cx:e.clientX,cy:e.clientY,x:camera.x,y:camera.y};return}
      if(tool==='laser'){laserPoint={x,y};broadcastTransient('laser',{point:laserPoint});render();return}
      if(tool==='marker'){drawing={id:uid(),type:'marker-temp',points:[[x,y]],color:'#f59e0b',width:14,expires:Date.now()+5000};tempMarks.push(drawing);render();return}
      if(tool==='focus'){focusDraft={x0:x,y0:y,x1:x,y1:y};focusRect={x,y,w:1,h:1};render();return}
      if(tool==='eraser'){eraserPoint={x,y};eraserTrail=[[x,y]];eraserDown=true;pushElementsHistory();const o=hit(x,y);if(o){elements=elements.filter(z=>z.id!==o.id);if(selected===o.id)selected=null;changed()}else render();return}
      if(tool==='text'){const text=prompt('Текст:');if(text){pushElementsHistory();elements.push({id:uid(),type:'text',x,y,text,color,fontSize:28});changed()}return}
      if(tool==='solid-point'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Сначала кликните по 3D фигуре');const q=nearestSolidSurfacePoint(o,x,y);if(!q||q.d>34/camera.zoom)return toast('Кликните по грани или ближе к ребру фигуры');pushElementsHistory();const idx=elements.findIndex(z=>z.id===o.id),copy=clone(o),n=(copy.solidPoints||[]).length,label=n<26?String.fromCharCode(65+n):`P${n+1}`;copy.solidPoints=[...(copy.solidPoints||[]),{id:uid(),label,p:q.p}];elements[idx]=copy;selected=copy.id;changed();toast(`Точка ${label} добавлена`);return;
      }
      if(tool==='solid-plane'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Выберите 3D фигуру с отмеченными точками');const q=nearestSolidUserPoint(o,x,y);if(!q||q.d>24/camera.zoom)return toast('Кликните по одной из отмеченных точек');if(!solidPlanePick||solidPlanePick.solidId!==o.id)solidPlanePick={solidId:o.id,ids:[]};if(!solidPlanePick.ids.includes(q.id))solidPlanePick.ids.push(q.id);selected=o.id;if(solidPlanePick.ids.length<3){render();toast(`Плоскость: выбрано ${solidPlanePick.ids.length}/3`);return}pushElementsHistory();const idx=elements.findIndex(z=>z.id===o.id),copy=clone(elements[idx]);copy.planes=[...(copy.planes||[]),{id:uid(),ids:solidPlanePick.ids.slice(0,3),color:'#ED591A'}];elements[idx]=copy;solidPlanePick=null;changed();toast('Плоскость через три точки построена');return;
      }
      if(tool==='solid-rotate'){
        const o=hit(x,y);if(!o||o.type!=='solid3d')return toast('Кликните и тяните по 3D фигуре');selected=o.id;pushElementsHistory();solidRotateStart={id:o.id,cx:e.clientX,cy:e.clientY,rotX:Number(o.rotX??-.42),rotY:Number(o.rotY??.62)};return;
      }
      if(tool==='select'){
        const handle=e.target?.dataset?.resizeHandle,rot=e.target?.dataset?.rotateHandle;
        const chosen=elements.find(z=>z.id===selected);
        if(rot&&chosen){pushElementsHistory();const c=objectCenter(chosen);rotationStart={orig:clone(chosen),cx:c.x,cy:c.y,start:Math.atan2(y-c.y,x-c.x),base:Number(chosen.rotation||0)};return}
        if(handle&&chosen){pushElementsHistory();resizeStart={handle,orig:clone(chosen),b:bounds(chosen)};return}
        const o=hit(x,y);selected=o?.id||null;
        if(o){pushElementsHistory();moveStart={x,y,orig:clone(o)}}
        render();return;
      }
      if(tool==='compass'){
        if(compassPending){
          const a=arcPath(compassPending),dist=Math.hypot(x-a.sx,y-a.sy),limit=Math.max(24/camera.zoom,compassPending.r*.12);
          if(dist>limit)return toast('Зажмите начальную точку дуги и ведите циркуль по окружности');
          const raw=Math.atan2(y-compassPending.cy,x-compassPending.cx);compassSweep={id:compassPending.id,lastRaw:raw,total:0};compassPending.sweep=.015;compassPending.a2=compassPending.a1+.015;render();return;
        }
        pushElementsHistory();drawing={id:uid(),type:'arc',cx:x,cy:y,r:1,a1:0,a2:.015,sweep:.015,color,width,stage:'radius'};elements.push(drawing);render();return;
      }
      pushElementsHistory();drawing={id:uid(),type:tool,color,width};
      if(tool==='pen'||tool==='pencil'){drawing.type='path';drawing.points=[[x,y]];if(tool==='pencil'){drawing.color=color==='#15171a'?'#4b5563':color;drawing.width=Math.max(1.5,width*.72);drawing.opacity=.72}}else Object.assign(drawing,{x1:x,y1:y,x2:x,y2:y});
      elements.push(drawing);render();
    };
    svg.onpointermove=e=>{
      let[x,y]=screenToWorld(e.clientX,e.clientY);
      if(!['pen','pencil','marker','laser','eraser','compass','solid-rotate'].includes(tool))[x,y]=geometrySnapPoint(x,y,selected||'');
      if(tool==='eraser'){eraserPoint={x,y};if(eraserDown){const last=eraserTrail[eraserTrail.length-1];if(!last||Math.hypot(x-last[0],y-last[1])>2/camera.zoom)eraserTrail.push([x,y]);const o=hit(x,y);if(o){elements=elements.filter(z=>z.id!==o.id);if(selected===o.id)selected=null;changed()}else renderInteractive()}else renderInteractive();return}
      if(tool==='laser'&&laserPoint){laserPoint={x,y};broadcastTransient('laser',{point:laserPoint});renderInteractive();return}
      if(tool==='marker'&&drawing?.type==='marker-temp'){appendFreehandPoints(drawing,e);renderInteractive();broadcastTransient('marker',{mark:{...drawing,expires:Date.now()+5000}});return}
      if(tool==='focus'&&focusDraft){focusDraft.x1=x;focusDraft.y1=y;focusRect={x:Math.min(focusDraft.x0,x),y:Math.min(focusDraft.y0,y),w:Math.abs(x-focusDraft.x0),h:Math.abs(y-focusDraft.y0)};render();return}
      if(compassSweep&&compassPending&&tool==='compass'&&!drawing){
        const raw=Math.atan2(y-compassPending.cy,x-compassPending.cx),delta=normalizeAngleDelta(raw-compassSweep.lastRaw),max=Math.PI*2-.03;compassSweep.total=Math.max(-max,Math.min(max,compassSweep.total+delta));compassSweep.lastRaw=raw;
        const sw=Math.abs(compassSweep.total)<.015?(compassSweep.total<0?-.015:.015):compassSweep.total;compassPending.sweep=sw;compassPending.a2=compassPending.a1+sw;renderInteractive();return;
      }
      if(compassPending&&tool==='compass'&&!drawing){renderInteractive();return}
      if(solidRotateStart){const idx=elements.findIndex(z=>z.id===solidRotateStart.id);if(idx<0)return;transformDirty=true;const copy=clone(elements[idx]);copy.rotY=solidRotateStart.rotY+(e.clientX-solidRotateStart.cx)*.012;copy.rotX=solidRotateStart.rotX+(e.clientY-solidRotateStart.cy)*.012;elements[idx]=copy;renderInteractive();broadcast();return}
      if(panStart){camera.x=panStart.x-(e.clientX-panStart.cx)/camera.zoom;camera.y=panStart.y-(e.clientY-panStart.cy)/camera.zoom;render();return}
      if(rotationStart&&selected){const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;transformDirty=true;const a=Math.atan2(y-rotationStart.cy,x-rotationStart.cx),deg=rotationStart.base+(a-rotationStart.start)*180/Math.PI;elements[idx]={...rotationStart.orig,rotation:e.shiftKey?Math.round(deg/15)*15:deg};render();broadcast();return}
      if(resizeStart&&selected){
        const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;transformDirty=true;
        const b=resizeStart.b,min=18/camera.zoom;let x0=b.x,y0=b.y,x1=b.x+b.w,y1=b.y+b.h,h=resizeStart.handle;
        if(h.includes('w'))x0=Math.min(x,x1-min);if(h.includes('e'))x1=Math.max(x,x0+min);
        if(h.includes('n'))y0=Math.min(y,y1-min);if(h.includes('s'))y1=Math.max(y,y0+min);
        elements[idx]=scaledToBounds(resizeStart.orig,b,{x:x0,y:y0,w:x1-x0,h:y1-y0});render();broadcast();return;
      }
      if(moveStart&&selected){const idx=elements.findIndex(z=>z.id===selected);if(idx<0)return;let dx=x-moveStart.x,dy=y-moveStart.y;if(Math.abs(dx)>.01||Math.abs(dy)>.01)transformDirty=true;if(snapEnabled){dx=Math.round(dx/10)*10;dy=Math.round(dy/10)*10}elements[idx]=translated(moveStart.orig,dx,dy);render();broadcast();return}
      if(!drawing)return;
      if(drawing.type==='path'){appendFreehandPoints(drawing,e);renderInteractive();broadcast();return}
      if(drawing.type==='arc'){drawing.r=Math.max(1,Math.hypot(x-drawing.cx,y-drawing.cy));drawing.a1=Math.atan2(y-drawing.cy,x-drawing.cx);drawing.sweep=.015;drawing.a2=drawing.a1+.015}else if(drawing.type==='compass')drawing.r=Math.max(1,Math.hypot(x-drawing.cx,y-drawing.cy));else{let xx=x,yy=y;if(e.shiftKey&&['line','arrow','ruler'].includes(drawing.type)){const dx=x-drawing.x1,dy=y-drawing.y1,a=Math.atan2(dy,dx),step=Math.PI/4,aa=Math.round(a/step)*step,len=Math.hypot(dx,dy);xx=drawing.x1+Math.cos(aa)*len;yy=drawing.y1+Math.sin(aa)*len}drawing.x2=xx;drawing.y2=yy}render();broadcast();
    };
    const finishPointer=()=>{
      if(compassSweep&&compassPending){
        if(Math.abs(compassSweep.total)<.04){compassSweep=null;compassPending.sweep=.015;compassPending.a2=compassPending.a1+.015;render();toast('Проведите дугу: зажмите начальную точку и тяните по окружности');return}
        compassSweep=null;compassPending=null;changed();toast('Дуга построена от начальной до конечной точки');return;
      }
      if(drawing?.type==='arc'&&drawing.stage==='radius'){if(drawing.r<8){elements=elements.filter(z=>z.id!==drawing.id);undoStack.pop();drawing=null;render();syncHistoryButtons();return}delete drawing.stage;drawing.sweep=.015;drawing.a2=drawing.a1+.015;compassPending=drawing;drawing=null;render();toast('Центр и радиус заданы · зажмите начальную точку и проведите дугу');return}
      if(eraserDown){eraserDown=false;scheduleSave();broadcast();render();setTimeout(()=>{eraserTrail=[];if(tool==='eraser')render()},260)}
      if(tool==='laser'&&laserPoint){laserPoint=null;broadcastTransient('laser',{point:null});render()}
      if(tool==='marker'&&drawing?.type==='marker-temp'){const mark={...drawing,expires:Date.now()+5000};drawing=null;broadcastTransient('marker',{mark});setTimeout(render,5100)}
      if(tool==='focus'&&focusDraft){focusDraft=null;if(focusRect?.w<5||focusRect?.h<5)focusRect=null;broadcastTransient('focus',{rect:focusRect});render()}
      const hadTransform=!!(moveStart||resizeStart||rotationStart||solidRotateStart);
      if(hadTransform&&!transformDirty){const last=undoStack[undoStack.length-1];if(last?.type==='elements'&&last.pageId===current.id&&JSON.stringify(last.elements)===JSON.stringify(elements))undoStack.pop();syncHistoryButtons()}
      if(drawing&&drawing.type!=='marker-temp'||hadTransform){drawing=null;moveStart=null;resizeStart=null;rotationStart=null;solidRotateStart=null;if(!hadTransform||transformDirty)changed();else render()}
      transformDirty=false;panStart=null;
    };
    svg.onpointerup=finishPointer;
    svg.onpointercancel=finishPointer;
    svg.onpointerleave=()=>{if(!eraserDown&&eraserPoint){eraserPoint=null;render()}};
    svg.onwheel=e=>{e.preventDefault();const[wx,wy]=screenToWorld(e.clientX,e.clientY),nz=clamp(camera.zoom*(e.deltaY<0?1.12:.89),.25,3),r=svg.getBoundingClientRect();camera.x=wx-(e.clientX-r.left)/nz;camera.y=wy-(e.clientY-r.top)/nz;camera.zoom=nz;zoomLabel.textContent=Math.round(nz*100)+'%';render()};
    svg.ondblclick=e=>{const[x,y]=screenToWorld(e.clientX,e.clientY),o=hit(x,y);if(o?.type==='solid3d'){selected=o.id;setTool('solid-rotate');toast('Режим вращения 3D: зажмите фигуру и тяните мышью')}};

    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{setTool(b.dataset.tool);b.closest('.board-tool-group')?.removeAttribute('open')});root.querySelectorAll('.board-tool-group').forEach(d=>d.addEventListener('toggle',()=>{if(!d.open)return;root.querySelectorAll('.board-tool-group').forEach(x=>{if(x!==d)x.removeAttribute('open')})}));root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b))});root.querySelector('#strokeWidth').onchange=e=>width=Number(e.target.value);
    root.querySelector('#undo').onclick=()=>undo();root.querySelector('#redo').onclick=()=>redo();root.querySelector('#copySelected').onclick=copySelected;root.querySelector('#pasteSelected').onclick=pasteSelected;root.querySelector('#pasteSystemClipboard')&&(root.querySelector('#pasteSystemClipboard').onclick=readSystemClipboard);root.querySelector('#deleteSelected').onclick=deleteSelected;root.querySelector('#gridToggle').onclick=()=>{grid=!grid;root.querySelector('#gridToggle').classList.toggle('active',grid);render()};root.querySelector('#gridToggle').classList.add('active');root.querySelector('#snapToggle').onclick=()=>{snapEnabled=!snapEnabled;root.querySelector('#snapToggle').classList.toggle('active',snapEnabled);toast(snapEnabled?'Привязка включена':'Привязка выключена')};root.querySelector('#fitView').onclick=fitAll;
    root.querySelector('#zoomIn').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#zoomOut').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.25,3);zoomLabel.textContent=Math.round(camera.zoom*100)+'%';render()};root.querySelector('#homeView').onclick=()=>{camera={x:0,y:0,zoom:1};zoomLabel.textContent='100%';render()};root.querySelector('#fullscreen').onclick=()=>{if(!document.fullscreenElement)root.querySelector('.board-card').requestFullscreen?.();else document.exitFullscreen?.()};

    if(isTeacher){
      root.querySelector('#formulaTool').onclick=()=>{const raw=prompt('Формула:','x^2 + y^2 = r^2');if(!raw)return;pushElementsHistory();elements.push({id:uid(),type:'formula',x:camera.x+200/camera.zoom,y:camera.y+110/camera.zoom,text:prettyFormula(raw),color,fontSize:32});changed()};
      root.querySelector('#protractorTool').onclick=()=>{pushElementsHistory();const obj={id:uid(),type:'protractor',x:camera.x+360/camera.zoom,y:camera.y+300/camera.zoom,r:180,color};elements.push(obj);selected=obj.id;changed();setTool('select')};
      root.querySelector('#templatesBoard').onclick=openTemplates;root.querySelector('#toggleHidden').onclick=toggleHidden;root.querySelector('#revealHidden').onclick=revealNextHidden;root.querySelector('#cropImage').onclick=cropSelectedImage;root.querySelector('#screenCapture').onclick=captureScreen;root.querySelector('#boardHistory').onclick=openBoardHistory;root.querySelector('#resetLessonStart')&&(root.querySelector('#resetLessonStart').onclick=resetToLessonStart);root.querySelector('#clearFocus').onclick=()=>{focusRect=null;remoteFocusRect=null;broadcastTransient('focus',{rect:null});render()};
      root.querySelector('#toScratch')&&(root.querySelector('#toScratch').onclick=copyToScratch);root.querySelector('#fromScratch')&&(root.querySelector('#fromScratch').onclick=copyFromScratch);
      root.querySelector('#coordinatePlane').onclick=()=>{pushElementsHistory();const obj={id:uid(),type:'coordinate',x:camera.x+190/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,baseW:680,baseH:460,rangeXBase:10,rangeYBase:7,rangeX:10,rangeY:7};elements.push(obj);selected=obj.id;setTool('select');changed();toast('Координатная плоскость добавлена · при растягивании шкала автоматически продолжается до больших значений')};
      root.querySelector('#functionGraph').onclick=()=>{const expr=prompt('Функция y =','x^2 - 4');if(!expr)return;try{const segments=graphSegments(expr);pushElementsHistory();const obj={id:uid(),type:'graph',x:camera.x+190/camera.zoom,y:camera.y+70/camera.zoom,w:680,h:460,baseW:680,baseH:460,rangeXBase:10,rangeYBase:7,rangeX:10,rangeY:7,expression:expr,segments,color:'#ED591A'};elements.push(obj);selected=obj.id;setTool('select');changed();toast('График добавлен · растягивайте рамку: диапазон осей и сам график продолжатся автоматически')}catch(e){fail(e)}};
      const insertShapeTemplate=v=>{if(!v)return;const x=camera.x+260/camera.zoom,y=camera.y+130/camera.zoom;let pts=null,obj=null;if(v==='triangle')pts=[[x+160,y],[x,y+250],[x+320,y+250]];if(v==='right')pts=[[x,y],[x,y+250],[x+320,y+250]];if(v==='isosceles')pts=[[x+160,y],[x+30,y+250],[x+290,y+250]];if(v==='equilateral')pts=[[x+160,y],[x+20,y+242],[x+300,y+242]];if(v==='rectangle')obj={id:uid(),type:'rect',x1:x,y1:y,x2:x+340,y2:y+220,color,width};if(v==='square')pts=[[x,y],[x+260,y],[x+260,y+260],[x,y+260]];if(v==='rhombus')pts=[[x+160,y],[x+320,y+150],[x+160,y+300],[x,y+150]];if(v==='parallelogram')pts=[[x+70,y],[x+330,y],[x+260,y+220],[x,y+220]];if(v==='trapezoid')pts=[[x+80,y],[x+260,y],[x+340,y+220],[x,y+220]];if(v==='iso_trapezoid')pts=[[x+90,y],[x+250,y],[x+330,y+220],[x+10,y+220]];if(v==='circle')obj={id:uid(),type:'ellipse',x1:x,y1:y,x2:x+260,y2:y+260,color,width};if(v==='ellipse')obj={id:uid(),type:'ellipse',x1:x,y1:y+30,x2:x+340,y2:y+220,color,width};if(v==='hexagon'){pts=[];for(let i=0;i<6;i++){const a=Math.PI/6+i*Math.PI/3;pts.push([x+170+150*Math.cos(a),y+150+150*Math.sin(a)])}}if(pts)obj={id:uid(),type:'polygon',points:pts,color,width};if(obj){pushElementsHistory();elements.push(obj);selected=obj.id;setTool('select');changed()}};
      const insertSolidTemplate=v=>{if(!v)return;pushElementsHistory();const obj={id:uid(),type:'solid3d',shape:v,x:camera.x+210/camera.zoom,y:camera.y+80/camera.zoom,w:440,h:340,rotX:-.42,rotY:.62,rotZ:0,color:'#15171a',solidPoints:[],planes:[]};elements.push(obj);selected=obj.id;setTool('select');changed();toast(`${solidNames[v]||'3D фигура'} добавлена · тяните за оранжевые маркеры рамки для изменения размера`)};
      const scaleSelectedSolid=f=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');pushElementsHistory();const o=clone(elements[idx]),cx=o.x+(o.w||440)/2,cy=o.y+(o.h||340)/2,nw=clamp((o.w||440)*f,160,1600),nh=clamp((o.h||340)*f,130,1200);o.x=cx-nw/2;o.y=cy-nh/2;o.w=nw;o.h=nh;elements[idx]=o;changed()};
      root.addEventListener('click',e=>{const shapeBtn=e.target.closest?.('[data-shape-template]'),solidBtn=e.target.closest?.('[data-solid-template]');if(shapeBtn&&root.contains(shapeBtn)){e.preventDefault();e.stopPropagation();insertShapeTemplate(shapeBtn.dataset.shapeTemplate);shapeBtn.closest('.board-tool-group')?.removeAttribute('open');return}if(solidBtn&&root.contains(solidBtn)){e.preventDefault();e.stopPropagation();insertSolidTemplate(solidBtn.dataset.solidTemplate);solidBtn.closest('.board-tool-group')?.removeAttribute('open')}},true);
      root.querySelector('#solidSmaller').onclick=()=>scaleSelectedSolid(.88);root.querySelector('#solidLarger').onclick=()=>scaleSelectedSolid(1.14);
      root.querySelector('#solidReset').onclick=()=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');pushElementsHistory();elements[idx]={...elements[idx],rotX:-.42,rotY:.62,rotZ:0};changed();toast('Вид 3D фигуры сброшен')};
      root.querySelectorAll('[data-solid-hud]').forEach(b=>b.onclick=()=>{const a=b.dataset.solidHud;if(a==='rotate')setTool('solid-rotate');else if(a==='point')setTool('solid-point');else if(a==='plane')setTool('solid-plane');else if(a==='smaller')scaleSelectedSolid(.9);else if(a==='larger')scaleSelectedSolid(1.12)});
      root.querySelector('#solidClear').onclick=()=>{const idx=elements.findIndex(z=>z.id===selected&&z.type==='solid3d');if(idx<0)return toast('Сначала выберите 3D фигуру');if(!confirm('Удалить все точки и построенные плоскости на этой 3D фигуре?'))return;pushElementsHistory();elements[idx]={...elements[idx],solidPoints:[],planes:[]};solidPlanePick=null;changed();toast('Точки и плоскости очищены')};
      root.querySelector('#importBoard').onclick=()=>root.querySelector('#boardFile').click();root.querySelector('#boardFile').onchange=e=>handleImport(e.target.files?.[0]);root.querySelector('#exportPagePng').onclick=exportCurrentPng;root.querySelector('#exportAllPdf').onclick=exportAllPdf;
      root.querySelector('#addPage').onclick=async()=>{const title=prompt('Название листа:',`Лист ${pages.length+1}`);if(!title)return;try{const p=await createPage(title,[]);await switchPage(p.id)}catch(e){fail(e)}};
      root.querySelector('#renamePage').onclick=async()=>{const title=prompt('Название листа:',current.title);if(!title||title===current.title)return;if(!localOnly){const {error}=await sb.from('board_pages').update({title}).eq('id',current.id);if(error)return fail(error)}current.title=title;renderTabs();pagesChanged()};
      root.querySelector('#delPage').onclick=async()=>{if(pages.length<=1)return toast('Нельзя удалить единственный лист');if(!confirm('Удалить этот лист? Ctrl+Z сможет вернуть его.'))return;await save();const deleted=clone(current);undoStack.push({type:'deletePage',page:deleted});redoStack.length=0;try{await deletePageRecord(current.id)}catch(e){return fail(e)}pages=pages.filter(p=>p.id!==deleted.id);current=pages[0];elements=clone(current.elements||[]);renderTabs();render();joinChannel();pagesChanged()};
      root.querySelector('#clearBoard').onclick=()=>{if(!elements.length||!confirm('Очистить текущий лист?'))return;pushElementsHistory();elements=[];selected=null;changed()};
    }

    async function refreshPages(){if(localOnly){const stored=readLocal();if(!stored.length)return;const old=current?.id;pages=stored;const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();return}const {data}=await sb.from('board_pages').select('*').eq('student_id',studentId).order('sort_order');if(!data)return;const old=current?.id;pages=data;const found=pages.find(x=>x.id===old);if(found){current=found;if(!moveStart&&!drawing)elements=clone(found.elements||[])}else{current=pages[0];elements=clone(current?.elements||[])}renderTabs();render();joinChannel()}
    function broadcastTransient(kind,payload){channel?.send({type:'broadcast',event:'transient',payload:{pageId:current?.id,kind,...payload}}).catch(()=>{})}
    function joinChannel(){if(channel)sb.removeChannel(channel);channel=null;if(!current)return;if(localOnly){status.textContent='Локальный черновик';return}channel=sb.channel(`board:${current.id}`,{config:{private:true}}).on('broadcast',{event:'state'},({payload})=>{if(payload.pageId!==current.id)return;const incoming=clone(payload.elements||[]);if(isTeacher){const hidden=elements.filter(x=>x.teacherOnly);elements=[...incoming.filter(x=>!x.teacherOnly),...hidden]}else elements=incoming;const p=pages.find(x=>x.id===current.id);if(p)p.elements=clone(elements);render();status.textContent='Онлайн'}).on('broadcast',{event:'transient'},({payload})=>{if(payload.pageId!==current.id)return;if(payload.kind==='laser')remoteLaser=payload.point||null;if(payload.kind==='focus')remoteFocusRect=payload.rect||null;if(payload.kind==='marker'&&payload.mark){const i=remoteTempMarks.findIndex(x=>x.id===payload.mark.id),mark={...payload.mark,expires:Date.now()+5000};if(i>=0)remoteTempMarks[i]=mark;else remoteTempMarks.push(mark);setTimeout(render,5100)}render()}).subscribe(s=>{status.textContent=s==='SUBSCRIBED'?'Онлайн':'Подключение…'})}
    function addText(text,opts={}){pushElementsHistory();elements.push({id:uid(),type:'text',x:camera.x+190/camera.zoom,y:camera.y+90/camera.zoom,text,color:opts.color||'#15171a',fontSize:opts.fontSize||28});changed()}
    const key=e=>{if(e.key==='Escape'){solidPlanePick=null;if(compassPending||compassSweep)cancelCompassDraft()}const ae=document.activeElement,tag=ae?.tagName,isEditing=!!(ae&&(ae.isContentEditable||tag==='INPUT'||tag==='TEXTAREA'));const cmd=e.ctrlKey||e.metaKey,k=String(e.key||'').toLowerCase(),code=String(e.code||'');const undoKey=cmd&&(k==='z'||code==='KeyZ'),redoKey=cmd&&(k==='y'||code==='KeyY');if(undoKey&&!isEditing){e.preventDefault();e.stopImmediatePropagation?.();e.shiftKey?redo():undo();return}if(redoKey&&!isEditing){e.preventDefault();e.stopImmediatePropagation?.();redo();return}if(isEditing)return;if(cmd&&(k==='c'||code==='KeyC')&&selected){e.preventDefault();copySelected()}else if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();deleteSelected()}else if(e.code==='Space'&&!e.repeat){e.preventDefault();svg.dataset.prevTool=tool;setTool('hand')}else if(!cmd&&!e.altKey&&!e.shiftKey){const map={KeyP:'pen',KeyK:'pencil',KeyE:'eraser',KeyT:'text',KeyL:'line',KeyV:'select',KeyH:'hand',KeyF:'focus',KeyR:'ruler',KeyM:'marker',KeyX:'laser',KeyC:'compass'},next=map[code]||({p:'pen',k:'pencil',e:'eraser',t:'text',l:'line',v:'select',h:'hand',f:'focus',r:'ruler',m:'marker',x:'laser',c:'compass'})[k];if(next&&(!['focus','ruler','marker','laser','compass'].includes(next)||isTeacher)){e.preventDefault();setTool(next)}else if(k==='g'||code==='KeyG'){e.preventDefault();grid=!grid;root.querySelector('#gridToggle').classList.toggle('active',grid);render()}}};
    const keyup=e=>{if(e.code==='Space'&&svg.dataset.prevTool){setTool(svg.dataset.prevTool);delete svg.dataset.prevTool}};window.addEventListener('keydown',key,true);window.addEventListener('keyup',keyup);window.addEventListener('paste',pasteExternal);
    if(!localOnly)pagesChannel=sb.channel(`student:${studentId}:pages`,{config:{private:true}}).on('broadcast',{event:'pages'},()=>refreshPages()).subscribe();renderTabs();render();joinChannel();
    if(lessonId&&isTeacher){if(!readCheckpoints().length)setTimeout(()=>saveCheckpoint('Начало урока'),800);checkpointTimer=setInterval(()=>saveCheckpoint('Авто · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})).catch(()=>{}),5*60*1000)}
    const cleanup=()=>{clearTimeout(saveTimer);clearInterval(checkpointTimer);window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',keyup);window.removeEventListener('paste',pasteExternal);if(channel)sb.removeChannel(channel);if(pagesChannel)sb.removeChannel(pagesChannel)};S.boardCleanup=cleanup;
    return {addText,undo,redo,save,fitAll,exportPage:exportCurrentPng,exportAll:exportAllPdf,getPages:()=>pages.map(p=>({...p,elements:p.id===current.id?clone(elements):clone(p.elements||[])})),checkpoint:saveCheckpoint,restoreStart:resetToLessonStart,copyToScratch,copyFromScratch,setTool,readClipboard:readSystemClipboard,clearFocus:()=>{focusRect=null;broadcastTransient('focus',{rect:null});render()}};
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
