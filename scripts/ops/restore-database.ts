import process from 'node:process'
import { restoreDatabase, verifyBackup } from '../../tm-cms/server/services/backupService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * `pnpm restore:database --from .backups/sen-tuan [--database sen-tuan-restore] [--apply]`
 *
 * Dry run unless `--apply` is passed: it verifies the dump against its manifest and
 * prints what a restore would write. Restoring into the same database the dump came
 * from needs `--force`, because that is the one way to lose live data with this
 * command; a drill should target a scratch database instead.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const from = flag('from')
if (!from) throw new Error('Pass --from <backup directory> (the folder holding manifest.json)')

const manifest = await verifyBackup(from)
const target = flag('database') || manifest.database
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

if (apply && target === manifest.database && !force) {
  throw new Error(
    `Refusing to overwrite the live database "${target}". Restore into a scratch database and compare, or pass --force if you really mean it.`,
  )
}

const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const total = manifest.collections.reduce((sum, entry) => sum + entry.count, 0)

console.log(`restore from ${from}`)
console.log(`  backup of "${manifest.database}" taken ${manifest.createdAt}`)
console.log(`  target database: ${target}`)
console.log(`  ${manifest.collections.length} collections, ${total} documents, every file matches its manifest`)

if (!apply) {
  console.log('  nothing was written; rerun with --apply to restore')
} else {
  const connection = await connectDatabase({ uri, database: target })
  try {
    const report = await restoreDatabase(connection, from, { drop: target !== manifest.database })
    for (const entry of report.collections) {
      console.log(`  ${entry.name.padEnd(28)} ${String(entry.inserted).padStart(6)} docs  ${entry.sha256.slice(0, 12)}`)
    }
    console.log(`  restored into "${report.database}"; every collection re-hashed to the backup value`)
  } finally {
    await closeDatabaseConnections()
  }
}
