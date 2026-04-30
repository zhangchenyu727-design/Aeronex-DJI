"""Hong Kong CI/PL PDF Parser - uses pdfplumber character positions for precise column extraction"""
import re
import pdfplumber
from typing import List, Dict, Any, Tuple


# ============================================
# Column-boundary-based table extraction
# ============================================

def extract_table_rows(page, col_boundaries: List[Tuple[float, float]], 
                       y_min: float, y_max: float,
                       filter_fn=None) -> List[List[str]]:
    """Extract table rows using fixed column boundaries"""
    chars = page.chars
    from collections import defaultdict
    rows = defaultdict(list)
    for c in chars:
        y = c['top']
        if y_min <= y <= y_max:
            rows[round(y, 0)].append(c)
    
    result = []
    for y in sorted(rows.keys()):
        row_chars = sorted(rows[y], key=lambda c: c['x0'])
        if len(row_chars) < 5:
            continue
        
        cols = []
        for start, end in col_boundaries:
            col_chars = [c['text'] for c in row_chars if start <= c['x0'] < end]
            cols.append(''.join(col_chars).strip())
        
        # Skip empty rows and header rows
        if any(cols) and (not filter_fn or filter_fn(cols)):
            result.append(cols)
    
    return result


def has_ean(cols):
    return any(re.search(r'\d{13}|CB\.\d+', c) for c in cols)


# ============================================
# PI Parser
# ============================================

def parse_hk_pi_pdf(pdf_path: str) -> Dict[str, Any]:
    """Parse Hong Kong PI PDF"""
    
    # Extract header info from text
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text += t + "\n"
    
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    from_company = lines[0] if lines else ""
    pi_number = ""
    pi_date = ""
    to_company = ""
    contact = ""
    email = ""
    
    for i, line in enumerate(lines):
        if not pi_number:
            m = re.search(r'INVOICE\s*#?\s*([A-Z0-9\-]+)', line, re.I)
            if m: pi_number = m.group(1)
        if not pi_number:
            m = re.search(r'PI\s*#?\s*([A-Z0-9\-]+)', line, re.I)
            if m: pi_number = m.group(1)
        if not pi_date:
            m = re.search(r'(\d{2}[\/\.]\d{2}[\/\.]\d{4})', line)
            if m: pi_date = m.group(1)
        if re.search(r'customer\s*name', line, re.I):
            m = re.search(r'Customer\s*Name\s*[:：]?\s*(.+)', line, re.I)
            if m and m.group(1).strip():
                to_company = m.group(1).strip()
            elif i + 1 < len(lines):
                to_company = lines[i + 1].strip()
        if re.search(r'contact', line, re.I):
            m = re.search(r'Contact\s*[:：]?\s*(.+)', line, re.I)
            if m: contact = m.group(1).strip()
        m = re.search(r'[\w.-]+@[\w.-]+\.\w+', line)
        if m: email = m.group(0)
    
    # Extract product table using column boundaries
    products = []
    # PI column boundaries (based on character coordinate analysis)
    pi_cols = [
        (30, 55),     # Item No
        (80, 160),    # EAN
        (160, 370),   # Description
        (370, 410),   # Qty
        (415, 465),   # Rate
        (485, 540),   # Amount
    ]
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            rows = extract_table_rows(page, pi_cols, 280, 400, has_ean)
            for cols in rows:
                if len(cols) < 6:
                    continue
                item_no = cols[0]
                ean = cols[1]
                description = cols[2]
                qty_str = cols[3]
                rate_str = cols[4]
                amount_str = cols[5]
                
                # Validate EAN
                if not re.match(r'^\d{13}|CB\.\d+$', ean):
                    continue
                
                # Clean description
                description = re.sub(r'[\(\（].*?[\)\）]', '', description).strip()
                
                # Parse numbers
                qty = 0
                m = re.search(r'(\d+)', qty_str)
                if m: qty = int(m.group(1))
                
                unit_price = 0.0
                m = re.search(r'([\d,]+\.\d{2})', rate_str)
                if m: unit_price = float(m.group(1).replace(',', ''))
                
                amount = 0.0
                m = re.search(r'([\d,]+\.\d{2})', amount_str)
                if m: amount = float(m.group(1).replace(',', ''))
                
                if ean and qty > 0:
                    products.append({
                        "item_no": item_no or str(len(products) + 1),
                        "ean": ean,
                        "description": description,
                        "qty": qty,
                        "unit": "PCS",
                        "unit_price": unit_price,
                        "amount": amount or unit_price * qty
                    })
    
    return {
        "pi_number": pi_number,
        "pi_date": pi_date,
        "from_company": from_company,
        "to_company": to_company,
        "to_address": "",
        "contact": contact,
        "email": email,
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "total_amount": sum(p["amount"] for p in products)
    }


