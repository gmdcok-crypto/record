import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { formatPhone } from '../lib/format'
import {
  FILE_FORMAT_OPTIONS,
  INFLOW_CHANNELS,
  INQUIRY_TYPES,
  PRIORITY_OPTIONS,
  PURPOSES,
  REGIONS,
  WORK_SCOPE_OPTIONS,
  emptyConsultation,
  type Consultation,
} from '../types'
import { Field } from './Field'
import { SegmentedControl } from './SegmentedControl'

type Props = {
  onToast: (message: string) => void
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
      if (row) {
        const { id: _id, ...rest } = row
        setForm(rest)
      }
    })
  }, [editingId])

  const title = useMemo(
    () => (editingId ? '상담 수정' : '전화 고객 등록'),
    [editingId],
  )

  function patch<K extends keyof Consultation>(key: K, value: Consultation[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function validate(): string | null {
    if (!form.customerName.trim()) return '고객 이름을 입력해 주세요.'
    if (form.phone.replace(/\D/g, '').length < 10) {
      return '전화번호를 확인해 주세요.'
    }
    return null
  }

  async function persist() {
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
      phone: formatPhone(form.phone),
      status: 'completed',
      updatedAt: now,
      createdAt: form.createdAt || now,
    }

    try {
      if (editingId) {
        await db.consultations.update(editingId, payload)
        onToast('상담을 저장했습니다.')
        navigate('/')
      } else {
        await db.consultations.add(payload)
        onToast('상담을 저장했습니다.')
        setForm(emptyConsultation())
        setError('')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            Tel<span>Work</span>
          </div>
          <div className="brand-sub">{title}</div>
        </div>
        <Link to="/list" className="icon-btn" aria-label="상담 목록">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      </header>

      <main className="page">
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">고객 정보</h2>
            <span className="section-hint">통화 중 바로 입력</span>
          </div>
          <div className="panel">
            <Field label="고객 이름" required>
              <input
                className="field-control"
                type="text"
                inputMode="text"
                autoComplete="name"
                placeholder="이름을 입력하세요"
                value={form.customerName}
                onChange={(e) => patch('customerName', e.target.value)}
              />
            </Field>
            <Field label="전화번호" required>
              <input
                className="field-control"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="휴대폰 번호 입력"
                value={form.phone}
                onChange={(e) => patch('phone', formatPhone(e.target.value))}
              />
            </Field>
            <Field label="지역">
              <select
                className="field-control"
                value={form.region}
                onChange={(e) => patch('region', e.target.value)}
              >
                <option value="">선택하세요</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="유입경로">
              <select
                className="field-control"
                value={form.inflowChannel}
                onChange={(e) => patch('inflowChannel', e.target.value)}
              >
                <option value="">선택하세요</option>
                {INFLOW_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">의뢰 내용</h2>
            <span className="section-hint">한 손 탭으로 선택</span>
          </div>
          <div className="panel">
            <Field label="문의 유형">
              <select
                className="field-control"
                value={form.inquiryType}
                onChange={(e) => patch('inquiryType', e.target.value)}
              >
                <option value="">선택하세요</option>
                {INQUIRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="제출 목적">
              <select
                className="field-control"
                value={form.purpose}
                onChange={(e) => patch('purpose', e.target.value)}
              >
                <option value="">선택하세요 (예: 법원 / 검찰 / 개인보관)</option>
                {PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="예상 분량 · 녹음시간">
              <input
                className="field-control"
                type="text"
                placeholder="예: 60분 / 약 2시간"
                value={form.estimatedDuration}
                onChange={(e) => patch('estimatedDuration', e.target.value)}
              />
            </Field>
            <Field label="작업 범위">
              <SegmentedControl
                ariaLabel="작업 범위"
                options={WORK_SCOPE_OPTIONS}
                value={form.workScope}
                onChange={(v) => patch('workScope', v)}
              />
            </Field>
            <Field label="파일 형태">
              <SegmentedControl
                ariaLabel="파일 형태"
                options={FILE_FORMAT_OPTIONS}
                value={form.fileFormat}
                onChange={(v) => patch('fileFormat', v)}
              />
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">일정 · 우선도</h2>
          </div>
          <div className="panel">
            <Field label="희망 마감일시">
              <div className="datetime-wrap">
                <input
                  className="field-control"
                  type="datetime-local"
                  value={form.deadline}
                  onChange={(e) => patch('deadline', e.target.value)}
                />
                <span className="cal" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect
                      x="3"
                      y="5"
                      width="18"
                      height="16"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M8 3v4M16 3v4M3 10h18"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </div>
            </Field>
            <Field label="긴급 여부 / 우선도">
              <SegmentedControl
                ariaLabel="우선도"
                options={PRIORITY_OPTIONS}
                value={form.priority}
                onChange={(v) => patch('priority', v)}
                toneMap={{ priority: 'priority', urgent: 'urgent' }}
              />
            </Field>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">상담 메모</h2>
          </div>
          <div className="panel">
            <Field label="상담 내용">
              <textarea
                className="field-control"
                placeholder="상담 내용을 입력하세요"
                value={form.memo}
                onChange={(e) => patch('memo', e.target.value)}
              />
            </Field>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </section>
      </main>

      <div className="action-bar">
        <button
          type="button"
          className="btn btn-solid"
          disabled={saving}
          onClick={() => void persist()}
        >
          저장
        </button>
      </div>
    </div>
  )
}
