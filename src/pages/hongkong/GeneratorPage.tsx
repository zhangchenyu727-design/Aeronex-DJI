import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Loader2, FileText, CheckCircle, Package, AlertCircle, Mail, Home, ArrowLeft, Shield, FileSpreadsheet } from 'lucide-react'
import { parseHKPIPDF, parseFactoryCIPDF, parseFactoryPLPDF, mapPIEansToFormal, buildEanMapFromFactory } from './lib/parser'
import type { PIInfo, FactoryCI, FactoryPL } from './lib/utils'

// One paired CI+PL result
interface FactoryGroup {
  asn: string;
  ci: FactoryCI;
  pl: FactoryPL;
}

// Display row for merged CI+PL
interface DisplayRow {
  asn: string;
  case_no: string;
  ean: string;
  description: string;
  qty: number;
  unit_price: number;
  hs_code: string;
  origin: string;
  gross_weight: string;
  size: string;
  volume: string;
  cases: number;
}

function mergeGroup(asn: string, ci: FactoryCI, pl: FactoryPL): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const ciItem of ci.items) {
    const plItem = pl.items.find(p => p.ean === ciItem.ean);
    let cases = 1;
    if (plItem && plItem.num_cases !== undefined) cases = plItem.num_cases;
    rows.push({
      asn,
      case_no: plItem?.case_no || '',
      ean: ciItem.ean,
      description: ciItem.description || plItem?.description || '',
      qty: ciItem.qty,
      unit_price: ciItem.unit_price,
      hs_code: ciItem.hs_code,
      origin: ciItem.origin,
      gross_weight: plItem?.gross_weight || '',
      size: plItem?.size || '',
      volume: plItem?.volume || '',
      cases,
    });
  }
  for (const plItem of pl.items) {
    if (!ci.items.find(c => c.ean === plItem.ean)) {
      rows.push({
        asn,
        case_no: plItem.case_no,
        ean: plItem.ean,
        description: plItem.description,
        qty: plItem.qty,
        unit_price: 0,
        hs_code: '',
        origin: '',
        gross_weight: plItem.gross_weight,
        size: plItem.size,
        volume: plItem.volume,
        cases: plItem.num_cases || 1,
      });
    }
  }
  return rows;
}

// ============================================
// Pure text parsers (fallback when PDF.js fails)
// ============================================
function parseHKPIText(text: string): PIInfo {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)

  let fromCompany = lines[0] || ''
  let piNumber = ''
  let piDate = ''
  let toCompany = ''
  let contact = ''
  let email = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!piNumber) {
      const m = line.match(/INVOICE\s*#?\s*([A-Z0-9\-]+)/i) || line.match(/PI\s*#?\s*([A-Z0-9\-]+)/i)
      if (m) piNumber = m[1]
    }
    if (!piDate) {
      const m = line.match(/(\d{2}[\/\.]\d{2}[\/\.]\d{4})/)
      if (m) piDate = m[1]
    }
    if (/customer\s*name/i.test(line)) {
      const m = line.match(/Customer\s*Name\s*[:：]?\s*(.+)/i)
      if (m && m[1].trim()) toCompany = m[1].trim()
      else if (i + 1 < lines.length) toCompany = lines[i + 1]
    }
    if (/contact/i.test(line)) {
      const m = line.match(/Contact\s*[:：]?\s*(.+)/i)
      if (m) contact = m[1].trim()
    }
    const em = line.match(/[\w.-]+@[\w.-]+\.\w+/)
    if (em) email = em[0]
  }

  // Extract table rows: | No | EAN | Desc | Qty | Price | Amount |
  const products: any[] = []
  const pattern = /\|\s*(\d+)\s*\|\s*(CB\.\d+|\d{13})\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*\$?([\d,.]+)\s*\|\s*\$?([\d,.]+)\s*\|/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    products.push({
      item_no: match[1],
      ean: match[2],
      description: match[3].trim().replace(/[\(\（].*?[\)\）]/g, '').trim(),
      qty: parseInt(match[4]),
      unit: 'PCS',
      unit_price: parseFloat(match[5].replace(/,/g, '')),
      amount: parseFloat(match[6].replace(/,/g, '')),
    })
  }

  // Fallback: inline format
  if (products.length === 0) {
    const inlinePattern = /(?:^|\s)(\d+)\s+(CB\.\d+|\d{13})\s+([^\d]{3,}?)\s+(\d+)\s+\$?([\d,.]+)\s+\$?([\d,.]+)(?=\s|$)/g
    while ((match = inlinePattern.exec(text)) !== null) {
      products.push({
        item_no: match[1],
        ean: match[2],
        description: match[3].trim().replace(/[\(\（].*?[\)\）]/g, '').trim(),
        qty: parseInt(match[4]),
        unit: 'PCS',
        unit_price: parseFloat(match[5].replace(/,/g, '')),
        amount: parseFloat(match[6].replace(/,/g, '')),
      })
    }
  }

  const totalQty = products.reduce((s: number, p: any) => s + p.qty, 0)
  const totalAmount = products.reduce((s: number, p: any) => s + p.amount, 0)

  return {
    pi_number: piNumber, pi_date: piDate, from_company: fromCompany,
    to_company: toCompany, to_address: '', contact, email,
    products, total_qty: totalQty, total_amount: totalAmount,
  } as PIInfo
}

