import { z } from 'zod'

/**
 * Business audit read model.
 *
 * The CMS writes these entries itself (`audit_logs` in the customer database),
 * so the Audit Log page can answer "who changed this record" without calling
 * Hub. Hub keeps owning IAM audit; this contract never exposes tokens, sessions
 * or request bodies — only the actor identity, the touched fields and the
 * revision the action produced.
 */

export const ADMIN_AUDIT_RESOURCE_TYPES = ['content', 'category', 'media'] as const
export type AdminAuditResourceType = (typeof ADMIN_AUDIT_RESOURCE_TYPES)[number]

export const ADMIN_AUDIT_ACTIONS = [
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
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number]

export const ADMIN_AUDIT_LIMIT_DEFAULT = 30
export const ADMIN_AUDIT_LIMIT_MAX = 100
export const ADMIN_AUDIT_SEARCH_MAX = 80

export const AdminAuditActorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

export const AdminAuditEntrySchema = z.object({
  id: z.string(),
  resourceType: z.enum(ADMIN_AUDIT_RESOURCE_TYPES),
  resourceId: z.string(),
  resourceKey: z.string(),
  action: z.enum(ADMIN_AUDIT_ACTIONS),
  revision: z.number(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  changedFields: z.array(z.string()),
  actor: AdminAuditActorSchema,
  requestId: z.string().nullable(),
  createdAt: z.string(),
})

export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>

/** Cursor is the `_id` of the last row, so entries never shift under paging. */
export const AdminAuditQuerySchema = z.object({
  resourceType: z.enum(ADMIN_AUDIT_RESOURCE_TYPES).optional(),
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  resourceId: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  /** Literal search over resource key/id and actor name/email. */
  q: z.string().trim().max(ADMIN_AUDIT_SEARCH_MAX).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_AUDIT_LIMIT_MAX).default(ADMIN_AUDIT_LIMIT_DEFAULT),
})

export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>

export const AdminAuditListSchema = z.object({
  data: z.array(AdminAuditEntrySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  /** Rows matching the filters, ignoring the page window. */
  total: z.number().int().nonnegative(),
})

export type AdminAuditList = z.infer<typeof AdminAuditListSchema>
