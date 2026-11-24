import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createCustomer } from '../../tm-cms/server/services/customerService.js'
import { createCustomerSegment } from '../../tm-cms/server/services/customerSegmentService.js'
import { createOrder } from '../../tm-cms/server/services/orderService.js'
import { resolveCustomerBySubject, listOrdersForSubject, getOrderForSubject, CustomerPortalServiceError } from '../../tm-cms/server/services/customerPortalService.js'
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

console.log('Customer portal — subject-scoped orders\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_customer_portal')

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
    const { Customer, CustomerSegment, Order, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }
    const segment = await createCustomerSegment(CustomerSegment, SITE, { code: 'VIP', title: 'VIP' }, meta)
    const customer = await createCustomer(Customer, CustomerSegment, SITE, { code: 'CUS-P', subjectId: 'hub_portal', customerSegmentId: segment.id }, meta)
    const order = await createOrder(Order, Customer, SITE, { customerId: customer.id, status: 'processing', items: [{ itemName: 'A', price: 100000, quantity: 1 }] }, meta)

    await check('resolve customer by subject', async () => {
      const resolved = await resolveCustomerBySubject(Customer, SITE, 'hub_portal')
      assert.equal(resolved.id, customer.id)
    })

    await check('list orders for subject returns own order', async () => {
      const result = await listOrdersForSubject(Order, Customer, SITE, 'hub_portal')
      assert.equal(result.data.length, 1)
      assert.equal(result.data[0]!.id, order.id)
    })

    await check('get order for subject enforces ownership', async () => {
      const fetched = await getOrderForSubject(Order, Customer, SITE, 'hub_portal', order.id)
      assert.equal(fetched.id, order.id)
      await assert.rejects(() => getOrderForSubject(Order, Customer, SITE, 'hub_other', order.id), (e: unknown) => e instanceof CustomerPortalServiceError)
    })

    await check('unknown subject is rejected', async () => {
      await assert.rejects(() => resolveCustomerBySubject(Customer, SITE, 'nope'), (e: unknown) => e instanceof CustomerPortalServiceError && e.code === 'PORTAL_CUSTOMER_NOT_FOUND')
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Customer portal checks: ${checks} passed, ${notRun} not run\n`)