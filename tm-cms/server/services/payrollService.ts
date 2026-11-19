import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { AttendanceDocument } from '../models/attendance'
import { PAID_ATTENDANCE_STATUSES } from '../models/attendance'
import {
  type PayrollAdjustment,
  type PayrollDocument,
  type PayrollStatus,
  PayrollInvariantError,
  normalizePayrollCalculateInput,
  periodBounds,
  roundMoney,
  roundRate,
} from '../models/payroll'
import {
  type SalaryConfigDocument,
  SalaryInvariantError,
  normalizeSalaryConfigInput,
  totalAllowances,
} from '../models/salaryConfig'
import type { StaffProfileDocument } from '../models/staffProfile'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { HrServiceError } from './staffService'

/**
 * Salary configuration and payroll (HR-01).
 *
 * A payroll row is computed once from stored inputs and then locked: draft rows
 * are recalculable, `approved` rows are frozen, `paid` rows record the payment.
 * The calculation is a pure function of (config, attendance rows, adjustments),
 * so the same period always produces the same numbers and an old month can be
 * explained later.
 */

export interface SalaryConfigAdmin {
  id: string
  staffId: string
  baseSalary: number
  allowances: { title: string, amount: number }[]
  allowanceTotal: number
  standardWorkDays: number
  effectiveFrom: string
  note: string
}

export interface PayrollAdmin {
  id: string
  staffId: string
  employeeCode: string
  period: string
  status: PayrollStatus
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
  approvedAt: string | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface PayrollCalculationLine {
  staffId: string
  employeeCode: string
  payrollId: string | null
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'locked'
  reason?: string
  netPay?: number
}

type SalaryRecord = SalaryConfigDocument & { _id: Types.ObjectId }
type PayrollRecord = PayrollDocument & { _id: Types.ObjectId }
type StaffRecord = StaffProfileDocument & { _id: Types.ObjectId }

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new HrServiceError(422, code, 'Id không hợp lệ')
  return new Types.ObjectId(value)
}

export function toAdminSalaryConfig(record: SalaryRecord): SalaryConfigAdmin {
  return {
    id: String(record._id),
    staffId: record.staffId,
    baseSalary: record.baseSalary,
    allowances: (record.allowances ?? []).map(entry => ({ title: entry.title, amount: entry.amount })),
    allowanceTotal: totalAllowances(record),
    standardWorkDays: record.standardWorkDays,
    effectiveFrom: record.effectiveFrom,
    note: record.note ?? '',
  }
}

