import assert from 'node:assert/strict'
import {
  TaskServiceError,
  createTask,
  getTask,
  listTasks,
  updateTask,
  softDeleteTask,
  restoreTask,
} from '../../tm-cms/server/services/taskService.js'
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
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }
const ASSIGNEE = 'hub-subject-task'

console.log('Tasks — CRUD, status, soft delete/restore, revision\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_tasks' }

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
    const { Task, Audit } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const task = await createTask(Task, SITE, {
      title: 'Prepare report',
      description: 'Monthly numbers',
      assigneeId: ASSIGNEE,
      priority: 'high',
    }, meta)

    await check('create stores a todo task', async () => {
      assert.equal(task.status, 'todo')
      assert.equal(task.priority, 'high')
      assert.equal(task.assigneeId, ASSIGNEE)
      assert.equal(task.revision, 1)
    })

    await check('get returns the task', async () => {
      const fetched = await getTask(Task, SITE, task.id)
      assert.equal(fetched.title, 'Prepare report')
    })

    await check('update changes fields with revision bump', async () => {
      const updated = await updateTask(Task, SITE, task.id, {
        revision: task.revision,
        title: 'Prepare Q4 report',
        status: 'in_progress',
      }, meta)
      assert.equal(updated.title, 'Prepare Q4 report')
      assert.equal(updated.status, 'in_progress')
      assert.equal(updated.revision, 2)
    })

    await check('stale revision is rejected', async () => {
      await assert.rejects(
        () => updateTask(Task, SITE, task.id, { revision: 1, title: 'X' }, meta),
        (error: unknown) => error instanceof TaskServiceError && error.code === 'TASK_REVISION_CONFLICT',
      )
    })

    await check('complete sets completedAt', async () => {
      const current = await getTask(Task, SITE, task.id)
      const done = await updateTask(Task, SITE, task.id, { revision: current.revision, status: 'done' }, meta)
      assert.equal(done.status, 'done')
      assert.ok(done.completedAt)
    })

    await check('soft delete and restore', async () => {
      const current = await getTask(Task, SITE, task.id)
      const deleted = await softDeleteTask(Task, SITE, task.id, current.revision, meta)
      assert.equal(deleted.isDeleted, true)
      await assert.rejects(() => getTask(Task, SITE, task.id), (e: unknown) => e instanceof TaskServiceError && (e as { code: string }).code === 'TASK_NOT_FOUND')
      const restored = await restoreTask(Task, SITE, task.id, deleted.revision, meta)
      assert.equal(restored.isDeleted, false)
    })

    await check('list filters by assignee and status', async () => {
      const page = await listTasks(Task, SITE, { assigneeId: ASSIGNEE, status: 'done' })
      assert.ok(page.data.length >= 1)
    })

    await check('tasks are site-scoped', async () => {
      const page = await listTasks(Task, OTHER_SITE)
      assert.equal(page.data.length, 0)
    })

    await check('payload validation rejects empty title', async () => {
      await assert.rejects(
        () => createTask(Task, SITE, { title: '', assigneeId: ASSIGNEE }, meta),
        (error: unknown) => error instanceof TaskServiceError && error.code === 'TASK_PAYLOAD_INVALID',
      )
    })

    await check('every mutation records an audit entry', async () => {
      const entries = await Audit.find({ siteId: SITE, resourceType: 'task' }).lean<{ action: string }[]>()
      assert.ok(entries.length >= 4)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Task checks: ${checks} passed, ${notRun} not run\n`)