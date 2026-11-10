import assert from 'node:assert/strict'
import { connectMongo } from '../../tm-web/server/utils/mongo.js'
import {
  PUBLIC_CONTENT_LIST_PROJECTION,
  PUBLIC_CONTENT_PROJECTION,
  PUBLIC_CONTENT_SITEMAP_FIELDS,
  PublicContentModel,
  buildPublishedContentFilter,
  buildPublishedListFilter,
  escapePublicSearchTerm,
  toPublicContent,
  toPublicContentEntry,
  toPublicContentListItem,
} from '../../tm-web/server/models/contentPublic.js'
import {
  PublicCategoryModel,
  buildCategorySlugFilter,
  toPublicContentCategory,
} from '../../tm-web/server/models/contentCategoryPublic.js'

/**
 * Live checks for the storefront public read policy against a real MongoDB.
 * They prove the query (not just the in-memory guard) hides drafts, scheduled
 * records, expired windows, other locales and deleted rows.
 */

const DB_NAME = 'tm_test_public_content'
const URI = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const NOW = new Date('2026-11-06T10:00:00.000Z')

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

function localeEntry(locale: string, slug: string, title: string, keywords: string[] = []) {
  return {
    locale,
    slug,
    title,
    excerpt: `${title} excerpt`,
    body: `# ${title}`,
    format: 'markdown',
    keywords,
    seo: { title: '', description: '', image: '' },
  }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    siteId: 'sentuan',
    type: 'page',
    key: 'pages/gioi-thieu',
    status: 'published',
    locales: [
      localeEntry('vi', 'gioi-thieu', 'Giới thiệu', ['nhan-hieu-ben-vung']),
      localeEntry('en', 'about-us', 'About us', ['jewelry-care']),
    ],
    categories: ['pages'],
    tags: ['brand'],
    attributes: {},
    publishAt: null,
    unpublishAt: null,
    publishedAt: new Date('2026-11-05T08:00:00.000Z'),
    deletedAt: null,
    revision: 3,
    schemaVersion: 1,
    createdAt: new Date('2026-11-01T08:00:00.000Z'),
    updatedAt: new Date('2026-11-05T08:00:00.000Z'),
    ...overrides,
  }
}

async function seedCategories() {
  await PublicCategoryModel.collection.deleteMany({})
  await PublicCategoryModel.collection.insertMany([
    {
      key: 'trang-suc',
      parent: null,
      order: 1,
      locales: [
        { locale: 'vi', name: 'Trang sức', slug: 'trang-suc' },
        { locale: 'en', name: 'Jewelry', slug: 'jewelry' },
      ],
    },
    {
      key: 'chi-viet',
      parent: 'trang-suc',
      order: 2,
      locales: [{ locale: 'vi', name: 'Chỉ tiếng Việt', slug: 'chi-viet' }],
    },
  ])
}

async function findCategoryBySlug(slug: string, locale = 'vi') {
  const candidates = locale === 'vi' ? ['vi'] : [locale, 'vi']
  return PublicCategoryModel.findOne(
    buildCategorySlugFilter({ slug, localeIn: candidates }),
  ).lean()
}

async function searchPublished(q: string, locale = 'vi', extra: Record<string, unknown> = {}) {
  const docs = await PublicContentModel.find(
    buildPublishedListFilter({ localeIn: [locale], q, now: NOW, ...extra }),
    PUBLIC_CONTENT_LIST_PROJECTION,
  ).lean()
  return docs
    .map(doc => toPublicContentListItem(doc as never, locale, NOW)?.key)
    .filter((key): key is string => typeof key === 'string')
    .sort()
}

async function seed() {
  await PublicContentModel.collection.deleteMany({})
  await PublicContentModel.collection.insertMany([
    record(),
    record({
      key: 'pages/nhap',
      status: 'draft',
      locales: [localeEntry('vi', 'nhap', 'Bản nháp', ['nhan-hieu-nhap'])],
      revision: 1,
    }),
    record({
      key: 'pages/hen-gio',
      status: 'scheduled',
      publishAt: new Date('2026-12-01T00:00:00.000Z'),
      locales: [localeEntry('vi', 'hen-gio', 'Hẹn giờ')],
    }),
    record({
      key: 'pages/het-han',
      unpublishAt: new Date('2026-11-05T00:00:00.000Z'),
      locales: [localeEntry('vi', 'het-han', 'Hết hạn')],
    }),
    record({
      key: 'pages/da-xoa',
      deletedAt: new Date('2026-11-04T00:00:00.000Z'),
      locales: [localeEntry('vi', 'da-xoa', 'Đã xóa')],
    }),
    record({
      key: 'pages/chi-en',
      locales: [localeEntry('en', 'english-only', 'English only')],
    }),
    record({ key: 'pages/tin-tuc', type: 'post', locales: [localeEntry('vi', 'tin-tuc', 'Tin tức')] }),
  ])
}

