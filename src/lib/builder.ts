import ExcelJS from 'exceljs';
import {
  SHIPPER_NAME, SHIPPER_ADDR1, SHIPPER_ADDR2,
  COUNTRY_ORIGIN, ORIGIN, formatWeight,
  INV_DATA_START, INV_RESERVED_ROWS,
  PL_DATA_START, PL_RESERVED_ROWS,
} from './utils';
import type { ParsedPI, ParsedAR, Product } from './utils';

interface PLItem {
  ean: string;
  description: string;
  qty: number;
  weight: string;
  dimension: string;
  pkgs: string;
  hs_code: string;
  pi_number: string;
}

const FB = {
  left: { style: 'thin' as const },
  right: { style: 'thin' as const },
  top: { style: 'thin' as const },
  bottom: { style: 'thin' as const },
};

/** Clear cell value and all styles (like original clean_old_content) */
function clearCell(cell: ExcelJS.Cell) {
  cell.value = null;
  cell.style = {} as any;
}

/** Clear a range of rows (like original clean_old_content) */
function clearRows(ws: ExcelJS.Worksheet, startRow: number, endRow: number, startCol = 1, endCol = 8) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      clearCell(ws.getCell(r, c));
    }
  }
}

/** Copy style from src cell to dst cell */
function copyStyle(src: ExcelJS.Cell, dst: ExcelJS.Cell) {
  if (src.font) dst.font = { ...src.font };
  if (src.alignment) dst.alignment = { ...src.alignment };
  if (src.border) dst.border = { ...src.border };
  if (src.fill) dst.fill = { ...src.fill };
}

