import { useState, type FormEvent } from 'react'
import {
  checkStaffAuth,
  loginStaff,
  registerStaffPassword,
  type StaffProfile,
} from '../lib/auth'

type Props = {
  onSuccess: (staff: StaffProfile) => void
}

type Step = 'name' | 'login' | 'register'

export function StaffLogin({ onSuccess }: Props) {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onCheckName(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await checkStaffAuth(name)
      if (!result.found) {
        setError('등록되지 않은 담당자 이름입니다. 관리자에게 문의해 주세요.')
        return
      }
      setName(result.name || name.trim())
      setPassword('')
      setPasswordConfirm('')
      setStep(result.has_password ? 'login' : 'register')
    } catch (err) {
      setError(err instanceof Error ? err.message : '담당자 확인에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const staff = await loginStaff(name, password)
      onSuccess(staff)
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password !== passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다.')
      return
    }
    setSubmitting(true)
    try {
      const staff = await registerStaffPassword(name, password)
      onSuccess(staff)
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호 등록에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="app-shell login-shell">
      <main className="login-card">
        <p className="login-eyebrow">TelWork</p>
        <h1 className="login-title">
          {step === 'register' ? '비밀번호 최초 등록' : '담당자 로그인'}
        </h1>
        <p className="login-desc">
          {step === 'name'
            ? '관리자에 등록된 담당자 이름을 입력하세요. 처음이면 비밀번호를 직접 생성합니다.'
            : step === 'register'
              ? '최초 1회 비밀번호를 직접 생성하세요. (영문·숫자·특수문자 포함 8~16자)'
              : '등록한 비밀번호로 로그인하세요. JWT가 기기에 저장되어 로그아웃 전까지 유지됩니다.'}
        </p>

        {step === 'name' ? (
          <form className="login-form" onSubmit={(e) => void onCheckName(e)}>
            <label className="login-field">
              <span>이름</span>
              <input
                className="field-control"
                type="text"
                autoComplete="username"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="담당자 이름"
              />
            </label>

            {error ? <p className="error-text login-error">{error}</p> : null}

            <button type="submit" className="btn btn-solid login-submit" disabled={submitting}>
              {submitting ? '확인 중...' : '다음'}
            </button>
          </form>
        ) : null}

        {step === 'login' ? (
          <form className="login-form" onSubmit={(e) => void onLogin(e)}>
            <label className="login-field">
              <span>이름</span>
              <input className="field-control" type="text" value={name} readOnly />
            </label>

            <label className="login-field">
              <span>비밀번호</span>
              <input
                className="field-control"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={16}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
              />
            </label>

            {error ? <p className="error-text login-error">{error}</p> : null}

            <button type="submit" className="btn btn-solid login-submit" disabled={submitting}>
              {submitting ? '로그인 중...' : '로그인'}
            </button>
            <button
              type="button"
              className="btn login-submit"
              disabled={submitting}
              onClick={() => {
                setStep('name')
                setPassword('')
                setError('')
              }}
            >
              이름 다시 입력
            </button>
          </form>
        ) : null}

        {step === 'register' ? (
          <form className="login-form" onSubmit={(e) => void onRegister(e)}>
            <label className="login-field">
              <span>이름</span>
              <input className="field-control" type="text" value={name} readOnly />
            </label>

            <label className="login-field">
              <span>새 비밀번호</span>
              <input
                className="field-control"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={16}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="영문·숫자·특수문자 8~16자"
              />
            </label>

            <label className="login-field">
              <span>비밀번호 확인</span>
              <input
                className="field-control"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={16}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호 다시 입력"
              />
            </label>

            {error ? <p className="error-text login-error">{error}</p> : null}

            <button type="submit" className="btn btn-solid login-submit" disabled={submitting}>
              {submitting ? '등록 중...' : '비밀번호 등록 후 시작'}
            </button>
            <button
              type="button"
              className="btn login-submit"
              disabled={submitting}
              onClick={() => {
                setStep('name')
                setPassword('')
                setPasswordConfirm('')
                setError('')
              }}
            >
              이름 다시 입력
            </button>
          </form>
        ) : null}
      </main>
    </div>
  )
}
