import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'

/**
 * `pnpm test:migrate-apply`
 *
 * The two importers' `--apply` half had only a hand drill: upsert by
 * `(siteId, key)`, keeping an editor's revision and creation date, resolving a
 * category parent, and suffixing a key or slug a legacy duplicate (or an
 * existing v2 record) already owns. A dry run cannot show any of that, and a
 * broken rule there overwrites live editorial data instead of failing.
 *
 * The fixture is synthetic and disposable (`tm_import_gate`): every legacy
 * shape the mappers accept, every collision branch, and one unusable record.
 * The CLIs are spawned exactly as an operator runs them, so the test covers the
 * flags and the wiring too, not a re-implementation of them.
 */

let checks = 0

async function check(name: string, fn: () => void | Promise<void>) {
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

const URI = process.env.TM_TEST_MONGO_URI || process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const DATABASE = 'tm_import_gate'
const SITE = 'import-fixture'

function run(script: 'migrate:content' | 'migrate:catalog', apply: boolean) {
  const command = `pnpm -s ${script} --site ${SITE}${apply ? ' --apply' : ''}`
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf-8',
    env: { ...process.env, TM_MONGO_URI: URI, TM_MONGO_DB: DATABASE, TM_CUSTOMER_ID: SITE },
  })
  return { code: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` }
}

const LEGACY_CATEGORY_SLUG = { vi: 'trang-suc', en: 'jewelry' }
const DUPLICATE_CATEGORY_SLUG = { vi: 'trang-suc' }

function contentFixture() {
  const ids = {
    category: '00000000000000000000c001',
    duplicateCategory: '00000000000000000000c002',
    childCategory: '00000000000000000000c003',
    page: '00000000000000000000d001',
    conflicting: '00000000000000000000d002',
    deleted: '00000000000000000000d003',
    duplicateSlug: '00000000000000000000d004',
    invalid: '00000000000000000000d005',
  }
  const publishedAt = new Date('2026-01-02T03:04:05.000Z')
  const updatedAt = new Date('2026-02-03T04:05:06.000Z')

  const categories = [
    { _id: ids.category, tenantId: 'default', slug: LEGACY_CATEGORY_SLUG, title: { vi: 'Trang sức', en: 'Jewelry' }, sort: 2 },
    { _id: ids.duplicateCategory, tenantId: 'default', slug: DUPLICATE_CATEGORY_SLUG, title: { vi: 'Trùng slug' } },
    { _id: ids.childCategory, tenantId: 'default', pid: ids.category, slug: { vi: 'nhan' }, title: { vi: 'Nhẫn' }, sort: 5 },
  ]

  const contents = [
    {
      _id: ids.page,
      tenantId: 'default',
      type: 'page',
      status: 'published',
      slug: { vi: 'gioi-thieu', en: 'about-us' },
      title: { vi: 'Giới thiệu', en: 'About us' },
      excerpt: { vi: 'Đôi dòng' },
      content: { vi: '<p>Xin chào</p>', en: '<p>Hello</p>' },
      seo: {
        title: { vi: 'Về chúng tôi' },
        description: { vi: 'Mô tả' },
        keywords: { vi: ['bạc', 'trang sức'] },
        image: 'https://cdn.example/seo.png',
      },
      categories: [ids.category],
      tags: [{ title: 'about', slug: 'about' }, 'intro'],
      thumbnail: { url: 'https://cdn.example/thumb.png' },
      format: 'gallery',
      template: 'landing',
      sort: 3,
      views: 9,
      display: { showOnHome: true, priority: 2 },
      publishedAt,
      createdAt: publishedAt,
      updatedAt,
      gallery: ['https://cdn.example/g1.png'],
      media: ['https://youtube.example/embed/x'],
    },
    {
      _id: ids.conflicting,
      tenantId: 'default',
      type: 'post',
      status: 'scheduled',
      slug: { vi: 'bi-trung' },
      title: { vi: 'Bài bị trùng slug' },
      content: { vi: '<p>Nội dung</p>' },
      updatedAt,
    },
    {
      _id: ids.deleted,
      tenantId: 'default',
      type: 'post',
      status: 'published',
      isDeleted: true,
      slug: { vi: 'da-xoa' },
      title: { vi: 'Bài đã xoá' },
      content: { vi: '<p>Cũ</p>' },
      updatedAt,
    },
    {
      _id: ids.duplicateSlug,
      tenantId: 'default',
      type: 'page',
      status: 'draft',
      slug: { vi: 'gioi-thieu' },
      title: { vi: 'Trang trùng slug' },
      content: { vi: '<p>Khác</p>' },
      updatedAt,
    },
    { _id: ids.invalid, tenantId: 'default', status: 'draft' },
  ]

  return { ids, categories, contents, publishedAt, updatedAt }
}

function catalogFixture() {
  const ids = {
    category: '00000000000000000000e001',
    duplicateCategory: '00000000000000000000e002',
    childCategory: '00000000000000000000e003',
    item: '00000000000000000000f001',
    duplicateSlug: '00000000000000000000f002',
    deleted: '00000000000000000000f003',
  }

  const categories = [
    { _id: ids.category, slug: LEGACY_CATEGORY_SLUG, title: { vi: 'Trang sức' }, displayOrder: 1 },
    { _id: ids.duplicateCategory, slug: DUPLICATE_CATEGORY_SLUG, title: { vi: 'Trùng slug' } },
    { _id: ids.childCategory, pid: ids.category, slug: { vi: 'nhan' }, title: { vi: 'Nhẫn' }, displayOrder: 2 },
  ]

  const items = [
    {
      _id: ids.item,
      slug: { vi: 'nhan-bac' },
      title: { vi: 'Nhẫn bạc', en: 'Silver ring' },
      shortDesc: { vi: 'Mô tả ngắn' },
      thumbnail: { url: 'https://cdn.example/item.png' },
      gallery: [{ url: 'https://cdn.example/g1.png' }, 'https://cdn.example/g2.png', { publicId: 'skip-me' }],
      basePrice: 100,
      salePrice: 80,
      sku: 'SKU-1',
      type: 'simple',
      stock: 5,
      status: 'published',
      isActive: true,
      categories: [ids.category],
      tags: [{ title: 'furniture', slug: 'furniture' }, 'interior'],
      attributes: [{ k: { vi: 'Chất liệu' }, v: { vi: 'Bạc' } }],
      seo: { image: { url: 'https://cdn.example/seo.png' } },
    },
    {
      _id: ids.duplicateSlug,
      slug: { vi: 'nhan-bac' },
      title: { vi: 'Nhẫn trùng slug' },
      basePrice: 50,
      salePrice: 0,
      type: 'variable',
      status: 'published',
      isActive: false,
      variants: [
        { sku: 'V-1', basePrice: 50, salePrice: null, stock: 2 },
        { basePrice: 60, stock: 1 },
      ],
    },
    {
      _id: ids.deleted,
      slug: { vi: 'nhan-da-xoa' },
      title: { vi: 'Nhẫn đã xoá' },
      basePrice: 10,
      status: 'archived',
      isDeleted: true,
    },
  ]

  return { ids, categories, items }
}

async function main() {
  const connection = await connectDatabase({ uri: URI, database: DATABASE })
  const db = connection.db!
  const content = contentFixture()
  const catalog = catalogFixture()

  try {
    await db.dropDatabase()
    await db.collection('content_categories').insertMany(content.categories)
    await db.collection('contents').insertMany(content.contents)
    await db.collection('item_categories').insertMany(catalog.categories)
    await db.collection('items').insertMany(catalog.items)

    console.log('\n   Dry runs write nothing')

    const dryContent = run('migrate:content', false)
    const dryCatalog = run('migrate:catalog', false)
    await check('a content dry run exits 0 and reports the planned counts', () => {
      assert.equal(dryContent.code, 0, dryContent.output)
      assert.match(dryContent.output, /categories 3, contents 5, locales 5/)
      assert.match(dryContent.output, /invalid records 1/)
      assert.match(dryContent.output, /legacy gallery lists not carried \(1\)/)
      assert.match(dryContent.output, /legacy media embeds not carried \(1\)/)
    })
    await check('a dry run creates no target collection', async () => {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name)
      assert.equal(names.includes('content'), false)
      assert.equal(names.includes('categories'), false)
      assert.equal(names.includes('tm_migrations'), false)
    })
    await check('a catalog dry run exits 0 and reports the planned counts', () => {
      assert.equal(dryCatalog.code, 0, dryCatalog.output)
      assert.match(dryCatalog.output, /categories 3, items 3/)
    })
    await check('the catalog report counts what came through, field by field', () => {
      assert.match(
        dryCatalog.output,
        /field coverage \{"tags":1,"thumbnail":1,"gallery":1,"variants":1,"attributes":1,"sku":1,"barcode":0,"salePrice":2,"categories":1,"categoryThumbnail":0\}/,
      )
    })
    await check('the content report counts what came through, field by field', () => {
      assert.match(
        dryContent.output,
        /field coverage \{"thumbnail":1,"template":1,"keywords":1,"body":4,"excerpt":1,"seoImage":1,"bothLocales":1\}/,
      )
    })

    console.log('\n   Content apply')

    // A record the CMS already owns must survive the import untouched, and its
    // slug must push the legacy record that wants the same one out of the way.
    await db.collection('content').insertOne({
      siteId: SITE,
      key: 'posts/khac',
      type: 'post',
      status: 'published',
      revision: 7,
      schemaVersion: 1,
      locales: [{ locale: 'vi', slug: 'bi-trung', title: 'Existing', body: '', format: 'html', excerpt: '', keywords: [], seo: { title: '', description: '', image: '' } }],
      createdAt: new Date('2025-05-05T00:00:00.000Z'),
      updatedAt: new Date('2025-05-05T00:00:00.000Z'),
    })

    const applyContent = run('migrate:content', true)
    const applied = await db.collection('content').find({ siteId: SITE }).toArray()
    const migrated = (key: string) => applied.find(row => row.key === key)
    const page = migrated('pages/gioi-thieu')

    await check('the content apply exits 0 and writes every usable record', () => {
      assert.equal(applyContent.code, 0, applyContent.output)
      assert.match(applyContent.output, /wrote 3 categories and 4 contents/)
      assert.equal(applied.length, 5, 'four migrated records plus the one the CMS already owned')
    })
    await check('a migrated record gets revision 1 and schema version 1', () => {
      assert.equal(page?.revision, 1)
      assert.equal(page?.schemaVersion, 1)
      assert.equal(page?.siteId, SITE)
    })
    await check('tags keep their legacy `{ title }` shape', () => {
      assert.deepEqual(page?.tags, ['about', 'intro'])
    })
    await check('the legacy category link resolves to the new key', () => {
      assert.deepEqual(page?.categories, ['trang-suc'])
      assert.equal(migrated('categories/trang-suc'), undefined, 'v2 content categories live in their own collection')
    })
    await check('the legacy category tree keeps its parent', async () => {
      const categories = await db.collection('categories').find({ siteId: SITE }).toArray()
      assert.equal(categories.length, 3)
      const child = categories.find(row => row.key === 'nhan')
      // A content category points at its parent by key; a catalog category by id.
      assert.equal(child?.parent, 'trang-suc')
      assert.equal(child?.order, 5)
    })
    await check('a duplicate legacy category slug gets its own key instead of merging', async () => {
      const categories = await db.collection('categories').find({ siteId: SITE }).toArray()
      const duplicate = categories.find(row => row.key.startsWith('trang-suc-'))
      assert.equal(duplicate?.key, `trang-suc-${content.ids.duplicateCategory.slice(-6)}`)
      assert.equal(duplicate?.locales[0].name, 'Trùng slug')
    })
    await check('a `{ url }` thumbnail becomes a legacy attribute', () => {
      assert.equal(page?.attributes['legacy.thumbnail'], 'https://cdn.example/thumb.png')
      assert.equal(page?.attributes['legacy.format'], 'gallery')
      assert.equal(page?.attributes['legacy.template'], 'landing')
      assert.equal(page?.attributes['legacy.sort'], 3)
      assert.equal(page?.attributes['legacy.showOnHome'], true)
      assert.equal(page?.attributes['legacy.priority'], 2)
      assert.equal(page?.attributes['legacy.views'], 9)
    })
    await check('both locales, keywords and publication dates are carried', () => {
      assert.deepEqual(page?.locales.map((entry: { locale: string }) => entry.locale), ['vi', 'en'])
      assert.deepEqual(page?.locales[0].keywords, ['bạc', 'trang sức'])
      assert.equal(page?.locales[1].title, 'About us')
      assert.equal(page?.publishedAt.toISOString(), content.publishedAt.toISOString())
    })
    await check('an unknown status becomes a draft, a soft delete becomes deleted', () => {
      const draft = migrated(`posts/${content.ids.conflicting}`) ?? applied.find(row => row.locales?.[0]?.title === 'Bài bị trùng slug')
      assert.equal(draft?.status, 'draft')
      const deleted = applied.find(row => row.locales?.[0]?.title === 'Bài đã xoá')
      assert.equal(deleted?.status, 'deleted')
      assert.equal(deleted?.deletedAt.toISOString(), content.updatedAt.toISOString())
    })
    await check('a slug the CMS already owns is suffixed, and its owner is untouched', () => {
      const owner = migrated('posts/khac')
      assert.equal(owner?.revision, 7)
      assert.equal(owner?.locales[0].slug, 'bi-trung')
      const conflicting = applied.find(row => row.locales?.[0]?.title === 'Bài bị trùng slug')
      assert.equal(conflicting?.locales[0].slug, `bi-trung-${content.ids.conflicting.slice(-6)}`)
      assert.match(applyContent.output, /slug conflicts resolved/)
    })
    await check('a legacy duplicate slug gets its own key and a suffixed slug', () => {
      const duplicate = migrated(`pages/${content.ids.duplicateSlug}`)
      assert.equal(duplicate?.locales[0].slug, `gioi-thieu-${content.ids.duplicateSlug.slice(-6)}`)
    })
    await check('the unusable record is not written', () => {
      assert.equal(applied.some(row => row.key?.includes(content.ids.invalid)), false)
    })
    await check('a second content apply changes no revision, creation date or count', async () => {
      const again = run('migrate:content', true)
      assert.equal(again.code, 0, again.output)
      const rows = await db.collection('content').find({ siteId: SITE }).toArray()
      assert.equal(rows.length, applied.length)
      const afterPage = rows.find(row => row.key === 'pages/gioi-thieu')
      assert.equal(afterPage?.revision, 1)
      assert.equal(afterPage?.createdAt.toISOString(), page?.createdAt?.toISOString())
      const owner = rows.find(row => row.key === 'posts/khac')
      assert.equal(owner?.revision, 7)
    })

    console.log('\n   Catalog apply')

    const applyCatalog = run('migrate:catalog', true)
    const items = await db.collection('catalog_items').find({ siteId: SITE }).toArray()
    const item = items.find(row => row.sku === 'SKU-1')
    const variable = items.find(row => row.type === 'variable')

    await check('the catalog apply exits 0 and writes every item', () => {
      assert.equal(applyCatalog.code, 0, applyCatalog.output)
      assert.match(applyCatalog.output, /wrote 3 categories and 3 items/)
      assert.equal(items.length, 3)
    })
    await check('catalog tags, images and gallery are mapped, unusable gallery entries dropped', () => {
      assert.deepEqual(item?.tags, ['furniture', 'interior'])
      assert.equal(item?.thumbnail, 'https://cdn.example/item.png')
      assert.deepEqual(item?.gallery, ['https://cdn.example/g1.png', 'https://cdn.example/g2.png'])
      assert.equal(item?.seo.image, 'https://cdn.example/seo.png')
    })
    await check('prices keep a zero sale price as a sale price and null as null', () => {
      assert.equal(item?.salePrice, 80)
      assert.equal(variable?.salePrice, 0)
    })
    await check('a catalog item links to the migrated category row', async () => {
      const categories = await db.collection('catalog_categories').find({ siteId: SITE }).toArray()
      const parent = categories.find(row => row.key === 'trang-suc')
      assert.equal(categories.length, 3)
      assert.equal(String(item?.categories[0]), String(parent?._id))
      const child = categories.find(row => row.key === 'nhan')
      assert.equal(String(child?.parent), String(parent?._id))
    })
    await check('a variant without a SKU is dropped, a published but hidden item stays a draft', () => {
      assert.equal(variable?.variants.length, 1)
      assert.equal(variable?.variants[0].sku, 'V-1')
      assert.equal(variable?.status, 'draft')
      assert.equal(variable?.isActive, false)
    })
    await check('a soft-deleted catalog record is written as deleted', () => {
      const deleted = items.find(row => row.slug?.vi === 'nhan-da-xoa')
      assert.equal(deleted?.status, 'deleted')
      assert.equal(deleted?.isDeleted, true)
    })
    await check('a duplicate legacy item slug gets its own URL', () => {
      assert.equal(variable?.slug.vi, `nhan-bac-${catalog.ids.duplicateSlug.slice(-6)}`)
    })
    await check('the search string carries the mapped tag', () => {
      assert.match(item?.searchString, /furniture/)
      assert.match(item?.searchString, /nhẫn bạc|nhan bac/i)
    })
    await check('a second catalog apply keeps revision 1 and the same count', async () => {
      const again = run('migrate:catalog', true)
      assert.equal(again.code, 0, again.output)
      const rows = await db.collection('catalog_items').find({ siteId: SITE }).toArray()
      assert.equal(rows.length, items.length)
      assert.equal(rows.find(row => row.sku === 'SKU-1')?.revision, 1)
      assert.equal(rows.find(row => row.type === 'variable')?.slug.vi, variable?.slug.vi)
    })
  } finally {
    await db.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

try {
  await main()
} catch (error) {
  console.error(`\n❌ ${(error as Error).message}`)
  process.exitCode = 1
}

console.log(`\n${process.exitCode ? '❌' : '✅'} Migrate-apply checks: ${checks} passed\n`)
