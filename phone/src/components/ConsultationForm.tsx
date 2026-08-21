import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { lookupCustomerByPhone, syncConsultationToServer, type CustomerLookupResult } from '../lib/api'
import {
  ASSIGNEE_OPTIONS,
  DELIVERY_METHOD_OPTIONS,
  FILE_KIND_OPTIONS,
  INQUIRY_TYPE_OPTIONS,
  MEMO_MAX,
  ORDER_TYPE_OPTIONS,
  calcEstimatedAmount,
  calcRangesDurationSeconds,
  emptyConsultation,
  formatDurationKo,
  formatPhoneDisplay,
  labelOf,
  normalizeConsultationRanges,
  parseFileCount,
  phoneFromSuffix,
  phoneSuffix,
  resizeRanges,
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
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupModal, setLookupModal] = useState<CustomerLookupResult | null>(null)
  const [dealsModal, setDealsModal] = useState<NonNullable<CustomerLookupResult['deals']> | null>(
    null,
  )

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
    })
  }, [editingId])

  const durationSeconds = useMemo(
    () => calcRangesDurationSeconds(form.ranges),
    [form.ranges],
  )
  const estimatedAmount = useMemo(
    () => calcEstimatedAmount(durationSeconds),
    [durationSeconds],
  )

  function patch<K extends keyof Consultation>(key: K, value: Consultation[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function setFileCount(value: string) {
    const count = parseFileCount(value)
    setForm((prev) => ({
      ...prev,
      fileCount: value,
      ranges: resizeRanges(prev.ranges, count),
    }))
    setError('')
  }

  function patchRange(index: number, key: 'start' | 'end', value: string) {
    setForm((prev) => ({
      ...prev,
      ranges: prev.ranges.map((range, i) => (i === index ? { ...range, [key]: value } : range)),
    }))
    setError('')
  }

  function validate(): string | null {
    if (!form.customerName.trim()) return '의뢰인 이름을 입력해 주세요.'
    if (phoneSuffix(form.phone).length < 7) return '전화번호를 확인해 주세요.'
    if (!form.inquiryType) return '문의 유형을 선택해 주세요.'
    return null
  }

  async function lookupPhone() {
    if (phoneSuffix(form.phone).length < 7) {
      setError('전화번호를 확인해 주세요.')
      return
    }
    setLookingUp(true)
    setError('')
    try {
      const result = await lookupCustomerByPhone(form.phone)
      setLookupModal(result)
      if (result.found && result.has_deals && result.deals && result.deals.total_count > 0) {
        setDealsModal(result.deals)
      } else {
        setDealsModal(null)
      }
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : '고객 조회에 실패했습니다.')
    } finally {
      setLookingUp(false)
    }
  }

  function applyExistingCustomer() {
    if (!lookupModal?.member) {
      setLookupModal(null)
      return
    }
    const name = lookupModal.member.name?.trim() || ''
    setForm((prev) => ({
      ...prev,
      customerName: name || prev.customerName,
      orderType: prev.orderType === 'new' ? 'reorder' : prev.orderType || 'reorder',
    }))
    setLookupModal(null)
    onToast('기존 고객 정보를 불러왔습니다.')
  }

  async function persist(status: ConsultationStatus) {
    const message = validate()
    if (message) {
      setError(message)
      return
    }

    setSaving(true)
    const now = new Date().toISOString()
    const ranges = resizeRanges(form.ranges, parseFileCount(form.fileCount))
    const payload: Omit<Consultation, 'id'> = {
      ...form,
      customerName: form.customerName.trim(),
      phone: form.phone.replace(/\D/g, ''),
      fileCount: String(parseFileCount(form.fileCount)),
      ranges,
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

      try {
        if (!editingId) {
          const sync = await syncConsultationToServer({
            customer_name: payload.customerName,
            phone: payload.phone,
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
            auto_register_member: true,
          })
          if (sync.member_created) {
            onToast(
              status === 'draft'
                ? '임시 저장 · 회원 자동가입 완료'
                : '상담 완료 · 회원 자동가입 완료',
            )
          } else if (sync.member) {
            onToast(status === 'draft' ? '임시 저장했습니다. (기존 회원)' : '상담을 완료했습니다. (기존 회원)')
          } else {
            onToast(status === 'draft' ? '임시 저장했습니다.' : '상담을 완료했습니다.')
          }
        } else {
          onToast(status === 'draft' ? '임시 저장했습니다.' : '상담을 완료했습니다.')
        }
      } catch (syncError) {
        console.error(syncError)
        onToast(
          status === 'draft'
            ? '로컬 임시 저장됨 (서버/회원 연동 실패)'
            : '로컬 저장됨 (서버/회원 연동 실패)',
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
              <div className="phone-row phone-row-lookup">
                <input className="field-control phone-prefix" value="010" readOnly tabIndex={-1} />
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

            <Field label="파일 개수" hint="개수만큼 작성 구간이 생깁니다 (최대 20)">
              <input
                className="field-control"
                type="text"
                inputMode="numeric"
                placeholder="예: 3"
                value={form.fileCount}
                onChange={(e) => setFileCount(e.target.value)}
              />
            </Field>

            <Field label="작성 구간">
              <div className="range-list">
                {form.ranges.map((range, index) => {
                  const rangeSeconds = calcRangesDurationSeconds([range])
                  return (
                    <div key={index} className="range-item">
                      <div className="range-item-label">파일 {index + 1}</div>
                      <div className="range-row">
                        <input
                          className="field-control"
                          type="time"
                          step={1}
                          value={range.start}
                          onChange={(e) => patchRange(index, 'start', e.target.value)}
                          aria-label={`파일 ${index + 1} 시작 시각`}
                        />
                        <span className="range-sep">~</span>
                        <input
                          className="field-control"
                          type="time"
                          step={1}
                          value={range.end}
                          onChange={(e) => patchRange(index, 'end', e.target.value)}
                          aria-label={`파일 ${index + 1} 종료 시각`}
                        />
                        <span className="range-icon" aria-hidden>
                          <IconClock />
                        </span>
                      </div>
                      {rangeSeconds > 0 ? (
                        <span className="auto-badge">자동 계산 {formatDurationKo(rangeSeconds)}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {durationSeconds > 0 ? (
                <span className="auto-badge auto-badge-total">
                  합계 {formatDurationKo(durationSeconds)}
                </span>
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

      {lookupModal ? (
        <div className="modal-backdrop" onClick={() => setLookupModal(null)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            {lookupModal.is_new || !lookupModal.found ? (
              <>
                <p className="modal-eyebrow">고객 조회</p>
                <h3 className="modal-title">신규 고객</h3>
                <p className="modal-desc">
                  {formatPhoneDisplay(form.phone)} 번호로 등록된 회원이 없습니다.
                  <br />
                  새 고객으로 상담을 진행하세요.
                </p>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setLookupModal(null)}
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    className="btn btn-solid"
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        orderType: prev.orderType || 'new',
                      }))
                      setLookupModal(null)
                      onToast('신규 고객으로 진행합니다.')
                    }}
                  >
                    신규로 진행
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-eyebrow">기존 고객</p>
                <h3 className="modal-title">{lookupModal.member?.name || '이름 없음'}</h3>
                <div className="modal-info">
                  <div>
                    <span>전화</span>
                    <strong>
                      {formatPhoneDisplay(lookupModal.member?.phone || form.phone)}
                    </strong>
                  </div>
                  {lookupModal.member?.email ? (
                    <div>
                      <span>이메일</span>
                      <strong>{lookupModal.member.email}</strong>
                    </div>
                  ) : null}
                  <div>
                    <span>구분</span>
                    <strong>
                      {lookupModal.member?.from_consultation
                        ? '상담 이력 고객'
                        : '회원 등록 고객'}
                    </strong>
                  </div>
                  {lookupModal.has_deals ? (
                    <div>
                      <span>거래</span>
                      <strong>{lookupModal.deals?.total_count ?? 0}건</strong>
                    </div>
                  ) : null}
                </div>
                {lookupModal.recent_consultations.length > 0 ? (
                  <div className="modal-history">
                    <p className="modal-history-title">최근 상담</p>
                    {lookupModal.recent_consultations.slice(0, 3).map((row) => (
                      <div key={row.id} className="modal-history-item">
                        <strong>
                          {labelOf(INQUIRY_TYPE_OPTIONS, row.inquiry_type as never) ||
                            row.inquiry_type ||
                            '상담'}
                        </strong>
                        <span>
                          {row.created_at || '—'} ·{' '}
                          {row.status === 'draft' ? '임시저장' : '완료'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="modal-actions">
                  {lookupModal.has_deals ? (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setDealsModal(lookupModal.deals ?? null)}
                    >
                      거래정보
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setLookupModal(null)}
                    >
                      닫기
                    </button>
                  )}
                  <button type="button" className="btn btn-solid" onClick={applyExistingCustomer}>
                    정보 불러오기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {dealsModal ? (
        <div className="modal-backdrop" onClick={() => setDealsModal(null)}>
          <div
            className="modal-card modal-card-wide"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="modal-eyebrow">거래정보</p>
            <h3 className="modal-title">거래 {dealsModal.total_count}건</h3>
            <p className="modal-desc">의뢰·결제·전화상담 이력을 확인하세요.</p>

            {dealsModal.jobs.length > 0 ? (
              <div className="modal-history">
                <p className="modal-history-title">의뢰 건 ({dealsModal.jobs.length})</p>
                {dealsModal.jobs.map((job) => (
                  <div key={job.job_id} className="modal-history-item">
                    <strong>{job.title || job.filename || job.job_id}</strong>
                    <span>
                      {job.updated_at || '—'} · {job.status}
                      {job.final_bill_amount > 0
                        ? ` · ${Math.round(job.final_bill_amount).toLocaleString('ko-KR')}원`
                        : ''}
                      {job.payment_status ? ` · ${job.payment_status}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {dealsModal.payments.length > 0 ? (
              <div className="modal-history">
                <p className="modal-history-title">결제 건 ({dealsModal.payments.length})</p>
                {dealsModal.payments.map((pay) => (
                  <div key={pay.id} className="modal-history-item">
                    <strong>{pay.order_name || pay.payment_id}</strong>
                    <span>
                      {pay.paid_at || '—'} · {Math.round(pay.amount).toLocaleString('ko-KR')}원
                      {pay.pay_method ? ` · ${pay.pay_method}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {dealsModal.consultations.length > 0 ? (
              <div className="modal-history">
                <p className="modal-history-title">
                  전화상담 ({dealsModal.consultations.length})
                </p>
                {dealsModal.consultations.map((row) => (
                  <div key={row.id} className="modal-history-item">
                    <strong>
                      {labelOf(INQUIRY_TYPE_OPTIONS, row.inquiry_type as never) ||
                        row.inquiry_type ||
                        '상담'}
                    </strong>
                    <span>
                      {row.created_at || '—'} · {row.status === 'draft' ? '임시저장' : '완료'}
                      {row.estimated_amount > 0
                        ? ` · ${row.estimated_amount.toLocaleString('ko-KR')}원`
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="modal-actions single">
              <button type="button" className="btn btn-solid" onClick={() => setDealsModal(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
