import { z } from 'zod'
import type { H3Event } from 'h3'
import type { Model } from 'mongoose'
import type { UserSession } from '@tm/flow-contracts'
import type { AuditEntryDocument } from '#server/models/audit'
import type { ContentRevisionDocument } from '#server/models/revision'
import { CategoryServiceError } from '#server/services/categoryService'
import { MediaServiceError } from '#server/services/mediaService'
import { MenuServiceError } from '#server/services/menuService'
import { ContentServiceError } from '#server/services/contentService'
import { TagServiceError } from '#server/services/tagService'
import { CatalogServiceError } from '#server/services/catalogService'
import { CustomerServiceError } from '#server/services/customerService'
import { CustomerSegmentServiceError } from '#server/services/customerSegmentService'
import { OrderServiceError } from '#server/services/orderService'
import { QuotationServiceError } from '#server/services/quotationService'
import { WarehouseServiceError } from '#server/services/warehouseService'
import { InventoryServiceError } from '#server/services/inventoryService'
import { InventoryTransactionServiceError } from '#server/services/inventoryTransactionService'
import { PaymentServiceError } from '#server/services/paymentService'
import { InventoryTransferServiceError } from '#server/services/inventoryTransferService'
import { NotificationServiceError } from '#server/services/notificationService'
import { MailServiceError } from '#server/services/mailService'
import { HrServiceError } from '#server/services/staffService'
import { FinanceReportError } from '#server/services/financeReportService'
import { StocktakeServiceError } from '#server/services/stocktakeService'
import { MailAnalyticsError } from '#server/services/mailAnalyticsService'
import { SupplierServiceError } from '#server/services/supplierService'
import { PurchaseOrderServiceError } from '#server/services/purchaseOrderService'
import { RedirectServiceError } from '#server/services/redirectService'
import { MediaStorageError } from './mediaStorage'
import { AdminTagRenameRequestSchema } from '@tm/flow-contracts/tag-admin'
import { ATTRIBUTE_KEY_PATTERN, ATTRIBUTE_VALUE_MAX_LENGTH } from '#server/models/content'
import { IdempotencyError, normalizeIdempotencyKey } from './idempotency'
import { normalizeAuditReason } from '#server/services/contentAudit'
import type { ContentAuditMeta } from '#server/services/contentAudit'

