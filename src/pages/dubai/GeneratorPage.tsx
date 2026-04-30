import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ArrowLeft, Home, Construction } from 'lucide-react'

export default function DubaiGeneratorPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => window.location.href = '/'} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <img src="/logo.png" alt="DJI ENTERPRISE | AERONEX" className="h-11 object-contain" />
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-white pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-200 text-gray-700 text-xs font-semibold px-4 py-2 rounded-full mb-6">
            <Construction className="w-3 h-3" />
            COMING SOON
          </div>
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900 tracking-tight mb-4">
            Dubai Warehouse CI/PL
          </h1>
          <p className="text-xl sm:text-2xl text-gray-400 font-normal max-w-2xl mx-auto leading-relaxed">
            迪拜自由区仓库出货单据生成器
          </p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 pb-16">
        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="pt-16 pb-16 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
              <Construction className="w-10 h-10 text-gray-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Under Development</h2>
              <p className="text-gray-500 max-w-md mx-auto">
                迪拜仓库箱单发票生成器正在开发中，将在后续版本上线。
              </p>
              <p className="text-gray-400 text-sm mt-2">
                如有紧急需求，请联系技术团队。
              </p>
            </div>
            <div className="pt-4">
              <Button onClick={() => window.location.href = '/'} variant="outline"
                className="border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg h-11 px-6">
                <Home className="w-4 h-4 mr-2" /> Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
