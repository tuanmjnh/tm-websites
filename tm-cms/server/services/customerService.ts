import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { CustomerSegmentDocument } from '../models/customerSegment'
import {
  CustomerInvariantError,
  type CustomerAddress,
  type CustomerDocument,
  normalizeCustomerInput,
} from '../models/customer'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

/**
 * CRM customer commands and queries. No identity authority lives here: the Hub
 * subject id arrives from a verified context (or from a migration), and every
 * record stays scoped to one customer database.
 */

export class CustomerServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CustomerServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type CustomerRecord = CustomerDocument & { _id: Types.ObjectId }

export interface CustomerMetricsAdmin {
  totalOrders: number
  totalSpent: number
  lastOrderAt: string | null
  /** True when the stored counters disagree with a recomputed value. */
  stale?: boolean
}

export interface CustomerAdmin {
  id: string
  siteId: string
  code: string
  subjectId: string
  email: string
  fullName: string
  phone: string
  addresses: CustomerAddress[]
  customerSegmentId: string | null
  loyaltyPoints: number
  metrics: CustomerMetricsAdmin
  note: string
  isActive: boolean
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CustomerListParams {
  q?: string
  segmentId?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface CustomerListResult {
  data: CustomerAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number, active: number, inactive: number, deleted: number }
}

const RESOURCE = 'customer'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toAdminCustomer(record: CustomerRecord): CustomerAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    code: record.code,
    subjectId: record.subjectId,
    email: record.email ?? '',
    fullName: record.fullName ?? '',
    phone: record.phone ?? '',
    addresses: (record.addresses ?? []).map(address => ({
      fullName: address.fullName ?? '',
      phone: address.phone ?? '',
      street: address.street ?? '',
      ward: address.ward ?? '',
      district: address.district ?? '',
      city: address.city ?? '',
      country: address.country ?? '',
      isDefault: address.isDefault === true,
      sort: address.sort ?? 0,
    })),
    customerSegmentId: record.customerSegmentId ? String(record.customerSegmentId) : null,
    loyaltyPoints: record.loyaltyPoints ?? 0,
    metrics: {
      totalOrders: record.metrics?.totalOrders ?? 0,
      totalSpent: record.metrics?.totalSpent ?? 0,
      lastOrderAt: iso(record.metrics?.lastOrderAt ?? null),
    },
    note: record.note ?? '',
    isActive: record.isActive !== false,
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new CustomerServiceError(422, code, 'Customer id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof CustomerInvariantError) {
    throw new CustomerServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number, keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    const subjectTaken = Object.keys(duplicate.keyPattern ?? {}).includes('subjectId')
    throw new CustomerServiceError(
      409,
      subjectTaken ? 'CUSTOMER_SUBJECT_EXISTS' : 'CUSTOMER_CODE_EXISTS',
      subjectTaken
        ? 'This Hub subject already has a customer profile in this site'
        : 'Another customer already uses this code',
    )
  }
  throw error
}

/** A missing code is generated, like the legacy `CUS…` codes, and can be edited later. */
function generatedCode(): string {
  return `CUS-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`
}

/**
 * The segment must exist in this site and not be soft-deleted, so a customer
 * never points at another site's classification or at a removed one.
 */
async function assertSegmentAllowed(
  segmentModel: Model<CustomerSegmentDocument>,
  siteId: string,
  segmentId: string | null,
): Promise<void> {
  if (!segmentId) return
  if (!/^[a-f0-9]{24}$/.test(segmentId)) {
    throw new CustomerServiceError(422, 'CUSTOMER_SEGMENT_ID_INVALID', 'customerSegmentId is not a valid id')
  }
  const segment = await segmentModel
    .findOne({ _id: new Types.ObjectId(segmentId), siteId })
    .select({ _id: 1, isDeleted: 1 })
    .lean<{ _id: Types.ObjectId, isDeleted?: boolean } | null>()
  if (!segment) {
    throw new CustomerServiceError(422, 'CUSTOMER_SEGMENT_NOT_FOUND', 'The customer segment does not exist in this site')
  }
  if (segment.isDeleted) {
    throw new CustomerServiceError(422, 'CUSTOMER_SEGMENT_DELETED', 'The customer segment is deleted; restore it first')
  }
}

