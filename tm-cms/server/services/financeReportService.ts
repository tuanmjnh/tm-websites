import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { OrderDocument } from '../models/order'
import type { PaymentDocument } from '../models/payment'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'
import {
  CUSTOMER_DAY_MS,
  CUSTOMER_TIME_ZONE,
  isCalendarDate,
  localDayOf,
  localDayStartUtc,
} from '../utils/customerTime'

export { localDayOf, localDayStartUtc }

/**
 * Finance reports (FIN-02), computed from the documents that already exist.
 *
 * Nothing here is stored: a report is a read of `crm_payments`, orders and
 * purchase orders, so it cannot drift from the ledger. The rule the reports
 * keep is that a voided payment stays visible in the ledger but never counts as
 * money moved, and an outstanding balance is always `total - paid`.
 *
 * Calendar days are the customer's days (Asia/Ho_Chi_Minh, fixed UTC+7 with no
 * DST), so a payment at 23:30 on the 31st belongs to that month even though it
 * is the 30th in UTC.
 */

export const REPORT_TIME_ZONE = CUSTOMER_TIME_ZONE
const DAY_MS = CUSTOMER_DAY_MS
const MAX_RANGE_DAYS = 366
const DEFAULT_LEDGER_LIMIT = 50
const MAX_LEDGER_LIMIT = 200
const MAX_EXPORT_ROWS = 5000

export class FinanceReportError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'FinanceReportError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export interface ReportRange {
  /** Inclusive first day, `YYYY-MM-DD` in the customer's time zone. */
  from: string
  /** Inclusive last day, `YYYY-MM-DD` in the customer's time zone. */
  to: string
}

export interface ResolvedRange extends ReportRange {
  /** UTC instants the range covers; `end` is exclusive. */
  startUtc: Date
  endUtc: Date
  days: number
}

type OrderRecord = OrderDocument & { _id: Types.ObjectId }
type PurchaseOrderRecord = PurchaseOrderDocument & { _id: Types.ObjectId }
type PaymentRecord = PaymentDocument & { _id: Types.ObjectId }

export interface ReportModels {
  Payment: Model<PaymentDocument>
  Order: Model<OrderDocument>
  PurchaseOrder: Model<PurchaseOrderDocument>
}

export const isReportDate = isCalendarDate

export function resolveRange(from: unknown, to: unknown, now: Date = new Date()): ResolvedRange {
  if (!isReportDate(from) || !isReportDate(to)) {
    throw new FinanceReportError(422, 'REPORT_RANGE_INVALID', 'Khoảng ngày không hợp lệ (YYYY-MM-DD)')
  }
  const startUtc = localDayStartUtc(from)
  const endUtc = new Date(localDayStartUtc(to).getTime() + DAY_MS)
  const days = Math.round((endUtc.getTime() - startUtc.getTime()) / DAY_MS)
  if (days <= 0) {
    throw new FinanceReportError(422, 'REPORT_RANGE_INVALID', 'Ngày bắt đầu phải trước ngày kết thúc', { from, to })
  }
  if (days > MAX_RANGE_DAYS) {
    throw new FinanceReportError(422, 'REPORT_RANGE_TOO_LONG', `Khoảng báo cáo tối đa ${MAX_RANGE_DAYS} ngày`, { days })
  }
  // A range that ends in the future is allowed (it reads as empty for the future
  // days); a range that starts after today would only ever report zero.
  if (startUtc.getTime() > now.getTime() + DAY_MS) {
    throw new FinanceReportError(422, 'REPORT_RANGE_IN_FUTURE', 'Khoảng báo cáo nằm trong tương lai', { from })
  }
  return { from, to, startUtc, endUtc, days }
}

interface MoneyBuckets {
  total: number
  count: number
  byMethod: Record<string, number>
}

function emptyBuckets(): MoneyBuckets {
  return { total: 0, count: 0, byMethod: {} }
}

function addToBucket(bucket: MoneyBuckets, amount: number, method: string | null) {
  bucket.total += amount
  bucket.count += 1
  const key = method ?? 'other'
  bucket.byMethod[key] = (bucket.byMethod[key] ?? 0) + amount
}

export interface FinanceSummary {
  range: ReportRange
  timeZone: string
  received: MoneyBuckets
  paidOut: MoneyBuckets
  net: number
  receivables: { outstanding: number, count: number, overdueCount: number }
  payables: { outstanding: number, count: number, overdueCount: number }
  voided: { total: number, count: number }
}

