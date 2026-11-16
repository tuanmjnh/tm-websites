import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Connection } from 'mongoose'
import {
  dumpDatabase,
  restoreDatabase,
  verifyBackup,
  type BackupManifest,
  type RestoreReport,
} from './backupService'
import {
  archiveMedia,
  restoreMedia,
  verifyMediaBackup,
  type MediaBackupManifest,
  type MediaRestoreReport,
} from './mediaBackupService'

/**
 * A customer backup is a pair, and the pair is the point.
 *
 * The dump restores the `media` documents; the archive restores the bytes they point
 * at. Either half on its own is a trap: a database-only restore produces a library of
 * 404s, and a media-only restore leaves rows pointing at files the dump never had. The
 * two commands exist separately because an operator sometimes needs just one, but the
 * `all` pair is what a launch or a disaster actually restores, so it lives here with a
 * single rule: **verify both halves before writing either**.
 *
 * Verification first is not politeness. A restore writes into a live database and then
 * copies files over a live tree; discovering halfway that the media archive is missing
 * or edited would leave the two halves disagreeing, which is the state this service
 * exists to prevent. Every check is cheap (counts, sizes, sha256) next to that.
 */

export class BackupBundleError extends Error {
  constructor(
    message: string,
    readonly code: 'MEDIA_ARCHIVE_MISSING' | 'DATABASE_DUMP_MISSING' | 'BUNDLE_MISMATCH',
  ) {
    super(message)
    this.name = 'BackupBundleError'
  }
}

export interface BundlePlan {
  customerId: string
  database: string
  /** The shared root: `dumpDatabase` appends the database name itself. */
  out: string
  databaseDir: string
  mediaDir: string
  mediaRoot: string
}

/**
 * The CMS stores bytes under `tm-cms/.data/media` because that is the app's cwd while
 * ops commands run from the repository root, so the default is chosen by what exists
 * rather than by a guess. `TM_MEDIA_DIR` wins when set, exactly like the app.
 */
export function defaultMediaRoot(cwd = process.cwd()): string {
  const configured = process.env.TM_MEDIA_DIR?.trim()
  if (configured) return resolve(configured)
  const cms = join(cwd, 'tm-cms')
  return existsSync(cms) ? join(cms, '.data', 'media') : join(cwd, '.data', 'media')
}

/**
 * Where the two halves of `customerId`'s backup live under `out`. The database half is
 * keyed by database name (that is what `dumpDatabase` does), the media half by customer
 * (that is the directory the app writes to), so the plan is the only place that knows
 * both spellings.
 */
export function planBundle(
  customerId: string,
  database: string,
  options: { out?: string, mediaRoot?: string, cwd?: string } = {},
): BundlePlan {
  const out = options.out || '.backups'
  const root = options.mediaRoot || join(defaultMediaRoot(options.cwd), customerId)
  return {
    customerId,
    database,
    out,
    databaseDir: join(out, database),
    mediaDir: join(out, 'media', customerId),
    mediaRoot: root,
  }
}

export interface BundleManifests {
  database: BackupManifest
  media: MediaBackupManifest
}

/**
 * Proves a pair without touching anything: the dump matches its manifest, the archive
 * matches its manifest, and neither half is absent. A missing half is an error that
 * names the command which would have produced it — the operator reading it is usually
 * mid-incident and should not have to go find the runbook.
 */
export async function verifyBundle(plan: BundlePlan): Promise<BundleManifests> {
  if (!existsSync(join(plan.databaseDir, 'manifest.json'))) {
    throw new BackupBundleError(
      `${plan.databaseDir} has no database dump; run "pnpm backup:database --customer ${plan.customerId}" first`,
      'DATABASE_DUMP_MISSING',
    )
  }
  if (!existsSync(join(plan.mediaDir, 'manifest.json'))) {
    throw new BackupBundleError(
      `${plan.mediaDir} has no media archive; run "pnpm backup:media --customer ${plan.customerId}" first (a database-only restore leaves every media URL pointing at a file that is not there)`,
      'MEDIA_ARCHIVE_MISSING',
    )
  }

  const database = await verifyBackup(plan.databaseDir)
  const media = await verifyMediaBackup(plan.mediaDir)

  const archivedBytes = media.files.reduce((sum, entry) => sum + entry.size, 0)
  if (database.collections.length === 0 && media.files.length > 0) {
    throw new BackupBundleError(
      `the dump holds no collection while the media archive holds ${media.files.length} file(s) (${archivedBytes} bytes); the two halves do not describe the same site`,
      'BUNDLE_MISMATCH',
    )
  }

  return { database, media }
}

export interface BundleBackupReport {
  plan: BundlePlan
  manifests: BundleManifests
  directory: string
}

/**
 * Writes both halves, then verifies its own output. A backup that cannot be verified
 * immediately is not a backup yet, and the operator is still standing there.
 */
export async function backupBundle(
  connection: Connection,
  plan: BundlePlan,
  options: { exclude?: string[] } = {},
): Promise<BundleBackupReport> {
  const dump = await dumpDatabase(connection, plan.out, { exclude: options.exclude })
  await archiveMedia(plan.mediaRoot, plan.mediaDir)
  const manifests = await verifyBundle(plan)
  return { plan, manifests, directory: dump.directory }
}

export interface BundleRestoreReport {
  database: RestoreReport | null
  media: MediaRestoreReport | null
  manifests: BundleManifests
  target: { database: string, mediaRoot: string }
}

export interface RestoreBundleOptions {
  /** The connection `restoreDatabase` should write through; omitted in a dry run. */
  connection?: Connection
  /** Target database; `restoreDatabase` needs `--force` semantics to overwrite the source. */
  database?: string
  /** Target media root; defaults to the plan's live root. */
  mediaRoot?: string
  /** Writes only when true. A dry run verifies and reports. */
  apply?: boolean
  prune?: boolean
  /** Refuse to drop a database the dump did not come from; mirrors the CLI's rule. */
  force?: boolean
}

/**
 * Restores the pair in one order: database, then bytes. Both are verified before the
 * first write, and the media restore re-hashes every file it writes, so a success means
 * the two halves agree — not that the copy calls returned.
 */
export async function restoreBundle(
  plan: BundlePlan,
  options: RestoreBundleOptions = {},
): Promise<BundleRestoreReport> {
  const manifests = await verifyBundle(plan)
  const targetDatabase = options.database || manifests.database.database
  const targetMediaRoot = options.mediaRoot || plan.mediaRoot

  const report: BundleRestoreReport = {
    database: null,
    media: null,
    manifests,
    target: { database: targetDatabase, mediaRoot: resolve(targetMediaRoot) },
  }

  if (!options.apply) return report

  if (!options.connection) {
    throw new BackupBundleError('restoreBundle needs a database connection to apply', 'BUNDLE_MISMATCH')
  }
  if (targetDatabase === manifests.database.database && !options.force) {
    throw new BackupBundleError(
      `refusing to overwrite the live database "${targetDatabase}"; restore into a scratch database and compare, or pass --force if you really mean it`,
      'BUNDLE_MISMATCH',
    )
  }

  report.database = await restoreDatabase(options.connection, plan.databaseDir, {
    drop: targetDatabase !== manifests.database.database,
  })
  report.media = await restoreMedia(plan.mediaDir, targetMediaRoot, { prune: options.prune })
  return report
}
