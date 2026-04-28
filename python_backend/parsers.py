"""PI和AR文件解析"""
import re
import pandas as pd
import PyPDF2


def parse_pi_excel(pi_path):
    df = pd.read_excel(pi_path, header=None)
    pi_number = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if isinstance(val, str) and 'INVOICE' in val:
                for k in range(j+1, len(row)):
                    if pd.notna(row[k]):
                        v = str(row[k]).strip()
                        m = re.search(r'(PI\d+)', v)
                        if m:
                            pi_number = m.group(1)
                            break
                if not pi_number:
                    m = re.search(r'(PI\d+)', val)
                    if m:
                        pi_number = m.group(1)
    pi_date = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if isinstance(val, str) and 'DATE' in val:
                for k in range(j+1, len(row)):
                    if pd.notna(row[k]):
                        v = str(row[k]).strip()
                        m = re.search(r'(\d{4}/\d{1,2}/\d{1,2})', v)
                        if m:
                            pi_date = m.group(1)
                            break
    bill_to_name = None
    bill_to_address = []
    contact_name = None
    email = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if not isinstance(val, str):
                continue
            if 'Customer Name' in val:
                for k in range(j+1, len(row)):
                    if pd.notna(row[k]) and str(row[k]).strip():
                        bill_to_name = str(row[k]).strip()
                        break
            elif val.startswith('Address:') or val.startswith('Address\uff1a'):
                addr = val.replace('Address:', '').replace('Address\uff1a', '').strip()
                if addr:
                    bill_to_address.append(addr)
                for k in range(j+1, len(row)):
                    if pd.notna(row[k]):
                        v = str(row[k]).strip()
                        if v and 'Contact' not in v and 'Email' not in v and 'Bank' not in v:
                            bill_to_address.append(v)
                            break
            elif 'Contact' in val and ('\uff1a' in val or ':' in val):
                m = re.search(r'Contact[\s:\uff1a]+(.+)', val)
                if m and m.group(1).strip():
                    contact_name = m.group(1).strip()
                else:
                    for k in range(j+1, len(row)):
                        if pd.notna(row[k]) and str(row[k]).strip():
                            contact_name = str(row[k]).strip()
                            break
            elif val.startswith('Email:') or val.startswith('Email\uff1a'):
                for k in range(j+1, len(row)):
                    if pd.notna(row[k]) and str(row[k]).strip():
                        email = str(row[k]).strip()
                        break
    final_destination = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if isinstance(val, str) and 'Delivery Terms' in val:
                m = re.search(r'Delivery Terms[\s:\uff1a]+(.+)', val)
                if m and m.group(1).strip():
                    raw_term = m.group(1).strip()
                else:
                    raw_term = None
                    for k in range(j+1, len(row)):
                        if pd.notna(row[k]):
                            raw_term = str(row[k]).strip()
                            break
                    if not raw_term:
                        continue
                for prefix in ['CIP ', 'FOB ', 'CIF ', 'CFR ', 'DDP ', 'DDU ', 'EXW ', 'DAP ']:
                    if raw_term.upper().startswith(prefix):
                        final_destination = raw_term[len(prefix):].strip()
                        break
                else:
                    final_destination = raw_term
    products = []
    header_row = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if val == 'EAN':
                header_row = i
                break
        if header_row is not None:
            break
    if header_row is not None:
        header = df.iloc[header_row]
        ean_col = None
        desc_col = None
        qty_col = None
        rate_col = None
        for j, val in enumerate(header):
            if pd.notna(val):
                v = str(val).strip()
                if v == 'EAN':
                    ean_col = j
                elif 'DESCRIPTION' in v:
                    desc_col = j
                elif v == 'QUANTITY':
                    qty_col = j
                elif 'RATE' in v:
                    rate_col = j
        for i in range(header_row + 1, len(df)):
            row = df.iloc[i]
            if ean_col is not None and pd.notna(row[ean_col]):
                ean = str(row[ean_col]).strip()
                is_cb = ean.startswith('CB.')
                is_ean = re.match(r'^\d{13}$', ean)
                if is_ean or is_cb:
                    desc = str(row[desc_col]).strip() if desc_col is not None and pd.notna(row[desc_col]) else ''
                    qty = str(row[qty_col]).strip() if qty_col is not None and pd.notna(row[qty_col]) else '0'
                    rate = str(row[rate_col]).strip() if rate_col is not None and pd.notna(row[rate_col]) else '0'
                    if qty.isdigit():
                        try:
                            rate_val = float(rate.replace(',', '').replace('$', ''))
                            products.append({
                                'ean': ean,
                                'description': desc,
                                'qty': int(qty),
                                'rate': rate_val,
                                'amount': int(qty) * rate_val
                            })
                        except Exception:
                            pass
    return {
        'pi_number': pi_number,
        'pi_date': pi_date,
        'bill_to_name': bill_to_name,
        'bill_to_address': '\n'.join(bill_to_address) if bill_to_address else '',
        'contact_name': contact_name,
        'email': email,
        'final_destination': final_destination,
        'products': products
    }


