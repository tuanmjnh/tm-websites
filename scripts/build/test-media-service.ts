import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MediaServiceError,
  createMedia,
  deleteMedia,
  findMediaByKey,
  listMedia,
  updateMedia,
} from '../../tm-cms/server/services/mediaService.js'
import {
  MediaInvariantError,
  assertUploadAllowed,
  mediaStorageKey,
  normalizeFolder,
  sanitizeOriginalName,
} from '../../tm-cms/server/models/media.js'
import { createContent, updateContent } from '../../tm-cms/server/services/contentService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import { mediaRoot } from '../../tm-cms/server/utils/mediaStorage.js'

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

function isMediaError(status: number, code: string) {
  return (error: unknown) => error instanceof MediaServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ORIGIN = 'http://localhost:4005'
const UPLOADER = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

console.log('Media — library commands (live MongoDB + local storage)\n')

await check('rejects a type the public route may not serve', () => {
  assert.throws(() => assertUploadAllowed({ mimeType: 'text/html', size: 10 }), (error: unknown) => {
    return error instanceof MediaInvariantError && error.code === 'MEDIA_TYPE_NOT_ALLOWED'
  })
  assert.throws(() => assertUploadAllowed({ mimeType: 'image/svg+xml', size: 10 }), (error: unknown) => {
    return error instanceof MediaInvariantError && error.code === 'MEDIA_TYPE_NOT_ALLOWED'
  })
})

await check('rejects empty and oversized uploads', () => {
  assert.throws(() => assertUploadAllowed({ mimeType: 'image/png', size: 0 }), (error: unknown) => {
    return error instanceof MediaInvariantError && error.code === 'MEDIA_EMPTY'
  })
  assert.throws(() => assertUploadAllowed({ mimeType: 'image/png', size: 5 * 1024 * 1024 + 1 }), (error: unknown) => {
    return error instanceof MediaInvariantError && error.code === 'MEDIA_SIZE_EXCEEDED'
  })
})

await check('normalizes folders and strips paths from the upload name', () => {
  assert.equal(normalizeFolder('Landing / Hero'), 'landing/hero')
  assert.equal(normalizeFolder('Trang sức'), 'trang-suc')
  assert.equal(normalizeFolder(''), '')
  assert.equal(sanitizeOriginalName('../../etc/passwd'), 'passwd')
  assert.equal(sanitizeOriginalName('C:\\Users\\me\\Ảnh đại diện.png'), 'Ảnh đại diện.png')
})

await check('storage keys are site-scoped, dated and safe', () => {
  const key = mediaStorageKey(SITE, 'image/png', new Date('2026-03-04T00:00:00Z'))
  assert.match(key, /^sentuan\/2026\/[a-f0-9-]{36}\.png$/)
  assert.throws(() => mediaStorageKey('Bad Site', 'image/png'))
})

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_media_service' }
const previousMediaDir = process.env.TM_MEDIA_DIR
const mediaDir = await mkdtemp(join(tmpdir(), 'tm-media-test-'))
process.env.TM_MEDIA_DIR = mediaDir

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
    const { Media, Content, Audit, Revision } = await prepareDatabase(connection)
    const meta = { model: Audit, actor: { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' } }

    const hero = await createMedia(Media, SITE, ORIGIN, {
      body: PNG,
      mimeType: 'image/png',
      originalName: 'anh-dai-dien.png',
      folder: 'Landing / Hero',
      uploader: UPLOADER,
    }, meta)

    await check('create stores metadata, bytes and one audit entry', async () => {
      assert.equal(hero.kind, 'image')
      assert.equal(hero.mimeType, 'image/png')
      assert.equal(hero.size, PNG.length)
      assert.equal(hero.folder, 'landing/hero')
      assert.equal(hero.revision, 1)
      // No title supplied: the sanitized upload name becomes the display title.
      assert.equal(hero.title, 'anh-dai-dien.png')
      assert.match(hero.url, /^http:\/\/localhost:4005\/media\/sentuan\/\d{4}\/[a-f0-9-]{36}\.png$/)

      const key = hero.url.replace(`${ORIGIN}/media/`, '')
      assert.ok(existsSync(join(mediaRoot(), key)), 'the file is written under the media root')

      const entries = await Audit.find({ siteId: SITE, resourceType: 'media', resourceId: hero.id }).lean()
      assert.equal(entries.length, 1)
      assert.equal(entries[0]!.action, 'create')
      assert.deepEqual(entries[0]!.changedFields, ['originalName', 'mimeType', 'size', 'folder'])
    })

    await check('the public lookup resolves only the owning site', async () => {
      const key = hero.url.replace(`${ORIGIN}/media/`, '')
      assert.ok(await findMediaByKey(Media, SITE, key))
      assert.equal(await findMediaByKey(Media, OTHER_SITE, key), null)
    })

    const pdf = await createMedia(Media, SITE, ORIGIN, {
      body: Buffer.from('%PDF-1.4 test'),
      mimeType: 'application/pdf',
      originalName: 'bang-gia.pdf',
      title: 'Bảng giá 2026',
      folder: 'landing',
      uploader: UPLOADER,
    }, meta)

    await check('list filters by kind, folder and search, newest first', async () => {
      const all = await listMedia(Media, SITE, ORIGIN)
      assert.equal(all.data.length, 2)
      assert.equal(all.data[0]!.id, pdf.id)
      assert.deepEqual(all.counts, { all: 2, image: 1, document: 1 })
      assert.deepEqual(all.folders, ['landing', 'landing/hero'])

      const images = await listMedia(Media, SITE, ORIGIN, { kind: 'image' })
      assert.deepEqual(images.data.map(entry => entry.id), [hero.id])

      const landing = await listMedia(Media, SITE, ORIGIN, { folder: 'landing' })
      assert.deepEqual(landing.data.map(entry => entry.id), [pdf.id])

      const root = await listMedia(Media, SITE, ORIGIN, { folder: 'root' })
      assert.equal(root.data.length, 0)

      const search = await listMedia(Media, SITE, ORIGIN, { q: 'giá' })
      assert.deepEqual(search.data.map(entry => entry.id), [pdf.id])

      const paged = await listMedia(Media, SITE, ORIGIN, { limit: 1 })
      assert.equal(paged.data.length, 1)
      assert.equal(paged.hasMore, true)
      const next = await listMedia(Media, SITE, ORIGIN, { limit: 1, cursor: paged.nextCursor! })
      assert.deepEqual(next.data.map(entry => entry.id), [hero.id])
      assert.equal(next.hasMore, false)
      assert.equal(next.nextCursor, null)
    })

    await check('update bumps the revision, records changed fields and rejects a stale tab', async () => {
      const updated = await updateMedia(Media, SITE, ORIGIN, hero.id, {
        title: 'Ảnh đại diện',
        alt: 'Nhẫn vàng',
        revision: hero.revision,
      }, meta)

      assert.equal(updated.revision, 2)
      assert.equal(updated.title, 'Ảnh đại diện')
      assert.equal(updated.alt, 'Nhẫn vàng')

      const entries = await Audit.find({ siteId: SITE, resourceType: 'media', resourceId: hero.id, action: 'update' }).lean()
      assert.equal(entries.length, 1)
      assert.deepEqual(entries[0]!.changedFields, ['title', 'alt'])

      await assert.rejects(
        () => updateMedia(Media, SITE, ORIGIN, hero.id, { title: 'Khác', revision: 1 }, meta),
        isMediaError(409, 'MEDIA_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => updateMedia(Media, SITE, ORIGIN, hero.id, { title: 'Ảnh đại diện', revision: 2 }, meta),
        isMediaError(422, 'MEDIA_UPDATE_UNCHANGED'),
      )
      await assert.rejects(
        () => updateMedia(Media, OTHER_SITE, ORIGIN, hero.id, { title: 'Khác', revision: 2 }, meta),
        isMediaError(404, 'MEDIA_NOT_FOUND'),
      )
    })

    await check('delete is refused while a live content record references the file', async () => {
      const content = await createContent(Content, SITE, {
        type: 'page',
        key: 'pages/media-probe',
        locales: [{ locale: 'vi', slug: 'media-probe', title: 'Media probe' }],
      })
      assert.deepEqual(content.media, [])

      const attached = await updateContent(Content, SITE, content.id, {
        type: 'page',
        locales: [{ locale: 'vi', slug: 'media-probe', title: 'Media probe' }],
        media: [hero.id],
        revision: content.revision,
      })
      assert.deepEqual(attached.media, [hero.id])

      await assert.rejects(
        () => deleteMedia({ media: Media, content: Content }, SITE, hero.id, 2, meta),
        isMediaError(422, 'MEDIA_IN_USE'),
      )

      const detached = await updateContent(Content, SITE, content.id, {
        type: 'page',
        locales: [{ locale: 'vi', slug: 'media-probe', title: 'Media probe' }],
        media: [],
        revision: attached.revision,
      })
      assert.deepEqual(detached.media, [])
    })

    await check('delete removes the row and the stored bytes, and audits the removal', async () => {
      const key = hero.url.replace(`${ORIGIN}/media/`, '')
      await deleteMedia({ media: Media, content: Content }, SITE, hero.id, 2, meta)

      assert.equal(await Media.countDocuments({ _id: hero.id }), 0)
      assert.equal(existsSync(join(mediaRoot(), key)), false)
      assert.equal(await findMediaByKey(Media, SITE, key), null)

      const entries = await Audit.find({ siteId: SITE, resourceType: 'media', resourceId: hero.id, action: 'delete' }).lean()
      assert.equal(entries.length, 1)

      await assert.rejects(
        () => deleteMedia({ media: Media, content: Content }, SITE, pdf.id, 99, meta),
        isMediaError(409, 'MEDIA_REVISION_CONFLICT'),
      )

      await updateContent(Content, SITE, (await Content.findOne({ siteId: SITE, key: 'pages/media-probe' }).lean<any>())!._id.toString(), {
        type: 'page',
        locales: [{ locale: 'vi', slug: 'media-probe', title: 'Media probe' }],
        media: [pdf.id],
        revision: 3,
      })
      await assert.rejects(
        () => deleteMedia({ media: Media, content: Content }, SITE, pdf.id, 1, meta),
        isMediaError(422, 'MEDIA_IN_USE'),
      )

      const remaining = await listMedia(Media, SITE, ORIGIN)
      assert.deepEqual(remaining.data.map(entry => entry.id), [pdf.id])
      assert.deepEqual(remaining.counts, { all: 1, image: 0, document: 1 })
    })

    await check('a rejected upload leaves neither metadata nor bytes behind', async () => {
      const before = await Media.countDocuments({ siteId: SITE })
      await assert.rejects(
        () => createMedia(Media, SITE, ORIGIN, {
          body: Buffer.from('<svg/>'),
          mimeType: 'image/svg+xml',
          originalName: 'logo.svg',
          uploader: UPLOADER,
        }, meta),
        isMediaError(422, 'MEDIA_TYPE_NOT_ALLOWED'),
      )
      assert.equal(await Media.countDocuments({ siteId: SITE }), before)
    })

    await Content.deleteMany({ siteId: SITE })
    await Media.deleteMany({ siteId: SITE })
    await Audit.deleteMany({ siteId: SITE })
    await Revision.deleteMany({ siteId: SITE })
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
  console.error('Media checks failed')
}
