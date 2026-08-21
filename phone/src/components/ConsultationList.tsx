import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { liveQuery } from 'dexie'
import { db } from '../db'
import { formatDateTime, formatPhone, relativeShort } from '../lib/format'
import {
  DELIVERY_METHOD_OPTIONS,
  FILE_KIND_OPTIONS,
  INQUIRY_TYPE_OPTIONS,
  ORDER_TYPE_OPTIONS,
  formatDurationKo,
  labelOf,
  type Consultation,
  type ConsultationStatus,
} from '../types'

type Filter = 'all' | 'draft' | 'completed'

const statusLabel: Record<ConsultationStatus, string> = {
  draft: '임시저장',
  completed: '완료',
}

function metaLine(row: Consultation): string[] {
  const bits: string[] = []
  const inquiry = labelOf(INQUIRY_TYPE_OPTIONS, row.inquiryType)
  if (inquiry) bits.push(inquiry)
  const order = labelOf(ORDER_TYPE_OPTIONS, row.orderType)
  if (order) bits.push(order)
  const file = labelOf(FILE_KIND_OPTIONS, row.fileKind)
  if (file) bits.push(file)
  if (row.durationSeconds > 0) bits.push(formatDurationKo(row.durationSeconds))
  if (row.estimatedAmount > 0) bits.push(`약 ${row.estimatedAmount.toLocaleString('ko-KR')}원`)
  const delivery = labelOf(DELIVERY_METHOD_OPTIONS, row.deliveryMethod)
  if (delivery) bits.push(delivery)
  if (row.deadline) bits.push(`마감 ${formatDateTime(row.deadline)}`)
  if (row.assignee) bits.push(row.assignee)
  return bits
}

export function ConsultationList() {
  const [rows, setRows] = useState<Consultation[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    const sub = liveQuery(() =>
      db.consultations.orderBy('updatedAt').reverse().toArray(),
    ).subscribe({
      next: (value) => setRows(value),
      error: () => setRows([]),
    })
    return () => sub.unsubscribe()
  }, [])

  const filtered = useMemo(() => {
    const list = rows ?? []
    if (filter === 'draft') return list.filter((r) => r.status === 'draft')
    if (filter === 'completed') return list.filter((r) => r.status === 'completed')
    return list
  }, [rows, filter])

  const stats = useMemo(() => {
    const list = rows ?? []
    return {
      total: list.length,
      draft: list.filter((r) => r.status === 'draft').length,
      completed: list.filter((r) => r.status === 'completed').length,
    }
  }, [rows])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            Tel<span>Work</span>
          </div>
          <div className="brand-sub">상담 목록</div>
        </div>
        <Link to="/" className="icon-btn" aria-label="상담 등록">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </Link>
      </header>

      <main className="page page-tight">
        <div className="list-hero">
          <h1>저장된 상담</h1>
          <p>등록한 전화 상담을 확인하고 다시 열어 수정할 수 있습니다.</p>
        </div>

        <div className="stats" aria-label="요약">
          <div className="stat">
            <strong>{stats.total}</strong>
            <span>전체</span>
          </div>
          <div className="stat">
            <strong>{stats.draft}</strong>
            <span>임시</span>
          </div>
          <div className="stat">
            <strong>{stats.completed}</strong>
            <span>완료</span>
          </div>
        </div>

        <div className="filters" role="group" aria-label="필터">
          {(
            [
              ['all', '전체'],
              ['draft', '임시저장'],
              ['completed', '완료'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {!rows ? (
          <p className="empty">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <strong>아직 상담이 없습니다</strong>
            등록 화면에서 첫 전화 고객을 저장해 보세요.
          </div>
        ) : (
          <div className="card-list">
            {filtered.map((row) => (
              <Link key={row.id} to={`/consultations/${row.id}`} className="card">
                <div className="card-top">
                  <div>
                    <h2 className="card-name">{row.customerName || '이름 없음'}</h2>
                    <p className="card-phone">
                      {row.phone ? formatPhone(row.phone) : '번호 없음'}
                    </p>
                  </div>
                  <span className={`badge ${row.status}`}>{statusLabel[row.status]}</span>
                </div>
                <div className="card-meta">
                  <span>{relativeShort(row.updatedAt)}</span>
                  {metaLine(row).map((m) => (
                    <span key={m}>· {m}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Link to="/" className="fab">
        + 상담 등록
      </Link>
    </div>
  )
}
