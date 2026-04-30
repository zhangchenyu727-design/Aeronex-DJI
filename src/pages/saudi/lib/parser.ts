import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedPI, ParsedAR, ARItem, Product } from './utils';

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ============================================
// PDF Parser - with y-coordinate sorting
// ============================================
export async function parsePIPDF(file: File): Promise<ParsedPI> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems: Array<{ y: number; x: number; str: string }> = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items as any[]) {
      if (!item.str || item.str.trim() === '') continue;
      allItems.push({
        y: item.transform[5],
        x: item.transform[4],
        str: item.str,
      });
    }
  }

  // Group by y-coordinate with tolerance (±2px)
  allItems.sort((a, b) => a.y - b.y);
  const lineGroups: Array<Array<{ x: number; str: string }>> = [];
  let currentGroup: Array<{ x: number; str: string }> = [];
  let currentY = -9999;

  for (const item of allItems) {
    if (Math.abs(item.y - currentY) > 2) {
      if (currentGroup.length > 0) lineGroups.push(currentGroup);
      currentGroup = [];
      currentY = item.y;
    }
    currentGroup.push({ x: item.x, str: item.str });
  }
  if (currentGroup.length > 0) lineGroups.push(currentGroup);

  // Sort groups by y descending (top to bottom), items within group by x ascending
  const allLines: string[] = [];
  for (const group of lineGroups.reverse()) {
    group.sort((a, b) => a.x - b.x);
    const line = group.map(it => it.str).join(' ').trim();
    if (line) allLines.push(line);
  }

  return parsePILines(allLines);
}

// ============================================
// Excel Parser
// ============================================
export function parsePIExcel(file: File): Promise<ParsedPI> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
        resolve(parsePILines(sheetToLines(jsonData)));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function sheetToLines(data: any[][]): string[] {
  const lines: string[] = [];
  for (const row of data) {
    const parts = row.filter((v: any) => v !== null && v !== undefined).map((v: any) => String(v).trim());
    if (parts.length > 0) lines.push(parts.join(' '));
  }
  return lines;
}

