import Dexie, { type EntityTable } from 'dexie'
import { normalizeConsultationRanges, type Consultation } from './types'

const db = new Dexie('TelWorkDB') as Dexie & {
  consultations: EntityTable<Consultation, 'id'>
}

db.version(1).stores({
  consultations:
    '++id, customerName, phone, status, priority, deadline, createdAt, updatedAt',
})

db.version(2)
  .stores({
    consultations:
      '++id, customerName, phone, status, inquiryType, orderType, deadline, assignee, createdAt, updatedAt',
  })
  .upgrade((tx) =>
    tx
      .table('consultations')
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        if (row.fileKind == null) row.fileKind = row.fileFormat === 'audio' ? 'call' : 'field'
        if (row.orderType == null) row.orderType = 'new'
        if (row.fileCount == null) row.fileCount = ''
        if (row.rangeStart == null) row.rangeStart = ''
        if (row.rangeEnd == null) row.rangeEnd = ''
        if (row.durationSeconds == null) row.durationSeconds = 0
        if (row.estimatedAmount == null) row.estimatedAmount = 0
        if (row.deliveryMethod == null) row.deliveryMethod = 'pdf'
        if (row.assignee == null) row.assignee = ''
        if (typeof row.inquiryType === 'string' && row.inquiryType.includes('녹취')) {
          row.inquiryType = 'recording'
        }
      }),
  )

db.version(3)
  .stores({
    consultations:
      '++id, customerName, phone, status, inquiryType, orderType, deadline, assignee, createdAt, updatedAt',
  })
  .upgrade((tx) =>
    tx
      .table('consultations')
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        row.ranges = normalizeConsultationRanges(row as never)
        if (!row.fileCount) row.fileCount = String((row.ranges as unknown[]).length || 1)
      }),
  )

export { db }
