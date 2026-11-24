import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  ShippingCarrierInvariantError,
  type ShippingCarrierDocument,
  normalizeShippingCarrierInput,
} from '../models/shippingCarrier'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class ShippingCarrierServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ShippingCarrierServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type ShippingCarrierRecord = ShippingCarrierDocument & { _id: Types.ObjectId }

export interface ShippingCarrierAdmin {
  id: string
  siteId: string
  code: string
  name: string
  trackingUrl: string
  phone: string
  note: string
  isActive: boolean
  sort: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface ShippingCarrierListParams {
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface ShippingCarrierListResult {
  data: ShippingCarrierAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'shipping_carrier'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminShippingCarrier(record: ShippingCarrierRecord): ShippingCarrierAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    name: record.name,
    trackingUrl: record.trackingUrl ?? '',
    phone: record.phone ?? '',
    note: record.note ?? '',
    isActive: record.isActive !== false,
    sort: record.sort ?? 0,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision ?? 1,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: string, code: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw new ShippingCarrierServiceError(422, code, 'Invalid id')
  return new Types.ObjectId(value)
}

export async function listShippingCarriers(
  model: Model<ShippingCarrierDocument>,
  siteId: string,
  params: ShippingCarrierListParams = {},
): Promise<ShippingCarrierListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  const cursor = params.cursor ? objectId(params.cursor, 'SHIPPING_CARRIER_CURSOR_INVALID') : null
  if (cursor) filter._id = { $lt: cursor }
  const records = await model.find(filter).sort({ sort: 1, _id: -1 }).limit(limit + 1).lean<ShippingCarrierRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records
  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])
  return {
    data: page.map(toAdminShippingCarrier),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all: all - deleted, active: all - deleted, deleted },
  }
}

export async function getShippingCarrier(model: Model<ShippingCarrierDocument>, siteId: string, id: string): Promise<ShippingCarrierAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'SHIPPING_CARRIER_ID_INVALID'), siteId }).lean<ShippingCarrierRecord>()
  if (!record) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  return toAdminShippingCarrier(record)
}

export async function createShippingCarrier(
  model: Model<ShippingCarrierDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<ShippingCarrierAdmin> {
  const draft = (() => {
    try {
      return normalizeShippingCarrierInput({ ...(input as Record<string, unknown>), siteId })
    } catch (error) {
      if (error instanceof ShippingCarrierInvariantError) throw new ShippingCarrierServiceError(422, error.code, error.message)
      throw error
    }
  })()
  try {
    const created = await model.create({ ...draft, revision: 1 })
    if (meta?.audit) {
      await recordContentAudit(meta.audit, {
        resourceType: RESOURCE,
        resourceId: String(created._id),
        resourceKey: created.code,
        action: 'create',
        revision: 1,
        fromStatus: null,
        toStatus: null,
        siteId,
        changedFields: ['code', 'name', 'trackingUrl'],
      })
    }
    return toAdminShippingCarrier(created.toObject() as ShippingCarrierRecord)
  } catch (error) {
    const dup = error as { code?: number }
    if (dup?.code === 11000) throw new ShippingCarrierServiceError(409, 'SHIPPING_CARRIER_CODE_EXISTS', 'Shipping carrier code already exists')
    throw error
  }
}

export async function updateShippingCarrier(
  model: Model<ShippingCarrierDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<ShippingCarrierAdmin> {
  const oid = objectId(id, 'SHIPPING_CARRIER_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<ShippingCarrierRecord>()
  if (!existing) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  const draft = (() => {
    try {
      return normalizeShippingCarrierInput({ ...(input as Record<string, unknown>), siteId, code: (input as Record<string, unknown>)?.code ?? existing.code })
    } catch (error) {
      if (error instanceof ShippingCarrierInvariantError) throw new ShippingCarrierServiceError(422, error.code, error.message)
      throw error
    }
  })()
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { ...draft, revision: (existing.revision ?? 1) + 1 } },
    { new: true },
  ).lean<ShippingCarrierRecord>()
  if (!updated) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.code,
      action: 'update',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['name', 'trackingUrl', 'isActive'],
    })
  }
  return toAdminShippingCarrier(updated)
}

export async function softDeleteShippingCarrier(
  model: Model<ShippingCarrierDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string; expectedRevision?: number },
): Promise<ShippingCarrierAdmin> {
  const oid = objectId(id, 'SHIPPING_CARRIER_ID_INVALID')
  const existing = await model.findOne({ _id: oid, siteId }).lean<ShippingCarrierRecord>()
  if (!existing) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  if (meta?.expectedRevision && existing.revision !== meta.expectedRevision) {
    throw new ShippingCarrierServiceError(409, 'SHIPPING_CARRIER_REVISION_CONFLICT', 'Revision conflict')
  }
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { new: true },
  ).lean<ShippingCarrierRecord>()
  if (!updated) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.code,
      action: 'delete',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['isDeleted'],
    })
  }
  return toAdminShippingCarrier(updated)
}

export async function restoreShippingCarrier(
  model: Model<ShippingCarrierDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<ShippingCarrierAdmin> {
  const oid = objectId(id, 'SHIPPING_CARRIER_ID_INVALID')
  const updated = await model.findOneAndUpdate(
    { _id: oid, siteId },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { new: true },
  ).lean<ShippingCarrierRecord>()
  if (!updated) throw new ShippingCarrierServiceError(404, 'SHIPPING_CARRIER_NOT_FOUND', 'Shipping carrier not found')
  if (meta?.audit) {
    await recordContentAudit(meta.audit, {
      resourceType: RESOURCE,
      resourceId: String(updated._id),
      resourceKey: updated.code,
      action: 'restore',
      revision: updated.revision ?? 1,
      fromStatus: null,
      toStatus: null,
      siteId,
      changedFields: ['isDeleted'],
    })
  }
  return toAdminShippingCarrier(updated)
}