/**
 * Money in and out for the range, plus what is still outstanding on documents.
 * Outstanding balances are as of now, not as of the range: a report of last
 * month still needs to say who owes money today, and the field names say `now`.
 */
export async function financeSummary(
  models: ReportModels,
  siteId: string,
  range: ResolvedRange,
  now: Date = new Date(),
): Promise<FinanceSummary> {
  const paymentFilter = { siteId, paidAt: { $gte: range.startUtc, $lt: range.endUtc } }
  const payments = await models.Payment.find(paymentFilter)
    .select({ amount: 1, method: 1, direction: 1, state: 1 })
    .lean<{ amount: number, method: string | null, direction: string, state: string }[]>()

  const received = emptyBuckets()
  const paidOut = emptyBuckets()
  const voided = { total: 0, count: 0 }
  for (const payment of payments) {
    if (payment.state === 'voided') {
      voided.total += payment.amount
      voided.count += 1
      continue
    }
    if (payment.direction === 'receivable') addToBucket(received, payment.amount, payment.method)
    else addToBucket(paidOut, payment.amount, payment.method)
  }

  const overdueCutoff = new Date(now.getTime() - 30 * DAY_MS)
  const [receivables, payables] = await Promise.all([
    models.Order.aggregate<{ outstanding: number, count: number, overdue: number }>([
      { $match: { siteId, isDeleted: { $ne: true }, status: { $ne: 'cancelled' }, $expr: { $gt: ['$totalAmount', '$paidAmount'] } } },
      { $project: { outstanding: { $subtract: ['$totalAmount', '$paidAmount'] }, overdue: { $lt: ['$createdAt', overdueCutoff] } } },
      { $group: { _id: null, outstanding: { $sum: '$outstanding' }, count: { $sum: 1 }, overdue: { $sum: { $cond: ['$overdue', 1, 0] } } } },
    ]),
    models.PurchaseOrder.aggregate<{ outstanding: number, count: number, overdue: number }>([
      {
        $match: {
          siteId,
          isDeleted: { $ne: true },
          status: { $nin: ['draft', 'cancelled'] },
          $expr: { $gt: ['$totalAmount', '$paidAmount'] },
        },
      },
      { $project: { outstanding: { $subtract: ['$totalAmount', '$paidAmount'] }, overdue: { $lt: ['$createdAt', overdueCutoff] } } },
      { $group: { _id: null, outstanding: { $sum: '$outstanding' }, count: { $sum: 1 }, overdue: { $sum: { $cond: ['$overdue', 1, 0] } } } },
    ]),
  ])

  return {
    range: { from: range.from, to: range.to },
    timeZone: REPORT_TIME_ZONE,
    received,
    paidOut,
    net: received.total - paidOut.total,
    receivables: {
      outstanding: receivables[0]?.outstanding ?? 0,
      count: receivables[0]?.count ?? 0,
      overdueCount: receivables[0]?.overdue ?? 0,
    },
    payables: {
      outstanding: payables[0]?.outstanding ?? 0,
      count: payables[0]?.count ?? 0,
      overdueCount: payables[0]?.overdue ?? 0,
    },
    voided,
  }
}

export interface AgingBucket {
  key: 'current' | '1-30' | '31-60' | '61-90' | '90+'
  label: string
  amount: number
  count: number
}

export interface FinanceAging {
  asOf: string
  timeZone: string
  receivables: AgingBucket[]
  payables: AgingBucket[]
  totals: { receivables: number, payables: number }
}

const AGING_KEYS: AgingBucket['key'][] = ['current', '1-30', '31-60', '61-90', '90+']

function emptyAging(): AgingBucket[] {
  return AGING_KEYS.map(key => ({ key, label: key, amount: 0, count: 0 }))
}

function bucketFor(ageDays: number): AgingBucket['key'] {
  if (ageDays <= 0) return 'current'
  if (ageDays <= 30) return '1-30'
  if (ageDays <= 60) return '31-60'
  if (ageDays <= 90) return '61-90'
  return '90+'
}

/**
 * How old the unpaid part of each document is, in local calendar days since the
 * document date. Age is measured on the local day, so a document created at
 * 23:00 local is not a day older at 01:00 than it was two hours before.
 */
