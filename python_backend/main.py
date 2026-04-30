"""FastAPI Backend - Saudi CI/PL Generator"""
import os
import sys
import uuid
import shutil
import re
from datetime import datetime
from collections import defaultdict
from pathlib import Path
from typing import List

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import (
    map_cb_to_ean, format_weight, summarize_packages,
    load_ean_map, load_hs_code_map,
    SHIPPER_NAME, ORIGIN, OUTPUT_DIR, DATA_DIR
)
from parsers import parse_pi_excel, parse_pi_pdf, parse_ar_excel
from builder import build_invoice, build_packing_list
from hk_parsers import parse_hk_pi_pdf, parse_hk_ci_pdf, parse_hk_pl_pdf, build_ean_map_from_factory, map_pi_eans_to_formal
import shutil
import uuid
import os

app = FastAPI(title="Saudi CI/PL Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# Serve frontend static files (dist folder)
# Backend serves both API and frontend - one process!
# ============================================
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist')
if os.path.exists(FRONTEND_DIR):
    from fastapi.responses import HTMLResponse
    from pathlib import Path

    # Serve index.html for root and all SPA routes
    @app.get('/', response_class=HTMLResponse)
    async def serve_index():
        return Path(os.path.join(FRONTEND_DIR, 'index.html')).read_text()

    @app.get('/hongkong', response_class=HTMLResponse)
    async def serve_hongkong():
        return Path(os.path.join(FRONTEND_DIR, 'index.html')).read_text()

    @app.get('/saudi', response_class=HTMLResponse)
    async def serve_saudi():
        return Path(os.path.join(FRONTEND_DIR, 'index.html')).read_text()

    @app.get('/dubai', response_class=HTMLResponse)
    async def serve_dubai():
        return Path(os.path.join(FRONTEND_DIR, 'index.html')).read_text()

    # Mount assets and other static files (must be after specific routes)
    app.mount('/assets', StaticFiles(directory=os.path.join(FRONTEND_DIR, 'assets')), name='assets')
    print(f"[INFO] Frontend served from {FRONTEND_DIR}")
else:
    print(f"[WARN] Frontend dist not found at {FRONTEND_DIR}")

os.makedirs(OUTPUT_DIR, exist_ok=True)

ean_map = load_ean_map()
hs_map = load_hs_code_map()
sessions = {}


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "hong-kong-cipl-parser"}

@app.post("/api/parse")
async def parse_files(
    pi_file: UploadFile = File(...),
    ar_file: UploadFile = File(...)
):
    """上传PI和AR文件，返回解析结果"""
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(OUTPUT_DIR, session_id)
    os.makedirs(session_dir, exist_ok=True)

    # Save uploaded files
    pi_ext = os.path.splitext(pi_file.filename)[1].lower()
    pi_path = os.path.join(session_dir, f"pi{pi_ext}")
    ar_path = os.path.join(session_dir, f"ar.xlsx")

    with open(pi_path, "wb") as f:
        shutil.copyfileobj(pi_file.file, f)
    with open(ar_path, "wb") as f:
        shutil.copyfileobj(ar_file.file, f)

    # Parse PI
    if pi_ext == '.pdf':
        pi_data = parse_pi_pdf(pi_path)
    else:
        pi_data = parse_pi_excel(pi_path)

    # Parse AR
    ar_data = parse_ar_excel(ar_path)

    # CB to EAN mapping
    for prod in pi_data['products']:
        ean = prod.get('ean', '')
        if ean.startswith('CB.'):
            mapped = map_cb_to_ean(ean, prod.get('description', ''), ean_map)
            prod['ean'] = mapped

    pi_data['products'] = [p for p in pi_data['products'] if not p.get('ean', '').startswith('CB.')]

    # AR reverse fix
    ar_eans = set(it.get('item_code', '') for it in ar_data.get('items', []))
    for prod in pi_data['products']:
        ean = prod.get('ean', '')
        if ean and ean not in ar_eans:
            desc_pi = prod.get('description', '').lower()
            for ean_ar in ar_eans:
                desc_ar = ean_map.get(ean_ar, '').lower()
                import re
                pi_core = re.sub(r'\s*(with|w/)\s+.*$', '', desc_pi, flags=re.IGNORECASE)
                pi_core = re.sub(r'\s*\(.*?\)$', '', pi_core).strip()
                ar_core = re.sub(r'\s*\(.*?\)$', '', desc_ar).strip()
                if pi_core and ar_core and (pi_core in ar_core or ar_core in pi_core):
                    prod['ean'] = ean_ar
                    break

    # Store session
    sessions[session_id] = {
        'pi_data': pi_data,
        'ar_data': ar_data,
        'pi_path': pi_path,
        'ar_path': ar_path
    }

    return {
        'session_id': session_id,
        'pi_number': pi_data.get('pi_number'),
        'pi_date': pi_data.get('pi_date'),
        'bill_to_name': pi_data.get('bill_to_name'),
        'final_destination': pi_data.get('final_destination'),
        'order_number': ar_data.get('order_number'),
        'consignee': ar_data.get('consignee'),
        'package_summary': summarize_packages(ar_data.get('items', [])),
        'products': pi_data.get('products', []),
        'ar_items': ar_data.get('items', [])
    }


