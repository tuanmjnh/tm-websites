import process from 'node:process'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import { planBundle, restoreBundle } from '../../tm-cms/server/services/backupBundleService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * `pnpm restore:all --customer sentuan [--out .backups] [--database scratch] [--root <media root>] [--apply] [--prune]`
 *
 * Restores the pair a backup produced: database first, then the media bytes, after
 * verifying both halves. Dry run unless `--apply`. Restoring over the customer's live
 * database needs `--force`, exactly like `restore:database`; a drill should name a
 * scratch database and a scratch media root with `--root`.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const customerId = flag('customer') || process.env.TM_CUSTOMER_ID
if (!customerId) throw new Error('Pass --customer <customerId> or set TM_CUSTOMER_ID')

const customer = customers[customerId]
if (!customer) throw new Error(`Unknown customer "${customerId}"`)

const database = customer.dataSources?.mongo?.database
if (!database) throw new Error(`Customer "${customerId}" declares no mongo database in the registry`)

const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const plan = planBundle(customerId, database, { out: flag('out') })
const apply = process.argv.includes('--apply')
const prune = process.argv.includes('--prune')
const force = process.argv.includes('--force')
const targetDatabase = flag('database')
const mediaRoot = flag('root')

const connection = apply ? await connectDatabase({ uri, database: targetDatabase || database }) : null

try {
  const report = await restoreBundle(plan, {
    connection: connection ?? undefined,
    database: targetDatabase,
    mediaRoot,
    apply,
    prune,
    force,
  })

  const documents = report.manifests.database.collections.reduce((sum, entry) => sum + entry.count, 0)
  const bytes = report.manifests.media.files.reduce((sum, entry) => sum + entry.size, 0)

  console.log(`restore customer=${customerId}`)
  console.log(`  database: ${plan.databaseDir} — ${report.manifests.database.collections.length} collections, ${documents} documents`)
  console.log(`  media:    ${plan.mediaDir} — ${report.manifests.media.files.length} file(s), ${bytes} bytes`)
  console.log(`  every file matches its manifest, in both halves`)
  console.log(`  target database: ${report.target.database}`)
  console.log(`  target media:    ${report.target.mediaRoot}`)

  if (!apply) {
    console.log('  nothing was written; rerun with --apply to restore both halves')
  } else {
    console.log(`  restored ${report.database?.collections.length ?? 0} collection(s); every collection re-hashed to the backup value`)
    console.log(`  restored ${report.media?.restored ?? 0} media file(s), ${report.media?.bytes ?? 0} bytes; every file re-hashed to the archive value`)
    if (prune) console.log(`  pruned ${report.media?.removed ?? 0} file(s) the archive does not contain`)
  }
} finally {
  if (connection) await closeDatabaseConnections()
}
