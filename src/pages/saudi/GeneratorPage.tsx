import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Loader2, FileText, CheckCircle, Package, AlertCircle, Mail, Home } from 'lucide-react'
import { parsePIPDF, parsePIExcel, parseARExcel } from './lib/parser'
import { loadEanMap, loadHsCodeMap, loadTemplateBuffer } from './lib/dataLoader'
import { buildCombined } from './lib/builder'
import { mapCbToEan, summarizePackages } from './lib/utils'
import type { ParsedPI, ParsedAR, ARItem } from './lib/utils'

export default function GeneratorPage() {
  const [step, setStep] = useState(1)
  const [piFile, setPiFile] = useState<File | null>(null)
  const [arFile, setArFile] = useState<File | null>(null)
  const [parsedPI, setParsedPI] = useState<ParsedPI | null>(null)
  const [parsedAR, setParsedAR] = useState<ParsedAR | null>(null)
  const [selectedEans, setSelectedEans] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outputFilename, setOutputFilename] = useState('')
  const piInputRef = useRef<HTMLInputElement>(null)
  const arInputRef = useRef<HTMLInputElement>(null)

  const handleParse = useCallback(async () => {
    if (!piFile || !arFile) { setError('请上传PI文件和仓库备货单'); return }
    setLoading(true); setError('')
    try {
      let piData: ParsedPI
      if (piFile.name.toLowerCase().endsWith('.pdf')) piData = await parsePIPDF(piFile)
      else piData = await parsePIExcel(piFile)
      const arData = await parseARExcel(arFile)
      const eanMap = await loadEanMap()

      for (const prod of piData.products) {
        if (prod.ean.startsWith('CB.')) { prod.ean = mapCbToEan(prod.ean, prod.description, eanMap) }
      }
      piData.products = piData.products.filter(p => !p.ean.startsWith('CB.'))

      const arEans = new Set(arData.items.map(it => it.item_code))
      for (const prod of piData.products) {
        if (prod.ean && !arEans.has(prod.ean)) {
          const descPi = prod.description.toLowerCase()
          for (const eanAr of arEans) {
            const descAr = (eanMap[eanAr] || '').toLowerCase()
            const piCore = descPi.replace(/\s*(with|w\/)\s+.*/i, '').replace(/\s*\(.*?\)$/, '').trim()
            const arCore = descAr.replace(/\s*\(.*?\)$/, '').trim()
            if (piCore && arCore && (piCore.includes(arCore) || arCore.includes(piCore))) { prod.ean = eanAr; break }
          }
        }
      }
      setParsedPI(piData); setParsedAR(arData)
      setSelectedEans(new Set(piData.products.map(p => p.ean)))
      setStep(2)
    } catch (e: any) { console.error('Parse error:', e); setError('解析出错：' + (e.message || String(e))) }
    finally { setLoading(false) }
  }, [piFile, arFile])

  const handleGenerate = useCallback(async () => {
    if (!parsedPI || !parsedAR || selectedEans.size === 0) { setError('请至少选择一个产品'); return }
    setLoading(true); setError('')
    try {
      const eanMap = await loadEanMap()
      const hsMap = await loadHsCodeMap()
      const templateBuffer = await loadTemplateBuffer()

      const selectedProducts = parsedPI.products.filter(p => selectedEans.has(p.ean))
      const filteredArItems: ARItem[] = []
      for (const sel of selectedProducts) {
        const matching = parsedAR.items.filter(it => it.item_code === sel.ean)
        let currentQty = 0; const targetQty = sel.qty
        for (const item of matching) {
          if (currentQty >= targetQty) break
          const itemQty = parseInt(item.qty) || 1
          const remaining = targetQty - currentQty
          if (itemQty > remaining) { filteredArItems.push({ ...item, qty: String(remaining) }); currentQty = targetQty }
          else { filteredArItems.push(item); currentQty += itemQty }
        }
      }

      const eanGroups: Record<string, ARItem[]> = {}
      for (const item of filteredArItems) { if (!eanGroups[item.item_code]) eanGroups[item.item_code] = []; eanGroups[item.item_code].push(item) }
      const invoiceProducts = Object.entries(eanGroups).map(([ean, items]) => {
        const totalQty = items.reduce((sum, i) => sum + (parseInt(i.qty) || 1), 0)
        const piProd = parsedPI.products.find(p => p.ean === ean)
        const rate = piProd?.rate || 0
        const desc = items[0]?.description || piProd?.description || eanMap[ean] || ''
        return { ean, description: desc, qty: totalQty, rate, amount: totalQty * rate, hs_code: hsMap[ean] || '', pi_number: parsedPI.pi_number || '' }
      })

      const plItems = filteredArItems.map(item => {
        const ean = item.item_code
        const piProd = parsedPI.products.find(p => p.ean === ean)
        const desc = item.description || piProd?.description || eanMap[ean] || ''
        return { ean, description: desc, qty: parseInt(item.qty) || 1, weight: item.weight, dimension: item.dimension, pkgs: item.pkgs, hs_code: hsMap[ean] || '', pi_number: parsedPI.pi_number || '' }
      })

      const packageSummary = summarizePackages(filteredArItems)
      const wb = await buildCombined(templateBuffer, parsedPI, parsedAR, invoiceProducts, plItems, packageSummary)
      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      const filename = `CI PL - ${parsedAR.order_number || 'output'}.xlsx`
      a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      setOutputFilename(filename); setStep(3)
    } catch (e: any) { console.error('Generate error:', e); setError('生成出错：' + (e.message || String(e))) }
    finally { setLoading(false) }
  }, [parsedPI, parsedAR, selectedEans])

  const toggleProduct = (ean: string) => {
    setSelectedEans(prev => { const next = new Set(prev); next.has(ean) ? next.delete(ean) : next.add(ean); return next })
  }
  const toggleAll = () => {
    if (!parsedPI) return
    selectedEans.size === parsedPI.products.length ? setSelectedEans(new Set()) : setSelectedEans(new Set(parsedPI.products.map(p => p.ean)))
  }
  const totalAmount = parsedPI?.products.filter(p => selectedEans.has(p.ean)).reduce((sum, p) => sum + p.amount, 0) || 0

  return (
    <div className="min-h-screen bg-white">
      {/* ====== Navigation Bar (like gensparkspace.com) ====== */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Brand Logo - Original DJI ENTERPRISE | AERONEX */}
          <img src="/logo.png" alt="DJI ENTERPRISE | AERONEX" className="h-11 object-contain" />
          {/* Right: Action Buttons */}
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

      {/* ====== Hero Section (like gensparkspace.com) ====== */}
      <div className="bg-white pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          {/* Green pill label */}
          <div className="inline-flex items-center gap-2 bg-gray-900 text-white text-xs font-semibold px-4 py-2 rounded-full mb-6">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            SAUDI ARABIA EXPORT TOOL
          </div>
          {/* Main title - large black bold */}
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900 tracking-tight mb-4">
            Saudi CI/PL Generator
          </h1>
          {/* Subtitle - gray lighter weight */}
          <p className="text-xl sm:text-2xl text-gray-400 font-normal max-w-2xl mx-auto leading-relaxed">
            Automated Commercial Invoice & Packing List generation for Saudi Arabia exports
          </p>
        </div>
      </div>

      {/* ====== Steps ====== */}
      <div className="max-w-3xl mx-auto px-4 pt-8 pb-10">
        <div className="flex items-center justify-center">
          {[
            { num: 1, label: 'Upload Files', desc: 'PI & AR Sheet' },
            { num: 2, label: 'Review & Select', desc: 'Choose products' },
            { num: 3, label: 'Download', desc: 'Get CI & PL' }
          ].map((s, idx) => (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center w-24">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  s.num < step
                    ? 'bg-gray-900 border-gray-900 text-white'
                    : s.num === step
                      ? 'bg-white border-gray-900 text-gray-900'
                      : 'bg-white border-gray-200 text-gray-400'
                }`}>
                  {s.num < step ? <CheckCircle className="w-5 h-5" /> : s.num}
                </div>
                <div className="mt-2 text-center">
                  <p className={`text-xs font-semibold ${s.num <= step ? 'text-gray-900' : 'text-gray-400'}`}>{s.label}</p>
                  <p className={`text-[10px] ${s.num <= step ? 'text-gray-500' : 'text-gray-300'}`}>{s.desc}</p>
                </div>
              </div>
              {idx < 2 && (
                <div className="w-24 h-0.5 mb-6 mx-2">
                  <div className={`h-full rounded-full transition-all ${s.num < step ? 'bg-gray-900' : 'bg-gray-200'}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ====== Error ====== */}
      {error && (
        <div className="max-w-5xl mx-auto px-4 mb-6">
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-600 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 pb-16">
        {/* ====== STEP 1: Upload ====== */}
        {step === 1 && (
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-8 pb-8 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors cursor-pointer bg-gray-50/50"
                  onClick={() => piInputRef.current?.click()}>
                  <input ref={piInputRef} type="file" accept=".pdf,.xlsx,.xls" className="hidden"
                    onChange={e => setPiFile(e.target.files?.[0] || null)} />
                  <FileText className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-700 font-medium">PI Order (PDF or Excel)</p>
                  <p className="text-gray-400 text-sm mt-1">{piFile ? piFile.name : 'Click or drag to upload'}</p>
                </div>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-gray-400 transition-colors cursor-pointer bg-gray-50/50"
                  onClick={() => arInputRef.current?.click()}>
                  <input ref={arInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => setArFile(e.target.files?.[0] || null)} />
                  <Package className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-700 font-medium">Warehouse Pick Sheet (Excel)</p>
                  <p className="text-gray-400 text-sm mt-1">{arFile ? arFile.name : 'Click or drag to upload'}</p>
                </div>
              </div>
              <Button onClick={handleParse} disabled={loading || !piFile || !arFile}
                className="w-full bg-gray-900 hover:bg-gray-800 text-white h-12 text-base rounded-lg">
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                {loading ? 'Parsing...' : 'Start Parsing'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 2: Preview Tables ====== */}
        {step === 2 && parsedPI && parsedAR && (
          <div className="space-y-6">
            {/* PI Products Table */}
            <Card className="bg-white border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 flex items-center gap-2 text-lg">
                  <FileText className="w-5 h-5 text-gray-700" />
                  PI Products
                  <span className="text-xs text-gray-400 font-normal ml-2">
                    No.: {parsedPI.pi_number || '-'} | Customer: {parsedPI.bill_to_name || '-'} | Destination: {parsedPI.final_destination || '-'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 mb-3">
                  <Checkbox checked={selectedEans.size === parsedPI.products.length && parsedPI.products.length > 0}
                    onCheckedChange={toggleAll} />
                  <span className="text-sm text-gray-600">Select All ({selectedEans.size}/{parsedPI.products.length})</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="px-3 py-2 text-left w-10">Select</th>
                        <th className="px-3 py-2 text-left">EAN</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-right">Rate (USD)</th>
                        <th className="px-3 py-2 text-right">Amount (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedPI.products.map((prod, idx) => {
                        const arMatch = parsedAR.items.find(it => it.item_code === prod.ean)
                        const displayDesc = arMatch?.description || prod.description
                        return (
                          <tr key={prod.ean + idx}
                            className={`border-t border-gray-100 transition-colors ${selectedEans.has(prod.ean) ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}>
                            <td className="px-3 py-2">
                              <Checkbox checked={selectedEans.has(prod.ean)} onCheckedChange={() => toggleProduct(prod.ean)} />
                            </td>
                            <td className="px-3 py-2 text-gray-600 font-mono text-xs">{prod.ean}</td>
                            <td className="px-3 py-2 text-gray-900">{displayDesc}</td>
                            <td className="px-3 py-2 text-center text-gray-900 font-semibold">{prod.qty}</td>
                            <td className="px-3 py-2 text-right text-gray-600">${prod.rate.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-gray-900 font-semibold">${prod.amount.toLocaleString()}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-right text-sm text-gray-500">
                  Selected: {selectedEans.size} products | Total: <span className="text-gray-900 font-bold">${totalAmount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            {/* AR Warehouse Table */}
            <Card className="bg-white border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-gray-900 flex items-center gap-2 text-lg">
                  <Package className="w-5 h-5 text-gray-700" />
                  Warehouse Pick Sheet
                  <span className="text-xs text-gray-400 font-normal ml-2">
                    Order: {parsedAR.order_number || '-'} | Consignee: {parsedAR.consignee || '-'} | Packages: {summarizePackages(parsedAR.items) || '-'}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="px-3 py-2 text-left">Item Code</th>
                        <th className="px-3 py-2 text-left">Description</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-center">PKGS</th>
                        <th className="px-3 py-2 text-center">Weight</th>
                        <th className="px-3 py-2 text-center">Dimension</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const groups: Array<{ start: number; count: number; pkgs: string; weight: string; dimension: string }> = []
                        let currentPkg = '', startIdx = 0
                        parsedAR.items.forEach((item, idx) => {
                          if (item.pkgs !== currentPkg) {
                            if (currentPkg) groups.push({ start: startIdx, count: idx - startIdx, pkgs: currentPkg, weight: parsedAR.items[startIdx].weight, dimension: parsedAR.items[startIdx].dimension })
                            currentPkg = item.pkgs; startIdx = idx
                          }
                          if (idx === parsedAR.items.length - 1) groups.push({ start: startIdx, count: idx - startIdx + 1, pkgs: currentPkg, weight: parsedAR.items[startIdx].weight, dimension: parsedAR.items[startIdx].dimension })
                        })
                        return parsedAR.items.map((item, idx) => {
                          const group = groups.find(g => g.start === idx)
                          return (
                            <tr key={idx} className="border-t border-gray-100 hover:bg-gray-50/50">
                              <td className="px-3 py-2 text-gray-600 font-mono text-xs">{item.item_code}</td>
                              <td className="px-3 py-2 text-gray-900">{item.description}</td>
                              <td className="px-3 py-2 text-center text-gray-900 font-semibold">{item.qty}</td>
                              {group ? (
                                <>
                                  <td className="px-3 py-2 text-center text-amber-600 font-semibold border-l border-gray-200" rowSpan={group.count}>{group.pkgs}</td>
                                  <td className="px-3 py-2 text-center text-gray-600 border-l border-gray-200" rowSpan={group.count}>{group.weight}</td>
                                  <td className="px-3 py-2 text-center text-gray-600 border-l border-gray-200" rowSpan={group.count}>{group.dimension}</td>
                                </>
                              ) : null}
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setStep(1); setParsedPI(null); setParsedAR(null); setSelectedEans(new Set()) }}
                className="flex-1 border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg">
                Re-upload
              </Button>
              <Button onClick={handleGenerate} disabled={loading || selectedEans.size === 0}
                className="flex-1 bg-gray-900 hover:bg-gray-800 text-white h-12 text-base rounded-lg">
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                {loading ? 'Generating...' : 'Generate CI/PL'}
              </Button>
            </div>
          </div>
        )}

        {/* ====== STEP 3: Success ====== */}
        {step === 3 && (
          <Card className="bg-white border-gray-200 shadow-sm">
            <CardContent className="pt-12 pb-12 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-gray-900 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Generated Successfully!</h2>
                <p className="text-gray-500">CI & Packing List Excel file has been downloaded</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg inline-block">
                <p className="text-sm text-gray-400 mb-1">Filename</p>
                <p className="text-gray-900 font-medium">{outputFilename}</p>
              </div>
              <Separator className="bg-gray-200" />
              <Button variant="ghost" onClick={() => {
                setStep(1); setPiFile(null); setArFile(null); setParsedPI(null); setParsedAR(null)
                setSelectedEans(new Set()); setError('')
              }} className="text-gray-500 hover:text-gray-900">
                Start New
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
