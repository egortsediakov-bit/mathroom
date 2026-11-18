/* Mathroom v92 — pre-import risk flags and near-duplicate hints.
   These checks do NOT certify mathematical correctness. */
(()=>{
  'use strict';
  const API={};
  API.normalize=x=>String(x??'').normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[\u2212\u2013\u2014]/g,'-').replace(/[«»“”"']/g,'')
    .replace(/\s+/g,' ').trim();
  const shingles=x=>{
    const s=API.normalize(x).replace(/[.,;:!?()\[\]{}]/g,'').replace(/\s+/g,'');
    if(s.length<35)return null;
    const m=new Set();for(let i=0;i<=s.length-4;i++)m.add(s.slice(i,i+4));return m;
  };
  API.similarity=(a,b)=>{
    const aa=shingles(a),bb=shingles(b);
    if(!aa||!bb)return 0;
    let inter=0;for(const x of aa)if(bb.has(x))inter++;
    return inter/(aa.size+bb.size-inter||1);
  };
  API.audit=(item,bank=[])=>{
    const text=String(item?.content||''),warnings=[];
    if(text.trim().length<18)warnings.push('Условие слишком короткое — проверь полноту');
    if(/[\uFFFD\u25A1\uE000-\uF8FF]/u.test(text))warnings.push('Подозрительные символы: возможна потеря математических знаков');
    if(/(?:рис(?:унок|\.)|чертёж|чертеж|на схеме|по графику|изображени|в таблице)/iu.test(text)
      && !item?.capture)warnings.push('Есть ссылка на рисунок или таблицу: приложи снимок оригинала');
    // Draft answers are optional; missing answer is an ordinary reminder,
    // not an import-quality error. Publishing is guarded in Task Builder.
    if(item?.visualOnly&&!item?.capture)warnings.push('Для задачи со скана необходим фрагмент страницы');
    let closeMatch=null,maxScore=0;
    for(const row of bank.slice(0,2500)){
      const score=API.similarity(text,row?.content||'');
      if(score>maxScore){maxScore=score;closeMatch=row}
    }
    if(maxScore>=.86)
      warnings.push('В банке есть очень похожая задача (сходство '+Math.round(maxScore*100)+'%)');
    return {warnings,nearDuplicate:maxScore>=.86,similarity:Math.round(maxScore*100),closestId:closeMatch?.id||null};
  };
  window.MathroomPdfQualityV92=API;
})();
