import { Routes, Route } from 'react-router'
import HomePage from './pages/HomePage'
import SaudiGenerator from './pages/saudi/GeneratorPage'
import HongKongGenerator from './pages/hongkong/GeneratorPage'
import DubaiGenerator from './pages/dubai/GeneratorPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/saudi" element={<SaudiGenerator />} />
      <Route path="/hongkong" element={<HongKongGenerator />} />
      <Route path="/dubai" element={<DubaiGenerator />} />
    </Routes>
  )
}
