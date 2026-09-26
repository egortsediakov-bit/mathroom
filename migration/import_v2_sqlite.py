#!/usr/bin/env python3
"""One-time Mathroom v2 SQLite -> Supabase importer.
Uses only Python standard library. Run after schema.sql and after creating the teacher account.

Environment:
  SUPABASE_URL=https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...
  TEACHER_ID=<uuid from Authentication -> Users>
Usage:
  python import_v2_sqlite.py path/to/mathroom.db
"""
import json, os, sqlite3, sys, urllib.request, urllib.parse
from pathlib import Path

DB = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('mathroom.db')
URL = os.environ.get('SUPABASE_URL','').rstrip('/')
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
TEACHER = os.environ.get('TEACHER_ID','')
if not DB.exists() or not URL or not KEY or not TEACHER:
    raise SystemExit('Need existing DB + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + TEACHER_ID')

conn = sqlite3.connect(DB); conn.row_factory = sqlite3.Row

def rows(table):
    try: return [dict(r) for r in conn.execute(f'SELECT * FROM {table}')]
    except sqlite3.OperationalError: return []

def post(table, data, upsert=True):
    if not data: return
    for i in range(0,len(data),200):
        chunk=data[i:i+200]
        q='?on_conflict=id' if upsert and all('id' in x for x in chunk) else ''
        req=urllib.request.Request(f'{URL}/rest/v1/{table}{q}',data=json.dumps(chunk,ensure_ascii=False).encode(),method='POST')
        req.add_header('apikey',KEY); req.add_header('Authorization',f'Bearer {KEY}'); req.add_header('Content-Type','application/json')
        req.add_header('Prefer','resolution=merge-duplicates,return=minimal' if upsert else 'return=minimal')
        try:
            with urllib.request.urlopen(req) as r: r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'{table}: {e.code} {e.read().decode()}')
        print(f'{table}: {min(i+len(chunk),len(data))}/{len(data)}')

def delete_filter(table, query):
    req=urllib.request.Request(f'{URL}/rest/v1/{table}?{query}',method='DELETE')
    req.add_header('apikey',KEY); req.add_header('Authorization',f'Bearer {KEY}'); req.add_header('Prefer','return=minimal')
    with urllib.request.urlopen(req) as r: r.read()

def tags(v):
    if not v:return []
    try:
        x=json.loads(v)
        if isinstance(x,list): return [str(z).strip() for z in x if str(z).strip()]
    except Exception: pass
    return [x.strip() for x in str(v).replace(';',',').split(',') if x.strip()]

students=[]
for r in rows('students'):
    students.append({'id':r['id'],'teacher_id':TEACHER,'name':r['name'],'grade':r['grade'],'notes':r.get('notes',''),'access_token':r['access_token'],'created_at':r['created_at']})
post('students',students)

topics=[]
for r in rows('topics'):
    topics.append({'id':r['id'],'teacher_id':TEACHER,'grade':r['grade'],'section':r['section'],'title':r['title'],'theory':r.get('theory',''),'created_at':r['created_at'],'updated_at':r.get('updated_at') or r['created_at']})
post('topics',topics)

exercises=[]
for r in rows('topic_items'):
    exercises.append({'id':r['id'],'teacher_id':TEACHER,'topic_id':r['topic_id'],'kind':r['kind'],'title':r.get('title',''),'content':r['content'],'answer':r.get('answer',''),'difficulty':r.get('difficulty','basic'),'category':r.get('category',''),'tags':tags(r.get('tags','')),'generator_spec':r.get('generator_spec',''),'generator_answer':r.get('generator_answer',''),'favorite':bool(r.get('favorite',0)),'use_count':r.get('usage_count',0) or 0,'last_used_at':r.get('last_used_at'),'created_at':r['created_at'],'updated_at':r.get('updated_at') or r['created_at']})
post('exercises',exercises)

lessons=[]
for r in rows('lessons'):
    lessons.append({'id':r['id'],'teacher_id':TEACHER,'student_id':r['student_id'],'topic_id':r['topic_id'],'scheduled_at':r.get('scheduled_at'),'duration_minutes':r.get('duration_minutes',60) or 60,'status':r.get('status','assigned'),'public_summary':r.get('public_summary',''),'homework_plan':r.get('homework_plan',''),'private_notes':r.get('private_notes',''),'started_at':r.get('started_at'),'completed_at':r.get('completed_at'),'created_at':r['created_at']})
