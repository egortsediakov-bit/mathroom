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
    if(!options.length)return {topicId:null,grade:null,confidence:0,
      reason:'Тема не определена — выбери вручную',alternatives:[]};
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
