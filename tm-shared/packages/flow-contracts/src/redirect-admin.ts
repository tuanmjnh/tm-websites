import { z } from 'zod'

/**
 * Site redirect map.
 *
 * The legacy CMS wrote a `Redirect` document on every slug change but the router
 * never read it, so old URLs kept 404ing. Here the map is an explicit editor
 * surface: one row per old path, resolved by the storefront before it renders a
 * page. Paths are site-relative and internal (`/bai-viet/cu`), never a full URL,
 * so an entry cannot turn the site into an open redirect. A row can also answer
 * `410 Gone` for a path that was removed for good: it then carries no target.
 */

export const ADMIN_REDIRECT_STATUS_CODES = [301, 302, 410] as const
export type AdminRedirectStatusCode = (typeof ADMIN_REDIRECT_STATUS_CODES)[number]

export const ADMIN_REDIRECT_PATH_MAX = 2048
export const ADMIN_REDIRECT_NOTE_MAX = 200

export const AdminRedirectSchema = z.object({
  id: z.string(),
  /** Normalized old path, always starts with `/` and has no trailing slash. */
  from: z.string(),
  /** Normalized internal target path. */
  to: z.string(),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(410)]),
  /** An inactive row stays in the map but is ignored by the storefront. */
  isActive: z.boolean(),
  note: z.string(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type AdminRedirect = z.infer<typeof AdminRedirectSchema>

export const AdminRedirectDraftSchema = z.object({
  from: z.string().trim().min(1).max(ADMIN_REDIRECT_PATH_MAX),
  /** Empty for a `410`: the path is gone, not moved, so it has no target. */
  to: z.string().trim().max(ADMIN_REDIRECT_PATH_MAX).default(''),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(410)]).default(301),
  isActive: z.boolean().default(true),
  note: z.string().trim().max(ADMIN_REDIRECT_NOTE_MAX).default(''),
})

export type AdminRedirectDraft = z.infer<typeof AdminRedirectDraftSchema>

/** Update sends the whole row plus the revision the editor loaded. */
export const AdminRedirectUpdateSchema = AdminRedirectDraftSchema.extend({
  revision: z.number().int().min(1),
})

export type AdminRedirectUpdate = z.infer<typeof AdminRedirectUpdateSchema>

export const AdminRedirectListSchema = z.object({
  data: z.array(AdminRedirectSchema),
  /** Rows matching the filter, before any windowing. */
  total: z.number().int().nonnegative(),
})

export type AdminRedirectList = z.infer<typeof AdminRedirectListSchema>