export async function financeAging(
  models: ReportModels,
  siteId: string,
  asOf: string,
): Promise<FinanceAging> {
  if (!isReportDate(asOf)) {
    throw new FinanceReportError(422, 'REPORT_ASOF_INVALID', 'Ngày chốt không hợp lệ (YYYY-MM-DD)')
  }
  const asOfDay = localDayStartUtc(asOf)

  const [orders, purchaseOrders] = await Promise.all([
    models.Order.find({
      siteId,
      isDeleted: { $ne: true },
      status: { $ne: 'cancelled' },
      $expr: { $gt: ['$totalAmount', '$paidAmount'] },
    }).select({ totalAmount: 1, paidAmount: 1, createdAt: 1 }).lean<OrderRecord[]>(),
    models.PurchaseOrder.find({
      siteId,
      isDeleted: { $ne: true },
      status: { $nin: ['draft', 'cancelled'] },
      $expr: { $gt: ['$totalAmount', '$paidAmount'] },
    }).select({ totalAmount: 1, paidAmount: 1, createdAt: 1 }).lean<PurchaseOrderRecord[]>(),
  ])

  const receivables = emptyAging()
  const payables = emptyAging()
  let receivableTotal = 0
  let payableTotal = 0

  const ageInDays = (createdAt: Date): number => {
    const created = new Date(createdAt)
    return Math.floor((asOfDay.getTime() + DAY_MS - 1 - created.getTime()) / DAY_MS)
  }

  for (const order of orders) {
    const outstanding = order.totalAmount - order.paidAmount
    if (outstanding <= 0) continue
    const bucket = receivables.find(entry => entry.key === bucketFor(ageInDays(order.createdAt)))!
    bucket.amount += outstanding
    bucket.count += 1
    receivableTotal += outstanding
  }
  for (const order of purchaseOrders) {
    const outstanding = order.totalAmount - order.paidAmount
    if (outstanding <= 0) continue
    const bucket = payables.find(entry => entry.key === bucketFor(ageInDays(order.createdAt)))!
    bucket.amount += outstanding
    bucket.count += 1
    payableTotal += outstanding
  }

  return {
    asOf,
    timeZone: REPORT_TIME_ZONE,
    receivables,
    payables,
    totals: { receivables: receivableTotal, payables: payableTotal },
  }
}

export interface LedgerRow {
  id: string
  paidAt: string
  day: string
  code: string
  direction: string
  method: string
  amount: number
  state: string
  referenceCode: string
  voidedAt: string | null
}

export interface LedgerResult {
  data: LedgerRow[]
  nextCursor: string | null
  hasMore: boolean
  totals: { receivable: number, payable: number, voided: number }
}

/** `paidAtMillis:_id` — enough to continue after a row that is not unique by date. */
function ledgerCursorOf(row: { _id: Types.ObjectId, paidAt: Date }): string {
  return `${new Date(row.paidAt).getTime()}:${String(row._id)}`
}

function parseLedgerCursor(value: unknown): { paidAt: Date, id: Types.ObjectId } | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') {
    throw new FinanceReportError(422, 'REPORT_CURSOR_INVALID', 'Con trỏ trang không hợp lệ')
  }
  const [millis, id] = value.split(':')
  const paidAt = Number(millis)
  if (!Number.isFinite(paidAt) || !id || !Types.ObjectId.isValid(id)) {
    throw new FinanceReportError(422, 'REPORT_CURSOR_INVALID', 'Con trỏ trang không hợp lệ')
  }
  return { paidAt: new Date(paidAt), id: new Types.ObjectId(id) }
}

export interface LedgerParams {
  from?: unknown
  to?: unknown
  state?: unknown
  cursor?: unknown
  limit?: unknown
}

/**
 * The payment ledger: every posted and voided row in the range, newest first.
 * A voided row stays here with `state: "voided"` so a reversal is visible, but it
 * is summed into `totals.voided` and never into money received or paid.
 */
