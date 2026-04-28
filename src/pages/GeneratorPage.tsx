import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Loader2, Upload, FileText, CheckCircle, Download, ChevronRight, ChevronLeft, Package, AlertCircle } from 'lucide-react'

interface Product {
  ean: string
  description: string
  qty: number
  rate: number
  amount: number
}

interface ParsedData {
  session_id: string
  pi_number: string
  pi_date: string
  bill_to_name: string
  final_destination: string
  order_number: string
  consignee: string
  package_summary: string
  products: Product[]
}

export default function GeneratorPage() {
  const [step, setStep] = useState(1)
  const [piFile, setPiFile] = useState<File | null>(null)
  const [arFile, setArFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedData | null>(null)
  const [selectedEans, setSelectedEans] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadFilename, setDownloadFilename] = useState('')
  const piInputRef = useRef<HTMLInputElement>(null)
  const arInputRef = useRef<HTMLInputElement>(null)

  const handleParse = useCallback(async () => {
    if (!piFile || !arFile) {
      setError('请上传PI文件和仓库备货单')
      return
    }
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('pi_file', piFile)
      formData.append('ar_file', arFile)
      const res = await fetch('/api/parse', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('解析失败')
      const data = await res.json()
      setParsed(data)
      setSelectedEans(new Set(data.products.map((p: Product) => p.ean)))
      setStep(2)
    } catch (e: any) {
      setError(e.message || '解析出错')
    } finally {
      setLoading(false)
    }
  }, [piFile, arFile])

  const handleGenerate = useCallback(async () => {
    if (!parsed || selectedEans.size === 0) {
      setError('请至少选择一个产品')
      return
    }
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('session_id', parsed.session_id)
      formData.append('selected_eans', Array.from(selectedEans).join(','))
      const res = await fetch('/api/generate', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('生成失败')
      const data = await res.json()
      setDownloadUrl(data.download_url)
      setDownloadFilename(data.filename)
      setStep(4)
    } catch (e: any) {
      setError(e.message || '生成出错')
    } finally {
      setLoading(false)
    }
  }, [parsed, selectedEans])

  const toggleProduct = (ean: string) => {
    setSelectedEans(prev => {
      const next = new Set(prev)
      if (next.has(ean)) next.delete(ean)
      else next.add(ean)
      return next
    })
  }

  const toggleAll = () => {
    if (!parsed) return
    if (selectedEans.size === parsed.products.length) {
      setSelectedEans(new Set())
    } else {
      setSelectedEans(new Set(parsed.products.map(p => p.ean)))
    }
  }

  const handleDownload = () => {
    if (downloadUrl) {
      window.location.href = downloadUrl
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Saudi CI/PL Generator</h1>
            <p className="text-xs text-slate-400">沙特箱单发票生成器 v2.1</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Steps */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                s === step ? 'bg-emerald-500 text-white' :
                s < step ? 'bg-emerald-500/30 text-emerald-400' :
                'bg-slate-700 text-slate-400'
              }`}>
                {s < step ? <CheckCircle className="w-4 h-4" /> : s}
              </div>
              {s < 4 && <div className={`w-12 h-0.5 ${s < step ? 'bg-emerald-500/50' : 'bg-slate-700'}`} />}
            </div>
          ))}
        </div>

        {/* Step Labels */}
        <div className="flex items-center justify-center gap-8 mb-8 text-xs text-slate-400">
          <span className={step === 1 ? 'text-emerald-400 font-medium' : ''}>上传文件</span>
          <span className={step === 2 ? 'text-emerald-400 font-medium' : ''}>解析预览</span>
          <span className={step === 3 ? 'text-emerald-400 font-medium' : ''}>选择产品</span>
          <span className={step === 4 ? 'text-emerald-400 font-medium' : ''}>生成下载</span>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* ====== STEP 1: Upload ====== */}
        {step === 1 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-400" />
                上传文件
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* PI Upload */}
              <div
                className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-emerald-500/50 transition-colors cursor-pointer bg-slate-800/30"
                onClick={() => piInputRef.current?.click()}
              >
                <input
                  ref={piInputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls"
                  className="hidden"
                  onChange={e => setPiFile(e.target.files?.[0] || null)}
                />
                <FileText className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium">PI订单 (PDF 或 Excel)</p>
                <p className="text-slate-500 text-sm mt-1">{piFile ? piFile.name : '点击或拖拽上传'}</p>
              </div>

              {/* AR Upload */}
              <div
                className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-emerald-500/50 transition-colors cursor-pointer bg-slate-800/30"
                onClick={() => arInputRef.current?.click()}
              >
                <input
                  ref={arInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => setArFile(e.target.files?.[0] || null)}
                />
                <Package className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-300 font-medium">仓库备货单 (Excel)</p>
                <p className="text-slate-500 text-sm mt-1">{arFile ? arFile.name : '点击或拖拽上传'}</p>
              </div>

              <Button
                onClick={handleParse}
                disabled={loading || !piFile || !arFile}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white h-12 text-base"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                {loading ? '解析中...' : '开始解析'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 2: Preview ====== */}
        {step === 2 && parsed && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
                解析预览
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">PI 编号</Label>
                  <p className="text-white font-medium">{parsed.pi_number || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">PI 日期</Label>
                  <p className="text-white font-medium">{parsed.pi_date || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">客户名称</Label>
                  <p className="text-white font-medium">{parsed.bill_to_name || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">目的地</Label>
                  <p className="text-white font-medium">{parsed.final_destination || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">订单号</Label>
                  <p className="text-white font-medium">{parsed.order_number || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg">
                  <Label className="text-slate-400 text-xs">收货人</Label>
                  <p className="text-white font-medium">{parsed.consignee || '-'}</p>
                </div>
                <div className="bg-slate-900/50 p-4 rounded-lg col-span-2">
                  <Label className="text-slate-400 text-xs">包裹信息</Label>
                  <p className="text-white font-medium">{parsed.package_summary || '-'}</p>
                </div>
              </div>

              <Separator className="bg-slate-700" />

              <div className="flex items-center justify-between">
                <p className="text-slate-400 text-sm">共解析 {parsed.products.length} 个产品</p>
                <Button onClick={() => setStep(3)} className="bg-emerald-600 hover:bg-emerald-500">
                  下一步 <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 3: Select Products ====== */}
        {step === 3 && parsed && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-400" />
                选择本次发货产品
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4 p-3 bg-slate-900/50 rounded-lg">
                <Checkbox
                  checked={selectedEans.size === parsed.products.length && parsed.products.length > 0}
                  onCheckedChange={toggleAll}
                />
                <span className="text-sm text-slate-300">
                  全选 ({selectedEans.size}/{parsed.products.length})
                </span>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {parsed.products.map(prod => (
                  <div
                    key={prod.ean}
                    className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                      selectedEans.has(prod.ean)
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-slate-900/30 border-slate-700'
                    }`}
                  >
                    <Checkbox
                      checked={selectedEans.has(prod.ean)}
                      onCheckedChange={() => toggleProduct(prod.ean)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium text-sm truncate">{prod.description}</p>
                      <p className="text-slate-500 text-xs mt-0.5">EAN: {prod.ean}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-emerald-400 font-bold">{prod.qty} x ${prod.rate.toLocaleString()}</p>
                      <p className="text-slate-400 text-xs">=${prod.amount.toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-slate-900/50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">已选 {selectedEans.size} 个产品</span>
                  <span className="text-xl font-bold text-emerald-400">
                    Total: $
                    {parsed.products
                      .filter(p => selectedEans.has(p.ean))
                      .reduce((sum, p) => sum + p.amount, 0)
                      .toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-700">
                  <ChevronLeft className="w-4 h-4 mr-1" /> 上一步
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={loading || selectedEans.size === 0}
                  className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {loading ? '生成中...' : '生成箱单发票'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ====== STEP 4: Download ====== */}
        {step === 4 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">生成成功！</h2>
                <p className="text-slate-400">箱单发票已生成，点击下方按钮下载</p>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-lg inline-block">
                <p className="text-sm text-slate-400 mb-1">文件名</p>
                <p className="text-white font-medium">{downloadFilename}</p>
              </div>

              <div>
                <Button
                  onClick={handleDownload}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-8 h-12 text-base"
                >
                  <Download className="w-5 h-5 mr-2" />
                  下载 Excel
                </Button>
              </div>

              <Separator className="bg-slate-700" />

              <Button variant="ghost" onClick={() => {
                setStep(1)
                setPiFile(null)
                setArFile(null)
                setParsed(null)
                setSelectedEans(new Set())
                setDownloadUrl('')
                setError('')
              }} className="text-slate-400 hover:text-white">
                开始新的生成
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