export function toAdminPayroll(record: PayrollRecord): PayrollAdmin {
  return {
    id: String(record._id),
    staffId: record.staffId,
    employeeCode: record.employeeCode,
    period: record.period,
    status: record.status,
    salaryConfigId: record.salaryConfigId,
    standardWorkDays: record.standardWorkDays,
    baseSalary: record.baseSalary,
    dailyRate: record.dailyRate,
    workDays: record.workDays,
    leaveDays: record.leaveDays ?? 0,
    absentDays: record.absentDays ?? 0,
    basePay: record.basePay,
    allowancePay: record.allowancePay,
    adjustments: record.adjustments ?? [],
    adjustmentTotal: record.adjustmentTotal,
    netPay: record.netPay,
    approvedAt: iso(record.approvedAt),
    paidAt: iso(record.paidAt),
    cancelledAt: iso(record.cancelledAt),
    cancelReason: record.cancelReason ?? null,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export async function setSalaryConfig(
  model: Model<SalaryConfigDocument>,
  staffModel: Model<StaffProfileDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<SalaryConfigAdmin> {
  let draft
  try {
    draft = normalizeSalaryConfigInput(input)
  } catch (error) {
    if (error instanceof SalaryInvariantError) {
      throw new HrServiceError(422, error.code, error.message)
    }
    throw error
  }

  const staff = await staffModel
    .findOne({ _id: objectId(draft.staffId, 'STAFF_ID_INVALID'), siteId, isDeleted: { $ne: true } })
    .lean<StaffRecord | null>()
  if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')

  let record: SalaryRecord
  try {
    record = await model.findOneAndUpdate(
      { siteId, staffId: draft.staffId, effectiveFrom: draft.effectiveFrom },
      {
        $set: {
          baseSalary: draft.baseSalary,
          allowances: draft.allowances,
          standardWorkDays: draft.standardWorkDays,
          note: draft.note,
        },
        $setOnInsert: { siteId, staffId: draft.staffId, effectiveFrom: draft.effectiveFrom },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false },
    ).lean<SalaryRecord | null>() as SalaryRecord
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new HrServiceError(409, 'SALARY_CONFIG_EXISTS', 'Đã có cấu hình lương cùng ngày hiệu lực')
    throw error
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'salary_config',
    resourceId: String(record._id),
    resourceKey: `${staff.employeeCode}:${record.effectiveFrom}`,
    action: 'create',
    revision: 1,
    fromStatus: null,
    toStatus: 'active',
    changedFields: ['baseSalary', 'allowances', 'standardWorkDays', 'effectiveFrom'],
  })

  return toAdminSalaryConfig(record)
}

/** The config in force on a date: the latest row whose `effectiveFrom` is not after it. */
export async function salaryConfigOn(
  model: Model<SalaryConfigDocument>,
  siteId: string,
  staffId: string,
  date: string,
): Promise<SalaryRecord | null> {
  return model
    .findOne({ siteId, staffId, effectiveFrom: { $lte: date } })
    .sort({ effectiveFrom: -1 })
    .lean<SalaryRecord | null>()
}

export async function listSalaryConfigs(
  model: Model<SalaryConfigDocument>,
  siteId: string,
  staffId: string,
): Promise<SalaryConfigAdmin[]> {
  const records = await model
    .find({ siteId, staffId: String(objectId(staffId, 'STAFF_ID_INVALID')) })
    .sort({ effectiveFrom: -1 })
    .lean<SalaryRecord[]>()
  return records.map(toAdminSalaryConfig)
}

export interface PayrollListParams {
  period?: string | null
  staffId?: string | null
  status?: PayrollStatus | null
  limit?: number
}

export async function listPayrolls(
  model: Model<PayrollDocument>,
  siteId: string,
  params: PayrollListParams = {},
): Promise<{ data: PayrollAdmin[], counts: Record<PayrollStatus | 'all', number>, totals: { netPay: number, workDays: number } }> {
  const filter: Record<string, unknown> = { siteId }
  if (params.period) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.period)) {
      throw new HrServiceError(422, 'PAYROLL_PERIOD_INVALID', 'Kỳ lương không hợp lệ (YYYY-MM)')
    }
    filter.period = params.period
  }
  if (params.staffId) filter.staffId = objectId(params.staffId, 'STAFF_ID_INVALID')
  if (params.status) filter.status = params.status

  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 100), 1), 500)
  const records = await model.find(filter).sort({ period: -1, employeeCode: 1 }).limit(limit).lean<PayrollRecord[]>()

  const rows = await model.aggregate<{ _id: PayrollStatus, count: number, netPay: number, workDays: number }>([
    { $match: { siteId, ...(params.period ? { period: params.period } : {}) } },
    { $group: { _id: '$status', count: { $sum: 1 }, netPay: { $sum: '$netPay' }, workDays: { $sum: '$workDays' } } },
  ])
  const counts = { all: 0, draft: 0, approved: 0, paid: 0, cancelled: 0 } as Record<PayrollStatus | 'all', number>
  const totals = { netPay: 0, workDays: 0 }
  for (const row of rows) {
    if (row._id in counts) counts[row._id] = row.count
    counts.all += row.count
    if (row._id !== 'cancelled') {
      totals.netPay += row.netPay ?? 0
      totals.workDays += row.workDays ?? 0
    }
  }

  return { data: records.map(toAdminPayroll), counts, totals }
}

export async function getPayroll(
  model: Model<PayrollDocument>,
  siteId: string,
  id: string,
): Promise<PayrollAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'PAYROLL_ID_INVALID'), siteId }).lean<PayrollRecord | null>()
  if (!record) throw new HrServiceError(404, 'PAYROLL_NOT_FOUND', 'Không tìm thấy bảng lương')
  return toAdminPayroll(record)
}

interface ComputedPayroll {
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
}

interface ComputedInputs {
  attendanceModel: Model<AttendanceDocument>
  salaryModel: Model<SalaryConfigDocument>
  siteId: string
}

/**
 * The calculation itself. Pure given the database, so a payroll row can always be
 * explained: rate = base / standard days, pay = rate × paid days, plus the
 * monthly allowances and any itemised adjustment.
 */
