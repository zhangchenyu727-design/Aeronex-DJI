let eanMapCache: Record<string, string> | null = null;
let hsMapCache: Record<string, string> | null = null;

export async function loadEanMap(): Promise<Record<string, string>> {
  if (eanMapCache) return eanMapCache;
  const res = await fetch('/ean_map.json');
  eanMapCache = await res.json() as Record<string, string>;
  return eanMapCache;
}

export async function loadHsCodeMap(): Promise<Record<string, string>> {
  if (hsMapCache) return hsMapCache;
  const res = await fetch('/hs_code_map.json');
  hsMapCache = await res.json() as Record<string, string>;
  return hsMapCache;
}

export async function loadTemplateBuffer(): Promise<ArrayBuffer> {
  const res = await fetch('/CI_PL_Template.xlsx');
  return res.arrayBuffer();
}
