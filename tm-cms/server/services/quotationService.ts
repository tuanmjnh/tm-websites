import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { CustomerDocument } from '../models/customer'
import type { OrderDocument } from '../models/order'
import {
  QuotationInvariantError,
  type QuotationAddress,
  type QuotationDocument,
  type QuotationItem,
  normalizeQuotationInput,
} from '../models/quotation'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class QuotationServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'QuotationServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type QuotationRecord = QuotationDocument & { _id: Types.ObjectId }

export interface QuotationAdmin {
  id: string
  siteId: string
  code: string
  customerId: string | null
  userId: string
  channel: string
  status: string
  currency: string
  items: QuotationItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  shippingAddress: QuotationAddress
  adminNote: string
  customerNote: string
  internalNote: string
  assignedStaffId: string | null
  warehouseId: string | null
  validUntil: number | null
  convertedOrderId: string | null
  estimatedCost: number
  estimatedProfit: number
  version: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface QuotationListParams {
  q?: string
  status?: string | null
  customerId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface QuotationListResult {
  data: QuotationAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'quotation'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
}

export function toAdminQuotation(record: QuotationRecord): QuotationAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    customerId: record.customerId ? String(record.customerId) : null,
    userId: record.userId ?? '',
    channel: record.channel ?? 'admin',
    status: record.status ?? 'draft',
    currency: record.currency ?? 'VND',
    items: (record.items ?? []).map((item) => ({
      itemId: item.itemId ?? null,
      variantId: item.variantId ?? null,
      itemName: item.itemName,
      sku: item.sku ?? '',
      attributes: item.attributes ?? {},
      price: item.price ?? 0,
      quantity: item.quantity ?? 1,
      thumbnail: item.thumbnail ?? null,
    })),
    itemsPrice: record.itemsPrice ?? 0,
    shippingFee: record.shippingFee ?? 0,
    discountAmount: record.discountAmount ?? 0,
    totalAmount: record.totalAmount ?? 0,
    shippingAddress: {
      fullName: record.shippingAddress?.fullName ?? '',
      phone: record.shippingAddress?.phone ?? '',
      street: record.shippingAddress?.street ?? '',
      ward: record.shippingAddress?.ward ?? '',
      district: record.shippingAddress?.district ?? '',
      city: record.shippingAddress?.city ?? '',
      country: record.shippingAddress?.country ?? '',
    },
    adminNote: record.adminNote ?? '',
    customerNote: record.customerNote ?? '',
    internalNote: record.internalNote ?? '',
    assignedStaffId: record.assignedStaffId ?? null,
    warehouseId: record.warehouseId ?? null,
    validUntil: record.validUntil ?? null,
    convertedOrderId: record.convertedOrderId ? String(record.convertedOrderId) : null,
    estimatedCost: record.estimatedCost ?? 0,
    estimatedProfit: record.estimatedProfit ?? 0,
    version: record.version ?? 1,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new QuotationServiceError(422, code, 'Quotation id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof QuotationInvariantError) {
    throw new QuotationServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new QuotationServiceError(409, 'QUOTATION_CODE_EXISTS', 'Another quotation already uses this code')
  }
  throw error
}

function generatedCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `QUO-${yy}${mm}${dd}-${new Types.ObjectId().toHexString().slice(-6).toUpperCase()}`
}

function computeTotals(draft: ReturnType<typeof normalizeQuotationInput>): void {
  const itemsPrice = draft.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  draft.itemsPrice = itemsPrice
  draft.totalAmount = Math.max(0, itemsPrice + draft.shippingFee - draft.discountAmount)
  if (draft.estimatedCost > 0) {
    draft.estimatedProfit = draft.totalAmount - draft.estimatedCost
  }
}

export async function listQuotations(
  model: Model<QuotationDocument>,
  siteId: string,
  params: QuotationListParams = {},
): Promise<QuotationListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.status) filter.status = params.status
  if (params.customerId) filter.customerId = objectId(params.customerId, 'QUOTATION_CUSTOMER_ID_INVALID')

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { code: pattern },
      { adminNote: pattern },
      { customerNote: pattern },
      { 'items.itemName': pattern },
      { 'items.sku': pattern },
    ]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'QUOTATION_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<QuotationRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminQuotation),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await quotationCounts(model, siteId),
  }
}

async function quotationCounts(model: Model<QuotationDocument>, siteId: string): Promise<QuotationListResult['counts']> {
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return { all: all - deleted, active: all - deleted, deleted }
}