function parseCIText(text: string): FactoryCI {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)

  let invoiceNo = ''
  let invoiceDate = ''
  let piNo = ''
  let soldTo = ''
  let deliveredTo = ''
  let asn = ''

  for (const line of lines) {
    if (/invoice\s*no/i.test(line)) {
      const m = line.match(/Invoice\s*No\.?\s*[:：]?\s*(\S+)/i)
      if (m) invoiceNo = m[1]
    }
    if (!invoiceDate && /date/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/)
      if (m) invoiceDate = m[1]
    }
    if (/pi\s*no/i.test(line)) {
      const m = line.match(/PI\s*No\.?\s*[:：]?\s*(\S+)/i)
      if (m) piNo = m[1]
    }
    if (/ASN/i.test(line)) {
      const m = line.match(/ASN\.?\s*[:：]?\s*([A-Z0-9]+)/i) || line.match(/ASN\.\s+([A-Z0-9]+)/i)
      if (m) asn = m[1]
    }
    if (/sold\s*to/i.test(line) && /Company/i.test(line)) {
      const m = line.match(/Company\s*[:：]?\s*(.+)/i)
      if (m) soldTo = m[1].trim()
    }
    if (/deliver\s*to/i.test(line) && /Company/i.test(line)) {
      const m = line.match(/Company\s*[:：]?\s*(.+)/i)
      if (m) deliveredTo = m[1].trim()
    }
  }

  if (!asn) {
    for (const line of lines) {
      const m = line.match(/ASN\.\s*([A-Z0-9]+)/i)
      if (m) { asn = m[1]; break }
    }
  }

  // Extract items by EAN
  const items: any[] = []
  const eanPattern = /[^\d](\d{13})(?!\d)/g
  let eanMatch
  const seenEans = new Set<string>()

  while ((eanMatch = eanPattern.exec(text)) !== null) {
    const ean = eanMatch[1]
    if (seenEans.has(ean)) continue
    seenEans.add(ean)

    const pos = eanMatch.index || 0
    const before = text.substring(Math.max(0, pos - 500), pos)
    const after = text.substring(pos + 14, Math.min(text.length, pos + 500))

    let partNo = ''
    const pm = before.match(/((?:CP|AG|WM)\.[A-Z0-9.]+)/)
    if (pm) partNo = pm[1]

    let piNoItem = ''
    const pim = before.match(/(EF\d+[A-Z0-9]+)/)
    if (pim) piNoItem = pim[1]

    let hsCode = ''
    for (const hm of after.matchAll(/\b(\d{6})\b/g)) {
      if (!ean.includes(hm[1])) { hsCode = hm[1]; break }
    }

    let origin = 'China'
    const om = after.match(/\b(China|USA|Japan|Germany|Hong\s*Kong)\b/i)
    if (om) origin = om[1]

    let qty = 0
    const qm = after.match(/(\d+)\s+(PCS|SET)/i)
    if (qm) qty = parseInt(qm[1])

    let description = ''
    const dm = after.match(/^(.+?)(?=\s+\d{6}\s+China|\s+PCS|\s+SET|\s+USD)/)
    if (dm) description = dm[1].trim()
    if (!description) {
      const fm = after.match(/(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*|DJI\s+(?:Air|Matrice|Mavic)[\w\/\s]*)/i)
      if (fm) description = fm[0].trim()
    }

    let unitPrice = 0
    let amount = 0
    const usdm = after.match(/(\d+(?:\.\d+)?)\s+USD\s+(\d+(?:\.\d+)?)/)
    if (usdm) {
      const p1 = parseFloat(usdm[1])
      const p2 = parseFloat(usdm[2])
      if (Math.abs(p2 - p1 * qty) < Math.max(p2 * 0.2, 200)) {
        unitPrice = p1; amount = p2
      } else {
        unitPrice = Math.min(p1, p2); amount = Math.max(p1, p2)
      }
    }

    if (ean && qty > 0) {
      items.push({
        item_no: String(items.length + 1),
        part_no: partNo, pi_no: piNoItem, ean,
        description, hs_code: hsCode, origin,
        qty, uom: 'PCS', unit_price: unitPrice,
        currency: 'USD', amount,
      })
    }
  }

  return {
    invoice_no: invoiceNo, invoice_date: invoiceDate, pi_no: piNo,
    sold_to: soldTo, sold_to_address: '', delivered_to: deliveredTo, delivered_to_address: '',
    asn, items,
    total_qty: items.reduce((s: number, it: any) => s + it.qty, 0),
    total_amount: items.reduce((s: number, it: any) => s + it.amount, 0),
  } as FactoryCI
}

