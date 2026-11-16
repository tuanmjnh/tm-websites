import process from 'node:process'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import { dumpDatabase } from '../../tm-cms/server/services/backupService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * `pnpm backup:database --customer sentuan [--out .backups] [--exclude audit_logs]`
 *
 * One customer database per run, written as `<out>/<database>/<collection>.jsonl` plus
 * a manifest with counts, sha256 and indexes. Read-only against Mongo: nothing here
 * writes to the customer database.
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
const out = flag('out') || '.backups'
const exclude = flags('exclude')

const connection = await connectDatabase({ uri, database })
try {
  const report = await dumpDatabase(connection, out, { exclude })
  console.log(`backup customer=${customerId} database=${report.manifest.database}`)
  console.log(`  directory: ${report.directory}`)
  for (const entry of report.manifest.collections) {
    console.log(`  ${entry.name.padEnd(28)} ${String(entry.count).padStart(6)} docs  ${entry.sha256.slice(0, 12)}  ${entry.indexes.length} index(es)`)
  }
  const total = report.manifest.collections.reduce((sum, entry) => sum + entry.count, 0)
  console.log(`  ${report.manifest.collections.length} collections, ${total} documents`)
} finally {
  await closeDatabaseConnections()
}
