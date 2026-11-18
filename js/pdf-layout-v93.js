/* Mathroom v93 — PDF.js text layout parser.
 * Handles detached exercise numbers in a left badge/column and numbered inline text.
 * It uses coordinate-aware grouping and does NOT pretend to OCR scans. */
(()=>{
  'use strict';
  const API={};
  const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
  const isInline=text=>{
    const s=clean(text);
    let m=s.match(/^(?:№\s*|(?:Задача|Задание|Упражнение)\s*№?\s*)(\d{1,4}(?:\.\d{1,3})?)\s*[:.)-]\s*(.+)$/iu);
    if(m)return {number:m[1],rest:m[2]};
    m=s.match(/^(\d{1,4}(?:\.\d{1,3})?)[.)]\s*(\S.+)$/u);
    return m?{number:m[1],rest:m[2]}:null;
  };
  const standalone=text=>{
    const m=clean(text).match(/^(?:№\s*)?(\d{1,4})(?:[.)])?$/u);
    return m?m[1]:null;
  };
  const metaLine=s=>/^(?:MATHROOM\s*\/|Стр\.\s*\d+|Оригинальный тестовый материал|Проверка:|Предупреждение:|Текстовый слой$|Степени\s*[·•]|Ни одно задание|(?:\d{1,2}\s*\/\s*)?(?:Алгебра|Геометрия|Контроль качества)\s*[:·\/])/iu.test(clean(s));
  API.linesFromItems=(items)=>{
    const parts=(items||[]).filter(x=>clean(x?.str))
      .map((v,i)=>({str:String(v.str),x:Number(v.transform?.[4]||0),y:Number(v.transform?.[5]||0),w:Number(v.width||0),i}))
      .filter(x=>Number.isFinite(x.x)&&Number.isFinite(x.y));
    parts.sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x);
    const rows=[];
    for(const p of parts){
      let row=null;
      // PDF text runs with different baselines are independent. Avoid
      // joining two columns separated by an excessive gap.
      for(let j=rows.length-1;j>=Math.max(0,rows.length-5);j--){
        const r=rows[j];
        if(Math.abs(r.y-p.y)>3)continue;
        if(p.x-r.xEnd > 36)continue;
        row=r;break;
      }
      if(!row){rows.push({x:p.x,y:p.y,xEnd:p.x+p.w,text:p.str,index:p.i});continue}
      const gap=p.x-row.xEnd;
      const chunk=(gap>2.5?' ':'')+p.str;
      row.text+=chunk;row.xEnd=Math.max(row.xEnd,p.x+p.w);
    }
    return rows.map(r=>({...r,text:clean(r.text)})).filter(r=>r.text)
      .sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x);
  };
  API.splitPage=(lines,page)=>{
    const source=(lines||[]).map((l,i)=>typeof l==='string'
      ?{text:clean(l),x:0,y:(lines.length-i)*24,xEnd:0,index:i,plain:true}
      :{...l,text:clean(l.text),index:i}).filter(l=>l.text);
    // When geometry isn't available, support conventional inline numbering
    // and standalone numbers before the task text.
    if(source.every(l=>l.plain)){
      let cur=null;const tasks=[];
      const save=()=>{if(cur&&clean(cur.parts.join(' ')).length>=12)tasks.push({page,number:cur.number,content:cur.parts.join('\n').trim(),selected:true,answer:''})};
      for(const l of source){
        const h=isInline(l.text),n=standalone(l.text);
        if(h||n){save();cur={number:h?.number||n,parts:h?[h.rest]:[]}}
        else if(cur&&!metaLine(l.text))cur.parts.push(l.text);
      }
      save();return tasks;
    }
    const rows=source.sort((a,b)=>Math.abs(b.y-a.y)>3?b.y-a.y:a.x-b.x);
    const anchors=[];
    for(const line of rows){
      const inline=isInline(line.text);
      if(inline){
        anchors.push({number:inline.number,numberY:line.y,bodyY:line.y,
          bodyX:line.x,rest:inline.rest,kind:'inline',anchor:line});
        continue;
      }
      const number=standalone(line.text);
      if(!number||line.x>170)continue;
      const possible=rows.filter(r=>r!==line
        && !standalone(r.text)&&!isInline(r.text)
        && !metaLine(r.text)
        && r.x>=line.x+18
        && r.y>=line.y-20&&r.y<=line.y+24
        && clean(r.text).length>=10)
        .sort((a,b)=>Math.abs(a.y-line.y)-Math.abs(b.y-line.y) || a.x-b.x);
      if(!possible.length)continue;
      const first=possible[0];
      anchors.push({number,numberY:line.y,bodyY:first.y,bodyX:first.x,
        rest:first.text,kind:'badge',anchor:line,first});
    }
    anchors.sort((a,b)=>b.bodyY-a.bodyY);
    // A document may duplicate text runs in the same location.
    const seen=new Set(),unique=[];
    for(const a of anchors){
      const k=a.number+'|'+Math.round(a.bodyY/3);
      if(!seen.has(k)){seen.add(k);unique.push(a)}
    }
    const tasks=[];
    for(let i=0;i<unique.length;i++){
      const a=unique[i],next=unique[i+1];
      const parts=[a.rest],firstY=a.bodyY;
      let previousY=firstY,previousX=a.bodyX;
      for(const line of rows){
        if(line===a.first||line===a.anchor)continue;
        if(line.y>=firstY-1)continue;
        // Never cross into the next task's first text row.
        if(next&&line.y<=next.bodyY+1)break;
        if(metaLine(line.text)||standalone(line.text)||isInline(line.text))continue;
        if(line.x<a.bodyX-18)continue;
        if(Math.abs(line.x-previousX)>85)continue;
        const gap=previousY-line.y;
        // A large visual gap typically means a badge, figure caption or footer.
        if(gap>42)break;
        if(gap<3)continue;
        parts.push(line.text);previousY=line.y;previousX=line.x;
      }
      const content=parts.join('\n').trim();
      if(clean(content).length<12)continue;
      tasks.push({page,number:a.number,content,selected:true,answer:''});
    }
    return tasks;
  };
  window.MathroomPdfLayoutV93=API;
})();
