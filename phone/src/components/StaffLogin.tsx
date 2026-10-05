import { useState, type FormEvent } from 'react'
import { loginStaff, type StaffProfile } from '../lib/auth'

type Props = {
  onSuccess: (staff: StaffProfile) => void
}

export function StaffLogin({ onSuccess }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const staff = await loginStaff(email, password)
      onSuccess(staff)
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell login-shell">
      <main className="login-card">
        <p className="login-eyebrow">TelWork</p>
        <h1 className="login-title">담당자 로그인</h1>
        <p className="login-desc">관리자 계정으로 로그인한 뒤 상담을 등록하세요.</p>

        <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="login-field">
            <span>이메일</span>
            <input
              className="field-control"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@example.com"
            />
          </label>

          <label className="login-field">
            <span>비밀번호</span>
            <input
              className="field-control"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
            />
          </label>

          {error ? <p className="error-text login-error">{error}</p> : null}

          <button type="submit" className="btn btn-solid login-submit" disabled={submitting}>
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </main>
    </div>
  )
}
