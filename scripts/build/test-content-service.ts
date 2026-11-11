import assert from 'node:assert/strict'
import {
  ContentServiceError,
  createContent,
  findPublicContent,
  getContent,
  listContent,
  listContentMenuReferences,
  restoreContentRevision,
  runContentEvent,
  updateContent,
} from '../../tm-cms/server/services/contentService.js'
import { listContentAudit } from '../../tm-cms/server/services/contentAudit.js'
import { createMenu, deleteMenu } from '../../tm-cms/server/services/menuService.js'
import {
  getContentRevision,
  listContentRevisions,
} from '../../tm-cms/server/services/contentRevisions.js'
import { AUTO_SLUG_REDIRECT_NOTE } from '../../tm-cms/server/services/contentSlugRedirects.js'
import { IdempotencyError, normalizeIdempotencyKey, executeIdempotent } from '../../tm-cms/server/utils/idempotency.js'
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

function isServiceError(status: number, code: string) {
  return (error: unknown) => error instanceof ContentServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }
const OTHER_SITE = 'bagpost'
const NOW = new Date('2026-11-06T10:00:00.000Z')
const FUTURE = new Date('2026-12-01T00:00:00.000Z')

function pageDraft(key: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'page',
    key,
    locales: [{ locale: 'vi', title: `Tiêu đề ${slug}`, slug, body: `<p>${slug}</p>` }],
    ...extra,
  }
}

console.log('Content — admin commands and public read (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_content_service' }

