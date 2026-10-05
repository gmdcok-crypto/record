import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ConsultationForm } from './components/ConsultationForm'
import { ConsultationList } from './components/ConsultationList'
import { StaffLogin } from './components/StaffLogin'
import {
  clearStaffSession,
  fetchStaffMe,
  getStoredStaff,
  type StaffProfile,
} from './lib/auth'

export default function App() {
  const [toast, setToast] = useState('')
  const [staff, setStaff] = useState<StaffProfile | null>(() => getStoredStaff())
  const [authChecking, setAuthChecking] = useState(true)

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const me = await fetchStaffMe()
      if (!cancelled) {
        setStaff(me)
        setAuthChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function logout() {
    clearStaffSession()
    setStaff(null)
  }

  if (authChecking) {
    return (
      <div className="app-shell login-shell">
        <main className="login-card">
          <p className="login-eyebrow">TelWork</p>
          <h1 className="login-title">확인 중...</h1>
        </main>
      </div>
    )
  }

  if (!staff) {
    return <StaffLogin onSuccess={setStaff} />
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <ConsultationForm onToast={setToast} staff={staff} onLogout={logout} />
          }
        />
        <Route
          path="/list"
          element={<ConsultationList staff={staff} onLogout={logout} />}
        />
        <Route path="/new" element={<Navigate to="/" replace />} />
        <Route
          path="/consultations/:id"
          element={
            <ConsultationForm onToast={setToast} staff={staff} onLogout={logout} />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </>
  )
}
