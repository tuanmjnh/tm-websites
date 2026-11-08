import process from 'node:process'
import { pruneRetention } from '../../tm-cms/server/services/retentionService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

/**
 * `pnpm prune:retention --site sentuan [--keep-revisions 50] [--audit-days 365] --apply`
 *
 * Dry run unless `--apply` is passed. The connection comes from `TM_MONGO_URI`
 * and `TM_MONGO_DB`, the site from `--site` or `TM_CUSTOMER_ID`. Nothing here
 * touches Hub; it only removes rows from one site's own database.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function intFlag(name: string): number | undefined {
  const raw = flag(name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`)
  return value
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const connection = await connectDatabase({ uri, database })
try {
  const { Audit, Revision } = await prepareDatabase(connection)
  const report = await pruneRetention({ Audit, Revision }, siteId, {
    keepRevisions: intFlag('keep-revisions'),
    auditDays: intFlag('audit-days'),
    dryRun: !process.argv.includes('--apply'),
  })

  console.log(`retention site=${report.siteId} dryRun=${report.dryRun}`)
  console.log(`  revisions  keep last ${report.keepRevisions} → ${report.revisions.deleted} removable, ${report.revisions.kept} kept, ${report.revisions.contents} content records over the cap`)
  console.log(`  audit      older than ${report.auditDays} days (${report.audit.cutoff}) → ${report.audit.deleted} removable`)
  if (report.dryRun) console.log('  nothing was deleted; rerun with --apply')
} finally {
  await closeDatabaseConnections()
}
