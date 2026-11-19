import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * A reusable shift definition (HR-02): "Ca sáng 08:00–12:00". Assignments copy
 * the times they were scheduled with, so editing a template never rewrites a
 * roster that people already planned around.
 *
 * An end time that is not after its start time means the shift runs overnight
 * (22:00–06:00); the duration helper resolves that rather than treating it as an
 * error, because a shop that opens late needs it.
 */

export const SHIFT_TEMPLATE_SCHEMA_VERSION = 1

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,23}$/

export class ShiftInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ShiftInvariantError'
    this.code = code
  }
}

export const ShiftTemplateDraftSchema = z.object({
  code: z.string().trim().regex(CODE_PATTERN),
  name: z.string().trim().min(1).max(120),
  startTime: z.string().regex(TIME_PATTERN),
  endTime: z.string().regex(TIME_PATTERN),
  breakMinutes: z.number().int().min(0).max(240).default(0),
  capacity: z.number().int().min(1).max(200).nullable().default(null),
  isActive: z.boolean().default(true),
  note: z.string().trim().max(500).default(''),
})

export type ShiftTemplateDraft = z.infer<typeof ShiftTemplateDraftSchema>

export interface ShiftTemplateDocument {
  siteId: string
  code: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  capacity: number | null
  isActive: boolean
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

/** Minutes from start to end, crossing midnight when the end is not after it. */
export function shiftSpanMinutes(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const start = startHour! * 60 + startMinute!
  const end = endHour! * 60 + endMinute!
  return end > start ? end - start : 24 * 60 - start + end
}

/** Paid time on the clock: the span minus the unpaid break. */
export function shiftWorkedMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  return shiftSpanMinutes(startTime, endTime) - breakMinutes
}

export function normalizeShiftTemplateInput(input: unknown): ShiftTemplateDraft {
  const source = readRecord(input)
  let draft: ShiftTemplateDraft
  try {
    draft = ShiftTemplateDraftSchema.parse({
      ...source,
      code: typeof source.code === 'string' ? source.code.trim().toUpperCase() : source.code,
      capacity: source.capacity === '' || source.capacity === undefined ? null : source.capacity,
      breakMinutes: source.breakMinutes === '' || source.breakMinutes === undefined ? 0 : source.breakMinutes,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new ShiftInvariantError('SHIFT_TEMPLATE_PAYLOAD_INVALID', 'Dữ liệu ca làm việc không hợp lệ')
    }
    throw error
  }

  const span = shiftSpanMinutes(draft.startTime, draft.endTime)
  if (span === 24 * 60) {
    // 08:00–08:00 reads as a whole day; an overnight shift that long is a typo.
    throw new ShiftInvariantError('SHIFT_DURATION_INVALID', 'Ca làm việc không thể kéo dài cả ngày')
  }
  if (draft.breakMinutes >= span) {
    throw new ShiftInvariantError('SHIFT_BREAK_TOO_LONG', 'Thời gian nghỉ phải ngắn hơn độ dài ca')
  }
  return draft
}

const ShiftTemplateMongooseSchema = new Schema<ShiftTemplateDocument>(
  {
    siteId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    breakMinutes: { type: Number, default: 0 },
    capacity: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    note: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: SHIFT_TEMPLATE_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_shift_templates', timestamps: true, versionKey: false, minimize: false },
)

ShiftTemplateMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'shift_template_site_code' })
ShiftTemplateMongooseSchema.index({ siteId: 1, isDeleted: 1, isActive: 1 }, { name: 'shift_template_site_state' })

export function shiftTemplateModel(connection: Connection): Model<ShiftTemplateDocument> {
  const registered = connection.models.ShiftTemplate as Model<ShiftTemplateDocument> | undefined
  if (registered) return registered
  return connection.model<ShiftTemplateDocument>('ShiftTemplate', ShiftTemplateMongooseSchema, 'crm_shift_templates')
}

export async function syncShiftTemplateIndexes(connection: Connection): Promise<void> {
  await shiftTemplateModel(connection).createIndexes()
}
