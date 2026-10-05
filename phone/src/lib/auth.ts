import { apiUrl } from './api'

const STAFF_TOKEN_KEY = 'telwork_staff_token'
const STAFF_PROFILE_KEY = 'telwork_staff_profile'

export type StaffProfile = {
  id: number
  name: string
  is_active?: boolean
  has_password?: boolean
}

export type StaffAuthCheck = {
  found: boolean
  has_password: boolean
  name: string
  id?: number
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

function persistSession(accessToken: string, staff: StaffProfile): StaffProfile {
  localStorage.setItem(STAFF_TOKEN_KEY, accessToken)
  localStorage.setItem(STAFF_PROFILE_KEY, JSON.stringify(staff))
  return staff
}

async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown }
    if (typeof data.detail === 'string' && data.detail.trim()) return data.detail
  } catch {
    // ignore
  }
  return fallback
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

export async function checkStaffAuth(name: string): Promise<StaffAuthCheck> {
  const res = await fetch(apiUrl('/api/phone-consultations/auth/check'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: name.trim() }),
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, '담당자 확인에 실패했습니다.'))
  }
  return (await res.json()) as StaffAuthCheck
}

export async function registerStaffPassword(name: string, password: string): Promise<StaffProfile> {
  const res = await fetch(apiUrl('/api/phone-consultations/auth/register'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: name.trim(), password }),
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, '비밀번호 등록에 실패했습니다.'))
  }
  const data = (await res.json()) as {
    access_token: string
    staff: StaffProfile
  }
  if (!data.access_token) {
    throw new Error('로그인 토큰을 받지 못했습니다.')
  }
  return persistSession(data.access_token, data.staff)
}

/** Login and persist a permanent TelWork JWT in localStorage. */
export async function loginStaff(name: string, password: string): Promise<StaffProfile> {
  const res = await fetch(apiUrl('/api/phone-consultations/login'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: name.trim(), password }),
  })
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, '로그인에 실패했습니다.'))
  }
  const data = (await res.json()) as {
    access_token: string
    staff: StaffProfile
  }
  if (!data.access_token) {
    throw new Error('로그인 토큰을 받지 못했습니다.')
  }
  return persistSession(data.access_token, data.staff)
}

export async function fetchStaffMe(): Promise<StaffProfile | null> {
  const token = getStaffToken()
  if (!token) return null
  try {
    const res = await fetch(apiUrl('/api/phone-consultations/auth/me'), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) {
      clearStaffSession()
      return null
    }
    const data = (await res.json()) as { staff: StaffProfile }
    localStorage.setItem(STAFF_PROFILE_KEY, JSON.stringify(data.staff))
    return data.staff
  } catch {
    return readStoredProfile()
  }
}
