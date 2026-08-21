export type InquiryType = 'recording' | 'onsite' | 'foreign' | 'phone_restore'
export type OrderType = 'reorder' | 'new' | 'company'
export type FileKind = 'field' | 'call'
export type DeliveryMethod = 'pdf' | 'registered'
export type ConsultationStatus = 'draft' | 'completed'

export type WorkRange = {
  start: string
  end: string
}

export interface Consultation {
  id?: number
  customerName: string
  /** Full phone digits, e.g. 01012345678 */
  phone: string
  inquiryType: InquiryType | ''
  orderType: OrderType | ''
  fileKind: FileKind | ''
  fileCount: string
  /** One range per file */
  ranges: WorkRange[]
  /** duration seconds (auto, sum of ranges) */
  durationSeconds: number
  /** estimated KRW (auto) */
  estimatedAmount: number
  deadline: string
  deliveryMethod: DeliveryMethod | ''
  memo: string
  assignee: string
  status: ConsultationStatus
  createdAt: string
  updatedAt: string
}

export const INQUIRY_TYPE_OPTIONS: { value: InquiryType; label: string }[] = [
  { value: 'recording', label: '녹취' },
  { value: 'onsite', label: '출장' },
  { value: 'foreign', label: '외국어' },
  { value: 'phone_restore', label: '폰복원' },
]

export const ORDER_TYPE_OPTIONS: { value: OrderType; label: string }[] = [
  { value: 'reorder', label: '재주문' },
  { value: 'new', label: '신규' },
  { value: 'company', label: '업체' },
]

export const FILE_KIND_OPTIONS: { value: FileKind; label: string }[] = [
  { value: 'field', label: '현장' },
  { value: 'call', label: '통화' },
]

export const DELIVERY_METHOD_OPTIONS: { value: DeliveryMethod; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'registered', label: '등기' },
]

/** Placeholder assignees until staff API is wired */
export const ASSIGNEE_OPTIONS = ['권혁균', '운영팀', '상담팀'] as const

/** 분당 5,000원 (디자인 견적: 18분 30초 → 92,500원) */
export const RATE_PER_MINUTE = 5000

export const MEMO_MAX = 500
export const MAX_FILE_RANGES = 20

export function emptyRange(): WorkRange {
  return { start: '', end: '' }
}

export function parseFileCount(value: string): number {
  const digits = value.replace(/\D/g, '')
  if (!digits) return 1
  const n = Number.parseInt(digits, 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_FILE_RANGES)
}

export function resizeRanges(ranges: WorkRange[], count: number): WorkRange[] {
  const next = ranges.slice(0, count).map((r) => ({
    start: r.start || '',
    end: r.end || '',
  }))
  while (next.length < count) next.push(emptyRange())
  return next
}

export function emptyConsultation(): Omit<Consultation, 'id'> {
  const now = new Date().toISOString()
  return {
    customerName: '',
    phone: '010',
    inquiryType: 'recording',
    orderType: 'new',
    fileKind: 'field',
    fileCount: '1',
    ranges: [emptyRange()],
    durationSeconds: 0,
    estimatedAmount: 0,
    deadline: '',
    deliveryMethod: 'pdf',
    memo: '',
    assignee: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

export function parseClockToSeconds(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':').map((p) => Number(p))
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null
  if (parts.length === 2) {
    const [m, s] = parts
    if (m > 59 || s > 59) return null
    return m * 60 + s
  }
  if (parts.length === 3) {
    const [h, m, s] = parts
    if (m > 59 || s > 59) return null
    return h * 3600 + m * 60 + s
  }
  return null
}

export function formatDurationKo(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}시간 ${m}분 ${s}초`
  if (m > 0) return `${m}분 ${s}초`
  return `${s}초`
}

export function calcDurationSeconds(start: string, end: string): number {
  const a = parseClockToSeconds(start)
  const b = parseClockToSeconds(end)
  if (a == null || b == null || b < a) return 0
  return b - a
}

export function calcRangesDurationSeconds(ranges: WorkRange[]): number {
  return ranges.reduce((sum, range) => sum + calcDurationSeconds(range.start, range.end), 0)
}

export function calcEstimatedAmount(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0
  const minutes = durationSeconds / 60
  return Math.round(minutes * RATE_PER_MINUTE)
}

export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export function phoneSuffix(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('010')) return digits.slice(3)
  return digits
}

export function phoneFromSuffix(suffix: string): string {
  const rest = suffix.replace(/\D/g, '').slice(0, 8)
  return `010${rest}`
}

export function labelOf<T extends string>(
  options: { value: T; label: string }[],
  value: T | '',
): string {
  if (!value) return ''
  return options.find((o) => o.value === value)?.label ?? value
}

/** Normalize legacy single-range rows into ranges[] */
export function normalizeConsultationRanges(
  row: Partial<Consultation> & {
    rangeStart?: string
    rangeEnd?: string
  },
): WorkRange[] {
  if (Array.isArray(row.ranges) && row.ranges.length > 0) {
    return resizeRanges(row.ranges, Math.max(row.ranges.length, parseFileCount(row.fileCount || '')))
  }
  const count = parseFileCount(row.fileCount || '')
  const first = emptyRange()
  if (row.rangeStart || row.rangeEnd) {
    first.start = row.rangeStart || ''
    first.end = row.rangeEnd || ''
  }
  return resizeRanges([first], count)
}
