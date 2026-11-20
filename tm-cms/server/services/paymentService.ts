import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  PaymentInvariantError,
  type PaymentAllocation,
  type PaymentDirection,
  type PaymentDocument,
  type PaymentMethod,
  type PaymentReference,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_REFERENCES,
  normalizePaymentCode,
} from '../models/payment'
import type { OrderDocument } from '../models/order'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class PaymentServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'PaymentServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type PaymentRecord = PaymentDocument & { _id: Types.ObjectId }

export interface PaymentAdmin {
  id: string
  siteId: string
  code: string
  direction: PaymentDirection
  referenceModel: PaymentReference
  referenceId: string
  referenceCode: string
  partyId: string | null
  allocations: { referenceModel: PaymentReference, referenceId: string, referenceCode: string, amount: number }[]
  amount: number
  currency: string
  method: PaymentMethod
  state: string
  note: string
  paidAt: string
  performerId: string | null
  voidedAt: string | null
  voidReason: string
  reconciledAt: string | null
  reconciliationRef: string
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface PaymentListParams {
  direction?: string | null
  referenceModel?: string | null
  referenceId?: string | null
  partyId?: string | null
  state?: string | null
  cursor?: string | null
  limit?: number
}

export interface PaymentListResult {
  data: PaymentAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; posted: number; voided: number; postedAmount: number }
}

export interface PaymentTargets {
  order?: Model<OrderDocument> | null
  purchaseOrder?: Model<PurchaseOrderDocument> | null
}

/** Both documents the money can be applied to carry these four fields. */
interface PayableRecord {
  _id: Types.ObjectId
  siteId: string
  code: string
  status: string
  totalAmount: number
  paidAmount: number
  isDeleted?: boolean
  revision: number
  customerId?: Types.ObjectId | null
  supplierId?: Types.ObjectId | null
}