/** Write Invoice data row - ALL cols get font/alignment/border */
function writeInvRow(ws: ExcelJS.Worksheet, row: number, p: Product) {
  for (let c = 1; c <= 8; c++) {
    const cell = ws.getCell(row, c);
    cell.font = { name: 'Times New Roman', size: 12 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = FB;
  }
  ws.getCell(row, 1).value = p.hs_code || '';
  ws.getCell(row, 2).value = p.ean;
  ws.getCell(row, 3).value = p.pi_number || '';
  ws.getCell(row, 4).value = p.description;
  ws.getCell(row, 5).value = ORIGIN;
  ws.getCell(row, 6).value = p.qty;
  ws.getCell(row, 7).value = p.rate;
  ws.getCell(row, 8).value = p.amount;
}

/** Write PL data row - ALL cols get font + border, col 5,6 get alignment (like original) */
function writePlRow(ws: ExcelJS.Worksheet, row: number, prod: PLItem, isFirst: boolean) {
  // Set font, border, and center alignment for all cols
  for (let c = 1; c <= 8; c++) {
    const cell = ws.getCell(row, c);
    cell.font = { name: 'Times New Roman', size: 12 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = FB;
  }
  // Write values
  ws.getCell(row, 1).value = prod.hs_code;
  ws.getCell(row, 2).value = prod.ean;
  ws.getCell(row, 3).value = prod.pi_number;
  ws.getCell(row, 4).value = prod.description;
  ws.getCell(row, 5).value = ORIGIN;
  ws.getCell(row, 6).value = prod.qty;
  // Set alignment ONLY for col 5,6 (like original)
  ws.getCell(row, 5).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(row, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  // Weight/Dimension
  if (isFirst) {
    ws.getCell(row, 7).value = formatWeight(prod.weight);
    ws.getCell(row, 8).value = prod.dimension;
  } else {
    ws.getCell(row, 7).value = null;
    ws.getCell(row, 8).value = null;
  }
}

// ============================================================
// BUILD INVOICE
// ============================================================
export async function buildInvoice(
  templateBuf: ArrayBuffer,
  pi: ParsedPI,
  ar: ParsedAR,
  prods: Product[],
  pkgSum: string
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf);
  const ws = wb.getWorksheet('Invoice')!;
  const n = prods.length;

  // 1. Clear old content 27-45 (like original clean_old_content)
  clearRows(ws, 27, 45);

  // 2. Header (exact positions from original)
  ws.getCell('A9').value = SHIPPER_NAME;
  ws.getCell('A10').value = SHIPPER_ADDR1;
  ws.getCell('A11').value = SHIPPER_ADDR2;
  ws.getCell('F9').value = ar.order_number || '';
  ws.getCell('F10').value = new Date().toLocaleDateString('en-GB');
  ws.getCell('A14').value = pi.bill_to_name || '';
  ws.getCell('A15').value = pi.bill_to_address || '';
  ws.getCell('A16').value = pi.contact_name || '';
  ws.getCell('A17').value = pi.email || '';
  ws.getCell('F14').value = 'Final Destination';
  ws.getCell('E15').value = pi.final_destination || '';
  const shipTo = ar.consignee || pi.bill_to_name || '';
  ws.getCell('A19').value = shipTo;
  ws.getCell('A20').value = pi.bill_to_address || '';
  ws.getCell('A21').value = pi.contact_name || '';
  ws.getCell('A22').value = pi.email || '';
  ws.getCell('A25').value = pkgSum;
  ws.getCell('G25').value = COUNTRY_ORIGIN;

  // 3. Data rows
  let dataEndRow: number;
  if (n <= INV_RESERVED_ROWS) {
    dataEndRow = INV_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      writeInvRow(ws, INV_DATA_START + i, prods[i]);
    }
    // Clear remaining rows
    for (let r = dataEndRow + 1; r < INV_DATA_START + INV_RESERVED_ROWS; r++) {
      clearRows(ws, r, r);
    }
  } else {
    const extra = n - INV_RESERVED_ROWS;
    for (let i = 0; i < extra; i++) {
      const at = INV_DATA_START + INV_RESERVED_ROWS;
      ws.spliceRows(at, 0, [] as any);
      const src = INV_DATA_START;
      for (let c = 1; c <= 8; c++) {
        copyStyle(ws.getCell(src, c), ws.getCell(at, c));
        ws.getCell(at, c).value = null;
      }
    }
    dataEndRow = INV_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      writeInvRow(ws, INV_DATA_START + i, prods[i]);
    }
  }

  // 4. Summary (like original - only col 6 and 8)
  const sr = dataEndRow + 1;
  ws.getCell(sr, 6).value = { formula: `SUM(F${INV_DATA_START}:F${dataEndRow})` };
  ws.getCell(sr, 6).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sr, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(sr, 6).border = { bottom: { style: 'thin' } };
  ws.getCell(sr, 8).value = { formula: `SUM(H${INV_DATA_START}:H${dataEndRow})` };
  ws.getCell(sr, 8).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sr, 8).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(sr, 8).border = { bottom: { style: 'thin' } };

  // 5. Signature (col 7, like original)
  const sig1 = sr + 3;
  const sig2 = sig1 + 1;
  ws.getCell(sig1, 7).value = 'AERO NEX FZCO';
  ws.getCell(sig1, 7).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sig2, 7).value = 'Signed by.......................................................................';
  ws.getCell(sig2, 7).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sig2, 7).alignment = { horizontal: 'center', vertical: 'middle' };

  return wb;
}

