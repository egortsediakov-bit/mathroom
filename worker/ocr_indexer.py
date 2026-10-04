#!/usr/bin/env python3
"""Mathroom v29.6 OCR + Task Bank indexer.

Processes one source from Supabase Storage by source_id.
- Uses embedded PDF text when present.
- OCRs scan pages with Tesseract rus+eng.
- Caches every extracted page in task_bank_ocr_pages.
- Splits numbered exercises and upserts them into task_bank_items.
- Reuses task_bank_topic_pages when they already exist.

Environment:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
System packages:
  tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng
"""
from __future__ import annotations
import argparse, hashlib, io, os, re, sys, tempfile, time
from pathlib import Path
from typing import Any
import fitz
from PIL import Image
import pytesseract
from supabase import create_client

PREFIX = r"(?:[●○•◆■□◦*]\s*)?(?:[ПпОо]\s*)?"
RE_DECIMAL = re.compile(rf"^\s*{PREFIX}(?:№\s*)?((?:\d{{1,2}}\.)\d{{1,4}})[.)]?\s+(.{{3,}})$")
RE_SIMPLE = re.compile(rf"^\s*{PREFIX}(?:№\s*)?(\d{{1,4}})[.)]\s+(.{{3,}})$")
RE_SPACE = re.compile(rf"^\s*{PREFIX}(?:№\s*)?(\d{{1,4}})\s+(.{{8,}})$")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\u00ad", "").replace("\ufeff", " ")).strip()


def digest(s: str) -> str:
    return hashlib.sha256(norm(s).lower().encode("utf-8")).hexdigest()


def marker_rows(lines: list[str]):
    strong=[]
    for i,line in enumerate(lines):
        m=RE_DECIMAL.match(line) or RE_SIMPLE.match(line)
        if m: strong.append((i,m.group(1),m.group(2),True))
    if len(strong)>=2: return strong
    weak=[]
    for i,line in enumerate(lines):
        m=RE_SPACE.match(line)
        if m: weak.append((i,m.group(1),m.group(2),False))
    best=seq=0; prev=None
    for _,no,_,_ in weak:
        try: n=int(no.split('.')[-1])
        except ValueError: continue
        seq=seq+1 if prev is not None and n>prev and n-prev<=10 else 1
        prev=n; best=max(best,seq)
    return weak if best>=3 else strong


def split_tasks(lines: list[str]):
    ms=marker_rows(lines); out=[]
    for k,(idx,no,head,strong) in enumerate(ms):
        end=ms[k+1][0] if k+1<len(ms) else len(lines)
        body=norm(" ".join([head]+lines[idx+1:end]))
        if len(body)>=12:
            out.append({"exercise_no":no,"body_text":body,"confidence":0.92 if strong else 0.76})
    return out


def topic_for(page: int, topic_map: list[dict[str,Any]]):
    c=[x for x in topic_map if int(x.get("page_from",x.get("page",0)))<=page<=int(x.get("page_to",x.get("page",0)))]
    c.sort(key=lambda x:(bool(x.get("verified")),float(x.get("confidence",0))),reverse=True)
    return c[0] if c else None


def page_text_layer(page: fitz.Page) -> str:
    return "\n".join(x.strip() for x in page.get_text("text",sort=True).splitlines() if x.strip())


def page_ocr(page: fitz.Page, dpi: int, lang: str) -> tuple[str,float]:
    pix=page.get_pixmap(dpi=dpi,colorspace=fitz.csGRAY,alpha=False)
    img=Image.open(io.BytesIO(pix.tobytes("png")))
    data=pytesseract.image_to_data(img,lang=lang,config="--psm 6",output_type=pytesseract.Output.DICT)
    words=[]; conf=[]
    for text,c in zip(data.get("text",[]),data.get("conf",[])):
        text=(text or "").strip()
        try: cv=float(c)
        except (TypeError,ValueError): cv=-1
        if text:
            words.append(text)
            if cv>=0: conf.append(cv)
    # OCR line structure from image_to_string is better for task markers.
    raw=pytesseract.image_to_string(img,lang=lang,config="--psm 6")
    confidence=(sum(conf)/len(conf)/100.0) if conf else 0.55
    return raw, max(0.0,min(1.0,confidence))


def get_client():
    url=os.getenv("SUPABASE_URL"); key=os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key: raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url,key)


def fetch_source(sb,source_id: str):
    rows=sb.table("task_bank_sources").select("*").eq("id",source_id).limit(1).execute().data or []
    if not rows: raise RuntimeError(f"source {source_id} not found")
    return rows[0]


def download_source(sb,src,tempdir: Path) -> Path:
    if src.get("storage_bucket") and src.get("storage_path"):
        blob=sb.storage.from_(src["storage_bucket"]).download(src["storage_path"])
        out=tempdir/(src.get("filename") or "book.pdf")
        out.write_bytes(blob); return out
    raise RuntimeError("Source has no storage_bucket/storage_path. Upload it to Mathroom Storage first.")


