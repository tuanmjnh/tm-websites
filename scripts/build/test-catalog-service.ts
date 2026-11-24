import assert from 'node:assert/strict'
import {
  CatalogServiceError,
  createCatalogCategory,
  createCatalogItem,
  deleteCatalogCategory,
  getCatalogItem,
  listCatalogCategories,
  listCatalogItems,
  listCatalogTags,
  bulkUpdateCatalogItems,
  bulkUpdateCatalogItemsByFilter,
  runCatalogItemEvent,
  updateCatalogCategory,
  updateCatalogItem,
} from '../../tm-cms/server/services/catalogService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import { AUTO_CATEGORY_SLUG_REDIRECT_NOTE } from '../../tm-cms/server/services/catalogSlugRedirects.js'
import { buildCatalogCategoryDraft } from '../../tm-shared/nuxt-layers/cms-base/app/utils/catalog-category-draft.js'
import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'

let checks = 0

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
  return (error: unknown) => error instanceof CatalogServiceError && error.statusCode === status && error.code === code
}

const connection = await connectDatabase(testDatabaseBinding('tm_test_catalog_service'))
await dropTestDatabase(connection)
const { CatalogItem, CatalogCategory, Redirect } = await prepareDatabase(connection)

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'

console.log('catalog service')

try {
  await check('editing a category updates both locales and keeps an unedited one', () => {
    const payload = buildCatalogCategoryDraft({
      key: 'trang-suc',
      parent: null,
      order: 1,
      title: 'Trang sức mới',
      titleEn: 'New jewelry',
      slugVi: 'trang-suc-moi',
      slugEn: 'new-jewelry',
      description: 'Mô tả mới',
      descriptionEn: 'New description',
      thumbnail: ' https://cdn.example.com/trang-suc-moi.jpg ',
      seoTitle: 'SEO mới',
      seoTitleEn: 'New SEO',
      seoDescription: 'Mô tả SEO mới',
      seoDescriptionEn: 'New SEO description',
    }, {
      title: { vi: 'Trang sức', en: 'Jewelry', fr: 'Bijoux' },
      slug: { vi: 'trang-suc', en: 'jewelry', fr: 'bijoux' },
      description: { vi: 'Mô tả cũ', en: 'Old description', fr: 'Ancienne description' },
      seo: {
        title: { vi: 'SEO cũ', en: 'Old SEO', fr: 'Ancien SEO' },
        description: { vi: 'Mô tả SEO cũ', en: 'Old SEO description', fr: 'Ancienne description SEO' },
      },
    })

    assert.deepEqual(payload.title, { vi: 'Trang sức mới', en: 'New jewelry', fr: 'Bijoux' })
    assert.deepEqual(payload.slug, { vi: 'trang-suc-moi', en: 'new-jewelry', fr: 'bijoux' })
    assert.deepEqual(payload.description, { vi: 'Mô tả mới', en: 'New description', fr: 'Ancienne description' })
    assert.deepEqual(payload.seo, {
      title: { vi: 'SEO mới', en: 'New SEO', fr: 'Ancien SEO' },
      description: { vi: 'Mô tả SEO mới', en: 'New SEO description', fr: 'Ancienne description SEO' },
    })
    assert.equal(payload.thumbnail, 'https://cdn.example.com/trang-suc-moi.jpg')
  })

  await check('clearing English keeps the Vietnamese title and slug independent', () => {
    const payload = buildCatalogCategoryDraft({
      key: 'trang-suc',
      parent: null,
      order: 1,
      title: 'Trang sức đổi tên',
      titleEn: '',
      slugVi: 'trang-suc',
      slugEn: '',
      description: 'Mô tả',
      descriptionEn: '',
      thumbnail: '',
      seoTitle: 'SEO',
      seoTitleEn: '',
      seoDescription: 'Mô tả SEO',
      seoDescriptionEn: '',
    }, {
      title: { vi: 'Trang sức', en: 'Jewelry' },
      slug: { vi: 'trang-suc', en: 'jewelry' },
      description: { vi: 'Mô tả', en: 'Description' },
      seo: {
        title: { vi: 'SEO', en: 'SEO' },
        description: { vi: 'Mô tả SEO', en: 'SEO description' },
      },
    })

    assert.deepEqual(payload.title, { vi: 'Trang sức đổi tên' })
    assert.deepEqual(payload.slug, { vi: 'trang-suc' })
    assert.deepEqual(payload.description, { vi: 'Mô tả' })
    assert.deepEqual(payload.seo, { title: { vi: 'SEO' }, description: { vi: 'Mô tả SEO' } })
  })

  await check('creating a category carries both edited locales', () => {
    const payload = buildCatalogCategoryDraft({
      key: 'trang-suc',
      parent: null,
      order: 1,
      title: 'Trang sức',
      titleEn: 'Jewelry',
      slugVi: '',
      slugEn: 'jewelry',
      description: 'Mô tả',
      descriptionEn: 'Description',
      thumbnail: '',
      seoTitle: 'SEO',
      seoTitleEn: 'SEO',
      seoDescription: 'Mô tả SEO',
      seoDescriptionEn: 'SEO description',
    }, null)

    assert.deepEqual(payload.title, { vi: 'Trang sức', en: 'Jewelry' })
    assert.deepEqual(payload.slug, { vi: 'Trang sức', en: 'jewelry' })
    assert.deepEqual(payload.description, { vi: 'Mô tả', en: 'Description' })
    assert.deepEqual(payload.seo, {
      title: { vi: 'SEO', en: 'SEO' },
      description: { vi: 'Mô tả SEO', en: 'SEO description' },
    })
  })

  let parentId = ''
  await check('creates a category with a normalized key and computed path', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'Trang sức',
      title: { vi: 'Trang sức' },
      slug: { vi: 'Trang Sức' },
      description: { vi: 'Trang sức bạc và vàng' },
      thumbnail: 'https://cdn.example.com/trang-suc.jpg',
      seo: { title: { vi: 'Trang sức cao cấp' }, description: { vi: 'Bộ sưu tập trang sức' } },
    })
    parentId = created.id
    assert.equal(created.key, 'trang-suc')
    assert.equal(created.slug.vi, 'trang-suc')
    assert.equal(created.fullPath.vi, '/trang-suc')
    assert.equal(created.revision, 1)
    assert.equal(created.description.vi, 'Trang sức bạc và vàng')
    assert.equal(created.thumbnail, 'https://cdn.example.com/trang-suc.jpg')
    assert.equal(created.seo.title.vi, 'Trang sức cao cấp')
    assert.equal(created.seo.description.vi, 'Bộ sưu tập trang sức')
  })

  let childId = ''
  await check('a child category inherits the parent path and ancestors', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'nhan',
      parent: 'trang-suc',
      order: 2,
      title: { vi: 'Nhẫn' },
      slug: { vi: 'nhan' },
    })
    childId = created.id
    assert.equal(created.fullPath.vi, '/trang-suc/nhan')
    const stored = await CatalogCategory.findById(childId).lean() as { ancestors: unknown[], pid: unknown, displayOrder: number }
    assert.equal(stored.ancestors.length, 1)
    assert.equal(String(stored.pid), parentId)
    assert.equal(stored.displayOrder, 2)
  })

  await check('an unknown parent is refused', async () => {
    await assert.rejects(
      createCatalogCategory(CatalogCategory, SITE, { key: 'x', parent: 'khong-co', title: { vi: 'X' } }),
      isServiceError(422, 'CATALOG_PARENT_NOT_FOUND'),
    )
  })

  let itemId = ''
  await check('creates a draft item with resolved categories and a search string', async () => {
    const created = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'nhan-bac',
      title: { vi: 'Nhẫn bạc' },
      slug: { vi: 'Nhan Bac' },
      shortDesc: { vi: 'Nhẫn bạc 925' },
      basePrice: 500000,
      salePrice: 450000,
      sku: 'NB-01',
      stock: 3,
      categories: ['nhan'],
      tags: ['bạc', ' bạc ', 'quà tặng'],
    })
    itemId = created.id
    assert.equal(created.status, 'draft')
    assert.equal(created.categories.length, 1)
    assert.deepEqual(created.tags, ['bạc', 'quà tặng'])
    assert.equal(created.slug.vi, 'nhan-bac')

    const stored = await CatalogItem.findById(itemId).lean() as { searchString: string, categories: unknown[] }
    assert.match(stored.searchString, /nhan bac/)
    assert.equal(stored.categories.length, 1)
  })

  await check('a duplicate key is refused with 409', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'nhan-bac',
        title: { vi: 'Khác' },
        slug: { vi: 'khac' },
      }),
      isServiceError(409, 'CATALOG_KEY_EXISTS'),
    )
  })

  await check('salePrice above basePrice is refused', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'gia-sai',
        title: { vi: 'Giá sai' },
        slug: { vi: 'gia-sai' },
        basePrice: 100,
        salePrice: 200,
      }),
      isServiceError(422, 'CATALOG_PAYLOAD_INVALID'),
    )
  })

  await check('an item referencing an unknown category is refused', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'danh-muc-sai',
        title: { vi: 'Danh mục sai' },
        slug: { vi: 'danh-muc-sai' },
        categories: ['khong-co'],
      }),
      isServiceError(422, 'CATALOG_CATEGORY_NOT_FOUND'),
    )
  })

  await check('publishing makes the record visible to the public filter', async () => {
    const published = await runCatalogItemEvent(CatalogItem, SITE, itemId, { event: 'publish', revision: 1 })
    assert.equal(published.status, 'published')
    assert.ok(published.publishedAt)

    const visible = await CatalogItem.countDocuments({
      _id: itemId,
      status: 'published',
      isActive: true,
      isDeleted: { $ne: true },
    })
    assert.equal(visible, 1)
  })

  await check('an update with a stale revision is refused and leaves the record intact', async () => {
    await assert.rejects(
      updateCatalogItem(CatalogItem, CatalogCategory, SITE, itemId, {
        revision: 1,
        key: 'nhan-bac',
        title: { vi: 'Đổi tên' },
        slug: { vi: 'nhan-bac' },
      }),
      isServiceError(409, 'CATALOG_REVISION_CONFLICT'),
    )
    const current = await getCatalogItem(CatalogItem, SITE, itemId)
    assert.equal(current.title.vi, 'Nhẫn bạc')
  })

  await check('the key cannot change after creation', async () => {
    const current = await getCatalogItem(CatalogItem, SITE, itemId)
    await assert.rejects(
      updateCatalogItem(CatalogItem, CatalogCategory, SITE, itemId, {
        revision: current.revision,
        key: 'khac-key',
        title: { vi: 'Nhẫn bạc' },
        slug: { vi: 'nhan-bac' },
      }),
      isServiceError(422, 'CATALOG_KEY_IMMUTABLE'),
    )
  })

  await check('an update keeps counters, bumps the revision and refreshes the search string', async () => {
    const before = await getCatalogItem(CatalogItem, SITE, itemId)
    const updated = await updateCatalogItem(CatalogItem, CatalogCategory, SITE, itemId, {
      revision: before.revision,
      key: 'nhan-bac',
      title: { vi: 'Nhẫn bạc cao cấp' },
      slug: { vi: 'nhan-bac' },
      basePrice: 600000,
      categories: ['trang-suc'],
      tags: ['bạc', 'quà tặng'],
    })
    assert.equal(updated.revision, before.revision + 1)
    assert.equal(updated.basePrice, 600000)

    const stored = await CatalogItem.findById(itemId).lean() as { searchString: string, sales: number }
    assert.match(stored.searchString, /cao cap/)
    assert.equal(stored.sales, 0)
  })

  let barcodeItemId = ''
  await check('a barcode is trimmed, returned and searchable', async () => {
    const created = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'nhan-bac-barcode',
      title: { vi: 'Nhẫn bạc có mã vạch' },
      slug: { vi: 'nhan-bac-barcode' },
      barcode: '  8930000000012  ',
    })
    barcodeItemId = created.id
    assert.equal(created.barcode, '8930000000012')

    const byBarcode = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { q: '8930000000012' })
    assert.deepEqual(byBarcode.data.map(item => item.key), ['nhan-bac-barcode'])
  })

  await check('a barcode already used in the site is refused, on create and on update', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'nhan-bac-barcode-2',
        title: { vi: 'Nhẫn trùng mã' },
        slug: { vi: 'nhan-bac-barcode-2' },
        barcode: '8930000000012',
      }),
      isServiceError(409, 'CATALOG_BARCODE_EXISTS'),
    )

    const current = await getCatalogItem(CatalogItem, SITE, itemId)
    await assert.rejects(
      updateCatalogItem(CatalogItem, CatalogCategory, SITE, itemId, {
        revision: current.revision,
        key: 'nhan-bac',
        title: { vi: 'Nhẫn bạc cao cấp' },
        slug: { vi: 'nhan-bac' },
        barcode: '8930000000012',
      }),
      isServiceError(409, 'CATALOG_BARCODE_EXISTS'),
    )
  })

  await check('the same barcode is free in another site and many records may have none', async () => {
    const foreign = await createCatalogItem(CatalogItem, CatalogCategory, OTHER_SITE, {
      key: 'nhan-bac-barcode',
      title: { vi: 'Nhẫn bạc có mã vạch' },
      slug: { vi: 'nhan-bac-barcode' },
      barcode: '8930000000012',
    })
    assert.equal(foreign.barcode, '8930000000012')
    // Removed again: a later check asserts the other site holds no records at all.
    await CatalogItem.deleteOne({ siteId: OTHER_SITE, key: 'nhan-bac-barcode' })

    const noBarcode = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'nhan-khong-ma',
      title: { vi: 'Nhẫn không mã' },
      slug: { vi: 'nhan-khong-ma' },
    })
    assert.equal(noBarcode.barcode, '')
  })

  await check('clearing a barcode frees it for another product', async () => {
    const current = await getCatalogItem(CatalogItem, SITE, barcodeItemId)
    const cleared = await updateCatalogItem(CatalogItem, CatalogCategory, SITE, barcodeItemId, {
      revision: current.revision,
      key: 'nhan-bac-barcode',
      title: { vi: 'Nhẫn bạc có mã vạch' },
      slug: { vi: 'nhan-bac-barcode' },
      barcode: '',
    })
    assert.equal(cleared.barcode, '')

    const moved = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'nhan-bac-barcode-3',
      title: { vi: 'Nhẫn nhận mã vạch' },
      slug: { vi: 'nhan-bac-barcode-3' },
      barcode: '8930000000012',
    })
    assert.equal(moved.barcode, '8930000000012')
    barcodeItemId = moved.id
  })

  await check('the list filter composes status, tag, search and category subtree', async () => {
    const byStatus = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { status: 'published' })
    assert.equal(byStatus.data.length, 1)
    assert.equal(byStatus.counts.published, 1)
    // Other checks create draft records, so the count is compared to the database
    // rather than to a literal.
    assert.equal(byStatus.counts.draft, await CatalogItem.countDocuments({ siteId: SITE, status: 'draft' }))

    const byTag = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { tag: 'quà tặng' })
    assert.equal(byTag.data.length, 1)

    const bySearch = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { q: 'cao cấp' })
    assert.equal(bySearch.data.length, 1)

    // The item moved to the root category; the child filter must not return it.
    const byChild = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { category: 'nhan' })
    assert.equal(byChild.data.length, 0)
    const byRoot = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { category: 'trang-suc' })
    assert.equal(byRoot.data.length, 1)
  })

  await check('another site never sees these records', async () => {
    const foreign = await listCatalogItems(CatalogItem, CatalogCategory, OTHER_SITE, {})
    assert.equal(foreign.data.length, 0)
    assert.equal(foreign.counts.all, 0)
    await assert.rejects(getCatalogItem(CatalogItem, OTHER_SITE, itemId), isServiceError(404, 'CATALOG_ITEM_NOT_FOUND'))
  })

  await check('tags are aggregated per site without duplicates', async () => {
    const tags = await listCatalogTags(CatalogItem, SITE)
    assert.deepEqual(tags, [{ name: 'bạc', count: 1 }, { name: 'quà tặng', count: 1 }])
  })

  await check('a category move rewrites its path', async () => {
    const categories = await listCatalogCategories(CatalogCategory, CatalogItem, SITE)
    const child = categories.find(category => category.key === 'nhan')!
    const updated = await updateCatalogCategory(CatalogCategory, SITE, child.id, {
      revision: child.revision,
      key: 'nhan',
      parent: null,
      title: { vi: 'Nhẫn' },
      slug: { vi: 'nhan' },
    })
    assert.equal(updated.fullPath.vi, '/nhan')
  })

  await check('a category slug change writes one 301 per locale', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'redirect-probe',
      title: { vi: 'Danh mục đổi slug', en: 'Category slug change' },
      slug: { vi: 'doi-slug-cu', en: 'old-category' },
    })
    await updateCatalogCategory(CatalogCategory, SITE, created.id, {
      revision: created.revision,
      key: 'redirect-probe',
      parent: null,
      title: { vi: 'Danh mục đổi slug', en: 'Category slug change' },
      slug: { vi: 'doi-slug-moi', en: 'new-category' },
    }, { redirects: Redirect })

    const rows = await Redirect.find({ siteId: SITE }).sort({ from: 1 })
      .lean<Array<{ from: string, to: string, statusCode: number, note: string }>>()
    assert.deepEqual(rows.map(row => ({ from: row.from, to: row.to, statusCode: row.statusCode })), [
      { from: '/categories/doi-slug-cu', to: '/categories/doi-slug-moi', statusCode: 301 },
      { from: '/categories/old-category', to: '/categories/new-category', statusCode: 301 },
    ])
    assert.ok(rows.every(row => row.note === AUTO_CATEGORY_SLUG_REDIRECT_NOTE))
  })

  await check('a manual redirect is kept and a repeat save does not duplicate it', async () => {
    const from = '/categories/manual-cu'
    await Redirect.create({
      siteId: SITE,
      from,
      to: '/categories/manual-dich',
      statusCode: 301,
      isActive: true,
      note: 'manual',
      revision: 1,
    })
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'manual-probe',
      title: { vi: 'Danh mục thủ công' },
      slug: { vi: 'manual-cu' },
    }, { redirects: Redirect })
    const updated = await updateCatalogCategory(CatalogCategory, SITE, created.id, {
      revision: created.revision,
      key: 'manual-probe',
      parent: null,
      title: { vi: 'Danh mục thủ công' },
      slug: { vi: 'manual-moi' },
    }, { redirects: Redirect })

    await updateCatalogCategory(CatalogCategory, SITE, updated.id, {
      revision: updated.revision,
      key: 'manual-probe',
      parent: null,
      title: { vi: 'Danh mục thủ công đã sửa' },
      slug: { vi: 'manual-moi' },
    }, { redirects: Redirect })

    const rows = await Redirect.find({ siteId: SITE, from }).lean<Array<{ to: string, note: string }>>()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.to, '/categories/manual-dich')
    assert.equal(rows[0]?.note, 'manual')
  })

  await check('swapping VI and EN slugs writes no redirect for either live path', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'swap-probe',
      title: { vi: 'Danh mục hoán đổi', en: 'Swap category' },
      slug: { vi: 'swap-a', en: 'swap-b' },
    }, { redirects: Redirect })
    await updateCatalogCategory(CatalogCategory, SITE, created.id, {
      revision: created.revision,
      key: 'swap-probe',
      parent: null,
      title: { vi: 'Danh mục hoán đổi', en: 'Swap category' },
      slug: { vi: 'swap-b', en: 'swap-a' },
    }, { redirects: Redirect })

    const rows = await Redirect.find({
      siteId: SITE,
      from: { $in: ['/categories/swap-a', '/categories/swap-b'] },
    })
    assert.equal(rows.length, 0)
  })

  await check('reusing an old category slug removes its automatic redirect', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'reuse-probe',
      title: { vi: 'Danh mục dùng lại', en: 'Reuse category' },
      slug: { vi: 'reuse-cu', en: 'reuse-old' },
    })
    await updateCatalogCategory(CatalogCategory, SITE, created.id, {
      revision: created.revision,
      key: 'reuse-probe',
      parent: null,
      title: { vi: 'Danh mục dùng lại', en: 'Reuse category' },
      slug: { vi: 'reuse-moi', en: 'reuse-new' },
    }, { redirects: Redirect })

    const oldPaths = ['/categories/reuse-cu', '/categories/reuse-old']
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: { $in: oldPaths } }), 2)

    await createCatalogCategory(CatalogCategory, SITE, {
      key: 'reuse-owner',
      title: { vi: 'Danh mục nhận slug', en: 'Slug owner' },
      slug: { vi: 'reuse-cu', en: 'reuse-old' },
    }, { redirects: Redirect })

    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: { $in: oldPaths } }), 0)
  })

  await check('an old slug owned by another live category is not redirected', async () => {
    await createCatalogCategory(CatalogCategory, SITE, {
      key: 'occupied-owner',
      title: { vi: 'Danh mục giữ slug' },
      slug: { vi: 'occupied-cu' },
    })
    const mover = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'occupied-mover',
      title: { vi: 'Danh mục đổi slug', en: 'Moving category' },
      slug: { vi: 'occupied-a', en: 'occupied-cu' },
    })
    await updateCatalogCategory(CatalogCategory, SITE, mover.id, {
      revision: mover.revision,
      key: 'occupied-mover',
      parent: null,
      title: { vi: 'Danh mục đổi slug', en: 'Moving category' },
      slug: { vi: 'occupied-b', en: 'occupied-new' },
    }, { redirects: Redirect })

    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/categories/occupied-cu' }), 0)
  })

  await check('one old path with two new targets is skipped as ambiguous', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'ambiguous-probe',
      title: { vi: 'Danh mục mơ hồ', en: 'Ambiguous category' },
      slug: { vi: 'ambiguous-cu', en: 'ambiguous-cu' },
    })
    await updateCatalogCategory(CatalogCategory, SITE, created.id, {
      revision: created.revision,
      key: 'ambiguous-probe',
      parent: null,
      title: { vi: 'Danh mục mơ hồ', en: 'Ambiguous category' },
      slug: { vi: 'ambiguous-a', en: 'ambiguous-b' },
    }, { redirects: Redirect })

    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/categories/ambiguous-cu' }), 0)
  })

  await check('a published product slug change leaves a 301, a draft rename leaves none', async () => {
    const draft = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'probe-item-draft',
      title: { vi: 'Sản phẩm nháp' },
      slug: { vi: 'probe-item-draft-cu' },
    })
    await updateCatalogItem(CatalogItem, CatalogCategory, SITE, draft.id, {
      revision: draft.revision,
      key: 'probe-item-draft',
      title: { vi: 'Sản phẩm nháp' },
      slug: { vi: 'probe-item-draft-moi' },
    }, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/products/probe-item-draft-cu' }), 0)

    const item = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'probe-item-redirect',
      title: { vi: 'Sản phẩm redirect', en: 'Redirect product' },
      slug: { vi: 'probe-item-cu', en: 'probe-item-cu-en' },
    })
    const published = await runCatalogItemEvent(CatalogItem, SITE, item.id, {
      event: 'publish',
      revision: item.revision,
    }, { redirects: Redirect })
    const renamed = await updateCatalogItem(CatalogItem, CatalogCategory, SITE, item.id, {
      revision: published.revision,
      key: 'probe-item-redirect',
      title: { vi: 'Sản phẩm redirect', en: 'Redirect product' },
      slug: { vi: 'probe-item-moi', en: 'probe-item-moi-en' },
    }, { redirects: Redirect })

    const viRow = await Redirect.findOne({ siteId: SITE, from: '/products/probe-item-cu' }).lean<{ to: string, statusCode: number, note: string }>()
    const enRow = await Redirect.findOne({ siteId: SITE, from: '/products/probe-item-cu-en' }).lean<{ to: string }>()
    assert.equal(viRow?.to, '/products/probe-item-moi')
    assert.equal(viRow?.statusCode, 301)
    assert.equal(viRow?.note, 'auto: catalog item slug changed')
    assert.equal(enRow?.to, '/products/probe-item-moi-en')

    // Archiving hides the item, so its automatic rows no longer lead anywhere.
    await runCatalogItemEvent(CatalogItem, SITE, item.id, {
      event: 'archive',
      revision: renamed.revision,
    }, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({
      siteId: SITE,
      $or: [
        { from: { $in: ['/products/probe-item-cu', '/products/probe-item-cu-en'] } },
        { to: { $in: ['/products/probe-item-moi', '/products/probe-item-moi-en'] } },
      ],
    }), 0)
  })

  await check('publishing a product that reuses an old slug clears its automatic row', async () => {
    const first = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'probe-item-reuse-a',
      title: { vi: 'Sản phẩm cũ' },
      slug: { vi: 'probe-item-reuse-cu' },
    })
    const published = await runCatalogItemEvent(CatalogItem, SITE, first.id, {
      event: 'publish',
      revision: first.revision,
    }, { redirects: Redirect })
    await updateCatalogItem(CatalogItem, CatalogCategory, SITE, first.id, {
      revision: published.revision,
      key: 'probe-item-reuse-a',
      title: { vi: 'Sản phẩm cũ' },
      slug: { vi: 'probe-item-reuse-moi' },
    }, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/products/probe-item-reuse-cu' }), 1)

    const second = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'probe-item-reuse-b',
      title: { vi: 'Sản phẩm mới' },
      slug: { vi: 'probe-item-reuse-cu' },
    })
    const editedDraft = await updateCatalogItem(CatalogItem, CatalogCategory, SITE, second.id, {
      revision: second.revision,
      key: 'probe-item-reuse-b',
      title: { vi: 'Sản phẩm mới, sửa nháp' },
      slug: { vi: 'probe-item-reuse-cu' },
    }, { redirects: Redirect })
    // Editing a draft that merely reuses the slug must not steal the redirect.
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/products/probe-item-reuse-cu' }), 1)
    await runCatalogItemEvent(CatalogItem, SITE, second.id, {
      event: 'publish',
      revision: editedDraft.revision,
    }, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/products/probe-item-reuse-cu' }), 0)

    for (const id of [first.id, second.id]) {
      const current = await getCatalogItem(CatalogItem, SITE, id)
      await runCatalogItemEvent(CatalogItem, SITE, id, {
        event: 'archive',
        revision: current.revision,
      }, { redirects: Redirect })
    }
  })

  await check('deleting a catalog category clears its automatic rows', async () => {
    const doomed = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'probe-delete-redirect',
      title: { vi: 'Danh mục xoá redirect' },
      slug: { vi: 'probe-delete-cu' },
    })
    const renamed = await updateCatalogCategory(CatalogCategory, SITE, doomed.id, {
      revision: doomed.revision,
      key: 'probe-delete-redirect',
      parent: null,
      title: { vi: 'Danh mục xoá redirect' },
      slug: { vi: 'probe-delete-moi' },
    }, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/categories/probe-delete-cu' }), 1)

    await Redirect.create({
      siteId: SITE,
      from: '/probe-manual-catalog',
      to: '/categories/probe-delete-moi',
      statusCode: 301,
      isActive: true,
      note: 'manual probe',
      revision: 1,
    })

    await deleteCatalogCategory(CatalogCategory, CatalogItem, SITE, doomed.id, renamed.revision, { redirects: Redirect })
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/categories/probe-delete-cu' }), 0)
    assert.equal(await Redirect.countDocuments({ siteId: SITE, from: '/probe-manual-catalog' }), 1)
    await Redirect.deleteOne({ siteId: SITE, from: '/probe-manual-catalog' })
  })

  await check('a category with children cannot be deleted', async () => {
    const categories = await listCatalogCategories(CatalogCategory, CatalogItem, SITE)
    const root = categories.find(category => category.key === 'trang-suc')!

    // Put the branch back under the root so the guard has something to refuse.
    const child = categories.find(category => category.key === 'nhan')!
    await updateCatalogCategory(CatalogCategory, SITE, child.id, {
      revision: child.revision,
      key: 'nhan',
      parent: 'trang-suc',
      title: { vi: 'Nhẫn' },
      slug: { vi: 'nhan' },
    })

    await assert.rejects(
      deleteCatalogCategory(CatalogCategory, CatalogItem, SITE, root.id, root.revision),
      isServiceError(409, 'CATALOG_CATEGORY_HAS_CHILDREN'),
    )
  })

  await check('a category in use by an item cannot be deleted', async () => {
    const category = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'phu-kien',
      title: { vi: 'Phụ kiện' },
      slug: { vi: 'phu-kien' },
    })
    await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'vong-tay',
      title: { vi: 'Vòng tay' },
      slug: { vi: 'vong-tay' },
      categories: ['phu-kien'],
    })

    const categories = await listCatalogCategories(CatalogCategory, CatalogItem, SITE)
    const inUse = categories.find(entry => entry.key === 'phu-kien')!
    assert.equal(inUse.itemCount, 1)

    await assert.rejects(
      deleteCatalogCategory(CatalogCategory, CatalogItem, SITE, inUse.id, inUse.revision),
      isServiceError(409, 'CATALOG_CATEGORY_IN_USE'),
    )
  })

  await check('delete then restore moves the item through deleted and draft', async () => {
    const before = await getCatalogItem(CatalogItem, SITE, itemId)
    const deleted = await runCatalogItemEvent(CatalogItem, SITE, itemId, { event: 'delete', revision: before.revision })
    assert.equal(deleted.status, 'deleted')
    assert.ok(deleted.deletedAt)

    const afterDelete = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { status: 'published' })
    assert.equal(afterDelete.data.length, 0)

    const restored = await runCatalogItemEvent(CatalogItem, SITE, itemId, { event: 'restore', revision: deleted.revision })
    assert.equal(restored.status, 'draft')
    assert.equal(restored.deletedAt, null)
  })

  await check('a variable product needs at least one variant', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'bien-the-thieu',
        type: 'variable',
        title: { vi: 'Biến thể thiếu' },
        slug: { vi: 'bien-the-thieu' },
        basePrice: 100000,
      }),
      isServiceError(422, 'CATALOG_PAYLOAD_INVALID'),
    )
  })

  await check('a simple product cannot carry variants', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'don-co-bien-the',
        type: 'simple',
        title: { vi: 'Đơn có biến thể' },
        slug: { vi: 'don-co-bien-the' },
        variants: [{ sku: 'X-1', basePrice: 1000 }],
      }),
      isServiceError(422, 'CATALOG_PAYLOAD_INVALID'),
    )
  })

  let variantItemId = ''
  await check('variants and attributes round-trip through create and list', async () => {
    const created = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'dem-bien-the',
      type: 'variable',
      title: { vi: 'Đệm biến thể' },
      slug: { vi: 'dem-bien-the' },
      basePrice: 2000000,
      attributes: [
        { name: { vi: 'Chất liệu' }, value: { vi: 'Cao su non' } },
      ],
      variants: [
        {
          sku: 'DEM-1M6',
          basePrice: 2000000,
          salePrice: 1800000,
          stock: 4,
          name: { vi: '1m6' },
          // The storefront builds its size/colour chips from these pairs.
          attributes: [{ name: { vi: 'Kích thước' }, value: { vi: '1m6' } }],
        },
        { sku: 'DEM-1M8', basePrice: 2400000, stock: 0, name: { vi: '1m8' } },
      ],
    })
    variantItemId = created.id
    assert.equal(created.variants.length, 2)
    assert.equal(created.variants[0]?.sku, 'DEM-1M6')
    assert.equal(created.variants[0]?.salePrice, 1800000)
    assert.deepEqual(created.variants[0]?.attributes, [{ name: { vi: 'Kích thước' }, value: { vi: '1m6' } }])
    assert.equal(created.attributes[0]?.value.vi, 'Cao su non')

    const listed = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { q: 'dem-bien-the' })
    assert.equal(listed.data[0]?.variants.length, 2)
  })

  await check('two variants cannot share a SKU', async () => {
    await assert.rejects(
      createCatalogItem(CatalogItem, CatalogCategory, SITE, {
        key: 'dem-trung-sku',
        type: 'variable',
        title: { vi: 'Đệm trùng SKU' },
        slug: { vi: 'dem-trung-sku' },
        variants: [
          { sku: 'TRUNG-1', basePrice: 1000 },
          { sku: 'trung-1', basePrice: 2000 },
        ],
      }),
      isServiceError(422, 'CATALOG_PAYLOAD_INVALID'),
    )
  })

  await check('updating variants replaces the set without dropping attributes', async () => {
    const before = await getCatalogItem(CatalogItem, SITE, variantItemId)
    const updated = await updateCatalogItem(CatalogItem, CatalogCategory, SITE, variantItemId, {
      revision: before.revision,
      key: 'dem-bien-the',
      type: 'variable',
      title: { vi: 'Đệm biến thể' },
      slug: { vi: 'dem-bien-the' },
      basePrice: 2000000,
      attributes: before.attributes,
      variants: [
        { sku: 'DEM-1M6', basePrice: 2000000, stock: 5, isActive: true, manageStock: true },
        {
          sku: 'DEM-2M',
          basePrice: 3000000,
          stock: 2,
          isActive: false,
          manageStock: true,
          attributes: [
            { name: { vi: 'Kích thước' }, value: { vi: '2m' } },
            { name: { vi: 'Màu sắc' }, value: { vi: 'Xám' } },
          ],
        },
      ],
    })
    assert.equal(updated.variants.length, 2)
    assert.equal(updated.variants[1]?.sku, 'DEM-2M')
    assert.equal(updated.variants[1]?.isActive, false)
    assert.deepEqual(updated.variants[1]?.attributes.map(attribute => attribute.value.vi), ['2m', 'Xám'])
    assert.deepEqual(updated.variants[0]?.attributes, [], 'a variant without options keeps none')
    assert.equal(updated.attributes.length, 1)
    assert.equal(updated.revision, before.revision + 1)
  })


  let bulkA = ''
  let bulkB = ''
  await check('bulk price/stock updates only the rows that differ, per row', async () => {
    const a = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'bulk-a',
      title: { vi: 'Bulk A' },
      slug: { vi: 'bulk-a' },
      basePrice: 100000,
      stock: 1,
    })
    const b = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'bulk-b',
      title: { vi: 'Bulk B' },
      slug: { vi: 'bulk-b' },
      basePrice: 200000,
    })
    bulkA = a.id
    bulkB = b.id

    const result = await bulkUpdateCatalogItems(CatalogItem, SITE, {
      items: [
        { id: a.id, revision: a.revision, basePrice: 150000, salePrice: 120000, stock: 5 },
        { id: b.id, revision: 99, basePrice: 1 },
      ],
    })
    assert.equal(result.succeeded, 1)
    assert.equal(result.failed, 1)
    assert.equal(result.results[1]?.error?.code, 'CATALOG_REVISION_CONFLICT')

    const updatedA = await getCatalogItem(CatalogItem, SITE, a.id)
    assert.equal(updatedA.basePrice, 150000)
    assert.equal(updatedA.salePrice, 120000)
    assert.equal(updatedA.stock, 5)
    assert.equal(updatedA.revision, a.revision + 1)

    const untouchedB = await getCatalogItem(CatalogItem, SITE, b.id)
    assert.equal(untouchedB.basePrice, 200000)
  })

  await check('a bulk row with salePrice above basePrice is refused', async () => {
    const current = await getCatalogItem(CatalogItem, SITE, bulkA)
    const result = await bulkUpdateCatalogItems(CatalogItem, SITE, {
      items: [{ id: bulkA, revision: current.revision, basePrice: 100000, salePrice: 200000 }],
    })
    assert.equal(result.results[0]?.ok, false)
    assert.equal(result.results[0]?.error?.code, 'CATALOG_SALE_PRICE_INVALID')
    const after = await getCatalogItem(CatalogItem, SITE, bulkA)
    assert.equal(after.basePrice, 150000)
  })

  await check('a repeated row and a foreign id fail without touching the good rows', async () => {
    const current = await getCatalogItem(CatalogItem, SITE, bulkA)
    const result = await bulkUpdateCatalogItems(CatalogItem, SITE, {
      items: [
        { id: bulkA, revision: current.revision, stock: 7 },
        { id: bulkA, revision: current.revision, stock: 8 },
        { id: '6af293983b8231e7d62544fe', revision: 1, stock: 1 },
      ],
    })
    assert.equal(result.succeeded, 1)
    assert.equal(result.results[1]?.error?.code, 'CATALOG_BULK_DUPLICATE')
    assert.equal(result.results[2]?.error?.code, 'CATALOG_ITEM_NOT_FOUND')
    const after = await getCatalogItem(CatalogItem, SITE, bulkA)
    assert.equal(after.stock, 7)
  })

  await check('a no-change bulk row is ok and does not bump the revision', async () => {
    const current = await getCatalogItem(CatalogItem, SITE, bulkB)
    const result = await bulkUpdateCatalogItems(CatalogItem, SITE, {
      items: [{ id: bulkB, revision: current.revision, basePrice: 200000, stock: 0 }],
    })
    assert.equal(result.results[0]?.ok, true)
    const after = await getCatalogItem(CatalogItem, SITE, bulkB)
    assert.equal(after.revision, current.revision)
  })

  await check('a filter-scoped bulk updates every live record the filter matches', async () => {
    const deleted = await createCatalogItem(CatalogItem, CatalogCategory, SITE, {
      key: 'bulk-deleted',
      title: { vi: 'Bulk deleted' },
      slug: { vi: 'bulk-deleted' },
      basePrice: 300000,
      stock: 4,
    })
    const removed = await runCatalogItemEvent(CatalogItem, SITE, deleted.id, { event: 'delete', revision: deleted.revision })
    assert.equal(removed.status, 'deleted')

    const beforeB = await getCatalogItem(CatalogItem, SITE, bulkB)
    const result = await bulkUpdateCatalogItemsByFilter(CatalogItem, CatalogCategory, SITE, {
      filter: { q: 'bulk-' },
      stock: 3,
    })
    assert.equal(result.failed, 0)
    assert.equal(result.succeeded, 2)

    const afterA = await getCatalogItem(CatalogItem, SITE, bulkA)
    const afterB = await getCatalogItem(CatalogItem, SITE, bulkB)
    assert.equal(afterA.stock, 3)
    assert.equal(afterB.stock, 3)
    assert.equal(afterA.basePrice, 150000)
    assert.equal(afterB.revision, beforeB.revision + 1)

    const stillDeleted = await getCatalogItem(CatalogItem, SITE, deleted.id)
    assert.equal(stillDeleted.stock, 4)
    assert.equal(stillDeleted.revision, removed.revision)
  })

  await check('a filter-scoped bulk refuses a filter that matches nothing', async () => {
    await assert.rejects(
      () => bulkUpdateCatalogItemsByFilter(CatalogItem, CatalogCategory, SITE, {
        filter: { status: 'published', q: 'bulk-' },
        stock: 1,
      }),
      isServiceError(404, 'CATALOG_BULK_EMPTY'),
    )
    await assert.rejects(
      () => bulkUpdateCatalogItemsByFilter(CatalogItem, CatalogCategory, SITE, {
        filter: { category: 'khong-ton-tai' },
        stock: 1,
      }),
      isServiceError(404, 'CATALOG_BULK_EMPTY'),
    )
    const after = await getCatalogItem(CatalogItem, SITE, bulkA)
    assert.equal(after.stock, 3)
  })

  await check('a filter-scoped bulk keeps per-row validation and audit', async () => {
    const a = await getCatalogItem(CatalogItem, SITE, bulkA)
    const result = await bulkUpdateCatalogItemsByFilter(CatalogItem, CatalogCategory, SITE, {
      filter: { q: 'bulk-a' },
      basePrice: 100000,
      salePrice: 250000,
    })
    assert.equal(result.results.length, 1)
    assert.equal(result.results[0]?.error?.code, 'CATALOG_SALE_PRICE_INVALID')
    const after = await getCatalogItem(CatalogItem, SITE, bulkA)
    assert.equal(after.basePrice, a.basePrice)
    assert.equal(after.revision, a.revision)
  })

  await check('a filter-scoped bulk refuses a filter wider than 500 records', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      siteId: SITE,
      key: `cap-${index}`,
      title: { vi: `Cap ${index}` },
      slug: { vi: `cap-${index}` },
      status: 'draft',
      type: 'simple',
      basePrice: 1000,
      salePrice: null,
      stock: 1,
      revision: 1,
      isActive: false,
      isDeleted: false,
      categories: [],
      tags: [],
      attributes: [],
      variants: [],
    }))
    await CatalogItem.collection.insertMany(rows)
    await assert.rejects(
      () => bulkUpdateCatalogItemsByFilter(CatalogItem, CatalogCategory, SITE, {
        filter: { q: 'cap-' },
        stock: 2,
      }),
      isServiceError(422, 'CATALOG_BULK_TOO_LARGE'),
    )
    assert.equal(await CatalogItem.countDocuments({ siteId: SITE, stock: 2, key: /^cap-/ }), 0)
    await CatalogItem.deleteMany({ siteId: SITE, key: /^cap-/ })
  })

} finally {
  await dropTestDatabase(connection)
  await closeDatabaseConnections()
}

console.log(`\n✅ Catalog service checks: ${checks} passed, 0 not run`)
