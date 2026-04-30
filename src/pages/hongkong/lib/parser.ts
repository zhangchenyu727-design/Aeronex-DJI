import * as pdfjsLib from 'pdfjs-dist';
import type { PIInfo, PIProduct, FactoryCI, FactoryCIItem, FactoryPL } from './utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ============================================
// Column-boundary-based PDF text extraction
// This mirrors the Python pdfplumber approach:
// Get character coordinates, group by row, split into columns
// ============================================

interface TextChar {
  text: string;
  x: number;
  y: number;
  width: number;
}

function getCharsFromPage(page: any): TextChar[] {
  return (page.items || []).map((it: any) => {
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    return {
      text: it.str || '',
      x: t[4],
      y: t[5],
      width: it.width || 0,
    };
  }).filter((c: TextChar) => c.text.trim());
}

function extractTableRows(
  page: any,
  colBoundaries: [number, number][],
  yMin: number,
  yMax: number,
  filterFn?: (cols: string[]) => boolean
): string[][] {
  const chars = getCharsFromPage(page);
  const rowMap: Record<number, TextChar[]> = {};

  for (const c of chars) {
    if (c.y >= yMin && c.y <= yMax) {
      const yKey = Math.round(c.y);
      if (!rowMap[yKey]) rowMap[yKey] = [];
      rowMap[yKey].push(c);
    }
  }

  const result: string[][] = [];
  const yKeys = Object.keys(rowMap).map(Number).sort((a, b) => a - b);

  for (const y of yKeys) {
    const rowChars = rowMap[y].sort((a, b) => a.x - b.x);
    if (rowChars.length < 5) continue;

    const cols: string[] = [];
    for (const [start, end] of colBoundaries) {
      const colChars = rowChars.filter(c => c.x >= start && c.x < end);
      cols.push(colChars.map(c => c.text).join('').trim());
    }

    if (cols.some(c => c) && (!filterFn || filterFn(cols))) {
      result.push(cols);
    }
  }

  return result;
}

function hasEAN(cols: string[]): boolean {
  return cols.some(c => /\d{13}|CB\.\d+/.test(c));
}

// ============================================
// PI Parser
// ============================================

export async function parseHKPIPDF(file: File): Promise<PIInfo> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // Extract header text
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += (tc.items as any[]).map(it => it.str).join(' ') + '\n';
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

  let fromCompany = '';
  let piNumber = '';
  let piDate = '';
  let toCompany = '';
  let contact = '';
  let email = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) fromCompany = line;
    if (!piNumber) {
      const m = line.match(/INVOICE\s*#?\s*([A-Z0-9\-]+)/i) || line.match(/PI\s*#?\s*([A-Z0-9\-]+)/i);
      if (m) piNumber = m[1];
    }
    if (!piDate) {
      const m = line.match(/(\d{2}[\/\.]\d{2}[\/\.]\d{4})/);
      if (m) piDate = m[1];
    }
    if (/customer\s*name/i.test(line)) {
      const m = line.match(/Customer\s*Name\s*[:：]?\s*(.+)/i);
      if (m && m[1].trim()) toCompany = m[1].trim();
      else if (i + 1 < lines.length) toCompany = lines[i + 1];
    }
    if (/contact/i.test(line)) {
      const m = line.match(/Contact\s*[:：]?\s*(.+)/i);
      if (m) contact = m[1].trim();
    }
    const em = line.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (em) email = em[0];
  }

  // Extract product table with column boundaries
  const piCols: [number, number][] = [
    [30, 55],     // Item No
    [80, 160],    // EAN
    [160, 370],   // Description
    [370, 410],   // Qty
    [415, 465],   // Rate
    [485, 540],   // Amount
  ];

  const products: PIProduct[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    const rows = extractTableRows(tc, piCols, 280, 400, hasEAN);

    for (const cols of rows) {
      if (cols.length < 6) continue;

      const itemNo = cols[0];
      const ean = cols[1];
      const description = cols[2];
      const qtyStr = cols[3];
      const rateStr = cols[4];
      const amountStr = cols[5];

      if (!/^\d{13}|CB\.\d+$/.test(ean)) continue;
      if (products.find(p => p.ean === ean)) continue;

      let qty = 0;
      const m = qtyStr.match(/(\d+)/);
      if (m) qty = parseInt(m[1]);

      let unitPrice = 0;
      const m2 = rateStr.match(/([\d,]+(?:\.\d{2})?)/);
      if (m2) unitPrice = parseFloat(m2[1].replace(/,/g, ''));

      let amount = 0;
      const m3 = amountStr.match(/([\d,]+(?:\.\d{2})?)/);
      if (m3) amount = parseFloat(m3[1].replace(/,/g, ''));

      if (qty > 0) {
        products.push({
          item_no: itemNo || String(products.length + 1),
          ean,
          description: description.replace(/[\(\（].*?[\)\）]/g, '').trim(),
          qty,
          unit: 'PCS',
          unit_price: unitPrice,
          amount: amount || unitPrice * qty,
        });
      }
    }
  }

  return {
    pi_number: piNumber,
    pi_date: piDate,
    from_company: fromCompany,
    to_company: toCompany,
    to_address: '',
    contact,
    email,
    products,
    total_qty: products.reduce((s, p) => s + p.qty, 0),
    total_amount: products.reduce((s, p) => s + p.amount, 0),
  };
}