async function computePayroll(
  inputs: ComputedInputs,
  staff: StaffRecord,
  period: string,
  adjustments: PayrollAdjustment[],
): Promise<ComputedPayroll> {
  const { start, end } = periodBounds(period)
  const config = await salaryConfigOn(inputs.salaryModel, inputs.siteId, String(staff._id), end)
  if (!config) {
    throw new HrServiceError(422, 'SALARY_CONFIG_MISSING', `Chưa có cấu hình lương cho ${staff.employeeCode}`)
  }

  const days = await inputs.attendanceModel
    .find({ siteId: inputs.siteId, staffId: String(staff._id), date: { $gte: start, $lte: end } })
    .lean<{ status: string }[]>()

  let workDays = 0
  let leaveDays = 0
  let absentDays = 0
  for (const day of days) {
    if (PAID_ATTENDANCE_STATUSES.includes(day.status as never)) workDays += 1
    else if (day.status === 'leave') leaveDays += 1
    else absentDays += 1
  }

  const dailyRate = roundRate(config.baseSalary / config.standardWorkDays)
  const basePay = roundMoney(dailyRate * workDays)
  const allowancePay = totalAllowances(config)
  const adjustmentTotal = adjustments.reduce((sum, entry) => sum + entry.amount, 0)
  const netPay = roundMoney(basePay + allowancePay + adjustmentTotal)

  if (netPay < 0) {
    throw new HrServiceError(422, 'PAYROLL_NET_NEGATIVE', 'Tổng khấu trừ vượt quá lương phải trả')
  }

  return {
    salaryConfigId: String(config._id),
    standardWorkDays: config.standardWorkDays,
    baseSalary: config.baseSalary,
    dailyRate,
    workDays,
    leaveDays,
    absentDays,
    basePay,
    allowancePay,
    adjustments,
    adjustmentTotal,
    netPay,
  }
}

const LOCKED_STATUSES: PayrollStatus[] = ['approved', 'paid', 'cancelled']

export async function calculatePayroll(
  payrollModelRef: Model<PayrollDocument>,
  inputs: ComputedInputs & { staffModel: Model<StaffProfileDocument> },
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ period: string, lines: PayrollCalculationLine[], summary: Record<PayrollCalculationLine['outcome'], number> }> {
  let request
  try {
    request = normalizePayrollCalculateInput(input)
  } catch (error) {
    if (error instanceof PayrollInvariantError) {
      throw new HrServiceError(422, error.code, error.message)
    }
    throw error
  }

  const staffFilter: Record<string, unknown> = {
    siteId,
    isDeleted: { $ne: true },
    workStatus: { $in: ['probation', 'official'] },
  }
  if (request.staffId) staffFilter._id = objectId(request.staffId, 'STAFF_ID_INVALID')

  const staffRows = await inputs.staffModel.find(staffFilter).sort({ employeeCode: 1 }).lean<StaffRecord[]>()
  if (staffRows.length === 0) {
    throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không có nhân sự đang làm việc để tính lương')
  }

  const lines: PayrollCalculationLine[] = []
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0, locked: 0 }

  for (const staff of staffRows) {
    const existing = await payrollModelRef
      .findOne({ siteId, staffId: String(staff._id), period: request.period })
      .lean<PayrollRecord | null>()

    if (existing && LOCKED_STATUSES.includes(existing.status)) {
      lines.push({
        staffId: String(staff._id),
        employeeCode: staff.employeeCode,
        payrollId: String(existing._id),
        outcome: 'locked',
        reason: existing.status,
      })
      summary.locked += 1
      continue
    }

    let computed: ComputedPayroll
    try {
      computed = await computePayroll(inputs, staff, request.period, request.adjustments)
    } catch (error) {
      if (error instanceof HrServiceError && error.code === 'SALARY_CONFIG_MISSING') {
        lines.push({
          staffId: String(staff._id),
          employeeCode: staff.employeeCode,
          payrollId: null,
          outcome: 'skipped',
          reason: error.code,
        })
        summary.skipped += 1
        continue
      }
      throw error
    }

    if (existing) {
      const same = existing.salaryConfigId === computed.salaryConfigId
        && existing.workDays === computed.workDays
        && existing.leaveDays === computed.leaveDays
        && existing.absentDays === computed.absentDays
        && existing.netPay === computed.netPay
        && JSON.stringify(existing.adjustments ?? []) === JSON.stringify(computed.adjustments)

      if (same) {
        lines.push({
          staffId: String(staff._id),
          employeeCode: staff.employeeCode,
          payrollId: String(existing._id),
          outcome: 'unchanged',
          netPay: existing.netPay,
        })
        summary.unchanged += 1
        continue
      }

      const updated = await payrollModelRef.findOneAndUpdate(
        { _id: existing._id, siteId, status: 'draft', revision: existing.revision },
        { $set: { employeeCode: staff.employeeCode, ...computed }, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      ).lean<PayrollRecord | null>()

      if (!updated) {
        lines.push({
          staffId: String(staff._id),
          employeeCode: staff.employeeCode,
          payrollId: String(existing._id),
          outcome: 'locked',
          reason: 'revision_conflict',
        })
        summary.locked += 1
        continue
      }

      await recordContentAudit(meta?.audit, {
        siteId,
        resourceType: 'payroll',
        resourceId: String(updated._id),
        resourceKey: `${staff.employeeCode}:${request.period}`,
        action: 'update',
        revision: updated.revision,
        fromStatus: existing.status,
        toStatus: updated.status,
        changedFields: ['workDays', 'basePay', 'allowancePay', 'adjustmentTotal', 'netPay'],
      })

      lines.push({
        staffId: String(staff._id),
        employeeCode: staff.employeeCode,
        payrollId: String(updated._id),
        outcome: 'updated',
        netPay: updated.netPay,
      })
      summary.updated += 1
      continue
    }

    let created: PayrollRecord
    try {
      created = await payrollModelRef.create({
        siteId,
        staffId: String(staff._id),
        employeeCode: staff.employeeCode,
        period: request.period,
        status: 'draft',
        ...computed,
        revision: 1,
      }) as PayrollRecord
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new HrServiceError(409, 'PAYROLL_EXISTS', 'Bảng lương kỳ này vừa được tạo')
      }
      throw error
    }

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'payroll',
      resourceId: String(created._id),
      resourceKey: `${staff.employeeCode}:${request.period}`,
      action: 'create',
      revision: 1,
      fromStatus: null,
      toStatus: 'draft',
      changedFields: ['period', 'salaryConfigId', 'workDays', 'basePay', 'allowancePay', 'netPay'],
    })

    lines.push({
      staffId: String(staff._id),
      employeeCode: staff.employeeCode,
      payrollId: String(created._id),
      outcome: 'created',
      netPay: created.netPay,
    })
    summary.created += 1
  }

  return { period: request.period, lines, summary }
}

