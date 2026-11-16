import process from 'node:process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { restoreMedia, verifyMediaBackup } from '../../tm-cms/server/services/mediaBackupService.js'

/**
 * `pnpm restore:media --customer sentuan --from .backups/media/sentuan [--apply] [--prune]`
 *
 * Dry run unless `--apply`: it verifies every file against the manifest and prints what
 * a restore would write. `--prune` also deletes files in the target that the archive
 * does not contain, which is what makes the tree match the dump exactly.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const customerId = flag('customer') || process.env.TM_CUSTOMER_ID
if (!customerId) throw new Error('Pass --customer <customerId> or set TM_CUSTOMER_ID')

const from = flag('from')
if (!from) throw new Error('Pass --from <archive directory> (the folder holding manifest.json)')

function defaultRoot(): string {
  const configured = process.env.TM_MEDIA_DIR?.trim()
  if (configured) return resolve(configured)
  const cms = join(process.cwd(), 'tm-cms')
  return existsSync(cms) ? join(cms, '.data', 'media') : join(process.cwd(), '.data', 'media')
}

const root = flag('root') || join(defaultRoot(), customerId)
const apply = process.argv.includes('--apply')
const prune = process.argv.includes('--prune')

const manifest = await verifyMediaBackup(from)
const bytes = manifest.files.reduce((sum, entry) => sum + entry.size, 0)

console.log(`media restore from ${from}`)
console.log(`  archive of "${manifest.root}" taken ${manifest.createdAt}`)
console.log(`  target:  ${root}`)
console.log(`  ${manifest.files.length} file(s), ${bytes} bytes, every file matches the manifest`)

if (!apply) {
  console.log('  nothing was written; rerun with --apply to restore')
} else {
  const report = await restoreMedia(from, root, { prune })
  console.log(`  restored ${report.restored} file(s), ${report.bytes} bytes into ${report.root}`)
  if (prune) console.log(`  pruned ${report.removed} file(s) the archive does not contain`)
  console.log('  every restored file was re-hashed to the archive value')
}