def parse_pi_pdf(pi_path):
    with open(pi_path, 'rb') as f:
        reader = PyPDF2.PdfReader(f)
        text = ''
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + '\n'
    lines = [l.strip() for l in text.split('\n')]
    pi_number = None
    for line in lines:
        m = re.search(r'INVOICE\s*#\s*([A-Z0-9]+)', line)
        if m:
            pi_number = m.group(1).strip()
            break
    if not pi_number:
        m = re.search(r'INVOICE\s+([A-Z0-9]+)', text)
        if m:
            pi_number = m.group(1)
    pi_date = None
    for line in lines:
        m = re.search(r'DATE\s+(\d{2}[./]\d{2}[./]\d{4})', line)
        if m:
            pi_date = m.group(1)
            break
    if not pi_date:
        m = re.search(r'DATE\s+([0-9./-]+)', text)
        if m:
            pi_date = m.group(1)
    bill_to_name = None
    bill_to_address = []
    contact_name = None
    for i, line in enumerate(lines):
        if 'Customer Name' in line:
            m = re.search(r'Customer Name[\s:\uff1a]+(.+)', line)
            if m:
                bill_to_name = m.group(1).strip()
            elif i + 1 < len(lines) and 'Address' not in lines[i+1]:
                bill_to_name = lines[i + 1].strip()
        if line.startswith('Address:') or line.startswith('Address\uff1a'):
            addr = line.replace('Address:', '').replace('Address\uff1a', '').strip()
            if addr:
                bill_to_address.append(addr)
            j = i + 1
            while j < len(lines):
                l = lines[j].strip()
                if 'Contact' in l or l.startswith('ITEM NO.') or l == 'EAN':
                    break
                if l and 'Email' not in l:
                    bill_to_address.append(l)
                j += 1
        if 'Contact' in line and ('\uff1a' in line or ':' in line):
            m = re.search(r'Contact[\s:\uff1a]+(.+)', line)
            if m:
                contact_name = m.group(1).strip()
                contact_name = re.sub(r'\s*Email.*$', '', contact_name, flags=re.IGNORECASE).strip()
            elif i + 1 < len(lines) and lines[i + 1].strip() and 'Email' not in lines[i + 1]:
                contact_name = lines[i + 1].strip()
        elif line == 'Contact:' or line == 'Contact\uff1a':
            if i + 1 < len(lines) and lines[i + 1].strip():
                contact_name = lines[i + 1].strip()
    email = None
    for line in lines:
        m = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', line)
        if m:
            email = m.group(0)
            break
    final_destination = None
    for i, line in enumerate(lines):
        if 'Delivery Terms:' in line or 'Delivery Terms\uff1a' in line:
            m = re.search(r'Delivery Terms[\s:\uff1a]+(.+)', line)
            if m:
                raw_term = m.group(1).strip()
            elif i + 1 < len(lines):
                raw_term = lines[i + 1].strip()
            else:
                continue
            for prefix in ['CIP ', 'FOB ', 'CIF ', 'CFR ', 'DDP ', 'DDU ', 'EXW ', 'DAP ']:
                if raw_term.upper().startswith(prefix):
                    final_destination = raw_term[len(prefix):].strip()
                    break
            else:
                final_destination = raw_term
            if 'Proforma' in final_destination or 'Invoice' in final_destination:
                final_destination = re.sub(r'Proforma.*$', '', final_destination, flags=re.IGNORECASE).strip()
                final_destination = re.sub(r'Invoice.*$', '', final_destination, flags=re.IGNORECASE).strip()
            break
    products = []
    in_table_v2 = False
    for line in lines:
        if 'ITEM NO.' in line and 'EAN' in line:
            in_table_v2 = True
            continue
        if in_table_v2:
            if 'Terms and Conditions' in line or ('USD' in line and 'TOTAL' in line):
                break
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 6:
                if parts[0].isdigit():
                    code = parts[1]
                    is_valid_code = code.startswith('CB.') or re.match(r'^\d{13}$', code)
                    if is_valid_code:
                        qty = parts[-3]
                        rate = parts[-2]
                        amount = parts[-1]
                        if qty.isdigit():
                            desc = ' '.join(parts[2:-3])
                            try:
                                products.append({
                                    'ean': code,
                                    'description': desc,
                                    'qty': int(qty),
                                    'rate': float(rate.replace(',', '')),
                                    'amount': float(amount.replace(',', ''))
                                })
                            except Exception:
                                pass
    if not products:
        i = 0
        while i < len(lines):
            line = lines[i]
            if re.match(r'^\d{13}$', line):
                if i + 4 < len(lines):
                    desc = lines[i + 1].strip()
                    qty_str = lines[i + 2].strip()
                    rate_str = lines[i + 3].strip()
                    amount_str = lines[i + 4].strip()
                    if qty_str.isdigit():
                        try:
                            qty = int(qty_str)
                            rate = float(rate_str.replace(',', ''))
                            amount = float(amount_str.replace(',', ''))
                            products.append({
                                'ean': line,
                                'description': desc,
                                'qty': qty,
                                'rate': rate,
                                'amount': amount
                            })
                            i += 5
                            continue
                        except Exception:
                            pass
            i += 1
    return {
        'pi_number': pi_number,
        'pi_date': pi_date,
        'bill_to_name': bill_to_name,
        'bill_to_address': ', '.join(bill_to_address) if bill_to_address else '',
        'contact_name': contact_name,
        'email': email,
        'final_destination': final_destination,
        'products': products
    }