/** Query/body contracts for the admin content API. */
export const ContentListQuerySchema = z.object({
  status: z.enum(['all', 'draft', 'scheduled', 'published', 'archived', 'deleted']).optional(),
  type: z.enum(['page', 'post', 'fragment']).optional(),
  q: z.string().trim().max(80).optional(),
  /** Exact tag, as listed by `/api/v1/admin/tags`; the value is normalized the same way. */
  tag: z.string().trim().min(1).max(60).optional(),
  /** Exact keyword inside any locale; free text, so the stored casing is what matches. */
  keyword: z.string().trim().min(1).max(60).optional(),
  /** Attribute name; alone it means "has this attribute", with a value it means "equals". */
  attributeKey: z.string().trim().regex(ATTRIBUTE_KEY_PATTERN).optional(),
  /** Compared against the stored value as text, so `5` finds the number 5 and `true` the boolean. */
  attributeValue: z.string().trim().max(ATTRIBUTE_VALUE_MAX_LENGTH).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).refine(
  query => !query.attributeValue || Boolean(query.attributeKey),
  { message: 'attributeValue needs an attributeKey', path: ['attributeValue'] },
)

export const ContentBodySchema = z.record(z.string(), z.unknown())

/** Category writes take the same free-form body the content editor sends. */
export const CategoryBodySchema = z.record(z.string(), z.unknown())

/** DELETE needs the current revision so a stale tree tab cannot delete blindly. */
export const CategoryDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

/** `folder=root` lists files that are not in a folder; omitted lists everything. */
export const MediaListQuerySchema = z.object({
  folder: z.string().trim().max(120).optional(),
  kind: z.enum(['image', 'document']).optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const MediaUpdateBodySchema = z.record(z.string(), z.unknown())

/** Tag commands take the shared schema, so the page and the server agree on limits. */
export { AdminTagRenameRequestSchema }

/** Menu writes are validated in the service, where the invariant codes live. */
export const MenuBodySchema = z.record(z.string(), z.unknown())

export const MenuDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

export const MediaDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

/** Catalog list filters; `category` accepts a category key or its id. */
export const CatalogItemListQuerySchema = z.object({
  status: z.enum(['all', 'draft', 'published', 'archived', 'deleted']).optional(),
  type: z.enum(['simple', 'variable']).optional(),
  q: z.string().trim().max(80).optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export const CatalogItemBodySchema = z.record(z.string(), z.unknown())
export const CatalogCategoryBodySchema = z.record(z.string(), z.unknown())

export const CatalogEventSchema = z.object({
  event: z.enum(['publish', 'archive', 'restore', 'delete']),
  revision: z.number().int().min(1),
})

/** DELETE needs the current revision so a stale tab cannot delete blindly. */
export const CatalogDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

/** CRM list filters; `segment` is the segment id the editor selected. */
export const CustomerListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  segment: z.string().trim().max(64).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** CRM writes keep the free-form body the service validates, like the other editors. */
export const CustomerBodySchema = z.record(z.string(), z.unknown())

export const CustomerSegmentBodySchema = z.record(z.string(), z.unknown())

/** Soft delete and restore both carry the revision the editor saw. */
export const CustomerDeleteQuerySchema = z.object({
  revision: z.coerce.number().int().min(1),
})

export const ContentEventSchema = z.object({
  event: z.enum(['publish', 'schedule', 'unpublish', 'archive', 'restore', 'delete']),
  revision: z.number().int().min(1),
  publishAt: z.string().max(64).nullable().optional(),
})

export const ContentHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export const ContentRevisionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

/** `revision` is the editor's current revision, for optimistic concurrency. */
export const ContentRestoreSchema = z.object({
  revision: z.number().int().min(1),
})

/** `:revision` is a positive integer revision number, never a document id. */
export function revisionParamOf(event: H3Event): number {
  const raw = String(getRouterParam(event, 'revision') || '')
  const revision = Number(raw)
  if (!/^\d{1,9}$/.test(raw) || !Number.isInteger(revision) || revision < 1) {
    return errorResponse(422, 'CONTENT_REVISION_INVALID', 'Revision is not valid')
  }
  return revision
}

/** Stable service errors become HTTP errors with the same code the UI shows. */
export function translateContentError(error: unknown): never {
  if (error instanceof ContentServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof CatalogServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof TagServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof CategoryServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof MenuServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof RedirectServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof CustomerServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof CustomerSegmentServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof OrderServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof QuotationServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof WarehouseServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof InventoryServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof InventoryTransactionServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof PaymentServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof InventoryTransferServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof NotificationServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof MailServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof HrServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof FinanceReportError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof StocktakeServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof MailAnalyticsError) {
    return errorResponse(error.statusCode, error.code, error.message)
  }
  if (error instanceof SupplierServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof PurchaseOrderServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof MediaServiceError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  if (error instanceof MediaStorageError) {
    return errorResponse(error.statusCode, error.code, error.message)
  }
  if (error instanceof IdempotencyError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details)
  }
  throw error
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

/**
 * Correlation id for the audit trail. It is caller-supplied and only echoed into
 * audit records (never trusted for authorization or uniqueness), so a malformed
 * value is dropped instead of failing the request.
 */
export function requestIdOf(event: H3Event): string | null {
  const raw = String(getHeader(event, 'x-request-id') || '').trim()
  return REQUEST_ID_PATTERN.test(raw) ? raw : null
}

/** Validates the retry key before any work happens; `null` means "not supplied". */
export function idempotencyKeyOf(event: H3Event): string | null {
  try {
    return normalizeIdempotencyKey(getHeader(event, 'idempotency-key'))
  } catch (error) {
    return translateContentError(error)
  }
}

/**
 * The audit half of a mutation's write meta: the actor from the verified session
 * and the operator's note from the request header. Routes that write no revision
 * (site settings) hand this to their service directly.
 */
export function auditMetaOf(
  event: H3Event,
  user: UserSession,
  auditModel: Model<AuditEntryDocument>,
): ContentAuditMeta {
  // A header rather than a body field: the note describes the request, and the
  // body schemas of six different modules would each have to learn about it.
  return {
    model: auditModel,
    actor: { id: user.id, name: user.name ?? '', email: user.email ?? '' },
    requestId: requestIdOf(event),
    reason: normalizeAuditReason(getHeader(event, 'x-audit-reason')),
  }
}

/**
 * Audit and revision writes for one mutation, with the actor taken from the
 * verified session only. Both receive the same request id, so the activity trail
 * and the snapshot can be correlated.
 */
export function writeMetaOf(
  event: H3Event,
  user: UserSession,
  auditModel: Model<AuditEntryDocument>,
  revisionModel: Model<ContentRevisionDocument>,
) {
  const audit = auditMetaOf(event, user, auditModel)
  return {
    audit,
    revision: { model: revisionModel, actor: audit.actor, requestId: audit.requestId },
  }
}
