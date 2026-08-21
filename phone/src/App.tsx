import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ConsultationForm } from './components/ConsultationForm'
import { ConsultationList } from './components/ConsultationList'

export default function App() {
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <>
      <Routes>
        <Route path="/" element={<ConsultationForm onToast={setToast} />} />
        <Route path="/list" element={<ConsultationList />} />
        <Route path="/new" element={<Navigate to="/" replace />} />
        <Route
          path="/consultations/:id"
          element={<ConsultationForm onToast={setToast} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  )
}