// ============================================
// Factory CI Parser
// ============================================

export async function parseFactoryCIPDF(file: File): Promise<FactoryCI> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += (tc.items as any[]).map(it => it.str).join(' ') + '\n';
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

  let invoiceNo = '';
  let invoiceDate = '';
  let piNo = '';
  let soldTo = '';
  let deliveredTo = '';
  let asn = '';

  for (const line of lines) {
    if (/invoice\s*no/i.test(line)) {
      const m = line.match(/Invoice\s*No\.?\s*[:：]?\s*(\S+)/i);
      if (m) invoiceNo = m[1];
    }
    if (!invoiceDate && /date/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) invoiceDate = m[1];
    }
    if (/pi\s*no/i.test(line)) {
      const m = line.match(/PI\s*No\.?\s*[:：]?\s*(\S+)/i);
      if (m) piNo = m[1];
    }
    if (/ASN/i.test(line)) {
      const m = line.match(/ASN\.?\s*[:：]?\s*([A-Z0-9]+)/i) || line.match(/ASN\.\s+([A-Z0-9]+)/i);
      if (m) asn = m[1];
    }
    if (/sold\s*to/i.test(line)) {
      const m = line.match(/Company\s*[:：]?\s*(.+)/i);
      if (m) soldTo = m[1].trim();
    }
    if (/deliver\s*to/i.test(line)) {
      const m = line.match(/Company\s*[:：]?\s*(.+)/i);
      if (m) deliveredTo = m[1].trim();
    }
  }

  if (!asn) {
    for (const line of lines) {
      const m = line.match(/ASN\.\s*([A-Z0-9]+)/i);
      if (m) { asn = m[1]; break; }
    }
  }

  // CI column boundaries
  const ciCols: [number, number][] = [
    [15, 35],     // Item No
    [75, 145],    // Part No
    [145, 205],   // PI No
    [265, 335],   // EAN
    [335, 420],   // Description
    [420, 455],   // HS Code
    [455, 490],   // Country
    [540, 565],   // Qty
    [580, 605],   // UOM
    [630, 660],   // Unit Price
    [685, 715],   // Currency
    [760, 790],   // Amount
  ];

  const items: FactoryCIItem[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    const rows = extractTableRows(tc, ciCols, 200, 300, hasEAN);

    for (const cols of rows) {
      if (cols.length < 8) continue;

      const partNo = cols[1];
      let piNoItem = cols[2];
      const ean = cols[3];
      const description = cols[4];
      const hsCode = cols[5];
      const origin = cols[6] || 'China';
      const qtyStr = cols[7];
      const uom = cols[8] || 'PCS';
      const priceStr = cols[9];
      const currency = cols[10] || 'USD';
      const amountStr = cols[11];

      if (!/^\d{13}$/.test(ean)) continue;
      if (items.find(it => it.ean === ean)) continue;

      // Clean PI No
      const m = piNoItem.match(/(EF\d+)/);
      if (m) piNoItem = m[1];

      let qty = 0;
      const m2 = qtyStr.match(/(\d+)/);
      if (m2) qty = parseInt(m2[1]);

      let unitPrice = 0;
      const m3 = priceStr.match(/([\d,]+(?:\.\d{2})?)/);
      if (m3) unitPrice = parseFloat(m3[1].replace(/,/g, ''));

      let amount = 0;
      const m4 = amountStr.match(/([\d,]+(?:\.\d{2})?)/);
      if (m4) amount = parseFloat(m4[1].replace(/,/g, ''));

      if (qty > 0) {
        items.push({
          item_no: String(items.length + 1),
          part_no: partNo,
          pi_no: piNoItem,
          ean,
          description,
          hs_code: hsCode,
          origin,
          qty,
          uom,
          unit_price: unitPrice,
          currency,
          amount: amount || unitPrice * qty,
        });
      }
    }
  }

  return {
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    pi_no: piNo,
    sold_to: soldTo,
    sold_to_address: '',
    delivered_to: deliveredTo,
    delivered_to_address: '',
    asn,
    items,
    total_qty: items.reduce((s, it) => s + it.qty, 0),
    total_amount: items.reduce((s, it) => s + it.amount, 0),
  };
}

// ============================================
// Factory PL Parser
// ============================================

