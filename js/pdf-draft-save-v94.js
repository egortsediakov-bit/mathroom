/* Mathroom v94 — safe partial PDF draft-save planner.
 * No writes or AI calls: pure checks for the review screen. */
(()=>{
  'use strict';
  const API={};
  const fingerprint=s=>String(s??'').normalize('NFC').toLocaleLowerCase('ru-RU')
    .replace(/[«»"'’]/g,'').replace(/\s+/g,' ').trim();
  API.plan=(entries=[],topics=[],existing=[])=>{
    const selected=(entries||[]).filter(x=>x?.selected&&!x.imported);
    const ready=[],pending=[],duplicates=[],seen=new Set();
    const existingKeys=new Set((existing||[]).filter(x=>!x?.is_draft&&!x?.visualOnly)
      .map(x=>fingerprint(x.content)).filter(Boolean));
    // Duplicate against teacher drafts too: the user shouldn't create the same
    // exercise repeatedly from a file just because the first one is still draft.
    for(const e of existing||[]){
      if(!e?.content)continue;
      if((e.tags||[]).includes('mathroom-pdf-import-v91')&&e.builder_meta?.pdf_import?.capture)continue;
      existingKeys.add(fingerprint(e.content));
    }
    for(const entry of selected){
      const id='№'+String(entry.number||'?')+' (стр. '+Number(entry.page||0)+')';
      const reason=[];
      const content=String(entry.content||'').trim();
      if(content.length<12&&!entry.capture)reason.push('нет условия');
      if(entry.visualOnly&&!entry.capture)reason.push('нужен снимок со страницы');
      const topic=(topics||[]).find(t=>String(t.id)===String(entry.topicId)
        &&Number(t.grade)===Number(entry.grade));
      if(!topic)reason.push(!entry.topicId?'не выбрана тема':(!entry.grade?'не выбран класс':'тема не соответствует классу'));
      if(reason.length){
        pending.push({entry,id,reason:reason.join(', ')});
        continue;
      }
      const key=entry.visualOnly?'scan:'+entry.page+':'+entry.number:fingerprint(content);
      if(seen.has(key)||(!entry.visualOnly&&existingKeys.has(key))){
        duplicates.push({entry,id,reason:'такая формулировка уже есть в банке или текущем импорте'});
        continue;
      }
      seen.add(key);
      ready.push({entry,topic,id});
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
    if(d)parts.push('Дубликаты будут пропущены.');
    return parts.join(' · ');
  };
  window.MathroomPdfDraftsV94=API;
})();
