import * as pdfjsLib from 'pdfjs-dist';
import { createWorker, type Worker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

let cachedWorker: Worker | null = null;
let workerInitializing = false;

async function getOCRWorker(): Promise<Worker> {
  if (cachedWorker) return cachedWorker;
  if (workerInitializing) {
    while (workerInitializing) await new Promise(r => setTimeout(r, 200));
    if (cachedWorker) return cachedWorker;
  }
  workerInitializing = true;
  try {
    const worker = await createWorker('eng', 1, {
      logger: () => {},
      errorHandler: (err) => console.error('Tesseract worker error:', err),
    });
    cachedWorker = worker;
    return worker;
  } finally {
    workerInitializing = false;
  }
}

/**
 * Render PDF page to image at high resolution for OCR
 */
async function pdfPageToImage(pdf: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number = 3): Promise<string> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await (page.render as any)({ canvasContext: ctx, viewport }).promise;

  // JPEG for smaller size
  return canvas.toDataURL('image/jpeg', 0.92);
}

export interface OCRProgress {
  status: string;
  progress?: number;
}

export interface OCRResult<T> {
  data: T;
  rawText: string;
}

/**
 * Extract text from PDF via OCR
 */
export async function extractPDFTextViaOCR(
  file: File,
  onProgress?: (msg: string) => void
): Promise<string> {
  onProgress?.('读取PDF...');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  onProgress?.(`PDF共${pdf.numPages}页，初始化OCR...`);
  let worker: Worker;
  try {
    worker = await getOCRWorker();
  } catch (e: any) {
    throw new Error(`OCR引擎初始化失败: ${e.message}`);
  }

  let allText = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(`渲染第${pageNum}页 (3x分辨率)...`);
    const imageDataUrl = await pdfPageToImage(pdf, pageNum, 3);

    onProgress?.(`OCR识别第${pageNum}/${pdf.numPages}页...`);
    try {
      const result = await worker.recognize(imageDataUrl);
      const pageText = result.data.text || '';
      allText += pageText + '\n';
      onProgress?.(`第${pageNum}页完成，${pageText.length}字符`);
    } catch (e: any) {
      console.error(`OCR第${pageNum}页失败:`, e);
      onProgress?.(`第${pageNum}页失败: ${e.message}`);
    }
  }

  if (allText.trim().length === 0) {
    throw new Error('OCR未识别到任何文字。');
  }

  return allText;
}

// ============================================
// PI Parser
// ============================================
export async function parseHKPIPDF_OCR(file: File, onProgress?: (msg: string) => void): Promise<OCRResult<any>> {
  const text = await extractPDFTextViaOCR(file, onProgress);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Extract header info
  let fromCompany = '';
  let piNumber = '';
  let piDate = '';
  let toCompany = '';
  let contact = '';
  let email = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 || /^DJI|^AERONEX/i.test(line)) fromCompany = line;
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

  // Extract products from lines
  const products: any[] = [];
  let itemCounter = 1;

  for (const line of lines) {
    // Look for EAN (13 digits or CB.xxx)
    const eanMatch = line.match(/(?:^|\s)(\d{13}|CB\.\d+)(?:\s|$)/);
    if (!eanMatch) continue;
    const ean = eanMatch[1];
    if (products.find(p => p.ean === ean)) continue;

    // Extract all numbers from the line
    const numbers: number[] = [];
    for (const m of line.matchAll(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d{2,})\b/g)) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(n)) numbers.push(n);
    }

    // Also extract integers without commas
    for (const m of line.matchAll(/\b(\d{2,4})\b/g)) {
      const n = parseInt(m[1]);
      if (!numbers.includes(n)) numbers.push(n);
    }

    // Separate integers (likely qty) and decimals (likely prices)
    const ints = numbers.filter(n => Number.isInteger(n) && n > 0 && n < 100000);
    const decimals = numbers.filter(n => !Number.isInteger(n) && n > 0);

    // Qty: the largest reasonable integer (between 1-10000)
    let qty = 0;
    if (ints.length > 0) {
      // Prefer integers that look like qty (1-10000)
      const qtyCandidates = ints.filter(n => n >= 1 && n <= 50000);
      if (qtyCandidates.length > 0) qty = Math.max(...qtyCandidates);
      else qty = Math.max(...ints);
    }

    // Prices: decimal numbers
    let unitPrice = 0;
    let amount = 0;
    if (decimals.length >= 2) {
      const sorted = [...decimals].sort((a, b) => a - b);
      unitPrice = sorted[0];
      amount = sorted[sorted.length - 1];
    } else if (decimals.length === 1) {
      unitPrice = decimals[0];
    }

    // If no decimals but has qty, maybe prices are integers too
    if (decimals.length === 0 && ints.length >= 2 && qty > 0) {
      const nonQty = ints.filter(n => n !== qty);
      if (nonQty.length >= 1) {
        unitPrice = nonQty[0];
        amount = unitPrice * qty;
      }
    }

    // Description: text between EAN and first number
    const afterEan = line.substring(line.indexOf(ean) + ean.length);
    let description = '';
    const descMatch = afterEan.match(/^(.+?)(?=\s+\d)/);
    if (descMatch) description = descMatch[1].trim();
    if (!description) {
      // Fallback: remove EAN and numbers, keep letters
      const cleaned = line.replace(new RegExp(ean, 'g'), '').replace(/\d+(?:\.\d+)?/g, ' ').replace(/[|_\-]{2,}/g, ' ').trim();
      if (cleaned.length > 3) description = cleaned;
    }

    if (description.length > 2) {
      products.push({
        item_no: String(itemCounter++),
        ean,
        description: description.replace(/[|_-]/g, ' ').trim(),
        qty: qty || 1,
        unit: 'PCS',
        unit_price: unitPrice,
        amount: amount || unitPrice * (qty || 1),
      });
    }
  }

  return {
    data: {
      pi_number: piNumber, pi_date: piDate, from_company: fromCompany,
      to_company: toCompany, to_address: '', contact, email,
      products,
      total_qty: products.reduce((s: number, p: any) => s + p.qty, 0),
      total_amount: products.reduce((s: number, p: any) => s + p.amount, 0),
    },
    rawText: text,
  };
}

