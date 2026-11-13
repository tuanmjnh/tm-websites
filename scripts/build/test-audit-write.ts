import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CategoryServiceError, createCategory, deleteCategory, updateCategory } from '../../tm-cms/server/services/categoryService.js'
import { createMedia, deleteMedia, updateMedia } from '../../tm-cms/server/services/mediaService.js'
import { listAuditEntries } from '../../tm-cms/server/services/auditService.js'
import { normalizeAuditReason } from '../../tm-cms/server/services/contentAudit.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

/**
 * Write side of the audit trail for the two domains that had only a read-side
 * test: category and media. It proves the rows a mutation leaves behind — type,
 * action, actor, request id, reason and touched fields — and that the same rows
 * come back through `listAuditEntries`, which is what the Audit Log page reads.
 */

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
const ORIGIN = 'http://localhost:4005'
const ACTOR = { id: 'user_audit_admin', name: 'Audit Admin', email: 'audit@example.com' }
const REQUEST_ID = 'req-audit-write-1'
const REASON = 'Đổi theo yêu cầu của khách'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function category(key: string, extra: Record<string, unknown> = {}) {
  return { key, locales: [{ locale: 'vi', name: key, slug: key }], ...extra }
}

console.log('Audit — category and media mutations (live MongoDB + local storage)\n')

const previousMediaDir = process.env.TM_MEDIA_DIR
const mediaDir = await mkdtemp(join(tmpdir(), 'tm-audit-write-'))
process.env.TM_MEDIA_DIR = mediaDir

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_audit_write' }

