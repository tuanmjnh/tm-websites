import { z } from 'zod'

// ---------------------------------------------------------------------------
// Business model (CMS-side). The storefront never receives these fields.
// ---------------------------------------------------------------------------

export const ProductStatusSchema = z.enum(['draft', 'published', 'archived'])
export type ProductStatus = z.infer<typeof ProductStatusSchema>

export const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  sku: z.string().optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  images: z.array(z.string().url()).default([]),
  status: ProductStatusSchema.default('draft'),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  tenantId: z.string().min(1),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})
export type Product = z.infer<typeof ProductSchema>

export const PublicProductDTOSchema = ProductSchema.pick({
  id: true,
  name: true,
  slug: true,
  sku: true,
  price: true,
  compareAtPrice: true,
  summary: true,
  description: true,
  images: true,
  categories: true,
  tags: true,
})
export type PublicProductDTO = z.infer<typeof PublicProductDTOSchema>

// ---------------------------------------------------------------------------
// Public storefront read model.
//
// This is the only shape the website renders. Fields that exist on the legacy
// records but must never reach a visitor (tenantId, isDeleted, costPrice,
// supplierPrices, history, barcode, searchString, ...) are not represented here
// and are stripped by an explicit projection in the catalog service.
// ---------------------------------------------------------------------------

export const LocalizedTextSchema = z.record(z.string(), z.string())
export type LocalizedText = z.infer<typeof LocalizedTextSchema>

export const PUBLIC_CATALOG_SORTS = ['newest', 'price-asc', 'price-desc', 'name-asc', 'popular'] as const
export type PublicCatalogSort = typeof PUBLIC_CATALOG_SORTS[number]

export const PublicCatalogCategoryRefSchema = z.object({
  id: z.string().min(1),
  name: LocalizedTextSchema,
  slug: LocalizedTextSchema,
  path: z.string().startsWith('/'),
})
export type PublicCatalogCategoryRef = z.infer<typeof PublicCatalogCategoryRefSchema>

export const PublicCatalogCategorySchema = PublicCatalogCategoryRefSchema.extend({
  description: LocalizedTextSchema.optional(),
  parentId: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  itemCount: z.number().int().nonnegative().optional(),
})
export type PublicCatalogCategory = z.infer<typeof PublicCatalogCategorySchema>

export const PublicCatalogVariantSchema = z.object({
  sku: z.string().optional(),
  name: LocalizedTextSchema.optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  inStock: z.boolean(),
})
export type PublicCatalogVariant = z.infer<typeof PublicCatalogVariantSchema>

export const PublicCatalogAttributeSchema = z.object({
  name: LocalizedTextSchema,
  value: LocalizedTextSchema,
})
export type PublicCatalogAttribute = z.infer<typeof PublicCatalogAttributeSchema>

export const PublicCatalogItemSummarySchema = z.object({
  id: z.string().min(1),
  slug: LocalizedTextSchema,
  path: z.string().startsWith('/'),
  name: LocalizedTextSchema,
  summary: LocalizedTextSchema.optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  currency: z.string().min(1),
  thumbnail: z.string().nullable().optional(),
  categories: z.array(PublicCatalogCategoryRefSchema).default([]),
  tags: z.array(z.string()).default([]),
  inStock: z.boolean(),
  updatedAt: z.string().nullable().optional(),
})
export type PublicCatalogItemSummary = z.infer<typeof PublicCatalogItemSummarySchema>

export const PublicCatalogItemDetailSchema = PublicCatalogItemSummarySchema.extend({
  description: LocalizedTextSchema.optional(),
  sku: z.string().nullable().optional(),
  uom: z.string().nullable().optional(),
  gallery: z.array(z.string()).default([]),
  variants: z.array(PublicCatalogVariantSchema).default([]),
  attributes: z.array(PublicCatalogAttributeSchema).default([]),
  seo: z.object({
    title: LocalizedTextSchema.optional(),
    description: LocalizedTextSchema.optional(),
    image: z.string().nullable().optional(),
  }).optional(),
})
export type PublicCatalogItemDetail = z.infer<typeof PublicCatalogItemDetailSchema>

export const PublicCatalogQuerySchema = z.object({
  category: z.string().trim().min(1).max(180).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sort: z.enum(PUBLIC_CATALOG_SORTS).default('newest'),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
})
export type PublicCatalogQuery = z.infer<typeof PublicCatalogQuerySchema>

export const PublicCatalogListSchema = z.object({
  success: z.literal(true),
  data: z.array(PublicCatalogItemSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  hasMore: z.boolean(),
})
export type PublicCatalogList = z.infer<typeof PublicCatalogListSchema>

export const PublicCatalogApiResponseSchema = z.object({
  success: z.literal(true),
  data: PublicCatalogItemDetailSchema,
})
export type PublicCatalogApiResponse = z.infer<typeof PublicCatalogApiResponseSchema>

/** Public URL for a product slug. Kept locale-free so one URL serves all locales. */
export function catalogItemPath(slug: string): string {
  const clean = String(slug ?? '').trim().replace(/^\/+|\/+$/g, '')
  return clean ? `/products/${clean}` : ''
}

/** Public URL for a category slug. */
export function catalogCategoryPath(slug: string): string {
  const clean = String(slug ?? '').trim().replace(/^\/+|\/+$/g, '')
  return clean ? `/categories/${clean}` : ''
}

const CATALOG_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Validates a slug coming from a URL segment before it reaches a query. */
export function normalizeCatalogSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const segment = value.trim().toLowerCase()
  if (!segment || segment.length > 180) return null
  if (!CATALOG_SEGMENT_PATTERN.test(segment)) return null
  return segment
}

/** Normalizes a single catalog route segment (products/[slug]). */
export function catalogSegmentFromParam(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null

  let decoded = ''
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }

  return normalizeCatalogSegment(decoded)
}
