import assert from 'node:assert/strict'
import { createCatalogCategory, importCatalogItems } from '../../tm-cms/server/services/catalogService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

let checks = 0
let notRun = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Catalog import — bounded upsert with per-row results\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_catalog_import' }

async function run() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await connection.db!.dropDatabase()
    const models = await prepareDatabase(connection)
    const { CatalogItem, CatalogCategory, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    await createCatalogCategory(CatalogCategory, SITE, {
      key: 'shoes',
      title: { vi: 'Giày' },
      slug: { vi: 'giay' },
    }, meta)

    const first = await importCatalogItems(CatalogItem, CatalogCategory, SITE, [
      { key: 'shoe-a', title: { vi: 'Giày A' }, slug: { vi: 'giay-a' }, basePrice: 100000, categories: ['shoes'] },
      { key: 'shoe-b', title: { vi: 'Giày B' }, slug: { vi: 'giay-b' }, basePrice: 120000 },
      { key: 'bad-row', title: {}, slug: { vi: 'bad' } },
    ], meta)

    await check('valid rows create and invalid rows are reported', async () => {
      assert.equal(first.total, 3)
      assert.equal(first.created, 2)
      assert.equal(first.failed, 1)
      assert.equal(first.results[2]!.status, 'failed')
    })

    const second = await importCatalogItems(CatalogItem, CatalogCategory, SITE, [
      { key: 'shoe-a', title: { vi: 'Giày A v2' }, slug: { vi: 'giay-a' }, basePrice: 150000 },
      { key: 'shoe-c', title: { vi: 'Giày C' }, slug: { vi: 'giay-c' }, basePrice: 90000, categories: ['missing'] },
    ], meta)

    await check('existing key updates instead of duplicating', async () => {
      assert.equal(second.created, 0)
      assert.equal(second.updated, 1)
      assert.equal(second.failed, 1)
      assert.equal(second.results[1]!.code, 'CATALOG_CATEGORY_NOT_FOUND')
    })

    await check('an empty import is rejected', async () => {
      await assert.rejects(
        () => importCatalogItems(CatalogItem, CatalogCategory, SITE, [], meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'CATALOG_IMPORT_EMPTY',
      )
    })

    await check('import is bounded', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({ key: `k-${i}`, title: { vi: `T${i}` }, slug: { vi: `s-${i}` } }))
      await assert.rejects(
        () => importCatalogItems(CatalogItem, CatalogCategory, SITE, rows, meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'CATALOG_IMPORT_TOO_LARGE',
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Catalog import checks: ${checks} passed, ${notRun} not run\n`)
