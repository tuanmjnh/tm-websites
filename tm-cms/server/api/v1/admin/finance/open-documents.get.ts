import { listOpenDocuments, type PaymentTargets } from '#server/services/paymentService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const OpenDocumentQuerySchema = z.object({
  model: z.enum(['Order', 'PurchaseOrder']).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

/**
 * The documents a payment can still be applied to, for the payment dialog's
 * picker. Replaces the previous workflow of pasting a database id.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(OpenDocumentQuerySchema, getQuery(event), 'PAYMENT_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Order, PurchaseOrder, Customer, Supplier }) =>
      listOpenDocuments(
        {
          order: Order,
          purchaseOrder: PurchaseOrder,
          // The picker only reads a display name from these two models.
          customer: Customer as unknown as PaymentTargets['customer'],
          supplier: Supplier as unknown as PaymentTargets['supplier'],
        },
        siteId,
        query,
      ))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result.data, meta: { hasMore: result.hasMore } })
  } catch (error) {
    return translateContentError(error)
  }
})