# ============================================
# Factory CI Parser
# ============================================

def parse_hk_ci_pdf(pdf_path: str) -> Dict[str, Any]:
    """Parse Hong Kong Factory CI PDF"""
    
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text += t + "\n"
    
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    invoice_no = ""
    invoice_date = ""
    pi_no = ""
    sold_to = ""
    delivered_to = ""
    asn = ""
    
    for line in lines:
        if re.search(r'invoice\s*no', line, re.I):
            m = re.search(r'Invoice\s*No\.?\s*[:：]?\s*(\S+)', line, re.I)
            if m: invoice_no = m.group(1)
        if not invoice_date and re.search(r'date', line, re.I):
            m = re.search(r'(\d{4}-\d{2}-\d{2})', line)
            if m: invoice_date = m.group(1)
        if re.search(r'pi\s*no', line, re.I):
            m = re.search(r'PI\s*No\.?\s*[:：]?\s*(\S+)', line, re.I)
            if m: pi_no = m.group(1)
        if 'ASN' in line:
            m = re.search(r'ASN\.?\s*[:：]?\s*([A-Z0-9]+)', line, re.I)
            if m: asn = m.group(1)
        if re.search(r'sold\s*to', line, re.I):
            m = re.search(r'Company\s*[:：]?\s*(.+)', line, re.I)
            if m: sold_to = m.group(1).strip()
        if re.search(r'deliver\s*to', line, re.I):
            m = re.search(r'Company\s*[:：]?\s*(.+)', line, re.I)
            if m: delivered_to = m.group(1).strip()
    
    if not asn:
        for line in lines:
            m = re.search(r'ASN\.\s*([A-Z0-9]+)', line, re.I)
            if m: asn = m.group(1); break
    
    # CI column boundaries
    ci_cols = [
        (15, 35),     # Item No
        (75, 145),    # Part No
        (145, 205),   # PI No
        (265, 335),   # EAN
        (335, 420),   # Description
        (420, 455),   # HS Code
        (455, 490),   # Country
        (540, 565),   # Qty
        (580, 605),   # UOM
        (630, 660),   # Unit Price
        (685, 715),   # Currency
        (760, 790),   # Amount
    ]
    
    items = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            rows = extract_table_rows(page, ci_cols, 200, 300, has_ean)
            for cols in rows:
                if len(cols) < 8:
                    continue
                
                part_no = cols[1]
                pi_no_item = cols[2]
                ean = cols[3]
                description = cols[4]
                hs_code = cols[5]
                origin = cols[6] or "China"
                qty_str = cols[7]
                uom = cols[8] or "PCS"
                price_str = cols[9]
                currency = cols[10] or "USD"
                amount_str = cols[11]
                
                # Validate EAN
                if not re.match(r'^\d{13}$', ean):
                    continue
                
                # Clean PI No - extract EF... part
                m = re.search(r'(EF\d+)', pi_no_item)
                if m: pi_no_item = m.group(1)
                
                qty = 0
                m = re.search(r'(\d+)', qty_str)
                if m: qty = int(m.group(1))
                
                unit_price = 0.0
                m = re.search(r'([\d,]+(?:\.\d{2})?)', price_str)
                if m: unit_price = float(m.group(1).replace(',', ''))
                
                amount = 0.0
                m = re.search(r'([\d,]+(?:\.\d{2})?)', amount_str)
                if m: amount = float(m.group(1).replace(',', ''))
                
                if ean and qty > 0:
                    items.append({
                        "item_no": str(len(items) + 1),
                        "part_no": part_no,
                        "pi_no": pi_no_item,
                        "ean": ean,
                        "description": description,
                        "hs_code": hs_code,
                        "origin": origin,
                        "qty": qty,
                        "uom": uom,
                        "unit_price": unit_price,
                        "currency": currency,
                        "amount": amount or unit_price * qty
                    })
    
    return {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date,
        "pi_no": pi_no,
        "sold_to": sold_to,
        "sold_to_address": "",
        "delivered_to": delivered_to,
        "delivered_to_address": "",
        "asn": asn,
        "items": items,
        "total_qty": sum(it["qty"] for it in items),
        "total_amount": sum(it["amount"] for it in items)
    }


# ============================================
# Factory PL Parser
# ============================================

