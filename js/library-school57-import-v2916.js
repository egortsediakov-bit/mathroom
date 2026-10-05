/* Mathroom v29.16.1 — strict dedicated School 57 taskbook importer. */
(()=>{
'use strict';
const api=window.MathroomTaskImportV298;if(!api||api.__s5729161)return;
const V='29.16.1',MR=()=>window.MR||{},S=()=>MR().S||{},db=()=>MR().sb||window.MathroomLibrary2968?.resolveClient?.()||null;
const clean=s=>String(s||'').replace(/\u00ad/g,'').replace(/([А-Яа-яЁё])-\s+([А-Яа-яЁё])/g,'$1$2').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').trim();
const norm=s=>clean(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9%]+/gi,' ').replace(/\s+/g,' ').trim();
const hash=s=>{let h=2166136261>>>0;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h.toString(36)};
const fp=s=>'s57-'+hash(norm(s)),state={busy:false,last:null};
const CMD=/(?:^|[.!?;:]\s*)(?:реши(?:те)?|найди(?:те)?|вычисли(?:те)?|докажи(?:те)?|построй(?:те)?|сравни(?:те)?|упрости(?:те)?|разложи(?:те)?|представь(?:те)?|определи(?:те)?|исследуй(?:те)?|составь(?:те)?|запиши(?:те)?|укажи(?:те)?|вырази(?:те)?|выполни(?:те)?|ответь(?:те)?|заполни(?:те)?|подбери(?:те)?|сократи(?:те)?|расставь(?:те)?|замени(?:те)?|проверь(?:те)?|пользуясь\b[^.!?]{0,120}\bвычисли(?:те)?)\b/i;
const Q=/(?:\?|\bсколько\b|\bчему\s+рав|\bкако(?:й|е|ая|ие|ую)\b|\bможно\s+ли\b|\bверно\s+ли\b|\bза\s+сколько\b|\bчерез\s+сколько\b|\bна\s+сколько\b)/i;
const SOL=/^(?:имеем\b|выпишем\b|получим\b|получаем\b|найд[её]м\b|вычислим\b|подставим\b|разложим\b|упростим\b|докажем\b|построим\b|составим\b|перепишем\b|возвед[её]м\b|умножим\b|разделим\b|следовательно\b|таким\s+образом\b|отсюда\b|поэтому\b|мы\s+(?:получим|получили|получаем|имеем|видим)\b)/i;
const THEORY=/(?:ещ[её]\s+раз\s+подчеркн|называется\b|называют\b|представляет\s+собой\b|является\b|являются\b|важно\s+знать\b|рассмотрим\b|напомним\b|теорема\b|определение\b)/i;
const BADPAGE=/^\s*(?:оглавление|содержание|ответы(?:\s|$)|предметный\s+указатель)/i;
const TWO=/^\s*(\d{1,2}[.,]\d{1,4})\.\s*(.*)$/i,SIMPLE=/^\s*(\d{1,4})\.\s+(.{2,})$/i;
function is57(x){const m=x?.meta||{};if(String(m.task_source_family||'').toLowerCase()==='school57'&&m.canonical_task_source!==false)return true;return /(?:^|[^0-9])[5-8][\s_.-]*57(?:[^0-9]|$)|57\s*(?:школ|school)/i.test(`${x?.title||''} ${x?.filename||''}`)}
function grade(x){const m=x?.meta||{},n=Number(m.task_source_grade||x?.grade||x?.grade_from||0);if(n>=5&&n<=8)return n;const z=`${x?.title||''} ${x?.filename||''}`.match(/(?:^|[^0-9])([5-8])[\s_.-]*57(?:[^0-9]|$)/);return z?Number(z[1]):0}
function prep(s){return String(s||'').replace(/\u00ad/g,'').replace(/([^\n])\s+(\d{1,2}[.,]\d{1,4})\.\s+(?=[А-ЯA-ZЁ])/g,'$1\n$2. ')}
function mathCount(t){return (String(t).match(/[0-9=+−–\-*/^√()\[\]{}<>%]/g)||[]).length}
function wordCount(t){return (String(t).match(/[А-Яа-яЁёA-Za-z]{2,}/g)||[]).length}
function titleLike(first){const t=clean(first);if(!t)return true;if(CMD.test(t)||Q.test(t)||mathCount(t)>=4)return false;const w=wordCount(t);return w>=1&&w<=12&&t.length<=120&&!/[?!:;=]/.test(t)}
function taskLike(text,first){const t=clean(text);if(t.length<8||t.length>2200)return false;if(SOL.test(t)||THEORY.test(first||''))return false;if(CMD.test(t)||Q.test(t))return true;return false}
function parse(pages,g){
 const out=[];
 for(const p of pages||[]){
  const body=prep(p.body_text);if(BADPAGE.test(clean(body).slice(0,500)))continue;
  let cur=null;
  const done=()=>{if(!cur)return;const first=clean(cur.first||''),t=clean(cur.a.join(' '));if(!cur.heading&&taskLike(t,first))out.push({...cur,content:t});cur=null};
  for(const raw of body.split(/\n+/)){
   const l=clean(raw);if(!l||/^\d{1,4}$/.test(l))continue;
   let m=l.match(TWO);
   if(m){done();const first=clean(m[2]);cur={taskNo:m[1].replace(',','.'),page_no:+p.page_no||1,conf:+p.confidence||0,first,a:first?[first]:[],heading:titleLike(first)};continue}
   if(g===7&&(m=l.match(SIMPLE))&&+m[1]>=1&&+m[1]<=5000){done();const first=clean(m[2]);cur={taskNo:m[1],page_no:+p.page_no||1,conf:+p.confidence||0,first,a:[first],heading:false};continue}
   if(/^(?:глава\b|§\s*\d+|параграф\b|приложение\b|[IVXLCDM]{2,}\.?$)/i.test(l)){done();continue}
   if(cur)cur.a.push(l);
  }
  done();
 }
 return out;
}
function tg(t){for(const k of ['grade','class_no','class','grade_from']){const n=+t?.[k]||0;if(n>=1&&n<=11)return n}const m=String(t?.title||'').match(/(?:^|\s)([1-9]|1[01])\s*(?:класс|кл\.)/i);return m?+m[1]:0}
function linked(ls,tm,p){let best=null,span=1e9;for(const l of ls||[]){const a=+l.page_from||0,b=+l.page_to||a;if(a&&p>=a&&p<=b){const t=tm.get(String(l.topic_id));if(t&&b-a<span){best=t;span=b-a}}}return best}
const roots=['процент','дроб','уравнен','неравен','функц','многочлен','одночлен','степен','корен','пропорц','систем','треуголь','четырехуголь','окружн','площад','периметр','объем','вероят','координат','график','делимост','натурал','цел','рационал','квадратн','арифмет','геометр','текстов','движен','нод','нок'];
function infer(ts,g,text){const low=norm(text),cs=(ts||[]).filter(t=>!tg(t)||!g||tg(t)===g);let best=null,score=0;for(const t of cs){const title=norm(t.title);let s=low.includes(title)&&title.length>5?20:0;for(const r of roots)if(low.includes(r)&&title.includes(r))s+=8;for(const w of title.split(' ').filter(x=>x.length>=5)){const q=w.slice(0,6);if(q.length>=4&&low.includes(q))s+=2}if(/сколько|за сколько|через сколько|скорост|работа|труба|время/i.test(text)&&/текстов|задач|движен/.test(title))s+=4;if(/вычисл|сократ|сравнит/i.test(text)&&/числ|действ|дроб|выраж/.test(title))s+=3;if(s>score){score=s;best=t}}if(score>=3)return best;return cs.find(t=>/свойств.*действ.*чис|числов.*выраж|вычислен/i.test(String(t.title||'')))||null}
async function uid(c){if(S()?.user?.id)return S().user.id;try{return (await c.auth.getUser()).data.user?.id||null}catch{return null}}
async function pages(c,id){const a=[];for(let f=0;f<3000;f+=500){const {data,error}=await c.from('task_bank_ocr_pages').select('page_no,body_text,confidence,status').eq('source_id',id).eq('status','done').order('page_no').range(f,f+499);if(error)throw error;const x=data||[];a.push(...x);if(x.length<500)break}return a}
async function importIds(c,ids){let n=0;for(let i=0;i<ids.length;i+=200){const {data,error}=await c.rpc('mathroom_import_task_candidates',{p_ids:ids.slice(i,i+200)});if(error)throw error;n+=Number(data)||0}return n}
async function purgeOld(c,teacher,srcs){
 const ids=srcs.map(x=>x.id).filter(Boolean);if(!ids.length)return {exercises:0,candidates:0};
 const needs=srcs.some(x=>String(x?.meta?.school57_parser_version||'')!==V);if(!needs)return {exercises:0,candidates:0};
 const exIds=new Set(),candIds=[];
 for(let f=0;f<10000;f+=500){const {data,error}=await c.from('task_bank_import_candidates').select('id,source_id,exercise_id,meta').eq('teacher_id',teacher).in('source_id',ids).range(f,f+499);if(error)throw error;const a=data||[];for(const r of a){candIds.push(r.id);if(r.exercise_id)exIds.add(r.exercise_id)}if(a.length<500)break}
 for(let f=0;f<10000;f+=500){const {data,error}=await c.from('exercises').select('id,generator_spec').eq('teacher_id',teacher).eq('kind','task').contains('tags',['mathroom-core-bank-v29.8-pdf']).range(f,f+499);if(error)throw error;const a=data||[];for(const r of a){try{const m=JSON.parse(r.generator_spec||'{}');if(ids.includes(m.source_id))exIds.add(r.id)}catch{}}if(a.length<500)break}
 const ex=[...exIds];for(let i=0;i<ex.length;i+=100){const {error}=await c.from('exercises').delete().eq('teacher_id',teacher).in('id',ex.slice(i,i+100));if(error)throw error}
 for(let i=0;i<candIds.length;i+=100){const {error}=await c.from('task_bank_import_candidates').delete().eq('teacher_id',teacher).in('id',candIds.slice(i,i+100));if(error)throw error}
 for(const src of srcs){const m={...(src.meta||{}),school57_parser_version:V};const {error}=await c.from('task_bank_sources').update({meta:m}).eq('id',src.id);if(error)console.warn('[School57 parser marker]',error)}
 return {exercises:ex.length,candidates:candIds.length};
}
async function scan(opts={}){if(state.busy)return state.last;const c=db();if(!c)return null;const teacher=await uid(c);if(!teacher)return null;state.busy=true;try{const [{data:ss,error:e1},{data:ls,error:e2}]=await Promise.all([c.from('task_bank_sources').select('id,title,filename,storage_path,grade,grade_from,meta,is_active').eq('is_active',true),c.from('textbook_topic_links').select('textbook_id,topic_id,page_from,page_to').not('page_from','is',null)]);if(e1)throw e1;if(e2)throw e2;const srcs=(ss||[]).filter(is57),books=S().textbooks||[],topics=S().topics||[],tm=new Map(topics.map(t=>[String(t.id),t])),by=new Map();for(const l of ls||[]){const k=String(l.textbook_id);if(!by.has(k))by.set(k,[]);by.get(k).push(l)}const purged=await purgeOld(c,teacher,srcs);let pc=0,parsed=0,mapped=0,unmapped=0,imported=0;for(let i=0;i<srcs.length;i++){const src=srcs[i],g=grade(src),meta=src.meta||{};opts.onProgress?.(`57 школа ${g} класс: извлекаем задачи ${i+1}/${srcs.length}`);const ps=await pages(c,src.id);pc+=ps.length;const tasks=parse(ps,g);parsed+=tasks.length;const book=books.find(b=>String(b.id)===String(meta.textbook_id||''))||books.find(b=>String(b.file_path||'')===String(src.storage_path||'')),bl=book?by.get(String(book.id))||[]:[];const rows=[];for(const t of tasks){const topic=linked(bl,tm,t.page_no)||infer(topics,g,t.content);if(!topic){unmapped++;continue}mapped++;rows.push({teacher_id:teacher,source_id:src.id,textbook_id:book?.id||meta.textbook_id||null,topic_id:topic.id,grade:g||tg(topic)||null,topic_title:String(topic.title||''),source_title:String(src.title||`57 школа ${g} класс`),page_no:t.page_no,task_no:t.taskNo,content:t.content,answer:'',confidence:Math.max(.92,Math.min(.99,(t.conf||0)+.08)),difficulty:'medium',fingerprint:fp(`${src.id}|${t.taskNo}|${t.content}`),status:'ready',meta:{source_kind:'taskbook',source_family:'school57',parser_version:V,grade:g}})}for(let j=0;j<rows.length;j+=150){const {data,error}=await c.from('task_bank_import_candidates').upsert(rows.slice(j,j+150),{onConflict:'teacher_id,fingerprint'}).select('id,status,exercise_id');if(error)throw error;const ids=(data||[]).filter(r=>r.status!=='imported'&&!r.exercise_id).map(r=>r.id);if(ids.length)imported+=await importIds(c,ids)}}state.last={version:V,sources:srcs.length,pagesScanned:pc,parsed,mapped,unmapped,imported,purged,at:Date.now()};try{await window.MathroomTaskStrictGate29111?.cleanAll?.({silent:true})}catch{}try{await window.MathroomBankPerformanceV2983?.refreshCount?.({force:true})}catch{}try{await window.MathroomTaskImportUIV2983?.render?.(true)}catch{}return state.last}catch(e){console.error('[School57 import]',e);state.last={version:V,error:String(e?.message||e)};return state.last}finally{state.busy=false}}
const prev=api.scanAndImport.bind(api);api.scanAndImport=async o=>{const b=await prev(o||{}),x=await scan(o||{}),r={...(b||{}),school57:x};if(x&&!x.error){r.pagesScanned=Math.max(+b?.pagesScanned||0,+x.pagesScanned||0);r.parsed=(+b?.parsed||0)+(+x.parsed||0);r.autoImported=(+b?.autoImported||0)+(+x.imported||0);r.sourcesMatched=Math.max(+b?.sourcesMatched||0,+x.sources||0);r.sourcesTotal=Math.max(+b?.sourcesTotal||0,+x.sources||0)}api.state.last=r;return r};
api.scanSchool572916=scan;api.__s5729161=true;window.MathroomSchool57Import2916={version:V,state,scan,parse};
})();
