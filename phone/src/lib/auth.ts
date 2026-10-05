import { apiUrl } from './api'

const STAFF_TOKEN_KEY = 'telwork_staff_token'
const STAFF_PROFILE_KEY = 'telwork_staff_profile'

export type StaffProfile = {
  id: number
  email: string
  name: string
  role: string
  role_label?: string
  phone?: string | null
  is_active?: boolean
}

function readStoredProfile(): StaffProfile | null {
  try {
    const raw = localStorage.getItem(STAFF_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StaffProfile
    if (!parsed?.id || !parsed?.name) return null
    return parsed
  } catch {
    return null
  }
}

export function getStaffToken(): string | null {
  return localStorage.getItem(STAFF_TOKEN_KEY)
}

export function getStoredStaff(): StaffProfile | null {
  if (!getStaffToken()) return null
  return readStoredProfile()
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_TOKEN_KEY)
  localStorage.removeItem(STAFF_PROFILE_KEY)
}

export async function loginStaff(email: string, password: string): Promise<StaffProfile> {
  const res = await fetch(apiUrl('/api/admin/auth/login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: email.trim(), password }),
  })
  if (!res.ok) {
    let detail = '로그인에 실패했습니다.'
    try {
      const data = (await res.json()) as { detail?: unknown }
      if (typeof data.detail === 'string' && data.detail.trim()) detail = data.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as { access_token: string; admin: StaffProfile }
  localStorage.setItem(STAFF_TOKEN_KEY, data.access_token)
  localStorage.setItem(STAFF_PROFILE_KEY, JSON.stringify(data.admin))
  return data.admin
}

export async function fetchStaffMe(): Promise<StaffProfile | null> {
  const token = getStaffToken()
  if (!token) return null
  try {
    const res = await fetch(apiUrl('/api/admin/auth/me'), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) {
      clearStaffSession()
      return null
    }
    const data = (await res.json()) as { admin: StaffProfile }
    localStorage.setItem(STAFF_PROFILE_KEY, JSON.stringify(data.admin))
    return data.admin
  } catch {
    return readStoredProfile()
  }
}
