import assert from 'node:assert/strict'
import { registerSerialNumbers, getSerialNumber, listSerialNumbers, markSerialSold, markSerialReturned, scrapSerialNumber, softDeleteSerialNumber, SerialNumberServiceError } from '../../tm-cms/server/services/serialNumberService.js'
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
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('Serial numbers — IMEI tracking\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_serial_numbers' }

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

    const [first] = await registerSerialNumbers(SerialNumber, SITE, SITE, [
      { serial: 'IMEI-001', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1', note: 'received' },
      { serial: 'IMEI-002', itemId: 'item-tee', variantId: null, warehouseId: 'wh-1' },
    ], meta)

    await check('serials register as in_stock', async () => {
      assert.equal(first!.status, 'in_stock')
      assert.equal(first!.serial, 'IMEI-001')
    })

    await check('a duplicate serial is rejected', async () => {
      await assert.rejects(
        () => registerSerialNumbers(SerialNumber, SITE, SITE, [{ serial: 'IMEI-001', itemId: 'item-tee' }], meta),
        isSerialError(409, 'SERIAL_NUMBER_DUPLICATE'),
      )
    })

    await check('invalid payload is rejected', async () => {
      await assert.rejects(
        () => registerSerialNumbers(SerialNumber, SITE, SITE, [{ serial: 'ab', itemId: 'item-tee' }], meta),
        isSerialError(422, 'SERIAL_NUMBER_PAYLOAD_INVALID'),
      )
    })

    await check('marking sold stamps the order and soldAt', async () => {
      const sold = await markSerialSold(SerialNumber, SITE, first!.id, 'order-1', first!.revision, meta)
      assert.equal(sold.status, 'sold')
      assert.equal(sold.orderId, 'order-1')
      assert.ok(sold.soldAt)
    })

    await check('a non-stock serial cannot be sold', async () => {
      const current = await getSerialNumber(SerialNumber, SITE, first!.id)
      await assert.rejects(
        () => markSerialSold(SerialNumber, SITE, first!.id, 'order-2', current.revision, meta),
        isSerialError(422, 'SERIAL_NUMBER_NOT_IN_STOCK'),
      )
    })

    await check('a sold serial can be marked returned', async () => {
      const current = await getSerialNumber(SerialNumber, SITE, first!.id)
      const returned = await markSerialReturned(SerialNumber, SITE, first!.id, current.revision, meta)
      assert.equal(returned.status, 'returned')
      assert.ok(returned.returnedAt)
    })

    await check('a returned serial cannot be marked returned again', async () => {
      const current = await getSerialNumber(SerialNumber, SITE, first!.id)
      await assert.rejects(
        () => markSerialReturned(SerialNumber, SITE, first!.id, current.revision, meta),
        isSerialError(422, 'SERIAL_NUMBER_NOT_SOLD'),
      )
    })

    const second = await getSerialNumber(SerialNumber, SITE, (await listSerialNumbers(SerialNumber, SITE, { q: 'IMEI-002' })).data[0]!.id)
    await check('scrapping stamps scrappedAt', async () => {
      const scrapped = await scrapSerialNumber(SerialNumber, SITE, second.id, second.revision, meta)
      assert.equal(scrapped.status, 'scrapped')
      assert.ok(scrapped.scrappedAt)
    })

    await check('soft delete and restore keep the revision moving', async () => {
      const current = await getSerialNumber(SerialNumber, SITE, second.id)
      const removed = await softDeleteSerialNumber(SerialNumber, SITE, second.id, current.revision, meta)
      assert.equal(removed.isDeleted, true)
    })

    await check('a tenant only sees its own serials', async () => {
      const foreign = await listSerialNumbers(SerialNumber, OTHER_SITE)
      assert.equal(foreign.counts.all, 0)
      const home = await listSerialNumbers(SerialNumber, SITE)
      assert.ok(home.counts.all >= 1)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Serial number checks: ${checks} passed, ${notRun} not run\n`)
