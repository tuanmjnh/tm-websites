import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { PayableDocument } from '../models/payable'
import type { PurchaseOrderDocument } from '../models/purchaseOrder'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class PayableServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'PayableServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'payable' as const

type StoredPayable = PayableDocument & { _id: Types.ObjectId }

export interface PayableAdmin {
  id: string
  siteId: string
  code: string
  purchaseOrderId: string
  purchaseOrderCode: string
  supplierId: string | null
  amount: number
  currency: string
  status: string
  postedAt: string | null
  voidedAt: string | null
  voidReason: string
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function toAdmin(record: StoredPayable): PayableAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    purchaseOrderId: record.purchaseOrderId,
    purchaseOrderCode: record.purchaseOrderCode ?? '',
    supplierId: record.supplierId ?? null,
    amount: record.amount,
    currency: record.currency,
    status: record.status,
    postedAt: iso(record.postedAt),
    voidedAt: iso(record.voidedAt),
    voidReason: record.voidReason ?? '',
    revision: record.revision ?? 1,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `AP-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new PayableServiceError(422, code, 'Id is not valid')
  }
  return new Types.ObjectId(value)
}

/**
 * Post a payable for a received purchase order. Idempotent: if a payable
 * already exists for the PO, return it unchanged. Amount = totalAmount.
 */
export async function postPayableForPurchaseOrder(
  payableModel: Model<PayableDocument>,
  purchaseOrderModel: Model<PurchaseOrderDocument>,
  siteId: string,
  purchaseOrderId: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<PayableAdmin> {
  const po = await purchaseOrderModel.findOne({ _id: objectId(purchaseOrderId, 'PAYABLE_PO_ID_INVALID'), siteId }).lean<PurchaseOrderDocument & { _id: Types.ObjectId } | null>()
  if (!po) throw new PayableServiceError(404, 'PAYABLE_PO_NOT_FOUND', 'Purchase order not found')
  if (po.isDeleted) throw new PayableServiceError(409, 'PAYABLE_PO_DELETED', 'Purchase order is deleted')
  if (!['received', 'partial'].includes(po.status)) {
    throw new PayableServiceError(409, 'PAYABLE_PO_NOT_RECEIVED', 'A payable can only be posted for a received or partially received purchase order')
  }

  const existing = await payableModel.findOne({ siteId, purchaseOrderId: String(po._id) }).lean<StoredPayable | null>()
  if (existing) return toAdmin(existing)

  const amount = Number(po.totalAmount ?? 0)
  if (amount <= 0) throw new PayableServiceError(422, 'PAYABLE_AMOUNT_INVALID', 'Purchase order total must be positive')

  let created
  try {
    created = await payableModel.create({
      siteId,
      code: generatedCode(),
      purchaseOrderId: String(po._id),
      purchaseOrderCode: po.code,
      supplierId: po.supplierId ? String(po.supplierId) : null,
      amount,
      currency: 'VND',
      status: 'posted',
      postedAt: new Date(),
      voidedAt: null,
      voidReason: '',
      isDeleted: false,
      deletedAt: null,
      revision: 1,
    })
  } catch (error) {
    const dup = error as { code?: number }
    if (dup?.code === 11000) {
      const raced = await payableModel.findOne({ siteId, purchaseOrderId: String(po._id) }).lean<StoredPayable | null>()
      if (raced) return toAdmin(raced)
    }
    throw error
  }

  const record = created.toObject() as StoredPayable
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: 'posted',
    changedFields: ['purchaseOrderId', 'amount', 'status'],
  })
  return toAdmin(record)
}

export async function getPayable(
  model: Model<PayableDocument>,
  siteId: string,
  id: string,
): Promise<PayableAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new PayableServiceError(422, 'PAYABLE_ID_INVALID', 'Payable id is not valid')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StoredPayable | null>()
  if (!record) throw new PayableServiceError(404, 'PAYABLE_NOT_FOUND', 'Payable not found')
  return toAdmin(record)
}

export async function listPayables(
  model: Model<PayableDocument>,
  siteId: string,
  params: { status?: string, cursor?: string, limit?: number } = {},
): Promise<{ data: PayableAdmin[], nextCursor: string | null, hasMore: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), 100)
  const filter: Record<string, unknown> = { siteId, isDeleted: { $ne: true } }
  if (params.status) filter.status = params.status
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }
  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<StoredPayable[]>()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return { data: page.map(toAdmin), nextCursor: hasMore ? String(page[page.length - 1]!._id) : null, hasMore }
}

export async function voidPayable(
  model: Model<PayableDocument>,
  siteId: string,
  id: string,
  reason: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<PayableAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new PayableServiceError(422, 'PAYABLE_ID_INVALID', 'Payable id is not valid')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StoredPayable | null>()
  if (!record) throw new PayableServiceError(404, 'PAYABLE_NOT_FOUND', 'Payable not found')
  if (record.status === 'voided') throw new PayableServiceError(409, 'PAYABLE_ALREADY_VOIDED', 'Payable is already voided')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: record.revision },
    { $set: { status: 'voided', voidedAt: new Date(), voidReason: reason.trim().slice(0, 500) }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<StoredPayable | null>()
  if (!updated) throw new PayableServiceError(409, 'PAYABLE_REVISION_CONFLICT', 'Payable was changed by someone else')
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'cancel',
    revision: updated.revision,
    fromStatus: 'posted',
    toStatus: 'voided',
    changedFields: ['status', 'voidedAt', 'voidReason'],
  })
  return toAdmin(updated)
}