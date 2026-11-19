import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * Compensation, separated from the staff profile (HR-01).
 *
 * Rows are effective-dated instead of overwritten: a raise in April must not
 * change what March's payroll says, and a payroll row keeps the config id it was
 * calculated from. Legacy stored one config per user with no history, so a
 * recalculated old month silently changed.
 */

export const SALARY_CONFIG_SCHEMA_VERSION = 1

export class SalaryInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SalaryInvariantError'
    this.code = code
  }
}

const AllowanceSchema = z.object({
  title: z.string().trim().min(1).max(120),
  amount: z.number().int().min(0).max(1_000_000_000),
})

export const SalaryConfigDraftSchema = z.object({
  staffId: z.string().trim().min(1).max(64),
  baseSalary: z.number().int().min(0).max(10_000_000_000),
  allowances: z.array(AllowanceSchema).max(20).default([]),
  /** Days a full monthly salary covers; the daily rate is base / this. */
  standardWorkDays: z.number().int().min(1).max(31).default(26),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).default(''),
})

export type SalaryConfigDraft = z.infer<typeof SalaryConfigDraftSchema>

export interface SalaryConfigDocument {
  siteId: string
  staffId: string
  baseSalary: number
  allowances: { title: string, amount: number }[]
  standardWorkDays: number
  effectiveFrom: string
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

export function normalizeSalaryConfigInput(input: unknown): SalaryConfigDraft {
  const source = readRecord(input)
  try {
    return SalaryConfigDraftSchema.parse(source)
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new SalaryInvariantError('SALARY_CONFIG_PAYLOAD_INVALID', 'Salary config payload is invalid')
    }
    throw error
  }
}

export function totalAllowances(config: Pick<SalaryConfigDocument, 'allowances'>): number {
  return (config.allowances ?? []).reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
}

const SalaryConfigMongooseSchema = new Schema<SalaryConfigDocument>(
  {
    siteId: { type: String, required: true },
    staffId: { type: String, required: true },
    baseSalary: { type: Number, required: true },
    allowances: {
      type: [new Schema(
        { title: { type: String, required: true }, amount: { type: Number, required: true } },
        { _id: false },
      )],
      default: [],
    },
    standardWorkDays: { type: Number, default: 26, required: true },
    effectiveFrom: { type: String, required: true },
    note: { type: String, default: '' },
    schemaVersion: { type: Number, default: SALARY_CONFIG_SCHEMA_VERSION, required: true },
  },
  { collection: 'crm_salary_configs', timestamps: true, versionKey: false, minimize: false },
)

SalaryConfigMongooseSchema.index(
  { siteId: 1, staffId: 1, effectiveFrom: 1 },
  { unique: true, name: 'salary_site_staff_effective' },
)

export function salaryConfigModel(connection: Connection): Model<SalaryConfigDocument> {
  const registered = connection.models.SalaryConfig as Model<SalaryConfigDocument> | undefined
  if (registered) return registered
  return connection.model<SalaryConfigDocument>('SalaryConfig', SalaryConfigMongooseSchema, 'crm_salary_configs')
}

export async function syncSalaryConfigIndexes(connection: Connection): Promise<void> {
  await salaryConfigModel(connection).createIndexes()
}
