import assert from 'node:assert/strict'
import {
  RETENTION_LIMITS,
  RetentionError,
  normalizeRetentionOptions,
  pruneRetention,
} from '../../tm-cms/server/services/retentionService.js'
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
const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_retention_service' }
const NOW = new Date('2026-11-08T00:00:00.000Z')

const actor = { id: 'system', name: '', email: '' }

function revisionDoc(siteId: string, contentId: string, revision: number) {
  return {
    siteId,
    contentId,
    revision,
    status: 'draft',
    action: 'update',
    changedFields: [],
    snapshot: { type: 'page', locales: [], categories: [], tags: [], media: [], attributes: {}, publishAt: null, unpublishAt: null },
    actor,
    requestId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

function auditDoc(siteId: string, daysAgo: number) {
  return {
    siteId,
    resourceType: 'content',
    resourceId: `content_${daysAgo}`,
    resourceKey: `key-${daysAgo}`,
    action: 'update',
    revision: 1,
    fromStatus: 'draft',
    toStatus: 'draft',
    changedFields: [],
    actor,
    requestId: null,
    createdAt: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
  }
}

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
    const { Audit, Revision } = await prepareDatabase(connection)

    await Revision.collection.insertMany([
      ...Array.from({ length: 5 }, (_, index) => revisionDoc(SITE, 'content_long', index + 1)),
      revisionDoc(SITE, 'content_short', 1),
      revisionDoc(SITE, 'content_short', 2),
      ...Array.from({ length: 4 }, (_, index) => revisionDoc(OTHER_SITE, 'content_long', index + 1)),
    ])

    await Audit.collection.insertMany([
      auditDoc(SITE, 400),
      auditDoc(SITE, 200),
      auditDoc(SITE, 10),
      auditDoc(OTHER_SITE, 400),
    ])

    await check('rejects out-of-range or non-integer options', () => {
      const bad: Array<Partial<{ keepRevisions: number, auditDays: number }>> = [
        { keepRevisions: 0 },
        { keepRevisions: RETENTION_LIMITS.maxKeepRevisions + 1 },
        { auditDays: 0 },
        { auditDays: 2.5 },
      ]
      for (const input of bad) {
        assert.throws(
          () => normalizeRetentionOptions(input),
          (error: unknown) => error instanceof RetentionError && error.code === 'RETENTION_OPTIONS_INVALID',
        )
      }
      const defaults = normalizeRetentionOptions({})
      assert.equal(defaults.dryRun, true, 'dry run is the default')
      assert.equal(defaults.keepRevisions, 50)
      assert.equal(defaults.auditDays, 365)
    })

    await check('a dry run reports what would go and deletes nothing', async () => {
      const report = await pruneRetention({ Audit, Revision }, SITE, { keepRevisions: 2, auditDays: 90, dryRun: true }, NOW)
      assert.equal(report.revisions.deleted, 3, 'five snapshots, keep two')
      assert.equal(report.revisions.kept, 2)
      assert.equal(report.revisions.contents, 1, 'only the record over the cap is counted')
      assert.equal(report.audit.deleted, 2, '400 and 200 days old')
      assert.equal(await Revision.countDocuments({ siteId: SITE }), 7)
      assert.equal(await Audit.countDocuments({ siteId: SITE }), 3)
    })

    await check('apply keeps the newest snapshots per content and the other site intact', async () => {
      const report = await pruneRetention({ Audit, Revision }, SITE, { keepRevisions: 2, auditDays: 90, dryRun: false }, NOW)
      assert.equal(report.revisions.deleted, 3)
      assert.equal(await Revision.countDocuments({ siteId: SITE, contentId: 'content_long' }), 2)
      assert.deepEqual(
        (await Revision.find({ siteId: SITE, contentId: 'content_long' }).sort({ revision: 1 }).lean()).map(doc => doc.revision),
        [4, 5],
      )
      assert.equal(await Revision.countDocuments({ siteId: SITE, contentId: 'content_short' }), 2, 'a record under the cap is untouched')
      assert.equal(await Revision.countDocuments({ siteId: OTHER_SITE }), 4)
      assert.equal(report.audit.deleted, 2)
      assert.equal(await Audit.countDocuments({ siteId: SITE }), 1)
      assert.equal(await Audit.countDocuments({ siteId: OTHER_SITE }), 1)
      assert.equal(await Audit.countDocuments({ siteId: SITE, resourceKey: 'key-10' }), 1, 'the recent entry survives')
    })

    await check('a second apply is a no-op', async () => {
      const report = await pruneRetention({ Audit, Revision }, SITE, { keepRevisions: 2, auditDays: 90, dryRun: false }, NOW)
      assert.equal(report.revisions.deleted, 0)
      assert.equal(report.audit.deleted, 0)
      assert.equal(await Revision.countDocuments({ siteId: SITE }), 4)
      assert.equal(await Audit.countDocuments({ siteId: SITE }), 1)
    })

    await check('a wide window removes nothing when everything is recent', async () => {
      const report = await pruneRetention({ Audit, Revision }, SITE, { keepRevisions: 100, auditDays: 3650, dryRun: false }, NOW)
      assert.equal(report.revisions.deleted, 0)
      assert.equal(report.audit.deleted, 0)
      assert.equal(await Revision.countDocuments({ siteId: SITE }), 4)
    })
  } finally {
    await closeDatabaseConnections()
  }
}

try {
  await integration()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Retention checks failed')
}