const RESOURCE = 'payment'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new PaymentServiceError(422, code, 'Id is not valid')
  }
  return new Types.ObjectId(value)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `PAY-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

/**
 * The status a document's `paidAmount` implies. The same rule the order and
 * purchase-order services apply on their own updates, kept in one pipeline so a
 * payment can never leave the two fields disagreeing.
 */
function statusExpression(): Record<string, unknown> {
  return {
    $cond: [
      { $gte: ['$paidAmount', '$totalAmount'] },
      { $cond: [{ $gt: ['$totalAmount', 0] }, 'paid', { $cond: [{ $gt: ['$paidAmount', 0] }, 'partial', 'unpaid'] }] },
      { $cond: [{ $gt: ['$paidAmount', 0] }, 'partial', 'unpaid'] },
    ],
  }
}

export function toAdminPayment(record: PaymentRecord): PaymentAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    direction: record.direction,
    referenceModel: record.referenceModel,
    referenceId: String(record.referenceId),
    referenceCode: record.referenceCode ?? '',
    partyId: record.partyId ? String(record.partyId) : null,
    allocations: (record.allocations ?? []).map((entry) => ({
      referenceModel: entry.referenceModel,
      referenceId: String(entry.referenceId),
      referenceCode: entry.referenceCode ?? '',
      amount: entry.amount ?? 0,
    })),
    amount: record.amount ?? 0,
    currency: record.currency ?? 'VND',
    method: record.method ?? 'cash',
    state: record.state ?? 'posted',
    note: record.note ?? '',
    paidAt: new Date(record.paidAt).toISOString(),
    performerId: record.performerId ?? null,
    voidedAt: iso(record.voidedAt),
    voidReason: record.voidReason ?? '',
    reconciledAt: iso(record.reconciledAt),
    reconciliationRef: record.reconciliationRef ?? '',
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export async function listPayments(
  model: Model<PaymentDocument>,
  siteId: string,
  params: PaymentListParams = {},
): Promise<PaymentListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (params.direction) filter.direction = params.direction
  if (params.referenceModel) filter.referenceModel = params.referenceModel
  if (params.referenceId) filter.referenceId = objectId(params.referenceId, 'PAYMENT_REFERENCE_ID_INVALID')
  if (params.partyId) filter.partyId = objectId(params.partyId, 'PAYMENT_PARTY_ID_INVALID')
  if (params.state) filter.state = params.state
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'PAYMENT_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<PaymentRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const countFilter: Record<string, unknown> = { siteId }
  if (params.direction) countFilter.direction = params.direction
  if (params.referenceModel) countFilter.referenceModel = params.referenceModel
  if (params.referenceId) countFilter.referenceId = filter.referenceId
  if (params.partyId) countFilter.partyId = filter.partyId

  const [all, posted, voided, postedSums] = await Promise.all([
    model.countDocuments(countFilter),
    model.countDocuments({ ...countFilter, state: 'posted' }),
    model.countDocuments({ ...countFilter, state: 'voided' }),
    model.aggregate<{ total: number }>([
      { $match: { ...countFilter, state: 'posted' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ])

  return {
    data: page.map(toAdminPayment),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all, posted, voided, postedAmount: round(postedSums[0]?.total ?? 0) },
  }
}

export async function getPayment(model: Model<PaymentDocument>, siteId: string, id: string): Promise<PaymentAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'PAYMENT_ID_INVALID'), siteId })
    .lean<PaymentRecord>()
  if (!record) throw new PaymentServiceError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')
  return toAdminPayment(record)
}

function readBody(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function readAmount(value: unknown): number {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PaymentServiceError(422, 'PAYMENT_AMOUNT_INVALID', 'Payment amount must be greater than zero')
  }
  return round(amount)
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], code: string, label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new PaymentServiceError(422, code, `${label} is not one of ${allowed.join(', ')}`)
  }
  return value as T
}

async function loadTarget(
  targets: PaymentTargets,
  siteId: string,
  referenceModel: PaymentReference,
  referenceId: string,
): Promise<PayableRecord> {
  const model = referenceModel === 'Order' ? targets.order : targets.purchaseOrder
  if (!model) {
    throw new PaymentServiceError(503, 'PAYMENT_REFERENCE_UNAVAILABLE', 'The module that owns this document is not available')
  }
  const record = await (model as unknown as Model<PayableRecord>)
    .findOne({ _id: objectId(referenceId, 'PAYMENT_REFERENCE_ID_INVALID'), siteId })
    .lean<PayableRecord | null>()
  if (!record) throw new PaymentServiceError(404, 'PAYMENT_REFERENCE_NOT_FOUND', 'The document this payment refers to was not found')
  if (record.isDeleted) throw new PaymentServiceError(409, 'PAYMENT_REFERENCE_DELETED', 'The document this payment refers to is deleted')
  return record
}

function targetModel(targets: PaymentTargets, referenceModel: PaymentReference): Model<PayableRecord> {
  const model = referenceModel === 'Order' ? targets.order : targets.purchaseOrder
  if (!model) {
    throw new PaymentServiceError(503, 'PAYMENT_REFERENCE_UNAVAILABLE', 'The module that owns this document is not available')
  }
  return model as unknown as Model<PayableRecord>
}

/**
 * Post a payment against an order or a purchase order.
 *
 * The document's `paidAmount` moves only when the outstanding balance still
 * covers the amount, and `paymentStatus` is recomputed in the same pipeline
 * stage, so an overpayment cannot slip between a check and a write.
 */
interface AllocationInput {
  referenceModel: PaymentReference
  referenceId: string
  amount: number
}

const MAX_ALLOCATIONS = 50

function readAllocations(entries: unknown[]): AllocationInput[] {
  if (entries.length > MAX_ALLOCATIONS) {
    throw new PaymentServiceError(422, 'PAYMENT_TOO_MANY_ALLOCATIONS', `A payment may cover at most ${MAX_ALLOCATIONS} documents`)
  }
  return entries.map((entry) => {
    const record = readBody(entry)
    return {
      referenceModel: readEnum(record.referenceModel, PAYMENT_REFERENCES, 'PAYMENT_REFERENCE_MODEL_INVALID', 'Reference model'),
      referenceId: String(record.referenceId ?? ''),
      amount: readAmount(record.amount),
    }
  })
}

export async function recordPayment(
  model: Model<PaymentDocument>,
  targets: PaymentTargets,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<PaymentAdmin> {
  const body = readBody(input)
  const direction = readEnum(body.direction, PAYMENT_DIRECTIONS, 'PAYMENT_DIRECTION_INVALID', 'Direction')
  const method = body.method === undefined
    ? 'cash'
    : readEnum(body.method, PAYMENT_METHODS, 'PAYMENT_METHOD_INVALID', 'Payment method')

  // When allocations are supplied they carry their own amounts; the top-level
  // amount/referenceModel/referenceId are then optional and ignored.
  const rawAllocations = Array.isArray(body.allocations) ? body.allocations : []
  const allocations = rawAllocations.length > 0
    ? readAllocations(rawAllocations)
    : [{
        referenceModel: readEnum(body.referenceModel, PAYMENT_REFERENCES, 'PAYMENT_REFERENCE_MODEL_INVALID', 'Reference model'),
        referenceId: String(body.referenceId ?? ''),
        amount: readAmount(body.amount),
      }]
  if (!allocations[0]!.referenceId) {
    throw new PaymentServiceError(422, 'PAYMENT_REFERENCE_ID_INVALID', 'Reference id is required')
  }

  // Every document in one payment must belong to the same direction, otherwise
  // a single payment would mix money in and money out.
  const referenceModels = new Set(allocations.map((entry) => entry.referenceModel))
  if (referenceModels.size > 1) {
    throw new PaymentServiceError(422, 'PAYMENT_MIXED_REFERENCES', 'A payment cannot cover both orders and purchase orders')
  }
  const referenceModel = allocations[0]!.referenceModel
  const expectedDirection: PaymentDirection = referenceModel === 'Order' ? 'receivable' : 'payable'
  if (direction !== expectedDirection) {
    throw new PaymentServiceError(422, 'PAYMENT_DIRECTION_MISMATCH', `A payment for ${referenceModel} is ${expectedDirection}`, {
      expected: expectedDirection,
      received: direction,
    })
  }

  // Load every target up front so a missing/closed document fails before any
  // balance moves.
  const loaded: { allocation: AllocationInput, target: PayableRecord, payable: Model<PayableRecord> }[] = []
  for (const allocation of allocations) {
    const target = await loadTarget(targets, siteId, allocation.referenceModel, allocation.referenceId)
    if (['cancelled', 'refunded'].includes(target.status)) {
      throw new PaymentServiceError(409, 'PAYMENT_REFERENCE_CLOSED', `The document is ${target.status} and cannot take a payment`, {
        status: target.status,
        referenceId: allocation.referenceId,
      })
    }
    const outstanding = round((target.totalAmount ?? 0) - (target.paidAmount ?? 0))
    if (allocation.amount > outstanding) {
      throw new PaymentServiceError(409, 'PAYMENT_EXCEEDS_OUTSTANDING', 'The payment is larger than the outstanding balance', {
        outstanding,
        amount: allocation.amount,
        total: target.totalAmount,
        paid: target.paidAmount,
        referenceId: allocation.referenceId,
      })
    }
    loaded.push({ allocation, target, payable: targetModel(targets, allocation.referenceModel) })
  }

  // Reject duplicate references within one payment.
  const seen = new Set<string>()
  for (const { allocation } of loaded) {
    const key = `${allocation.referenceModel}:${allocation.referenceId}`
    if (seen.has(key)) {
      throw new PaymentServiceError(409, 'PAYMENT_DUPLICATE_REFERENCE', 'The same document cannot appear twice in one payment', { referenceId: allocation.referenceId })
    }
    seen.add(key)
  }

  const code = normalizePaymentCode(body.code) || generatedCode()
  const paidAt = body.paidAt === undefined ? new Date() : new Date(String(body.paidAt))
  if (Number.isNaN(paidAt.getTime())) {
    throw new PaymentServiceError(422, 'PAYMENT_PAID_AT_INVALID', 'paidAt is not a valid date')
  }

  // Apply each balance move; track what moved so a failure can roll everything back.
  const updatedTargets: { payable: Model<PayableRecord>, record: PayableRecord, amount: number }[] = []
  for (const { allocation, target, payable } of loaded) {
    const updated = await payable
      .findOneAndUpdate(
        {
          _id: target._id,
          siteId,
          revision: target.revision,
          $expr: { $gte: [{ $subtract: ['$totalAmount', '$paidAmount'] }, allocation.amount] },
        },
        [
          { $set: { paidAmount: { $add: ['$paidAmount', allocation.amount] } } },
          { $set: { paymentStatus: statusExpression(), revision: { $add: ['$revision', 1] } } },
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean<PayableRecord | null>()

    if (!updated) {
      // Roll back the moves already applied.
      for (const moved of updatedTargets) {
        await moved.payable
          .findOneAndUpdate(
            { _id: moved.record._id, siteId, revision: moved.record.revision },
            [
              { $set: { paidAmount: { $subtract: ['$paidAmount', moved.amount] } } },
              { $set: { paymentStatus: statusExpression(), revision: { $add: ['$revision', 1] } } },
            ],
            { updatePipeline: true },
          )
          .lean()
      }
      throw new PaymentServiceError(409, 'PAYMENT_REFERENCE_CONFLICT', 'A document changed while the payment was being posted; reload and retry', {
        expectedRevision: target.revision,
        referenceId: allocation.referenceId,
      })
    }
    updatedTargets.push({ payable, record: updated, amount: allocation.amount })
  }

  const totalAmount = round(allocations.reduce((sum, entry) => sum + entry.amount, 0))
  const primary = loaded[0]!

  const allocationDocs: PaymentAllocation[] = loaded.map(({ allocation, target }) => ({
    referenceModel: allocation.referenceModel,
    referenceId: target._id,
    referenceCode: target.code,
    amount: allocation.amount,
  }))

  let created: PaymentRecord
  try {
    created = await model.create({
      siteId,
      code,
      direction,
      referenceModel: primary.allocation.referenceModel,
      referenceId: primary.target._id,
      referenceCode: primary.target.code,
      partyId: primary.allocation.referenceModel === 'Order'
        ? (primary.target.customerId ?? null)
        : (primary.target.supplierId ?? null),
      allocations: allocationDocs,
      amount: totalAmount,
      currency: typeof body.currency === 'string' ? body.currency.trim().toUpperCase().slice(0, 3) : 'VND',
      method,
      state: 'posted',
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '',
      paidAt,
      performerId: meta?.audit?.actor?.id ?? null,
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
      revision: 1,
    }) as PaymentRecord
  } catch (error) {
    // Undo every balance move.
    for (const moved of updatedTargets) {
      await moved.payable
        .findOneAndUpdate(
          { _id: moved.record._id, siteId, revision: moved.record.revision },
          [
            { $set: { paidAmount: { $subtract: ['$paidAmount', moved.amount] } } },
            { $set: { paymentStatus: statusExpression(), revision: { $add: ['$revision', 1] } } },
          ],
          { updatePipeline: true },
        )
        .lean()
    }
    const duplicate = (error as { code?: number }).code === 11000
    throw new PaymentServiceError(
      duplicate ? 409 : 502,
      duplicate ? 'PAYMENT_CODE_EXISTS' : 'PAYMENT_STORE_FAILED',
      duplicate ? 'Another payment already uses this code' : 'The payment could not be stored',
    )
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(created._id),
    resourceKey: created.code,
    action: 'create',
    revision: created.revision,
    fromStatus: null,
    toStatus: 'posted',
    changedFields: ['amount', 'referenceId', 'paidAt', 'allocations'],
  })

  return toAdminPayment(created)
}

/**
 * Void a posted payment. The row stays for the ledger, but the document it paid
 * goes back to the balance it had before, so `paidAmount` and the payment list
 * always tell the same story.
 */
export async function voidPayment(
  model: Model<PaymentDocument>,
  targets: PaymentTargets,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<PaymentAdmin> {
  const body = readBody(input)
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PaymentServiceError(422, 'PAYMENT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'PAYMENT_ID_INVALID'), siteId })
    .lean<PaymentRecord>()
  if (!record) throw new PaymentServiceError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')
  if (record.state === 'voided') {
    throw new PaymentServiceError(409, 'PAYMENT_ALREADY_VOIDED', 'This payment is already void')
  }

  const allocations = (record.allocations && record.allocations.length > 0)
    ? record.allocations
    : [{ referenceModel: record.referenceModel, referenceId: record.referenceId, referenceCode: record.referenceCode, amount: record.amount }]

  // Reverse every allocation; if any document can no longer cover its share,
  // report unbalanced before touching the payment row.
  const payables: { payable: Model<PayableRecord>, allocation: (typeof allocations)[number] }[] = []
  for (const allocation of allocations) {
    payables.push({ payable: targetModel(targets, allocation.referenceModel), allocation })
  }

  // Pre-check every document can cover its share before touching any of them.
  for (const { allocation } of payables) {
    const payable = targetModel(targets, allocation.referenceModel)
    const doc = await payable
      .findOne({ _id: allocation.referenceId, siteId })
      .lean<PayableRecord | null>()
    if (!doc || (doc.paidAmount ?? 0) < allocation.amount) {
      throw new PaymentServiceError(409, 'PAYMENT_VOID_UNBALANCED', 'A document no longer holds this payment amount; reconcile before voiding', {
        referenceModel: allocation.referenceModel,
        referenceId: String(allocation.referenceId),
        amount: allocation.amount,
      })
    }
  }

  const revertedDocs: PayableRecord[] = []
  for (const { payable, allocation } of payables) {
    const reverted = await payable
      .findOneAndUpdate(
        {
          _id: allocation.referenceId,
          siteId,
          $expr: { $gte: ['$paidAmount', allocation.amount] },
        },
        [
          { $set: { paidAmount: { $subtract: ['$paidAmount', allocation.amount] } } },
          { $set: { paymentStatus: statusExpression(), revision: { $add: ['$revision', 1] } } },
        ],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean<PayableRecord | null>()
    if (!reverted) {
      throw new PaymentServiceError(409, 'PAYMENT_VOID_UNBALANCED', 'A document no longer holds this payment amount; reconcile before voiding', {
        referenceModel: allocation.referenceModel,
        referenceId: String(allocation.referenceId),
        amount: allocation.amount,
      })
    }
    revertedDocs.push(reverted)
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : ''
  const voided = await model
    .findOneAndUpdate(
      { _id: record._id, siteId, revision, state: 'posted' },
      {
        $set: {
          state: 'voided',
          voidedAt: new Date(),
          voidedBy: meta?.audit?.actor?.id ?? null,
          voidReason: reason,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    )
    .lean<PaymentRecord | null>()

  if (!voided) {
    throw new PaymentServiceError(409, 'PAYMENT_REVISION_CONFLICT', 'Payment was changed by someone else; reload before voiding', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(voided._id),
    resourceKey: voided.code,
    action: 'update',
    revision: voided.revision,
    fromStatus: 'posted',
    toStatus: 'voided',
    changedFields: ['state', 'voidReason'],
  })

  return toAdminPayment(voided)
}

export function translatePaymentInvariant(error: unknown): never {
  if (error instanceof PaymentInvariantError) {
    throw new PaymentServiceError(422, error.code, error.message)
  }
  throw error
}

export async function reconcilePayment(
  model: Model<PaymentDocument>,
  siteId: string,
  id: string,
  reconciliationRef: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<PaymentAdmin> {
  const ref = String(reconciliationRef ?? '').trim().slice(0, 80)
  if (!ref) {
    throw new PaymentServiceError(422, 'PAYMENT_RECONCILIATION_REF_REQUIRED', 'A reconciliation reference is required')
  }
  if (!Types.ObjectId.isValid(id)) {
    throw new PaymentServiceError(422, 'PAYMENT_ID_INVALID', 'Payment id is not valid')
  }
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<PaymentRecord>()
  if (!record) throw new PaymentServiceError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')
  if (record.state !== 'posted') {
    throw new PaymentServiceError(409, 'PAYMENT_NOT_POSTED', 'Only posted payments can be reconciled')
  }
  if (record.reconciledAt) {
    throw new PaymentServiceError(409, 'PAYMENT_ALREADY_RECONCILED', 'Payment is already reconciled')
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, reconciledAt: null },
    { $set: { reconciledAt: new Date(), reconciliationRef: ref }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<PaymentRecord>()

  if (!updated) throw new PaymentServiceError(409, 'PAYMENT_RECONCILIATION_CONFLICT', 'Payment changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: 'posted',
    toStatus: 'posted',
    changedFields: ['reconciledAt', 'reconciliationRef'],
  })

  return toAdminPayment(updated)
}

export async function unreconcilePayment(
  model: Model<PaymentDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<PaymentAdmin> {
  if (!Types.ObjectId.isValid(id)) {
    throw new PaymentServiceError(422, 'PAYMENT_ID_INVALID', 'Payment id is not valid')
  }
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<PaymentRecord>()
  if (!record) throw new PaymentServiceError(404, 'PAYMENT_NOT_FOUND', 'Payment not found')
  if (!record.reconciledAt) {
    throw new PaymentServiceError(409, 'PAYMENT_NOT_RECONCILED', 'Payment is not reconciled')
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId },
    { $set: { reconciledAt: null, reconciliationRef: '' }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<PaymentRecord>()

  if (!updated) throw new PaymentServiceError(409, 'PAYMENT_RECONCILIATION_CONFLICT', 'Payment changed; retry')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: 'posted',
    toStatus: 'posted',
    changedFields: ['reconciledAt', 'reconciliationRef'],
  })

  return toAdminPayment(updated)
}