def parse_hk_pl_pdf(pdf_path: str) -> Dict[str, Any]:
    """Parse Hong Kong Factory PL PDF"""
    
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text() or ""
            text += t + "\n"
    
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    invoice_no = ""
    date = ""
    pi_no = ""
    asn = ""
    
    for line in lines:
        if re.search(r'invoice\s*no', line, re.I):
            m = re.search(r'Invoice\s*No\.?\s*[:：]?\s*(\S+)', line, re.I)
            if m: invoice_no = m.group(1)
        if not date and re.search(r'date', line, re.I):
            m = re.search(r'(\d{4}-\d{2}-\d{2})', line)
            if m: date = m.group(1)
        if re.search(r'pi\s*no', line, re.I):
            m = re.search(r'PI\s*No\.?\s*[:：]?\s*(\S+)', line, re.I)
            if m: pi_no = m.group(1)
        if 'ASN' in line:
            m = re.search(r'ASN\.?\s*[:：]?\s*([A-Z0-9]+)', line, re.I)
            if m: asn = m.group(1)
    
    if not asn:
        for line in lines:
            m = re.search(r'ASN\.\s*([A-Z0-9]+)', line, re.I)
            if m: asn = m.group(1); break
    
    # PL column boundaries
    pl_cols = [
        (15, 35),     # Item No
        (75, 150),    # Case No
        (150, 185),   # Material
        (185, 260),   # Part No
        (260, 335),   # EAN
        (335, 480),   # Description
        (480, 500),   # Qty
        (500, 560),   # UOM
        (560, 600),   # GW
        (600, 645),   # NW
        (645, 705),   # Size
        (705, 750),   # Volume
    ]
    
    items = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            rows = extract_table_rows(page, pl_cols, 170, 260, has_ean)
            for cols in rows:
                if len(cols) < 8:
                    continue
                
                case_no = cols[1]
                material = cols[2] or "Carton"
                part_no = cols[3]
                ean = cols[4]
                description = cols[5]
                qty_str = cols[6]
                uom = cols[7] or "PCS"
                gw = cols[8]
                nw = cols[9]
                size = cols[10]
                volume = cols[11]
                
                # Validate EAN or Case No
                if not ean and not case_no:
                    continue
                
                qty = 0
                m = re.search(r'(\d+)', qty_str)
                if m: qty = int(m.group(1))
                
                # Calculate num_cases from case_no
                num_cases = 1
                m = re.search(r'-([\d~]+)$', case_no)
                if m:
                    range_str = m.group(1)
                    if '~' in range_str:
                        parts = range_str.split('~')
                        num_cases = int(parts[1]) - int(parts[0]) + 1
                    else:
                        num_cases = 1
                
                items.append({
                    "case_no": case_no,
                    "material": material,
                    "part_no": part_no,
                    "ean": ean,
                    "description": description or "-",
                    "qty": qty or 1,
                    "uom": uom,
                    "gross_weight": gw,
                    "net_weight": nw,
                    "size": size,
                    "volume": volume,
                    "shipping_marks": "",
                    "num_cases": num_cases
                })
    
    total_gw = sum(float(it["gross_weight"] or 0) for it in items)
    total_nw = sum(float(it["net_weight"] or 0) for it in items)
    total_vol = sum(float(it["volume"] or 0) for it in items)
    
    return {
        "invoice_no": invoice_no,
        "asn": asn,
        "date": date,
        "pi_no": pi_no,
        "sold_to": "",
        "delivered_to": "",
        "items": items,
        "total_cases": sum(it["num_cases"] for it in items),
        "total_qty": sum(it["qty"] for it in items),
        "total_gross_weight": f"{total_gw:.2f}",
        "total_net_weight": f"{total_nw:.3f}",
        "total_volume": f"{total_vol:.5f}"
    }


# ============================================
# EAN Mapping
# ============================================

def build_ean_map_from_factory(factory_items: List[Dict[str, str]]) -> Dict[str, str]:
    ean_map = {}
    for item in factory_items:
        desc = item.get("description", "").lower()
        ean = item.get("ean", "")
        if not desc or not ean:
            continue
        normalized = re.sub(r'[\s\-/]', '', desc).replace("dji", "").replace("general", "")
        ean_map[normalized] = ean
    return ean_map


def map_pi_eans_to_formal(pi_products: List[Dict[str, Any]], ean_map: Dict[str, str]) -> List[Dict[str, Any]]:
    result = []
    for prod in pi_products:
        ean = prod.get("ean", "")
        if not ean.startswith("CB."):
            result.append(prod)
            continue
        
        desc = prod.get("description", "").lower()
        normalized = re.sub(r'[\s\-/]', '', desc).replace("dji", "").replace("general", "")
        
        formal_ean = ean_map.get(normalized, "")
        if not formal_ean:
            for key, val in ean_map.items():
                pi_words = desc.split()
                key_words = key.split()
                common = [w for w in pi_words if w in key_words and len(w) > 3]
                if len(common) >= 2:
                    formal_ean = val
                    break
        
        prod_copy = dict(prod)
        prod_copy["ean"] = formal_ean or ean
        result.append(prod_copy)
    return result
