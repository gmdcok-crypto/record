import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { lookupCustomerByPhone, syncConsultationToServer, updateConsultationOnServer, type CustomerLookupResult } from '../lib/api'
import {
  ASSIGNEE_OPTIONS,
  INQUIRY_TYPE_LABELS,
  INQUIRY_TYPE_OPTIONS,
  MEMO_MAX,
  ORDER_TYPE_OPTIONS,
  SEX_OPTIONS,
  detectPhoneInputMode,
  emptyConsultation,
  formatPhoneDisplay,
  isPhoneComplete,
  labelOf,
  normalizeConsultationRanges,
  normalizeManualPhone,
  parseFileCount,
  phoneFromSuffix,
  phoneSuffix,
  resizeRanges,
  type Consultation,
  type ConsultationStatus,
  type PhoneInputMode,
  type Sex,
} from '../types'
import { ChipGroup, Field } from './Field'

type LookupConsultation = NonNullable<CustomerLookupResult['recent_consultations']>[number]
type HistoryDetail = LookupConsultation

type Props = {
  onToast: (message: string) => void
}

function dateKeyOf(value?: string | null): string {
  if (!value) return ''
  const match = value.match(/(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || ''
}

function consultationDateKey(row: LookupConsultation): string {
  return dateKeyOf(row.completed_date) || dateKeyOf(row.completed_at) || dateKeyOf(row.created_at)
}

function formatDateLabel(key: string): string {
  if (!key) return '—'
  const [y, m, d] = key.split('-')
  if (!y || !m || !d) return key
  return `${y}.${m}.${d}`
}

function formatTimeLabel(value?: string | null): string {
  if (!value) return ''
  const match = value.match(/(\d{2}:\d{2})/)
  return match?.[1] || ''
}

function formatAmountLabel(amount?: number | null): string {
  const value = Number(amount || 0)
  if (!Number.isFinite(value) || value <= 0) return '—'
  return `${Math.round(value).toLocaleString('ko-KR')}`
}

function formatMinutesLabel(durationSeconds?: number | null): string {
  const seconds = Number(durationSeconds || 0)
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const minutes = seconds / 60
  if (Number.isInteger(minutes)) return String(minutes)
  return minutes.toFixed(1).replace(/\.0$/, '')
}

function inquiryLabel(value?: string | null): string {
  if (!value) return '상담'
  return INQUIRY_TYPE_LABELS[value] || labelOf(INQUIRY_TYPE_OPTIONS, value as never) || value
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

export function ConsultationForm({ onToast }: Props) {
  const { id } = useParams()
  const navigate = useNavigate()
  const editingId = id ? Number(id) : null
  const [form, setForm] = useState(() => emptyConsultation())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupResult, setLookupResult] = useState<CustomerLookupResult | null>(null)
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null)
  const [phoneMode, setPhoneMode] = useState<PhoneInputMode>('010')

  useEffect(() => {
    if (!editingId) return
    void db.consultations.get(editingId).then((row) => {
      if (!row) return
      const { id: _id, ...rest } = row
      const ranges = normalizeConsultationRanges(rest)
      setForm({
        ...emptyConsultation(),
        ...rest,
        fileCount: rest.fileCount || String(ranges.length),
        ranges,
      })
      setPhoneMode(detectPhoneInputMode(rest.phone || ''))
    })
  }, [editingId])

  useEffect(() => {
    setLookupResult(null)
    setHistoryDetail(null)
  }, [form.phone])

  function patch<K extends keyof Consultation>(key: K, value: Consultation[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function setPhoneInputMode(mode: PhoneInputMode) {
    setPhoneMode(mode)
    setError('')
    if (mode === '010') {
      const digits = (form.phone || '').replace(/\D/g, '')
      const suffix = digits.startsWith('010') ? digits.slice(3) : digits.replace(/^0+/, '').slice(0, 8)
      patch('phone', phoneFromSuffix(suffix))
      return
    }
    const digits = (form.phone || '').replace(/\D/g, '')
    patch('phone', digits === '010' ? '' : digits)
  }

  function validate(): string | null {
    if (!isPhoneComplete(form.phone)) return '전화번호를 확인해 주세요.'
    if (!form.inquiryType) return '문의 유형을 선택해 주세요.'
    return null
  }

  async function lookupPhone() {
    if (!isPhoneComplete(form.phone)) {
      setError('전화번호를 확인해 주세요.')
      return
    }
    setLookingUp(true)
    setError('')
    try {
      const result = await lookupCustomerByPhone(form.phone)
      setLookupResult(result)
      setHistoryDetail(null)
      if (!result.found || result.is_new) {
        setForm((prev) => ({
          ...prev,
          orderType: prev.orderType || 'new',
        }))
        onToast('신규 고객입니다.')
        return
      }
      const latest = result.recent_consultations[0]
      const sexValue: Sex =
        latest?.sex === 'male' || latest?.sex === 'female' ? latest.sex : 'unknown'
      setForm((prev) => ({
        ...prev,
        customerName: result.member?.name?.trim() || prev.customerName,
        orderType: 'reorder',
        sex: sexValue,
      }))
      onToast('기존 고객입니다. 주문사항을 재주문으로 변경했습니다.')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : '고객 조회에 실패했습니다.')
    } finally {
      setLookingUp(false)
    }
  }

  const historyConsultations = lookupResult?.recent_consultations || []
  const historyByDate = useMemo(() => {
    const map = new Map<string, LookupConsultation[]>()
    for (const row of historyConsultations) {
      const key = consultationDateKey(row) || 'unknown'
      const list = map.get(key) || []
      list.push(row)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ta = a.completed_at || a.created_at || ''
        const tb = b.completed_at || b.created_at || ''
        return ta < tb ? 1 : -1
      })
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === 'unknown') return 1
      if (b[0] === 'unknown') return -1
      return a[0] < b[0] ? 1 : -1
    })
  }, [historyConsultations])

  async function persist(status: ConsultationStatus) {
    const message = validate()
    if (message) {
      setError(message)
      return
    }

    setSaving(true)
    const now = new Date().toISOString()
    const ranges = resizeRanges(form.ranges, parseFileCount(form.fileCount))
    const resolvedName =
      form.customerName.trim() || formatPhoneDisplay(form.phone.replace(/\D/g, '')) || '전화상담'
    const payload: Omit<Consultation, 'id'> = {
      ...form,
      customerName: resolvedName,
      phone: form.phone.replace(/\D/g, ''),
      fileCount: String(parseFileCount(form.fileCount)),
      ranges,
      durationSeconds: 0,
      estimatedAmount: 0,
      deadline: '',
      deliveryMethod: '',
      memo: form.memo.slice(0, MEMO_MAX),
      status,
      serverId: form.serverId,
      updatedAt: now,
      createdAt: form.createdAt || now,
    }

    try {
      let localId: number | null = editingId
      if (editingId) {
        await db.consultations.update(editingId, payload)
      } else {
        localId = (await db.consultations.add(payload)) ?? null
      }

      try {
        const shouldSync = status === 'completed' || !editingId
        if (shouldSync) {
          const syncBody = {
            customer_name: payload.customerName,
            phone: payload.phone,
            sex: payload.sex || 'unknown',
            inquiry_type: payload.inquiryType || '',
            order_type: payload.orderType || '',
            file_kind: payload.fileKind || '',
            file_count: payload.fileCount || '',
            ranges: payload.ranges,
            range_start: payload.ranges[0]?.start || '',
            range_end: payload.ranges[0]?.end || '',
            duration_seconds: payload.durationSeconds || 0,
            estimated_amount: payload.estimatedAmount || 0,
            deadline: payload.deadline || null,
            delivery_method: payload.deliveryMethod || '',
            memo: payload.memo || '',
            assignee: payload.assignee || '',
            status,
            auto_register_member: false,
          }
          const result =
            payload.serverId && status === 'completed'
              ? await updateConsultationOnServer(payload.serverId, syncBody)
              : await syncConsultationToServer(syncBody)
          const serverId = result.consultation?.id || payload.serverId
          if (localId && serverId) {
            await db.consultations.update(localId, { serverId })
          }
        }
        onToast(status === 'draft' ? '임시 저장했습니다.' : '상담을 완료했습니다.')
      } catch (syncError) {
        console.error(syncError)
        onToast(
          status === 'draft'
            ? '로컬 임시 저장됨 (서버 저장 실패)'
            : '로컬 저장됨 (서버 저장 실패)',
        )
      }
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
            <Field label="전화번호" required>
              {phoneMode === '010' ? (
                <div className="phone-row phone-row-lookup">
                  <select
                    className="field-control phone-prefix-select"
                    aria-label="전화번호 입력 방식"
                    value={phoneMode}
                    onChange={(e) => setPhoneInputMode(e.target.value as PhoneInputMode)}
                  >
                    <option value="010">010</option>
                    <option value="manual">직접입력</option>
                  </select>
                  <input
                    className="field-control phone-suffix"
                    type="tel"
                    inputMode="numeric"
                    placeholder="뒷번호만 입력"
                    value={phoneSuffix(form.phone)}
                    onChange={(e) => patch('phone', phoneFromSuffix(e.target.value))}
                  />
                  <button
                    type="button"
                    className="lookup-btn"
                    disabled={lookingUp}
                    onClick={() => void lookupPhone()}
                  >
                    {lookingUp ? '조회중' : '조회'}
                  </button>
                </div>
              ) : (
                <div className="phone-row phone-row-manual">
                  <select
                    className="field-control phone-prefix-select"
                    aria-label="전화번호 입력 방식"
                    value={phoneMode}
                    onChange={(e) => setPhoneInputMode(e.target.value as PhoneInputMode)}
                  >
                    <option value="010">010</option>
                    <option value="manual">직접입력</option>
                  </select>
                  <input
                    className="field-control"
                    type="tel"
                    inputMode="numeric"
                    placeholder="예: 0212345678"
                    value={formatPhoneDisplay(form.phone)}
                    onChange={(e) => patch('phone', normalizeManualPhone(e.target.value))}
                  />
                  <button
                    type="button"
                    className="lookup-btn"
                    disabled={lookingUp}
                    onClick={() => void lookupPhone()}
                  >
                    {lookingUp ? '조회중' : '조회'}
                  </button>
                </div>
              )}
            </Field>

            <Field label="성별">
              <ChipGroup
                ariaLabel="성별"
                options={SEX_OPTIONS}
                value={form.sex}
                onChange={(v) => patch('sex', v)}
                columns={3}
              />
            </Field>

            <Field label="문의 유형">
              <ChipGroup
                ariaLabel="문의 유형"
                options={INQUIRY_TYPE_OPTIONS}
                value={form.inquiryType}
                onChange={(v) => patch('inquiryType', v)}
                columns={3}
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

        {lookupResult ? (
          <section className="section">
            <div className="section-head">
              <span className="section-icon">
                <IconMemo />
              </span>
              <h2 className="section-title">과거 이력</h2>
            </div>
            <div className="panel history-panel">
              {lookupResult.is_new || historyByDate.length === 0 ? (
                <p className="history-empty">조회된 과거 상담 이력이 없습니다.</p>
              ) : (
                <div className="history-table-wrap">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>문의</th>
                        <th>금액</th>
                        <th>분수</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyByDate.map(([dateKey, rows]) => (
                        <Fragment key={dateKey}>
                          {rows.map((row) => (
                            <tr
                              key={row.id}
                              className="history-item-row"
                              role="button"
                              tabIndex={0}
                              aria-label={`${formatDateLabel(consultationDateKey(row))} 상담 상세`}
                              onClick={() => setHistoryDetail(row)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  setHistoryDetail(row)
                                }
                              }}
                            >
                              <td>
                                {dateKey === 'unknown' ? '—' : formatDateLabel(dateKey)}
                              </td>
                              <td>{inquiryLabel(row.inquiry_type)}</td>
                              <td>{formatAmountLabel(row.estimated_amount)}</td>
                              <td>{formatMinutesLabel(row.duration_seconds)}</td>
                              <td>{row.status === 'draft' ? '임시저장' : '완료'}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : null}

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

      {historyDetail ? (
        <div className="modal-backdrop" onClick={() => setHistoryDetail(null)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="modal-eyebrow">상담 상세</p>
            <h3 className="modal-title">{inquiryLabel(historyDetail.inquiry_type)}</h3>
            <div className="modal-info">
              <div>
                <span>날짜</span>
                <strong>
                  {formatDateLabel(consultationDateKey(historyDetail))}
                  {formatTimeLabel(
                    historyDetail.completed_time || historyDetail.completed_at || historyDetail.created_at,
                  )
                    ? ` ${formatTimeLabel(
                        historyDetail.completed_time ||
                          historyDetail.completed_at ||
                          historyDetail.created_at,
                      )}`
                    : ''}
                </strong>
              </div>
              <div>
                <span>성별</span>
                <strong>
                  {labelOf(SEX_OPTIONS, (historyDetail.sex || 'unknown') as never) || '모름'}
                </strong>
              </div>
              <div>
                <span>주문사항</span>
                <strong>
                  {labelOf(ORDER_TYPE_OPTIONS, historyDetail.order_type as never) ||
                    historyDetail.order_type ||
                    '—'}
                </strong>
              </div>
              <div>
                <span>상태</span>
                <strong>{historyDetail.status === 'draft' ? '임시저장' : '완료'}</strong>
              </div>
            </div>
            <div className="modal-memo-block">
              <p className="modal-history-title">상담 메모</p>
              <p className="modal-memo-text">{historyDetail.memo?.trim() || '메모 없음'}</p>
            </div>
            <div className="modal-actions single">
              <button type="button" className="btn btn-solid" onClick={() => setHistoryDetail(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