// ============================================================
// BUILD PACKING LIST
// ============================================================
export async function buildPackingList(
  templateBuf: ArrayBuffer,
  pi: ParsedPI,
  ar: ParsedAR,
  plItems: PLItem[]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuf);
  const ws = wb.getWorksheet('Packing List')!;
  const n = plItems.length;

  // 1. Unmerge ALL merged cells - try common template ranges
  const knownMerges = [
    'A9:D9', 'A10:D10', 'A11:D11', 'A14:D14', 'A15:D15', 'A16:D16', 'A17:D17',
    'A19:D19', 'A20:D20', 'A21:D21', 'A22:D22',
    'G27:H27', 'G27:H28', 'G27:H29', 'G27:H30', 'G27:H31', 'G27:H32', 'G27:H33',
  ];
  for (const m of knownMerges) { try { ws.unMergeCells(m); } catch { /* ok */ } }

  // 2. Clear old content 27-45 (like original clean_old_content)
  clearRows(ws, 27, 45);

  // 3. Header (exact positions from original)
  ws.getCell('A9').value = SHIPPER_NAME;
  ws.getCell('A10').value = SHIPPER_ADDR1;
  ws.getCell('A11').value = SHIPPER_ADDR2;
  ws.getCell('F9').value = ar.order_number || '';
  ws.getCell('F10').value = new Date().toLocaleDateString('en-GB');
  ws.getCell('A14').value = pi.bill_to_name || '';
  ws.getCell('A15').value = pi.bill_to_address || '';
  ws.getCell('A16').value = pi.contact_name || '';
  ws.getCell('A17').value = pi.email || '';
  ws.getCell('F14').value = 'Final Destination';
  ws.getCell('E15').value = pi.final_destination || '';
  const shipTo = ar.consignee || pi.bill_to_name || '';
  ws.getCell('A19').value = shipTo;
  ws.getCell('A20').value = pi.bill_to_address || '';
  ws.getCell('A21').value = pi.contact_name || '';
  ws.getCell('A22').value = pi.email || '';
  ws.getCell('A25').value = plItems.length > 0 ? summarizePlPkgs(plItems) : '';
  ws.getCell('G25').value = COUNTRY_ORIGIN;

  // 4. Data rows (like original _write_pl_row - only col 5,6 get alignment)
  let dataEndRow: number;
  if (n <= PL_RESERVED_ROWS) {
    dataEndRow = PL_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      const isFirst = i === 0 || plItems[i - 1].pkgs !== plItems[i].pkgs;
      writePlRow(ws, PL_DATA_START + i, plItems[i], isFirst);
    }
    // Clear remaining rows
    for (let r = dataEndRow + 1; r < PL_DATA_START + PL_RESERVED_ROWS; r++) {
      clearRows(ws, r, r);
    }
  } else {
    const extra = n - PL_RESERVED_ROWS;
    for (let i = 0; i < extra; i++) {
      const at = PL_DATA_START + PL_RESERVED_ROWS;
      ws.spliceRows(at, 0, [] as any);
      const src = PL_DATA_START;
      for (let c = 1; c <= 8; c++) {
        copyStyle(ws.getCell(src, c), ws.getCell(at, c));
        ws.getCell(at, c).value = null;
      }
    }
    dataEndRow = PL_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      const isFirst = i === 0 || plItems[i - 1].pkgs !== plItems[i].pkgs;
      writePlRow(ws, PL_DATA_START + i, plItems[i], isFirst);
    }
  }

  // 5. Summary (like original)
  let totalWeight = 0;
  const seenPkgs = new Set<string>();
  for (const item of plItems) {
    if (item.pkgs && !seenPkgs.has(item.pkgs)) {
      seenPkgs.add(item.pkgs);
      const m = String(item.weight).match(/([0-9]+\.?[0-9]*)/);
      if (m) totalWeight += parseFloat(m[1]);
    }
  }
  const weightStr = totalWeight > 0 ? totalWeight.toFixed(2) : '';
  const sr = dataEndRow + 1;

  ws.getCell(sr, 1).value = weightStr ? `GR. WT :   ${weightStr}KG` : '';
  ws.getCell(sr, 1).font = { name: 'Times New Roman', size: 11 };
  ws.getCell(sr, 1).alignment = { horizontal: 'left', vertical: 'middle' };

  ws.getCell(sr, 6).value = { formula: `SUM(F${PL_DATA_START}:F${dataEndRow})` };
  ws.getCell(sr, 6).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sr, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(sr, 6).border = { bottom: { style: 'thin' } };

  // 6. Rebuild WEIGHT/DIMENSION merge by PKGS
  let curPkg: string | null = null;
  let stIdx: number | null = null;
  for (let i = 0; i < plItems.length; i++) {
    const pkg = plItems[i].pkgs || '';
    if (pkg !== curPkg) {
      if (curPkg !== null && stIdx !== null && i - 1 > stIdx) {
        ws.mergeCells(PL_DATA_START + stIdx, 7, PL_DATA_START + i - 1, 7);
        ws.mergeCells(PL_DATA_START + stIdx, 8, PL_DATA_START + i - 1, 8);
      }
      curPkg = pkg;
      stIdx = i;
    }
  }
  if (curPkg !== null && stIdx !== null && plItems.length - 1 > stIdx) {
    ws.mergeCells(PL_DATA_START + stIdx, 7, PL_DATA_START + plItems.length - 1, 7);
    ws.mergeCells(PL_DATA_START + stIdx, 8, PL_DATA_START + plItems.length - 1, 8);
  }

  // 7. Signature (col 5, like original)
  const sig1 = sr + 3;
  const sig2 = sig1 + 1;
  ws.getCell(sig1, 5).value = 'AERO NEX FZCO';
  ws.getCell(sig1, 5).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sig2, 5).value = 'Signed by.......................................................................';
  ws.getCell(sig2, 5).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sig2, 5).alignment = { horizontal: 'center', vertical: 'middle' };

  return wb;
}