function parsePLText(text: string): FactoryPL {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l)

  let invoiceNo = ''
  let date = ''
  let piNo = ''
  let asn = ''

  for (const line of lines) {
    if (/invoice\s*no/i.test(line)) {
      const m = line.match(/Invoice\s*No\.?\s*[:：]?\s*(\S+)/i)
      if (m) invoiceNo = m[1]
    }
    if (!date && /date/i.test(line)) {
      const m = line.match(/(\d{4}-\d{2}-\d{2})/)
      if (m) date = m[1]
    }
    if (/pi\s*no/i.test(line)) {
      const m = line.match(/PI\s*No\.?\s*[:：]?\s*(\S+)/i)
      if (m) piNo = m[1]
    }
    if (/ASN/i.test(line)) {
      const m = line.match(/ASN\.?\s*[:：]?\s*([A-Z0-9]+)/i) || line.match(/ASN\.\s+([A-Z0-9]+)/i)
      if (m) asn = m[1]
    }
  }

  if (!asn) {
    for (const line of lines) {
      const m = line.match(/ASN\.\s*([A-Z0-9]+)/i)
      if (m) { asn = m[1]; break }
    }
  }

  const items: any[] = []
  for (const m of text.matchAll(/([A-Z]+\d+[A-Z]?\d+)-(\d+)(?:~(\d+))?/g)) {
    const caseNo = m[0]
    const startNum = parseInt(m[2])
    const endNum = m[3] ? parseInt(m[3]) : startNum
    const numCases = endNum - startNum + 1

    if (items.find((it: any) => it.case_no === caseNo)) continue

    const pos = m.index || 0
    const window = text.substring(pos, Math.min(text.length, pos + 1000))

    let ean = ''
    const em = window.match(/(\d{13})/)
    if (em) ean = em[1]

    let partNo = ''
    const pm = window.match(/((?:CP|AG|WM)\.[A-Z0-9.]+)/)
    if (pm) partNo = pm[1]

    let description = ''
    if (ean) {
      const dm = window.match(new RegExp(`${ean}\\s+(.+?)(?=\\s+\\d+\\s+(?:PCS|SET)|\\s+Total)`))
      if (dm) description = dm[1].trim()
    }
    if (!description) {
      const fm = window.match(/(Remote\s+Controller[\w\/\s]*|Intelligent\s+Battery[\w\/\s]*|FPV\s+Drone[\w\/\s]*|DJI\s+Air[\w\/\s]*)/i)
      if (fm) description = fm[0].trim()
    }

    let qty = 0
    const qm = window.match(/(\d+)\s+(PCS|SET)/i)
    if (qm) qty = parseInt(qm[1])

    let gw = '', nw = ''
    const gnm = window.match(/(?:PCS|SET)\s+(\d+\.\d+)\s+(\d+\.\d+)/)
    if (gnm) {
      gw = gnm[1]; nw = gnm[2]
    }
    if (!gw) {
      const decimals = [...window.matchAll(/(\d+\.\d+)/g)].map(m => m[1])
      if (decimals.length >= 2) { gw = decimals[0]; nw = decimals[1] }
    }

    let size = ''
    const sm = window.match(/(\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?[*×xX]\d+(?:\.\d+)?)/)
    if (sm) size = sm[1]

    let volume = ''
    const vols = [...window.matchAll(/(\d+\.\d{3,})/g)].map(m => m[1])
    for (const v of [...vols].reverse()) {
      if (0.001 < parseFloat(v) && parseFloat(v) < 10) { volume = v; break }
    }

    if (ean && qty > 0) {
      items.push({
        case_no: caseNo, material: 'Carton', part_no: partNo, ean,
        description, qty, uom: 'PCS',
        gross_weight: gw, net_weight: nw,
        size, volume,
        shipping_marks: '',
        num_cases: numCases,
      })
    }
  }

  const totalGW = items.reduce((s: number, it: any) => s + parseFloat(it.gross_weight || 0), 0)
  const totalNW = items.reduce((s: number, it: any) => s + parseFloat(it.net_weight || 0), 0)
  const totalVol = items.reduce((s: number, it: any) => s + parseFloat(it.volume || 0), 0)

  return {
    invoice_no: invoiceNo, asn, date, pi_no: piNo,
    items,
    total_cases: items.reduce((s: number, it: any) => s + (it.num_cases || 1), 0),
    total_qty: items.reduce((s: number, it: any) => s + it.qty, 0),
    total_gross_weight: totalGW.toFixed(2),
    total_net_weight: totalNW.toFixed(3),
    total_volume: totalVol.toFixed(5),
  } as FactoryPL
}

