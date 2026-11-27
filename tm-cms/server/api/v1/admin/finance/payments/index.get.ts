import { listPayments } from '#server/services/paymentService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PaymentListQuerySchema = z.object({
  direction: z.enum(['receivable', 'payable']).optional(),
  referenceModel: z.enum(['Order', 'PurchaseOrder']).optional(),
  referenceId: z.string().trim().max(64).optional(),
  partyId: z.string().trim().max(64).optional(),
  state: z.enum(['posted', 'voided']).optional(),
  reconciled: z.enum(['yes', 'no']).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(PaymentListQuerySchema, getQuery(event), 'PAYMENT_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ Payment }) => listPayments(Payment, siteId, query))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: result.data,
      meta: { nextCursor: result.nextCursor ?? undefined, hasMore: result.hasMore, counts: result.counts },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