export async function listCustomers(
  model: Model<CustomerDocument>,
  siteId: string,
  params: CustomerListParams = {},
): Promise<CustomerListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.segmentId) filter.customerSegmentId = objectId(params.segmentId, 'CUSTOMER_SEGMENT_ID_INVALID')

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { code: pattern },
      { email: pattern },
      { fullName: pattern },
      { phone: pattern },
      { subjectId: pattern },
    ]
  }

  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'CUSTOMER_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<CustomerRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminCustomer),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: await customerCounts(model, siteId),
  }
}

async function customerCounts(
  model: Model<CustomerDocument>,
  siteId: string,
): Promise<CustomerListResult['counts']> {
  const [all, deleted, inactive] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
    model.countDocuments({ siteId, isDeleted: { $ne: true }, isActive: false }),
  ])
  const live = all - deleted
  return { all: live, active: live - inactive, inactive, deleted }
}

export async function getCustomer(
  model: Model<CustomerDocument>,
  siteId: string,
  id: string,
): Promise<CustomerAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_ID_INVALID'), siteId }).lean<CustomerRecord>()
  if (!record) throw new CustomerServiceError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found')
  return toAdminCustomer(record)
}

export async function createCustomer(
  model: Model<CustomerDocument>,
  segmentModel: Model<CustomerSegmentDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<CustomerAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeCustomerInput({
        ...source,
        siteId,
        code: source.code || generatedCode(),
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertSegmentAllowed(segmentModel, siteId, draft.customerSegmentId)

  let created
  try {
    created = await model.create({ ...draft, siteId, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as CustomerRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['code', 'subjectId', 'email', 'fullName', 'phone', 'addresses', 'customerSegmentId'],
  })

  return toAdminCustomer(record)
}

/** Stored customer as an editable draft, so an update can merge into it. */
function currentDraftOf(record: CustomerRecord): Record<string, unknown> {
  return {
    code: record.code,
    subjectId: record.subjectId,
    email: record.email ?? '',
    fullName: record.fullName ?? '',
    phone: record.phone ?? '',
    addresses: record.addresses ?? [],
    customerSegmentId: record.customerSegmentId ? String(record.customerSegmentId) : null,
    loyaltyPoints: record.loyaltyPoints ?? 0,
    note: record.note ?? '',
    isActive: record.isActive !== false,
  }
}

export async function updateCustomer(
  model: Model<CustomerDocument>,
  segmentModel: Model<CustomerSegmentDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<CustomerAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerServiceError(422, 'CUSTOMER_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'CUSTOMER_ID_INVALID'), siteId })
    .lean<CustomerRecord>()
  if (!record) throw new CustomerServiceError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found')

  // The Hub subject is the linkage to identity; changing it would silently move
  // someone else's order history, so it is only ever set on creation.
  if (typeof body.subjectId === 'string' && body.subjectId !== record.subjectId) {
    throw new CustomerServiceError(422, 'CUSTOMER_SUBJECT_IMMUTABLE', 'A customer cannot be relinked to another Hub subject')
  }

  // Merge semantics: the editor sends the fields it changed, so anything it left
  // out keeps the stored value instead of being reset to a default.
  const draft = (() => {
    try {
      return normalizeCustomerInput({
        ...currentDraftOf(record),
        ...body,
        siteId,
        code: body.code || record.code,
        subjectId: record.subjectId,
      })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertSegmentAllowed(segmentModel, siteId, draft.customerSegmentId)

  let updated: CustomerRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          code: draft.code,
          email: draft.email,
          fullName: draft.fullName,
          phone: draft.phone,
          addresses: draft.addresses,
          customerSegmentId: draft.customerSegmentId ? new Types.ObjectId(draft.customerSegmentId) : null,
          loyaltyPoints: draft.loyaltyPoints,
          note: draft.note,
          isActive: draft.isActive,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<CustomerRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new CustomerServiceError(
      409,
      'CUSTOMER_REVISION_CONFLICT',
      'Customer was changed by someone else; reload before saving',
      { expected: revision },
    )
  }

  const changedFields: string[] = []
  for (const field of ['code', 'email', 'fullName', 'phone', 'note', 'loyaltyPoints'] as const) {
    if (record[field] !== updated[field]) changedFields.push(field)
  }
  if (JSON.stringify(record.addresses ?? []) !== JSON.stringify(updated.addresses ?? [])) changedFields.push('addresses')
  if (String(record.customerSegmentId ?? '') !== String(updated.customerSegmentId ?? '')) changedFields.push('customerSegmentId')
  if (record.isActive !== updated.isActive) changedFields.push('isActive')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields,
  })

  return toAdminCustomer(updated)
}

/**
 * Customers are never deleted: order history and audit entries keep pointing at
 * them. Deleting hides the profile (and refuses new orders) instead.
 */
export async function softDeleteCustomer(
  model: Model<CustomerDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string, code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerServiceError(422, 'CUSTOMER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_ID_INVALID'), siteId }).lean<CustomerRecord>()
  if (!record) throw new CustomerServiceError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    // `isActive` is the operator's own switch and survives the hide, so a
    // restore does not silently reactivate a customer someone disabled.
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CustomerRecord | null>()

  if (!deleted) {
    throw new CustomerServiceError(409, 'CUSTOMER_REVISION_CONFLICT', 'Customer was changed by someone else; reload before deleting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted', 'isActive'],
  })

  return { id: String(record._id), code: record.code }
}

export async function restoreCustomer(
  model: Model<CustomerDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<CustomerAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CustomerServiceError(422, 'CUSTOMER_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'CUSTOMER_ID_INVALID'), siteId }).lean<CustomerRecord>()
  if (!record) throw new CustomerServiceError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CustomerRecord | null>()

  if (!restored) {
    throw new CustomerServiceError(409, 'CUSTOMER_REVISION_CONFLICT', 'Customer was changed by someone else; reload before restoring')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return toAdminCustomer(restored)
}

/**
 * A customer a segment still classifies cannot be removed from under it: the
 * segment delete already refuses this, and this helper lets the segment dialog
 * name the customers that block it.
 */
export async function countCustomersInSegment(
  model: Model<CustomerDocument>,
  siteId: string,
  segmentId: string,
): Promise<number> {
  return model.countDocuments({
    siteId,
    isDeleted: { $ne: true },
    customerSegmentId: new Types.ObjectId(segmentId),
  })
}

export interface CustomerImportRowResult {
  row: number
  code: string | null
  status: 'created' | 'updated' | 'failed'
  id: string | null
  codeError: string | null
  message: string | null
}

export interface CustomerImportResult {
  total: number
  created: number
  updated: number
  failed: number
  results: CustomerImportRowResult[]
}

const IMPORT_MAX_ROWS = 500

export async function importCustomers(
  model: Model<CustomerDocument>,
  segmentModel: Model<CustomerSegmentDocument>,
  siteId: string,
  rows: unknown[],
  meta?: { audit?: ContentAuditMeta },
): Promise<CustomerImportResult> {
  if (!Array.isArray(rows)) {
    throw new CustomerServiceError(422, 'CUSTOMER_IMPORT_INVALID', 'Import rows must be an array')
  }
  if (rows.length === 0) {
    throw new CustomerServiceError(422, 'CUSTOMER_IMPORT_EMPTY', 'Import requires at least one row')
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new CustomerServiceError(422, 'CUSTOMER_IMPORT_TOO_LARGE', `Import is limited to ${IMPORT_MAX_ROWS} rows`, { limit: IMPORT_MAX_ROWS })
  }

  const results: CustomerImportRowResult[] = []
  let created = 0
  let updated = 0
  let failed = 0

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 1
    let code: string | null = null
    try {
      let draft
      try {
        draft = normalizeCustomerInput({ ...(row as Record<string, unknown>), siteId })
      } catch (error) {
        translateInvariant(error)
        throw error
      }
      code = draft.code || null

      await assertSegmentAllowed(segmentModel, siteId, draft.customerSegmentId)

      const existing = code ? await model.findOne({ siteId, code: draft.code }).lean<CustomerRecord>() : null

      if (existing) {
        if (draft.subjectId !== existing.subjectId) {
          throw new CustomerServiceError(422, 'CUSTOMER_SUBJECT_IMMUTABLE', 'A customer cannot be relinked to another Hub subject')
        }

        const updatedRecord = await model.findOneAndUpdate(
          { _id: existing._id, siteId },
          {
            $set: {
              code: draft.code,
              email: draft.email,
              fullName: draft.fullName,
              phone: draft.phone,
              addresses: draft.addresses,
              customerSegmentId: draft.customerSegmentId ? new Types.ObjectId(draft.customerSegmentId) : null,
              loyaltyPoints: draft.loyaltyPoints,
              note: draft.note,
              isActive: draft.isActive,
            },
            $inc: { revision: 1 },
          },
          { returnDocument: 'after' },
        ).lean<CustomerRecord>()

        if (!updatedRecord) throw new CustomerServiceError(409, 'CUSTOMER_IMPORT_CONFLICT', 'Customer changed during import')

        await recordContentAudit(meta?.audit, {
          siteId,
          resourceType: RESOURCE,
          resourceId: String(updatedRecord._id),
          resourceKey: updatedRecord.code,
          action: 'update',
          revision: updatedRecord.revision,
          fromStatus: null,
          toStatus: null,
          changedFields: ['email', 'fullName', 'phone', 'addresses', 'customerSegmentId'],
        })

        results.push({ row: rowNumber, code: updatedRecord.code, status: 'updated', id: String(updatedRecord._id), codeError: null, message: null })
        updated += 1
      } else {
        const createdRecord = await model.create({
          ...draft,
          siteId,
          customerSegmentId: draft.customerSegmentId ? new Types.ObjectId(draft.customerSegmentId) : null,
          revision: 1,
        })
        const record = createdRecord.toObject() as CustomerRecord

        await recordContentAudit(meta?.audit, {
          siteId,
          resourceType: RESOURCE,
          resourceId: String(record._id),
          resourceKey: record.code,
          action: 'create',
          revision: record.revision,
          fromStatus: null,
          toStatus: null,
          changedFields: ['code', 'subjectId', 'email', 'fullName', 'phone', 'addresses', 'customerSegmentId'],
        })

        results.push({ row: rowNumber, code: record.code, status: 'created', id: String(record._id), codeError: null, message: null })
        created += 1
      }
    } catch (error) {
      failed += 1
      const serviceError = error instanceof CustomerServiceError ? error : null
      results.push({
        row: rowNumber,
        code,
        status: 'failed',
        id: null,
        codeError: serviceError?.code ?? 'CUSTOMER_IMPORT_FAILED',
        message: serviceError?.message ?? 'Import failed',
      })
    }
  }

  return { total: rows.length, created, updated, failed, results }
}

export interface CustomerDuplicateGroup {
  key: string
  field: 'email' | 'phone' | 'subjectId'
  customers: { id: string, code: string, fullName: string }[]
}

/**
 * Read-only deduplication report (CRM-01): groups customers that share a
 * non-empty email, phone or Hub subject id. The policy is "detect, do not
 * silently merge" — an operator resolves each group manually, because merging
 * would move order history and loyalty points.
 */
export async function findDuplicateCustomers(
  model: Model<CustomerDocument>,
  siteId: string,
): Promise<CustomerDuplicateGroup[]> {
  const records = await model
    .find({ siteId, isDeleted: { $ne: true } })
    .select('_id code fullName email phone subjectId')
    .lean<CustomerRecord[]>()
  const groups: CustomerDuplicateGroup[] = []
  const buckets = new Map<string, CustomerDuplicateGroup>()
  for (const record of records) {
    const candidates: { field: 'email' | 'phone' | 'subjectId', value: string }[] = []
    if (record.email) candidates.push({ field: 'email', value: record.email.trim().toLowerCase() })
    if (record.phone) candidates.push({ field: 'phone', value: record.phone.trim() })
    if (record.subjectId) candidates.push({ field: 'subjectId', value: record.subjectId.trim() })
    for (const { field, value } of candidates) {
      const key = `${field}:${value}`
      const bucket = buckets.get(key) ?? { key, field, customers: [] }
      bucket.customers.push({ id: String(record._id), code: record.code, fullName: record.fullName ?? '' })
      buckets.set(key, bucket)
    }
  }
  for (const bucket of buckets.values()) {
    if (bucket.customers.length > 1) groups.push(bucket)
  }
  return groups.sort((a, b) => b.customers.length - a.customers.length)
}
