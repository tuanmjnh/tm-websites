import mongoose, { type Model } from 'mongoose'

const { Schema, model } = mongoose

/** The CMS owns these collections; the storefront never types or validates them. */
export type CatalogDoc = Record<string, unknown>

// The storefront reads collections written by the CMS, so the schemas stay
// `strict: false` and every field is Mixed. Mongoose is used only to reuse a
// pooled connection and to apply an explicit projection; nothing is validated
// or written back here. The service never selects a field that is not part of
// the public read model.

const loose = { type: Schema.Types.Mixed }

const sharedOptions = {
  strict: false,
  versionKey: false,
  timestamps: false,
} as const

const itemSchema = new Schema<CatalogDoc>(
  {
    title: loose,
    slug: loose,
    fullPath: loose,
    shortDesc: loose,
    description: loose,
    basePrice: Number,
    salePrice: Number,
    thumbnail: loose,
    gallery: loose,
    categories: loose,
    tags: loose,
    sku: String,
    uom: String,
    type: String,
    stock: Number,
    manageStock: Boolean,
    variants: loose,
    attributes: loose,
    options: loose,
    seo: loose,
    updatedAt: loose,
  },
  { ...sharedOptions, collection: 'items' }
)

const itemCategorySchema = new Schema<CatalogDoc>(
  {
    title: loose,
    slug: loose,
    fullPath: loose,
    description: loose,
    thumbnail: loose,
    pid: loose,
    ancestors: loose,
    displayOrder: Number,
    seo: loose,
    updatedAt: loose,
  },
  { ...sharedOptions, collection: 'item_categories' }
)

export const CatalogItemModel: Model<CatalogDoc> =
  mongoose.models.CatalogItem ?? model<CatalogDoc>('CatalogItem', itemSchema)
export const CatalogItemCategoryModel: Model<CatalogDoc> =
  mongoose.models.CatalogItemCategory ?? model<CatalogDoc>('CatalogItemCategory', itemCategorySchema)

/** Fields returned for a product card. Filters such as status/isDeleted are not selected. */
export const CATALOG_ITEM_SUMMARY_PROJECTION = [
  'title',
  'slug',
  'fullPath',
  'shortDesc',
  'basePrice',
  'salePrice',
  'thumbnail',
  'categories',
  'tags',
  'type',
  'stock',
  'manageStock',
  'variants',
  'updatedAt',
].join(' ')

/** Summary fields plus the detail-only payload. */
export const CATALOG_ITEM_DETAIL_PROJECTION = `${CATALOG_ITEM_SUMMARY_PROJECTION} description gallery sku uom attributes seo`

export const CATALOG_CATEGORY_PROJECTION = 'title slug fullPath description thumbnail pid displayOrder updatedAt'
