/* Mathroom v29.7.3 — sync correctness pass.
   - exact static maps always beat fuzzy OCR maps;
   - algebra books never link to geometry topics and vice versa;
   - adds verified physical PDF maps for Makarychev 7 advanced (2018).
*/
(() => {
  'use strict';
  const engine=window.MathroomTextbookSyncV290;
  const extra=window.MathroomTextbookExtraV2970;
  if(!engine||!extra){console.warn('[Mathroom 29.7.3] sync modules missing');return;}

  const norm=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/\u00ad/g,'')
    .replace(/[«»“”„]/g,'"').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const key=(series,grade,title)=>`${series}|${Number(grade)||0}|${norm(title)}`;
  const add=(series,grade,title,from,to,label='')=>extra.staticMap.set(key(series,grade,title),{
    page_from:Number(from),page_to:Number(to||from),
    note:`Автопривязка · проверенная карта v29.7.3 · ${label||title}`,
    exactPages:true,catalog:true,verified:true
  });

  // Макарычев, 7 класс, углублённый уровень (2018).
  // В этом PDF физическая страница = печатная + 1. Диапазоны взяты из оглавления PDF, стр. 303–305.
  add('makarychev-advanced',7,'Рациональные числа',5,37,'выражения и множество их значений');
  add('makarychev-advanced',7,'Степень с натуральным показателем',38,46);
  add('makarychev-advanced',7,'Одночлены',47,59);
  add('makarychev-advanced',7,'Многочлены',64,89);
  add('makarychev-advanced',7,'Линейные уравнения',94,116,'уравнения и решение задач');
  add('makarychev-advanced',7,'Формулы сокращённого умножения',140,178);
  add('makarychev-advanced',7,'Линейная функция',207,226,'линейная функция и графики');
  add('makarychev-advanced',7,'Системы линейных уравнений',244,277);

  add('makarychev-advanced',7,'Числовые выражения',13,17);
  add('makarychev-advanced',7,'Выражения с переменными',23,31);
  add('makarychev-advanced',7,'Свойства действий над числами',13,31,'числовые выражения и преобразования');
  add('makarychev-advanced',7,'Определение степени с натуральным показателем',38,43);
  add('makarychev-advanced',7,'Умножение и деление степеней',44,46);
  add('makarychev-advanced',7,'Одночлен и его стандартный вид',47,49);
  add('makarychev-advanced',7,'Умножение одночленов',47,49);
  add('makarychev-advanced',7,'Возведение одночлена в степень',50,55);
  add('makarychev-advanced',7,'Многочлен и его стандартный вид',64,70);
  add('makarychev-advanced',7,'Сложение и вычитание многочленов',71,75);
  add('makarychev-advanced',7,'Умножение одночлена на многочлен',76,81);
  add('makarychev-advanced',7,'Умножение многочлена на многочлен',82,88);
  add('makarychev-advanced',7,'Вынесение общего множителя за скобки',120,123);
  add('makarychev-advanced',7,'Разложение многочлена на множители способом группировки',124,127);
  add('makarychev-advanced',7,'Разность квадратов',140,147);
  add('makarychev-advanced',7,'Квадрат суммы и квадрат разности',148,152);
  add('makarychev-advanced',7,'Разложение по формулам квадрата суммы и разности',153,156);
  add('makarychev-advanced',7,'Понятие функции',186,193);
  add('makarychev-advanced',7,'График функции',194,201);
  add('makarychev-advanced',7,'Прямая пропорциональность и её график',207,213);
  add('makarychev-advanced',7,'Линейная функция и её график',214,219);
  add('makarychev-advanced',7,'Функции y=x² и y=x³',227,235);
  add('makarychev-advanced',7,'Линейное уравнение с двумя переменными',244,246);
  add('makarychev-advanced',7,'График линейного уравнения с двумя переменными',247,251);
  add('makarychev-advanced',7,'Система линейных уравнений с двумя переменными',256,259);
  add('makarychev-advanced',7,'Способ подстановки',260,264);
  add('makarychev-advanced',7,'Способ сложения',265,269);
  add('makarychev-advanced',7,'Решение задач с помощью систем уравнений',270,273);
  add('makarychev-advanced',7,'Линейные неравенства с двумя переменными и их системы',274,276);

  const EXTRA=new Set(['makarychev-base','makarychev-advanced','pogorelov','mordkovich-profile','mordkovich-base','alimov-base']);
  const oldDetect=engine.detectBook.bind(engine);
  const oldMatch=engine.matchBookToTopic.bind(engine);

  function domain(topic){
    const section=norm(topic?.section||'');
    if(/геометр|стереометр/.test(section))return 'geometry';
    return 'algebra';
  }
  function seriesDomain(series){return series==='pogorelov'?'geometry':'algebra';}
  function gradeAllowed(meta,topic){
    const g=Number(topic?.grade||0),from=Number(meta?.gradeFrom??meta?.grade??0),to=Number(meta?.gradeTo??meta?.grade??from);
    return !!g&&(!from||(g>=from&&g<=(to||from)));
  }
  function subjectAllowed(meta,topic){
    if(!EXTRA.has(meta?.series))return true;
    return seriesDomain(meta.series)===domain(topic);
  }
  function dynamicKey(bookId,title){return `${String(bookId)}|${norm(title)}`;}
  function matchExtra(meta,topic,book){
    if(!gradeAllowed(meta,topic)||!subjectAllowed(meta,topic))return null;
    // Verified/static map must win. Previously fuzzy OCR shadowed it and produced "без точных страниц".
    const s=extra.staticMap.get(key(meta.series,topic.grade,topic.title));
    if(s)return s;
    return extra.dynamic.get(dynamicKey(book?.id,topic?.title))||null;
  }
  function matchBookToTopic(meta,topic,source,book){
    if(meta?.series&&EXTRA.has(meta.series))return matchExtra(meta,topic,book);
    return oldMatch(meta,topic,source,book);
  }
  function buildCandidates({books=[],topics=[],sourceFor=()=>''}={}){
    const rows=[],recognized=[],unrecognized=[];
    for(const book of books){
      const meta=oldDetect(book);
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

  window.MathroomTextbookSyncV290={...engine,version:'2026.10.04.29.7.3',detectBook:oldDetect,matchBookToTopic,buildCandidates};
  window.MathroomTextbookCorrectorV2973={version:'29.7.3',subjectAllowed,domain,staticMap:extra.staticMap};
})();
