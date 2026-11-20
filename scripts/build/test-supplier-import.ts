import assert from 'node:assert/strict'
import { importSuppliers } from '../../tm-cms/server/services/supplierService.js'
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

console.log('Supplier import — bounded upsert with per-row results\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_supplier_import' }

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
    const { Supplier, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const first = await importSuppliers(Supplier, SITE, [
      { code: 'SUP-A', title: 'Supplier A', email: 'a@example.com' },
      { code: 'SUP-B', title: 'Supplier B' },
      { code: 'SUP-BAD', title: '' },
    ], meta)

    await check('valid rows create and invalid rows are reported', async () => {
      assert.equal(first.total, 3)
      assert.equal(first.created, 2)
      assert.equal(first.failed, 1)
      assert.equal(first.results[2]!.status, 'failed')
    })

    const second = await importSuppliers(Supplier, SITE, [
      { code: 'SUP-A', title: 'Supplier A v2', rating: 4 },
      { code: 'SUP-C', title: 'Supplier C' },
    ], meta)

    await check('existing code updates instead of duplicating', async () => {
      assert.equal(second.created, 1)
      assert.equal(second.updated, 1)
      assert.equal(second.failed, 0)
    })

    await check('empty import is rejected', async () => {
      await assert.rejects(
        () => importSuppliers(Supplier, SITE, [], meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'SUPPLIER_IMPORT_EMPTY',
      )
    })

    await check('import is bounded', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({ code: `SUP-${i}`, title: `Supplier ${i}` }))
      await assert.rejects(
        () => importSuppliers(Supplier, SITE, rows, meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'SUPPLIER_IMPORT_TOO_LARGE',
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Supplier import checks: ${checks} passed, ${notRun} not run\n`)
