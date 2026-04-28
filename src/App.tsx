import { Routes, Route } from 'react-router'
import GeneratorPage from './pages/GeneratorPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GeneratorPage />} />
    </Routes>
  )
}
