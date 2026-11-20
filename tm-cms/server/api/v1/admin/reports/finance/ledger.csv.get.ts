import { exportLedgerCsv } from '#server/services/financeReportService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/**
 * A finance export is operator-level, not view-level: it leaves the system and
 * can carry a whole period of money movements, so it needs `content.write` on top
 * of read. Rows carry only what a reconciler needs — no actor ids, no internal
 * ids, no customer contact data.
 */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read', 'content.write')

  const siteId = resolveSiteId(event)
  const query = getQuery(event)

  try {
    const exported = await withPreparedDb(event, ({ Payment }) =>
      exportLedgerCsv(Payment, siteId, { from: query.from, to: query.to, state: query.state }))

    const stamp = `${String(query.from)}_${String(query.to)}`.replace(/[^0-9_]/g, '')
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="so-chi-tra-${stamp || 'ky'}.csv"`)
    setHeader(event, 'cache-control', 'no-store')
    setHeader(event, 'x-export-rows', String(exported.rows))
    if (exported.truncated) setHeader(event, 'x-export-truncated', 'true')

    return exported.csv
  } catch (error) {
    return translateContentError(error)
  }
})