@app.post("/api/generate")
async def generate_excel(
    session_id: str = Form(...),
    selected_eans: str = Form(...)
):
    """根据选择的产品生成Invoice和Packing List"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]
    pi_data = session['pi_data']
    ar_data = session['ar_data']

    selected_ean_list = [e.strip() for e in selected_eans.split(',') if e.strip()]

    # Build invoice products (grouped by EAN)
    filtered_ar_items = []
    selected_products = []
    for ean in selected_ean_list:
        pi_prod = next((p for p in pi_data['products'] if p['ean'] == ean), None)
        if not pi_prod:
            continue
        selected_products.append(pi_prod)
        matching = [it for it in ar_data['items'] if it.get('item_code') == ean]
        current_qty = 0
        target_qty = pi_prod.get('qty', 0)
        for item in matching:
            if current_qty >= target_qty:
                break
            item_qty = int(item.get('qty', 1))
            remaining = target_qty - current_qty
            if item_qty > remaining:
                new_item = dict(item)
                new_item['qty'] = remaining
                filtered_ar_items.append(new_item)
                current_qty = target_qty
            else:
                filtered_ar_items.append(item)
                current_qty += item_qty

    # Invoice products
    ean_groups = defaultdict(list)
    for item in filtered_ar_items:
        ean = item.get('item_code', '')
        if ean:
            ean_groups[ean].append(item)

    invoice_products = []
    for ean, items in ean_groups.items():
        total_qty = sum(int(i.get('qty', 1)) for i in items)
        pi_prod = next((p for p in pi_data['products'] if p['ean'] == ean), {})
        rate = pi_prod.get('rate', 0)
        desc = items[0].get('description', '') or pi_prod.get('description', '') or ean_map.get(ean, '')
        invoice_products.append({
            'ean': ean,
            'description': desc,
            'qty': total_qty,
            'rate': rate,
            'amount': total_qty * rate
        })

    # PL items
    pl_items = []
    for item in filtered_ar_items:
        ean = item.get('item_code', '')
        pi_prod = next((p for p in pi_data['products'] if p['ean'] == ean), {})
        desc = item.get('description', '') or pi_prod.get('description', '') or ean_map.get(ean, '')
        pl_items.append({
            'ean': ean,
            'description': desc,
            'qty': int(item.get('qty', 1)),
            'weight': item.get('weight', ''),
            'dimension': item.get('dimension', ''),
            'pkgs': item.get('pkgs', ''),
            'hs_code': hs_map.get(ean, ''),
            'pi_number': pi_data.get('pi_number', '')
        })

    package_summary = summarize_packages(filtered_ar_items)

    # Generate Excel
    wb = build_invoice(pi_data, ar_data, invoice_products, package_summary)
    wb2 = build_packing_list(pi_data, ar_data, pl_items)

    output_path = os.path.join(OUTPUT_DIR, f"CI_PL_{session_id}.xlsx")
    wb.save(output_path)

    return {
        'download_url': f'/api/download/{session_id}',
        'filename': f"CI PL - {ar_data.get('order_number', 'output')}.xlsx"
    }


@app.get("/api/download/{session_id}")
async def download_file(session_id: str):
    """下载生成的Excel文件"""
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = sessions[session_id]
    ar_data = session['ar_data']
    output_path = os.path.join(OUTPUT_DIR, f"CI_PL_{session_id}.xlsx")

    if not os.path.exists(output_path):
        raise HTTPException(status_code=404, detail="File not found")

    filename = f"CI PL - {ar_data.get('order_number', 'output')}.xlsx"
    return FileResponse(
        output_path,
        filename=filename,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )


# ============================================
# Hong Kong CI/PL Generator API
# ============================================

def get_file_prefix(filename: str) -> str:
    """Extract order prefix from filename for CI/PL pairing"""
    name = os.path.splitext(filename)[0]
    # Remove known suffixes
    name = re.sub(r'-CustomsClearanceCI$', '', name, flags=re.I)
    name = re.sub(r'-CustomsClearancepackinglist.*$', '', name, flags=re.I)
    name = re.sub(r'-packinglist.*$', '', name, flags=re.I)
    name = re.sub(r'-invoice.*$', '', name, flags=re.I)
    name = re.sub(r'-pl.*$', '', name, flags=re.I)
    name = re.sub(r'-packing.*$', '', name, flags=re.I)
    return name


@app.post("/api/hk/parse")
async def hk_parse_files(
    pi_file: UploadFile = File(...),
    factory_files: List[UploadFile] = File(...)
):
    """上传PI和多组工厂CI/PL PDF，返回解析结果"""
    
    # Save uploaded files
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(OUTPUT_DIR, f"hk_{session_id}")
    os.makedirs(session_dir, exist_ok=True)
    
    pi_path = os.path.join(session_dir, f"pi_{pi_file.filename}")
    with open(pi_path, "wb") as f:
        shutil.copyfileobj(pi_file.file, f)
    
    factory_paths = []
    for ff in factory_files:
        fp = os.path.join(session_dir, ff.filename)
        with open(fp, "wb") as f:
            shutil.copyfileobj(ff.file, f)
        factory_paths.append(fp)
    
    # Classify CI vs PL by filename
    ci_files = []
    pl_files = []
    for fp in factory_paths:
        lower = os.path.basename(fp).lower()
        if 'packing' in lower or 'packlist' in lower or 'pl' in lower:
            pl_files.append(fp)
        else:
            ci_files.append(fp)
    
    # Parse PI
    pi_data = parse_hk_pi_pdf(pi_path)
    
    # Parse all CI files
    parsed_cis = []
    for fp in ci_files:
        try:
            ci = parse_hk_ci_pdf(fp)
            prefix = get_file_prefix(os.path.basename(fp))
            parsed_cis.append({"file": os.path.basename(fp), "prefix": prefix, "data": ci})
        except Exception as e:
            print(f"CI parse error {fp}: {e}")
    
    # Parse all PL files
    parsed_pls = []
    for fp in pl_files:
        try:
            pl = parse_hk_pl_pdf(fp)
            prefix = get_file_prefix(os.path.basename(fp))
            parsed_pls.append({"file": os.path.basename(fp), "prefix": prefix, "data": pl})
        except Exception as e:
            print(f"PL parse error {fp}: {e}")
    
    # Pair by prefix, then ASN
    groups = []
    used_pls = set()
    
    for ci in parsed_cis:
        # Match by prefix
        matched = next((p for p in parsed_pls if p["prefix"] == ci["prefix"] and p["file"] not in used_pls), None)
        # Fallback: ASN match
        if not matched and ci["data"]["asn"]:
            matched = next((p for p in parsed_pls if p["data"]["asn"] == ci["data"]["asn"] and p["file"] not in used_pls), None)
        # Fallback: any unused
        if not matched:
            matched = next((p for p in parsed_pls if p["file"] not in used_pls), None)
        
        if matched:
            used_pls.add(matched["file"])
            asn = ci["data"]["asn"] or matched["data"]["asn"] or ci["prefix"]
            groups.append({
                "asn": asn,
                "ci": ci["data"],
                "pl": matched["data"]
            })
    
    # Map PI EANs using factory items
    all_factory_items = []
    for g in groups:
        all_factory_items.extend(g["ci"]["items"])
    
    ean_map = build_ean_map_from_factory(
        [{"ean": it["ean"], "description": it["description"]} for it in all_factory_items]
    )
    pi_data["products"] = map_pi_eans_to_formal(pi_data["products"], ean_map)
    
    return {
        "session_id": session_id,
        "pi": pi_data,
        "groups": groups,
        "ci_files_parsed": len([c for c in parsed_cis if c["data"]["items"]]),
        "pl_files_parsed": len([p for p in parsed_pls if p["data"]["items"]])
    }


@app.post("/api/hk/generate")
async def hk_generate_excel(
    session_id: str = Form(...),
    selected_eans: str = Form(...)
):
    """Generate Hong Kong CI/PL Excel (placeholder - TODO implement builder)"""
    raise HTTPException(status_code=501, detail="Excel generation not yet implemented")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
