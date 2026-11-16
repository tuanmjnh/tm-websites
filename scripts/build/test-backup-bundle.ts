import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackupBundleError,
  backupBundle,
  planBundle,
  restoreBundle,
  verifyBundle,
} from '../../tm-cms/server/services/backupBundleService.js'
import { archiveMedia } from '../../tm-cms/server/services/mediaBackupService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * The bundle exists because the two halves are dangerous apart. This test proves the
 * pairing end to end: it seeds a database and a media tree, backs both up in one call,
 * then refuses the three ways a half-verified bundle can lie (missing archive, missing
 * dump, edited file) and finally restores the pair into scratch targets and checks the
 * bytes — not just the counts.
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

async function expectRefusal(name: string, expected: string, fn: () => Promise<unknown>) {
  await check(name, async () => {
    let message = ''
    try {
      await fn()
    } catch (error) {
      message = (error as Error).message
    }
    assert.ok(message, 'expected the call to fail, but it resolved')
    assert.match(message, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  })
}

const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const suffix = Date.now().toString(36)
const SOURCE_DB = `tm-ci-bundle-source-${suffix}`
const TARGET_DB = `tm-ci-bundle-target-${suffix}`
const CUSTOMER = 'bundletest'

const workspace = await mkdtemp(join(tmpdir(), 'tm-bundle-'))
const liveMedia = join(workspace, 'live-media', CUSTOMER)
const out = join(workspace, '.backups')
const restoreMediaRoot = join(workspace, 'restored-media')
const plan = planBundle(CUSTOMER, SOURCE_DB, { out, mediaRoot: liveMedia })

const source = await connectDatabase({ uri, database: SOURCE_DB })
const target = await connectDatabase({ uri, database: TARGET_DB })

try {
  await source.db!.collection('catalog_items').insertMany([
    { key: 'ao-lua', title: { vi: 'Áo lụa' }, price: 250000, updatedAt: new Date('2026-02-03T04:05:06.000Z') },
    { key: 'quan-au', title: { vi: 'Quần âu' }, price: 480000 },
  ])
  await mkdir(join(liveMedia, '2026'), { recursive: true })
  await writeFile(join(liveMedia, '2026', 'a.png'), Buffer.from('png-bytes-here'))
  await writeFile(join(liveMedia, '2026', 'b.pdf'), Buffer.from('%PDF-1.4 payload'))

  await check('the plan keeps the two spellings apart', () => {
    assert.equal(plan.databaseDir, join(out, SOURCE_DB))
    assert.equal(plan.out, out)
    assert.equal(plan.mediaDir, join(out, 'media', CUSTOMER))
    assert.equal(plan.mediaRoot, liveMedia)
  })

  let backup: Awaited<ReturnType<typeof backupBundle>>
  await check('backup:all writes and verifies both halves', async () => {
    backup = await backupBundle(source, plan)
    assert.equal(backup.manifests.database.collections.length, 1)
    assert.equal(backup.manifests.database.collections[0]!.count, 2)
    assert.equal(backup.manifests.media.files.length, 2)
  })

  await check('the pair verifies from disk alone', async () => {
    const manifests = await verifyBundle(plan)
    assert.equal(manifests.media.files.length, 2)
    assert.equal(manifests.database.collections[0]!.count, 2)
  })

  await expectRefusal('a missing media archive is refused, and says which command writes it', 'backup:media', async () => {
    const withoutMedia = planBundle(CUSTOMER, SOURCE_DB, { out, mediaRoot: liveMedia })
    await rm(withoutMedia.mediaDir, { recursive: true, force: true })
    try {
      await verifyBundle(withoutMedia)
    } finally {
      // put the real archive back for the checks below
      await archiveMedia(liveMedia, withoutMedia.mediaDir)
    }
  })

  await expectRefusal('a missing database dump is refused, and says which command writes it', 'backup:database', async () => {
    const moved = `${plan.databaseDir}-moved`
    await rm(moved, { recursive: true, force: true })
    await rename(plan.databaseDir, moved)
    try {
      await verifyBundle(plan)
    } finally {
      await rename(moved, plan.databaseDir)
    }
  })

  await check('an edited media file is refused by its hash, at the same size', async () => {
    const file = join(plan.mediaDir, '2026', 'a.png')
    const original = await readFile(file)
    // Same length on purpose: the size check cannot catch this, only the sha256 can.
    await writeFile(file, Buffer.from('png-bytes-HERE'))
    try {
      let message = ''
      await verifyBundle(plan).catch((error: Error) => { message = error.message })
      assert.match(message, /sha256/)
    } finally {
      await writeFile(file, original)
    }
  })

  await check('an edited dump is refused by its hash, at the same document count', async () => {
    const file = join(plan.databaseDir, 'catalog_items.jsonl')
    const original = await readFile(file, 'utf8')
    await writeFile(file, original.replace('250000', '999999'), 'utf8')
    try {
      let message = ''
      await verifyBundle(plan).catch((error: Error) => { message = error.message })
      assert.match(message, /does not match/)
    } finally {
      await writeFile(file, original, 'utf8')
    }
  })

  await check('a dry run reports the pair and writes nothing', async () => {
    const report = await restoreBundle(plan, { database: TARGET_DB, mediaRoot: restoreMediaRoot })
    assert.equal(report.database, null)
    assert.equal(report.media, null)
    assert.equal(report.target.database, TARGET_DB)
    assert.equal(await target.db!.collection('catalog_items').countDocuments(), 0)
    await assert.rejects(readFile(join(restoreMediaRoot, '2026', 'a.png')))
  })

  await check('apply restores the database and the bytes together', async () => {
    const report = await restoreBundle(plan, {
      connection: target,
      database: TARGET_DB,
      mediaRoot: restoreMediaRoot,
      apply: true,
    })
    assert.equal(report.database?.collections[0]?.inserted, 2)
    assert.equal(report.media?.restored, 2)
    assert.equal(report.media?.bytes, 'png-bytes-here'.length + '%PDF-1.4 payload'.length)

    const rows = await target.db!.collection('catalog_items').find({}).sort({ key: 1 }).toArray()
    assert.deepEqual(rows.map(row => row.key), ['ao-lua', 'quan-au'])
    assert.equal(await readFile(join(restoreMediaRoot, '2026', 'a.png'), 'utf8'), 'png-bytes-here')
    assert.equal(await readFile(join(restoreMediaRoot, '2026', 'b.pdf'), 'utf8'), '%PDF-1.4 payload')
  })

  await expectRefusal('restoring over the dump’s own database needs --force', 'refusing to overwrite the live database', async () => {
    await restoreBundle(plan, {
      connection: source,
      database: SOURCE_DB,
      mediaRoot: restoreMediaRoot,
      apply: true,
    })
  })

  await check('a half bundle is a typed error, not a generic failure', async () => {
    const incomplete = planBundle(CUSTOMER, SOURCE_DB, { out: join(workspace, 'nowhere'), mediaRoot: liveMedia })
    await assert.rejects(verifyBundle(incomplete), (error: unknown) => {
      assert.ok(error instanceof BackupBundleError)
      assert.equal(error.code, 'DATABASE_DUMP_MISSING')
      return true
    })
  })
} finally {
  await source.db?.dropDatabase().catch(() => {})
  await target.db?.dropDatabase().catch(() => {})
  await closeDatabaseConnections()
  await rm(workspace, { recursive: true, force: true })
  console.log(`\n${checks}/${checks + failed} checks passed`)
}
