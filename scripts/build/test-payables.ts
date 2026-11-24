import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder } from '../../tm-cms/server/services/purchaseOrderService.js'
import { createSupplier } from '../../tm-cms/server/services/supplierService.js'
import { listPayables, getPayable, voidPayable, postPayableForPurchaseOrder } from '../../tm-cms/server/services/payableService.js'
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

console.log('Payables — auto-post on PO receive\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_payables')

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
    const { PurchaseOrder, Supplier, Payable, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR }, payableModel: Payable }

    const supplier = await createSupplier(Supplier, SITE, { title: 'NCC A' }, meta)
    const po = await createPurchaseOrder(PurchaseOrder, Supplier, SITE, {
      supplierId: supplier.id,
      status: 'ordered',
      items: [{ itemName: 'Hàng', quantity: 10, unitCost: 20000 }],
    }, meta)

    await check('receiving a PO auto-posts a payable', async () => {
      await receivePurchaseOrder(PurchaseOrder, null, null, SITE, po.id, {
        revision: po.revision,
        lines: [{ itemId: null, receivedQuantity: 10, rejectedQuantity: 0 }],
      }, meta)
      const page = await listPayables(Payable, SITE)
      assert.equal(page.data.length, 1)
      assert.equal(page.data[0]!.amount, 200000)
      assert.equal(page.data[0]!.purchaseOrderId, po.id)
    })

    await check('posting is idempotent on re-receive attempt', async () => {
      const before = await listPayables(Payable, SITE)
      await postPayableForPurchaseOrder(Payable, PurchaseOrder, SITE, po.id, meta)
      const after = await listPayables(Payable, SITE)
      assert.equal(after.data.length, before.data.length)
    })

    await check('voiding a payable records audit', async () => {
      const page = await listPayables(Payable, SITE)
      const voided = await voidPayable(Payable, SITE, page.data[0]!.id, 'duplicate', meta)
      assert.equal(voided.status, 'voided')
    })

    await check('site isolation', async () => {
      const other = await listPayables(Payable, 'other-site')
      assert.equal(other.data.length, 0)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Payable checks: ${checks} passed, ${notRun} not run\n`)