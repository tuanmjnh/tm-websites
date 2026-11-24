import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createCustomer, findDuplicateCustomers } from '../../tm-cms/server/services/customerService.js'
import { createCustomerSegment } from '../../tm-cms/server/services/customerSegmentService.js'
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

console.log('Customer dedup — read-only duplicate report\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_customer_dedup')

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
    const { Customer, CustomerSegment } = models
    const meta = { audit: { model: models.Audit, actor: ACTOR } }
    const segment = await createCustomerSegment(CustomerSegment, SITE, { code: 'VIP', title: 'VIP' }, meta)

    await createCustomer(Customer, CustomerSegment, SITE, { code: 'CUS-A', subjectId: 'hub_a', email: 'a@example.com', phone: '0901', customerSegmentId: segment.id }, meta)
    await createCustomer(Customer, CustomerSegment, SITE, { code: 'CUS-B', subjectId: 'hub_b', email: 'a@example.com', phone: '0902' }, meta)
    await createCustomer(Customer, CustomerSegment, SITE, { code: 'CUS-C', subjectId: 'hub_c', email: 'c@example.com', phone: '0901' }, meta)

    const groups = await findDuplicateCustomers(Customer, SITE)

    await check('shared email produces a duplicate group', async () => {
      const emailGroup = groups.find(g => g.field === 'email')
      assert.ok(emailGroup)
      assert.equal(emailGroup!.customers.length, 2)
    })

    await check('shared phone produces a duplicate group', async () => {
      const phoneGroup = groups.find(g => g.field === 'phone')
      assert.ok(phoneGroup)
      assert.equal(phoneGroup!.customers.length, 2)
    })

    await check('no duplicates means empty report', async () => {
      const other = await findDuplicateCustomers(Customer, 'other-site')
      assert.equal(other.length, 0)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Customer dedup checks: ${checks} passed, ${notRun} not run\n`)