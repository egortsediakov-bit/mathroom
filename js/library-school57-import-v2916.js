/* Mathroom v29.17.1 — structural parser for School 57 taskbooks. */
(()=>{
'use strict';
const api=window.MathroomTaskImportV298;if(!api||api.__s5729171)return;
const V='29.17.1',MR=()=>window.MR||{},S=()=>MR().S||{},db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/([А-Яа-яЁё])-\s+([А-Яа-яЁё])/g,'$1$2').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').trim();
const norm=s=>clean(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9%]+/gi,' ').replace(/\s+/g,' ').trim();
const hash=s=>{let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h.toString(36)};
const fp=s=>'s57-'+hash(norm(s)),state={busy:false,last:null};
const CMD=/(?:^|[.!?;:]\s*)(?:реши(?:те)?|найди(?:те)?|вычисли(?:те)?|докажи(?:те)?|построй(?:те)?|сравни(?:те)?|упрости(?:те)?|разложи(?:те)?|представь(?:те)?|определи(?:те)?|исследуй(?:те)?|составь(?:те)?|запиши(?:те)?|укажи(?:те)?|вырази(?:те)?|выполни(?:те)?|ответь(?:те)?|заполни(?:те)?|подбери(?:те)?|сократи(?:те)?|расставь(?:те)?|замени(?:те)?|проверь(?:те)?|сформулируй(?:те)?|объясни(?:те)?|придумай(?:те)?|переведи(?:те)?|изобрази(?:те)?|начерти(?:те)?|прочитай(?:те)?|пользуясь\b[^.!?]{0,120}\bвычисли(?:те)?)\b/i;
const Q=/(?:\?|\bсколько\b|\bчему\s+рав|\bкако(?:й|е|ая|ие|ую|ва)\b|\bможно\s+ли\b|\bверно\s+ли\b|\bза\s+сколько\b|\bчерез\s+сколько\b|\bна\s+сколько\b|\bво\s+сколько\b)/i;
const SOL=/^(?:решение\b|ответ\b|имеем\b|выпишем\b|получим\b|получаем\b|найд[её]м\b|вычислим\b|подставим\b|разложим\b|упростим\b|докажем\b|построим\b|составим\b|перепишем\b|возвед[её]м\b|умножим\b|разделим\b|следовательно\b|таким\s+образом\b|отсюда\b|поэтому\b|мы\s+(?:получим|получили|получаем|имеем|видим)\b)/i;
const THEORY=/(?:ещ[её]\s+раз\s+подчеркн|называется\b|называют\b|представляет\s+собой\b|является\b|являются\b|важно\s+знать\b|рассмотрим\b|напомним\b|теорема\b|определение\b|алгоритм\b|правило\b|свойство\b|в\s+двух\s+предыдущих\s+примерах|рассмотренные\s+примеры|теперь\s+достаточно|поскольку\s+у\s+данных|целые\s+части\s+у\s+этих)/i;
const BADPAGE=/^\s*(?:оглавление|содержание|ответы(?:\s|$)|предметный\s+указатель)/i;
const TWO=/^\s*(\d{1,2})\s*[.,]\s*(\d{1,4})\s*\.\s*(.*)$/i;
const SIMPLE=/^\s*(\d{1,4})\s*\.\s*(.*)$/i;
function is57(x){const m=x?.meta||{};if(String(m.task_source_family||'').toLowerCase()==='school57'&&m.canonical_task_source!==false)return true;return /(?:^|[^0-9])[5-8][\s_.-]*57(?:[^0-9]|$)|57\s*(?:школ|school)/i.test(`${x?.title||''} ${x?.filename||''}`)}
function grade(x){const m=x?.meta||{},n=Number(m.task_source_grade||x?.grade||x?.grade_from||0);if(n>=5&&n<=8)return n;const z=`${x?.title||''} ${x?.filename||''}`.match(/(?:^|[^0-9])([5-8])[\s_.-]*57(?:[^0-9]|$)/);return z?Number(z[1]):0}
function mathCount(t){return (String(t).match(/[0-9=+−–\-*/^√()\[\]{}<>%]/g)||[]).length}
function wordCount(t){return (String(t).match(/[А-Яа-яЁёA-Za-z]{2,}/g)||[]).length}
function upperRatio(t){const a=String(t).match(/[А-ЯЁA-Z]/g)||[],b=String(t).match(/[А-Яа-яЁёA-Za-z]/g)||[];return b.length?a.length/b.length:0}
function looksHeading(text){const t=clean(text);if(!t)return true;if(CMD.test(t)||Q.test(t))return false;if(SOL.test(t))return false;if(mathCount(t)>=4)return false;const w=wordCount(t);if(w>0&&w<=14&&t.length<=150&&(upperRatio(t)>.58||!/[,;?!:=]/.test(t)))return true;return false}
function validTask(text,structural){const t=clean(text);if(t.length<5||t.length>3200)return false;if(SOL.test(t)||/^пример\s*\d*\b/i.test(t))return false;
  const first=t.slice(0,700);
  if(THEORY.test(first)&&!CMD.test(first)&&!Q.test(first))return false;
  if(CMD.test(t)||Q.test(t))return true;
  if(!structural)return false;
  // Permit compact formula-only exercises, but never long narrative/theory blocks.
  if(t.length<=260&&mathCount(t)>=5&&wordCount(t)<=18&&!THEORY.test(t))return true;
  return false;
}
function parse(pages,g){
 const out=[];let section='';
 for(const p of pages||[]){
  const body=String(p.body_text||'');if(BADPAGE.test(clean(body).slice(0,500)))continue;
  let cur=null;
  const done=()=>{if(!cur)return;const text=clean(cur.parts.join(' '));if(!text){cur=null;return}const heading=cur.kind==='two'&&looksHeading(text);if(heading){section=text;cur=null;return}if(validTask(text,true))out.push({...cur,content:text,sectionTitle:section});cur=null};
  for(const raw of body.split(/\n+/)){
   const l=clean(raw);if(!l||/^\d{1,4}$/.test(l))continue;
   let m=l.match(TWO);
   if(m){done();cur={taskNo:`${m[1]}.${m[2]}`,page_no:+p.page_no||1,conf:+p.confidence||0,parts:m[3]?[m[3]]:[],kind:'two'};continue}
   if(g===7&&(m=l.match(SIMPLE))&&+m[1]>=1&&+m[1]<=5000){done();cur={taskNo:m[1],page_no:+p.page_no||1,conf:+p.confidence||0,parts:m[2]?[m[2]]:[],kind:'simple'};continue}
   if(/^(?:глава\b|§\s*\d+|параграф\b|приложение\b|[IVXLCDM]{2,}\.?$)/i.test(l)){done();continue}
   if(cur)cur.parts.push(l);
  }
  done();
 }
 return out;
}
function tg(t){for(const k of ['grade','class_no','class','grade_from']){const n=+t?.[k]||0;if(n>=1&&n<=11)return n}const m=String(t?.title||'').match(/(?:^|\s)([1-9]|1[01])\s*(?:класс|кл\.)/i);return m?+m[1]:0}
function linked(ls,tm,p){let best=null,span=1e9;for(const l of ls||[]){const a=+l.page_from||0,b=+l.page_to||a;if(a&&p>=a&&p<=b){const t=tm.get(String(l.topic_id));if(t&&b-a<span){best=t;span=b-a}}}return best}
const roots=['процент','дроб','уравнен','неравен','функц','многочлен','одночлен','степен','корен','пропорц','систем','треуголь','четырехуголь','окружн','площад','периметр','объем','вероят','координат','график','делимост','натурал','цел','рационал','квадратн','арифмет','геометр','текстов','движен','нод','нок','отношен','масштаб'];
function infer(ts,g,text){const low=norm(text),cs=(ts||[]).filter(t=>!tg(t)||!g||tg(t)===g);let best=null,score=0;for(const t of cs){const title=norm(t.title);let s=low.includes(title)&&title.length>5?20:0;for(const r of roots)if(low.includes(r)&&title.includes(r))s+=8;for(const w of title.split(' ').filter(x=>x.length>=5)){const q=w.slice(0,6);if(q.length>=4&&low.includes(q))s+=2}if(/сколько|за сколько|через сколько|скорост|работа|труба|время/i.test(text)&&/текстов|задач|движен/.test(title))s+=5;if(/вычисл|сократ|сравнит/i.test(text)&&/числ|действ|дроб|выраж/.test(title))s+=4;if(s>score){score=s;best=t}}if(score>=3)return best;return cs.find(t=>/числов.*выраж|свойств.*действ.*чис|вычислен/i.test(String(t.title||'')))||cs[0]||null}
async function uid(c){if(S()?.user?.id)return S().user.id;try{return (await c.auth.getUser()).data.user?.id||null}catch{return null}}
async function pages(c,id){const out=[];for(let f=0;f<4000;f+=500){const{data,error}=await c.from('task_bank_ocr_pages').select('page_no,body_text,confidence,status').eq('source_id',id).order('page_no').range(f,f+499);if(error)throw error;const rows=data||[];for(const r of rows)if(String(r.body_text||'').trim())out.push(r);if(rows.length<500)break}return out}
async function importIds(c,ids){let n=0;for(let i=0;i<ids.length;i+=200){const{data,error}=await c.rpc('mathroom_import_task_candidates',{p_ids:ids.slice(i,i+200)});if(error)throw error;n+=Number(data)||0}return n}
api.scanSchool572916=api.scanSchool572916||(()=>null);api.__s5729171=true;window.MathroomSchool57Import2916={version:V,state,scan:api.scanSchool572916,parse,is57,grade,infer,linked,pages,uid,importIds,fp,clean,norm};
})();