export async function parseFactoryPLPDF(file: File): Promise<FactoryPL> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    fullText += (tc.items as any[]).map(it => it.str).join(' ') + '\n';
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);

  let invoiceNo = '';
  let date = '';
  let piNo = '';
  let asn = '';

  for (const line of lines) {
    if (/invoice\s*no/i.test(line)) {
      const m = line.match(/Invoice\s*No\.?\s*[:：]?\s*(\S+)/i);
      if (m) invoiceNo = m[1];
    }
    if (!date && /date/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) date = m[1];
    }
    if (/pi\s*no/i.test(line)) {
      const m = line.match(/PI\s*No\.?\s*[:：]?\s*(\S+)/i);
      if (m) piNo = m[1];
    }
    if (/ASN/i.test(line)) {
      const m = line.match(/ASN\.?\s*[:：]?\s*([A-Z0-9]+)/i) || line.match(/ASN\.\s+([A-Z0-9]+)/i);
      if (m) asn = m[1];
    }
  }

  if (!asn) {
    for (const line of lines) {
      const m = line.match(/ASN\.\s*([A-Z0-9]+)/i);
      if (m) { asn = m[1]; break; }
    }
  }

  // PL column boundaries
  const plCols: [number, number][] = [
    [15, 35],     // Item No
    [75, 150],    // Case No
    [150, 185],   // Material
    [185, 260],   // Part No
    [260, 335],   // EAN
    [335, 480],   // Description
    [480, 500],   // Qty
    [500, 560],   // UOM
    [560, 600],   // GW
    [600, 645],   // NW
    [645, 705],   // Size
    [705, 750],   // Volume
  ];

  const items: any[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const tc = await page.getTextContent();
    const rows = extractTableRows(tc, plCols, 170, 260, hasEAN);

    for (const cols of rows) {
      if (cols.length < 8) continue;

      const caseNo = cols[1];
      const material = cols[2] || 'Carton';
      const partNo = cols[3];
      const ean = cols[4];
      const description = cols[5];
      const qtyStr = cols[6];
      const uom = cols[7] || 'PCS';
      const gw = cols[8];
      const nw = cols[9];
      const size = cols[10];
      const volume = cols[11];

      if (!ean && !caseNo) continue;

      let qty = 0;
      const m = qtyStr.match(/(\d+)/);
      if (m) qty = parseInt(m[1]);

      let numCases = 1;
      const m2 = caseNo.match(/-([\d~]+)$/);
      if (m2) {
        const rangeStr = m2[1];
        if (rangeStr.includes('~')) {
          const parts = rangeStr.split('~');
          numCases = parseInt(parts[1]) - parseInt(parts[0]) + 1;
        } else {
          numCases = 1;
        }
      }

      items.push({
        case_no: caseNo,
        material,
        part_no: partNo,
        ean,
        description: description || '-',
        qty: qty || 1,
        uom,
        gross_weight: gw,
        net_weight: nw,
        size,
        volume,
        shipping_marks: '',
        num_cases: numCases,
      });
    }
  }

  const totalGW = items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0);
  const totalNW = items.reduce((s, it) => s + parseFloat(it.net_weight || 0), 0);
  const totalVol = items.reduce((s, it) => s + parseFloat(it.volume || 0), 0);

  return {
    invoice_no: invoiceNo,
    asn,
    date,
    pi_no: piNo,
    sold_to: '',
    delivered_to: '',
    items,
    total_cases: items.reduce((s, it) => s + (it.num_cases || 1), 0),
    total_qty: items.reduce((s, it) => s + it.qty, 0),
    total_gross_weight: totalGW.toFixed(2),
    total_net_weight: totalNW.toFixed(3),
    total_volume: totalVol.toFixed(5),
  };
}

// ============================================
// EAN Mapping
// ============================================

export function buildEanMapFromFactory(factoryItems: Array<{ ean: string; description: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of factoryItems) {
    const normalized = item.description
      .toLowerCase()
      .replace(/[\s\-/]/g, '')
      .replace(/dji/g, '')
      .replace(/general/g, '')
      .replace(/\(.*\)/g, '');
    map[normalized] = item.ean;
  }
  return map;
}

export function mapPIEansToFormal(piProducts: PIProduct[], eanMap: Record<string, string>): PIProduct[] {
  return piProducts.map(prod => {
    if (!prod.ean.startsWith('CB.')) return prod;

    const normalizedDesc = prod.description
      .toLowerCase()
      .replace(/[\s\-/]/g, '')
      .replace(/dji/g, '')
      .replace(/general/g, '')
      .replace(/\(.*\)/g, '');

    let formalEan = eanMap[normalizedDesc];

    if (!formalEan) {
      for (const [key, value] of Object.entries(eanMap)) {
        const piWords = prod.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const keyWords = key.split(/\s+/).filter(w => w.length > 3);
        const commonWords = piWords.filter(w => keyWords.includes(w));
        if (commonWords.length >= 2) {
          formalEan = value;
          break;
        }
      }
    }

    return { ...prod, ean: formalEan || prod.ean };
  });
}
