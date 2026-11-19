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

function run(
  script: 'migrate:content' | 'migrate:catalog' | 'migrate:redirects' | 'migrate:settings' | 'check:migration',
  apply: boolean,
  options: { database?: string, args?: string[] } = {},
) {
  const extra = (options.args ?? []).join(' ')
  const command = `pnpm -s ${script} --site ${SITE}${apply ? ' --apply' : ''}${extra ? ` ${extra}` : ''}`
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf-8',
    env: { ...process.env, TM_MONGO_URI: URI, TM_MONGO_DB: options.database || DATABASE, TM_CUSTOMER_ID: SITE },
  })
  return { code: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` }
}

/** `pnpm rehearse` drives the five documented steps as separate processes. */
function rehearse(
  apply: boolean,
  options: { database?: string, args?: string[] } = {},
) {
  const extra = (options.args ?? []).join(' ')
  const command = `pnpm -s rehearse --site ${SITE}${apply ? ' --apply' : ''}${extra ? ` ${extra}` : ''}`
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf-8',
    env: { ...process.env, TM_MONGO_URI: URI, TM_MONGO_DB: options.database || DATABASE, TM_CUSTOMER_ID: SITE },
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
    otherTenant: '00000000000000000000f004',
    duplicatePath: '00000000000000000000f005',
    redirectItem: '00000000000000000000f006',
  }

  const categories = [
    {
      _id: ids.category,
      slug: LEGACY_CATEGORY_SLUG,
      title: { vi: 'Trang sức' },
      displayOrder: 1,
      fullPath: { vi: 'trang-suc', en: 'jewelry' },
    },
    {
      _id: ids.duplicateCategory,
      slug: DUPLICATE_CATEGORY_SLUG,
      title: { vi: 'Trùng slug' },
      isDeleted: true,
      deletedAt: new Date('2026-04-05T06:07:08.000Z'),
      fullPath: { vi: 'trang-suc' },
    },
    {
      _id: ids.childCategory,
      pid: ids.category,
      slug: { vi: 'nhan' },
      title: { vi: 'Nhẫn' },
      displayOrder: 2,
      fullPath: { vi: 'trang-suc/nhan' },
    },
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
      minStock: 3,
      supplierPrices: [{ supplier: 'sup-1', price: 70 }],
      status: 'published',
      isActive: true,
      categories: [ids.category],
      tags: [{ title: 'furniture', slug: 'furniture' }, 'interior'],
      attributes: [{ k: { vi: 'Chất liệu' }, v: { vi: 'Bạc' } }],
      seo: { image: { url: 'https://cdn.example/seo.png' } },
      fullPath: { vi: 'trang-suc/nhan-bac', en: 'jewelry/silver-ring' },
    },
    {
      // Same legacy URL as the item above, different v2 slug: ambiguous, so neither
      // path may be redirected.
      _id: ids.duplicatePath,
      slug: { vi: 'nhan-bac-ba' },
      title: { vi: 'Nhẫn trùng đường dẫn' },
      basePrice: 30,
      status: 'published',
      fullPath: { vi: 'trang-suc/nhan-bac' },
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
      fullPath: { vi: 'trang-suc/nhan-bac-hai' },
    },
    {
      _id: ids.deleted,
      slug: { vi: 'nhan-da-xoa' },
      title: { vi: 'Nhẫn đã xoá' },
      basePrice: 10,
      status: 'archived',
      isDeleted: true,
      deletedAt: new Date('2026-03-04T05:06:07.000Z'),
      fullPath: { vi: 'trang-suc/nhan-da-xoa' },
    },
    {
      // Published, with a legacy nested URL of its own: the only unambiguous redirect.
      _id: ids.redirectItem,
      slug: { vi: 'nhan-le' },
      title: { vi: 'Nhẫn lẻ' },
      basePrice: 5,
      status: 'published',
      fullPath: { vi: 'trang-suc/nhan-le' },
    },
    {
      // Another tenant's row must never reach this site.
      _id: ids.otherTenant,
      tenantId: 'other-tenant',
      slug: { vi: 'nhan-tenant-khac' },
      title: { vi: 'Nhẫn của tenant khác' },
      basePrice: 20,
      status: 'published',
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
    await db.collection('system_configs').insertMany([
      { key: 'site_name', isPublic: true, type: 'string', value: 'Fixture Store' },
      { key: 'site_description', isPublic: true, type: 'string', value: 'Fixture description' },
      { key: 'content_locales', isPublic: true, type: 'json', value: '["vi","en"]' },
      { key: 'enabled_modules', isPublic: true, type: 'json', value: '["posts","products","cart"]' },
      { key: 'maintenance_mode', isPublic: true, type: 'boolean', value: true },
      // The legacy collection holds plaintext credentials; none may reach the site.
      { key: 'jwt_secret', isPublic: false, type: 'string', value: 'DO-NOT-IMPORT-marker-1' },
      { key: 'cloudinary_api_secret', isPublic: false, type: 'string', value: 'DO-NOT-IMPORT-marker-2' },
    ])
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
      assert.match(dryContent.output, /not fully migrated 1: no body 0, gallery not carried 1, media not carried 1/)
    })
    await check('a dry run creates no target collection', async () => {
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(entry => entry.name)
      assert.equal(names.includes('content'), false)
      assert.equal(names.includes('categories'), false)
      assert.equal(names.includes('tm_migrations'), false)
    })
    await check('a catalog dry run exits 0 and reports the planned counts', () => {
      assert.equal(dryCatalog.code, 0, dryCatalog.output)
      assert.match(dryCatalog.output, /categories 3, items 5/)
    })
    await check('the catalog report names the legacy fields that have no column', () => {
      assert.match(dryCatalog.output, /"supplierPrices":1/)
      assert.match(dryCatalog.output, /"minStock":1/)
      assert.match(dryCatalog.output, /legacy category fields not carried \{\}/)
    })
    await check('the catalog report counts the legacy tenants, including untagged rows', () => {
      assert.match(dryCatalog.output, /legacy tenants \{.*"\(none\)":8.*"other-tenant":1.*\}/)
    })
    await check('the catalog report counts what came through, field by field', () => {
      assert.match(
        dryCatalog.output,
        /field coverage \{"tags":1,"thumbnail":1,"gallery":1,"variants":1,"attributes":1,"sku":1,"barcode":0,"salePrice":2,"categories":1,"categoryThumbnail":0\}/,
      )
    })
    await check('the content report names the legacy tenants it found', () => {
      assert.match(dryContent.output, /legacy tenants \{"default":8\}/)
    })
    await check('a dry run against the v2 database warns instead of planning nothing quietly', async () => {
      const emptyDatabase = `${DATABASE}_empty`
      const content = run('migrate:content', false, { database: emptyDatabase })
      const catalog = run('migrate:catalog', false, { database: emptyDatabase })
      assert.equal(content.code, 0, content.output)
      assert.match(content.output, /found no legacy contents\/content_categories collections in tm_import_gate_empty/)
      assert.match(catalog.output, /found no legacy items\/item_categories collections in tm_import_gate_empty/)
      await connectDatabase({ uri: URI, database: emptyDatabase }).then(connection => connection.db?.dropDatabase())
    })
    await check('an empty legacy collection is reported as an empty copy, not as the wrong database', async () => {
      // `bag-post` has `items` and `item_categories` that hold no documents: the
      // import used to tell the operator to change `TM_MONGO_DB`, which was right.
      const hollowDatabase = `${DATABASE}_hollow`
      // Left open on purpose: `connectDatabase` caches by binding, and opening the
      // same database again after `close()` returns the closed connection.
      const hollow = await connectDatabase({ uri: URI, database: hollowDatabase })
      await hollow.db!.createCollection('items')
      await hollow.db!.createCollection('item_categories')
      const catalog = run('migrate:catalog', false, { database: hollowDatabase })
      assert.equal(catalog.code, 0, catalog.output)
      assert.match(catalog.output, /the legacy items\/item_categories collections exist in tm_import_gate_hollow but hold no documents/)
      assert.equal(catalog.output.includes('customer-named database'), false, 'the database name is correct here')
      await hollow.db!.dropDatabase()
    })
    await check('an unknown --tenant names the tenants the database does hold', async () => {
      const mismatch = run('migrate:content', false, { args: ['--tenant', 'khong-co'] })
      assert.equal(mismatch.code, 0, mismatch.output)
      assert.match(mismatch.output, /no record matches --tenant khong-co; this database holds \{"default":8\}/)
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
      assert.match(applyContent.output, /verified 3\/3 categories, 4\/4 contents/)
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
    await check('a record that loses its gallery or media list is marked as not fully migrated', () => {
      assert.equal(page?.attributes['legacy.incomplete'], 'gallery,media')
      assert.equal(page?.attributes['legacy.gallerySkipped'], 1)
      assert.equal(page?.attributes['legacy.mediaSkipped'], 1)
      const complete = applied.find(row => row.locales?.[0]?.title === 'Bài bị trùng slug')
      assert.equal(complete?.attributes?.['legacy.incomplete'], undefined)
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
      assert.match(applyCatalog.output, /wrote 3 categories and 5 items/)
      assert.match(applyCatalog.output, /verified 3\/3 categories, 5\/5 items/)
      assert.equal(items.length, 5)
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
    await check("another tenant's catalog record is not imported", () => {
      assert.equal(items.some(row => row.slug?.vi === 'nhan-tenant-khac'), false)
    })
    await check('a soft-deleted catalog record is written as deleted, with its date', () => {
      const deleted = items.find(row => row.slug?.vi === 'nhan-da-xoa')
      assert.equal(deleted?.status, 'deleted')
      assert.equal(deleted?.isDeleted, true)
      assert.equal(deleted?.deletedAt?.toISOString(), '2026-03-04T05:06:07.000Z')
    })
    await check('a soft-deleted legacy category is not revived as live', async () => {
      const rows = await db.collection('catalog_categories').find({ siteId: SITE }).toArray()
      const duplicate = rows.find(row => String(row.key).startsWith('trang-suc-'))
      assert.equal(duplicate?.isDeleted, true)
      assert.equal(duplicate?.deletedAt?.toISOString(), '2026-04-05T06:07:08.000Z')
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

    console.log('\n   Legacy URL redirects')

    const dryRedirects = run('migrate:redirects', false)

    await check('the redirect dry run plans only the unambiguous legacy product path', () => {
      assert.equal(dryRedirects.code, 0, dryRedirects.output)
      assert.match(dryRedirects.output, /planned 2, skipped \{/)
      assert.match(dryRedirects.output, /"two legacy rows claim the same path":1/)
      assert.match(dryRedirects.output, /no published v2 row \(run migrate:catalog --apply first, or the record is not published\)":2/)
      assert.match(dryRedirects.output, /category paths not planned 2/)
      assert.match(dryRedirects.output, /\/trang-suc\/nhan-le -> \/products\/nhan-le/)
      assert.match(dryRedirects.output, /\/trang-suc\/nhan -> \/categories\/nhan/)
    })
    await check('a redirect dry run writes no row', async () => {
      const rows = await db.collection('content_redirects').find({ siteId: SITE }).toArray()
      assert.equal(rows.length, 0)
    })

    const applyRedirects = run('migrate:redirects', true)

    await check('the redirect apply writes a 301 from the legacy path to the v2 product URL', async () => {
      assert.equal(applyRedirects.code, 0, applyRedirects.output)
      assert.match(applyRedirects.output, /wrote 2 redirects, kept 0 existing rows/)
      assert.match(applyRedirects.output, /verified 2\/2 redirects/)
      assert.match(applyRedirects.output, /planned detail: 2 paths \(1 products, 1 categories\)/)
      const rows = await db.collection('content_redirects').find({ siteId: SITE }).toArray()
      assert.equal(rows.length, 2)
      const item = rows.find(row => row.from === '/trang-suc/nhan-le')
      assert.equal(item?.to, '/products/nhan-le')
      assert.equal(item?.statusCode, 301)
      assert.equal(item?.isActive, true)
      assert.equal(item?.note, 'legacy import')
      assert.equal(item?.revision, 1)
      const category = rows.find(row => row.from === '/trang-suc/nhan')
      assert.equal(category?.to, '/categories/nhan')
    })
    console.log('\n   Legacy site settings')

    const drySettings = run('migrate:settings', false)

    await check('the settings dry run maps only the allowlisted keys', () => {
      assert.equal(drySettings.code, 0, drySettings.output)
      assert.match(drySettings.output, /mapped 4 \["site_name","site_description","content_locales","enabled_modules"\]/)
      assert.match(drySettings.output, /"locales.enabled":\["vi","en"\]/)
      assert.match(drySettings.output, /"modules":\{"content":true,"catalog":true\}/)
      assert.match(drySettings.output, /legacy modules without a v2 switch \["cart"\]/)
      assert.match(drySettings.output, /not carried 1 \["maintenance_mode"\]/)
    })
    await check('the settings report names the credential keys and never prints a value', () => {
      assert.match(drySettings.output, /2 legacy keys hold credentials in plaintext and are NOT imported/)
      assert.match(drySettings.output, /cloudinary_api_secret, jwt_secret/)
      assert.equal(drySettings.output.includes('DO-NOT-IMPORT-marker'), false)
    })
    await check('a settings dry run writes no document', async () => {
      assert.equal(await db.collection('settings').countDocuments({ siteId: SITE }), 0)
    })

    const applySettings = run('migrate:settings', true)

    await check('the settings apply writes one document without any legacy secret', async () => {
      assert.equal(applySettings.code, 0, applySettings.output)
      assert.match(applySettings.output, /wrote the settings document/)
      const doc = await db.collection('settings').findOne({ siteId: SITE })
      assert.equal(doc?.company?.name, 'Fixture Store')
      assert.equal(doc?.company?.names?.vi, 'Fixture Store')
      assert.equal(doc?.seo?.defaultDescription, 'Fixture description')
      assert.deepEqual(doc?.locales?.enabled, ['vi', 'en'])
      assert.equal(doc?.modules?.content, true)
      assert.equal(doc?.modules?.catalog, true)
      assert.equal(JSON.stringify(doc).includes('DO-NOT-IMPORT-marker'), false)
    })
    await check('a rerun never overwrites a settings document an editor owns', async () => {
      await db.collection('settings').updateOne(
        { siteId: SITE },
        { $set: { 'company.name': 'Edited name', revision: 7 } },
      )
      const again = run('migrate:settings', true)
      assert.equal(again.code, 0, again.output)
      assert.match(again.output, /kept the existing settings document/)
      const doc = await db.collection('settings').findOne({ siteId: SITE })
      assert.equal(doc?.company?.name, 'Edited name')
      assert.equal(doc?.revision, 7)
    })

    await check('a path a human mapped is never replaced by the importer', async () => {
      await db.collection('content_redirects').updateOne(
        { siteId: SITE, from: '/trang-suc/nhan-le' },
        { $set: { to: '/manual-target', revision: 5 } },
      )
      const again = run('migrate:redirects', true)
      assert.equal(again.code, 0, again.output)
      assert.match(again.output, /planned 0, skipped \{.*"already has a redirect row":2/)
      const row = await db.collection('content_redirects').findOne({ siteId: SITE, from: '/trang-suc/nhan-le' })
      assert.equal(row?.to, '/manual-target')
      assert.equal(row?.revision, 5)
    })
    console.log('\n   Rehearsal runner')

    const dryRehearsal = rehearse(false)

    await check('a rehearsal dry run drives the four steps in the documented order', () => {
      assert.equal(dryRehearsal.code, 0, dryRehearsal.output)
      const content = dryRehearsal.output.indexOf('▶ 1/4 migrate:content')
      const catalogStep = dryRehearsal.output.indexOf('▶ 2/4 migrate:catalog')
      const redirects = dryRehearsal.output.indexOf('▶ 3/4 migrate:redirects')
      const settings = dryRehearsal.output.indexOf('▶ 4/4 migrate:settings')
      assert.ok(content >= 0 && content < catalogStep && catalogStep < redirects && redirects < settings, dryRehearsal.output)
      assert.match(dryRehearsal.output, /nothing was written; rerun with --apply/)
      assert.equal(dryRehearsal.output.includes('check:migration'), false, 'parity is meaningless before an apply')
    })
    await check('a rehearsal dry run writes nothing', async () => {
      const doc = await db.collection('settings').findOne({ siteId: SITE })
      assert.equal(doc?.company?.name, 'Edited name')
      assert.equal(doc?.revision, 7)
      assert.equal(await db.collection('content_redirects').countDocuments({ siteId: SITE }), 2)
    })
    await check('a rehearsal refuses a v2 app database instead of planning zero rows', () => {
      const wrong = rehearse(false, { database: 'app_sentuan_cms' })
      assert.equal(wrong.code, 1, wrong.output)
      assert.match(wrong.output, /looks like a v2 app database/)
      assert.equal(wrong.output.includes('▶'), false, 'nothing may run')
    })

    const applyRehearsal = rehearse(true)

    await check('a rehearsal apply ends with the parity report for every domain', () => {
      assert.equal(applyRehearsal.code, 0, applyRehearsal.output)
      assert.match(applyRehearsal.output, /▶ 5\/5 check:migration/)
      assert.match(applyRehearsal.output, /✅ content\s+legacy\s+4\s+v2\s+5/)
      assert.match(applyRehearsal.output, /✅ catalog items\s+legacy\s+5\s+v2\s+5/)
      assert.match(applyRehearsal.output, /✅ rehearsal complete: every writer ran, and parity holds/)
    })

    console.log('\n   Migration parity report')

    const parity = run('check:migration', false)

    await check('the parity report compares each migrated domain with the legacy source', () => {
      assert.equal(parity.code, 0, parity.output)
      assert.match(parity.output, /✅ content\s+legacy\s+4\s+v2\s+5/)
      assert.match(parity.output, /✅ content categories\s+legacy\s+3\s+v2\s+3/)
      assert.match(parity.output, /✅ catalog items\s+legacy\s+5\s+v2\s+5/)
      assert.match(parity.output, /✅ settings\s+company identity present/)
      assert.match(parity.output, /not fully migrated\s+1 content row\(s\) carry legacy\.incomplete/)
      assert.match(parity.output, /parity: every migrated domain holds at least what the source does/)
    })
    await check('the parity report never reads a legacy value', () => {
      assert.equal(parity.output.includes('DO-NOT-IMPORT-marker'), false)
      assert.equal(parity.output.includes('Fixture Store'), false)
    })
    await check('the parity report fails when the database holds fewer rows than the source', async () => {
      await db.collection('catalog_items').deleteOne({ siteId: SITE, legacyId: catalog.ids.item })
      const broken = run('check:migration', false)
      assert.equal(broken.code, 1, broken.output)
      assert.match(broken.output, /❌ catalog items/)
      assert.match(broken.output, /fewer rows than the source/)
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