def parse_ar_excel(ar_path):
    df = pd.read_excel(ar_path, sheet_name='Order Pick Sheet', header=None)
    order_number = None
    ar_date = None
    consignee = None
    for i, row in df.iterrows():
        for j, val in enumerate(row):
            if isinstance(val, str):
                if 'Order or invoice' in val and 'Number' in val:
                    for k in range(j+1, len(row)):
                        if pd.notna(row[k]) and str(row[k]).strip():
                            order_number = str(row[k]).strip()
                            break
                if 'DATE' in val:
                    m = re.search(r'DATE[:\s]+(\d{2}/\d{2}/\d{4})', val)
                    if m:
                        ar_date = m.group(1)
                if 'Consignee' in val:
                    for k in range(j+1, len(row)):
                        if pd.notna(row[k]) and str(row[k]).strip():
                            consignee = str(row[k]).strip()
                            break
                    if not consignee and i + 1 < len(df):
                        next_row = df.iloc[i+1]
                        for k in range(j+1, len(next_row)):
                            if pd.notna(next_row[k]) and str(next_row[k]).strip():
                                consignee = str(next_row[k]).strip()
                                break
    header_idx = None
    for i, row in df.iterrows():
        for val in row:
            if isinstance(val, str) and 'Item Code' in val:
                header_idx = i
                break
        if header_idx is not None:
            break
    items = []
    last_pkgs = ''
    last_weight = ''
    last_dimension = ''

    if header_idx is not None:
        header_row = df.iloc[header_idx]
        col_map = {}
        for j, val in enumerate(header_row):
            if isinstance(val, str):
                v = val.strip().upper()
                if 'ITEM' in v or 'CODE' in v:
                    col_map['item_code'] = j
                elif 'DESC' in v:
                    col_map['description'] = j
                elif 'QTY' in v or 'QUANTITY' in v:
                    col_map['qty'] = j
                elif 'PKGS' in v or 'CARTONS' in v or 'PALLETS' in v:
                    col_map['pkgs'] = j
                elif 'WEIGHT' in v:
                    col_map['weight'] = j
                elif 'DIMENSION' in v or 'DIMENTIOM' in v:
                    col_map['dimension'] = j
                elif 'SN' in v or 'NUMBER' in v:
                    col_map['sn'] = j
        for i in range(header_idx + 1, len(df)):
            row = df.iloc[i]
            if any(isinstance(v, str) and 'Total' in v for v in row):
                break
            item = {}
            for key, col_idx in col_map.items():
                if col_idx < len(row) and pd.notna(row[col_idx]):
                    item[key] = str(row[col_idx]).strip()

            if item.get('pkgs'):
                last_pkgs = item['pkgs']
            else:
                item['pkgs'] = last_pkgs

            if item.get('weight'):
                last_weight = item['weight']
            else:
                item['weight'] = last_weight

            if item.get('dimension'):
                last_dimension = item['dimension']
            else:
                item['dimension'] = last_dimension

            if item.get('item_code'):
                items.append(item)
    return {
        'order_number': order_number,
        'date': ar_date,
        'consignee': consignee,
        'items': items
    }
