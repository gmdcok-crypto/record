const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''
const RAILWAY_API_BASE = 'https://record-production.up.railway.app'

function resolveApiBase(): string {
  if (API_BASE) return API_BASE
  if (typeof window === 'undefined') return RAILWAY_API_BASE
  const host = window.location.hostname
  if (
    host.endsWith('.netlify.app') ||
    host.endsWith('.github.io') ||
    host === 'bulpen.co.kr' ||
    host.endsWith('.bulpen.co.kr')
  ) {
    // Same-origin so Netlify /api/* proxy is used.
    return window.location.origin
  }
  return RAILWAY_API_BASE
}

function apiUrl(path: string, query?: Record<string, string>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const base = resolveApiBase().replace(/\/$/, '')
  const url = base
    ? new URL(`${base}${normalizedPath}`)
    : new URL(normalizedPath, typeof window !== 'undefined' ? window.location.origin : RAILWAY_API_BASE)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

export type SyncConsultationPayload = {
  customer_name: string
  phone: string
  inquiry_type: string
  order_type: string
  file_kind: string
  file_count: string
  ranges?: Array<{ start: string; end: string }>
  range_start: string
  range_end: string
  duration_seconds: number
  estimated_amount: number
  deadline: string | null
  delivery_method: string
  memo: string
  assignee: string
  status: 'draft' | 'completed'
  auto_register_member?: boolean
}

export type SyncConsultationResult = {
  consultation?: { id: number }
  member?: { id: number; name: string; phone: string | null; email: string } | null
  member_created?: boolean
  member_error?: string | null
}

export type CustomerLookupResult = {
  found: boolean
  is_new: boolean
  member: {
    id: number | null
    email: string | null
    name: string
    phone: string | null
    is_active?: boolean
    created_at?: string | null
    from_consultation?: boolean
  } | null
  recent_consultations: Array<{
    id: number
    customer_name: string
    inquiry_type: string
    order_type: string
    status: string
    created_at: string | null
    estimated_amount: number
  }>
  has_deals?: boolean
  deals?: {
    jobs: Array<{
      job_id: string
      title: string
      filename: string
      status: string
      payment_status: string
      final_bill_amount: number
      updated_at: string | null
    }>
    payments: Array<{
      id: number
      payment_id: string
      order_name: string
      amount: number
      pay_method: string
      paid_at: string | null
      status: string
    }>
    consultations: Array<{
      id: number
      title: string
      inquiry_type: string
      order_type: string
      status: string
      estimated_amount: number
      created_at: string | null
    }>
    total_count: number
  }
}

export async function syncConsultationToServer(
  payload: SyncConsultationPayload,
): Promise<SyncConsultationResult> {
  const res = await fetch(apiUrl('/api/phone-consultations'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let detail = '서버 저장에 실패했습니다.'
    try {
      const data = (await res.json()) as { detail?: unknown }
      if (typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return (await res.json()) as SyncConsultationResult
}

export async function lookupCustomerByPhone(phone: string): Promise<CustomerLookupResult> {
  const res = await fetch(
    apiUrl('/api/phone-consultations/lookup', { phone: phone.replace(/\D/g, '') }),
    {
      headers: { Accept: 'application/json' },
    },
  )
  if (!res.ok) {
    let detail = '고객 조회에 실패했습니다.'
    try {
      const data = (await res.json()) as { detail?: unknown }
      if (typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return (await res.json()) as CustomerLookupResult
}
