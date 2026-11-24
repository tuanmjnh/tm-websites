import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import { createCustomerSegment } from '../../tm-cms/server/services/customerSegmentService.js'
import { importCustomers } from '../../tm-cms/server/services/customerService.js'
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

console.log('Customer import — bounded upsert with per-row results\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_customer_import')

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

    const first = await importCustomers(Customer, CustomerSegment, SITE, [
      { code: 'CUS-A', subjectId: 'hub_subject_a', email: 'a@example.com', customerSegmentId: segment.id },
      { code: 'CUS-B', subjectId: 'hub_subject_b', fullName: 'Customer B' },
      { code: 'CUS-BAD', subjectId: '', fullName: 'Bad' },
    ], meta)

    await check('valid rows create and invalid rows are reported', async () => {
      assert.equal(first.total, 3)
      assert.equal(first.created, 2)
      assert.equal(first.failed, 1)
      assert.equal(first.results[2]!.status, 'failed')
    })

    const second = await importCustomers(Customer, CustomerSegment, SITE, [
      { code: 'CUS-A', subjectId: 'hub_subject_a', email: 'a2@example.com' },
      { code: 'CUS-C', subjectId: 'hub_subject_c', customerSegmentId: '000000000000000000000000' },
    ], meta)

    await check('existing code updates and invalid segment fails', async () => {
      assert.equal(second.created, 0)
      assert.equal(second.updated, 1)
      assert.equal(second.failed, 1)
      assert.equal(second.results[1]!.codeError, 'CUSTOMER_SEGMENT_NOT_FOUND')
    })

    await check('empty import is rejected', async () => {
      await assert.rejects(
        () => importCustomers(Customer, CustomerSegment, SITE, [], meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'CUSTOMER_IMPORT_EMPTY',
      )
    })

    await check('import is bounded', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => ({ code: `CUS-${i}`, subjectId: `hub_${i}` }))
      await assert.rejects(
        () => importCustomers(Customer, CustomerSegment, SITE, rows, meta),
        (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'CUSTOMER_IMPORT_TOO_LARGE',
      )
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Customer import checks: ${checks} passed, ${notRun} not run\n`)
