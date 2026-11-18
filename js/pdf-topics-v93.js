/* Mathroom v93: explainable, offline topic suggestions for each task.
 * Never sends PDF or pupil data to external AI. All guesses are editable. */
(()=>{
  'use strict';
  const API={};
  const norm=s=>String(s??'').normalize('NFC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const RULES=[
    {id:'isosceles',when:/равнобедренн|треугольник[\s\S]{0,110}(?:сторон[ыа][\s\S]{0,25}равн|ab[\s\S]{0,40}ac[\s\S]{0,18}равн)/i,
      titles:[[/свойств.*равнобедренн.*треугольн/i,15],[/равнобедренн.*треугольн/i,12]],prefer:[7,6],why:'равнобедренный треугольник',confidence:.93},
    {id:'arithmetic-mean',when:/средн(?:ее|его|ий)\s+арифметическ/i,
      titles:[[/средн.*арифметическ/i,17],[/статистик/i,4]],prefer:[6,5,7],why:'среднее арифметическое',confidence:.96},
    {id:'rectangle-area',when:/площад[ьи]\s+(?:прямоугольник|квадрат)|прямоугольник[\s\S]{0,50}площад/i,
      titles:[[/площад.*прямоугольник/i,18],[/площад.*квадрат/i,10],[/площадь и объем/i,6]],prefer:[3,4,5,8],why:'площадь прямоугольника',confidence:.86},
    {id:'square-identities',when:/формул[ыа].*сокращенн|(?:упростит|преобразу)[\s\S]{0,130}(?:²|\^\s*2|квадрат)|\([^)]+\)\s*²[\s\S]{0,80}\([^)]+\)/i,
      titles:[[/формул.*сокращенн.*умножен/i,18],[/преобразован.*цел.*выраж/i,14],[/преобразован.*многочлен/i,12]],prefer:[7,8],why:'квадрат выражения и многочлены',confidence:.91},
    {id:'linear-equation',when:/(?:уравнен|решите)[\s\S]{0,70}(?:[a-zа-я]\s*[+\-=]|[a-zа-я]\s*\)|\([^)]+\))|(?:\d+[a-z]\s*[+\-]=)/i,
      titles:[[/линейн.*уравнен.*одн.*переменн/i,18],[/линейн.*уравнен/i,14],[/элементарн.*уравнен/i,5],[/^уравнения$/i,3]],prefer:[7,6,5],why:'линейное уравнение с одной переменной',confidence:.87},
    {id:'quadratic-equation',when:/квадратн(?:ое|ого|ые)\s+уравнен|(?:уравнен[\s\S]{0,60}x\s*²)/i,
      titles:[[/квадратн.*уравнен/i,18],[/уравнен.*корн/i,7]],prefer:[8,9],why:'квадратное уравнение',confidence:.9},
    {id:'percent',when:/процент[а-я]*|(?:\d+\s*%)/i,
      titles:[[/процент/i,17],[/задач.*процент/i,13]],prefer:[6,5,7],why:'проценты',confidence:.88},
    {id:'fractions',when:/дроб[ьяеи]|(?:\d+\s*\/\s*\d+)[\s\S]{0,20}[+*:-]/i,
      titles:[[/обыкновенн.*дроб/i,16],[/действ.*дроб/i,10],[/дробн.*выражен/i,10]],prefer:[5,6,7],why:'действия с дробями',confidence:.8},
    {id:'equation-system',when:/систем[уы][\s\S]{0,30}уравнен|решите\s+систему/i,
      titles:[[/систем.*уравнен/i,18],[/систем.*двух.*уравнен/i,15]],prefer:[7,8,9],why:'системы уравнений',confidence:.91},
    {id:'inequalities',when:/неравенств/i,
      titles:[[/неравенств/i,16]],prefer:[8,9,7,10],why:'неравенства',confidence:.84},
    {id:'arithmetic-progression',when:/арифметическ[\s\S]{0,25}прогресс/i,
      titles:[[/арифметическ.*прогресс/i,18],[/формул.*арифметическ.*прогресс/i,15]],prefer:[9,10],why:'арифметическая прогрессия',confidence:.92},
    {id:'geometric-progression',when:/геометрическ[\s\S]{0,25}прогресс/i,
      titles:[[/геометрическ.*прогресс/i,18]],prefer:[9,10],why:'геометрическая прогрессия',confidence:.92},
    {id:'trigonometry',when:/синус|косинус|тангенс|sin\b|cos\b|tg\b/i,
      titles:[[/тригонометр/i,16],[/синус/i,14],[/косинус/i,14],[/тангенс/i,14]],prefer:[10,11,9],why:'тригонометрия',confidence:.87},
    {id:'logarithms',when:/логарифм|log\d*\s*\(/i,
      titles:[[/логарифм/i,18]],prefer:[10,11],why:'логарифмы',confidence:.91},
    {id:'derivative',when:/производн/i,
      titles:[[/производн/i,18]],prefer:[11,10],why:'производная',confidence:.91},
    {id:'integral',when:/интеграл|первообразн/i,
      titles:[[/интеграл/i,18],[/первообразн/i,17]],prefer:[11,10],why:'интеграл и первообразная',confidence:.88},
    {id:'probability',when:/вероятност/i,
      titles:[[/вероятност/i,18]],prefer:[9,10,11,7],why:'теория вероятностей',confidence:.87},
    {id:'combinatorics',when:/сочетани[йя]|перестановк|комбинаторик/i,
      titles:[[/комбинаторик/i,17],[/сочетани/i,14],[/перестановк/i,14]],prefer:[8,9,10,7],why:'комбинаторика',confidence:.84},
    {id:'square-roots',when:/квадратн[\s\S]{0,18}корн|√/i,
      titles:[[/арифметическ.*квадратн.*корн/i,18],[/квадратн.*корн/i,15]],prefer:[8,9],why:'квадратные корни',confidence:.86},
    {id:'pythagoras',when:/пифагор|гипотенуз|катет/i,
      titles:[[/теорем.*пифагор/i,18],[/прямоугольн.*треугольн/i,12]],prefer:[8,7,9],why:'теорема Пифагора',confidence:.85},
    {id:'functions',when:/график[\s\S]{0,25}функци|функци[\s\S]{0,25}график/i,
      titles:[[/график.*функци/i,17],[/линейн.*функци/i,12]],prefer:[7,8,9],why:'графики функций',confidence:.84},
    {id:'vectors',when:/вектор/i,
      titles:[[/вектор/i,18]],prefer:[9,10],why:'векторы',confidence:.89},
    {id:'proportions',when:/пропорц|прям[а-я]*\s+пропорцион|обратн[а-я]*\s+пропорцион/i,
      titles:[[/пропорц/i,18]],prefer:[6,7,5],why:'пропорции',confidence:.89},
    {id:'similar-triangles',when:/подобн[а-я]*\s+треугольн/i,
      titles:[[/подобн.*треугольн/i,18],[/признак.*подоб/i,14]],prefer:[8,9],why:'подобие треугольников',confidence:.91},
    {id:'linear-equation-generic',when:/решите?\s+уравнение|найдите?\s+корень\s+уравнени/i,
      titles:[[/линейн.*уравнен/i,12],[/^уравнения$/i,9]],prefer:[7,6,5],why:'уравнения',confidence:.67},
    {id:'segment',when:/длин[уаеы]\s+отрезк|найдите[\s\S]{0,35}отрезк/i,
      titles:[[/^отрезок$/i,12],[/длин.*отрезк/i,10]],prefer:[5,7,2],why:'отрезки и длины',confidence:.59},
    {id:'polynomials',when:/упростите?\s+выражени|преобразуйт.*выражени|многочлен/i,
      titles:[[/преобразован.*выраж/i,12],[/многочлен/i,9],[/выражени.*переменн/i,6]],prefer:[7,6,5],why:'преобразование выражений',confidence:.64}
  ];
  const scoreTopic=(topic,rule,preferredGrade)=>{
    const title=norm(topic.title),section=norm(topic.section),grade=Number(topic.grade);
    let best=0;
    for(const [re,value] of rule.titles)if(re.test(title))best=Math.max(best,value);
    if(!best)return 0;
    let result=best;
    const at=rule.prefer.indexOf(grade);
    if(at>=0)result+=5-Math.min(at,4);
    if(preferredGrade===grade&&rule.prefer.includes(grade))result+=.4;
    if(rule.id.includes('equation')&&section.includes('уравнен'))result+=.3;
    if(rule.id==='square-identities'&&section.includes('сокращен'))result+=1.5;
    return result;
  };
  API.propose=({content='',topics=[],preferredGrade=null}={})=>{
    const text=norm(content);
    if(text.length<18||/[�□\uE000-\uF8FF]/u.test(text))return {topicId:null,grade:null,confidence:0,reason:'Недостаточно читаемого текста',alternatives:[]};
    const options=[];
    for(const rule of RULES){
      if(!rule.when.test(text))continue;
      const eligible=(topics||[]).map(t=>({topic:t,score:scoreTopic(t,rule,Number(preferredGrade))}))
        .filter(x=>x.score>=8).sort((a,b)=>b.score-a.score||Number(a.topic.grade)-Number(b.topic.grade));
      for(const item of eligible.slice(0,3)){
        options.push({topic:item.topic,score:item.score,
          confidence:Math.min(rule.confidence,rule.confidence*(.75+.25*item.score/23)),
          reason:rule.why,rule:rule.id});
      }
    }
    if(!options.length){
      const ignored=new Set(['задачи','задача','основные','простые','числовые','разные','понятие','общие','решение','методы','метод','введение','свойства']);
      const stems=str=>[...new Set((norm(str).match(/[а-яa-z]{5,}/g)||[])
        .filter(w=>!ignored.has(w))
        .map(w=>w.slice(0,Math.min(6,w.length-2))))];
      const body=new Set(stems(text));
      const lexical=(topics||[]).map(t=>{
        const ts=stems(t.title),hits=ts.filter(st=>body.has(st)).length;
        return {topic:t,hits,ratio:ts.length?hits/ts.length:0,score:hits+(ts.length?hits/ts.length:0)};
      }).filter(x=>x.hits>=2&&x.ratio>=.5)
        .sort((a,b)=>b.score-a.score + (Number(b.topic.grade)===Number(preferredGrade)?0.01:0) - (Number(a.topic.grade)===Number(preferredGrade)?0.01:0) || Number(a.topic.grade)-Number(b.topic.grade));
      if(lexical.length){
        const first=lexical[0],second=lexical[1];
        const tied=second && Math.abs(first.score-second.score)<.2 && Number(first.topic.grade)!==Number(second.topic.grade);
        if(!tied)return {topicId:first.topic.id,grade:Number(first.topic.grade),
          confidence:Math.min(.7,Math.round((.45+.15*first.ratio+.03*Math.min(first.hits,3))*100)/100),
          reason:'совпадение терминов с названием темы — обязательно проверь',
          alternatives:lexical.slice(0,4).map(x=>({topicId:x.topic.id,grade:Number(x.topic.grade),
            title:x.topic.title,confidence:.5}))};
        return {topicId:null,grade:null,confidence:0,
          reason:'Похожая тема встречается в нескольких классах — выбери вручную',
          alternatives:lexical.slice(0,4).map(x=>({topicId:x.topic.id,grade:Number(x.topic.grade),
            title:x.topic.title,confidence:.5}))};
      }
      return {topicId:null,grade:null,confidence:0,
        reason:'Тема не определена — выбери вручную',alternatives:[]};
    }
    options.sort((a,b)=>b.score-a.score||b.confidence-a.confidence);
    const top=options[0],unique=[],seen=new Set();
    for(const c of options){
      if(seen.has(String(c.topic.id)))continue;
      seen.add(String(c.topic.id));unique.push(c);
    }
    return {topicId:top.topic.id,grade:Number(top.topic.grade),
      confidence:Math.round(top.confidence*100)/100,reason:top.reason,
      alternatives:unique.slice(0,4).map(c=>({topicId:c.topic.id,grade:Number(c.topic.grade),
        title:c.topic.title,confidence:Math.round(c.confidence*100)/100}))};
  };
  window.MathroomPdfTopicsV93=API;
})();
