export type WorkScope = 'full' | 'partial' | 'undecided'
export type FileFormat = 'audio' | 'video' | 'document'
export type Priority = 'normal' | 'priority' | 'urgent'
export type ConsultationStatus = 'draft' | 'completed'

export interface Consultation {
  id?: number
  customerName: string
  phone: string
  inquiryType: string
  purpose: string
  estimatedDuration: string
  workScope: WorkScope
  region: string
  deadline: string
  fileFormat: FileFormat
  inflowChannel: string
  priority: Priority
  memo: string
  status: ConsultationStatus
  createdAt: string
  updatedAt: string
}

export const INQUIRY_TYPES = [
  '녹취록 작성',
  '속기·타이핑',
  '번역·통역',
  '증거자료 정리',
  '기타',
] as const

export const PURPOSES = [
  '법원',
  '검찰',
  '경찰',
  '개인보관',
  '기업·내부',
  '기타',
] as const

export const REGIONS = [
  '서울',
  '경기',
  '인천',
  '부산',
  '대구',
  '광주',
  '대전',
  '울산',
  '세종',
  '강원',
  '충북',
  '충남',
  '전북',
  '전남',
  '경북',
  '경남',
  '제주',
  '기타',
] as const

export const INFLOW_CHANNELS = [
  '전화 인입',
  '네이버',
  '카카오톡',
  '지인 소개',
  '기존 고객',
  '기타',
] as const

export const WORK_SCOPE_OPTIONS: { value: WorkScope; label: string }[] = [
  { value: 'full', label: '전체 녹취' },
  { value: 'partial', label: '일부 구간' },
  { value: 'undecided', label: '미정' },
]

export const FILE_FORMAT_OPTIONS: { value: FileFormat; label: string }[] = [
  { value: 'audio', label: '음성' },
  { value: 'video', label: '영상' },
  { value: 'document', label: '문서첨부' },
]

export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'normal', label: '일반' },
  { value: 'priority', label: '우선' },
  { value: 'urgent', label: '긴급' },
]

export function emptyConsultation(): Omit<Consultation, 'id'> {
  const now = new Date().toISOString()
  return {
    customerName: '',
    phone: '',
    inquiryType: '',
    purpose: '',
    estimatedDuration: '',
    workScope: 'undecided',
    region: '',
    deadline: '',
    fileFormat: 'audio',
    inflowChannel: '',
    priority: 'normal',
    memo: '',
    status: 'completed',
    createdAt: now,
    updatedAt: now,
  }
}
