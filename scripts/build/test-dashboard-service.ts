import assert from 'node:assert/strict'
import { readDashboardSummary } from '../../tm-cms/server/services/dashboardService.js'
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

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_dashboard' }

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
    const models = await prepareDatabase(connection)

    await check('an empty site answers zero everywhere', async () => {
      const summary = await readDashboardSummary(models, SITE)
      assert.deepEqual(summary, {
        content: { published: 0, draft: 0 },
        catalog: { published: 0, draft: 0 },
        orders: { open: 0 },
        quotations: { open: 0 },
        customers: { total: 0 },
        inventory: { lowStock: 0 },
      })
    })

    const at = new Date()
    const contentRow = (siteId: string, key: string, status: string) => ({
      siteId,
      key,
      status,
      locales: [{ locale: 'vi', slug: `${siteId}-${key}` }],
      createdAt: at,
      updatedAt: at,
    })
    await connection.collection('content').insertMany([
      contentRow(SITE, 'a', 'published'),
      contentRow(SITE, 'b', 'published'),
      contentRow(SITE, 'c', 'draft'),
      contentRow(SITE, 'd', 'deleted'),
      contentRow(OTHER_SITE, 'a', 'published'),
    ])
    const productRow = (siteId: string, key: string, status: string, isDeleted: boolean) => ({
      siteId,
      key,
      status,
      slug: { vi: `${siteId}-${key}` },
      isDeleted,
      createdAt: at,
      updatedAt: at,
    })
    await connection.collection('catalog_items').insertMany([
      productRow(SITE, 'p1', 'published', false),
      productRow(SITE, 'p2', 'published', false),
      productRow(SITE, 'p3', 'draft', false),
      // A soft-deleted published row is not on sale.
      productRow(SITE, 'p4', 'published', true),
      productRow(OTHER_SITE, 'p1', 'published', false),
    ])
    await connection.collection('crm_orders').insertMany([
      { siteId: SITE, code: 'O1', status: 'pending', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'O2', status: 'shipped', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'O3', status: 'completed', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'O4', status: 'pending', isDeleted: true, createdAt: at, updatedAt: at },
      { siteId: OTHER_SITE, code: 'O1', status: 'pending', isDeleted: false, createdAt: at, updatedAt: at },
    ])
    await connection.collection('crm_quotations').insertMany([
      { siteId: SITE, code: 'Q1', status: 'sent', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'Q2', status: 'draft', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'Q3', status: 'accepted', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'Q4', status: 'converted', isDeleted: false, createdAt: at, updatedAt: at },
    ])
    await connection.collection('crm_customers').insertMany([
      { siteId: SITE, code: 'C1', subjectId: 'subject-c1', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'C2', subjectId: 'subject-c2', isDeleted: false, createdAt: at, updatedAt: at },
      { siteId: SITE, code: 'C3', subjectId: 'subject-c3', isDeleted: true, createdAt: at, updatedAt: at },
    ])
    // The balance index is (site, item, variant, warehouse), so each fixture row
    // owns its own item id.
    const stockRow = (siteId: string, id: string, quantityOnHand: number, quantityReserved: number, lowStockThreshold: number, isDeleted = false) => ({
      siteId,
      sku: id,
      itemId: `item-${id}`,
      variantId: null,
      warehouseId: 'wh-1',
      quantityOnHand,
      quantityReserved,
      lowStockThreshold,
      isDeleted,
    })
    await connection.collection('crm_inventories').insertMany([
      // No threshold: not tracked, so never "low".
      stockRow(SITE, 'I1', 0, 0, 0),
      // Exactly at the threshold counts.
      stockRow(SITE, 'I2', 5, 0, 5),
      // Available stock (6 - 2) is at the threshold after reservations.
      stockRow(SITE, 'I3', 6, 2, 5),
      stockRow(SITE, 'I4', 50, 0, 5),
      stockRow(SITE, 'I5', 1, 0, 5, true),
      stockRow(OTHER_SITE, 'I1', 0, 0, 5),
    ])

    await check('published and draft counts follow the status a list shows', async () => {
      const summary = await readDashboardSummary(models, SITE)
      assert.deepEqual(summary.content, { published: 2, draft: 1 })
      assert.deepEqual(summary.catalog, { published: 2, draft: 1 }, 'a soft-deleted published row is not on sale')
    })

    await check('only orders and quotations still needing an action are open', async () => {
      const summary = await readDashboardSummary(models, SITE)
      assert.equal(summary.orders.open, 2, 'pending and shipped; completed and soft-deleted are out')
      assert.equal(summary.quotations.open, 2, 'draft and sent; accepted and converted are out')
    })

    await check('customers count live records only', async () => {
      const summary = await readDashboardSummary(models, SITE)
      assert.equal(summary.customers.total, 2)
    })

    await check('low stock uses available quantity and an explicit threshold', async () => {
      const summary = await readDashboardSummary(models, SITE)
      assert.equal(summary.inventory.lowStock, 2, 'threshold 0 is untracked; reservations reduce availability')
    })

    await check('another site never contributes to the counts', async () => {
      const other = await readDashboardSummary(models, OTHER_SITE)
      assert.deepEqual(other.content, { published: 1, draft: 0 })
      assert.deepEqual(other.catalog, { published: 1, draft: 0 })
      assert.equal(other.orders.open, 1)
      assert.equal(other.quotations.open, 0)
      assert.equal(other.customers.total, 0)
      assert.equal(other.inventory.lowStock, 1)
    })
  } finally {
    await closeDatabaseConnections()
  }
}

try {
  await integration()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Dashboard checks failed')
}