async function integration() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    console.log('      Start a local MongoDB and re-run `pnpm test:content`.')
    return
  }

  try {
    await connection.db!.dropDatabase()
    const { Content, Audit, Revision, IdempotencyKey, Menu, Redirect } = await prepareDatabase(connection)
    const meta = (actor = ACTOR) => ({
      audit: { model: Audit, actor },
      revision: { model: Revision, actor },
    })
    // Every content write in the API context also carries the redirect map.
    const metaR = (actor = ACTOR) => ({ ...meta(actor), redirects: Redirect })

    const created = await createContent(Content, SITE, pageDraft('pages/about', 'gioi-thieu', {
      tags: ['về chúng tôi', 'về chúng tôi'],
      attributes: { layout: 'wide' },
    }), meta())

    await check('create stores a draft at revision 1 with normalized fields', () => {
      assert.equal(created.status, 'draft')
      assert.equal(created.revision, 1)
      assert.equal(created.publishedAt, null)
      assert.deepEqual(created.tags, ['về chúng tôi'])
      assert.deepEqual(created.attributes, { layout: 'wide' })
      assert.equal(created.locales[0]!.slug, 'gioi-thieu')
      assert.equal(typeof created.id, 'string')
    })

    await check('a duplicate key is reported as a conflict', async () => {
      await assert.rejects(
        () => createContent(Content, SITE, pageDraft('pages/about', 'gioi-thieu-khac')),
        isServiceError(409, 'CONTENT_KEY_EXISTS'),
      )
    })

    await check('a duplicate locale slug is reported as a conflict', async () => {
      await assert.rejects(
        () => createContent(Content, SITE, pageDraft('pages/contact', 'gioi-thieu')),
        isServiceError(409, 'CONTENT_SLUG_EXISTS'),
      )
    })

    await check('an invalid payload is a 422, not a crash', async () => {
      await assert.rejects(
        () => createContent(Content, SITE, { type: 'page', key: 'pages/bad', locales: [] }),
        isServiceError(422, 'CONTENT_PAYLOAD_INVALID'),
      )
      // Attribute keys follow the shared pattern; a value without a safe key is refused.
      await assert.rejects(
        () => createContent(Content, SITE, pageDraft('pages/bad-attr', 'bad-attr', { attributes: { '1bad key': 'x' } })),
        isServiceError(422, 'CONTENT_PAYLOAD_INVALID'),
      )
    })

    await check('keywords are trimmed and de-duplicated, and the public read carries them', async () => {
      const keywordDraft = pageDraft('pages/keywords', 'tu-khoa', {
        locales: [
          {
            locale: 'vi',
            title: 'Từ khóa',
            slug: 'tu-khoa',
            keywords: [' Trang sức ', 'trang sức', '  ', 'Quà tặng'],
          },
        ],
      })
      const keywordPage = await createContent(Content, SITE, keywordDraft, meta())
      assert.deepEqual(keywordPage.locales[0]!.keywords, ['Trang sức', 'trang sức', 'Quà tặng'])

      await runContentEvent(Content, SITE, keywordPage.id, { event: 'publish', revision: 1 }, NOW, meta())
      const projection = await findPublicContent(Content, SITE, 'pages/keywords', 'vi', NOW)
      assert.deepEqual(projection?.keywords, ['Trang sức', 'trang sức', 'Quà tặng'])
      assert.deepEqual(keywordPage.locales[0]!.seo, { title: '', description: '', image: '' })

      // Back to draft so the status counts below only see the records they expect.
      await runContentEvent(Content, SITE, keywordPage.id, { event: 'unpublish', revision: 2 }, NOW, meta())
      assert.equal(await findPublicContent(Content, SITE, 'pages/keywords', 'vi', NOW), null)

      // Keywords live in the revision snapshot too, so a restore brings them back.
      await updateContent(Content, SITE, keywordPage.id, {
        revision: 3,
        type: 'page',
        locales: [{ locale: 'vi', title: 'Từ khóa', slug: 'tu-khoa', keywords: ['mới'] }],
      }, meta())
      const restored = await restoreContentRevision(Content, Revision, SITE, keywordPage.id, 2, 4, meta())
      assert.deepEqual(restored.locales[0]!.keywords, ['Trang sức', 'trang sức', 'Quà tặng'])
    })

    await check('too many or too long keywords are a 422, not a silent truncation', async () => {
      await assert.rejects(
        () => createContent(Content, SITE, pageDraft('pages/kw-limit', 'kw-limit', {
          locales: [{ locale: 'vi', title: 'X', slug: 'kw-limit', keywords: Array.from({ length: 21 }, (_, i) => `kw-${i}`) }],
        })),
        isServiceError(422, 'CONTENT_PAYLOAD_INVALID'),
      )
      await assert.rejects(
        () => createContent(Content, SITE, pageDraft('pages/kw-long', 'kw-long', {
          locales: [{ locale: 'vi', title: 'X', slug: 'kw-long', keywords: ['x'.repeat(61)] }],
        })),
        isServiceError(422, 'CONTENT_PAYLOAD_INVALID'),
      )
    })

    await check('another site cannot read the record', async () => {
      await assert.rejects(() => getContent(Content, OTHER_SITE, created.id), isServiceError(404, 'CONTENT_NOT_FOUND'))
      const foreign = await listContent(Content, OTHER_SITE, {})
      assert.equal(foreign.data.length, 0)
      assert.equal(foreign.counts.all, 0)
    })

    const updated = await updateContent(Content, SITE, created.id, {
      revision: created.revision,
      type: 'post',
      locales: [
        { locale: 'vi', title: 'Giới thiệu', slug: 'gioi-thieu', body: '<p>Nội dung mới</p>' },
        { locale: 'en', title: 'About us', slug: 'about-us' },
      ],
      tags: ['about'],
    }, meta())

    await check('update replaces validated fields and increments the revision', () => {
      assert.equal(updated.revision, 2)
      assert.equal(updated.type, 'post')
      assert.equal(updated.locales.length, 2)
      assert.equal(updated.locales[1]!.slug, 'about-us')
    })

    await check('a stale revision is a 409 instead of a silent overwrite', async () => {
      await assert.rejects(
        () => updateContent(Content, SITE, created.id, { revision: 1, ...pageDraft('pages/about', 'gioi-thieu') }),
        isServiceError(409, 'CONTENT_REVISION_CONFLICT'),
      )
    })

    await check('the content key is immutable', async () => {
      await assert.rejects(
        () => updateContent(Content, SITE, created.id, { revision: 2, ...pageDraft('pages/renamed', 'gioi-thieu') }),
        isServiceError(422, 'CONTENT_KEY_IMMUTABLE'),
      )
    })

    const published = await runContentEvent(Content, SITE, created.id, { event: 'publish', revision: 2 }, NOW, meta())

    await check('publishing stamps publishedAt and exposes the public projection', async () => {
      assert.equal(published.status, 'published')
      assert.equal(published.publishedAt, NOW.toISOString())

      const projection = await findPublicContent(Content, SITE, 'pages/about', 'vi', NOW)
      assert.ok(projection)
      assert.equal(projection.body, '<p>Nội dung mới</p>')
      assert.equal('status' in projection, false)

      const english = await findPublicContent(Content, SITE, 'pages/about', 'en', NOW)
      assert.equal(english?.title, 'About us')
      assert.equal(await findPublicContent(Content, SITE, 'pages/about', 'fr', NOW), null)
    })

    const unpublished = await runContentEvent(Content, SITE, created.id, { event: 'unpublish', revision: 3 }, NOW, meta())

    await check('unpublishing hides the record without deleting it', async () => {
      assert.equal(unpublished.status, 'draft')
      assert.equal(unpublished.publishedAt, null)
      assert.equal(await findPublicContent(Content, SITE, 'pages/about', 'vi', NOW), null)
    })

    await check('scheduling needs a future date', async () => {
      await assert.rejects(
        () => runContentEvent(Content, SITE, created.id, { event: 'schedule', revision: 4, publishAt: '2026-01-01T00:00:00.000Z' }, NOW),
        isServiceError(422, 'CONTENT_PUBLISH_AT_PAST'),
      )

      const scheduled = await runContentEvent(
        Content,
        SITE,
        created.id,
        { event: 'schedule', revision: 4, publishAt: FUTURE.toISOString() },
        NOW,
        meta(),
      )
      assert.equal(scheduled.status, 'scheduled')
      assert.equal(scheduled.publishAt, FUTURE.toISOString())
      assert.equal(await findPublicContent(Content, SITE, 'pages/about', 'vi', NOW), null)
    })

    await check('publishing ahead of its schedule is rejected', async () => {
      await assert.rejects(
        () => runContentEvent(Content, SITE, created.id, { event: 'publish', revision: 5 }, NOW),
        isServiceError(422, 'CONTENT_PUBLISH_AT_FUTURE'),
      )

      const live = await runContentEvent(Content, SITE, created.id, { event: 'publish', revision: 5 }, FUTURE, meta())
      assert.equal(live.status, 'published')
    })

    await check('archive cannot be published directly, restore goes through draft', async () => {
      const archived = await runContentEvent(Content, SITE, created.id, { event: 'archive', revision: 6 }, FUTURE, meta())
      assert.equal(archived.status, 'archived')
      assert.equal(await findPublicContent(Content, SITE, 'pages/about', 'vi', FUTURE), null)

      await assert.rejects(
        () => runContentEvent(Content, SITE, created.id, { event: 'publish', revision: 7 }, FUTURE),
        isServiceError(422, 'CONTENT_TRANSITION_INVALID'),
      )

      const restored = await runContentEvent(Content, SITE, created.id, { event: 'restore', revision: 7 }, FUTURE, meta())
      assert.equal(restored.status, 'draft')
    })

    await check('a page a menu links to cannot be deleted until the menu is fixed', async () => {
      const menu = await createMenu(Menu, SITE, {
        key: 'guard-main',
        name: 'Guard main',
        items: [{ label: { vi: 'Giới thiệu', en: 'About us' }, link: { type: 'content', target: 'pages/about' } }],
      })

      await assert.rejects(
        () => runContentEvent(Content, SITE, created.id, { event: 'delete', revision: 8 }, FUTURE, { ...meta(), menus: Menu }),
        (error: unknown) => {
          assert.ok(isServiceError(409, 'CONTENT_IN_MENU')(error))
          const details = (error as ContentServiceError).details as { menus: Array<{ key: string, name: string }> }
          assert.deepEqual(details.menus.map(entry => entry.key), ['guard-main'])
          assert.equal(details.menus[0]!.name, 'Guard main')
          return true
        },
      )
      assert.equal((await getContent(Content, SITE, created.id)).revision, 8, 'the refused delete changes nothing')

      const references = await listContentMenuReferences(Content, Menu, SITE, created.id)
      assert.deepEqual(references.map(entry => entry.key), ['guard-main'], 'the editor sees the same list the delete refuses with')
      assert.equal(references[0]!.name, 'Guard main')
      await assert.rejects(
        () => listContentMenuReferences(Content, Menu, OTHER_SITE, created.id),
        isServiceError(404, 'CONTENT_NOT_FOUND'),
        'another site cannot read the references of this page',
      )

      await deleteMenu(Menu, SITE, menu.id, 1)
      assert.deepEqual(await listContentMenuReferences(Content, Menu, SITE, created.id), [], 'no menu means no warning')
      const deleted = await runContentEvent(Content, SITE, created.id, { event: 'delete', revision: 8 }, FUTURE, meta())
      assert.equal(deleted.status, 'deleted')
    })

    await check('delete is soft and restore brings the record back', async () => {
      const deleted = await getContent(Content, SITE, created.id)
      assert.equal(deleted.status, 'deleted')
      assert.equal(deleted.status, 'deleted')
      assert.ok(deleted.deletedAt)
      assert.equal(await findPublicContent(Content, SITE, 'pages/about', 'vi', FUTURE), null)

      const fresh = await listContent(Content, SITE, { status: 'deleted' })
      assert.equal(fresh.data.length, 1)

      const restored = await runContentEvent(Content, SITE, created.id, { event: 'restore', revision: 9 }, FUTURE, meta())
      assert.equal(restored.status, 'draft')
      assert.equal(restored.deletedAt, null)
    })

    await check('each mutation leaves an audit entry with the actor and resulting revision', async () => {
      const history = await listContentAudit(Audit, SITE, created.id, 50)
      assert.deepEqual(
        history.map(entry => entry.action),
        ['restore', 'delete', 'restore', 'archive', 'publish', 'schedule', 'unpublish', 'publish', 'update', 'create'],
      )
      assert.ok(history.every(entry => entry.actor.id === ACTOR.id && entry.actor.email === ACTOR.email))

      const createEntry = history[history.length - 1]!
      assert.equal(createEntry.revision, 1)
      assert.equal(createEntry.fromStatus, null)
      assert.equal(createEntry.toStatus, 'draft')
      assert.ok(createEntry.changedFields.includes('locales'))
      assert.ok(createEntry.changedFields.includes('tags'))

      const updateEntry = history.find(entry => entry.action === 'update')!
      assert.equal(updateEntry.revision, 2)
      assert.ok(updateEntry.changedFields.includes('locales'))
      assert.ok(updateEntry.changedFields.includes('type'))

      // Newest first: the second publish comes from the scheduled state, the
      // first one straight from draft. Both are recorded, neither is rewritten.
      const publishEntries = history.filter(entry => entry.action === 'publish')
      assert.equal(publishEntries.length, 2)
      assert.equal(publishEntries[0]!.fromStatus, 'scheduled')
      assert.equal(publishEntries[1]!.fromStatus, 'draft')
      for (const entry of publishEntries) {
        assert.equal(entry.toStatus, 'published')
        assert.ok(entry.changedFields.includes('status'))
        assert.ok(entry.changedFields.includes('publishedAt'))
      }

      // Newest first, and the revisions stay in step with the stored record.
      for (let index = 1; index < history.length; index++) {
        assert.ok(history[index - 1]!.revision > history[index]!.revision)
      }
    })

    await check('the audit trail is site-scoped', async () => {
      assert.equal((await listContentAudit(Audit, OTHER_SITE, created.id, 50)).length, 0)
    })

    // A second record so pagination and filters have something to page through.
    await createContent(Content, SITE, pageDraft('pages/services', 'dich-vu'))
    for (let index = 0; index < 4; index++) {
      await createContent(Content, SITE, pageDraft(`posts/post-${index}`, `bai-viet-${index}`, { type: 'post' }))
    }

    await check('cursor pagination returns every record once', async () => {
      const seen: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const result = await listContent(Content, SITE, { limit: 2, cursor })
        seen.push(...result.data.map(entry => entry.id))
        if (!result.hasMore) break
        cursor = result.nextCursor ?? undefined
        assert.ok(cursor, 'hasMore must come with a cursor')
      }

      const total = await listContent(Content, SITE, { limit: 50 })
      assert.equal(seen.length, total.data.length)
      assert.equal(new Set(seen).size, seen.length, 'pages must not repeat a record')
    })

    await check('filters and counts are site-scoped and status-aware', async () => {
      // Four created posts plus the record updated to `post` earlier.
      const posts = await listContent(Content, SITE, { type: 'post', limit: 50 })
      assert.equal(posts.data.length, 5)
      assert.ok(posts.data.every(entry => entry.type === 'post'))

      const search = await listContent(Content, SITE, { q: 'dich-vu', limit: 50 })
      assert.equal(search.data.length, 1)
      assert.equal(search.data[0]!.key, 'pages/services')

      // Six records from the flows above plus the keyword page, which is back in draft.
      const counts = (await listContent(Content, SITE, { limit: 1 })).counts
      assert.equal(counts.all, 7)
      assert.equal(counts.draft, 7)
      assert.equal(counts.published, 0)
    })

    await check('an invalid cursor is a 422', async () => {
      await assert.rejects(
        () => listContent(Content, SITE, { cursor: 'not-an-id' }),
        isServiceError(422, 'CONTENT_CURSOR_INVALID'),
      )
    })
    await check('a retried create with the same Idempotency-Key runs once', async () => {
      const key = 'retry-create-key-01'
      const payload = pageDraft('pages/retry', 'thu-lai')
      let runs = 0

      const first = await executeIdempotent(
        { model: IdempotencyKey, siteId: SITE, action: 'content.create', key, payload },
        async () => {
          runs++
          const record = await createContent(Content, SITE, payload)
          return { statusCode: 201, value: { id: record.id } }
        },
      )

      const second = await executeIdempotent(
        { model: IdempotencyKey, siteId: SITE, action: 'content.create', key, payload },
        async () => {
          runs++
          throw new Error('the command must not run twice')
        },
      )

      assert.equal(runs, 1)
      assert.equal(first.replayed, false)
      assert.equal(second.replayed, true)
      assert.equal(second.statusCode, 201)
      assert.equal(second.value.id, first.value.id)
      assert.equal(await Content.countDocuments({ siteId: SITE, key: 'pages/retry' }), 1)
    })

    await check('the same Idempotency-Key with a different payload is a 409', async () => {
      await assert.rejects(
        () =>
          executeIdempotent(
            {
              model: IdempotencyKey,
              siteId: SITE,
              action: 'content.create',
              key: 'retry-create-key-01',
              payload: pageDraft('pages/other', 'khac'),
            },
            async () => ({ statusCode: 201, value: {} }),
          ),
        (error: unknown) =>
          error instanceof IdempotencyError && error.statusCode === 409 && error.code === 'IDEMPOTENCY_KEY_REUSED',
      )
    })

    await check('a malformed Idempotency-Key fails before any write', () => {
      assert.throws(
        () => normalizeIdempotencyKey('bad key with spaces'),
        (error: unknown) => error instanceof IdempotencyError && error.statusCode === 422,
      )
      assert.equal(normalizeIdempotencyKey(''), null)
      assert.equal(normalizeIdempotencyKey(undefined), null)
    })
    await check('every mutation captured an immutable revision snapshot', async () => {
      const revisions = await listContentRevisions(Revision, SITE, created.id, 50)
      assert.equal(revisions.length, 10)
      assert.deepEqual(
        revisions.map(entry => entry.revision),
        [10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      )
      assert.ok(revisions.every(entry => entry.actor.id === ACTOR.id))

      const first = revisions[revisions.length - 1]!
      assert.equal(first.action, 'create')
      assert.equal(first.status, 'draft')

      const updateEntry = revisions.find(entry => entry.revision === 2)!
      assert.equal(updateEntry.action, 'update')
      assert.ok(updateEntry.changedFields.includes('locales'))

      const current = await getContent(Content, SITE, created.id)
      const detail = await getContentRevision(Revision, SITE, created.id, 1, current)
      assert.ok(detail)
      assert.equal(detail.snapshot.locales[0]!.title, 'Tiêu đề gioi-thieu')
      assert.equal(detail.snapshot.locales[0]!.format, 'markdown')
      assert.ok(detail.diff.some(entry => entry.field === 'locales'))
      assert.ok(detail.diff.some(entry => entry.field === 'publishAt'))

      // The same snapshot against itself has no diff.
      const selfDiff = await getContentRevision(Revision, SITE, created.id, 1, detail.snapshot)
      assert.deepEqual(selfDiff?.diff, [])
    })

    await check('revision reads are site-scoped and unknown revisions are absent', async () => {
      assert.equal((await listContentRevisions(Revision, OTHER_SITE, created.id, 50)).length, 0)
      assert.equal(await getContentRevision(Revision, OTHER_SITE, created.id, 1), null)
      assert.equal(await getContentRevision(Revision, SITE, created.id, 99), null)
    })

    await check('restoring an old revision writes a new revision and an audit entry', async () => {
      const restored = await restoreContentRevision(Content, Revision, SITE, created.id, 2, 10, meta())

      assert.equal(restored.revision, 11)
      assert.equal(restored.status, 'draft')
      assert.equal(restored.locales.length, 2)
      assert.equal(restored.locales[1]!.title, 'About us')
      // The snapshot's window is restored, the publication state is not touched.
      assert.equal(restored.publishAt, null)

      const revisions = await listContentRevisions(Revision, SITE, created.id, 50)
      assert.equal(revisions[0]!.revision, 11)
      assert.equal(revisions[0]!.action, 'revert')

      const history = await listContentAudit(Audit, SITE, created.id, 50)
      assert.equal(history[0]!.action, 'revert')
      assert.equal(history[0]!.revision, 11)
      assert.equal(history[0]!.fromStatus, 'draft')
      assert.equal(history[0]!.toStatus, 'draft')
      assert.ok(history[0]!.changedFields.includes('publishAt'))
    })

    await check('a stale or pointless restore is rejected', async () => {
      await assert.rejects(
        () => restoreContentRevision(Content, Revision, SITE, created.id, 1, 10, meta()),
        isServiceError(409, 'CONTENT_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => restoreContentRevision(Content, Revision, SITE, created.id, 11, 11, meta()),
        isServiceError(422, 'CONTENT_REVISION_CURRENT'),
      )
      await assert.rejects(
        () => restoreContentRevision(Content, Revision, SITE, created.id, 99, 11, meta()),
        isServiceError(404, 'CONTENT_REVISION_NOT_FOUND'),
      )
    })

    await check('a tag filter narrows the list without another site or status leaking in', async () => {
      const tagged = await createContent(Content, SITE, pageDraft('posts/uu-dai-he', 'uu-dai-he', {
        type: 'post',
        tags: ['mua-he', 'sale'],
      }))
      await createContent(Content, SITE, pageDraft('posts/kong-he', 'khong-he', { type: 'post', tags: ['sale'] }))
      await createContent(Content, OTHER_SITE, pageDraft('posts/uu-dai-he', 'uu-dai-he', {
        type: 'post',
        tags: ['mua-he'],
      }))

      const summer = await listContent(Content, SITE, { tag: 'mua-he', limit: 50 })
      assert.deepEqual(summer.data.map(entry => entry.id), [tagged.id])

      const sale = await listContent(Content, SITE, { tag: 'sale', limit: 50 })
      assert.equal(sale.data.length, 2)

      // Padded input must match, because the record stores the tag trimmed.
      const padded = await listContent(Content, SITE, { tag: '  mua-he  ', limit: 50 })
      assert.equal(padded.data.length, 1)

      const combined = await listContent(Content, SITE, { tag: 'sale', status: 'draft', limit: 50 })
      assert.equal(combined.data.length, 2)
      const otherStatus = await listContent(Content, SITE, { tag: 'sale', status: 'published', limit: 50 })
      assert.equal(otherStatus.data.length, 0)

      const none = await listContent(Content, SITE, { tag: 'khong-ton-tai', limit: 50 })
      assert.equal(none.data.length, 0)
      // Counts stay whole-site, matching every other filter.
      const unfiltered = await listContent(Content, SITE, { limit: 1 })
      assert.deepEqual(none.counts, unfiltered.counts)
    })

    await check('a keyword filter matches one stored keyword exactly, in any locale', async () => {
      const keywordPost = await createContent(Content, SITE, {
        type: 'post',
        key: 'posts/tu-khoa-loc',
        locales: [
          { locale: 'vi', title: 'Lọc từ khóa', slug: 'loc-tu-khoa', keywords: ['loc-tu-khoa', 'loc-qua-tang'] },
          { locale: 'en', title: 'Keyword filter', slug: 'keyword-filter', keywords: ['loc-jewellery'] },
        ],
      })
      await createContent(Content, OTHER_SITE, {
        type: 'post',
        key: 'posts/tu-khoa-loc',
        locales: [{ locale: 'vi', title: 'Khác site', slug: 'loc-tu-khoa', keywords: ['loc-tu-khoa'] }],
      })

      const exact = await listContent(Content, SITE, { keyword: 'loc-tu-khoa', limit: 50 })
      assert.deepEqual(exact.data.map(entry => entry.id), [keywordPost.id])

      // Free text keeps its casing, so the uppercase spelling is a different value.
      const upper = await listContent(Content, SITE, { keyword: 'LOC-TU-KHOA', limit: 50 })
      assert.equal(upper.data.length, 0)

      // A keyword stored on the `en` locale is found through the same dotted path.
      const english = await listContent(Content, SITE, { keyword: 'loc-jewellery', limit: 50 })
      assert.deepEqual(english.data.map(entry => entry.id), [keywordPost.id])

      // The service trims the typed value, like the tag filter does.
      const padded = await listContent(Content, SITE, { keyword: '  loc-qua-tang  ', limit: 50 })
      assert.equal(padded.data.length, 1)

      // Free-text search covers keywords as well as key/title/slug.
      const search = await listContent(Content, SITE, { q: 'loc-jewellery', limit: 50 })
      assert.deepEqual(search.data.map(entry => entry.id), [keywordPost.id])
    })

    await check('an attribute filter matches the exact name and a typed value', async () => {
      const gold = await createContent(Content, SITE, {
        type: 'page',
        key: 'pages/thuoc-tinh-vang',
        attributes: { material: 'gold', weight: 5, featured: true, 'meta.series': 'heritage' },
        locales: [{ locale: 'vi', title: 'Vàng', slug: 'thuoc-tinh-vang' }],
      })
      await createContent(Content, SITE, {
        type: 'page',
        key: 'pages/thuoc-tinh-bac',
        attributes: { material: 'silver', weight: 2 },
        locales: [{ locale: 'vi', title: 'Bạc', slug: 'thuoc-tinh-bac' }],
      })
      await createContent(Content, OTHER_SITE, {
        type: 'page',
        key: 'pages/thuoc-tinh-vang',
        attributes: { material: 'gold' },
        locales: [{ locale: 'vi', title: 'Site khác', slug: 'thuoc-tinh-vang' }],
      })

      // Name only: "has this attribute", whatever its value.
      const present = await listContent(Content, SITE, { attributeKey: 'material', limit: 50 })
      assert.equal(present.data.length, 2)
      assert.ok(present.data.some(entry => entry.id === gold.id))

      const equals = await listContent(Content, SITE, { attributeKey: 'material', attributeValue: 'gold', limit: 50 })
      assert.deepEqual(equals.data.map(entry => entry.id), [gold.id])

      // Numbers and booleans are compared as text, so the editor can type 5 or true.
      const numeric = await listContent(Content, SITE, { attributeKey: 'weight', attributeValue: '5', limit: 50 })
      assert.deepEqual(numeric.data.map(entry => entry.id), [gold.id])

      const boolean = await listContent(Content, SITE, { attributeKey: 'featured', attributeValue: 'true', limit: 50 })
      assert.deepEqual(boolean.data.map(entry => entry.id), [gold.id])

      // A key that contains a dot is addressed by name, not as a nested path.
      const dotted = await listContent(Content, SITE, { attributeKey: 'meta.series', attributeValue: 'heritage', limit: 50 })
      assert.deepEqual(dotted.data.map(entry => entry.id), [gold.id])

      // An unknown name, a wrong value and the other site's record all stay out.
      assert.equal((await listContent(Content, SITE, { attributeKey: 'unknown', limit: 50 })).data.length, 0)
      assert.equal((await listContent(Content, SITE, { attributeKey: 'material', attributeValue: 'bronze', limit: 50 })).data.length, 0)
    })

    // Runs last: it creates records, and the filters above assert exact counts.
    await check('a published slug change leaves a 301 behind, a draft rename leaves nothing', async () => {
      const page = await createContent(Content, SITE, pageDraft('pages/doi-ten', 'ten-cu'), metaR())
      await runContentEvent(Content, SITE, page.id, { event: 'publish', revision: 1 }, NOW, metaR())

      const renamed = await updateContent(Content, SITE, page.id, {
        revision: 2,
        type: 'page',
        locales: [{ locale: 'vi', title: 'Tên mới', slug: 'ten-moi' }],
      }, metaR())
      assert.equal(renamed.locales[0]!.slug, 'ten-moi')

      // The immutable key path (`/pages/ten-cu`) keeps working, so the row is the
      // short URL that the rename actually broke.
      const row = await Redirect.findOne({ siteId: SITE, from: '/ten-cu' }).lean()
      assert.equal(row?.to, '/ten-moi')
      assert.equal(row?.statusCode, 301)
      assert.equal(row?.isActive, true)
      assert.equal(row?.note, AUTO_SLUG_REDIRECT_NOTE)

      // A human mapping already on the old path is more specific than ours, so
      // the next rename leaves it (and its 302) alone.
      await Redirect.create({
        siteId: SITE,
        from: '/ten-moi',
        to: '/gioi-thieu',
        statusCode: 302,
        isActive: true,
        note: 'typed by hand',
        revision: 1,
      })
      await updateContent(Content, SITE, page.id, {
        revision: 3,
        type: 'page',
        locales: [{ locale: 'vi', title: 'Tên ba', slug: 'ten-ba' }],
      }, metaR())
      const kept = await Redirect.findOne({ siteId: SITE, from: '/ten-moi' }).lean()
      assert.equal(kept?.to, '/gioi-thieu')
      assert.equal(kept?.statusCode, 302)

      // A draft was never reachable, so renaming it writes no row.
      const draft = await createContent(Content, SITE, pageDraft('pages/nhap', 'nhap-cu'), metaR())
      await updateContent(Content, SITE, draft.id, {
        revision: 1,
        type: 'page',
        locales: [{ locale: 'vi', title: 'Nháp', slug: 'nhap-moi' }],
      }, metaR())
      assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/nhap-cu' }), 0)

      // A slug edited in one locale only maps that locale's old path; a newly
      // added locale has no URL to preserve, and another site sees no rows.
      await updateContent(Content, SITE, page.id, {
        revision: 4,
        type: 'page',
        locales: [
          { locale: 'vi', title: 'Tên bốn', slug: 'ten-bon' },
          { locale: 'en', title: 'Name four', slug: 'name-four' },
        ],
      }, metaR())
      assert.equal((await Redirect.findOne({ siteId: SITE, from: '/ten-ba' }).lean())?.to, '/ten-bon')
      assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/name-four' }), 0)
      assert.equal(await Redirect.countDocuments({ siteId: OTHER_SITE }), 0)

      // A slug that names a real storefront route was never reachable there, so
      // renaming it must not create a row that hijacks that route.
      const reserved = await createContent(Content, SITE, pageDraft('pages/products', 'products'), metaR())
      await runContentEvent(Content, SITE, reserved.id, { event: 'publish', revision: 1 }, NOW, metaR())
      await updateContent(Content, SITE, reserved.id, {
        revision: 2,
        type: 'page',
        locales: [{ locale: 'vi', title: 'Sản phẩm', slug: 'san-pham' }],
      }, metaR())
      assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/products' }), 0)
    })


  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Content service checks: ${checks} passed, ${notRun} not run\n`)
