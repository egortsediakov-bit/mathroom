/* Mathroom v29.7.4 — final exact-page cleanup for Makarychev 7 advanced. */
(() => {
  'use strict';
  const engine=window.MathroomTextbookSyncV290;
  const extra=window.MathroomTextbookExtraV2970;
  if(!engine||!extra){console.warn('[Mathroom 29.7.4] sync modules missing');return;}
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\u00ad/g,'').replace(/[«»“”„]/g,'"').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const key=(series,grade,title)=>`${series}|${Number(grade)||0}|${norm(title)}`;
  const add=(title,from,to,label='')=>extra.staticMap.set(key('makarychev-advanced',7,title),{
    page_from:Number(from),page_to:Number(to||from),
    note:`Автопривязка · проверенная карта v29.7.4 · ${label||title}`,
    exactPages:true,catalog:true,verified:true
  });

  // 2018 advanced edition: printed page + 1 = physical PDF page.
  // The curriculum topic "Возведение в степень произведения и степени" is covered inside
  // §4 "Одночлен и его стандартный вид", topic 9 "Возведение одночлена в степень" (printed p.49).
  add('Возведение в степень произведения и степени',50,55,'свойства степени при возведении одночлена в степень');
  // §13 starts on printed p.163 and includes cube identities through the chapter exercises.
  add('Сумма и разность кубов',164,177,'куб суммы/разности и разложение суммы/разности кубов');

  const prevMatch=engine.matchBookToTopic.bind(engine);
  function matchBookToTopic(meta,topic,source,book){
    // "Формулы" is a base-course standalone topic. The advanced 2018 book does not have a
    // separate matching section; do not create a fuzzy OCR link just because the word occurs.
    if(meta?.series==='makarychev-advanced'&&Number(meta?.grade||meta?.gradeFrom)===7&&norm(topic?.title)==='формулы')return null;
    return prevMatch(meta,topic,source,book);
  }
  function buildCandidates({books=[],topics=[],sourceFor=()=>''}={}){
    const rows=[],recognized=[],unrecognized=[];
    for(const book of books){
      const meta=engine.detectBook(book);
      (meta?.recognized?recognized:unrecognized).push({book,meta});
      if(!meta?.recognized)continue;
      for(const topic of topics){
        const source=sourceFor(topic)||'';
        const match=matchBookToTopic(meta,topic,source,book);
        if(!match)continue;
        rows.push({book,bookMeta:meta,topic,source,...match});
      }
    }
    return {rows,recognized,unrecognized,exactPages:rows.filter(x=>x.exactPages).length};
  }
  window.MathroomTextbookSyncV290={...engine,version:'2026.10.04.29.7.4',matchBookToTopic,buildCandidates};
  window.MathroomTextbookCorrectorV2974={version:'29.7.4'};
})();