export async function financeLedger(
  model: Model<PaymentDocument>,
  siteId: string,
  params: LedgerParams,
): Promise<LedgerResult> {
  const range = resolveRange(params.from, params.to)
  const limit = Math.min(Math.max(Math.trunc(Number(params.limit ?? DEFAULT_LEDGER_LIMIT)) || DEFAULT_LEDGER_LIMIT, 1), MAX_LEDGER_LIMIT)
  const filter: Record<string, unknown> = { siteId, paidAt: { $gte: range.startUtc, $lt: range.endUtc } }
  if (params.state === 'posted' || params.state === 'voided') filter.state = params.state
  else if (params.state != null && params.state !== '') {
    throw new FinanceReportError(422, 'REPORT_STATE_INVALID', 'Trạng thái không hợp lệ', { state: params.state })
  }
  const cursor = parseLedgerCursor(params.cursor)
  if (cursor) {
    // The ledger is ordered by payment date, so the cursor carries both the date
    // and the id of the last row; paging by id alone would skip rows when two
    // payments share a timestamp.
    filter.$or = [
      { paidAt: { $lt: cursor.paidAt } },
      { paidAt: cursor.paidAt, _id: { $lt: cursor.id } },
    ]
  }

  const records = await model.find(filter)
    .sort({ paidAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<PaymentRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const aggregateFilter: Record<string, unknown> = { siteId, paidAt: { $gte: range.startUtc, $lt: range.endUtc } }
  const totals = await model.aggregate<{ _id: { direction: string, state: string }, total: number }>([
    { $match: aggregateFilter },
    { $group: { _id: { direction: '$direction', state: '$state' }, total: { $sum: '$amount' } } },
  ])
  const summary = { receivable: 0, payable: 0, voided: 0 }
  for (const row of totals) {
    if (row._id.state === 'voided') summary.voided += row.total
    else if (row._id.direction === 'receivable') summary.receivable += row.total
    else summary.payable += row.total
  }

  return {
    data: page.map(record => ({
      id: String(record._id),
      paidAt: new Date(record.paidAt).toISOString(),
      day: localDayOf(new Date(record.paidAt)),
      code: record.code,
      direction: record.direction,
      method: record.method ?? 'other',
      amount: record.amount,
      state: record.state,
      referenceCode: record.referenceCode ?? '',
      voidedAt: record.voidedAt ? new Date(record.voidedAt).toISOString() : null,
    })),
    nextCursor: hasMore ? ledgerCursorOf(page[page.length - 1]!) : null,
    hasMore,
    totals: summary,
  }
}

const CSV_COLUMNS = ['Ngày', 'Mã phiếu', 'Loại', 'Phương thức', 'Số tiền', 'Trạng thái', 'Chứng từ'] as const

/**
 * One CSV cell, safe to open in a spreadsheet: quotes doubled, and a value that
 * starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe so Excel treats
 * it as text instead of a formula. Payment codes come from operators, and a code
 * like `=HYPERLINK(...)` must never become executable in a finance export.
 */
export function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function ledgerToCsv(rows: LedgerRow[], range: ReportRange): string {
  const lines: string[] = [
    `# Báo cáo sổ chi trả ${range.from} → ${range.to} (${REPORT_TIME_ZONE})`,
    CSV_COLUMNS.join(','),
  ]
  for (const row of rows) {
    lines.push([
      row.day,
      row.code,
      row.direction === 'receivable' ? 'Thu' : 'Chi',
      row.method,
      row.amount,
      row.state === 'voided' ? 'Đã huỷ' : 'Đã ghi',
      row.referenceCode,
    ].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** Bounded export: a finance CSV is a document to keep, not a database dump. */
export async function exportLedgerCsv(
  model: Model<PaymentDocument>,
  siteId: string,
  params: LedgerParams,
): Promise<{ csv: string, rows: number, truncated: boolean }> {
  const range = resolveRange(params.from, params.to)
  const filter: Record<string, unknown> = { siteId, paidAt: { $gte: range.startUtc, $lt: range.endUtc } }
  if (params.state === 'posted' || params.state === 'voided') filter.state = params.state

  const records = await model.find(filter)
    .sort({ paidAt: -1, _id: -1 })
    .limit(MAX_EXPORT_ROWS + 1)
    .lean<PaymentRecord[]>()
  const truncated = records.length > MAX_EXPORT_ROWS
  const page = truncated ? records.slice(0, MAX_EXPORT_ROWS) : records

  const csv = ledgerToCsv(page.map(record => ({
    id: String(record._id),
    paidAt: new Date(record.paidAt).toISOString(),
    day: localDayOf(new Date(record.paidAt)),
    code: record.code,
    direction: record.direction,
    method: record.method ?? 'other',
    amount: record.amount,
    state: record.state,
    referenceCode: record.referenceCode ?? '',
    voidedAt: record.voidedAt ? new Date(record.voidedAt).toISOString() : null,
  })), range)

  return { csv, rows: page.length, truncated }
}
