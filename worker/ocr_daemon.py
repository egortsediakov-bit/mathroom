#!/usr/bin/env python3
"""Small OCR queue daemon for Mathroom v29.6."""
from __future__ import annotations
import argparse, os, time, traceback
from supabase import create_client
from ocr_indexer import process_source


def client():
    url=os.getenv('SUPABASE_URL'); key=os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key: raise SystemExit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    return create_client(url,key)


def next_source(sb):
    rows=(sb.table('task_bank_sources').select('id,title').eq('is_active',True).eq('ocr_status','pending').order('created_at').limit(1).execute().data or [])
    return rows[0] if rows else None


def run_once(sb):
    src=next_source(sb)
    if not src: return False
    try:
        print(f"OCR: {src['title']} ({src['id']})",flush=True)
        print(process_source(src['id']),flush=True)
    except Exception as e:
        traceback.print_exc()
        sb.table('task_bank_sources').update({'ocr_status':'failed','ocr_error':str(e)[:1000]}).eq('id',src['id']).execute()
    return True


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--once',action='store_true'); ap.add_argument('--interval',type=int,default=45); a=ap.parse_args()
    sb=client()
    while True:
        worked=run_once(sb)
        if a.once: break
        if not worked: time.sleep(max(10,a.interval))

if __name__=='__main__': main()
