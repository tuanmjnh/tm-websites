import { financeLedger } from '#server/services/financeReportService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const ledger = await withPreparedDb(event, ({ Payment }) =>
      financeLedger(Payment, siteId, {
        from: query.from,
        to: query.to,
        state: query.state,
        cursor: query.cursor,
        limit: query.limit,
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({
      data: ledger.data,
      meta: {
        totals: { receivable: ledger.totals.receivable, payable: ledger.totals.payable, voided: ledger.totals.voided },
        hasMore: ledger.hasMore,
        nextCursor: ledger.nextCursor ?? undefined,
      },
    })
  } catch (error) {
    return translateContentError(error)
  }
})
