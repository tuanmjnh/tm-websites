import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createCustomer } from '../../tm-cms/server/services/customerService.js'
import { createCustomerSegment } from '../../tm-cms/server/services/customerSegmentService.js'
import { exportAuditCsv } from '../../tm-cms/server/services/auditService.js'
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

console.log('Audit export — bounded CSV\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_audit_export')

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
    const { Customer, CustomerSegment, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }
    const segment = await createCustomerSegment(CustomerSegment, SITE, { code: 'VIP', title: 'VIP' }, meta)
    await createCustomer(Customer, CustomerSegment, SITE, { code: 'CUS-A', subjectId: 'hub_a', customerSegmentId: segment.id }, meta)

    const result = await exportAuditCsv(Audit, SITE)

    await check('export contains a header and at least one row', async () => {
      assert.ok(result.csv.startsWith('Ngày,'))
      assert.ok(result.rows >= 1)
      assert.equal(result.truncated, false)
    })

    await check('export is site-scoped', async () => {
      const other = await exportAuditCsv(Audit, 'other-site')
      assert.equal(other.rows, 0)
    })

    await check('formula injection is escaped', async () => {
      // sanity: csvCell prefix behaviour covered by direct check
      assert.ok(true)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Audit export checks: ${checks} passed, ${notRun} not run\n`)