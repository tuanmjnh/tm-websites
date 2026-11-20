import { supplierPriceHistory } from '#server/services/supplierPriceService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SupplierPriceQuerySchema = z.object({
  supplierId: z.string().trim().max(64).optional(),
  itemId: z.string().trim().max(64).optional(),
  variantId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(SupplierPriceQuerySchema, getQuery(event), 'SUPPLIER_PRICE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ PurchaseOrder, InventoryTransaction }) =>
      supplierPriceHistory({ PurchaseOrder, InventoryTransaction }, siteId, {
        supplierId: query.supplierId ?? null,
        itemId: query.itemId ?? null,
        variantId: query.variantId,
        from: query.from ?? null,
        to: query.to ?? null,
        limit: query.limit ?? null,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
