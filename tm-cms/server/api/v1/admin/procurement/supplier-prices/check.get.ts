import { checkSupplierPrice } from '#server/services/supplierPriceService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const SupplierPriceCheckQuerySchema = z.object({
  supplierId: z.string().trim().max(64).optional(),
  itemId: z.string().trim().min(1).max(64),
  variantId: z.string().trim().max(64).optional(),
  unitCost: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().nonnegative().optional(),
  thresholdPercent: z.coerce.number().min(0).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(SupplierPriceCheckQuerySchema, getQuery(event), 'SUPPLIER_PRICE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ PurchaseOrder, InventoryTransaction }) =>
      checkSupplierPrice({ PurchaseOrder, InventoryTransaction }, siteId, {
        supplierId: query.supplierId ?? null,
        itemId: query.itemId,
        variantId: query.variantId ?? null,
        unitCost: query.unitCost,
        quantity: query.quantity,
        thresholdPercent: query.thresholdPercent,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
