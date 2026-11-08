import assert from 'node:assert/strict'
import { createContent, getContent, updateContent } from '../../tm-cms/server/services/contentService.js'
import { runBulkContentCommand } from '../../tm-cms/server/services/contentBulk.js'
import { listContentAudit } from '../../tm-cms/server/services/contentAudit.js'
import { listContentRevisions } from '../../tm-cms/server/services/contentRevisions.js'
import { AdminContentBulkRequestSchema } from '../../tm-shared/packages/flow-contracts/src/content-admin.js'
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
const NOW = new Date('2026-11-07T09:00:00.000Z')

function pageDraft(key: string, slug: string) {
  return {
    type: 'page',
    key,
    locales: [{ locale: 'vi', title: `Tiêu đề ${slug}`, slug, body: `<p>${slug}</p>` }],
  }
}

console.log('Content — bulk publish/archive/delete (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_bulk_service' }

async function integration() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    console.log('      Start a local MongoDB and re-run `pnpm test:bulk`.')
    return
  }

  try {
    await connection.db!.dropDatabase()
    const { Content, Audit, Revision } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR }, revision: { model: Revision, actor: ACTOR } }

    const first = await createContent(Content, SITE, pageDraft('pages/mot', 'mot'), meta)
    const second = await createContent(Content, SITE, pageDraft('pages/hai', 'hai'), meta)
    const third = await createContent(Content, SITE, pageDraft('pages/ba', 'ba'), meta)

    await check('publish applies to every requested record and reports each row', async () => {
      const result = await runBulkContentCommand(Content, SITE, {
        action: 'publish',
        items: [
          { id: first.id, revision: first.revision },
          { id: second.id, revision: second.revision },
        ],
      }, NOW, meta)

      assert.equal(result.action, 'publish')
      assert.equal(result.succeeded, 2)
      assert.equal(result.failed, 0)
      assert.equal(result.results.length, 2)
      for (const row of result.results) {
        assert.equal(row.ok, true)
        assert.equal(row.status, 'published')
        assert.equal(row.revision, 2)
        assert.equal(row.error, null)
      }
      const stored = await getContent(Content, SITE, first.id)
      assert.equal(stored.status, 'published')
    })

    await check('a stale revision fails only its own row', async () => {
      const result = await runBulkContentCommand(Content, SITE, {
        action: 'archive',
        items: [
          { id: first.id, revision: 1 },
          { id: third.id, revision: third.revision },
        ],
      }, NOW, meta)

      assert.equal(result.succeeded, 1)
      assert.equal(result.failed, 1)
      const [stale, fresh] = result.results
      assert.equal(stale!.ok, false)
      assert.equal(stale!.error?.code, 'CONTENT_REVISION_CONFLICT')
      assert.equal(fresh!.ok, true)
      assert.equal(fresh!.status, 'archived')
      // The row that succeeded stays applied; nothing was rolled back.
      assert.equal((await getContent(Content, SITE, third.id)).status, 'archived')
      assert.equal((await getContent(Content, SITE, first.id)).status, 'published')
    })

    await check('an invalid transition is a row error, not a request failure', async () => {
      // `first` is published; publishing it again is not a legal transition.
      const result = await runBulkContentCommand(Content, SITE, {
        action: 'publish',
        items: [{ id: first.id, revision: 2 }],
      }, NOW, meta)

      assert.equal(result.failed, 1)
      assert.equal(result.results[0]!.error?.code, 'CONTENT_TRANSITION_INVALID')
    })

    await check('an unknown or foreign id is a per-row 404', async () => {
      const unknown = await runBulkContentCommand(Content, SITE, {
        action: 'delete',
        items: [{ id: '6aec00000000000000000000', revision: 1 }],
      }, NOW, meta)
      assert.equal(unknown.results[0]!.error?.code, 'CONTENT_NOT_FOUND')

      const foreign = await runBulkContentCommand(Content, OTHER_SITE, {
        action: 'delete',
        items: [{ id: second.id, revision: 2 }],
      }, NOW, meta)
      assert.equal(foreign.results[0]!.error?.code, 'CONTENT_NOT_FOUND')
      assert.equal((await getContent(Content, SITE, second.id)).status, 'published')
    })

    await check('the same id twice is reported once as a duplicate', async () => {
      const result = await runBulkContentCommand(Content, SITE, {
        action: 'delete',
        items: [
          { id: second.id, revision: 2 },
          { id: second.id, revision: 2 },
        ],
      }, NOW, meta)

      assert.equal(result.succeeded, 1)
      assert.equal(result.failed, 1)
      assert.equal(result.results[0]!.ok, true)
      assert.equal(result.results[0]!.status, 'deleted')
      assert.equal(result.results[1]!.error?.code, 'CONTENT_BULK_DUPLICATE')
    })

    await check('each bulk row writes its own audit entry and revision snapshot', async () => {
      const trail = await listContentAudit(Audit, SITE, second.id, 20)
      const actions = trail.map(entry => entry.action)
      assert.deepEqual(actions.slice(0, 2), ['delete', 'publish'])

      const snapshots = await listContentRevisions(Revision, SITE, second.id, 20)
      assert.deepEqual(snapshots.map(entry => entry.revision), [3, 2, 1])
      assert.equal(snapshots[0]!.status, 'deleted')
    })

    await check('a retried batch only re-attempts the rows that can still change', async () => {
      const before = await getContent(Content, SITE, second.id)
      const retry = await runBulkContentCommand(Content, SITE, {
        action: 'delete',
        items: [{ id: second.id, revision: before.revision }],
      }, NOW, meta)
      assert.equal(retry.failed, 1)
      assert.equal(retry.results[0]!.error?.code, 'CONTENT_TRANSITION_INVALID')
      const after = await getContent(Content, SITE, second.id)
      assert.equal(after.revision, before.revision)
    })

    await check('bulk editing still bumps the revision used by later writes', async () => {
      const archived = await getContent(Content, SITE, third.id)
      const updated = await updateContent(Content, SITE, third.id, {
        ...pageDraft('pages/ba', 'ba'),
        tags: ['sau-bulk'],
        revision: archived.revision,
      }, meta)
      assert.equal(updated.revision, archived.revision + 1)
      assert.deepEqual(updated.tags, ['sau-bulk'])
    })

    await check('the batch cap and allowed actions are enforced by the shared schema', async () => {
      // The service trusts its caller; the route validates the request contract.
      const tooMany = Array.from({ length: 51 }, (_, index) => ({ id: `id-${index}`, revision: 1 }))
      assert.equal(AdminContentBulkRequestSchema.safeParse({ action: 'publish', items: tooMany }).success, false)
      assert.equal(AdminContentBulkRequestSchema.safeParse({ action: 'publish', items: [] }).success, false)
      assert.equal(AdminContentBulkRequestSchema.safeParse({ action: 'schedule', items: [{ id: 'a', revision: 1 }] }).success, false)
      assert.equal(AdminContentBulkRequestSchema.safeParse({ action: 'delete', items: [{ id: 'a', revision: 0 }] }).success, false)
      assert.equal(AdminContentBulkRequestSchema.safeParse({ action: 'delete', items: [{ id: 'a', revision: 1 }] }).success, true)
    })
  } finally {
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