await check('normalises an operator note instead of storing it raw', () => {
  assert.equal(normalizeAuditReason(`  ${REASON}  `), REASON)
  assert.equal(normalizeAuditReason('sửa\n\tdòng'), 'sửa dòng', 'control characters collapse into spaces')
  assert.equal(normalizeAuditReason('   '), null, 'blank becomes null, never an empty string')
  assert.equal(normalizeAuditReason(null), null)
  assert.equal(normalizeAuditReason(42), null)
  assert.equal(normalizeAuditReason('x'.repeat(600))!.length, 500, 'a paste is capped at 500 characters')
})

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
    const { Category, Content, Media, Audit } = await prepareDatabase(connection)

    const meta = { audit: { model: Audit, actor: ACTOR, requestId: REQUEST_ID, reason: REASON } }
    const rowsFor = (resourceType: string) =>
      Audit.find({ siteId: SITE, resourceType }).sort({ createdAt: 1, _id: 1 }).lean<Array<Record<string, unknown>>>()

    const root = await createCategory(Category, SITE, category('trang-suc'), meta)
    const child = await createCategory(Category, SITE, category('nhan', { parent: 'trang-suc' }), meta)

    await check('creating a category writes one audit row with actor, request id and reason', async () => {
      const rows = await rowsFor('category')
      assert.equal(rows.length, 2)
      const row = rows[0]!
      assert.equal(row.action, 'create')
      assert.equal(row.resourceId, root.id)
      assert.equal(row.resourceKey, 'trang-suc')
      assert.equal(row.revision, 1)
      assert.deepEqual(row.actor, ACTOR)
      assert.equal(row.requestId, REQUEST_ID)
      assert.equal(row.reason, REASON)
      assert.ok((row.changedFields as string[]).includes('key'))
      assert.equal(row.siteId, SITE)
    })

    await check('an update records only the fields it touched', async () => {
      await updateCategory(
        Category,
        SITE,
        root.id,
        { revision: 1, locales: [{ locale: 'vi', name: 'Trang sức', slug: 'trang-suc' }] },
        meta,
      )
      const rows = await rowsFor('category')
      const row = rows.find(entry => entry.action === 'update')!
      assert.equal(row.resourceKey, 'trang-suc')
      assert.equal(row.revision, 2)
      assert.deepEqual(row.changedFields, ['locales'])
      assert.equal(row.reason, REASON)
    })

    await check('a refused command leaves no audit row behind', async () => {
      const before = await Audit.countDocuments({ siteId: SITE })
      await assert.rejects(
        () => deleteCategory(Category, Content, SITE, root.id, 2, meta),
        (error: unknown) => error instanceof CategoryServiceError && error.code === 'CATEGORY_HAS_CHILDREN',
      )
      assert.equal(await Audit.countDocuments({ siteId: SITE }), before, 'the guard wrote nothing')
    })

    await check('deleting records the removal with the same actor and reason', async () => {
      await deleteCategory(Category, Content, SITE, child.id, 1, meta)
      const row = (await rowsFor('category')).find(entry => entry.action === 'delete')!
      assert.equal(row.resourceKey, 'nhan')
      // A delete records the revision it produced, the same convention as content.
      assert.equal(row.revision, 2)
      assert.deepEqual(row.actor, ACTOR)
      assert.equal(row.reason, REASON)
    })

    const created = await createMedia(Media, SITE, ORIGIN, {
      body: PNG,
      mimeType: 'image/png',
      originalName: 'audit-note.png',
      folder: 'audit',
      uploader: ACTOR,
    }, { model: Audit, actor: ACTOR, requestId: REQUEST_ID, reason: REASON })

    await check('uploading media writes a create row for the file', async () => {
      const rows = await rowsFor('media')
      const row = rows.find(entry => entry.action === 'create')!
      assert.equal(row.resourceId, created.id)
      assert.equal(row.resourceKey, 'audit-note.png')
      assert.equal(row.revision, 1)
      assert.equal(row.reason, REASON)
      assert.deepEqual(row.actor, ACTOR)
    })

    await check('editing the file records the touched metadata', async () => {
      await updateMedia(Media, SITE, ORIGIN, created.id, { revision: 1, title: 'Audit note' }, {
        model: Audit,
        actor: ACTOR,
        requestId: REQUEST_ID,
        reason: REASON,
      })
      const row = (await rowsFor('media')).find(entry => entry.action === 'update')!
      assert.deepEqual(row.changedFields, ['title'])
      assert.equal(row.revision, 2)
      assert.equal(row.reason, REASON)
    })

    await check('deleting the file records it too', async () => {
      await deleteMedia({ media: Media, content: Content }, SITE, created.id, 2, {
        model: Audit,
        actor: ACTOR,
        requestId: REQUEST_ID,
        reason: REASON,
      })
      const row = (await rowsFor('media')).find(entry => entry.action === 'delete')!
      assert.equal(row.resourceKey, 'audit-note.png')
      assert.equal(row.reason, REASON)
    })

    await check('a mutation without a note stores null, not the previous reason', async () => {
      await createCategory(Category, SITE, category('phu-kien'), { audit: { model: Audit, actor: ACTOR } })
      const row = (await rowsFor('category')).find(entry => entry.resourceKey === 'phu-kien')!
      assert.equal(row.reason, null)
      assert.equal(row.requestId, null)
      assert.deepEqual(row.actor, ACTOR, 'the actor is still recorded')
    })

    await check('the audit list returns the category and media rows with actor and reason', async () => {
      const categories = await listAuditEntries(Audit, SITE, { limit: 30, resourceType: 'category' })
      assert.equal(categories.data.length, 5, 'three creates, one update, one delete')
      const newest = categories.data[0]!
      assert.equal(newest.resourceKey, 'phu-kien')
      assert.equal(newest.reason, null)
      const withReason = categories.data.find(entry => entry.action === 'update')!
      assert.equal(withReason.reason, REASON)
      assert.deepEqual(withReason.actor, ACTOR)

      const media = await listAuditEntries(Audit, SITE, { limit: 30, resourceType: 'media' })
      assert.deepEqual(media.data.map(entry => entry.action).sort(), ['create', 'delete', 'update'])
      assert.ok(media.data.every(entry => entry.reason === REASON), 'every media row kept its reason')

      const searched = await listAuditEntries(Audit, SITE, { limit: 30, q: 'audit-note' })
      assert.equal(searched.data.length, 3, 'create, update and delete all carry the file name')
      assert.ok(searched.data.every(entry => entry.resourceType === 'media'))
    })

    await check('another site sees none of it', async () => {
      assert.equal(await Audit.countDocuments({ siteId: OTHER_SITE }), 0)
      const other = await listAuditEntries(Audit, OTHER_SITE, { limit: 30 })
      assert.deepEqual(other.data, [])
    })
  } finally {
    await closeDatabaseConnections()
  }
}

try {
  await integration()
} finally {
  if (previousMediaDir === undefined) delete process.env.TM_MEDIA_DIR
  else process.env.TM_MEDIA_DIR = previousMediaDir
  await rm(mediaDir, { recursive: true, force: true })
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Audit write checks failed')
}
