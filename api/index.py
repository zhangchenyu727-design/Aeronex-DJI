from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import List
import re
import io

router = APIRouter()

class PIProduct(BaseModel):
    item_no: str
    ean: str
    description: str
    qty: int
    unit: str
    unit_price: float
    amount: float

class PIInfo(BaseModel):
    pi_number: str
    pi_date: str
    from_company: str
    to_company: str
    contact: str
    email: str
    products: List[PIProduct]
    total_qty: int
    total_amount: float

class CIItem(BaseModel):
    item_no: str
    part_no: str
    pi_no: str
    ean: str
    description: str
    hs_code: str
    origin: str
    qty: int
    uom: str
    unit_price: float
    amount: float

class FactoryCI(BaseModel):
    invoice_no: str
    invoice_date: str
    pi_no: str
    sold_to: str
    delivered_to: str
    asn: str
    items: List[CIItem]
    total_qty: int
    total_amount: float

class PLItem(BaseModel):
    case_no: str
    part_no: str
    ean: str
    description: str
    qty: int
    gross_weight: str
    net_weight: str
    size: str
    volume: str
    num_cases: int

class FactoryPL(BaseModel):
    invoice_no: str
    asn: str
    date: str
    pi_no: str
    items: List[PLItem]
    total_cases: int
    total_qty: int
    total_gross_weight: str
    total_net_weight: str
    total_volume: str

class ParseRequest(BaseModel):
    text: str
    doc_type: str  # 'pi', 'ci', 'pl'

@router.post("/parse")
def parse_document(req: ParseRequest):
    text = req.text
    doc_type = req.doc_type

    if doc_type == 'pi':
        return parse_pi_text(text)
    elif doc_type == 'ci':
        return parse_ci_text(text)
    elif doc_type == 'pl':
        return parse_pl_text(text)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown doc_type: {doc_type}")

def parse_pi_text(text: str) -> dict:
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

    products = []
    # Table format: | No | EAN | Desc | Qty | Price | Amount |
    for m in re.finditer(r'\|\s*(\d+)\s*\|\s*(CB\.\d+|\d{13})\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*\$?([\d,.]+)\s*\|\s*\$?([\d,.]+)\s*\|', text):
        products.append({
            "item_no": m.group(1),
            "ean": m.group(2),
            "description": re.sub(r'[\(\（].*?[\)\）]', '', m.group(3)).strip(),
            "qty": int(m.group(4)),
            "unit": "PCS",
            "unit_price": float(m.group(5).replace(',', '')),
            "amount": float(m.group(6).replace(',', ''))
        })

    return {
        "pi_number": pi_number,
        "pi_date": pi_date,
        "from_company": from_company,
        "to_company": to_company,
        "contact": contact,
        "email": email,
        "products": products,
        "total_qty": sum(p["qty"] for p in products),
        "total_amount": sum(p["amount"] for p in products)
    }

