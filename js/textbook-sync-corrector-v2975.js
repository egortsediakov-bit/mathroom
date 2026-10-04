/* Mathroom v29.7.5 — close the last Makarychev 7 advanced exact-page gaps. */
(() => {
  'use strict';
  const extra=window.MathroomTextbookExtraV2970;
  if(!extra?.staticMap){console.warn('[Mathroom 29.7.5] extra sync map missing');return;}
  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\u00ad/g,'').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const key=(series,grade,title)=>`${series}|${Number(grade)||0}|${norm(title)}`;
  const add=(title,from,to,label='')=>extra.staticMap.set(key('makarychev-advanced',7,title),{
    page_from:Number(from),page_to:Number(to||from),
    note:`Автопривязка · проверенная карта v29.7.5 · ${label||title}`,
    exactPages:true,catalog:true,verified:true
  });

  // Makarychev 7 advanced (2018): physical PDF page = printed page + 1.
  // Printed p.103: "Линейное уравнение с одной переменной"; next section starts p.106.
  add('Линейное уравнение с одной переменной',104,106,'печатные стр. 103–105');
  // Printed p.114: "Решение задач с помощью уравнений"; additional exercises start p.121.
  add('Решение задач с помощью уравнений',115,121,'печатные стр. 114–120');

  window.MathroomTextbookCorrectorV2975={version:'29.7.5',staticMap:extra.staticMap};
})();
