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
import { RedirectServiceError } from '#server/services/redirectService'
import { MediaStorageError } from './mediaStorage'
import { AdminTagRenameRequestSchema } from '@tm/flow-contracts/tag-admin'
import { IdempotencyError, normalizeIdempotencyKey } from './idempotency'

/** Query/body contracts for the admin content API. */
export const ContentListQuerySchema = z.object({
  status: z.enum(['all', 'draft', 'scheduled', 'published', 'archived', 'deleted']).optional(),
  type: z.enum(['page', 'post', 'fragment']).optional(),
  q: z.string().trim().max(80).optional(),
  /** Exact tag, as listed by `/api/v1/admin/tags`; the value is normalized the same way. */
  tag: z.string().trim().min(1).max(60).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

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
  const actor = { id: user.id, name: user.name ?? '', email: user.email ?? '' }
  const requestId = requestIdOf(event)
  return {
    audit: { model: auditModel, actor, requestId },
    revision: { model: revisionModel, actor, requestId },
  }
}