def load_topic_map(sb,source_id: str):
    return sb.table("task_bank_topic_pages").select("*").eq("source_id",source_id).order("page_from").execute().data or []


def cache_page(sb,source_id,page_no,status,method,text,confidence,error=None,meta=None):
    row={"source_id":source_id,"page_no":page_no,"status":status,"extraction_method":method,
         "body_text":text or None,"body_hash":digest(text) if text else None,"confidence":confidence,
         "error_text":error,"meta":meta or {}}
    sb.table("task_bank_ocr_pages").upsert(row,on_conflict="source_id,page_no").execute()


def upsert_tasks(sb,src,page_no,tasks,topic,method):
    rows=[]
    single_grade=src.get("grade_from") if src.get("grade_from")==src.get("grade_to") else None
    for t in tasks:
        topic_conf=float((topic or {}).get("confidence",1 if topic else .35))
        confidence=max(0,min(1,t["confidence"]*.68+topic_conf*.32))
        body=t["body_text"]
        rows.append({
          "source_id":src["id"],"source_page":page_no,"exercise_no":t["exercise_no"],
          "grade":(topic or {}).get("grade") or single_grade,
          "topic_key":(topic or {}).get("topic_key"),"topic_title":(topic or {}).get("topic_title"),
          "body_text":body,"body_hash":digest(f"{src['id']}|{page_no}|{t['exercise_no']}|{body}"),
          "confidence":confidence,"verified":bool((topic or {}).get("verified")) and confidence>=.9,
          "status":"active" if confidence>=.70 else "review",
          "meta":{"parser":"vps-v29.6","extraction_method":method}
        })
    if rows:
        res=sb.table("task_bank_items").upsert(rows,on_conflict="source_id,source_page,exercise_no,body_hash",ignore_duplicates=True).execute()
        return len(res.data or [])
    return 0


def process_source(source_id: str,dpi=190,lang="rus+eng",force_ocr=False):
    sb=get_client(); src=fetch_source(sb,source_id)
    sb.table("task_bank_sources").update({"ocr_status":"processing","ocr_error":None,"ocr_pages_done":0}).eq("id",source_id).execute()
    topic_map=load_topic_map(sb,source_id)
    found=added=ocr_pages=text_pages=errors=0
    with tempfile.TemporaryDirectory(prefix="mathroom-ocr-") as td:
        pdf_path=download_source(sb,src,Path(td))
        doc=fitz.open(pdf_path)
        sb.table("task_bank_sources").update({"page_count":doc.page_count,"ocr_pages_total":doc.page_count}).eq("id",source_id).execute()
        for pno in range(1,doc.page_count+1):
            page=doc[pno-1]
            try:
                embedded=page_text_layer(page)
                use_ocr=force_ocr or len(norm(embedded))<80
                if use_ocr:
                    raw,ocr_conf=page_ocr(page,dpi,lang); method="ocr"; ocr_pages+=1
                    text=raw
                else:
                    text=embedded; ocr_conf=1.0; method="text_layer"; text_pages+=1
                lines=[norm(x) for x in text.splitlines() if norm(x)]
                tasks=split_tasks(lines); found+=len(tasks)
                topic=topic_for(pno,topic_map)
                added+=upsert_tasks(sb,src,pno,tasks,topic,method)
                cache_page(sb,source_id,pno,"done",method,text,ocr_conf,meta={"tasks":len(tasks)})
            except Exception as e:
                errors+=1
                cache_page(sb,source_id,pno,"failed","ocr" if use_ocr else "text_layer",None,None,str(e)[:1000])
            if pno%5==0 or pno==doc.page_count:
                sb.table("task_bank_sources").update({"ocr_pages_done":pno}).eq("id",source_id).execute()
            print(f"{source_id} {pno}/{doc.page_count} tasks={found} added={added}",file=sys.stderr)
    status="done" if errors==0 else ("done" if errors<max(3,int((src.get('page_count') or 1)*.02)) else "failed")
    err=None if status=="done" else f"{errors} page errors"
    layer="text" if ocr_pages==0 else ("scan" if text_pages==0 else "mixed")
    sb.table("task_bank_sources").update({"ocr_status":status,"ocr_error":err,"text_layer_status":layer}).eq("id",source_id).execute()
    return {"source_id":source_id,"found":found,"added":added,"ocr_pages":ocr_pages,"text_pages":text_pages,"errors":errors,"status":status}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source-id",required=True)
    ap.add_argument("--dpi",type=int,default=190)
    ap.add_argument("--lang",default="rus+eng")
    ap.add_argument("--force-ocr",action="store_true")
    a=ap.parse_args()
    print(process_source(a.source_id,a.dpi,a.lang,a.force_ocr))

if __name__=="__main__": main()
