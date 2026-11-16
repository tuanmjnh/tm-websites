import process from 'node:process'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import { backupBundle, planBundle } from '../../tm-cms/server/services/backupBundleService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * `pnpm backup:all --customer sentuan [--out .backups] [--exclude audit_logs]`
 *
 * Both halves of one customer in one command: the database dump and the media bytes.
 * Running them separately is how a restore ends up with rows pointing at files nobody
 * copied, so this is the command a launch or a schedule should call.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

function flags(name: string): string[] {
  const values: string[] = []
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]!)
  })
  return values
}

const customerId = flag('customer') || process.env.TM_CUSTOMER_ID
if (!customerId) throw new Error('Pass --customer <customerId> or set TM_CUSTOMER_ID')

const customer = customers[customerId]
if (!customer) throw new Error(`Unknown customer "${customerId}"`)

const database = customer.dataSources?.mongo?.database
if (!database) throw new Error(`Customer "${customerId}" declares no mongo database in the registry`)

const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const plan = planBundle(customerId, database, { out: flag('out'), mediaRoot: flag('root') })

const connection = await connectDatabase({ uri, database })
try {
  const report = await backupBundle(connection, plan, { exclude: flags('exclude') })
  const { database: dump, media } = report.manifests
  const documents = dump.collections.reduce((sum, entry) => sum + entry.count, 0)
  const bytes = media.files.reduce((sum, entry) => sum + entry.size, 0)

  console.log(`backup customer=${customerId}`)
  console.log(`  database: ${plan.databaseDir} — ${dump.collections.length} collections, ${documents} documents`)
  console.log(`  media:    ${plan.mediaDir} — ${media.files.length} file(s), ${bytes} bytes (root ${media.root})`)
  console.log('  both halves verified against their manifests just now')
  if (media.files.length === 0) {
    console.log('  note: no media bytes exist for this customer yet, so the archive proves nothing')
  }
} finally {
  await closeDatabaseConnections()
}
