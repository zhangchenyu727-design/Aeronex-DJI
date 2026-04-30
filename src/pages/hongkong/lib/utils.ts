// ============================================
// Hong Kong Types
// ============================================

export interface PIProduct {
  item_no: string;
  ean: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface PIInfo {
  pi_number: string;
  pi_date: string;
  from_company: string;
  to_company: string;
  to_address: string;
  contact: string;
  email: string;
  products: PIProduct[];
  total_qty: number;
  total_amount: number;
}

export interface FactoryCIItem {
  item_no: string;
  part_no: string;
  pi_no: string;
  ean: string;
  description: string;
  hs_code: string;
  origin: string;
  qty: number;
  uom: string;
  unit_price: number;
  currency: string;
  amount: number;
}

export interface FactoryCI {
  invoice_no: string;
  invoice_date: string;
  pi_no: string;
  sold_to: string;
  sold_to_address: string;
  delivered_to: string;
  delivered_to_address: string;
  asn: string;
  items: FactoryCIItem[];
  total_qty: number;
  total_amount: number;
}

export interface FactoryPLItem {
  case_no: string;
  material: string;
  part_no: string;
  ean: string;
  description: string;
  qty: number;
  uom: string;
  gross_weight: string;
  net_weight: string;
  size: string;
  volume: string;
  shipping_marks: string;
  num_cases?: number; // Computed: e.g. 1~36 → 36
}

export interface FactoryPL {
  invoice_no: string;
  asn: string;
  date: string;
  pi_no: string;
  sold_to: string;
  delivered_to: string;
  items: FactoryPLItem[];
  total_cases: number;
  total_qty: number;
  total_gross_weight: string;
  total_net_weight: string;
  total_volume: string;
}
