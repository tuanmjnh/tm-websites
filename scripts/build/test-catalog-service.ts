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
  runCatalogItemEvent,
  updateCatalogCategory,
  updateCatalogItem,
} from '../../tm-cms/server/services/catalogService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

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

const connection = await connectDatabase({ uri: 'mongodb://127.0.0.1:27017', database: 'tm_test_catalog_service' })
await connection.dropDatabase()
const { CatalogItem, CatalogCategory } = await prepareDatabase(connection)

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'

console.log('catalog service')

try {
  let parentId = ''
  await check('creates a category with a normalized key and computed path', async () => {
    const created = await createCatalogCategory(CatalogCategory, SITE, {
      key: 'Trang sức',
      title: { vi: 'Trang sức' },
      slug: { vi: 'Trang Sức' },
    })
    parentId = created.id
    assert.equal(created.key, 'trang-suc')
    assert.equal(created.slug.vi, 'trang-suc')
    assert.equal(created.fullPath.vi, '/trang-suc')
    assert.equal(created.revision, 1)
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

  await check('the list filter composes status, tag, search and category subtree', async () => {
    const byStatus = await listCatalogItems(CatalogItem, CatalogCategory, SITE, { status: 'published' })
    assert.equal(byStatus.data.length, 1)
    assert.equal(byStatus.counts.published, 1)
    assert.equal(byStatus.counts.draft, 0)

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
} finally {
  await connection.dropDatabase()
  await closeDatabaseConnections()
}

console.log(`\n✅ Catalog service checks: ${checks} passed, 0 not run`)
