import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MediaBackupError,
  archiveMedia,
  restoreMedia,
  verifyMediaBackup,
} from '../../tm-cms/server/services/mediaBackupService.js'

/**
 * The media archive exists because the database dump cannot carry the bytes. This test
 * runs on the filesystem alone: it archives a nested tree, proves the bytes come back,
 * and proves the three ways an archive lies — an edited file, a file the manifest does
 * not know, and a missing manifest.
 */

let checks = 0
let failed = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    failed++
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const workDir = await mkdtemp(join(tmpdir(), 'tm-media-backup-'))
const sourceRoot = join(workDir, 'media', 'sentuan')
const archiveDir = join(workDir, 'archive')
const restoreDir = join(workDir, 'restored')

try {
  await mkdir(join(sourceRoot, '2026', 'nested'), { recursive: true })
  await writeFile(join(sourceRoot, '2026', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))
  await writeFile(join(sourceRoot, '2026', 'nested', 'b.pdf'), 'a pdf stand-in')
  await writeFile(join(sourceRoot, 'empty.txt'), '')

  const { manifest } = await archiveMedia(sourceRoot, archiveDir)

  await check('the archive records every file with its size and hash', () => {
    assert.equal(manifest.files.length, 3)
    const keys = manifest.files.map(entry => entry.key).sort()
    assert.deepEqual(keys, ['2026/a.png', '2026/nested/b.pdf', 'empty.txt'])
    assert.equal(manifest.files.find(entry => entry.key === 'empty.txt')?.size, 0)
  })

  await check('the tree is copied byte for byte', async () => {
    const original = await readFile(join(sourceRoot, '2026', 'a.png'))
    const copied = await readFile(join(archiveDir, '2026', 'a.png'))
    assert.deepEqual(copied, original)
  })

  await check('verifyMediaBackup accepts an untouched archive', async () => {
    const verified = await verifyMediaBackup(archiveDir)
    assert.equal(verified.files.length, 3)
  })

  await check('a second archive of the same tree is identical', async () => {
    const first = JSON.parse(await readFile(join(archiveDir, 'manifest.json'), 'utf8')) as { files: Array<{ key: string, sha256: string }> }
    const again = await archiveMedia(sourceRoot, join(workDir, 'archive-2'))
    const second = again.manifest.files
    assert.deepEqual(
      second.map(entry => [entry.key, entry.sha256]),
      first.files.map(entry => [entry.key, entry.sha256]),
    )
  })

  await check('restore reproduces the bytes and re-hashes them', async () => {
    const report = await restoreMedia(archiveDir, restoreDir)
    assert.equal(report.restored, 3)
    assert.equal(report.bytes, 5 + 'a pdf stand-in'.length)
    assert.deepEqual(await readFile(join(restoreDir, '2026', 'a.png')), await readFile(join(sourceRoot, '2026', 'a.png')))
    assert.equal(await readFile(join(restoreDir, '2026', 'nested', 'b.pdf'), 'utf8'), 'a pdf stand-in')
    assert.equal((await stat(join(restoreDir, 'empty.txt'))).size, 0)
  })

  await check('restore leaves unknown target files alone unless prune is asked', async () => {
    await writeFile(join(restoreDir, 'stray.txt'), 'not in the archive')
    await restoreMedia(archiveDir, restoreDir)
    assert.equal(await readFile(join(restoreDir, 'stray.txt'), 'utf8'), 'not in the archive')
    const pruned = await restoreMedia(archiveDir, restoreDir, { prune: true })
    assert.equal(pruned.removed, 1)
    await assert.rejects(() => stat(join(restoreDir, 'stray.txt')))
  })

  await check('an edited file is refused before anything is restored', async () => {
    const tampered = join(workDir, 'tampered')
    await archiveMedia(sourceRoot, tampered)
    await writeFile(join(tampered, '2026', 'a.png'), Buffer.from('changed'))
    await assert.rejects(() => verifyMediaBackup(tampered), MediaBackupError)
    const target = join(workDir, 'never-written')
    await assert.rejects(() => restoreMedia(tampered, target), MediaBackupError)
    await assert.rejects(() => stat(target), 'nothing may be written from a bad archive')
  })

  await check('a file the manifest does not know is refused', async () => {
    const extra = join(workDir, 'extra')
    await archiveMedia(sourceRoot, extra)
    await writeFile(join(extra, '2026', 'ghost.png'), 'not in the manifest')
    await assert.rejects(() => verifyMediaBackup(extra), /not in the manifest/)
  })

  await check('a missing manifest is refused, not treated as an empty archive', async () => {
    const empty = join(workDir, 'empty-archive')
    await mkdir(empty, { recursive: true })
    await assert.rejects(() => verifyMediaBackup(empty), /no manifest/)
  })

  await check('an empty media root archives cleanly', async () => {
    const emptyRoot = join(workDir, 'empty-root')
    await mkdir(emptyRoot, { recursive: true })
    const empty = await archiveMedia(emptyRoot, join(workDir, 'empty-archive-2'))
    assert.equal(empty.manifest.files.length, 0)
    const report = await restoreMedia(join(workDir, 'empty-archive-2'), join(workDir, 'empty-restored'))
    assert.equal(report.restored, 0)
  })

  await check('re-archiving clears a file the source no longer has', async () => {
    const staleDir = join(workDir, 'stale')
    await archiveMedia(sourceRoot, staleDir)
    await rm(join(sourceRoot, 'empty.txt'))
    await archiveMedia(sourceRoot, staleDir)
    await assert.rejects(() => stat(join(staleDir, 'empty.txt')), 'the old file must not survive')
    await writeFile(join(sourceRoot, 'empty.txt'), '')
  })

  console.log(`\n${checks}/${checks + failed} checks passed.`)
} finally {
  await rm(workDir, { recursive: true, force: true })
}
