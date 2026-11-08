import mongoose from 'mongoose'
import type { H3Event } from 'h3'
import {
  buildPublicCart,
  type PublicCart,
  type PublicCartLineInput,
} from '@tm/flow-contracts'
import {
  CatalogItemCategoryModel,
  CatalogItemModel,
  CATALOG_CATEGORY_PROJECTION,
  CATALOG_ITEM_DETAIL_PROJECTION,
} from '#server/models/catalog'
import { withCatalogDb } from './mongo'
import { PUBLISHED_ITEM_FILTER, getCatalogCurrency } from './catalogService'
import {
  toCatalogItemDetail,
  type CatalogMappingContext,
  type CatalogRecord,
} from './catalogMapper'

/**
 * Revalidates a client-owned cart against the published catalog.
 *
 * Ids that are malformed or no longer published simply miss the lookup, so the
 * builder reports them as `item_unavailable` instead of the request failing:
 * a visitor must still be able to see and clear a stale cart entry.
 */
export async function revalidatePublicCart(
  event: H3Event,
  lines: PublicCartLineInput[]
): Promise<PublicCart> {
  const currency = getCatalogCurrency(event)
  if (!lines.length) return buildPublicCart([], [], currency)

  const ids = [...new Set(lines.map(line => line.itemId))]
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id))

  if (!ids.length) return buildPublicCart([], lines, currency)

  return withCatalogDb(event, async () => {
    const docs = await CatalogItemModel
      .find({ ...PUBLISHED_ITEM_FILTER, _id: { $in: ids } }, CATALOG_ITEM_DETAIL_PROJECTION)
      .lean()

    const records = docs as unknown as CatalogRecord[]
    const categoryIds = [
      ...new Set(records.flatMap(record => (Array.isArray(record.categories) ? record.categories : []).map(String))),
    ]

    const categoriesById = new Map<string, CatalogRecord>()
    if (categoryIds.length) {
      const categories = await CatalogItemCategoryModel
        .find({ _id: { $in: categoryIds.filter(id => mongoose.Types.ObjectId.isValid(id)) } }, CATALOG_CATEGORY_PROJECTION)
        .lean()

      for (const category of categories as unknown as CatalogRecord[]) {
        categoriesById.set(String(category._id), category)
      }
    }

    const context: CatalogMappingContext = { currency, categoriesById }
    const items = []
    for (const record of records) {
      const mapped = toCatalogItemDetail(record, context)
      if (mapped) items.push(mapped)
    }

    return buildPublicCart(items, lines, currency)
  })
}