export async function getQuotation(model: Model<QuotationDocument>, siteId: string, id: string): Promise<QuotationAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'QUOTATION_ID_INVALID'), siteId }).lean<QuotationRecord>()
  if (!record) throw new QuotationServiceError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found')
  return toAdminQuotation(record)
}

export async function createQuotation(
  model: Model<QuotationDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<QuotationAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeQuotationInput({
        ...source,
        siteId,
        code: source.code || generatedCode(),
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  computeTotals(draft)

  let created
  try {
    created = await model.create({
      ...draft,
      customerId: draft.customerId ? new Types.ObjectId(draft.customerId) : null,
      convertedOrderId: draft.convertedOrderId ? new Types.ObjectId(draft.convertedOrderId) : null,
      revision: 1,
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as QuotationRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['code', 'customerId', 'status', 'totalAmount', 'items'],
  })

  return toAdminQuotation(record)
}

export async function updateQuotation(
  model: Model<QuotationDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<QuotationAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new QuotationServiceError(422, 'QUOTATION_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'QUOTATION_ID_INVALID'), siteId }).lean<QuotationRecord>()
  if (!record) throw new QuotationServiceError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found')
  if (record.isDeleted) throw new QuotationServiceError(409, 'QUOTATION_DELETED', 'Quotation is deleted')
  if (record.status === 'converted') {
    throw new QuotationServiceError(409, 'QUOTATION_CONVERTED', 'A converted quotation cannot be edited')
  }

  const currentDraft = {
    code: record.code,
    customerId: record.customerId ? String(record.customerId) : null,
    userId: record.userId,
    channel: record.channel,
    status: body.status ?? record.status,
    currency: record.currency,
    items: body.items ?? record.items,
    itemsPrice: record.itemsPrice,
    shippingFee: body.shippingFee ?? record.shippingFee,
    discountAmount: body.discountAmount ?? record.discountAmount,
    totalAmount: record.totalAmount,
    shippingAddress: body.shippingAddress ?? record.shippingAddress,
    adminNote: body.adminNote ?? record.adminNote,
    customerNote: body.customerNote ?? record.customerNote,
    internalNote: body.internalNote ?? record.internalNote,
    assignedStaffId: body.assignedStaffId ?? record.assignedStaffId,
    warehouseId: body.warehouseId ?? record.warehouseId,
    validUntil: body.validUntil ?? record.validUntil,
    convertedOrderId: record.convertedOrderId ? String(record.convertedOrderId) : null,
    estimatedCost: body.estimatedCost ?? record.estimatedCost,
    estimatedProfit: record.estimatedProfit,
    version: body.version ?? record.version,
  }

  const draft = (() => {
    try {
      return normalizeQuotationInput({ ...currentDraft, siteId, code: currentDraft.code })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  computeTotals(draft)

  let updated: QuotationRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          status: draft.status,
          currency: draft.currency,
          items: draft.items,
          itemsPrice: draft.itemsPrice,
          shippingFee: draft.shippingFee,
          discountAmount: draft.discountAmount,
          totalAmount: draft.totalAmount,
          shippingAddress: draft.shippingAddress,
          adminNote: draft.adminNote,
          customerNote: draft.customerNote,
          internalNote: draft.internalNote,
          assignedStaffId: draft.assignedStaffId,
          warehouseId: draft.warehouseId,
          validUntil: draft.validUntil,
          estimatedCost: draft.estimatedCost,
          estimatedProfit: draft.estimatedProfit,
          version: draft.version,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<QuotationRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new QuotationServiceError(409, 'QUOTATION_REVISION_CONFLICT', 'Quotation was changed by someone else; reload before saving', { expected: revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status', 'items', 'totalAmount'],
  })

  return toAdminQuotation(updated)
}

export async function softDeleteQuotation(
  model: Model<QuotationDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new QuotationServiceError(422, 'QUOTATION_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'QUOTATION_ID_INVALID'), siteId }).lean<QuotationRecord>()
  if (!record) throw new QuotationServiceError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<QuotationRecord | null>()

  if (!deleted) throw new QuotationServiceError(409, 'QUOTATION_REVISION_CONFLICT', 'Quotation was changed by someone else; reload before deleting')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })

  return { id: String(record._id), code: record.code }
}

export async function restoreQuotation(
  model: Model<QuotationDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<QuotationAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new QuotationServiceError(422, 'QUOTATION_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'QUOTATION_ID_INVALID'), siteId }).lean<QuotationRecord>()
  if (!record) throw new QuotationServiceError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<QuotationRecord | null>()

  if (!restored) throw new QuotationServiceError(409, 'QUOTATION_REVISION_CONFLICT', 'Quotation was changed by someone else; reload before restoring')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })

  return toAdminQuotation(restored)
}

/**
 * Converts an accepted quotation into an order. Idempotent: a quotation that
 * already has a convertedOrderId returns the existing order instead of creating
 * a second one.
 */
export async function convertQuotationToOrder(
  quotationModel: Model<QuotationDocument>,
  orderModel: Model<OrderDocument>,
  customerModel: Model<CustomerDocument> | null,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<{ quotation: QuotationAdmin; orderId: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new QuotationServiceError(422, 'QUOTATION_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await quotationModel.findOne({ _id: objectId(id, 'QUOTATION_ID_INVALID'), siteId }).lean<QuotationRecord>()
  if (!record) throw new QuotationServiceError(404, 'QUOTATION_NOT_FOUND', 'Quotation not found')
  if (record.isDeleted) throw new QuotationServiceError(409, 'QUOTATION_DELETED', 'Quotation is deleted')

  if (record.convertedOrderId) {
    return { quotation: toAdminQuotation(record), orderId: String(record.convertedOrderId) }
  }

  // Build order from quotation
  const orderCode = `ORD-${record.code.replace(/^QUO-/, '')}`
  const orderItems = record.items.map((item) => ({
    itemId: item.itemId ?? null,
    variantId: item.variantId ?? null,
    supplierId: null,
    itemName: item.itemName,
    sku: item.sku ?? '',
    attributes: item.attributes ?? {},
    price: item.price,
    quantity: item.quantity,
    thumbnail: item.thumbnail ?? null,
    returnedQuantity: 0,
  }))

  let createdOrder
  try {
    createdOrder = await orderModel.create({
      siteId,
      code: orderCode,
      customerId: record.customerId,
      channel: 'admin',
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentMethod: 'cash',
      currency: record.currency,
      items: orderItems,
      itemsPrice: record.itemsPrice,
      shippingFee: record.shippingFee,
      discountAmount: record.discountAmount,
      totalAmount: record.totalAmount,
      paidAmount: 0,
      shippingAddress: record.shippingAddress,
      note: record.internalNote ?? '',
      warehouseId: record.warehouseId,
      history: [{ status: 'pending', at: new Date().toISOString(), note: `Converted from ${record.code}`, actorId: meta?.actorId ?? '' }],
      revision: 1,
      schemaVersion: 1,
    })
  } catch {
    // code collision: append suffix
    const fallback = await orderModel.create({
      siteId,
      code: `${orderCode}-${new Types.ObjectId().toHexString().slice(-4).toUpperCase()}`,
      customerId: record.customerId,
      channel: 'admin',
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentMethod: 'cash',
      currency: record.currency,
      items: orderItems,
      itemsPrice: record.itemsPrice,
      shippingFee: record.shippingFee,
      discountAmount: record.discountAmount,
      totalAmount: record.totalAmount,
      paidAmount: 0,
      shippingAddress: record.shippingAddress,
      note: record.internalNote ?? '',
      warehouseId: record.warehouseId,
      history: [{ status: 'pending', at: new Date().toISOString(), note: `Converted from ${record.code}`, actorId: meta?.actorId ?? '' }],
      revision: 1,
      schemaVersion: 1,
    }).catch(() => null)
    if (!fallback) throw new QuotationServiceError(500, 'ORDER_CREATE_FAILED', 'Could not create order from quotation')
    createdOrder = fallback
  }

  const orderId = String(createdOrder._id)

  // Update quotation: status converted, convertedOrderId
  const updated = await quotationModel.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    {
      $set: { status: 'converted', convertedOrderId: new Types.ObjectId(orderId) },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<QuotationRecord | null>()

  if (!updated) {
    // rollback order? best-effort delete
    await orderModel.deleteOne({ _id: new Types.ObjectId(orderId) })
    throw new QuotationServiceError(409, 'QUOTATION_REVISION_CONFLICT', 'Quotation was changed by someone else; reload before converting')
  }

  // customer metrics
  if (record.customerId && customerModel) {
    try {
      await customerModel.updateOne(
        { _id: record.customerId, siteId },
        {
          $inc: { 'metrics.totalOrders': 1, 'metrics.totalSpent': record.totalAmount },
          $set: { 'metrics.lastOrderAt': new Date() },
        },
      )
    } catch {
      // ignore
    }
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: 'converted',
    changedFields: ['status', 'convertedOrderId'],
  })

  return { quotation: toAdminQuotation(updated), orderId }
}