def parse_ci_text(text: str) -> dict:
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
        if re.search(r'sold\s*to', line, re.I) and re.search(r'Company', line):
            m = re.search(r'Company\s*[:：]?\s*(.+)', line, re.I)
            if m: sold_to = m.group(1).strip()
        if re.search(r'deliver\s*to', line, re.I) and re.search(r'Company', line):
            m = re.search(r'Company\s*[:：]?\s*(.+)', line, re.I)
            if m: delivered_to = m.group(1).strip()

    if not asn:
        for line in lines:
            m = re.search(r'ASN\.\s*([A-Z0-9]+)', line, re.I)
            if m: asn = m.group(1); break

    items = []
    # Find all 13-digit EANs
    ean_positions = []
    for m in re.finditer(r'[^\d](\d{13})(?!\d)', text):
        ean_positions.append((m.group(1), m.start()))
    for m in re.finditer(r'[a-zA-Z](\d{13})(?!\d)', text):
        ean_positions.append((m.group(1), m.start()))

    seen_eans = set()
    for ean, pos in ean_positions:
        if ean in seen_eans: continue
        seen_eans.add(ean)

        before = text[max(0, pos-500):pos]
        after = text[pos+13:min(len(text), pos+500)]

        part_no = ""
        m = re.search(r'((?:CP|AG|WM)\.[A-Z0-9.]+)', before)
        if m: part_no = m.group(1)

        pi_no_item = ""
        m = re.search(r'(EF\d+[A-Z0-9]+)', before)
        if m: pi_no_item = m.group(1)

        hs_code = ""
        for hm in re.finditer(r'\b(\d{6})\b', after):
            if ean.find(hm.group(1)) < 0:
                hs_code = hm.group(1)
                break

        origin = "China"
        m = re.search(r'\b(China|USA|Japan|Germany|Hong\s*Kong)\b', after, re.I)
        if m: origin = m.group(1)

        qty = 0
        m = re.search(r'(\d+)\s+(PCS|SET)', after, re.I)
        if m: qty = int(m.group(1))

        description = ""
        m = re.search(r'^(.+?)(?=\s+\d{6}\s+China|\s+PCS|\s+SET|\s+USD)', after)
        if m: description = m.group(1).strip()
        if not description:
            m = re.search(r'(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*|DJI\s+(?:Air|Matrice|Mavic)[\w\/\s]*)', after, re.I)
            if m: description = m.group(0).strip()

        unit_price = 0
        amount = 0
        m = re.search(r'(\d+(?:\.\d+)?)\s+USD\s+(\d+(?:\.\d+)?)', after)
        if m:
            p1, p2 = float(m.group(1)), float(m.group(2))
            if abs(p2 - p1 * qty) < max(p2 * 0.2, 200):
                unit_price, amount = p1, p2
            else:
                unit_price, amount = min(p1, p2), max(p1, p2)

        if unit_price == 0:
            nums = [float(n.replace(',', '')) for n in re.findall(r'\b(\d+(?:,\d+)*(?:\.\d+)?)\b', after)]
            nums = [n for n in nums if n > 50]
            if len(nums) >= 2:
                nums.sort()
                unit_price, amount = nums[-2], nums[-1]

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
                "uom": "PCS",
                "unit_price": unit_price,
                "amount": amount
            })

    return {
        "invoice_no": invoice_no,
        "invoice_date": invoice_date,
        "pi_no": pi_no,
        "sold_to": sold_to,
        "delivered_to": delivered_to,
        "asn": asn,
        "items": items,
        "total_qty": sum(it["qty"] for it in items),
        "total_amount": sum(it["amount"] for it in items)
    }

def parse_pl_text(text: str) -> dict:
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

    items = []
    for m in re.finditer(r'([A-Z]+\d+[A-Z]?\d+)-(\d+)(?:~(\d+))?', text):
        case_no = m.group(0)
        start_num = int(m.group(2))
        end_num = int(m.group(3)) if m.group(3) else start_num
        num_cases = end_num - start_num + 1

        if any(it["case_no"] == case_no for it in items):
            continue

        pos = m.start()
        window = text[pos:min(len(text), pos + 1000)]

        ean = ""
        em = re.search(r'(\d{13})', window)
        if em: ean = em.group(1)

        part_no = ""
        pm = re.search(r'((?:CP|AG|WM)\.[A-Z0-9.]+)', window)
        if pm: part_no = pm.group(1)

        description = ""
        if ean:
            dm = re.search(rf'{re.escape(ean)}\s+(.+?)(?=\s+\d+\s+(?:PCS|SET)|\s+Total)', window)
            if dm: description = dm.group(1).strip()
        if not description:
            fm = re.search(r'(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*|DJI\s+Air[\w\/\s]*)', window, re.I)
            if fm: description = fm.group(0).strip()

        qty = 0
        qm = re.search(r'(\d+)\s+(PCS|SET)', window, re.I)
        if qm: qty = int(qm.group(1))

        gw = ""; nw = ""
        gnm = re.search(r'(?:PCS|SET)\s+(\d+\.\d+)\s+(\d+\.\d+)', window)
        if gnm:
            gw, nw = gnm.group(1), gnm.group(2)
        if not gw:
            decimals = [m.group(1) for m in re.finditer(r'(\d+\.\d+)', window)]
            if len(decimals) >= 2:
                gw, nw = decimals[0], decimals[1]

        size = ""
        sm = re.search(r'(\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?)', window)
        if sm: size = sm.group(1)

        volume = ""
        vols = [m.group(1) for m in re.finditer(r'(\d+\.\d{3,})', window)]
        for v in reversed(vols):
            if 0.001 < float(v) < 10:
                volume = v
                break

        if ean and qty > 0:
            items.append({
                "case_no": case_no,
                "part_no": part_no,
                "ean": ean,
                "description": description,
                "qty": qty,
                "gross_weight": gw,
                "net_weight": nw,
                "size": size,
                "volume": volume,
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
        "items": items,
        "total_cases": sum(it["num_cases"] for it in items),
        "total_qty": sum(it["qty"] for it in items),
        "total_gross_weight": f"{total_gw:.2f}",
        "total_net_weight": f"{total_nw:.3f}",
        "total_volume": f"{total_vol:.5f}"
    }