// ============================================
// Unified PI Line Parser
// ============================================
function parsePILines(lines: string[]): ParsedPI {
  // --- PI Number ---
  let piNumber = '';
  for (const line of lines) {
    const m = line.match(/INVOICE\s*#?\s*([A-Z0-9]+)/i);
    if (m) { piNumber = m[1]; break; }
  }

  // --- PI Date ---
  let piDate = '';
  for (const line of lines) {
    const m = line.match(/(\d{4}-\d{1,2}-\d{1,2})/);
    if (m) { piDate = m[1]; break; }
    const m2 = line.match(/(\d{2}[./]\d{2}[./]\d{4})/);
    if (m2 && !piDate) { piDate = m2[1]; break; }
  }

  // --- Bill To / Customer ---
  let billToName = '';
  let billToAddress = '';
  let contactName = '';
  let email = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Customer Name - handle both : and ： and empty space after
    const cnMatch = line.match(/Customer Name\s*[:：]\s*(.+)/i);
    if (cnMatch && cnMatch[1].trim()) {
      billToName = cnMatch[1].trim();
      continue;
    }
    // Address - handle multi-line (including Arabic comma prefix)
    const addrMatch = line.match(/Address\s*[:：]\s*(.+)/i);
    if (addrMatch && !line.toLowerCase().includes('bank')) {
      const firstPart = addrMatch[1].trim();
      if (firstPart && !firstPart.startsWith('，') && !firstPart.startsWith(',')) {
        billToAddress = firstPart;
      }
      // Collect subsequent lines that are address continuation (Arabic comma prefix or normal text)
      let j = i + 1;
      const addrParts: string[] = firstPart && !firstPart.startsWith('،') ? [firstPart] : [];
      while (j < lines.length) {
        const nextLine = lines[j].trim();
        // Stop at known non-address markers
        if (/Contact|Email|Terms|Price|Payment|Delivery|ITEM|EAN|BANK/i.test(nextLine)) break;
        if (!nextLine) break;
        // Address continuation lines often start with Arabic comma
        addrParts.push(nextLine);
        j++;
      }
      if (addrParts.length > 0) {
        billToAddress = addrParts.join(', ').replace(/，/g, ',').replace(/,\s*,/g, ',').trim();
      }
      i = j - 1;
      continue;
    }
    // Contact
    const contactMatch = line.match(/Contact\s*[:：]\s*(.+)/i);
    if (contactMatch && contactMatch[1].trim()) {
      contactName = contactMatch[1].trim().replace(/\s*Email.*$/i, '').trim();
      continue;
    }
  }
  // Also try split-line Contact
  for (let i = 0; i < lines.length - 1; i++) {
    if (/Contact\s*[:：]?\s*$/i.test(lines[i]) && lines[i + 1] && !lines[i + 1].includes('Email')) {
      contactName = lines[i + 1].trim();
      break;
    }
  }

  // --- Email ---
  for (const line of lines) {
    const m = line.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (m) { email = m[0]; break; }
  }

  // --- Final Destination ---
  let finalDestination = '';
  for (const line of lines) {
    const m = line.match(/Delivery Terms\s*[:\uff1a]?\s*(.+)/i);
    if (m) {
      let raw = m[1].trim();
      // Remove prefixes like CIP, FOB, etc.
      for (const prefix of ['CIP ', 'FOB ', 'CIF ', 'CFR ', 'DDP ', 'DDU ', 'EXW ', 'DAP ']) {
        if (raw.toUpperCase().startsWith(prefix)) {
          raw = raw.substring(prefix.length).trim();
          break;
        }
      }
      // Remove trailing "Proforma Invoice"
      raw = raw.replace(/Proforma\s*Invoice.*$/i, '').trim();
      finalDestination = raw;
      break;
    }
  }

  // --- Products ---
  const products = extractProducts(lines);

  return {
    pi_number: piNumber,
    pi_date: piDate,
    bill_to_name: billToName,
    bill_to_address: billToAddress,
    contact_name: contactName,
    email: email,
    final_destination: finalDestination,
    products,
  };
}

