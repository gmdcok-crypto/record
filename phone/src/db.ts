import Dexie, { type EntityTable } from 'dexie'
import type { Consultation } from './types'

const db = new Dexie('TelWorkDB') as Dexie & {
  consultations: EntityTable<Consultation, 'id'>
}

db.version(1).stores({
  consultations:
    '++id, customerName, phone, status, priority, deadline, createdAt, updatedAt',
})

export { db }
