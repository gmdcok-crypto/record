import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import {
  ASSIGNEE_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  FILE_KIND_OPTIONS,
  INQUIRY_TYPE_OPTIONS,
  MEMO_MAX,
  ORDER_TYPE_OPTIONS,
  calcDurationSeconds,
  calcEstimatedAmount,
  emptyConsultation,
  formatDurationKo,
  phoneFromSuffix,
  phoneSuffix,
  type Consultation,
  type ConsultationStatus,
} from '../types'
import { ChipGroup, Field } from './Field'

type Props = {
  onToast: (message: string) => void
}

function IconPerson() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 19.5c1.8-3.2 4.2-4.8 7-4.8s5.2 1.6 7 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconDoc() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3.5h7.5L19 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.5V8H19" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function IconCal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3.5v3M16 3.5v3M3.5 10h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconMemo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v14l-3-2-3 2-3-2-3 2-3-2V6A1.5 1.5 0 0 1 6 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8.5 9h7M8.5 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4.5l3 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function ConsultationForm({ onToast }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null
  const [form, setForm] = useState(() => emptyConsultation())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editingId) return
    void db.consultations.get(editingId).then((row) => {
      if (!row) return
      const { id: _id, ...rest } = row
      setForm({ ...emptyConsultation(), ...rest })
    })
  }, [editingId])

  const durationSeconds = useMemo(
    () => calcDurationSeconds(form.rangeStart, form.rangeEnd),
    [form.rangeStart, form.rangeEnd],
  )
  const estimatedAmount = useMemo(
    () => calcEstimatedAmount(durationSeconds),
    [durationSeconds],
  )

  function patch<K extends keyof Consultation>(key: K, value: Consultation[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function validate(): string | null {
    if (!form.customerName.trim()) return '의뢰인 이름을 입력해 주세요.'
    if (phoneSuffix(form.phone).length < 7) return '전화번호를 확인해 주세요.'
    if (!form.inquiryType) return '문의 유형을 선택해 주세요.'
    return null
  }

  async function persist(status: ConsultationStatus) {
    const message = validate()
    if (message) {
      setError(message)
      return
    }

    setSaving(true)
    const now = new Date().toISOString()
    const payload: Omit<Consultation, 'id'> = {
      ...form,
      customerName: form.customerName.trim(),
      phone: form.phone.replace(/\D/g, ''),
      durationSeconds,
      estimatedAmount,
      memo: form.memo.slice(0, MEMO_MAX),
      status,
      updatedAt: now,
      createdAt: form.createdAt || now,
    }

    try {
      if (editingId) {
        await db.consultations.update(editingId, payload)
      } else {
        await db.consultations.add(payload)
      }
      onToast(status === 'draft' ? '임시 저장했습니다.' : '상담을 완료했습니다.')
      navigate('/list')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="form-header">
        <Link to="/list" className="back-btn" aria-label="뒤로">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M15 5 8 12l7 7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <div className="form-header-text">
          <h1>{editingId ? '상담 수정' : '상담 등록'}</h1>
          <p>전화 상담 내용을 빠르게 기록하세요</p>
        </div>
      </header>

      <main className="page">
        <section className="section">
          <div className="section-head">
            <span className="section-icon">
              <IconPerson />
            </span>
            <h2 className="section-title">기본 정보</h2>
          </div>
          <div className="panel">
            <Field label="의뢰인 이름" required>
              <input
                className="field-control"
                type="text"
                autoComplete="name"
                placeholder="이름을 입력하세요"
                value={form.customerName}
                onChange={(e) => patch('customerName', e.target.value)}
              />
            </Field>

            <Field label="전화번호" required hint="010은 자동 입력됩니다">
              <div className="phone-row">
                <input className="field-control phone-prefix" value="010" readOnly tabIndex={-1} />
                <input
                  className="field-control phone-suffix"
                  type="tel"
                  inputMode="numeric"
                  placeholder="뒷번호만 입력"
                  value={phoneSuffix(form.phone)}
                  onChange={(e) => patch('phone', phoneFromSuffix(e.target.value))}
                />
              </div>
            </Field>

            <Field label="문의 유형">
              <ChipGroup
                ariaLabel="문의 유형"
                options={INQUIRY_TYPE_OPTIONS}
                value={form.inquiryType}
                onChange={(v) => patch('inquiryType', v)}
                columns={4}
              />
            </Field>

            <Field label="주문사항">
              <ChipGroup
                ariaLabel="주문사항"
                options={ORDER_TYPE_OPTIONS}
                value={form.orderType}
                onChange={(v) => patch('orderType', v)}
                columns={3}
              />
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-icon">
              <IconDoc />
            </span>
            <h2 className="section-title">파일 정보</h2>
          </div>
          <div className="panel">
            <Field label="파일 종류">
              <ChipGroup
                ariaLabel="파일 종류"
                options={FILE_KIND_OPTIONS}
                value={form.fileKind}
                onChange={(v) => patch('fileKind', v)}
                columns={2}
              />
            </Field>

            <Field label="파일 개수">
              <input
                className="field-control"
                type="text"
                inputMode="numeric"
                placeholder="예: 3개"
                value={form.fileCount}
                onChange={(e) => patch('fileCount', e.target.value)}
              />
            </Field>

            <Field label="작성 구간">
              <div className="range-row">
                <input
                  className="field-control"
                  type="time"
                  step={1}
                  value={form.rangeStart}
                  onChange={(e) => patch('rangeStart', e.target.value)}
                  aria-label="시작 시각"
                />
                <span className="range-sep">~</span>
                <input
                  className="field-control"
                  type="time"
                  step={1}
                  value={form.rangeEnd}
                  onChange={(e) => patch('rangeEnd', e.target.value)}
                  aria-label="종료 시각"
                />
                <span className="range-icon" aria-hidden>
                  <IconClock />
                </span>
              </div>
              {durationSeconds > 0 ? (
                <span className="auto-badge">자동 계산 {formatDurationKo(durationSeconds)}</span>
              ) : null}
            </Field>

            <div className="quote-box">
              <div className="quote-title">예상견적</div>
              <div className="quote-row">
                <span>예상분량</span>
                <strong>{durationSeconds > 0 ? formatDurationKo(durationSeconds) : '—'}</strong>
              </div>
              <div className="quote-row">
                <span>예상금액</span>
                <strong>
                  {estimatedAmount > 0
                    ? `약 ${estimatedAmount.toLocaleString('ko-KR')}원`
                    : '—'}
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-icon">
              <IconCal />
            </span>
            <h2 className="section-title">납기 / 전달</h2>
          </div>
          <div className="panel">
            <Field label="마감일시">
              <div className="datetime-wrap">
                <input
                  className="field-control"
                  type="datetime-local"
                  value={form.deadline}
                  onChange={(e) => patch('deadline', e.target.value)}
                />
                <span className="cal" aria-hidden>
                  <IconCal />
                </span>
              </div>
            </Field>

            <Field label="전달방법">
              <ChipGroup
                ariaLabel="전달방법"
                options={DELIVERY_METHOD_OPTIONS}
                value={form.deliveryMethod}
                onChange={(v) => patch('deliveryMethod', v)}
                columns={2}
              />
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-icon">
              <IconMemo />
            </span>
            <h2 className="section-title">상담 메모</h2>
          </div>
          <div className="panel">
            <Field label="메모">
              <div className="memo-wrap">
                <textarea
                  className="field-control"
                  maxLength={MEMO_MAX}
                  placeholder="인적사항, 지역, 이메일, 요청사항, 제출목적, 유입경로"
                  value={form.memo}
                  onChange={(e) => patch('memo', e.target.value.slice(0, MEMO_MAX))}
                />
                <span className="memo-count">
                  {form.memo.length}/{MEMO_MAX}
                </span>
              </div>
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="section-icon">
              <IconPerson />
            </span>
            <h2 className="section-title">담당</h2>
          </div>
          <div className="panel">
            <Field label="담당자">
              <select
                className="field-control"
                value={form.assignee}
                onChange={(e) => patch('assignee', e.target.value)}
              >
                <option value="">담당자를 선택하세요</option>
                {ASSIGNEE_OPTIONS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </section>
      </main>

      <div className="action-bar dual">
        <button
          type="button"
          className="btn btn-outline"
          disabled={saving}
          onClick={() => void persist('draft')}
        >
          임시 저장
        </button>
        <button
          type="button"
          className="btn btn-solid"
          disabled={saving}
          onClick={() => void persist('completed')}
        >
          상담 완료
        </button>
      </div>
    </div>
  )
}
