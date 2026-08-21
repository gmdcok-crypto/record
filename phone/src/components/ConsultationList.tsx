import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { liveQuery } from 'dexie'
import { db } from '../db'
import { formatDateTime, relativeShort } from '../lib/format'
import {
  FILE_FORMAT_OPTIONS,
  PRIORITY_OPTIONS,
  WORK_SCOPE_OPTIONS,
  type Consultation,
  type Priority,
} from '../types'

type Filter = 'all' | 'urgent'

const priorityLabel = Object.fromEntries(
  PRIORITY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<Priority, string>

function metaLine(row: Consultation): string[] {
  const bits: string[] = []
  if (row.inquiryType) bits.push(row.inquiryType)
  if (row.purpose) bits.push(row.purpose)
  const scope = WORK_SCOPE_OPTIONS.find((o) => o.value === row.workScope)?.label
  if (scope) bits.push(scope)
  const file = FILE_FORMAT_OPTIONS.find((o) => o.value === row.fileFormat)?.label
  if (file) bits.push(file)
  if (row.deadline) bits.push(`마감 ${formatDateTime(row.deadline)}`)
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
    if (filter === 'urgent') return list.filter((r) => r.priority === 'urgent')
    return list
  }, [rows, filter])

  const stats = useMemo(() => {
    const list = rows ?? []
    return {
      total: list.length,
      urgent: list.filter((r) => r.priority === 'urgent').length,
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

        <div className="stats" aria-label="요약" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat">
            <strong>{stats.total}</strong>
            <span>전체</span>
          </div>
          <div className="stat">
            <strong>{stats.urgent}</strong>
            <span>긴급</span>
          </div>
        </div>

        <div className="filters" role="group" aria-label="필터">
          {(
            [
              ['all', '전체'],
              ['urgent', '긴급'],
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
                    <p className="card-phone">{row.phone || '번호 없음'}</p>
                  </div>
                  <span
                    className={`badge ${
                      row.priority === 'urgent'
                        ? 'urgent'
                        : row.priority === 'priority'
                          ? 'priority'
                          : ''
                    }`}
                  >
                    {priorityLabel[row.priority]}
                  </span>
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
    </div>
  )
}