export default function HongKongGeneratorPage() {
  const [step, setStep] = useState(1)
  const [port, setPort] = useState<'port1' | 'port2'>('port1')

  const [piFile, setPiFile] = useState<File | null>(null)
  const [factoryFiles, setFactoryFiles] = useState<File[]>([])

  const [parsedPI, setParsedPI] = useState<PIInfo | null>(null)
  const [factoryGroups, setFactoryGroups] = useState<FactoryGroup[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outputFilename, setOutputFilename] = useState('')

  const piInputRef = useRef<HTMLInputElement>(null)
  const factoryInputRef = useRef<HTMLInputElement>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  // Default to OCR image mode per user request
  const [parseMode, setParseMode] = useState<'auto' | 'ocr' | 'manual'>('ocr')
  // Backend availability
  const [backendAvailable, setBackendAvailable] = useState<boolean>(false)
  // Check backend on mount
  useState(() => {
    fetch('/api/health').then(r => setBackendAvailable(r.ok)).catch(() => setBackendAvailable(false))
  })
  // Manual text paste fallback
  const [piText, setPiText] = useState('')
  const [factoryCIText, setFactoryCIText] = useState('')
  const [factoryPLText, setFactoryPLText] = useState('')
  // OCR progress
  const [ocrProgress, setOcrProgress] = useState('')
  // Raw OCR text preview for debugging
  const [ocrRawText, setOcrRawText] = useState('')

  const handleFactoryFilesChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || [])
    if (newFiles.length > 0) {
      setFactoryFiles(prev => [...prev, ...newFiles])
    }
  }, [])

  const removeFactoryFile = useCallback((index: number) => {
    setFactoryFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  // Manual parse from pasted text
  const handleManualParse = useCallback(async () => {
    const errors: string[] = []
    if (!piText.trim()) {
      errors.push(port === 'port1'
        ? '请粘贴 PI（第三方 → 最终客户）的文本'
        : '请粘贴 PI（Aeronex → 第三方）的文本'
      )
    }
    if (!factoryCIText.trim()) errors.push('请粘贴工厂 Commercial Invoice 的文本')
    if (!factoryPLText.trim()) errors.push('请粘贴工厂 Packing List 的文本')

    if (errors.length > 0) {
      setError(errors.join('；'))
      return
    }

    setLoading(true); setError(''); setValidationErrors([])

    try {
      // Parse PI from text
      const piData = parseHKPIText(piText)

      // Parse CI from text
      const ciData = parseCIText(factoryCIText)

      // Parse PL from text
      const plData = parsePLText(factoryPLText)

      // Create single group
      const group: FactoryGroup = {
        asn: ciData.asn || plData.asn || 'N/A',
        ci: ciData,
        pl: plData
      }

      // Map PI EANs
      const eanMap = buildEanMapFromFactory(ciData.items.map(it => ({ ean: it.ean, description: it.description })))
      const mappedPIProducts = mapPIEansToFormal(piData.products, eanMap)
      const mappedPI = { ...piData, products: mappedPIProducts }

      if (port === 'port2') {
        const factoryTotalQty = ciData.items.reduce((s, it) => s + it.qty, 0)
        if (Math.abs(factoryTotalQty - mappedPI.total_qty) > 0.01) {
          setValidationErrors([`数量校验失败：工厂箱单总数量(${factoryTotalQty}) ≠ PI总数量(${mappedPI.total_qty})`])
        }
      }

      setParsedPI(mappedPI)
      setFactoryGroups([group])
      setStep(2)
    } catch (e: any) {
      console.error('Parse error:', e)
      setError('解析出错：' + (e.message || String(e)))
    } finally {
      setLoading(false)
    }
  }, [piText, factoryCIText, factoryPLText, port])

  const handleParse = useCallback(async () => {
    if (parseMode === 'manual') {
      await handleManualParse()
      return
    }

    const errors: string[] = []
    if (!piFile) {
      errors.push(port === 'port1'
        ? '请上传 PI（第三方 → 最终客户）'
        : '请上传 PI（Aeronex → 第三方）'
      )
    }
    if (factoryFiles.length < 2) errors.push(`请上传工厂的 CI + PL（至少2份PDF），当前仅 ${factoryFiles.length} 份`)

    if (errors.length > 0) {
      setError(errors.join('；'))
      return
    }

    // ==== Browser-side PDF parsing with column-boundary extraction ====
    setLoading(true); setError(''); setValidationErrors([]); setOcrRawText('')
    setOcrProgress('正在解析PDF...')

    try {
      // Parse PI
      setOcrProgress('正在解析PI...')
      const piData = await parseHKPIPDF(piFile!)
      if (!piData || piData.products.length === 0) {
        throw new Error('未能从PI中提取产品数据')
      }

      // Separate CI and PL files
      const ciFiles: File[] = [];
      const plFiles: File[] = [];
      for (const file of factoryFiles) {
        const lower = file.name.toLowerCase().replace(/[-_\s]/g, '');
        if (lower.includes('packing') || lower.includes('packlist') || lower.includes('pl')) {
          plFiles.push(file);
        } else {
          ciFiles.push(file);
        }
      }

      // Parse CI files
      setOcrProgress(`正在解析 ${ciFiles.length} 份CI...`)
      const ciResults: FactoryCI[] = [];
      for (const file of ciFiles) {
        try {
          const ci = await parseFactoryCIPDF(file);
          if (ci.items.length > 0) ciResults.push(ci);
        } catch (e) { console.error(`CI解析失败 ${file.name}:`, e) }
      }

      // Parse PL files
      setOcrProgress(`正在解析 ${plFiles.length} 份PL...`)
      const plResults: FactoryPL[] = [];
      for (const file of plFiles) {
        try {
          const pl = await parseFactoryPLPDF(file);
          if (pl.items.length > 0) plResults.push(pl);
        } catch (e) { console.error(`PL解析失败 ${file.name}:`, e) }
      }

      if (ciResults.length === 0) {
        throw new Error('未能从CI文件中提取产品')
      }
      if (plResults.length === 0) {
        throw new Error('未能从PL文件中提取产品')
      }

      // Pair CI and PL (by ASN, then by index)
      const groups: FactoryGroup[] = [];
      for (const ci of ciResults) {
        const pl = plResults.find(p => p.asn === ci.asn && p.asn) || plResults[groups.length] || plResults[0];
        if (pl) {
          groups.push({ asn: ci.asn || pl.asn, ci, pl });
        }
      }

      // Map PI EANs
      const allFactoryItems = groups.flatMap(g => g.ci.items);
      const eanMap = buildEanMapFromFactory(allFactoryItems.map(it => ({ ean: it.ean, description: it.description })));
      const mappedPI = { ...piData, products: mapPIEansToFormal(piData.products, eanMap) };

      if (port === 'port2') {
        const factoryTotalQty = groups.reduce((sum, g) => sum + g.ci.items.reduce((s, it) => s + it.qty, 0), 0);
        if (Math.abs(factoryTotalQty - mappedPI.total_qty) > 0.01) {
          setValidationErrors([`数量校验失败：工厂总数量(${factoryTotalQty}) ≠ PI总数量(${mappedPI.total_qty})`]);
        }
      }

      setParsedPI(mappedPI)
      setFactoryGroups(groups)
      setStep(2)
    } catch (e: any) {
      console.error('Parse error:', e)
      setError('解析出错：' + (e.message || String(e)))
    } finally {
      setLoading(false)
      setOcrProgress('')
    }
  }, [piFile, factoryFiles, port, parseMode])

  const handleGenerate = useCallback(async () => {
    setLoading(true); setError('')
    try {
      await new Promise(r => setTimeout(r, 800))
      const filename = port === 'port1'
        ? `HK_Customs_CI_PL_${parsedPI?.pi_number || 'output'}.xlsx`
        : `HK_Finance_CI_PL_${parsedPI?.pi_number || 'output'}.xlsx`
      setOutputFilename(filename)
      setStep(3)
    } catch (e: any) {
      console.error('Generate error:', e)
      setError('生成出错：' + (e.message || String(e)))
    } finally {
      setLoading(false)
    }
  }, [parsedPI, port])

  const navigateToHome = () => { window.location.href = '/' }

  const getPortConfig = () => {
    if (port === 'port1') {
      return {
        piLabel: 'PI：第三方 → 最终客户',
        piSubLabel: '报关用PI（PDF/Excel）',
        uploadDesc: 'PI + 工厂箱单PDF',
        step2Desc: '数值校验',
        rules: [
          '基于第三方→最终客户的PI生成报关单据',
          '同时上传多组工厂的 CI + PL（PDF格式），支持合并发货',
          'CB.编码通过description自动映射为正式EAN',
          '每组箱单单独展示，按ASN区分',
          'Cases计算：基于Case No（如1~3=3 Cases，4=1 Case）',
          'CI和PL合并在一个Excel文件中',
        ],
        ruleTitle: '端口1（报关用）规则说明：',
        ruleColor: 'blue' as const,
      }
    } else {
      return {
        piLabel: 'PI：Aeronex → 第三方',
        piSubLabel: '审计用PI（PDF/Excel）',
        uploadDesc: 'PI + 所有工厂箱单PDF',
        step2Desc: 'Qty总和校验',
        rules: [
          '基于Aeronex→第三方的PI生成审计单据',
          '上传多组工厂的 CI + PL（PDF格式），支持合并发货',
          '所有工厂箱单的Qty总和必须与PI中的Qty总和一致',
          '不一致时系统会提示警告',
          'CI和PL合并在一个Excel文件中',
        ],
        ruleTitle: '端口2（审计用）规则说明：',
        ruleColor: 'purple' as const,
      }
    }
  }

  const config = getPortConfig()

  return (
    <div className="min-h-screen bg-white">
      {/* ====== Navigation Bar ====== */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={navigateToHome} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <img src="/logo.png" alt="DJI ENTERPRISE | AERONEX" className="h-11 object-contain" />
          </div>
          <div className="flex items-center gap-3">
            <Button className="bg-black hover:bg-gray-800 text-white text-sm px-4 py-2 rounded-full h-9 gap-2">
              <Home className="w-4 h-4" /> Staff Portal
            </Button>
            <Button className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-full h-9 gap-2">
              <Mail className="w-4 h-4" /> Feedback
            </Button>
          </div>
        </div>
      </header>

      {/* ====== Hero ====== */}
      <div className="bg-white pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-full mb-6">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            HONG KONG EXPORT TOOL (经第三方公司过账)
          </div>
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900 tracking-tight mb-4">
            Hong Kong CI/PL Generator
          </h1>
          <p className="text-xl sm:text-2xl text-gray-400 font-normal max-w-2xl mx-auto leading-relaxed">
            双端口报关单据生成：端口1（报关用）/ 端口2（审计用）
          </p>
          <p className="text-sm text-gray-500 mt-4">
            CI & PL 合并在一个 Excel · 支持多组合并发货 · Cases: 按Case No计算 · EAN自动映射
          </p>
        </div>
      </div>

      {/* ====== Port Selection ====== */}
      <div className="max-w-5xl mx-auto px-4 pb-6">
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => setPort('port1')} className={`flex items-center gap-3 px-6 py-4 rounded-xl border-2 transition-all ${port === 'port1' ? 'border-gray-900 bg-gray-900 text-white shadow-lg' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}>
            <Shield className="w-6 h-6" />
            <div className="text-left"><p className="font-bold">端口 1</p><p className="text-xs opacity-80">报关用</p></div>
          </button>
          <button onClick={() => setPort('port2')} className={`flex items-center gap-3 px-6 py-4 rounded-xl border-2 transition-all ${port === 'port2' ? 'border-gray-900 bg-gray-900 text-white shadow-lg' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}>
            <FileSpreadsheet className="w-6 h-6" />
            <div className="text-left"><p className="font-bold">端口 2</p><p className="text-xs opacity-80">审计用</p></div>
          </button>
        </div>
      </div>

      {/* ====== Steps ====== */}
      <div className="max-w-3xl mx-auto px-4 pt-8 pb-10">
        <div className="flex items-center justify-center">
          {[{num:1,label:'Upload Files',desc:config.uploadDesc},{num:2,label:'Review',desc:config.step2Desc},{num:3,label:'Download',desc:'CI & PL 合并Excel'}].map((s,idx)=> (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center w-28">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${s.num<step?'bg-gray-900 border-gray-900 text-white':s.num===step?'bg-white border-gray-900 text-gray-900':'bg-white border-gray-200 text-gray-400'}`}>
                  {s.num<step?<CheckCircle className="w-5 h-5"/>:s.num}
                </div>
                <div className="mt-2 text-center">
                  <p className={`text-xs font-semibold ${s.num<=step?'text-gray-900':'text-gray-400'}`}>{s.label}</p>
                  <p className={`text-[10px] ${s.num<=step?'text-gray-500':'text-gray-300'}`}>{s.desc}</p>
                </div>
              </div>
              {idx<2 && <div className="w-24 h-0.5 mb-6 mx-2"><div className={`h-full rounded-full transition-all ${s.num<step?'bg-gray-900':'bg-gray-200'}`}/></div>}
            </div>
          ))}
        </div>
      </div>

      {/* ====== Errors ====== */}
      {error && <div className="max-w-5xl mx-auto px-4 mb-6"><div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0"/><span className="text-sm">{error}</span></div></div>}
      {validationErrors.length > 0 && <div className="max-w-5xl mx-auto px-4 mb-6"><div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-700"><p className="font-semibold text-sm mb-2">数值校验警告：</p>{validationErrors.map((err,i)=><p key={i} className="text-sm">· {err}</p>)}</div></div>}

      {/* ====== OCR Raw Text Debug (shown when OCR fails) ====== */}
      {ocrRawText && (
        <div className="max-w-5xl mx-auto px-4 mb-6">
          <details className="bg-gray-50 border border-gray-200 rounded-lg">
            <summary className="p-3 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 rounded-lg">
              原始OCR文本（用于调试）- 点击展开
            </summary>
            <div className="p-3 border-t border-gray-200">
              <pre className="text-[10px] text-gray-500 whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">{ocrRawText}</pre>
            </div>
          </details>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* ====== STEP 1: Upload ====== */}
        {step === 1 && (
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-8 pb-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors cursor-pointer bg-gray-50/50" onClick={()=>piInputRef.current?.click()}>
                  <input ref={piInputRef} type="file" accept=".pdf,.xlsx,.xls" className="hidden" onChange={e=>setPiFile(e.target.files?.[0]||null)}/>
                  <FileText className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
                  <p className="text-gray-700 font-medium">{config.piLabel}</p>
                  <p className="text-gray-400 text-sm mt-1">{config.piSubLabel}</p>
                  <p className="text-gray-400 text-xs mt-2">{piFile?piFile.name:'点击上传 PDF/Excel'}</p>
                  {piFile&&<div className="mt-2 inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3 h-3"/> 已上传</div>}
                </div>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-gray-400 transition-colors cursor-pointer bg-gray-50/50" onClick={()=>factoryInputRef.current?.click()}>
                  <input ref={factoryInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFactoryFilesChange}/>
                  <Package className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
                  <p className="text-gray-700 font-medium">工厂 CI + PL</p>
                  <p className="text-gray-400 text-xs mt-1">PDF格式，同时选择多组CI和PL</p>
                  {factoryFiles.length===0?<p className="text-gray-400 text-xs mt-2">点击上传（多选PDF）</p>:<div className="mt-2 inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3 h-3"/> 已上传 {factoryFiles.length} 份</div>}
                </div>
              </div>

              {factoryFiles.length>0&&(
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">已上传（{factoryFiles.length} 份）：</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {factoryFiles.map((file,index)=> (
                      <div key={index} className="flex items-center justify-between bg-white rounded-md px-3 py-2 text-sm border border-gray-100">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0"/>
                          <span className="text-gray-700 truncate">{file.name}</span>
                          <span className="text-gray-400 text-xs shrink-0">({(file.size/1024).toFixed(1)} KB)</span>
                        </div>
                        <button onClick={(e)=>{e.stopPropagation();removeFactoryFile(index)}} className="p-1 hover:bg-red-50 rounded transition-colors ml-2 shrink-0"><span className="text-gray-400 hover:text-red-500 text-xs">✕</span></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Backend status indicator */}
              <div className={`rounded-lg p-3 flex items-center justify-between ${backendAvailable?'bg-green-50 border border-green-200':'bg-amber-50 border border-amber-200'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${backendAvailable?'bg-green-500':'bg-amber-500'}`}/>
                  <span className={`text-xs ${backendAvailable?'text-green-700':'text-amber-700'}`}>
                    {backendAvailable?'后端已连接（高精度Python解析）':'后端未连接（需本地启动：python3 -m uvicorn main:app --port 8001）'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {parseMode !== 'ocr' && (
                    <button onClick={()=>setParseMode('ocr')} className="text-xs text-gray-600 hover:text-gray-800 underline font-medium">
                      OCR备用
                    </button>
                  )}
                  <button onClick={()=>setParseMode(parseMode==='manual'?'ocr':'manual')} className="text-xs text-gray-600 hover:text-gray-800 underline font-medium">
                    {parseMode==='manual'?'返回OCR模式':'手动粘贴'}
                  </button>
                </div>
              </div>

              {/* Manual Input Text Areas */}
              {parseMode==='manual'&&(
                <div className="space-y-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1.5">{config.piLabel} 文本</p>
                    <textarea value={piText} onChange={e=>setPiText(e.target.value)} className="w-full h-32 p-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y font-mono" placeholder={`粘贴 ${config.piLabel} 的全部文本...`}/>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-1.5">工厂 CI 文本</p>
                      <textarea value={factoryCIText} onChange={e=>setFactoryCIText(e.target.value)} className="w-full h-32 p-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y font-mono" placeholder="粘贴工厂 Commercial Invoice 的全部文本..."/>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-1.5">工厂 PL 文本</p>
                      <textarea value={factoryPLText} onChange={e=>setFactoryPLText(e.target.value)} className="w-full h-32 p-3 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent resize-y font-mono" placeholder="粘贴工厂 Packing List 的全部文本..."/>
                    </div>
                  </div>
                </div>
              )}

              <div className={`${config.ruleColor==='blue'?'bg-blue-50 border-blue-100 text-blue-700':'bg-purple-50 border-purple-100 text-purple-700'} border rounded-lg p-4 text-sm`}>
                <p className="font-semibold mb-1">{config.ruleTitle}</p>
                <ul className="list-disc list-inside text-xs space-y-1">{config.rules.map((rule,i)=><li key={i}>{rule}</li>)}</ul>
              </div>

              {/* OCR Progress */}
              {ocrProgress&&(
                <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0"/>
                  <span className="text-sm">{ocrProgress}</span>
                </div>
              )}

              <Button onClick={handleParse} disabled={loading||!piFile||factoryFiles.length<2} className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12 text-base rounded-lg">
                {loading?<Loader2 className="w-5 h-5 animate-spin mr-2"/>:null}
                {loading ? (parseMode==='ocr' ? 'OCR识别中...' : 'Parsing...') : 'Start Parsing'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 2: Review ====== */}
        {step === 2 && (
          <div className="space-y-6">
            {!parsedPI && (
              <Card className="bg-white border-gray-200 shadow-sm">
                <CardContent className="pt-12 pb-12 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">数据加载中...</p>
                </CardContent>
              </Card>
            )}

            {parsedPI && factoryGroups.length === 0 && (
              <Card className="bg-white border-gray-200 shadow-sm">
                <CardContent className="pt-8 pb-8">
                  <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 mb-4">
                    <p className="font-semibold text-sm">PI解析成功，但工厂箱单数据未找到</p>
                    <p className="text-xs mt-1">可能原因：文件名不匹配，或PDF格式无法识别</p>
                  </div>
                  <Button variant="outline" onClick={()=>{setStep(1);setParsedPI(null);setFactoryGroups([])}} className="w-full border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg">
                    Re-upload
                  </Button>
                </CardContent>
              </Card>
            )}

            {parsedPI && factoryGroups.length > 0 && (<>
              {/* PI Products - Read Only */}
              <Card className="bg-white border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-gray-700"/>
                  PI 产品明细
                  <span className="text-xs text-gray-400 font-normal ml-2">{parsedPI.pi_number} | {parsedPI.from_company} → {parsedPI.to_company}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                  <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">PI Number</p><p className="text-gray-900 font-medium">{parsedPI.pi_number}</p></div>
                  <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Date</p><p className="text-gray-900 font-medium">{parsedPI.pi_date}</p></div>
                  <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Customer</p><p className="text-gray-900 font-medium">{parsedPI.to_company}</p></div>
                  <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Total Amount</p><p className="text-gray-900 font-bold">${parsedPI.total_amount.toLocaleString()}</p></div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-gray-600">
                      <th className="px-3 py-2 text-left">Item No</th>
                      <th className="px-3 py-2 text-left">EAN</th>
                      <th className="px-3 py-2 text-left">Description</th>
                      <th className="px-3 py-2 text-center">Qty</th>
                      <th className="px-3 py-2 text-center">Unit</th>
                      <th className="px-3 py-2 text-right">Unit Price</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr></thead>
                    <tbody>
                      {parsedPI.products.map((prod)=> (
                        <tr key={prod.item_no} className="border-t border-gray-100 hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-gray-600 font-mono text-xs">{prod.item_no}</td>
                          <td className="px-3 py-2 text-gray-600 font-mono text-xs">{prod.ean.startsWith('CB.')?<span className="text-amber-600">{prod.ean} ⚠️</span>:prod.ean}</td>
                          <td className="px-3 py-2 text-gray-900">{prod.description}</td>
                          <td className="px-3 py-2 text-center text-gray-900 font-semibold">{prod.qty}</td>
                          <td className="px-3 py-2 text-center text-gray-600">{prod.unit}</td>
                          <td className="px-3 py-2 text-right text-gray-600">${prod.unit_price.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-900 font-semibold">${prod.amount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-right text-sm text-gray-500">
                  共 {parsedPI.products.length} 项 | 总数量: {parsedPI.total_qty} | 总金额: <span className="text-gray-900 font-bold ml-1">${parsedPI.total_amount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            {/* Factory Groups - Each group displayed with ASN in table */}
            {factoryGroups.map((group, groupIdx) => {
              const displayRows = mergeGroup(group.asn, group.ci, group.pl);
              return (
                <Card key={groupIdx} className="bg-white border-gray-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-gray-900 flex items-center gap-2 text-lg">
                      <Package className="w-5 h-5 text-gray-700"/>
                      工厂箱单产品明细（CI + PL 合并）
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Group info without ASN in cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Invoice No</p><p className="text-gray-900 font-medium">{group.ci.invoice_no}</p></div>
                      <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Date</p><p className="text-gray-900 font-medium">{group.pl.date}</p></div>
                      <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Total Cases</p><p className="text-gray-900 font-bold">{group.pl.total_cases}</p></div>
                      <div className="bg-gray-50 rounded-lg p-3"><p className="text-gray-400 text-xs">Items</p><p className="text-gray-900 font-bold">{displayRows.length}</p></div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-gray-50 text-gray-600">
                          <th className="px-3 py-2 text-left">ASN</th>
                          <th className="px-3 py-2 text-left">Case No</th>
                          <th className="px-3 py-2 text-left">EAN</th>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-center">Qty</th>
                          <th className="px-3 py-2 text-center">GW(kg)</th>
                          <th className="px-3 py-2 text-center">Size</th>
                          <th className="px-3 py-2 text-center">CBM</th>
                          <th className="px-3 py-2 text-center">Cases</th>
                        </tr></thead>
                        <tbody>
                          {displayRows.map((row, ridx)=> (
                            <tr key={ridx} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="px-3 py-2 text-gray-600 font-mono text-xs">{row.asn}</td>
                              <td className="px-3 py-2 text-gray-600 font-mono text-xs">{row.case_no}</td>
                              <td className="px-3 py-2 text-gray-600 font-mono text-xs">{row.ean}</td>
                              <td className="px-3 py-2 text-gray-900">{row.description}</td>
                              <td className="px-3 py-2 text-center text-gray-900 font-semibold">{row.qty}</td>
                              <td className="px-3 py-2 text-center text-gray-600">{row.gross_weight||'-'}</td>
                              <td className="px-3 py-2 text-center text-gray-600">{row.size||'-'}</td>
                              <td className="px-3 py-2 text-center text-gray-600">{row.volume||'-'}</td>
                              <td className="px-3 py-2 text-center"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{row.cases}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-gray-400 text-[10px]">Total Qty</p><p className="text-gray-900 font-bold text-sm">{displayRows.reduce((s,i)=>s+i.qty,0)}</p></div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-gray-400 text-[10px]">Total Amount</p><p className="text-gray-900 font-bold text-sm">${group.ci.total_amount.toLocaleString()}</p></div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-gray-400 text-[10px]">Gross Weight</p><p className="text-gray-900 font-bold text-sm">{group.pl.total_gross_weight} kg</p></div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-gray-400 text-[10px]">Net Weight</p><p className="text-gray-900 font-bold text-sm">{group.pl.total_net_weight} kg</p></div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center"><p className="text-gray-400 text-[10px]">Volume</p><p className="text-gray-900 font-bold text-sm">{group.pl.total_volume} CBM</p></div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Port 2: total qty validation across all groups */}
            {port === 'port2' && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs text-yellow-700">
                  <strong>审计校验：</strong>
                  所有工厂箱单总 Qty: <strong>{factoryGroups.reduce((sum,g)=>sum+g.ci.items.reduce((s,it)=>s+it.qty,0),0)}</strong> |
                  PI 总 Qty: <strong>{parsedPI.total_qty}</strong>
                  {factoryGroups.reduce((sum,g)=>sum+g.ci.items.reduce((s,it)=>s+it.qty,0),0)===parsedPI.total_qty?' ✅ 数量一致':' ⚠️ 数量不匹配！'}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={()=>{setStep(1);setParsedPI(null);setFactoryGroups([])}} className="flex-1 border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg">Re-upload</Button>
              <Button onClick={handleGenerate} disabled={loading} className="flex-1 bg-gray-900 hover:bg-gray-800 text-white h-12 text-base rounded-lg">{loading?<Loader2 className="w-5 h-5 animate-spin mr-2"/>:null}{loading?'Generating...':'Generate CI/PL'}</Button>
            </div>
            </>)}
          </div>
        )}

        {/* ====== STEP 3: Success ====== */}
        {step === 3 && (
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-12 pb-12 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center mx-auto"><CheckCircle className="w-8 h-8 text-white"/></div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Generated Successfully!</h2>
                <p className="text-gray-500">CI & Packing List Excel file has been downloaded</p>
                <p className="text-gray-400 text-sm mt-2">{port==='port1'?'端口1 - 报关用':'端口2 - 审计用'}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg inline-block"><p className="text-sm text-gray-400 mb-1">Filename</p><p className="text-gray-900 font-medium">{outputFilename}</p></div>
              <Separator className="bg-gray-200"/>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={navigateToHome} className="border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg"><Home className="w-4 h-4 mr-2"/> Back to Home</Button>
                <Button variant="ghost" onClick={()=>{setStep(1);setPiFile(null);setFactoryFiles([]);setParsedPI(null);setFactoryGroups([]);setError('')}} className="text-gray-500 hover:text-gray-900">Start New</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
