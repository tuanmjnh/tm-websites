import assert from 'node:assert/strict'
import {
  TagServiceError,
  listTags,
  renameTag,
  replaceTag,
} from '../../tm-cms/server/services/tagService.js'
import { createContent } from '../../tm-cms/server/services/contentService.js'
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

function isTagError(status: number, code: string) {
  return (error: unknown) => error instanceof TagServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

function page(key: string, title: string, tags: string[]) {
  return {
    type: 'page',
    key,
    locales: [{ locale: 'vi', title, slug: key }],
    tags,
  }
}

console.log('Tags — rename, merge and detach (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_tag_service' }

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
    const { Content, Audit, Revision } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR }, revision: { model: Revision, actor: ACTOR } }

    await check('replaceTag keeps the position and drops a duplicate produced by a merge', () => {
      assert.deepEqual(replaceTag(['a', 'typo', 'b'], 'typo', 'b'), ['a', 'b'])
      assert.deepEqual(replaceTag(['typo', 'b'], 'typo', 'fixed'), ['fixed', 'b'])
      assert.deepEqual(replaceTag(['a', 'typo'], 'typo', null), ['a'])
      assert.deepEqual(replaceTag(['a'], 'missing', 'x'), ['a'])
    })

    const one = await createContent(Content, SITE, page('tag-one', 'Tag one', ['typo', 'shared']), meta)
    const two = await createContent(Content, SITE, page('tag-two', 'Tag two', ['shared', 'typo']), meta)
    await createContent(Content, SITE, page('tag-three', 'Tag three', ['shared']), meta)
    await createContent(Content, OTHER_SITE, page('tag-foreign', 'Foreign', ['typo']), meta)

    await check('listTags counts records per tag, most used first, scoped to the site', async () => {
      const tags = await listTags(Content, SITE)
      assert.deepEqual(tags, [
        { name: 'shared', count: 3 },
        { name: 'typo', count: 2 },
      ])
      const foreign = await listTags(Content, OTHER_SITE)
      assert.deepEqual(foreign, [{ name: 'typo', count: 1 }])
    })

    await check('renameTag rewrites every record and bumps each revision', async () => {
      const result = await renameTag(Content, SITE, { from: 'typo', to: 'fixed' }, meta)
      assert.deepEqual(result, { from: 'typo', to: 'fixed', updated: 2, skipped: 0 })

      const first = await Content.findById(one.id).lean<{ tags: string[], revision: number }>()
      assert.deepEqual(first?.tags, ['fixed', 'shared'])
      assert.equal(first?.revision, 2)
      const second = await Content.findById(two.id).lean<{ tags: string[], revision: number }>()
      assert.deepEqual(second?.tags, ['shared', 'fixed'])

      // The other site keeps its own copy of the tag.
      assert.deepEqual((await listTags(Content, OTHER_SITE)).map(tag => tag.name), ['typo'])
    })

    await check('renameTag merges onto an existing tag without duplicating it', async () => {
      const result = await renameTag(Content, SITE, { from: 'fixed', to: 'shared' }, meta)
      assert.equal(result.updated, 2)

      const first = await Content.findById(one.id).lean<{ tags: string[] }>()
      assert.deepEqual(first?.tags, ['shared'])
      assert.deepEqual(await listTags(Content, SITE), [{ name: 'shared', count: 3 }])
    })

    await check('renameTag with to: null detaches the tag from every record', async () => {
      const result = await renameTag(Content, SITE, { from: 'shared', to: null }, meta)
      assert.deepEqual(result, { from: 'shared', to: null, updated: 3, skipped: 0 })
      assert.deepEqual(await listTags(Content, SITE), [])

      const stillThere = await Content.countDocuments({ siteId: SITE })
      assert.equal(stillThere, 3, 'detaching a tag never removes the records')
    })

    await check('renameTag refuses a missing tag, an unchanged name, and an empty name', async () => {
      await assert.rejects(
        () => renameTag(Content, SITE, { from: 'nobody-uses-this', to: 'x' }, meta),
        isTagError(404, 'TAG_NOT_FOUND'),
      )
      await assert.rejects(
        () => renameTag(Content, SITE, { from: 'a', to: 'a' }, meta),
        isTagError(422, 'TAG_RENAME_SAME'),
      )
      await assert.rejects(
        () => renameTag(Content, SITE, { from: '   ', to: 'x' }, meta),
        isTagError(422, 'TAG_REQUIRED'),
      )
      await assert.rejects(
        () => renameTag(Content, SITE, { from: 'x', to: 'y'.repeat(61) }, meta),
        isTagError(422, 'TAG_TOO_LONG'),
      )
    })

    await check('renameTag normalises whitespace and a retry finds nothing left', async () => {
      const target = await createContent(Content, SITE, page('tag-space', 'Space', ['spaced tag']), meta)
      const result = await renameTag(Content, SITE, { from: '  spaced   tag  ', to: ' clean ' }, meta)
      assert.deepEqual(result, { from: 'spaced tag', to: 'clean', updated: 1, skipped: 0 })
      const stored = await Content.findById(target.id).lean<{ tags: string[] }>()
      assert.deepEqual(stored?.tags, ['clean'])
      await assert.rejects(
        () => renameTag(Content, SITE, { from: 'spaced tag', to: 'clean' }, meta),
        isTagError(404, 'TAG_NOT_FOUND'),
      )
    })

    await check('every rewritten record gets an audit entry and a revision snapshot', async () => {
      const audits = await Audit.find({ siteId: SITE, resourceType: 'content', 'changedFields': 'tags' })
        .lean<{ actor: { email: string }, resourceKey: string }[]>()
      assert.ok(audits.length >= 7)
      assert.ok(audits.every(entry => entry.actor.email === ACTOR.email))
      assert.ok(audits.some(entry => entry.resourceKey === 'tag-one'))

      const revisions = await Revision.find({ siteId: SITE, contentId: one.id })
        .sort({ revision: 1 })
        .lean<{ revision: number, action: string, changedFields: string[], snapshot: { tags: string[] } }[]>()
      const tagsRevision = revisions.find(entry => entry.action === 'update' && entry.changedFields.includes('tags'))
      assert.ok(tagsRevision, 'a tag-only change is stored as a revision')
      assert.deepEqual(tagsRevision?.snapshot.tags, ['fixed', 'shared'])
    })

    await check('a record saved by someone else is reported as skipped, not overwritten', async () => {
      // A model whose read returns a record and whose guarded write finds nothing:
      // exactly what a save by another editor between the two calls looks like.
      const stale = {
        find: () => ({
          lean: async () => [{
            _id: '000000000000000000000001',
            siteId: SITE,
            key: 'tag-race',
            status: 'draft',
            revision: 1,
            tags: ['race'],
          }],
        }),
        findOneAndUpdate: () => ({ lean: async () => null }),
      } as unknown as typeof Content

      const result = await renameTag(stale, SITE, { from: 'race', to: 'raced' }, meta)
      assert.deepEqual(result, { from: 'race', to: 'raced', updated: 0, skipped: 1 })
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Tag service checks: ${checks} passed, ${notRun} not run\n`)