function extractProducts(lines: string[]): Product[] {
  const products: Product[] = [];

  // Find header row - look for EAN + DESCRIPTION headers
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if ((line.includes('ITEM NO') || line.includes('EAN')) && line.includes('DESCRIPTION')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return products;

  // Check if header has ITEM NO column
  const hasItemNo = lines[headerIdx].includes('ITEM NO');

  // Parse each product row
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop conditions
    if (/Terms\s*and\s*Conditions/i.test(line)) break;
    if (/^\d+\s+USD\s+/.test(line)) break;
    if (line.includes('Price:') || line.includes('Payment') || line.includes('Delivery Terms')) break;
    if (line === 'TOTAL') break;

    if (hasItemNo) {
      // Format with ITEM NO: "1 CB.202505213099 Matrice 400... 2 5450.00 10900.00"
      const m = line.match(/^(\d+)\s+((?:CB\.\d+|\d{13}))\s+(.+?)\s+(\d+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/);
      if (m) {
        try {
          products.push({
            ean: m[2],
            description: m[3].trim(),
            qty: parseInt(m[4]),
            rate: parseFloat(m[5].replace(/,/g, '')),
            amount: parseFloat(m[6].replace(/,/g, '')),
          });
        } catch { /* skip */ }
      }
    } else {
      // Format without ITEM NO: "6937224120570 Matrice 400... 1 5214.92 5214.92"
      // EAN is 13 digits at start
      const m = line.match(/^(\d{13})\s+(.+?)\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s*$/);
      if (m) {
        try {
          products.push({
            ean: m[1],
            description: m[2].trim(),
            qty: parseInt(m[3]),
            rate: parseFloat(m[4].replace(/,/g, '')),
            amount: parseFloat(m[5].replace(/,/g, '')),
          });
        } catch { /* skip */ }
      }
    }
  }

  return products;
}

// ============================================
// AR Parser
// ============================================
export function parseARExcel(file: File): Promise<ParsedAR> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames.find(n => n.includes('Order Pick')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        resolve(parseARFromSheet(jsonData));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function parseARFromSheet(data: any[][]): ParsedAR {
  let orderNumber = '';
  let arDate = '';
  let consignee = '';

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    for (let j = 0; j < row.length; j++) {
      const val = row[j];
      if (typeof val !== 'string') continue;

      if (val.includes('Order or invoice') && val.includes('Number')) {
        for (let k = j + 1; k < row.length; k++) {
          if (row[k] && String(row[k]).trim()) { orderNumber = String(row[k]).trim(); break; }
        }
      }
      if (val.includes('DATE') && !arDate) {
        const m = val.match(/DATE[:\s]+(\d{2}\/\d{2}\/\d{4})/);
        if (m) arDate = m[1];
      }
      if (val.includes('Consignee') && !consignee) {
        for (let k = j + 1; k < row.length; k++) {
          if (row[k] && String(row[k]).trim()) { consignee = String(row[k]).trim(); break; }
        }
        if (!consignee && i + 1 < data.length) {
          const nextRow = data[i + 1];
          for (let k = j + 1; k < nextRow.length; k++) {
            if (nextRow[k] && String(nextRow[k]).trim()) { consignee = String(nextRow[k]).trim(); break; }
          }
        }
      }
    }
  }

  // Find header
  let headerIdx: number | null = null;
  for (let i = 0; i < data.length; i++) {
    for (const val of data[i]) {
      if (typeof val === 'string' && val.includes('Item Code')) {
        headerIdx = i; break;
      }
    }
    if (headerIdx !== null) break;
  }

  const items: ARItem[] = [];
  let lastPkgs = '';
  let lastQty = '1';
  let lastWeight = '';
  let lastDimension = '';

  if (headerIdx !== null) {
    const headerRow = data[headerIdx];
    const colMap: Record<string, number> = {};
    for (let j = 0; j < headerRow.length; j++) {
      if (typeof headerRow[j] !== 'string') continue;
      const v = headerRow[j].toUpperCase();
      if (v.includes('ITEM') || v.includes('CODE')) colMap['item_code'] = j;
      else if (v.includes('DESC')) colMap['description'] = j;
      else if (v.includes('QTY') || v.includes('QUANTITY')) colMap['qty'] = j;
      else if (v.includes('PKGS') || v.includes('CARTONS') || v.includes('PALLETS')) colMap['pkgs'] = j;
      else if (v.includes('WEIGHT')) colMap['weight'] = j;
      else if (v.includes('DIMENSION') || v.includes('DIMENTIOM')) colMap['dimension'] = j;
      else if (v.includes('SN') || v.includes('NUMBER')) colMap['sn'] = j;
    }

    for (let i = headerIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (row.some((v: any) => typeof v === 'string' && v.includes('Total'))) break;

      const item: Partial<ARItem> = {};
      for (const [key, colIdx] of Object.entries(colMap)) {
        if (colIdx < row.length && row[colIdx] !== undefined && row[colIdx] !== null) {
          (item as any)[key] = String(row[colIdx]).trim();
        }
      }

      if (item.qty) lastQty = item.qty;
      else item.qty = lastQty;

      if (item.pkgs) lastPkgs = item.pkgs;
      else item.pkgs = lastPkgs;

      if (item.weight) lastWeight = item.weight;
      else item.weight = lastWeight;

      if (item.dimension) lastDimension = item.dimension;
      else item.dimension = lastDimension;

      if (item.item_code) {
        items.push(item as ARItem);
      }
    }
  }

  return { order_number: orderNumber, date: arDate, consignee, items };
}
