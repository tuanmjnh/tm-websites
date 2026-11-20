import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * A payroll row is a calculation result, not a live view (HR-01).
 *
 * Every amount and the inputs that produced it are stored on the row: the daily
 * rate, the days counted, the config used and the adjustments applied. Legacy
 * kept `calculatedSalary` alone, so nobody could explain a number or recompute an
 * old month. Draft rows can be recalculated; `approved` locks the numbers and
 * `paid` records the payment.
 */

export const PAYROLL_SCHEMA_VERSION = 1

export const PAYROLL_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number]

export class PayrollInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PayrollInvariantError'
    this.code = code
  }
}

const PeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

export const PayrollAdjustmentSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount: z.number().int().min(-1_000_000_000).max(1_000_000_000),
})

export type PayrollAdjustment = z.infer<typeof PayrollAdjustmentSchema>

export const PayrollCalculateSchema = z.object({
  period: PeriodSchema,
  staffId: z.string().trim().min(1).max(64).optional(),
  adjustments: z.array(PayrollAdjustmentSchema).max(20).default([]),
})

export type PayrollCalculateInput = z.infer<typeof PayrollCalculateSchema>

export interface PayrollDocument {
  siteId: string
  staffId: string
  employeeCode: string
  period: string
  salaryConfigId: string
  standardWorkDays: number
  baseSalary: number
  dailyRate: number
  workDays: number
  leaveDays: number
  absentDays: number
  basePay: number
  allowancePay: number
  adjustments: PayrollAdjustment[]
  adjustmentTotal: number
  netPay: number
  status: PayrollStatus
  approvedAt: Date | null
  paidAt: Date | null
  cancelledAt: Date | null
  cancelReason: string | null
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

export function normalizePayrollCalculateInput(input: unknown): PayrollCalculateInput {
  const source = readRecord(input)
  try {
    return PayrollCalculateSchema.parse(source)
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new PayrollInvariantError('PAYROLL_PAYLOAD_INVALID', 'Payroll payload is invalid')
    }
    throw error
  }
}

export function periodBounds(period: string): { start: string, end: string, days: number } {
  const [year, month] = period.split('-').map(Number)
  const days = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return { start: `${period}-01`, end: `${period}-${String(days).padStart(2, '0')}`, days }
}

/** Money is stored in whole đồng; intermediate rates round to two decimals. */
export function roundMoney(value: number): number {
  return Math.round(value)
}

export function roundRate(value: number): number {
  return Math.round(value * 100) / 100
}

/** No `_id` on adjustment rows: two identical calculations must compare equal. */
const PayrollAdjustmentSubSchema = new Schema(
  { label: { type: String, required: true }, amount: { type: Number, required: true } },
  { _id: false },
)

const PayrollMongooseSchema = new Schema<PayrollDocument>(
  {
    siteId: { type: String, required: true },
    staffId: { type: String, required: true },
    employeeCode: { type: String, required: true },
    period: { type: String, required: true },
    salaryConfigId: { type: String, required: true },
    standardWorkDays: { type: Number, required: true },
    baseSalary: { type: Number, required: true },
    dailyRate: { type: Number, required: true },
    workDays: { type: Number, required: true },
    leaveDays: { type: Number, default: 0, required: true },
    absentDays: { type: Number, default: 0, required: true },
    basePay: { type: Number, required: true },
    allowancePay: { type: Number, default: 0, required: true },
    adjustments: { type: [PayrollAdjustmentSubSchema], default: [] },
    adjustmentTotal: { type: Number, default: 0, required: true },
    netPay: { type: Number, required: true },
    status: { type: String, enum: PAYROLL_STATUSES, default: 'draft' },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: PAYROLL_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_payrolls', timestamps: true, versionKey: false, minimize: false },
)

PayrollMongooseSchema.index({ siteId: 1, staffId: 1, period: 1 }, { unique: true, name: 'payroll_site_staff_period' })
PayrollMongooseSchema.index({ siteId: 1, period: 1, status: 1 }, { name: 'payroll_site_period_status' })

export function payrollModel(connection: Connection): Model<PayrollDocument> {
  const registered = connection.models.Payroll as Model<PayrollDocument> | undefined
  if (registered) return registered
  return connection.model<PayrollDocument>('Payroll', PayrollMongooseSchema, 'crm_payrolls')
}

export async function syncPayrollIndexes(connection: Connection): Promise<void> {
  await payrollModel(connection).createIndexes()
}
