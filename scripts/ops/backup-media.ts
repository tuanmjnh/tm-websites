import process from 'node:process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { archiveMedia } from '../../tm-cms/server/services/mediaBackupService.js'

/**
 * `pnpm backup:media --customer sentuan [--out .backups] [--root <dir>]`
 *
 * Copies one customer's subtree of the media root (default `<cms>/.data/media/<customer>`)
 * next to the database dump, with a manifest of sizes and sha256. Read-only against the
 * live tree; the archive directory is cleared first so an older file cannot be restored
 * as if it belonged to this customer.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const customerId = flag('customer') || process.env.TM_CUSTOMER_ID
if (!customerId) throw new Error('Pass --customer <customerId> or set TM_CUSTOMER_ID')

/**
 * The CMS stores bytes under `tm-cms/.data/media` because that is the app's cwd, while
 * ops commands run from the repository root. Rather than guess, the default is the
 * layout that exists here and `--root` overrides it.
 */
function defaultRoot(): string {
  const configured = process.env.TM_MEDIA_DIR?.trim()
  if (configured) return resolve(configured)
  const cms = join(process.cwd(), 'tm-cms')
  return existsSync(cms)
    ? join(cms, '.data', 'media')
    : join(process.cwd(), '.data', 'media')
}

const root = flag('root') || join(defaultRoot(), customerId)
const out = flag('out') || '.backups'
const directory = join(out, 'media', customerId)

const { manifest } = await archiveMedia(root, directory)

console.log(`media backup customer=${customerId}`)
console.log(`  root:      ${root}`)
console.log(`  directory: ${directory}`)
for (const entry of manifest.files) {
  console.log(`  ${entry.key.padEnd(48)} ${String(entry.size).padStart(9)} B  ${entry.sha256.slice(0, 12)}`)
}
const bytes = manifest.files.reduce((sum, entry) => sum + entry.size, 0)
console.log(`  ${manifest.files.length} file(s), ${bytes} bytes`)
if (manifest.files.length === 0) console.log('  the media root is empty: the archive proves nothing yet')
