import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BackupIntegrityError,
  dumpDatabase,
  hashCollection,
  restoreDatabase,
  verifyBackup,
} from '../../tm-cms/server/services/backupService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'

/**
 * The backup path is only worth having if a restore proves it: this test seeds a
 * database with the types JSON would lose (ObjectId references, Dates, binary), dumps
 * it, restores it into another database, and compares the bytes — not just the counts.
 * It also proves the two ways a backup lies: an edited file, and a dropped collection.
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

const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const suffix = Date.now().toString(36)
const SOURCE_DB = `tm_test_backup_source_${suffix}`
const TARGET_DB = `tm_test_backup_target_${suffix}`

const source = await connectDatabase(testDatabaseBinding(SOURCE_DB))
const target = await connectDatabase(testDatabaseBinding(TARGET_DB))
const directoryRoot = await mkdtemp(join(tmpdir(), 'tm-backup-'))

try {
  const sourceDb = source.db!
  // The driver assigns the ObjectIds: the test must not need the driver's classes
  // itself, only prove that whatever ids exist come back as the same type.
  const inserted = await sourceDb.collection('catalog_items').insertMany([
    {
      key: 'ao-lua',
      title: { en: 'Silk shirt', vi: 'Áo lụa' },
      price: 250000,
      updatedAt: new Date('2026-01-02T03:04:05.000Z'),
    },
    {
      key: 'quan-au',
      title: { en: 'Trousers', vi: 'Quần âu' },
      price: 480000,
      updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    },
  ])
  const itemId = inserted.insertedIds[0]!
  const itemIdHex = itemId.toHexString()
  await sourceDb.collection('catalog_items').createIndex({ key: 1 }, { unique: true, name: 'key_1' })
  await sourceDb.collection('media').insertOne({
    itemId,
    blob: Buffer.from('binary survives the codec', 'utf8'),
    createdAt: new Date('2026-03-04T05:06:07.000Z'),
  })

  const originalItems = await hashCollection(source, 'catalog_items')
  const originalMedia = await hashCollection(source, 'media')

  const first = await dumpDatabase(source, directoryRoot)
  const second = await dumpDatabase(source, directoryRoot)

  await check('a dump records every collection with its count, hash and indexes', () => {
    assert.equal(first.manifest.collections.length, 2)
    const items = first.manifest.collections.find(entry => entry.name === 'catalog_items')
    assert.equal(items?.count, 2)
    assert.equal(items?.sha256, originalItems.sha256)
    assert.equal(items?.indexes.length, 1, 'the non-_id index is recorded')
  })

  await check('a second dump of unchanged data is byte-identical', () => {
    assert.equal(second.manifest.collections[0]!.sha256, first.manifest.collections[0]!.sha256)
    assert.equal(second.manifest.collections[1]!.sha256, first.manifest.collections[1]!.sha256)
  })

  await check('verifyBackup accepts an untouched dump', async () => {
    const manifest = await verifyBackup(first.directory)
    assert.equal(manifest.database, SOURCE_DB)
  })

  await check('restore into another database reproduces the bytes', async () => {
    const report = await restoreDatabase(target, first.directory, { drop: true })
    assert.equal(report.collections.length, 2)
    assert.equal(await target.db!.collection('catalog_items').countDocuments(), 2)
    assert.equal((await hashCollection(target, 'catalog_items')).sha256, originalItems.sha256)
    assert.equal((await hashCollection(target, 'media')).sha256, originalMedia.sha256)
  })

  await check('restore recreates the unique index', async () => {
    const indexes = await target.db!.collection('catalog_items').indexes()
    const key = indexes.find(index => index.name === 'key_1')
    assert.ok(key, 'key_1 is missing')
    assert.equal(key!.unique, true)
  })

  await check('types survive the round trip', async () => {
    const doc = await target.db!.collection('media').findOne({})
    const reference = doc!.itemId as { toHexString?: () => string }
    assert.equal(typeof reference.toHexString, 'function', 'itemId came back as a plain value, not an ObjectId')
    assert.equal(reference.toHexString!(), itemIdHex)
    assert.ok(doc!.createdAt instanceof Date, 'createdAt came back as a string')
    // The driver returns a BSON Binary; its bytes are what must match.
    const blob = doc!.blob as { buffer?: Uint8Array } | Buffer
    const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer ?? new Uint8Array())
    assert.equal(bytes.toString('utf8'), 'binary survives the codec')
  })

  await check('restoring twice does not duplicate rows', async () => {
    await restoreDatabase(target, first.directory)
    assert.equal(await target.db!.collection('catalog_items').countDocuments(), 2)
    assert.equal(await target.db!.collection('media').countDocuments(), 1)
  })

  await check('an edited dump is refused before anything is inserted', async () => {
    const tampered = `${directoryRoot}-tampered`
    await dumpDatabase(source, tampered)
    const file = join(tampered, SOURCE_DB, 'catalog_items.jsonl')
    const text = await readFile(file, 'utf8')
    await writeFile(file, text.replace('"price":250000', '"price":1'), 'utf8')

    await assert.rejects(() => verifyBackup(join(tampered, SOURCE_DB)), BackupIntegrityError)
    await target.db!.collection('catalog_items').deleteMany({})
    await assert.rejects(() => restoreDatabase(target, join(tampered, SOURCE_DB)), BackupIntegrityError)
    assert.equal(
      await target.db!.collection('catalog_items').countDocuments(),
      0,
      'nothing may be inserted from a bad file',
    )
    await rm(tampered, { recursive: true, force: true })
  })

  await check('a dropped collection leaves the dump empty, not stale', async () => {
    await sourceDb.collection('media').drop()
    const afterDrop = await dumpDatabase(source, directoryRoot)
    assert.equal(afterDrop.manifest.collections.length, 1, 'the dropped collection is gone from the manifest')
    const staleFile = await readFile(join(afterDrop.directory, 'media.jsonl'), 'utf8')
    assert.equal(staleFile, '', 'its old file was cleared, so a restore cannot resurrect it')
  })

  console.log(`\n${checks}/${checks + failed} checks passed.`)
} finally {
  await dropTestDatabase(source)
  await dropTestDatabase(target)
  await closeDatabaseConnections()
  await rm(directoryRoot, { recursive: true, force: true })
  await rm(`${directoryRoot}-tampered`, { recursive: true, force: true })
}
