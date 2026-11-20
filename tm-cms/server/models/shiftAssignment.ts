import { Schema } from 'mongoose'
import type { Connection, Model, Types } from 'mongoose'
import { z } from 'zod'

/**
 * One person, one day, one shift (HR-02). The unique pair keeps the roster
 * compatible with attendance and payroll, which count one row per person per
 * day: a second assignment for the same day would mean a person is expected in
 * two places at once.
 *
 * The template's code and times are copied onto the assignment. A roster is a
 * promise made on a date, so changing the template later must not silently move
 * a shift people already planned around.
 */

export const SHIFT_ASSIGNMENT_SCHEMA_VERSION = 1

export class ShiftAssignmentInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ShiftAssignmentInvariantError'
    this.code = code
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const ShiftAssignmentDraftSchema = z.object({
  templateId: z.string().trim().regex(/^[a-f0-9]{24}$/),
  staffId: z.string().trim().regex(/^[a-f0-9]{24}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).default(''),
})

export type ShiftAssignmentDraft = z.infer<typeof ShiftAssignmentDraftSchema>

export interface ShiftAssignmentDocument {
  siteId: string
  templateId: Types.ObjectId
  shiftCode: string
  staffId: Types.ObjectId
  employeeCode: string
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  note: string
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

export function normalizeShiftAssignmentInput(input: unknown): ShiftAssignmentDraft {
  try {
    return ShiftAssignmentDraftSchema.parse(readRecord(input))
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new ShiftAssignmentInvariantError('SHIFT_ASSIGNMENT_PAYLOAD_INVALID', 'Dữ liệu phân ca không hợp lệ')
    }
    throw error
  }
}

/** The template fields an assignment freezes at scheduling time. */
export function shiftSnapshotOf(template: {
  code: string
  startTime: string
  endTime: string
  breakMinutes: number
}) {
  return {
    shiftCode: template.code,
    startTime: template.startTime,
    endTime: template.endTime,
    breakMinutes: template.breakMinutes,
  }
}

const ShiftAssignmentMongooseSchema = new Schema<ShiftAssignmentDocument>(
  {
    siteId: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, required: true },
    shiftCode: { type: String, required: true },
    staffId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    date: { type: String, required: true },
    startTime: { type: String, required: true, match: TIME_PATTERN },
    endTime: { type: String, required: true, match: TIME_PATTERN },
    breakMinutes: { type: Number, default: 0 },
    note: { type: String, default: '' },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: SHIFT_ASSIGNMENT_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_shift_assignments', timestamps: true, versionKey: false, minimize: false },
)

ShiftAssignmentMongooseSchema.index({ siteId: 1, staffId: 1, date: 1 }, { unique: true, name: 'shift_assignment_site_staff_date' })
ShiftAssignmentMongooseSchema.index({ siteId: 1, date: 1 }, { name: 'shift_assignment_site_date' })
ShiftAssignmentMongooseSchema.index({ siteId: 1, templateId: 1, date: 1 }, { name: 'shift_assignment_site_template_date' })

export function shiftAssignmentModel(connection: Connection): Model<ShiftAssignmentDocument> {
  const registered = connection.models.ShiftAssignment as Model<ShiftAssignmentDocument> | undefined
  if (registered) return registered
  return connection.model<ShiftAssignmentDocument>(
    'ShiftAssignment',
    ShiftAssignmentMongooseSchema,
    'crm_shift_assignments',
  )
}

export async function syncShiftAssignmentIndexes(connection: Connection): Promise<void> {
  await shiftAssignmentModel(connection).createIndexes()
}
