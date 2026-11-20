import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  CustomerSegmentInvariantError,
  type CustomerSegmentDocument,
  normalizeCustomerSegmentInput,
} from '../models/customerSegment'
import type { CustomerDocument } from '../models/customer'
import { countCustomersInSegment } from './customerService'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class CustomerSegmentServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CustomerSegmentServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type CustomerSegmentRecord = CustomerSegmentDocument & { _id: Types.ObjectId }

export interface CustomerSegmentWriteMeta {
  audit?: ContentAuditMeta
  /** Passed by the admin routes so a segment still used by customers refuses deletion. */
  customers?: Model<CustomerDocument>
}

export interface CustomerSegmentAdmin {
  id: string
  siteId: string
  code: string
  title: string
  description: string
  defaultDiscountPercent: number
  freeShipping: boolean
  thumbnail: string | null
  gallery: string[]
  autoJoinCriteria: { minSpent: number; minOrders: number }
  sort: number
  isActive: boolean
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

const ACTOR_TYPE = 'customer_segment'

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminSegment(record: CustomerSegmentRecord): CustomerSegmentAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    title: record.title,
    description: record.description ?? '',
    defaultDiscountPercent: record.defaultDiscountPercent ?? 0,
    freeShipping: record.freeShipping ?? false,
    thumbnail: record.thumbnail ?? null,
    gallery: record.gallery ?? [],
    autoJoinCriteria: record.autoJoinCriteria ?? { minSpent: 0, minOrders: 0 },
    sort: record.sort ?? 0,
    isActive: record.isActive ?? true,
    isDeleted: record.isDeleted ?? false,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new CustomerSegmentServiceError(422, code, 'Segment id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof CustomerSegmentInvariantError) {
    throw new CustomerSegmentServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    throw new CustomerSegmentServiceError(409, 'CUSTOMER_SEGMENT_CODE_EXISTS', 'Another segment already uses this code')
  }
  throw error
}

export async function listCustomerSegments(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  includeDeleted = false,
): Promise<CustomerSegmentAdmin[]> {
  const filter: Record<string, unknown> = { siteId }
  if (!includeDeleted) filter.isDeleted = { $ne: true }
  const records = await model.find(filter).sort({ sort: 1, code: 1 }).lean<CustomerSegmentRecord[]>()
  return records.map(toAdminSegment)
}

export async function getCustomerSegment(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  id: string,
): Promise<CustomerSegmentAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_SEGMENT_ID_INVALID'), siteId }).lean<CustomerSegmentRecord>()
  if (!record) throw new CustomerSegmentServiceError(404, 'CUSTOMER_SEGMENT_NOT_FOUND', 'Segment not found')
  return toAdminSegment(record)
}

export async function createCustomerSegment(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  input: unknown,
  meta?: CustomerSegmentWriteMeta,
): Promise<CustomerSegmentAdmin> {
  const draft = (() => {
    try {
      return normalizeCustomerSegmentInput(input)
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let created
  try {
    created = await model.create({ ...draft, siteId, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as CustomerSegmentRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: ACTOR_TYPE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['code', 'title', 'description', 'sort'],
  })

  return toAdminSegment(record)
}

export async function updateCustomerSegment(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: CustomerSegmentWriteMeta,
): Promise<CustomerSegmentAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerSegmentServiceError(422, 'CUSTOMER_SEGMENT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_SEGMENT_ID_INVALID'), siteId }).lean<CustomerSegmentRecord>()
  if (!record) throw new CustomerSegmentServiceError(404, 'CUSTOMER_SEGMENT_NOT_FOUND', 'Segment not found')

  const draft = (() => {
    try {
      return normalizeCustomerSegmentInput({ ...body, code: record.code })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let updated: CustomerSegmentRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          title: draft.title,
          description: draft.description,
          defaultDiscountPercent: draft.defaultDiscountPercent,
          freeShipping: draft.freeShipping,
          thumbnail: draft.thumbnail,
          gallery: draft.gallery,
          autoJoinCriteria: draft.autoJoinCriteria,
          sort: draft.sort,
          isActive: draft.isActive,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<CustomerSegmentRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new CustomerSegmentServiceError(409, 'CUSTOMER_SEGMENT_REVISION_CONFLICT', 'Segment was changed by someone else; reload before saving', { expected: revision })
  }

  const changedFields: string[] = []
  if (record.title !== updated.title) changedFields.push('title')
  if (record.sort !== updated.sort) changedFields.push('sort')
  if (record.isActive !== updated.isActive) changedFields.push('isActive')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: ACTOR_TYPE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields,
  })

  return toAdminSegment(updated)
}

export async function softDeleteCustomerSegment(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: CustomerSegmentWriteMeta,
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerSegmentServiceError(422, 'CUSTOMER_SEGMENT_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_SEGMENT_ID_INVALID'), siteId }).lean<CustomerSegmentRecord>()
  if (!record) throw new CustomerSegmentServiceError(404, 'CUSTOMER_SEGMENT_NOT_FOUND', 'Segment not found')

  if (meta?.customers) {
    const inUse = await countCustomersInSegment(meta.customers, siteId, String(record._id))
    if (inUse > 0) {
      throw new CustomerSegmentServiceError(
        409,
        'CUSTOMER_SEGMENT_IN_USE',
        'Customers still belong to this segment; move them to another segment first',
        { customers: inUse },
      )
    }
  }

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CustomerSegmentRecord | null>()

  if (!deleted) throw new CustomerSegmentServiceError(409, 'CUSTOMER_SEGMENT_REVISION_CONFLICT', 'Segment was changed by someone else; reload before deleting')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: ACTOR_TYPE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: [],
  })

  return { id: String(record._id), code: record.code }
}

export async function restoreCustomerSegment(
  model: Model<CustomerSegmentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: CustomerSegmentWriteMeta,
): Promise<CustomerSegmentAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerSegmentServiceError(422, 'CUSTOMER_SEGMENT_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_SEGMENT_ID_INVALID'), siteId }).lean<CustomerSegmentRecord>()
  if (!record) throw new CustomerSegmentServiceError(404, 'CUSTOMER_SEGMENT_NOT_FOUND', 'Segment not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CustomerSegmentRecord | null>()

  if (!restored) throw new CustomerSegmentServiceError(409, 'CUSTOMER_SEGMENT_REVISION_CONFLICT', 'Segment was changed by someone else; reload before restoring')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: ACTOR_TYPE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: [],
  })

  return toAdminSegment(restored)
}
