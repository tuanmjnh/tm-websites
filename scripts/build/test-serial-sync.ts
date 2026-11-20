import assert from 'node:assert/strict'
import { registerSerialNumbers, syncSerialsForTransaction, SerialNumberServiceError } from '../../tm-cms/server/services/serialNumberService.js'
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

function isSerialError(status: number, code: string) {
  return (error: unknown) => error instanceof SerialNumberServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Serial sync — stock movement integration (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_serial_sync' }

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
    const { SerialNumber, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    await registerSerialNumbers(SerialNumber, SITE, SITE, [
      { serial: 'SYNC-001', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
      { serial: 'SYNC-002', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
      { serial: 'SYNC-003', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
    ], meta)

    await check('export marks serials as sold', async () => {
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'export', ['SYNC-001'], { warehouseId: 'wh-1', orderId: 'order-1' }, meta)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.status, 'sold')
      assert.equal(result[0]!.orderId, 'order-1')
    })

    await check('return_in marks sold serials as returned', async () => {
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'return_in', ['SYNC-001'], { warehouseId: 'wh-1' }, meta)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.status, 'returned')
    })

    await check('transfer_out moves serials to target warehouse', async () => {
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'transfer_out', ['SYNC-002'], { warehouseId: 'wh-1', targetWarehouseId: 'wh-2' }, meta)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.warehouseId, 'wh-2')
    })

    await check('adjustment_dec scraps serials', async () => {
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'adjustment_dec', ['SYNC-003'], { warehouseId: 'wh-1' }, meta)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.status, 'scrapped')
    })

    await check('missing serial is rejected', async () => {
      await assert.rejects(
        () => syncSerialsForTransaction(SerialNumber, SITE, 'export', ['NO-SUCH-SERIAL'], { warehouseId: 'wh-1', orderId: 'order-2' }, meta),
        isSerialError(404, 'SERIAL_NUMBER_NOT_FOUND'),
      )
    })

    await check('export on non-stock serial is rejected', async () => {
      // SYNC-001 is now returned; exporting again should fail
      await assert.rejects(
        () => syncSerialsForTransaction(SerialNumber, SITE, 'export', ['SYNC-001'], { warehouseId: 'wh-1', orderId: 'order-3' }, meta),
        isSerialError(422, 'SERIAL_NUMBER_NOT_IN_STOCK'),
      )
    })

    await check('empty serial list is a no-op', async () => {
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'export', [], { warehouseId: 'wh-1' }, meta)
      assert.deepEqual(result, [])
    })

    await check('transfer without target warehouse is rejected', async () => {
      await registerSerialNumbers(SerialNumber, SITE, SITE, [
        { serial: 'SYNC-004', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
      ], meta)
      await assert.rejects(
        () => syncSerialsForTransaction(SerialNumber, SITE, 'transfer_out', ['SYNC-004'], { warehouseId: 'wh-1' }, meta),
        isSerialError(422, 'SERIAL_NUMBER_WAREHOUSE_REQUIRED'),
      )
    })

    await check('import type is a no-op validation', async () => {
      await registerSerialNumbers(SerialNumber, SITE, SITE, [
        { serial: 'SYNC-005', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
      ], meta)
      const result = await syncSerialsForTransaction(SerialNumber, SITE, 'import', ['SYNC-005'], { warehouseId: 'wh-1' }, meta)
      assert.equal(result.length, 1)
      assert.equal(result[0]!.status, 'in_stock')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Serial sync checks: ${checks} passed, ${notRun} not run\n`)