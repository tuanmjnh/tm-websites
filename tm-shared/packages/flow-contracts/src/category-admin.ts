import { z } from 'zod'

/**
 * Admin DTO for the content category tree. Categories are identified by an
 * immutable, human-readable key (`trang-suc`), and a child points at its
 * parent's key, so moving a subtree never rewrites ids.
 */

export const ADMIN_CATEGORY_LOCALES = ['vi', 'en'] as const

export const AdminCategoryLocaleSchema = z.object({
  locale: z.string(),
  name: z.string(),
  slug: z.string(),
})

export type AdminCategoryLocale = z.infer<typeof AdminCategoryLocaleSchema>

export const AdminCategorySchema = z.object({
  id: z.string(),
  siteId: z.string(),
  key: z.string(),
  parent: z.string().nullable(),
  order: z.number(),
  revision: z.number(),
  locales: z.array(AdminCategoryLocaleSchema),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminCategory = z.infer<typeof AdminCategorySchema>

/** A node in the returned tree: one category plus its ordered descendants. */
export interface AdminCategoryNode extends AdminCategory {
  depth: number
  children: AdminCategoryNode[]
}

export interface AdminCategoryDraft {
  key: string
  parent: string | null
  order: number
  locales: AdminCategoryLocale[]
}

/** Client-side maximum, mirrored by the server invariant. */
export const ADMIN_CATEGORY_MAX_DEPTH = 5
