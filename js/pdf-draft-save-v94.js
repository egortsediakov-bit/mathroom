/* Mathroom v94 — safe partial PDF draft-save planner.
 * No writes or AI calls: pure checks for the review screen. */
(()=>{
  'use strict';
  const API={};
  const fingerprint=s=>String(s??'').normalize('NFC').toLocaleLowerCase('ru-RU')
    .replace(/[«»"'’]/g,'').replace(/\s+/g,' ').trim();
  API.plan=(entries=[],topics=[],existing=[])=>{
    const selected=(entries||[]).filter(x=>x?.selected&&!x.imported);
    const ready=[],pending=[],duplicates=[],seen=new Map(),bank=new Map();
    // Only exact normalized content is a hard duplicate. Visual-only tasks
    // may share generic placeholder text while showing different diagrams.
    for(const item of existing||[]){
      const key=fingerprint(item?.content);
      if(!key||bank.has(key))continue;
      bank.set(key,{
        kind:'bank',id:item.id||null,title:item.title||'Задача в личном банке',
        content:item.content||'',draft:!!item.is_draft
      });
    }
    for(const entry of selected){
      const id='№'+String(entry.number||'?')+' (стр. '+Number(entry.page||0)+')';
      const content=String(entry.content||'').trim(),reason=[];
      const key=entry.visualOnly?'':fingerprint(content);
      const existingMatch=key?bank.get(key):null;
      const localMatch=key?seen.get(key):null;
      const match=existingMatch||localMatch||null;
      if(key&&!seen.has(key))seen.set(key,{
        kind:'batch',id:null,title:'Задача № '+String(entry.number||'?')+
          ' · страница '+Number(entry.page||0),
        content,number:entry.number,page:entry.page
      });
      if(content.length<12&&!entry.capture)reason.push('нет условия');
      if(entry.visualOnly&&!entry.capture)reason.push('нужен снимок со страницы');
      const topic=(topics||[]).find(t=>String(t.id)===String(entry.topicId)
        &&Number(t.grade)===Number(entry.grade));
      if(!topic)reason.push(!entry.topicId?'не выбрана тема':(!entry.grade?'не выбран класс':'тема не соответствует классу'));
      if(reason.length){
        pending.push({entry,id,reason:reason.join(', '),match});
        continue;
      }
      if(match&&!entry.allowDuplicate){
        duplicates.push({entry,id,reason:'точное совпадение условия',match});
        continue;
      }
      ready.push({entry,topic,id,match,duplicateOverride:!!match&&!!entry.allowDuplicate});
    }
    return {selected:selected.length,ready,pending,duplicates};
  };
  API.summary=plan=>{
    const r=plan.ready.length,p=plan.pending.length,d=plan.duplicates.length;
    if(!plan.selected)return 'Выбери задачи для сохранения.';
    const parts=['Готово к сохранению: '+r];
    if(p)parts.push('нужно заполнить класс/тему или добавить снимок: '+p);
    if(d)parts.push('дубликатов: '+d);
    if(p)parts.push('Неготовые задачи останутся в этом окне, остальные можно сохранить сейчас.');
    if(d)parts.push('Открой совпадение в карточке или разреши сохранить отдельную копию.');
    return parts.join(' · ');
  };
  window.MathroomPdfDraftsV94=API;
})();
