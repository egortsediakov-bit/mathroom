/* Run: node tests/v93-pdf-auto-topics.cjs
 * Coordinates come from the Mathroom 4-page PDF test document's text layer. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sandbox={window:{},console};
for(const name of ['js/pdf-layout-v93.js','js/pdf-topics-v93.js','js/pdf-import-v91.js']){
  new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name}).runInNewContext(sandbox);
}
const layout=sandbox.window.MathroomPdfLayoutV93;
const matcher=sandbox.window.MathroomPdfTopicsV93;
const importer=sandbox.window.MathroomPdfImportV91;
const item=(str,x,y,width=200)=>({str,transform:[1,0,0,1,x,y],width});
const fixtures=[
  {page:1,rows:[
    item('MATHROOM / ТЕСТ ИМПОРТА',46,786),
    item('01  /  Алгебра: текст и формулы',46,742),
    item('1',58,646,10),item('Решите уравнение: 3(2x − 1) = 4x + 9.',101,655,220),
    item('Текстовый слой',113,588,77),
    item('2',58,528,10),item('Упростите выражение:',101,537,132),
    item('(2a − 3)² − (a − 1)(a + 1).',101,517,145),
    item('Степени · Unicode',113,461,88),
    item('3',58,395,10),item('Вычислите выражение, изображённое ниже.',101,404,258),
    item('Проверка: извлеки 1–3, у №3 прикрепи изображение с дробями.',53,122)
  ]},
  {page:2,rows:[
    item('4',58,649,10),item('В треугольнике ABC стороны AB и AC равны.',101,658,256),
    item('Угол A равен 40°. Найдите угол B.',101,638,195),
    item('5',58,495,10),item('По таблице найдите среднее арифметическое',101,504,268),
    item('всех значений y.',101,484,95),
    item('6',58,339,10),item('Найдите площадь прямоугольника со сторонами',101,348,282),
    item('5 см и 8 см.',101,328,66),item('8 см',270,260,35),item('5 см',402,195,35)
  ]},
  {page:3,rows:[]},
  {page:4,rows:[
    item('НАМЕРЕННО ПРОБЛЕМНЫЕ УСЛОВИЯ',58,684),
    item('9',58,618,10),item('Решите уравнение: 3(2x − 1) = 4x + 9.',101,627,220),
    item('Текстовый слой',113,538,77),
    item('10',58,476,16),item('По рисунку найдите длину отрезка MN.',101,485,227),
    item('Рисунок отсутствует намеренно.',101,465,188),
    item('Предупреждение: нет рисунка',113,397,150),
    item('11',58,336,16),item('Вычислите значение выражения 4 + □ + 3.',101,345,240),
    item('Квадрат — специально повреждённый символ.',101,325,242),
    item('Предупреждение: символ □',113,257)
  ]}
];
const tasks=fixtures.flatMap(({page,rows})=>
  layout.splitPage(layout.linesFromItems(rows),page));
assert.equal(JSON.stringify(tasks.map(x=>x.number)),JSON.stringify(['1','2','3','4','5','6','9','10','11']));
assert.equal(tasks[0].content,'Решите уравнение: 3(2x − 1) = 4x + 9.');
assert.ok(tasks[1].content.includes('(2a − 3)²'));
assert.ok(tasks[3].content.includes('Угол A равен 40°'));
assert.ok(!tasks.some(t=>t.content.includes('Текстовый слой')));
assert.ok(!tasks.some(t=>t.content.includes('Предупреждение:')));
const inline=layout.splitPage(layout.linesFromItems([
  item('1. Найдите сумму чисел 9 и 13.',60,700),
  item('2. Решите уравнение 2x + 1 = 7.',60,660)
]),1);
assert.equal(inline.length,2);

const topics=[
  {id:'linear',grade:7,section:'Алгебра · Уравнения',title:'Линейное уравнение с одной переменной'},
  {id:'identities',grade:7,section:'Алгебра',title:'Формулы сокращённого умножения'},
  {id:'triangle',grade:7,section:'Геометрия',title:'Свойства равнобедренного треугольника'},
  {id:'average',grade:6,section:'Статистика',title:'Среднее арифметическое'},
  {id:'area',grade:3,section:'Геометрия',title:'Площадь прямоугольника и квадрата'},
  {id:'incorrect-default',grade:1,section:'Числа и счёт',title:'Числа от 1 до 20'}
];
const assignment=n=>matcher.propose({content:tasks.find(t=>t.number===n).content,
  topics,preferredGrade:1});
assert.equal(assignment('1').topicId,'linear');
assert.equal(assignment('1').grade,7); // class 1 default must not override relevant evidence
assert.equal(assignment('2').topicId,'identities');
assert.equal(assignment('4').topicId,'triangle');
assert.equal(assignment('5').topicId,'average');
assert.equal(assignment('6').topicId,'area');
assert.equal(assignment('3').topicId,null); // picture-only formula: teacher choice
assert.equal(assignment('11').topicId,null); // corrupted math character: teacher choice
assert.equal(assignment('9').topicId,'linear');
assert.ok(assignment('1').confidence>.75);
const importerSource=fs.readFileSync(path.join(root,'js/pdf-import-v91.js'),'utf8');
assert.ok(importerSource.includes("row.topicId=el.value||null"),'manual topic control must exist');
assert.ok(importerSource.includes("String(t.id)===String(x.topicId)"),'save must validate each task independently');
assert.ok(importerSource.includes("is_draft:true"),'PDF imports must remain drafts');
console.log('Mathroom v93 PASS: 9 tasks, isolated badge numbers, topic choices, no false guess for scans');