function summarizePlPkgs(items: PLItem[]): string {
  const seen = new Set<string>();
  for (const it of items) { if (it.pkgs) seen.add(it.pkgs); }
  let boxes = 0, plts = 0;
  for (const p of seen) {
    const u = p.toUpperCase();
    if (u.includes('BOX') || u.includes('CARTON')) boxes++;
    else if (u.includes('PLT') || u.includes('PALLET')) plts++;
  }
  const parts: string[] = [];
  if (boxes) parts.push(`${boxes} BOX`);
  if (plts) parts.push(`${plts} PLT`);
  return parts.join(', ');
}

// ============================================================
// COMBINED: Write both Invoice and Packing List to one workbook
// ============================================================
export async function buildCombined(
  templateBuf: ArrayBuffer,
  pi: ParsedPI,
  ar: ParsedAR,
  prods: Product[],
  plItems: PLItem[],
  pkgSum: string
): Promise<ExcelJS.Workbook> {
  // Build Invoice
  const invWb = await buildInvoice(templateBuf, pi, ar, prods, pkgSum);

  // Build Packing List into the SAME workbook
  const ws = invWb.getWorksheet('Packing List')!;
  const n = plItems.length;

  // 1. Unmerge ALL - try common template ranges
  const knownMerges = [
    'A9:D9', 'A10:D10', 'A11:D11', 'A14:D14', 'A15:D15', 'A16:D16', 'A17:D17',
    'A19:D19', 'A20:D20', 'A21:D21', 'A22:D22',
    'G27:H27', 'G27:H28', 'G27:H29', 'G27:H30', 'G27:H31', 'G27:H32', 'G27:H33',
  ];
  for (const m of knownMerges) { try { ws.unMergeCells(m); } catch { /* ok */ } }

  // 2. Clear old content 27-45
  clearRows(ws, 27, 45);

  // 3. Header
  ws.getCell('A9').value = SHIPPER_NAME;
  ws.getCell('A10').value = SHIPPER_ADDR1;
  ws.getCell('A11').value = SHIPPER_ADDR2;
  ws.getCell('F9').value = ar.order_number || '';
  ws.getCell('F10').value = new Date().toLocaleDateString('en-GB');
  ws.getCell('A14').value = pi.bill_to_name || '';
  ws.getCell('A15').value = pi.bill_to_address || '';
  ws.getCell('A16').value = pi.contact_name || '';
  ws.getCell('A17').value = pi.email || '';
  ws.getCell('F14').value = 'Final Destination';
  ws.getCell('E15').value = pi.final_destination || '';
  const st = ar.consignee || pi.bill_to_name || '';
  ws.getCell('A19').value = st;
  ws.getCell('A20').value = pi.bill_to_address || '';
  ws.getCell('A21').value = pi.contact_name || '';
  ws.getCell('A22').value = pi.email || '';
  ws.getCell('A25').value = plItems.length > 0 ? summarizePlPkgs(plItems) : '';
  ws.getCell('G25').value = COUNTRY_ORIGIN;

  // 4. Data rows
  let dataEndRow: number;
  if (n <= PL_RESERVED_ROWS) {
    dataEndRow = PL_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      const isFirst = i === 0 || plItems[i - 1].pkgs !== plItems[i].pkgs;
      writePlRow(ws, PL_DATA_START + i, plItems[i], isFirst);
    }
    for (let r = dataEndRow + 1; r < PL_DATA_START + PL_RESERVED_ROWS; r++) {
      clearRows(ws, r, r);
    }
  } else {
    const extra = n - PL_RESERVED_ROWS;
    for (let i = 0; i < extra; i++) {
      const at = PL_DATA_START + PL_RESERVED_ROWS;
      ws.spliceRows(at, 0, [] as any);
      const src = PL_DATA_START;
      for (let c = 1; c <= 8; c++) {
        copyStyle(ws.getCell(src, c), ws.getCell(at, c));
        ws.getCell(at, c).value = null;
      }
    }
    dataEndRow = PL_DATA_START + n - 1;
    for (let i = 0; i < n; i++) {
      const isFirst = i === 0 || plItems[i - 1].pkgs !== plItems[i].pkgs;
      writePlRow(ws, PL_DATA_START + i, plItems[i], isFirst);
    }
  }

  // 5. Summary
  let totalWeight = 0;
  const seen = new Set<string>();
  for (const item of plItems) {
    if (item.pkgs && !seen.has(item.pkgs)) {
      seen.add(item.pkgs);
      const m = String(item.weight).match(/([0-9]+\.?[0-9]*)/);
      if (m) totalWeight += parseFloat(m[1]);
    }
  }
  const wStr = totalWeight > 0 ? totalWeight.toFixed(2) : '';
  const sr = dataEndRow + 1;

  ws.getCell(sr, 1).value = wStr ? `GR. WT :   ${wStr}KG` : '';
  ws.getCell(sr, 1).font = { name: 'Times New Roman', size: 11 };
  ws.getCell(sr, 1).alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getCell(sr, 6).value = { formula: `SUM(F${PL_DATA_START}:F${dataEndRow})` };
  ws.getCell(sr, 6).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(sr, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(sr, 6).border = { bottom: { style: 'thin' } };

  // 6. Merge
  let cur: string | null = null; let st2: number | null = null;
  for (let i = 0; i < plItems.length; i++) {
    const pkg = plItems[i].pkgs || '';
    if (pkg !== cur) {
      if (cur !== null && st2 !== null && i - 1 > st2) {
        ws.mergeCells(PL_DATA_START + st2, 7, PL_DATA_START + i - 1, 7);
        ws.mergeCells(PL_DATA_START + st2, 8, PL_DATA_START + i - 1, 8);
      }
      cur = pkg; st2 = i;
    }
  }
  if (cur !== null && st2 !== null && plItems.length - 1 > st2) {
    ws.mergeCells(PL_DATA_START + st2, 7, PL_DATA_START + plItems.length - 1, 7);
    ws.mergeCells(PL_DATA_START + st2, 8, PL_DATA_START + plItems.length - 1, 8);
  }

  // 7. Signature
  const s1 = sr + 3; const s2 = s1 + 1;
  ws.getCell(s1, 5).value = 'AERO NEX FZCO';
  ws.getCell(s1, 5).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(s2, 5).value = 'Signed by.......................................................................';
  ws.getCell(s2, 5).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(s2, 5).alignment = { horizontal: 'center', vertical: 'middle' };

  return invWb;
}
