(() => {
  'use strict';

  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»“”„]/g,'"').replace(/\s+/g,' ').trim();
  const first=(...v)=>v.find(x=>x!==undefined&&x!==null&&x!=='') ?? null;
  const toNum=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

  function parseGrade(s){
    s=norm(s);
    let m=s.match(/(?:^|\D)(1[01]|[1-9])\s*(?:класс|кл\.?|grade)(?:\D|$)/);
    if(m)return Number(m[1]);
    m=s.match(/mat(?:ematika)?[_\- ]*(1[01]|[1-9])k/i);if(m)return Number(m[1]);
    m=s.match(/(?:^|[_\- ])(1[01]|[1-9])[_\- ]?(?:klass|kl)(?:[_\- ]|$)/i);if(m)return Number(m[1]);
    return null;
  }
  function parsePart(s){
    s=norm(s);
    let m=s.match(/(?:часть|ч\.?|part)\s*[_\- ]*([123])/i);if(m)return Number(m[1]);
    m=s.match(/mat\d+k0?([123])/i);if(m)return Number(m[1]);
    m=s.match(/(?:^|[_\- ])([123])[_\- ]?ch(?:ast)?(?:[_\- ]|$)/i);if(m)return Number(m[1]);
    m=s.match(/(?:ch|част)[_\- ]?([123])/i);if(m)return Number(m[1]);
    return null;
  }
  function parseYear(s){const m=String(s||'').match(/\b(20\d{2})\b/);return m?Number(m[1]):null}

  function detectBook(book){
    const raw=[book?.title,book?.author,book?.file_name].filter(Boolean).join(' | '),n=norm(raw);
    const fromExisting=window.MathroomTextbooks56V286?.detectFile?.(book?.file_name||'');
    let series='',author=book?.author||'',grade=first(toNum(book?.grade_from),fromExisting?.grade,parseGrade(raw)),part=first(fromExisting?.part,parsePart(raw)),year=parseYear(raw);
    if(n.includes('виленкин')||fromExisting?.series==='Виленкин'){series='vilenkin';author=author||'Н. Я. Виленкин и др.'}
    else if((n.includes('дорофеев')&&n.includes('петерсон'))||fromExisting?.series==='Дорофеев–Петерсон'){series='dorofeev-peterson';author=author||'Г. В. Дорофеев, Л. Г. Петерсон'}
    else if(n.includes('петерсон')||/mat\d+k0?[123]/i.test(book?.file_name||'')){series='peterson-primary';author=author||'Л. Г. Петерсон'}
    else if(fromExisting?.series){series=String(fromExisting.series).toLowerCase().includes('виленкин')?'vilenkin':'dorofeev-peterson'}
    return {series,author,grade,part,year,recognized:!!series&&!!grade,label:series==='vilenkin'?'Виленкин':series==='dorofeev-peterson'?'Дорофеев–Петерсон':series==='peterson-primary'?'Петерсон':'Не распознан'};
  }

  function sourceSeries(source,grade){
    const n=norm(source);
    if(n.includes('виленкин'))return 'vilenkin';
    if(n.includes('дорофеев')&&n.includes('петерсон'))return 'dorofeev-peterson';
    if(n.includes('петерсон')&&Number(grade)<=4)return 'peterson-primary';
    return '';
  }
  function sourceParts(source){
    const out=[];const s=norm(source);let m;const re=/(?:ч\.?|часть)\s*([123])/g;
    while((m=re.exec(s)))out.push(Number(m[1]));
    return [...new Set(out)];
  }
  function extractPageRange(source){
    const s=String(source||'').replace(/–|—/g,'-');
    let m=s.match(/стр\.?\s*(\d+)\s*-\s*(\d+)/i);if(m)return {from:Number(m[1]),to:Number(m[2])};
    m=s.match(/стр\.?\s*(\d+)/i);if(m)return {from:Number(m[1]),to:Number(m[1])};
    return {from:null,to:null};
  }
  function compactNote(source){
    const s=String(source||'').replace(/\s+/g,' ').trim();
    return `Автопривязка · ${s.length>170?s.slice(0,167)+'…':s}`;
  }
  function matchBookToTopic(bookMeta,topic,source){
    if(!bookMeta?.recognized||!source)return null;
    const grade=Number(topic?.grade||0);if(bookMeta.grade&&grade!==bookMeta.grade)return null;
    const ss=sourceSeries(source,grade);if(!ss||ss!==bookMeta.series)return null;
    const parts=sourceParts(source);
    if(bookMeta.part&&parts.length&&!parts.includes(Number(bookMeta.part)))return null;
    const range=extractPageRange(source);
    return {page_from:range.from,page_to:range.to,note:compactNote(source),exactPages:!!range.from};
  }

  function buildCandidates({books=[],topics=[],sourceFor=()=>''}={}){
    const rows=[];const recognized=[];const unrecognized=[];
    for(const book of books){
      const meta=detectBook(book);(meta.recognized?recognized:unrecognized).push({book,meta});
      if(!meta.recognized)continue;
      for(const topic of topics){
        const source=sourceFor(topic)||'';const match=matchBookToTopic(meta,topic,source);if(!match)continue;
        rows.push({book,bookMeta:meta,topic,source,...match});
      }
    }
    return {rows,recognized,unrecognized,exactPages:rows.filter(x=>x.exactPages).length};
  }

  window.MathroomTextbookSyncV290={version:'2026.10.04.10',detectBook,buildCandidates,matchBookToTopic,extractPageRange};
})();
