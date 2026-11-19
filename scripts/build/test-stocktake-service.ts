import assert from 'node:assert/strict'
import { Types } from 'mongoose'
import { StocktakeServiceError } from '../../tm-cms/server/services/stocktakeService.js'
import {
  cancelStocktake,
  completeStocktake,
  createStocktake,
  getStocktake,
  listStocktakes,
} from '../../tm-cms/server/services/stocktakeService.js'
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

function isStocktakeError(status: number, code: string) {
  return (error: unknown) => error instanceof StocktakeServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'

console.log('Stocktake — count a warehouse, explain the adjustment, keep the record\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_stocktake' }

async function run() {
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
    const { Stocktake, Inventory, InventoryTransaction, Audit } = models
    const audit = { model: Audit, actor: { id: 'test-operator', name: 'Test operator', email: '' } }

    await Inventory.create({
      siteId: SITE,
      itemId: 'item-1',
      variantId: null,
      warehouseId: 'wh-1',
      sku: 'SKU-1',
      quantityOnHand: 10,
      quantityReserved: 0,
      binLocation: '',
      lowStockThreshold: 0,
      revision: 1,
    })

    const draft = await createStocktake(Stocktake, SITE, {
      code: 'st-01',
      warehouseId: 'wh-1',
      note: 'Kiểm kê tháng 11',
      lines: [
        { itemId: 'item-1', variantId: null, sku: 'SKU-1', itemName: 'Hàng A', countedQuantity: 7 },
      ],
    }, { audit })

    await check('a draft keeps the counted quantity and starts at zero difference', async () => {
      assert.equal(draft.stocktake.code, 'ST-01')
      assert.equal(draft.stocktake.status, 'draft')
      assert.equal(draft.stocktake.lines[0]!.countedQuantity, 7)
      assert.equal(draft.stocktake.lines[0]!.expectedQuantity, 0)
    })

    await check('completing a stocktake books the difference and moves the balance', async () => {
      const completed = await completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, draft.stocktake.id, {
        revision: 1,
      }, { audit })
      assert.equal(completed.status, 'completed')
      assert.equal(completed.lines[0]!.expectedQuantity, 10)
      assert.equal(completed.lines[0]!.countedQuantity, 7)
      assert.equal(completed.lines[0]!.difference, -3)
      assert.ok(completed.completedAt)

      const balance = await Inventory.findOne({ siteId: SITE, itemId: 'item-1', warehouseId: 'wh-1' }).lean<{ quantityOnHand: number } | null>()
      assert.equal(balance?.quantityOnHand, 7)

      const tx = await InventoryTransaction.findOne({ siteId: SITE, referenceModel: 'Stocktake', referenceCode: 'ST-01' })
        .lean<{ type: string, quantityChange: number } | null>()
      assert.equal(tx?.type, 'adjustment_dec')
      assert.equal(tx?.quantityChange, -3)
    })

    await check('a completed stocktake is immutable', async () => {
      await assert.rejects(
        () => completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, draft.stocktake.id, { revision: 2 }, { audit }),
        isStocktakeError(409, 'STOCKTAKE_LOCKED'),
      )
      await assert.rejects(
        () => cancelStocktake(Stocktake, SITE, draft.stocktake.id, { audit }),
        isStocktakeError(409, 'STOCKTAKE_LOCKED'),
      )
    })

    const second = await createStocktake(Stocktake, SITE, {
      code: 'ST-02',
      warehouseId: 'wh-1',
      lines: [
        { itemId: 'item-2', variantId: null, sku: 'SKU-2', itemName: 'Hàng B', countedQuantity: 5 },
      ],
    }, { audit })

    await check('a count with no balance creates the balance from zero', async () => {
      const completed = await completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, second.stocktake.id, { revision: 1 }, { audit })
      assert.equal(completed.lines[0]!.expectedQuantity, 0)
      assert.equal(completed.lines[0]!.difference, 5)
      const balance = await Inventory.findOne({ siteId: SITE, itemId: 'item-2', warehouseId: 'wh-1' }).lean<{ quantityOnHand: number } | null>()
      assert.equal(balance?.quantityOnHand, 5)
    })

    await check('completing can override the counted quantity sent with the request', async () => {
      const third = await createStocktake(Stocktake, SITE, {
        code: 'ST-03',
        warehouseId: 'wh-1',
        lines: [
          { itemId: 'item-1', variantId: null, sku: 'SKU-1', itemName: 'Hàng A', countedQuantity: 7 },
        ],
      }, { audit })
      const completed = await completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, third.stocktake.id, {
        revision: 1,
        lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 12 }],
      }, { audit })
      assert.equal(completed.lines[0]!.countedQuantity, 12)
      assert.equal(completed.lines[0]!.difference, 5)
      const balance = await Inventory.findOne({ siteId: SITE, itemId: 'item-1', warehouseId: 'wh-1' }).lean<{ quantityOnHand: number } | null>()
      assert.equal(balance?.quantityOnHand, 12)
    })

    await check('a draft can be cancelled and a code cannot be reused while live', async () => {
      const draft2 = await createStocktake(Stocktake, SITE, {
        code: 'ST-04',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1 }],
      }, { audit })
      await cancelStocktake(Stocktake, SITE, draft2.stocktake.id, { audit })
      const cancelled = await getStocktake(Stocktake, SITE, draft2.stocktake.id)
      assert.equal(cancelled.status, 'cancelled')

      await assert.rejects(
        () => createStocktake(Stocktake, SITE, {
          code: 'st-01',
          warehouseId: 'wh-1',
          lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1 }],
        }, { audit }),
        isStocktakeError(409, 'STOCKTAKE_CODE_TAKEN'),
      )
    })

    await check('a negative or non-integer count is refused', async () => {
      const draft3 = await createStocktake(Stocktake, SITE, {
        code: 'ST-05',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1 }],
      }, { audit })
      await assert.rejects(
        () => completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, draft3.stocktake.id, {
          revision: 1,
          lines: [{ itemId: 'item-1', variantId: null, countedQuantity: -1 }],
        }, { audit }),
        isStocktakeError(422, 'STOCKTAKE_COUNT_INVALID'),
      )
      await assert.rejects(
        () => completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, draft3.stocktake.id, {
          revision: 1,
          lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1.5 }],
        }, { audit }),
        isStocktakeError(422, 'STOCKTAKE_COUNT_INVALID'),
      )
    })

    await check('a stale revision is refused', async () => {
      const draft4 = await createStocktake(Stocktake, SITE, {
        code: 'ST-06',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1 }],
      }, { audit })
      await assert.rejects(
        () => completeStocktake(Stocktake, Inventory, InventoryTransaction, SITE, draft4.stocktake.id, { revision: 99 }, { audit }),
        isStocktakeError(409, 'STOCKTAKE_REVISION_CONFLICT'),
      )
    })

    await check('a second tenant sees none of it', async () => {
      const other = await listStocktakes(Stocktake, OTHER_SITE)
      assert.equal(other.data.length, 0)
      const created = await createStocktake(Stocktake, OTHER_SITE, {
        code: 'ST-01',
        warehouseId: 'wh-1',
        lines: [{ itemId: 'item-1', variantId: null, countedQuantity: 1 }],
      }, { audit })
      assert.equal(created.stocktake.code, 'ST-01')
    })

    await check('the trail records the count being booked', async () => {
      const rows = await Audit.find({ siteId: SITE }).select({ resourceType: 1, action: 1, resourceKey: 1 }).lean<{ resourceType: string, action: string, resourceKey: string }[]>()
      assert.ok(rows.some(row => row.resourceType === 'stocktake' && row.action === 'create'))
      assert.ok(rows.some(row => row.resourceType === 'stocktake' && row.action === 'update'))
      assert.ok(rows.some(row => row.resourceType === 'stocktake' && row.action === 'cancel'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Stocktake checks: ${checks} passed, ${notRun} not run\n`)