// ============================================
// Factory CI Parser
// ============================================
export async function parseFactoryCIPDF_OCR(file: File, onProgress?: (msg: string) => void): Promise<OCRResult<any>> {
  const text = await extractPDFTextViaOCR(file, onProgress);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

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
    if (/sold\s*to/i.test(line) && /Company/i.test(line)) {
      const m = line.match(/Company\s*[:：]?\s*(.+)/i);
      if (m) soldTo = m[1].trim();
    }
    if (/deliver\s*to/i.test(line) && /Company/i.test(line)) {
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

  const items = extractCIItems_OCR(lines);

  return {
    data: {
      invoice_no: invoiceNo, invoice_date: invoiceDate, pi_no: piNo,
      sold_to: soldTo, sold_to_address: '', delivered_to: deliveredTo, delivered_to_address: '', asn, items,
      total_qty: items.reduce((s, it) => s + it.qty, 0),
      total_amount: items.reduce((s, it) => s + it.amount, 0),
    },
    rawText: text,
  };
}

function extractCIItems_OCR(lines: string[]): any[] {
  const result: any[] = [];

  for (const line of lines) {
    // Look for 13-digit EAN
    const eanMatch = line.match(/(\d{13})/);
    if (!eanMatch) continue;
    const ean = eanMatch[1];
    if (result.find(r => r.ean === ean)) continue;

    // Part No (CP/AG/WM prefix)
    let partNo = '';
    const pm = line.match(/((?:CP|AG|WM)\.[A-Z0-9.]+)/);
    if (pm) partNo = pm[1];

    // PI No
    let piNoItem = '';
    const pim = line.match(/(EF\d+[A-Z0-9]+)/);
    if (pim) piNoItem = pim[1];

    // HS Code (6 digits not in EAN)
    let hsCode = '';
    for (const hm of line.matchAll(/\b(\d{6})\b/g)) {
      if (!ean.includes(hm[1])) { hsCode = hm[1]; break; }
    }

    // Origin
    let origin = 'China';
    const om = line.match(/\b(China|USA|Japan|Germany|Hong\s*Kong)\b/i);
    if (om) origin = om[1];

    // Qty
    let qty = 0;
    const qm = line.match(/(\d+)\s+(PCS|SET)/i);
    if (qm) qty = parseInt(qm[1]);

    // Description: between EAN and first number after EAN
    let description = '';
    const afterEan = line.substring(line.indexOf(ean) + 13);
    const dm = afterEan.match(/^(.+?)(?=\s+\d{6}\s+China|\s+PCS|\s+SET|\s+USD|\s+\d+\.\d+)/);
    if (dm) description = dm[1].trim();
    if (!description) {
      const fm = afterEan.match(/(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*|Lithium\s+battery[\w\/\s]*)/i);
      if (fm) description = fm[0].trim();
    }
    if (!description) {
      const cleaned = afterEan.replace(/\d+(?:\.\d+)?/g, ' ').replace(/[|_\-]{2,}/g, ' ').trim();
      if (cleaned.length > 3 && cleaned.length < 100) description = cleaned;
    }

    // Prices
    let unitPrice = 0, amount = 0;
    const usdm = afterEan.match(/(\d+(?:,\d+)*(?:\.\d+)?)\s+USD\s+(\d+(?:,\d+)*(?:\.\d+)?)/);
    if (usdm) {
      const p1 = parseFloat(usdm[1].replace(/,/g, ''));
      const p2 = parseFloat(usdm[2].replace(/,/g, ''));
      if (qty > 0 && Math.abs(p2 - p1 * qty) < p2 * 0.5) {
        unitPrice = p1; amount = p2;
      } else {
        unitPrice = Math.min(p1, p2); amount = Math.max(p1, p2);
      }
    }

    // Fallback prices from line
    if (unitPrice === 0) {
      const nums = [...line.matchAll(/\b(\d+(?:,\d+)*(?:\.\d+)?)\b/g)]
        .map(m => parseFloat(m[1].replace(/,/g, '')))
        .filter(n => n > 50);
      if (nums.length >= 2) {
        nums.sort((a, b) => a - b);
        unitPrice = nums[0];
        amount = nums[nums.length - 1];
      }
    }

    if (ean) {
      result.push({
        item_no: String(result.length + 1),
        part_no: partNo, pi_no: piNoItem, ean,
        description: description || '-',
        hs_code: hsCode, origin,
        qty: qty || 1, uom: 'PCS', unit_price: unitPrice,
        currency: 'USD', amount: amount || unitPrice * (qty || 1),
      });
    }
  }

  return result;
}

// ============================================
// Factory PL Parser
// ============================================
export async function parseFactoryPLPDF_OCR(file: File, onProgress?: (msg: string) => void): Promise<OCRResult<any>> {
  const text = await extractPDFTextViaOCR(file, onProgress);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

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

  const items = extractPLItems_OCR(lines);

  const totalGW = items.reduce((s, it) => s + parseFloat(it.gross_weight || 0), 0);
  const totalNW = items.reduce((s, it) => s + parseFloat(it.net_weight || 0), 0);
  const totalVol = items.reduce((s, it) => s + parseFloat(it.volume || 0), 0);

  return {
    data: {
      invoice_no: invoiceNo, asn, date, pi_no: piNo,
      sold_to: '', delivered_to: '',
      items,
      total_cases: items.reduce((s, it) => s + (it.num_cases || 1), 0),
      total_qty: items.reduce((s, it) => s + it.qty, 0),
      total_gross_weight: totalGW.toFixed(2),
      total_net_weight: totalNW.toFixed(3),
      total_volume: totalVol.toFixed(5),
    },
    rawText: text,
  };
}

function extractPLItems_OCR(lines: string[]): any[] {
  const result: any[] = [];

  for (const line of lines) {
    // Case No pattern: CSS260330S466-1 or CSS260330S466-1~36
    const caseMatch = line.match(/([A-Z]+\d+[A-Z]?\d+)-(\d+)(?:~(\d+))?/);
    if (!caseMatch) continue;
    const caseNo = caseMatch[0];
    const startNum = parseInt(caseMatch[2]);
    const endNum = caseMatch[3] ? parseInt(caseMatch[3]) : startNum;
    const numCases = endNum - startNum + 1;

    if (result.find(it => it.case_no === caseNo)) continue;

    // EAN
    let ean = '';
    const em = line.match(/(\d{13})/);
    if (em) ean = em[1];

    // Part No
    let partNo = '';
    const pm = line.match(/((?:CP|AG|WM)\.[A-Z0-9.]+)/);
    if (pm) partNo = pm[1];

    // Description
    let description = '';
    if (ean) {
      const dm = line.match(new RegExp(`${ean}\\s+(.+?)(?=\\s+\\d+\\s+(?:PCS|SET)|\\s+Total|$)`));
      if (dm) description = dm[1].trim();
    }
    if (!description) {
      const fm = line.match(/(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*)/i);
      if (fm) description = fm[0].trim();
    }
    if (!description) {
      // Remove case no and numbers, keep text
      const cleaned = line.replace(caseNo, '').replace(/\d{13}/, '').replace(/\d+(?:\.\d+)?/g, ' ').replace(/[|_\-]{2,}/g, ' ').trim();
      if (cleaned.length > 3 && cleaned.length < 100) description = cleaned;
    }

    // Qty
    let qty = 0;
    const qm = line.match(/(\d+)\s+(PCS|SET)/i);
    if (qm) qty = parseInt(qm[1]);

    // GW and NW
    let gw = '', nw = '';
    const gnm = line.match(/(?:PCS|SET)\s+(\d+\.\d+)\s+(\d+\.\d+)/);
    if (gnm) { gw = gnm[1]; nw = gnm[2]; }
    if (!gw) {
      const decimals = [...line.matchAll(/(\d+\.\d+)/g)].map(m => m[1]);
      if (decimals.length >= 2) { gw = decimals[0]; nw = decimals[1]; }
    }

    // Size
    let size = '';
    const sm = line.match(/(\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?)/);
    if (sm) size = sm[1];

    // Volume
    let volume = '';
    const vols = [...line.matchAll(/(\d+\.\d{3,})/g)].map(m => m[1]);
    for (const v of [...vols].reverse()) {
      if (0.001 < parseFloat(v) && parseFloat(v) < 10) { volume = v; break; }
    }

    if (ean || qty > 0) {
      result.push({
        case_no: caseNo, material: 'Carton', part_no: partNo, ean,
        description: description || '-', qty: qty || 1, uom: 'PCS',
        gross_weight: gw, net_weight: nw,
        size, volume, shipping_marks: '',
        num_cases: numCases,
      });
    }
  }

  return result;
}
