import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * One row per person per day (HR-01). The pair is unique, so recording the same
 * day twice is a correction, not a second shift: payroll counts rows, and a
 * duplicate row would silently pay a day twice.
 */

export const ATTENDANCE_SCHEMA_VERSION = 1

export const ATTENDANCE_STATUSES = ['present', 'late', 'leave', 'absent'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

/** Statuses payroll pays for. `leave` and `absent` are counted, not paid. */
export const PAID_ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'late']

export class AttendanceInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AttendanceInvariantError'
    this.code = code
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const AttendanceDraftSchema = z.object({
  staffId: z.string().trim().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(ATTENDANCE_STATUSES),
  checkIn: z.string().regex(TIME_PATTERN).nullable().default(null),
  checkOut: z.string().regex(TIME_PATTERN).nullable().default(null),
  warehouseId: z.string().trim().max(64).nullable().default(null),
  note: z.string().trim().max(500).default(''),
})

export type AttendanceDraft = z.infer<typeof AttendanceDraftSchema>

export interface AttendanceDocument {
  siteId: string
  staffId: string
  date: string
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  warehouseId: string | null
  note: string
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** A real calendar day, not just a well-shaped string (2026-02-31 is refused). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

export function normalizeAttendanceInput(input: unknown): AttendanceDraft {
  const source = readRecord(input)
  try {
    const draft = AttendanceDraftSchema.parse({
      ...source,
      checkIn: source.checkIn || null,
      checkOut: source.checkOut || null,
      warehouseId: source.warehouseId || null,
    })
    if (!isCalendarDate(draft.date)) {
      throw new AttendanceInvariantError('ATTENDANCE_DATE_INVALID', 'Attendance date is not a real calendar day')
    }
    if (draft.checkIn && draft.checkOut && draft.checkOut < draft.checkIn) {
      throw new AttendanceInvariantError('ATTENDANCE_TIME_INVALID', 'Check-out cannot be before check-in')
    }
    if ((draft.status === 'leave' || draft.status === 'absent') && (draft.checkIn || draft.checkOut)) {
      throw new AttendanceInvariantError('ATTENDANCE_TIMES_NOT_ALLOWED', 'A leave or absent day carries no check-in times')
    }
    return draft
  } catch (error) {
    if (error instanceof AttendanceInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new AttendanceInvariantError('ATTENDANCE_PAYLOAD_INVALID', 'Attendance payload is invalid')
    }
    throw error
  }
}

const AttendanceMongooseSchema = new Schema<AttendanceDocument>(
  {
    siteId: { type: String, required: true },
    staffId: { type: String, required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    checkIn: { type: String, default: null },
    checkOut: { type: String, default: null },
    warehouseId: { type: String, default: null },
    note: { type: String, default: '' },
    schemaVersion: { type: Number, default: ATTENDANCE_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_attendances', timestamps: true, versionKey: false, minimize: false },
)

AttendanceMongooseSchema.index({ siteId: 1, staffId: 1, date: 1 }, { unique: true, name: 'attendance_site_staff_date' })
AttendanceMongooseSchema.index({ siteId: 1, date: 1 }, { name: 'attendance_site_date' })

export function attendanceModel(connection: Connection): Model<AttendanceDocument> {
  const registered = connection.models.Attendance as Model<AttendanceDocument> | undefined
  if (registered) return registered
  return connection.model<AttendanceDocument>('Attendance', AttendanceMongooseSchema, 'crm_attendances')
}

export async function syncAttendanceIndexes(connection: Connection): Promise<void> {
  await attendanceModel(connection).createIndexes()
}
