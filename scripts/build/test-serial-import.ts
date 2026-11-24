import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { importSerialNumbers } from '../../tm-cms/server/services/serialNumberService.js'
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

console.log('Serial number import — bounded registration with per-row results\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_serial_import')

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
    await dropTestDatabase(connection)
    const models = await prepareDatabase(connection)
    const { SerialNumber, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const first = await importSerialNumbers(SerialNumber, SITE, [
      { serial: 'SN-001', itemId: 'item-1', warehouseId: 'wh-1' },
      { serial: 'SN-002', itemId: 'item-1', warehouseId: 'wh-1' },
      { serial: 'AB', itemId: 'item-1' },
    ], meta)

    await check('valid rows create and invalid rows are reported', async () => {
      assert.equal(first.total, 3)
      assert.equal(first.created, 2)
      assert.equal(first.failed, 1)
      assert.equal(first.results[2]!.status, 'failed')
    })

    const second = await importSerialNumbers(SerialNumber, SITE, [
      { serial: 'SN-001', itemId: 'item-1' },
      { serial: 'SN-003', itemId: 'item-2', warehouseId: 'wh-2' },
    ], meta)

    await check('duplicate serials fail and new ones create', async () => {
      assert.equal(second.created, 1)
      assert.equal(second.failed, 1)
      assert.equal(second.results[0]!.code, 'SERIAL_NUMBER_DUPLICATE')
    })

    await check('empty import is rejected', async () => {
      await assert.rejects(
        () => importSerialNumbers(SerialNumber, SITE, [], meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'SERIAL_NUMBER_IMPORT_EMPTY',
      )
    })

    await check('import is bounded', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({ serial: `SN-${i}`, itemId: 'item-1' }))
      await assert.rejects(
        () => importSerialNumbers(SerialNumber, SITE, rows, meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'SERIAL_NUMBER_IMPORT_TOO_LARGE',
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Serial import checks: ${checks} passed, ${notRun} not run\n`)