import { z } from 'zod'

/**
 * Admin content DTO shared by the CMS UI and the CMS server. It mirrors what
 * `tm-cms/server/services/contentService.ts` returns; the server validates and
 * stores, the browser only reads this safe shape (no connection, no actor
 * tokens, no internal mongoose fields).
 */

export const ADMIN_CONTENT_TYPES = ['page', 'post', 'fragment'] as const
export type AdminContentType = (typeof ADMIN_CONTENT_TYPES)[number]

export const ADMIN_CONTENT_STATUSES = ['draft', 'scheduled', 'published', 'archived', 'deleted'] as const
export type AdminContentStatus = (typeof ADMIN_CONTENT_STATUSES)[number]

export const ADMIN_CONTENT_STATUS_FILTERS = ['all', ...ADMIN_CONTENT_STATUSES] as const
export type AdminContentStatusFilter = (typeof ADMIN_CONTENT_STATUS_FILTERS)[number]

export const ADMIN_CONTENT_EVENTS = ['publish', 'schedule', 'unpublish', 'archive', 'restore', 'delete'] as const
export type AdminContentEvent = (typeof ADMIN_CONTENT_EVENTS)[number]

export const ADMIN_CONTENT_BODY_FORMATS = ['markdown', 'html', 'text'] as const
export type AdminContentBodyFormat = (typeof ADMIN_CONTENT_BODY_FORMATS)[number]

export const AdminContentLocaleSchema = z.object({
  locale: z.string(),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  body: z.string(),
  format: z.enum(ADMIN_CONTENT_BODY_FORMATS),
  /** Free-form SEO keywords for this locale; stored as a de-duplicated list. */
  keywords: z.array(z.string()),
  seo: z.object({
    title: z.string(),
    description: z.string(),
    image: z.string(),
  }),
})

export type AdminContentLocale = z.infer<typeof AdminContentLocaleSchema>

export const AdminContentSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  type: z.enum(ADMIN_CONTENT_TYPES),
  key: z.string(),
  status: z.enum(ADMIN_CONTENT_STATUSES),
  locales: z.array(AdminContentLocaleSchema),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  media: z.array(z.string()),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  publishAt: z.string().nullable(),
  unpublishAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminContent = z.infer<typeof AdminContentSchema>

/** Editable payload the editor submits; dates are ISO strings or empty. */
export interface AdminContentDraft {
  type: AdminContentType
  key: string
  locales: AdminContentLocale[]
  categories: string[]
  tags: string[]
  media: string[]
  attributes: Record<string, string | number | boolean>
  publishAt: string | null
  unpublishAt: string | null
}

export interface AdminContentListMeta {
  nextCursor?: string
  hasMore?: boolean
  counts?: Record<string, number>
}

/**
 * Audit trail entry for one content record. The CMS shows these as activity, so
 * the shape stays read-only and actor fields are the minimum a reviewer needs:
 * identity, the resulting revision and what changed.
 */
export const ADMIN_CONTENT_AUDIT_ACTIONS = [
  'create',
  'update',
  'publish',
  'schedule',
  'unpublish',
  'archive',
  'restore',
  'delete',
  'revert',
] as const
export type AdminContentAuditAction = (typeof ADMIN_CONTENT_AUDIT_ACTIONS)[number]

export const AdminContentAuditActorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

export const AdminContentAuditSchema = z.object({
  id: z.string(),
  action: z.enum(ADMIN_CONTENT_AUDIT_ACTIONS),
  revision: z.number(),
  fromStatus: z.enum(ADMIN_CONTENT_STATUSES).nullable(),
  toStatus: z.enum(ADMIN_CONTENT_STATUSES).nullable(),
  changedFields: z.array(z.string()),
  actor: AdminContentAuditActorSchema,
  requestId: z.string().nullable(),
  createdAt: z.string(),
})

export type AdminContentAudit = z.infer<typeof AdminContentAuditSchema>

/**
 * Actions that make sense on many records at once. `schedule` is excluded on
 * purpose: every record would need its own publish time, so it stays a
 * single-record command.
 */
export const ADMIN_CONTENT_BULK_ACTIONS = ['publish', 'archive', 'delete'] as const
export type AdminContentBulkAction = (typeof ADMIN_CONTENT_BULK_ACTIONS)[number]

export const AdminContentBulkItemSchema = z.object({
  id: z.string(),
  revision: z.number().int().min(1),
})

export type AdminContentBulkItem = z.infer<typeof AdminContentBulkItemSchema>

/** One request is capped at 50 rows so a single edit stays bounded. */
export const AdminContentBulkRequestSchema = z.object({
  action: z.enum(ADMIN_CONTENT_BULK_ACTIONS),
  items: z.array(AdminContentBulkItemSchema).min(1).max(50),
})

export type AdminContentBulkRequest = z.infer<typeof AdminContentBulkRequestSchema>

/** One row's outcome; a failure never hides the rows that did succeed. */
export const AdminContentBulkRowSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  status: z.enum(ADMIN_CONTENT_STATUSES).nullable(),
  revision: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})

export type AdminContentBulkRow = z.infer<typeof AdminContentBulkRowSchema>

export const AdminContentBulkResultSchema = z.object({
  action: z.enum(ADMIN_CONTENT_BULK_ACTIONS),
  results: z.array(AdminContentBulkRowSchema),
  succeeded: z.number(),
  failed: z.number(),
})

export type AdminContentBulkResult = z.infer<typeof AdminContentBulkResultSchema>

/**
 * One stored snapshot of a record's editable fields. Restoring a snapshot makes
 * it the current content under a new revision; it never re-opens an old status.
 */
export const AdminContentRevisionSnapshotSchema = z.object({
  type: z.enum(ADMIN_CONTENT_TYPES),
  locales: z.array(AdminContentLocaleSchema),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  media: z.array(z.string()),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  publishAt: z.string().nullable(),
  unpublishAt: z.string().nullable(),
})

export type AdminContentRevisionSnapshot = z.infer<typeof AdminContentRevisionSnapshotSchema>

export const AdminContentRevisionSchema = z.object({
  id: z.string(),
  revision: z.number(),
  status: z.enum(ADMIN_CONTENT_STATUSES),
  action: z.enum(ADMIN_CONTENT_AUDIT_ACTIONS),
  changedFields: z.array(z.string()),
  actor: AdminContentAuditActorSchema,
  requestId: z.string().nullable(),
  createdAt: z.string(),
})

export type AdminContentRevision = z.infer<typeof AdminContentRevisionSchema>

/** Display-ready difference for one field, between a snapshot and the record. */
export const AdminContentRevisionDiffSchema = z.object({
  field: z.string(),
  before: z.string(),
  after: z.string(),
})

export type AdminContentRevisionDiff = z.infer<typeof AdminContentRevisionDiffSchema>

export const AdminContentRevisionDetailSchema = AdminContentRevisionSchema.extend({
  snapshot: AdminContentRevisionSnapshotSchema,
  diff: z.array(AdminContentRevisionDiffSchema),
})

export type AdminContentRevisionDetail = z.infer<typeof AdminContentRevisionDetailSchema>