post('lessons',lessons)

# Replace auto-created first board pages with the real v2 pages.
old_pages=rows('board_pages'); board_rows={r['id']:r for r in rows('boards')}
new_pages=[]
for st in students:
    delete_filter('board_pages', 'student_id=eq.'+urllib.parse.quote(st['id']))
    base=f"student:{st['id']}"
    ps=[p for p in old_pages if p['base_board_id']==base]
    if not ps:
        b=board_rows.get(base,{}); elems=json.loads(b.get('elements_json','[]')) if b else []
        new_pages.append({'teacher_id':TEACHER,'student_id':st['id'],'title':'Лист 1','sort_order':0,'elements':elems})
    else:
        for p in sorted(ps,key=lambda x:(x.get('sort_order',0),x.get('created_at',''))):
            b=board_rows.get(p['storage_board_id'],{}); elems=json.loads(b.get('elements_json','[]')) if b else []
            new_pages.append({'id':p['id'],'teacher_id':TEACHER,'student_id':st['id'],'title':p['title'],'sort_order':p.get('sort_order',0),'elements':elems,'created_at':p.get('created_at')})
post('board_pages',new_pages)

# Homework + answers
hw=[]
for r in rows('homeworks'):
    hw.append({'id':r['id'],'teacher_id':TEACHER,'student_id':r['student_id'],'topic_id':r['topic_id'],'title':r['title'],'status':r['status'],'score':r.get('score'),'comment':r.get('teacher_note',''),'created_at':r.get('assigned_at'),'submitted_at':r.get('submitted_at')})
post('homeworks',hw)
ha={r['item_id']:r for r in rows('homework_answers')}
hwi=[]
for r in rows('homework_items'):
    a=ha.get(r['id'],{})
    hwi.append({'id':r['id'],'homework_id':r['homework_id'],'prompt':r['prompt'],'correct_answer':r.get('correct_answer',''),'student_answer':a.get('answer',''),'is_correct':None if a.get('is_correct') is None else bool(a.get('is_correct')),'position':r.get('sort_order',0)})
post('homework_items',hwi)

# Tests + answers
ts=[]
for r in rows('tests'):
    ts.append({'id':r['id'],'teacher_id':TEACHER,'student_id':r['student_id'],'topic_id':r['topic_id'],'title':r['title'],'status':r['status'],'score':r.get('score'),'created_at':r.get('assigned_at'),'submitted_at':r.get('submitted_at')})
post('tests',ts)
ta={r['question_id']:r for r in rows('test_answers')}
ti=[]
for r in rows('test_questions'):
    a=ta.get(r['id'],{})
    ti.append({'id':r['id'],'test_id':r['test_id'],'prompt':r['prompt'],'correct_answer':r.get('correct_answer',''),'student_answer':a.get('answer',''),'is_correct':None if a.get('is_correct') is None else bool(a.get('is_correct')),'position':r.get('sort_order',0)})
post('test_items',ti)

# Board templates
bt=[]
for r in rows('board_templates'):
    bt.append({'id':r['id'],'teacher_id':TEACHER,'title':r['title'],'elements':json.loads(r.get('elements_json','[]')),'created_at':r['created_at']})
post('board_templates',bt)

# Lesson versions: flatten the old version board tree into JSON pages.
lbv=[]
for r in rows('lesson_board_versions'):
    ps=[]
    for p in sorted([x for x in old_pages if x['base_board_id']==r['base_board_id']],key=lambda x:x.get('sort_order',0)):
        b=board_rows.get(p['storage_board_id'],{})
        ps.append({'title':p['title'],'sort_order':p.get('sort_order',0),'elements':json.loads(b.get('elements_json','[]')) if b else []})
    lbv.append({'id':r['id'],'teacher_id':TEACHER,'lesson_id':r['lesson_id'],'title':r['title'],'note':r.get('note',''),'pages':ps,'created_at':r['created_at']})
post('lesson_board_versions',lbv)
print('\nMigration complete. Keep the old SQLite file as a backup until you verify the cloud data.')
