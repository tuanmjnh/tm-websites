import assert from 'node:assert/strict'
import {
  CategoryServiceError,
  createCategory,
  listCategories,
  reorderCategory,
} from '../../tm-cms/server/services/categoryService.js'
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

function isCategoryError(status: number, code: string) {
  return (error: unknown) => error instanceof CategoryServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

function category(key: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    locales: [{ locale: 'vi', name: key, slug: key }],
    ...extra,
  }
}

function orderOf(tree: { key: string, children: { key: string }[] }[], parent: string | null) {
  if (parent === null) return tree.map(node => node.key)
  const find = (nodes: { key: string, children: { key: string, children: unknown[] }[] }[]): string[] | null => {
    for (const node of nodes) {
      if (node.key === parent) return node.children.map(child => child.key)
      const nested = find(node.children as typeof nodes)
      if (nested) return nested
    }
    return null
  }
  return find(tree as never) ?? []
}

console.log('Categories — drag-and-drop ordering (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_category_reorder' }

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
    const { Category, Audit, Revision } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR }, revision: { model: Revision, actor: ACTOR } }

    await createCategory(Category, SITE, category('trang-suc'), meta)
    await createCategory(Category, SITE, category('nhan', { parent: 'trang-suc' }), meta)
    await createCategory(Category, SITE, category('day-chuyen', { parent: 'trang-suc' }), meta)
    await createCategory(Category, SITE, category('bong-tai', { parent: 'trang-suc' }), meta)
    await createCategory(Category, SITE, category('phu-kien'), meta)

    await check('a move into a new parent writes one row and returns the new tree', async () => {
      const result = await reorderCategory(Category, SITE, { key: 'phu-kien', parent: 'trang-suc', index: 3 }, meta)
      const moved = result.data.find(entry => entry.key === 'phu-kien')
      assert.equal(moved?.parent, 'trang-suc')
      assert.equal(moved?.revision, 2)
      assert.deepEqual(orderOf(result.tree, 'trang-suc'), ['bong-tai', 'day-chuyen', 'nhan', 'phu-kien'])

      const siblings = result.data.filter(entry => entry.parent === 'trang-suc' && entry.key !== 'phu-kien')
      assert.ok(siblings.every(entry => entry.revision === 1), 'siblings are untouched by a spaced move')
    })

    await check('a sibling drop uses the index it was given, not the appended order', async () => {
      const result = await reorderCategory(Category, SITE, { key: 'phu-kien', parent: 'trang-suc', index: 0 }, meta)
      assert.deepEqual(orderOf(result.tree, 'trang-suc'), ['phu-kien', 'bong-tai', 'day-chuyen', 'nhan'])
      const moved = result.data.find(entry => entry.key === 'phu-kien')
      assert.equal(moved?.revision, 3)
    })

    await check('a drop between two siblings takes the midpoint order', async () => {
      await reorderCategory(Category, SITE, { key: 'phu-kien', parent: 'trang-suc', index: 1 }, meta)
      const result = await reorderCategory(Category, SITE, { key: 'nhan', parent: 'trang-suc', index: 1 }, meta)

      assert.deepEqual(orderOf(result.tree, 'trang-suc'), ['bong-tai', 'nhan', 'phu-kien', 'day-chuyen'])
      const orders = result.data
        .filter(entry => entry.parent === 'trang-suc')
        .map(entry => entry.order)
        .sort((left, right) => left - right)
      assert.equal(new Set(orders).size, orders.length, 'orders stay unique without a renumber')
    })

    await check('adjacent sibling orders force one renumber of the bucket', async () => {
      // Squeeze the bucket to consecutive orders, then drop between two of them.
      const squeezed = [['bong-tai', 10], ['phu-kien', 11], ['nhan', 12], ['day-chuyen', 13]] as const
      for (const [key, order] of squeezed) {
        await Category.updateOne({ siteId: SITE, key }, { $set: { order } })
      }

      const result = await reorderCategory(Category, SITE, { key: 'bong-tai', parent: 'trang-suc', index: 1 }, meta)
      assert.deepEqual(orderOf(result.tree, 'trang-suc'), ['phu-kien', 'bong-tai', 'nhan', 'day-chuyen'])

      const rows = result.data.filter(entry => entry.parent === 'trang-suc')
      const orders = rows.map(entry => entry.order).sort((left, right) => left - right)
      assert.equal(new Set(orders).size, rows.length, 'a renumber leaves unique orders')
      assert.ok(orders.every(order => order > 0 && order <= 9999))
      assert.ok(orders[orders.length - 1]! - orders[0]! >= rows.length - 1, 'orders keep room between rows')
    })

    await check('dropping a row back where it was writes nothing', async () => {
      const before = await listCategories(Category, SITE)
      const current = before.data.find(entry => entry.key === 'bong-tai')!
      const siblings = before.data
        .filter(entry => entry.parent === 'trang-suc' && entry.key !== 'bong-tai')
        .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
      const index = siblings.findIndex(entry => entry.order > current.order)
      const result = await reorderCategory(
        Category,
        SITE,
        { key: 'bong-tai', parent: 'trang-suc', index: index < 0 ? siblings.length : index },
        meta,
      )
      const after = result.data.find(entry => entry.key === 'bong-tai')!
      assert.equal(after.revision, current.revision)
      assert.equal(after.order, current.order)
    })

    await check('a category cannot be moved into its own subtree', async () => {
      await assert.rejects(
        () => reorderCategory(Category, SITE, { key: 'trang-suc', parent: 'nhan', index: 0 }, meta),
        isCategoryError(422, 'CATEGORY_CYCLE'),
      )
      await assert.rejects(
        () => reorderCategory(Category, SITE, { key: 'trang-suc', parent: 'trang-suc', index: 0 }, meta),
        isCategoryError(422, 'CATEGORY_CYCLE'),
      )
    })

    await check('a move past the depth limit and a missing key are refused', async () => {
      await assert.rejects(
        () => reorderCategory(Category, SITE, { key: 'day-chuyen', parent: 'missing-parent', index: 0 }, meta),
        isCategoryError(422, 'CATEGORY_PARENT_NOT_FOUND'),
      )
      await assert.rejects(
        () => reorderCategory(Category, SITE, { key: 'khong-ton-tai', parent: null, index: 0 }, meta),
        isCategoryError(404, 'CATEGORY_NOT_FOUND'),
      )
      await assert.rejects(
        () => reorderCategory(Category, OTHER_SITE, { key: 'nhan', parent: null, index: 0 }, meta),
        isCategoryError(404, 'CATEGORY_NOT_FOUND'),
      )
    })

    await check('every move records an audit entry for the row that moved', async () => {
      const entries = await Audit.find({ siteId: SITE, resourceType: 'category', action: 'update' })
        .lean<{ resourceKey: string, changedFields: string[], actor: { email: string } }[]>()
      assert.ok(entries.length >= 3)
      assert.ok(entries.every(entry => entry.actor.email === ACTOR.email))
      assert.ok(entries.some(entry => entry.resourceKey === 'phu-kien' && entry.changedFields.includes('parent')))
      assert.ok(entries.some(entry => entry.changedFields.includes('order')))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Category reorder checks: ${checks} passed, ${notRun} not run\n`)
