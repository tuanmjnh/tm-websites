import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Staff profile (HR-01). Hub owns identity: the profile points at a Hub subject
 * and keeps only employment facts. Compensation is deliberately **not** here —
 * it lives in `crm_salary_configs`, which has its own gate, so listing staff can
 * never leak a salary.
 */

export const STAFF_PROFILE_SCHEMA_VERSION = 1

export const STAFF_POSITIONS = ['director', 'manager', 'staff'] as const
export type StaffPosition = (typeof STAFF_POSITIONS)[number]

export const STAFF_WORK_STATUSES = ['probation', 'official', 'resigned'] as const
export type StaffWorkStatus = (typeof STAFF_WORK_STATUSES)[number]

export class StaffInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StaffInvariantError'
    this.code = code
  }
}

export const StaffDraftSchema = z.object({
  subjectId: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,127}$/),
  employeeCode: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/),
  fullName: z.string().trim().min(1).max(200),
  positionCode: z.enum(STAFF_POSITIONS).default('staff'),
  jobDescription: z.string().trim().max(5000).default(''),
  workStatus: z.enum(STAFF_WORK_STATUSES).default('probation'),
  joinedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  leftAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  phone: z.string().trim().max(40).default(''),
  note: z.string().trim().max(2000).default(''),
})

export type StaffDraft = z.infer<typeof StaffDraftSchema>

export interface StaffProfileDocument {
  siteId: string
  subjectId: string
  employeeCode: string
  fullName: string
  positionCode: StaffPosition
  jobDescription: string
  workStatus: StaffWorkStatus
  joinedAt: string | null
  leftAt: string | null
  phone: string
  note: string
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeStaffInput(input: unknown): StaffDraft {
  const source = readRecord(input)
  try {
    return StaffDraftSchema.parse({
      ...source,
      employeeCode: typeof source.employeeCode === 'string' ? source.employeeCode.trim().toUpperCase() : source.employeeCode,
      joinedAt: source.joinedAt || null,
      leftAt: source.leftAt || null,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new StaffInvariantError('STAFF_PAYLOAD_INVALID', 'Staff payload is invalid')
    }
    throw error
  }
}

const StaffProfileMongooseSchema = new Schema<StaffProfileDocument>(
  {
    siteId: { type: String, required: true },
    subjectId: { type: String, required: true },
    employeeCode: { type: String, required: true },
    fullName: { type: String, required: true },
    positionCode: { type: String, enum: STAFF_POSITIONS, default: 'staff' },
    jobDescription: { type: String, default: '' },
    workStatus: { type: String, enum: STAFF_WORK_STATUSES, default: 'probation' },
    joinedAt: { type: String, default: null },
    leftAt: { type: String, default: null },
    phone: { type: String, default: '' },
    note: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: STAFF_PROFILE_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_staff_profiles', timestamps: true, versionKey: false, minimize: false },
)

StaffProfileMongooseSchema.index({ siteId: 1, subjectId: 1 }, { unique: true, name: 'staff_site_subject' })
StaffProfileMongooseSchema.index({ siteId: 1, employeeCode: 1 }, { unique: true, name: 'staff_site_employee_code' })
StaffProfileMongooseSchema.index({ siteId: 1, workStatus: 1, isDeleted: 1 }, { name: 'staff_site_status' })

export function staffProfileModel(connection: Connection): Model<StaffProfileDocument> {
  const registered = connection.models.StaffProfile as Model<StaffProfileDocument> | undefined
  if (registered) return registered
  return connection.model<StaffProfileDocument>('StaffProfile', StaffProfileMongooseSchema, 'crm_staff_profiles')
}

export async function syncStaffProfileIndexes(connection: Connection): Promise<void> {
  await staffProfileModel(connection).createIndexes()
}
