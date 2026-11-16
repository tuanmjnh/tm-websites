import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Archive for the media bytes.
 *
 * The database backup restores the `media` documents; the files those documents point
 * at live on disk (`TM_MEDIA_DIR`, default `.data/media`) and were not covered by
 * anything. A database-only restore would therefore produce a library of broken
 * images — the rows would be perfect and every URL would 404.
 *
 * So: copy the whole tree next to the database dump, record every file's size and
 * sha256, and make the restore prove the bytes it wrote. Keys are stored relative with
 * forward slashes so a backup can move between machines.
 */

export const MEDIA_BACKUP_FORMAT_VERSION = 1

export interface MediaBackupEntry {
  key: string
  size: number
  sha256: string
}

export interface MediaBackupManifest {
  formatVersion: number
  root: string
  createdAt: string
  files: MediaBackupEntry[]
}

export class MediaBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaBackupError'
  }
}

function toKey(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

async function walk(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(root, full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

async function hashFile(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

/**
 * Copies `root` into `directory`. The target is cleared first: a leftover file from an
 * older archive would otherwise be restored silently, which is the failure this whole
 * manifest exists to prevent.
 */
export async function archiveMedia(
  root: string,
  directory: string,
): Promise<{ directory: string, manifest: MediaBackupManifest }> {
  const absoluteRoot = resolve(root)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })

  const files: MediaBackupEntry[] = []
  const sourceFiles = await walk(absoluteRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[]
    throw error
  })

  for (const file of sourceFiles) {
    const key = toKey(absoluteRoot, file)
    const target = join(directory, key)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file, target)
    files.push({ key, size: (await stat(file)).size, sha256: await hashFile(file) })
  }

  const manifest: MediaBackupManifest = {
    formatVersion: MEDIA_BACKUP_FORMAT_VERSION,
    root: absoluteRoot,
    createdAt: new Date().toISOString(),
    files,
  }
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { directory, manifest }
}

export async function readMediaManifest(directory: string): Promise<MediaBackupManifest> {
  let raw: string
  try {
    raw = await readFile(join(directory, 'manifest.json'), 'utf8')
  } catch {
    throw new MediaBackupError(`${directory} has no manifest.json`)
  }
  const manifest = JSON.parse(raw) as MediaBackupManifest
  if (manifest.formatVersion !== MEDIA_BACKUP_FORMAT_VERSION) {
    throw new MediaBackupError(
      `Media backup format ${manifest.formatVersion} is not supported (expected ${MEDIA_BACKUP_FORMAT_VERSION})`,
    )
  }
  return manifest
}

/**
 * Checks the archive without touching the live tree: every manifest entry must exist,
 * keep its size, and hash to the recorded value. A file the manifest does not know is
 * also refused — it would be restored as if it belonged to the customer.
 */
export async function verifyMediaBackup(directory: string): Promise<MediaBackupManifest> {
  const manifest = await readMediaManifest(directory)
  const expected = new Map(manifest.files.map(entry => [entry.key, entry]))

  for (const entry of manifest.files) {
    const file = join(directory, entry.key)
    const info = await stat(file).catch(() => null)
    if (!info) throw new MediaBackupError(`${entry.key}: missing from the archive`)
    if (info.size !== entry.size) {
      throw new MediaBackupError(`${entry.key}: ${info.size} bytes, manifest says ${entry.size}`)
    }
    const sha256 = await hashFile(file)
    if (sha256 !== entry.sha256) {
      throw new MediaBackupError(`${entry.key}: sha256 ${sha256} does not match the manifest`)
    }
  }

  const archived = (await walk(directory)).map(file => toKey(directory, file))
  const unknown = archived.filter(key => key !== 'manifest.json' && !expected.has(key))
  if (unknown.length > 0) {
    throw new MediaBackupError(`${unknown[0]}: in the archive but not in the manifest`)
  }

  for (const key of expected.keys()) {
    if (key.split('/').includes('..')) throw new MediaBackupError(`${key}: a key may not leave the archive`)
  }

  return manifest
}

export interface MediaRestoreReport {
  root: string
  restored: number
  bytes: number
  removed: number
}

/**
 * Restores a verified archive under `root`, then re-hashes what it wrote: a restore
 * that reports success has proven the bytes, not just the copy calls. Files already in
 * `root` that the archive does not contain are removed only when `prune` is asked for,
 * because deleting media nobody backed up is not something a restore should assume.
 */
export async function restoreMedia(
  directory: string,
  root: string,
  options: { prune?: boolean } = {},
): Promise<MediaRestoreReport> {
  const manifest = await verifyMediaBackup(directory)
  const absoluteRoot = resolve(root)
  let bytes = 0
  let removed = 0

  for (const entry of manifest.files) {
    const target = join(absoluteRoot, entry.key)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(directory, entry.key), target)
    const sha256 = await hashFile(target)
    if (sha256 !== entry.sha256) {
      throw new MediaBackupError(`${entry.key}: restored bytes differ from the archive`)
    }
    bytes += entry.size
  }

  if (options.prune) {
    const expected = new Set(manifest.files.map(entry => entry.key))
    for (const file of await walk(absoluteRoot).catch(() => [] as string[])) {
      const key = toKey(absoluteRoot, file)
      if (expected.has(key)) continue
      await rm(file, { force: true })
      removed++
    }
  }

  return { root: absoluteRoot, restored: manifest.files.length, bytes, removed }
}