async function transition(
  model: Model<PayrollDocument>,
  siteId: string,
  id: string,
  revision: number,
  fromStatuses: PayrollStatus[],
  update: Record<string, unknown>,
  toStatus: PayrollStatus,
  action: 'approve' | 'pay' | 'cancel',
  meta?: { audit?: ContentAuditMeta },
): Promise<PayrollAdmin> {
  const _id = objectId(id, 'PAYROLL_ID_INVALID')
  if (!Number.isInteger(revision) || revision < 1) {
    throw new HrServiceError(422, 'PAYROLL_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  }

  const record = await model.findOneAndUpdate(
    { _id, siteId, revision, status: { $in: fromStatuses } },
    { $set: { ...update, status: toStatus }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<PayrollRecord | null>()

  if (!record) {
    const current = await model.findOne({ _id, siteId }).lean<PayrollRecord | null>()
    if (!current) throw new HrServiceError(404, 'PAYROLL_NOT_FOUND', 'Không tìm thấy bảng lương')
    if (current.revision !== revision) {
      throw new HrServiceError(409, 'PAYROLL_REVISION_CONFLICT', 'Bảng lương vừa được người khác sửa', {
        currentRevision: current.revision,
      })
    }
    const code = current.status === 'paid'
      ? 'PAYROLL_LOCKED'
      : action === 'pay'
        ? 'PAYROLL_NOT_APPROVED'
        : action === 'approve'
          ? 'PAYROLL_NOT_DRAFT'
          : 'PAYROLL_NOT_CANCELLABLE'
    throw new HrServiceError(409, code, `Không thể thực hiện khi bảng lương đang ${current.status}`, {
      status: current.status,
    })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'payroll',
    resourceId: String(record._id),
    resourceKey: `${record.employeeCode}:${record.period}`,
    action,
    revision: record.revision,
    fromStatus: fromStatuses[0] ?? null,
    toStatus,
    changedFields: ['status'],
  })

  return toAdminPayroll(record)
}

export function approvePayroll(
  model: Model<PayrollDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<PayrollAdmin> {
  return transition(model, siteId, id, revision, ['draft'], { approvedAt: new Date() }, 'approved', 'approve', meta)
}

export function payPayroll(
  model: Model<PayrollDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<PayrollAdmin> {
  return transition(model, siteId, id, revision, ['approved'], { paidAt: new Date() }, 'paid', 'pay', meta)
}

export async function cancelPayroll(
  model: Model<PayrollDocument>,
  siteId: string,
  id: string,
  revision: number,
  reason: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<PayrollAdmin> {
  const cleaned = reason.trim()
  if (cleaned.length < 3) {
    throw new HrServiceError(422, 'PAYROLL_CANCEL_REASON_REQUIRED', 'Cần nêu lý do huỷ bảng lương')
  }
  return transition(
    model,
    siteId,
    id,
    revision,
    ['draft', 'approved'],
    { cancelledAt: new Date(), cancelReason: cleaned.slice(0, 500) },
    'cancelled',
    'cancel',
    { audit: meta?.audit ? { ...meta.audit, reason: cleaned } : undefined },
  )
}