async function findByPath(path: string, locale = 'vi') {
  return PublicContentModel.findOne(
    buildPublishedContentFilter({ locale, keyOrSlug: path, now: NOW }),
    PUBLIC_CONTENT_PROJECTION,
  ).lean()
}

async function main() {
  console.log('Testing storefront public content reader against MongoDB...\n')

  let connection
  try {
    connection = await connectMongo({ uri: URI, database: DB_NAME })
  } catch (error) {
    notRun++
    console.error(`   ⏭️  skipped: cannot reach MongoDB (${(error as Error).message})`)
    console.log(`\n⚠️ ${checks} public content reader checks passed, ${notRun} not run`)
    return
  }

  try {
    await seed()
    await seedCategories()

    console.log('1. Resolution by key and by locale slug')
    await check('resolves a published record by its content key', async () => {
      const doc = await findByPath('pages/gioi-thieu')
      const content = doc ? toPublicContent(doc as never, 'vi', NOW) : null
      assert.equal(content?.title, 'Giới thiệu')
      assert.equal(content?.key, 'pages/gioi-thieu')
    })

    await check('resolves the same record by its vi slug', async () => {
      const doc = await findByPath('gioi-thieu')
      assert.equal(toPublicContent((doc ?? {}) as never, 'vi', NOW)?.slug, 'gioi-thieu')
    })

    await check('returns the requested locale and its own slug', async () => {
      const doc = await findByPath('pages/gioi-thieu', 'en')
      const content = doc ? toPublicContent(doc as never, 'en', NOW) : null
      assert.equal(content?.title, 'About us')
      assert.equal(content?.slug, 'about-us')
      assert.equal(content?.locale, 'en')
    })

    await check('does not resolve a locale the record lacks', async () => {
      assert.equal(await findByPath('pages/chi-en', 'vi'), null)
      assert.equal(await findByPath('pages/gioi-thieu', 'fr'), null)
    })

    console.log('\n2. Non-public records never resolve')
    await check('draft, scheduled and expired records are not readable', async () => {
      assert.equal(await findByPath('pages/nhap'), null)
      assert.equal(await findByPath('pages/hen-gio'), null)
      assert.equal(await findByPath('pages/het-han'), null)
    })

    await check('soft-deleted records are not readable', async () => {
      assert.equal(await findByPath('pages/da-xoa'), null)
    })

    await check('the in-memory guard also rejects a stale published record', () => {
      assert.equal(toPublicContent(record({ status: 'draft' }) as never, 'vi', NOW), null)
      assert.equal(
        toPublicContent(record({ publishAt: new Date('2026-12-01T00:00:00.000Z') }) as never, 'vi', NOW),
        null,
      )
      assert.equal(
        toPublicContent(record({ unpublishAt: new Date('2026-11-05T00:00:00.000Z') }) as never, 'vi', NOW),
        null,
      )
      assert.equal(toPublicContent(record({ deletedAt: new Date() }) as never, 'vi', NOW), null)
    })

    console.log('\n3. Public projection is an allowlist')
    await check('a public record exposes no status, revision or schedule fields', async () => {
      const doc = await findByPath('pages/gioi-thieu')
      const content = toPublicContent((doc ?? {}) as never, 'vi', NOW)
      assert.ok(content)
      const keys = Object.keys(content).sort()
      assert.deepEqual(keys, [
        'body',
        'categories',
        'excerpt',
        'format',
        'key',
        'keywords',
        'locale',
        'publishedAt',
        'seo',
        'slug',
        'tags',
        'title',
        'type',
        'updatedAt',
      ])
      assert.ok(!('status' in content))
      assert.ok(!('revision' in content))
      assert.ok(!('publishAt' in content))
    })

    await check('the projection selects what the guard needs and nothing else', () => {
      const fields = PUBLIC_CONTENT_PROJECTION.split(' ')
      // Needed to decide visibility and to build the public record.
      for (const field of ['key', 'type', 'status', 'locales', 'publishAt', 'unpublishAt', 'publishedAt', 'deletedAt', 'updatedAt']) {
        assert.ok(fields.includes(field), `projection is missing ${field}`)
      }
      // Never selected: internal bookkeeping that no visitor may receive.
      for (const field of ['revision', 'siteId', 'attributes', 'createdAt', 'schemaVersion']) {
        assert.ok(!fields.includes(field), `projection should not select ${field}`)
      }
    })

    console.log('\n4. Sitemap entries')
    await check('sitemap lists only public keys with an updatedAt', async () => {
      const docs = await PublicContentModel.find(
        buildPublishedContentFilter({ locale: 'vi', now: NOW }),
        PUBLIC_CONTENT_SITEMAP_FIELDS,
      ).lean()
      const entries = docs
        .map(doc => toPublicContentEntry(doc as never, NOW))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

      assert.deepEqual(entries.map(entry => entry.key).sort(), ['pages/gioi-thieu', 'pages/tin-tuc'])
      assert.ok(entries.every(entry => entry.updatedAt === '2026-11-05T08:00:00.000Z'))
    })

    await check('sitemap excludes records without the requested locale', async () => {
      const docs = await PublicContentModel.find(
        buildPublishedContentFilter({ locale: 'en', now: NOW }),
        PUBLIC_CONTENT_SITEMAP_FIELDS,
      ).lean()
      const keys = docs.map(doc => toPublicContentEntry(doc as never, NOW)?.key)
      assert.deepEqual(keys.sort(), ['pages/chi-en', 'pages/gioi-thieu'])
    })

    await check('sitemap query without a locale lists every public record once', async () => {
      const docs = await PublicContentModel.find(
        buildPublishedContentFilter({ now: NOW }),
        PUBLIC_CONTENT_SITEMAP_FIELDS,
      ).lean()
      const keys = docs
        .map(doc => toPublicContentEntry(doc as never, NOW)?.key)
        .filter(Boolean)
        .sort()
      assert.deepEqual(keys, ['pages/chi-en', 'pages/gioi-thieu', 'pages/tin-tuc'])
    })
    console.log('\n5. Bounded public search')
    await check('search matches the localized title, slug and excerpt case-insensitively', async () => {
      assert.deepEqual(await searchPublished('tin'), ['pages/tin-tuc'])
      assert.deepEqual(await searchPublished('TIN TỨC'), ['pages/tin-tuc'])
      assert.deepEqual(await searchPublished('gioi-thieu'), ['pages/gioi-thieu'])
    })

    await check('search treats regex metacharacters as literal text', async () => {
      assert.equal(escapePublicSearchTerm('.*'), '\\.\\*')
      assert.deepEqual(await searchPublished('.*'), [])
      assert.deepEqual(await searchPublished('['), [])
    })

    await check('search keeps the public policy and combines with facets', async () => {
      // Drafts and records of another locale never surface, even when the term matches.
      assert.deepEqual(await searchPublished('nhap'), [])
      assert.deepEqual(await searchPublished('english', 'vi'), [])
      assert.deepEqual(await searchPublished('gioi', 'vi', { tag: 'brand' }), ['pages/gioi-thieu'])
      assert.deepEqual(await searchPublished('gioi', 'vi', { tag: 'other' }), [])
    })

    await check('search matches a keyword only inside the requested locale', async () => {
      assert.deepEqual(await searchPublished('nhan-hieu-ben-vung'), ['pages/gioi-thieu'])
      assert.deepEqual(await searchPublished('NHAN-HIEU-BEN-VUNG'), ['pages/gioi-thieu'])
      // `jewelry-care` is stored on the `en` entry of the same record only.
      assert.deepEqual(await searchPublished('jewelry-care', 'vi'), [])
      assert.deepEqual(await searchPublished('jewelry-care', 'en'), ['pages/gioi-thieu'])
      // A keyword on a draft never becomes a public result.
      assert.deepEqual(await searchPublished('nhan-hieu-nhap'), [])
    })

    console.log('\n6. Content category landing pages')
    await check('resolves a category by its locale slug', async () => {
      const doc = await findCategoryBySlug('trang-suc')
      const category = doc ? toPublicContentCategory(doc as never, 'vi') : null
      assert.equal(category?.key, 'trang-suc')
      assert.equal(category?.name, 'Trang sức')
      assert.equal(category?.slug, 'trang-suc')
      assert.equal(category?.parent, null)
    })

    await check('resolves the requested locale slug and keeps the key', async () => {
      const doc = await findCategoryBySlug('jewelry', 'en')
      const category = doc ? toPublicContentCategory(doc as never, 'en') : null
      assert.equal(category?.key, 'trang-suc')
      assert.equal(category?.name, 'Jewelry')
      assert.equal(category?.locale, 'en')
    })

    await check('falls back to vi for a category that has no requested locale', async () => {
      const doc = await findCategoryBySlug('chi-viet', 'en')
      const category = doc ? toPublicContentCategory(doc as never, 'vi') : null
      assert.equal(category?.key, 'chi-viet')
      assert.equal(category?.parent, 'trang-suc')
    })

    await check('an unknown category slug resolves to nothing', async () => {
      assert.equal(await findCategoryBySlug('khong-ton-tai'), null)
    })
  } finally {
    await connection.connection.dropDatabase().catch(() => undefined)
    await connection.disconnect().catch(() => undefined)
  }

  console.log(`\n${process.exitCode ? '⚠️' : '🎉'} ${checks} public content reader checks passed${process.exitCode ? ' (with failures)' : `, ${notRun} not run`}!`)
  if (process.exitCode) process.exit(process.exitCode)
}

await main()
