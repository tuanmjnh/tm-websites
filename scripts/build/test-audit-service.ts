import assert from 'node:assert/strict'
import { AuditQueryError, listAuditEntries } from '../../tm-cms/server/services/auditService.js'
import { listRecordAudit, recordContentAudit } from '../../tm-cms/server/services/contentAudit.js'
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
const ADMIN = { id: 'user_admin', name: 'Quản trị A', email: 'admin@example.com' }
const EDITOR = { id: 'user_editor', name: 'Biên tập B', email: 'editor@example.com' }

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_audit_service' }

async function integration() {
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
    const { Audit } = await prepareDatabase(connection)

    async function write(siteId: string, actor: typeof ADMIN, input: {
      resourceType: 'content' | 'category' | 'media'
      resourceKey: string
      action: 'create' | 'update' | 'publish' | 'delete'
      revision: number
      createdAt: string
    }) {
      await recordContentAudit({ model: Audit, actor, requestId: 'req_test' }, {
        siteId,
        resourceType: input.resourceType,
        resourceId: `${input.resourceType}_${input.resourceKey}_${input.revision}`,
        resourceKey: input.resourceKey,
        action: input.action,
        revision: input.revision,
        fromStatus: input.action === 'create' ? null : 'draft',
        toStatus: input.action === 'publish' ? 'published' : 'draft',
        changedFields: input.action === 'update' ? ['locales'] : [],
      })
      // recordContentAudit stamps `createdAt` itself, so pin it afterwards to
      // make the range filter deterministic. The raw driver is used because the
      // schema's timestamps option would overwrite `createdAt` on an update.
      await Audit.collection.updateOne(
        { siteId, resourceKey: input.resourceKey, revision: input.revision },
        { $set: { createdAt: new Date(input.createdAt) } },
      )
    }

    await write(SITE, ADMIN, {
      resourceType: 'content', resourceKey: 'bai-viet-a', action: 'create', revision: 1, createdAt: '2026-11-01T02:00:00.000Z',
    })
    await write(SITE, EDITOR, {
      resourceType: 'content', resourceKey: 'bai-viet-a', action: 'publish', revision: 2, createdAt: '2026-11-02T02:00:00.000Z',
    })
    await write(SITE, EDITOR, {
      resourceType: 'media', resourceKey: 'landing/hero.png', action: 'update', revision: 3, createdAt: '2026-11-03T02:00:00.000Z',
    })
    await write(SITE, ADMIN, {
      resourceType: 'category', resourceKey: 'tin-tuc', action: 'delete', revision: 1, createdAt: '2026-11-04T02:00:00.000Z',
    })
    await write(OTHER_SITE, ADMIN, {
      resourceType: 'content', resourceKey: 'bai-viet-a', action: 'create', revision: 1, createdAt: '2026-11-05T02:00:00.000Z',
    })

    await check('lists only the site and in newest-first order', async () => {
      const page = await listAuditEntries(Audit, SITE, { limit: 30 })
      assert.equal(page.total, 4)
      assert.equal(page.data.length, 4)
      assert.deepEqual(page.data.map(entry => entry.resourceKey), ['tin-tuc', 'landing/hero.png', 'bai-viet-a', 'bai-viet-a'])
      assert.equal(page.data[0]!.action, 'delete')
      assert.equal(page.hasMore, false)
      assert.equal(page.nextCursor, null)
      assert.ok(page.data.every(entry => entry.id.length === 24))
    })

    await check('filters by resource type and action together', async () => {
      const content = await listAuditEntries(Audit, SITE, { limit: 30, resourceType: 'content' })
      assert.equal(content.total, 2)

      const publish = await listAuditEntries(Audit, SITE, { limit: 30, resourceType: 'content', action: 'publish' })
      assert.equal(publish.total, 1)
      assert.equal(publish.data[0]!.revision, 2)
      assert.equal(publish.data[0]!.toStatus, 'published')

      const none = await listAuditEntries(Audit, SITE, { limit: 30, resourceType: 'media', action: 'delete' })
      assert.equal(none.total, 0)
      assert.deepEqual(none.data, [])
    })

    await check('searches resource key and actor, case-insensitively', async () => {
      const byKey = await listAuditEntries(Audit, SITE, { limit: 30, q: 'HERO.PNG' })
      assert.equal(byKey.total, 1)
      assert.equal(byKey.data[0]!.resourceType, 'media')

      const byActor = await listAuditEntries(Audit, SITE, { limit: 30, q: 'biên tập' })
      assert.equal(byActor.total, 2)
      assert.ok(byActor.data.every(entry => entry.actor.email === EDITOR.email))

      // The other site has the same key; the search must not leak across sites.
      const foreign = await listAuditEntries(Audit, OTHER_SITE, { limit: 30, q: 'bai-viet-a' })
      assert.equal(foreign.total, 1)
      assert.equal(foreign.data[0]!.createdAt, '2026-11-05T02:00:00.000Z')
    })

    await check('filters by actor and by a date range', async () => {
      const byActor = await listAuditEntries(Audit, SITE, { limit: 30, actorId: ADMIN.id })
      assert.equal(byActor.total, 2)

      const range = await listAuditEntries(Audit, SITE, {
        limit: 30,
        from: new Date('2026-11-02T00:00:00.000Z'),
        to: new Date('2026-11-03T23:59:59.000Z'),
      })
      assert.equal(range.total, 2)
      assert.deepEqual(range.data.map(entry => entry.action), ['update', 'publish'])
    })

    await check('pages with an id cursor without repeating or skipping rows', async () => {
      const first = await listAuditEntries(Audit, SITE, { limit: 2 })
      assert.equal(first.data.length, 2)
      assert.equal(first.hasMore, true)
      assert.ok(first.nextCursor)

      const second = await listAuditEntries(Audit, SITE, { limit: 2, cursor: first.nextCursor! })
      assert.equal(second.data.length, 2)
      assert.equal(second.hasMore, false)
      assert.equal(second.nextCursor, null)
      assert.equal(second.total, 4, 'total ignores the page window')

      const ids = [...first.data, ...second.data].map(entry => entry.id)
      assert.equal(new Set(ids).size, 4)
      assert.equal(ids[0], first.data[0]!.id)
    })

    await check('rejects a cursor that is not a document id', async () => {
      await assert.rejects(
        () => listAuditEntries(Audit, SITE, { limit: 2, cursor: 'not-a-cursor' }),
        (error: unknown) => error instanceof AuditQueryError && error.code === 'AUDIT_QUERY_INVALID',
      )
    })

    await check('a record history filters by its own type and id', async () => {
      const media = await listRecordAudit(Audit, SITE, {
        resourceType: 'media',
        resourceId: 'media_landing/hero.png_3',
      })
      assert.equal(media.length, 1)
      assert.equal(media[0]!.action, 'update')
      assert.equal(media[0]!.changedFields.includes('locales'), true)

      const content = await listRecordAudit(Audit, SITE, {
        resourceType: 'content',
        resourceId: 'content_bai-viet-a_2',
      })
      assert.equal(content.length, 1, 'the create row of the same key stays out')
      assert.equal(content[0]!.action, 'publish')

      const wrongType = await listRecordAudit(Audit, SITE, {
        resourceType: 'category',
        resourceId: 'media_landing/hero.png_3',
      })
      assert.deepEqual(wrongType, [], 'an id alone never matches another type')

      const otherSite = await listRecordAudit(Audit, OTHER_SITE, {
        resourceType: 'content',
        resourceId: 'content_bai-viet-a_1',
      })
      assert.equal(otherSite.length, 1, 'the same id is scoped to its site')
    })

    await check('a record history caps at 50 rows and rejects nothing else', async () => {
      const capped = await listRecordAudit(Audit, SITE, {
        resourceType: 'content',
        resourceId: 'content_bai-viet-a_2',
        limit: 500,
      })
      assert.equal(capped.length, 1)
      assert.equal((await listRecordAudit(Audit, SITE, { resourceType: 'content', resourceId: 'nope' })).length, 0)
    })

    await check('a category delete keeps the transition the command wrote', async () => {
      const result = await listAuditEntries(Audit, SITE, { limit: 1 })
      const entry = result.data[0]!
      assert.equal(entry.resourceType, 'category')
      assert.equal(entry.fromStatus, 'draft')
      assert.equal(entry.toStatus, 'draft')
      assert.equal(entry.requestId, 'req_test')
      assert.deepEqual(entry.actor, ADMIN)
    })
  } finally {
    await closeDatabaseConnections()
  }
}

try {
  await integration()
} finally {
  // nothing to restore
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Audit checks failed')
}
