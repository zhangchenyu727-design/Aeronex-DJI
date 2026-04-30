import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Plane, FileText, Warehouse } from 'lucide-react'

export default function HomePage() {
  const navigate = useNavigate()

  const systems = [
    {
      id: 'saudi',
      title: 'Saudi CI/PL Generator',
      subtitle: '沙特箱单发票生成器',
      desc: '沙特阿拉伯出口报关单据生成',
      icon: <Plane className="w-8 h-8" />,
      color: 'bg-gray-900 hover:bg-gray-800',
      borderColor: 'border-gray-900',
      status: 'active',
    },
    {
      id: 'hongkong',
      title: 'Hong Kong CI/PL Generator',
      subtitle: '香港箱单发票生成器',
      desc: '香港经第三方过账出口单据生成',
      icon: <FileText className="w-8 h-8" />,
      color: 'bg-gray-700 hover:bg-gray-600',
      borderColor: 'border-gray-700',
      status: 'active',
    },
    {
      id: 'dubai',
      title: 'Dubai Warehouse CI/PL',
      subtitle: '迪拜仓库箱单发票生成器',
      desc: '迪拜自由区仓库出货单据生成（开发中）',
      icon: <Warehouse className="w-8 h-8" />,
      color: 'bg-gray-400 hover:bg-gray-500',
      borderColor: 'border-gray-400',
      status: 'coming',
    },
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center">
            <img src="/logo.png" alt="DJI ENTERPRISE | AERONEX" className="h-11 object-contain" />
          </div>
          <div className="text-sm text-gray-400">AERONEX FZCO Export Document System</div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-white pt-16 pb-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-5xl sm:text-6xl font-black text-gray-900 tracking-tight mb-4">
            Export Document System
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Select your destination to generate compliant export documents
          </p>
        </div>
      </div>

      {/* Three Cards */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {systems.map((sys) => (
            <div
              key={sys.id}
              className={`relative rounded-2xl border-2 ${sys.borderColor} bg-white p-8 transition-all hover:shadow-xl hover:-translate-y-1 ${
                sys.status === 'coming' ? 'opacity-60' : 'cursor-pointer'
              }`}
              onClick={() => {
                if (sys.status === 'active') navigate(`/${sys.id}`)
              }}
            >
              {sys.status === 'coming' && (
                <div className="absolute top-4 right-4 bg-gray-200 text-gray-500 text-xs font-semibold px-3 py-1 rounded-full">
                  Coming Soon
                </div>
              )}
              <div className={`w-16 h-16 rounded-xl ${sys.color} text-white flex items-center justify-center mb-6`}>
                {sys.icon}
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">{sys.title}</h2>
              <p className="text-base text-gray-500 mb-4">{sys.subtitle}</p>
              <p className="text-sm text-gray-400">{sys.desc}</p>
              {sys.status === 'active' && (
                <Button className={`mt-6 w-full ${sys.color} text-white rounded-lg h-12`}>
                  Enter
                </Button>
              )}
              {sys.status === 'coming' && (
                <Button disabled className="mt-6 w-full bg-gray-200 text-gray-400 rounded-lg h-12 cursor-not-allowed">
                  Coming Soon
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
