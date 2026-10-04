/* Mathroom v29.7.0 — extra textbook families + OCR-derived page maps.
   Loaded after textbook-sync-v294.js and before app-v341.js. */
(() => {
  'use strict';

  const base = window.MathroomTextbookSyncV290;
  if (!base) {
    console.warn('[Mathroom 29.7.0] base textbook sync is not loaded');
    return;
  }

  const norm = s => String(s || '')
    .toLowerCase().replace(/ё/g, 'е').replace(/\u00ad/g, '')
    .replace(/[«»“”„]/g, '"').replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const DYNAMIC = new Map();
  const STATIC = new Map();
  const STATE = {preparedAt:0, sources:0, pages:0, mapped:0, error:''};

  const staticKey = (series, grade, title) => `${series}|${Number(grade)||0}|${norm(title)}`;
  const addStatic = (series, grade, title, from, to, label) => {
    STATIC.set(staticKey(series, grade, title), {
      page_from:Number(from), page_to:Number(to || from),
      note:`Автопривязка · карта Mathroom v29.7 · ${label || title}`,
      exactPages:true, catalog:true
    });
  };

  // Макарычев · 7 класс · базовый уровень, PDF 2024.
  // Физические PDF-страницы (не печатная нумерация).
  addStatic('makarychev-base',7,'Рациональные числа',6,11,'рациональные числа');
  addStatic('makarychev-base',7,'Линейные уравнения',35,43,'линейное уравнение и задачи');
  addStatic('makarychev-base',7,'Линейная функция',89,101,'линейная функция и график');
  addStatic('makarychev-base',7,'Степень с натуральным показателем',106,110,'степень с натуральным показателем');
  addStatic('makarychev-base',7,'Одночлены',111,125,'одночлены');
  addStatic('makarychev-base',7,'Многочлены',130,166,'многочлены и разложение на множители');
  addStatic('makarychev-base',7,'Формулы сокращённого умножения',166,201,'формулы сокращённого умножения');
  addStatic('makarychev-base',7,'Системы линейных уравнений',214,229,'системы линейных уравнений');

  // Макарычев · 8 класс · базовый уровень, PDF 2024 (+1 к печатной странице).
  addStatic('makarychev-base',8,'Рациональные дроби',6,57,'рациональные дроби');
  addStatic('makarychev-base',8,'Квадратные корни',65,108,'квадратные корни');
  addStatic('makarychev-base',8,'Квадратные уравнения',116,175,'квадратные уравнения');
  addStatic('makarychev-base',8,'Теорема Виета',133,142,'теорема Виета и квадратный трёхчлен');
  addStatic('makarychev-base',8,'Линейные неравенства',208,216,'неравенства с одной переменной');
  addStatic('makarychev-base',8,'Системы неравенств',216,224,'системы неравенств');
  addStatic('makarychev-base',8,'Степень с целым показателем',262,280,'степень с целым показателем');

  // Макарычев · 8 класс · углублённый уровень, физические страницы совпадают с печатными.
  addStatic('makarychev-advanced',8,'Рациональные дроби',4,44,'дроби и рациональные выражения');
  addStatic('makarychev-advanced',8,'Квадратные корни',120,153,'арифметический квадратный корень');
  addStatic('makarychev-advanced',8,'Квадратные уравнения',159,203,'квадратные уравнения');
  addStatic('makarychev-advanced',8,'Теорема Виета',178,193,'теорема Виета и квадратный трёхчлен');
  addStatic('makarychev-advanced',8,'Линейные неравенства',231,257,'неравенства с одной переменной');
  addStatic('makarychev-advanced',8,'Системы неравенств',239,257,'системы и совокупности неравенств');
  addStatic('makarychev-advanced',8,'Степень с целым показателем',263,279,'степень с целым показателем');

  function detectExtra(book){
    const raw = [book?.title, book?.author, book?.file_name, book?.subject, book?.level, book?.material_kind].filter(Boolean).join(' | ');
    const n = norm(raw);
    const gf = num(book?.grade_from) ?? num(book?.grade) ?? base.detectBook?.(book)?.grade ?? null;
    const gt = num(book?.grade_to) ?? gf;
    const advanced = /углуб|advanced|профиль/.test(n);
    const taskbook = /задачник|taskbook|сборник задач/.test(n);

    if (/макарычев|makarychev|миндюк|mind(y|j)uk|феоктистов|feoktistov/.test(n) && gf >= 7 && gf <= 9) {
      return {
        series: advanced ? 'makarychev-advanced' : 'makarychev-base',
        author: book?.author || (advanced ? 'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, И. Е. Феоктистов' : 'Ю. Н. Макарычев, Н. Г. Миндюк, К. И. Нешков, С. Б. Суворова'),
        grade:gf, gradeFrom:gf, gradeTo:gt, part:num(book?.part_no), year:null,
        resourceType:'textbook', recognized:true,
        label:`Макарычев · ${advanced ? 'углублённый' : 'базовый'}`
      };
    }
    if (/погорелов|pogorelov/.test(n)) {
      return {series:'pogorelov', author:book?.author||'А. В. Погорелов', grade:gf||7, gradeFrom:gf||7, gradeTo:gt||11, part:null, year:1995, resourceType:'textbook', recognized:true, label:'Погорелов'};
    }
    if (/мордкович|mordkovich|семенов|semenov/.test(n) && (gf >= 10 || gt >= 10)) {
      const profile = /профиль|profile/.test(n) || advanced;
      return {
        series: profile ? 'mordkovich-profile' : 'mordkovich-base',
        author:book?.author||'А. Г. Мордкович', grade:gf||10, gradeFrom:gf||10, gradeTo:gt||gf||10,
        part:num(book?.part_no), year:null, resourceType:taskbook?'taskbook':'textbook', recognized:true,
        label:`Мордкович · ${profile?'профильный':'базовый'}${taskbook?' · задачник':''}`
      };
    }
    if (/алимов|alimov/.test(n) && ((gf||10) >= 10 || (gt||11) >= 10)) {
      return {
        series:'alimov-base', author:book?.author||'Ш. А. Алимов и др.',
        grade:gf||10, gradeFrom:gf||10, gradeTo:gt||11, part:num(book?.part_no), year:2016,
        resourceType:'textbook', recognized:true, label:'Алимов · 10–11 классы'
      };
    }
    return null;
  }

  const EXTRA_SERIES = new Set(['makarychev-base','makarychev-advanced','pogorelov','mordkovich-profile','mordkovich-base','alimov-base']);
  const gradeAllowed = (meta, topic) => {
    const g = Number(topic?.grade || 0), from = Number(meta?.gradeFrom ?? meta?.grade ?? 0), to = Number(meta?.gradeTo ?? meta?.grade ?? from);
    return !!g && (!from || (g >= from && g <= (to || from)));
  };

  const dynamicKey = (bookId, topicTitle) => `${String(bookId)}|${norm(topicTitle)}`;

  function matchExtra(book, meta, topic){
    if (!gradeAllowed(meta, topic)) return null;
    const d = DYNAMIC.get(dynamicKey(book?.id, topic?.title));
    if (d) return d;
    return STATIC.get(staticKey(meta.series, topic.grade, topic.title)) || null;
  }

  const oldDetect = base.detectBook.bind(base);
  const oldMatch = base.matchBookToTopic.bind(base);

  function detectBook(book){ return detectExtra(book) || oldDetect(book); }
  function matchBookToTopic(bookMeta, topic, source, book){
    if (bookMeta?.series && EXTRA_SERIES.has(bookMeta.series)) return matchExtra(book, bookMeta, topic);
    return oldMatch(bookMeta, topic, source);
  }
  function buildCandidates({books=[],topics=[],sourceFor=()=>''}={}){
    const rows=[], recognized=[], unrecognized=[];
    for (const book of books) {
      const meta=detectBook(book); (meta?.recognized?recognized:unrecognized).push({book,meta});
      if (!meta?.recognized) continue;
      for (const topic of topics) {
        const source=sourceFor(topic)||'';
        const match=matchBookToTopic(meta,topic,source,book);
        if (!match) continue;
        rows.push({book,bookMeta:meta,topic,source,...match});
      }
    }
    return {rows,recognized,unrecognized,exactPages:rows.filter(x=>x.exactPages).length};
  }

  const STOP = new Set(['и','или','в','во','на','по','с','со','к','ко','из','для','при','его','ее','её','их','над','под','между','основные','понятие','решение','свойства']);
  const ALIASES = {
    'рациональные дроби':['рациональные дроби','рациональные выражения','дроби'],
    'квадратные корни':['квадратные корни','арифметический квадратный корень'],
    'квадратные уравнения':['квадратные уравнения','квадратное уравнение'],
    'теорема виета':['теорема виета'],
    'линейные неравенства':['линейные неравенства','неравенства с одной переменной'],
    'системы неравенств':['системы неравенств','систем неравенств'],
    'системы линейных уравнений':['системы линейных уравнений','систем двух линейных уравнений'],
    'линейная функция':['линейная функция'],
    'степень с натуральным показателем':['степень с натуральным показателем'],
    'степень с целым показателем':['степень с целым показателем'],
    'формулы сокращённого умножения':['формулы сокращенного умножения','квадрат суммы','разность квадратов'],
    'квадратичная функция':['квадратичная функция','функция y x2','функция y = x2'],
    'квадратные неравенства':['квадратные неравенства'],
    'рациональные неравенства':['рациональные неравенства','метод интервалов'],
    'арифметическая прогрессия':['арифметическая прогрессия'],
    'геометрическая прогрессия':['геометрическая прогрессия'],
    'вероятность':['вероятность'],
    'комбинаторика':['комбинаторика','перестановки','размещения','сочетания'],
    'степени и корни':['степени','корни','степенная функция'],
    'иррациональные уравнения':['иррациональные уравнения'],
    'показательная функция':['показательная функция'],
    'показательные уравнения':['показательные уравнения'],
    'логарифмы':['логарифм','логарифмы'],
    'логарифмические уравнения':['логарифмические уравнения'],
    'тригонометрическая окружность':['тригонометрическая окружность','единичная окружность'],
    'тригонометрические тождества':['тригонометрические тождества','формулы тригонометрии'],
    'тригонометрические уравнения':['тригонометрические уравнения'],
    'преобразования графиков':['преобразования графиков','преобразование графиков'],
    'производная — введение':['производная'],
    'производная и правила дифференцирования':['производная','правила дифференцирования'],
    'исследование функции':['исследование функции','исследование функций'],
    'задачи на оптимизацию':['наибольшее значение','наименьшее значение','оптимизация'],
    'первообразная и интеграл':['первообразная','интеграл'],
    'уравнения с параметром':['уравнения с параметром','параметр'],
    'вероятность и комбинаторика':['вероятность','комбинаторика'],
    'параллельные прямые':['параллельные прямые'],
    'сумма углов треугольника':['сумма углов треугольника'],
    'подобие треугольников':['подобие треугольников'],
    'теорема пифагора':['теорема пифагора'],
    'теоремы синусов и косинусов':['теорема синусов','теорема косинусов'],
    'окружность':['окружность'],
    'длина окружности и площадь круга':['длина окружности','площадь круга'],
    'четырёхугольники':['четырехугольники','четырёхугольники'],
    'площади':['площадь','площади'],
    'векторы':['векторы'],
    'векторы в пространстве':['векторы в пространстве'],
    'метод координат':['метод координат','координаты'],
    'синус, косинус и тангенс':['синус','косинус','тангенс'],
    'параллельность и перпендикулярность':['параллельность','перпендикулярность'],
    'призма и пирамида':['призма','пирамида'],
    'цилиндр и конус':['цилиндр','конус'],
    'шар и сфера':['шар','сфера'],
    'объёмы многогранников':['объем многогранника','объёмы многогранников']
  };
  function stems(title){
    return norm(title).split(' ').filter(x=>x.length>=4&&!STOP.has(x)).map(x=>x.slice(0,Math.min(7,x.length)));
  }
  function isTocLike(text){
    const t=norm(text);
    if(!t)return false;
    return t.includes('оглавление') || t.includes('содержание');
  }
  function pageScore(title,text){
    const t=norm(text), nt=norm(title); if(!t || isTocLike(text)) return {score:0,exact:false};
    const aliases=[nt,...(ALIASES[nt]||[]).map(norm)];
    for(const a of aliases){ if(a.length>=5 && t.includes(a)) return {score:1,exact:true}; }
    const ss=stems(title); if(!ss.length) return {score:0,exact:false};
    let hit=0; for(const s of ss) if(t.includes(s)) hit++;
    return {score:hit/ss.length,exact:false};
  }

  function client(){ return window.MR?.sb || window.MathroomLibrary2968?.resolveClient?.() || null; }
  async function loadPages(sb,sourceId){
    const out=[]; const chunk=500;
    for(let from=0;from<6000;from+=chunk){
      const {data,error}=await sb.from('task_bank_ocr_pages')
        .select('page_no,body_text,confidence,status')
        .eq('source_id',sourceId).eq('status','done').order('page_no').range(from,from+chunk-1);
      if(error) throw error;
      const rows=data||[]; out.push(...rows); if(rows.length<chunk) break;
    }
    return out;
  }
  function buildOcrMap(book,meta,topics,pages,pageCount){
    const hits=[];
    for(const topic of topics){
      if(!gradeAllowed(meta,topic)) continue;
      let best=null;
      for(const p of pages){
        const r=pageScore(topic.title,p.body_text||'');
        if(r.score<0.66) continue;
        const conf=Number(p.confidence??1)||0;
        const candidate={page:Number(p.page_no),score:r.score,exact:r.exact,confidence:conf};
        if(!best || candidate.score>best.score || (candidate.score===best.score && candidate.page<best.page)) best=candidate;
      }
      if(best && (best.exact || best.score>=0.8)) hits.push({topic,best});
    }
    hits.sort((a,b)=>a.best.page-b.best.page);
    let mapped=0;
    for(let i=0;i<hits.length;i++){
      const h=hits[i], next=hits.slice(i+1).find(x=>x.best.page>h.best.page);
      const maxEnd=Math.min(Number(pageCount)||99999,h.best.page+20);
      const end=next?Math.min(maxEnd,next.best.page-1):maxEnd;
      const exact=!!h.best.exact && h.best.confidence>=0.65;
      DYNAMIC.set(dynamicKey(book.id,h.topic.title),{
        page_from:h.best.page,page_to:Math.max(h.best.page,end),
        note:`Автопривязка · OCR-карта v29.7 · ${h.topic.title}`,
        exactPages:exact,catalog:false,ocrDerived:true,confidence:h.best.score
      });
      mapped++;
    }
    return mapped;
  }

  async function prepare({onProgress}={}){
    const sb=client(), S=window.MR?.S;
    DYNAMIC.clear();STATE.error='';
    if(!sb || !S?.textbooks?.length || !S?.topics?.length) return STATE;
    const newBooks=(S.textbooks||[]).map(book=>({book,meta:detectExtra(book)})).filter(x=>x.meta?.recognized);
    if(!newBooks.length) return STATE;
    let sources=[];
    try{
      const {data,error}=await sb.from('task_bank_sources').select('id,external_key,title,grade_from,grade_to,subject,ocr_status,page_count,meta').eq('is_active',true);
      if(error) throw error; sources=data||[];
    }catch(e){STATE.error=String(e?.message||e);return STATE;}
    let pageTotal=0,mapped=0,usedSources=0;
    for(let i=0;i<newBooks.length;i++){
      const {book,meta}=newBooks[i];
      const source=sources.find(s=>String(s?.meta?.textbook_id||'')===String(book.id)) || sources.find(s=>norm(s.title)===norm(book.title));
      if(!source) continue;
      usedSources++;
      try{
        onProgress?.(`Строим карту нового учебника ${i+1}/${newBooks.length}: ${meta.label}…`);
        const pages=await loadPages(sb,source.id); pageTotal+=pages.length;
        if(pages.length) mapped+=buildOcrMap(book,meta,S.topics||[],pages,source.page_count||pages.length);
      }catch(e){console.warn('[Mathroom 29.7 OCR map]',book.title,e);}
    }
    STATE.preparedAt=Date.now();STATE.sources=usedSources;STATE.pages=pageTotal;STATE.mapped=mapped;
    return STATE;
  }

  window.MathroomTextbookSyncV290={...base,version:'2026.10.04.29.7.1',detectBook,buildCandidates,matchBookToTopic};
  window.MathroomTextbookExtraV2970={version:'29.7.1',state:STATE,prepare,detectExtra,dynamic:DYNAMIC,staticMap:STATIC};
})();
