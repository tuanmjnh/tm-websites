import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import {
  JobServiceError,
  enqueueJob,
  claimJob,
  completeJob,
  failJob,
  cancelJob,
  listJobs,
} from '../../tm-cms/server/services/jobService.js'
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
const OTHER_SITE = 'bagpost'

console.log('Background jobs — claim/complete/fail/retry/cancel\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_jobs')

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
    const { Job } = models

    const job = await enqueueJob(Job, SITE, { type: 'export', payload: { foo: 1 }, maxAttempts: 2 })

    await check('enqueue creates a queued job', async () => {
      assert.equal(job.status, 'queued')
      assert.equal(job.type, 'export')
      assert.equal(job.attempts, 0)
    })

    await check('claim moves it to running and bumps attempts', async () => {
      const claimed = await claimJob(Job, SITE, 'worker-1')
      assert.ok(claimed)
      assert.equal(claimed!.status, 'running')
      assert.equal(claimed!.attempts, 1)
      assert.equal(claimed!.lockedBy, 'worker-1')
    })

    await check('a second claim returns null while running', async () => {
      const second = await claimJob(Job, SITE, 'worker-2')
      assert.equal(second, null)
    })

    await check('complete stores the result', async () => {
      const done = await completeJob(Job, SITE, job.id, { ok: true }, 'worker-1')
      assert.equal(done.status, 'done')
      assert.deepEqual(done.result, { ok: true })
    })

    await check('failing a job re-queues it for retry', async () => {
      const j2 = await enqueueJob(Job, SITE, { type: 'export', maxAttempts: 2 })
      await claimJob(Job, SITE, 'worker-1')
      const failed = await failJob(Job, SITE, j2.id, 'boom', 'worker-1', 0)
      assert.equal(failed.status, 'queued')
      assert.equal(failed.error, 'boom')
    })

    await check('exhausting attempts marks the job failed', async () => {
      // claim again (second attempt)
      const claimed = await claimJob(Job, SITE, 'worker-1')
      assert.ok(claimed)
      const failed = await failJob(Job, SITE, claimed!.id, 'boom2', 'worker-1', 0)
      assert.equal(failed.status, 'failed')
    })

    await check('cancel refuses a finished job', async () => {
      const j3 = await enqueueJob(Job, SITE, { type: 'export' })
      await claimJob(Job, SITE, 'worker-1')
      await completeJob(Job, SITE, j3.id, {}, 'worker-1')
      await assert.rejects(
        () => cancelJob(Job, SITE, j3.id),
        (error: unknown) => error instanceof JobServiceError && error.code === 'JOB_TERMINAL',
      )
    })

    await check('cancel removes a queued job', async () => {
      const j4 = await enqueueJob(Job, SITE, { type: 'export' })
      const cancelled = await cancelJob(Job, SITE, j4.id)
      assert.equal(cancelled.status, 'cancelled')
    })

    await check('jobs are site-scoped', async () => {
      const page = await listJobs(Job, OTHER_SITE)
      assert.equal(page.data.length, 0)
    })

    await check('list filters by status', async () => {
      const page = await listJobs(Job, SITE, { status: 'done' })
      assert.ok(page.data.length >= 1)
      assert.ok(page.data.every(j => j.status === 'done'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Job checks: ${checks} passed, ${notRun} not run\n`)