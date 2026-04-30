import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ===== CI/PL Generator Utils =====
export const SHIPPER_NAME = 'AERO NEX FZCO';
export const SHIPPER_ADDR1 = 'No.529, 6W A, Dubai Airport Free Zone';
export const SHIPPER_ADDR2 = 'Dubai,United Arab Emirates';
export const COUNTRY_ORIGIN = 'Made in China';
export const ORIGIN = 'CHINA';

export const INV_DATA_START = 27;
export const INV_RESERVED_ROWS = 7;
export const PL_DATA_START = 27;
export const PL_RESERVED_ROWS = 7;

export interface Product {
  ean: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  hs_code?: string;
  pi_number?: string;
}

export interface ParsedPI {
  pi_number: string;
  pi_date: string;
  bill_to_name: string;
  bill_to_address: string;
  contact_name: string;
  email: string;
  final_destination: string;
  products: Product[];
}

export interface ARItem {
  sn?: string;
  item_code: string;
  description: string;
  qty: string;
  pkgs: string;
  weight: string;
  dimension: string;
}

export interface ParsedAR {
  order_number: string;
  date: string;
  consignee: string;
  items: ARItem[];
}

export function mapCbToEan(cbCode: string, description: string, eanMap: Record<string, string>): string {
  if (!cbCode || !cbCode.startsWith('CB.')) return cbCode;
  if (!description || !eanMap) return cbCode;
  const descLower = description.toLowerCase().trim();
  for (const [ean, desc] of Object.entries(eanMap)) {
    if (descLower === desc.toLowerCase().trim()) return ean;
  }
  for (const [ean, desc] of Object.entries(eanMap)) {
    const descEanLower = desc.toLowerCase().trim();
    if (descLower.includes(descEanLower) || descEanLower.includes(descLower)) return ean;
  }
  let core = descLower.replace(/\s*(with|w\/)\s+.*/i, '').trim();
  core = core.replace(/\s*\(.*?\)$/, '').trim();
  if (core && core.length > 3) {
    for (const [ean, desc] of Object.entries(eanMap)) {
      const descEanLower = desc.toLowerCase().trim();
      const descCore = descEanLower.replace(/\s*\(.*?\)$/, '').trim();
      if (core.includes(descCore) || descCore.includes(core)) return ean;
    }
  }
  return cbCode;
}

export function formatWeight(weightVal: string | number): string {
  if (!weightVal) return '';
  const wStr = String(weightVal).trim();
  if (wStr.toUpperCase().includes('KG')) return wStr;
  const m = wStr.match(/([0-9]+\.?[0-9]*)/);
  if (m) return `${m[1]} KG`;
  return wStr;
}

export function summarizePackages(arItems: ARItem[]): string {
  const seenPkgs = new Set<string>();
  for (const item of arItems) {
    const pkgs = String(item.pkgs || '').trim().toUpperCase();
    if (pkgs) seenPkgs.add(pkgs);
  }
  let boxCount = 0;
  let pltCount = 0;
  for (const pkgs of seenPkgs) {
    let m = pkgs.match(/(BOX|PLT|CARTON|PALLET)[#\s]*(\d+)/i);
    if (m) {
      const pkgType = m[1].toUpperCase();
      if (pkgType === 'BOX' || pkgType === 'CARTON') boxCount++;
      else if (pkgType === 'PLT' || pkgType === 'PALLET') pltCount++;
    } else {
      m = pkgs.match(/(\d+)\s*(BOX|PLT|CARTON|PALLET)/i);
      if (m) {
        const pkgType = m[2].toUpperCase();
        if (pkgType === 'BOX' || pkgType === 'CARTON') boxCount++;
        else if (pkgType === 'PLT' || pkgType === 'PALLET') pltCount++;
      }
    }
  }
  const parts: string[] = [];
  if (boxCount > 0) parts.push(`${boxCount} BOX`);
  if (pltCount > 0) parts.push(`${pltCount} PLT`);
  return parts.join(', ');
}
