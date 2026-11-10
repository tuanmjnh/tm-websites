import { z } from 'zod'

/**
 * Admin catalog DTO shared by the CMS UI and the CMS server. The storefront does
 * not read these types: it reads the public projection built by the Web catalog
 * mapper, which only exposes published, active records.
 */

export const ADMIN_CATALOG_STATUSES = ['draft', 'published', 'archived', 'deleted'] as const
export type AdminCatalogStatus = (typeof ADMIN_CATALOG_STATUSES)[number]

export const ADMIN_CATALOG_STATUS_FILTERS = ['all', ...ADMIN_CATALOG_STATUSES] as const
export type AdminCatalogStatusFilter = (typeof ADMIN_CATALOG_STATUS_FILTERS)[number]

export const ADMIN_CATALOG_ITEM_TYPES = ['simple', 'variable'] as const
export type AdminCatalogItemType = (typeof ADMIN_CATALOG_ITEM_TYPES)[number]

export const ADMIN_CATALOG_EVENTS = ['publish', 'archive', 'restore', 'delete'] as const
export type AdminCatalogEvent = (typeof ADMIN_CATALOG_EVENTS)[number]

export type AdminLocalizedText = Record<string, string>

export const AdminCatalogAttributeSchema = z.object({
  name: z.record(z.string(), z.string()),
  value: z.record(z.string(), z.string()),
})
export type AdminCatalogAttribute = z.infer<typeof AdminCatalogAttributeSchema>

export const AdminCatalogVariantSchema = z.object({
  sku: z.string(),
  name: z.record(z.string(), z.string()).default({}),
  basePrice: z.number(),
  salePrice: z.number().nullable(),
  stock: z.number(),
  manageStock: z.boolean(),
  isActive: z.boolean(),
  attributes: z.array(AdminCatalogAttributeSchema).default([]),
})
export type AdminCatalogVariant = z.infer<typeof AdminCatalogVariantSchema>

export const AdminCatalogSeoSchema = z.object({
  title: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  image: z.string(),
})
export type AdminCatalogSeo = z.infer<typeof AdminCatalogSeoSchema>

export const AdminCatalogItemSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  key: z.string(),
  status: z.enum(ADMIN_CATALOG_STATUSES),
  type: z.enum(ADMIN_CATALOG_ITEM_TYPES),
  title: z.record(z.string(), z.string()),
  slug: z.record(z.string(), z.string()),
  shortDesc: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  thumbnail: z.string().nullable(),
  gallery: z.array(z.string()),
  basePrice: z.number(),
  salePrice: z.number().nullable(),
  sku: z.string(),
  uom: z.string(),
  stock: z.number(),
  manageStock: z.boolean(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  attributes: z.array(AdminCatalogAttributeSchema),
  variants: z.array(AdminCatalogVariantSchema),
  seo: AdminCatalogSeoSchema,
  publishedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type AdminCatalogItem = z.infer<typeof AdminCatalogItemSchema>

export const AdminCatalogCategorySchema = z.object({
  id: z.string(),
  siteId: z.string(),
  key: z.string(),
  parent: z.string().nullable(),
  order: z.number(),
  title: z.record(z.string(), z.string()),
  slug: z.record(z.string(), z.string()),
  fullPath: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  thumbnail: z.string().nullable(),
  revision: z.number(),
  itemCount: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})
export type AdminCatalogCategory = z.infer<typeof AdminCatalogCategorySchema>

export const AdminCatalogListMetaSchema = z.object({
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
  counts: z.record(z.string(), z.number()),
})
export type AdminCatalogListMeta = z.infer<typeof AdminCatalogListMetaSchema>

/**
 * What an editor may submit. Status, revision, timestamps and `publishedAt` are
 * server-controlled and absent here on purpose.
 */
export const AdminCatalogItemDraftSchema = z.object({
  key: z.string(),
  type: z.enum(ADMIN_CATALOG_ITEM_TYPES),
  title: z.record(z.string(), z.string()),
  slug: z.record(z.string(), z.string()),
  shortDesc: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  thumbnail: z.string().nullable(),
  gallery: z.array(z.string()),
  basePrice: z.number(),
  salePrice: z.number().nullable(),
  sku: z.string(),
  uom: z.string(),
  stock: z.number(),
  manageStock: z.boolean(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  attributes: z.array(AdminCatalogAttributeSchema),
  variants: z.array(AdminCatalogVariantSchema),
  seo: AdminCatalogSeoSchema,
})
export type AdminCatalogItemDraft = z.infer<typeof AdminCatalogItemDraftSchema>

export const AdminCatalogCategoryDraftSchema = z.object({
  key: z.string(),
  parent: z.string().nullable(),
  order: z.number(),
  title: z.record(z.string(), z.string()),
  slug: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  thumbnail: z.string().nullable(),
})
export type AdminCatalogCategoryDraft = z.infer<typeof AdminCatalogCategoryDraftSchema>

/** Partial price/stock patch applied to many records at once (max 100 rows). */
export const AdminCatalogBulkPatchSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    revision: z.number().int().min(1),
    basePrice: z.number().nonnegative().optional(),
    salePrice: z.number().nonnegative().nullable().optional(),
    stock: z.number().int().optional(),
  })).min(1).max(100),
})
export type AdminCatalogBulkPatch = z.infer<typeof AdminCatalogBulkPatchSchema>

/**
 * Selection by filter instead of explicit rows. Soft-deleted records are never
 * touched, so `deleted` is not a valid scope here; an empty filter means "every
 * live record of the site" and is capped server-side.
 */
export const ADMIN_CATALOG_BULK_STATUSES = ['draft', 'published', 'archived'] as const

export const AdminCatalogBulkFilterSchema = z.object({
  status: z.enum(ADMIN_CATALOG_BULK_STATUSES).optional(),
  type: z.enum(ADMIN_CATALOG_ITEM_TYPES).optional(),
  tag: z.string().max(60).optional(),
  category: z.string().max(120).optional(),
  q: z.string().max(80).optional(),
})
export type AdminCatalogBulkFilter = z.infer<typeof AdminCatalogBulkFilterSchema>

export const AdminCatalogBulkByFilterPatchSchema = z.object({
  filter: AdminCatalogBulkFilterSchema.default({}),
  basePrice: z.number().nonnegative().optional(),
  salePrice: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().optional(),
}).refine(
  patch => patch.basePrice !== undefined || patch.salePrice !== undefined || patch.stock !== undefined,
  { message: 'At least one field must be provided', path: ['basePrice'] },
)
export type AdminCatalogBulkByFilterPatch = z.infer<typeof AdminCatalogBulkByFilterPatchSchema>

export const AdminCatalogBulkRowSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  revision: z.number().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})
export type AdminCatalogBulkRow = z.infer<typeof AdminCatalogBulkRowSchema>

export const AdminCatalogBulkResultSchema = z.object({
  results: z.array(AdminCatalogBulkRowSchema),
  succeeded: z.number(),
  failed: z.number(),
})
export type AdminCatalogBulkResult = z.infer<typeof AdminCatalogBulkResultSchema>
