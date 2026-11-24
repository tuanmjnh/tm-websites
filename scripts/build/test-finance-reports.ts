import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
import {
  FinanceReportError,
  csvCell,
  exportLedgerCsv,
  financeAging,
  financeLedger,
  financeSummary,
  localDayOf,
  localDayStartUtc,
  resolveRange,
} from '../../tm-cms/server/services/financeReportService.js'
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

function isReportError(status: number, code: string) {
  return (error: unknown) => error instanceof FinanceReportError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'

console.log('Finance reports — money in/out, aging, ledger and a safe CSV (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_finance_reports')

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
    await dropTestDatabase(connection)
    const { Payment, Order, PurchaseOrder } = await prepareDatabase(connection)
    const models = { Payment, Order, PurchaseOrder }

    const NOW = new Date('2026-11-15T05:00:00.000Z') // 12:00 in Vietnam
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
    const referenceId = '651111111111111111111111'

    const insertPayment = (overrides: Record<string, unknown>) => Payment.create({
      siteId: SITE,
      code: `PT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      direction: 'receivable',
      referenceModel: 'Order',
      referenceId,
      referenceCode: 'ORD-1',
      amount: 1_000_000,
      currency: 'VND',
      method: 'cash',
      state: 'posted',
      paidAt: NOW,
      revision: 1,
      ...overrides,
    })

    // October: 23:30 local on the 31st belongs to October; 00:30 local on Nov 1 does not.
    await insertPayment({ code: 'PT-LATE-OCT', amount: 2_000_000, method: 'banking', paidAt: new Date('2026-10-31T16:30:00.000Z') })
    await insertPayment({ code: 'PT-EARLY-NOV', amount: 3_000_000, method: 'banking', paidAt: new Date('2026-10-31T17:30:00.000Z') })
    await insertPayment({ code: 'PT-CASH-OCT', amount: 500_000, method: 'cash', paidAt: new Date('2026-10-10T03:00:00.000Z') })
    await insertPayment({ code: 'PT-VOID-OCT', amount: 900_000, method: 'cash', paidAt: new Date('2026-10-12T03:00:00.000Z'), state: 'voided' })
    await insertPayment({ code: 'PT-OUT-OCT', amount: 1_200_000, direction: 'payable', referenceModel: 'PurchaseOrder', method: 'banking', paidAt: new Date('2026-10-20T03:00:00.000Z') })
    await insertPayment({ code: 'PT-OTHER', siteId: OTHER_SITE, amount: 7_000_000, paidAt: new Date('2026-10-15T03:00:00.000Z') })

    await Order.create([
      { siteId: SITE, code: 'ORD-OPEN', status: 'processing', totalAmount: 5_000_000, paidAmount: 2_000_000, createdAt: daysAgo(40) },
      { siteId: SITE, code: 'ORD-NEW', status: 'pending', totalAmount: 1_000_000, paidAmount: 0, createdAt: daysAgo(0) },
      { siteId: SITE, code: 'ORD-DONE', status: 'completed', totalAmount: 2_000_000, paidAmount: 2_000_000, createdAt: daysAgo(10) },
      { siteId: SITE, code: 'ORD-CANCEL', status: 'cancelled', totalAmount: 4_000_000, paidAmount: 0, createdAt: daysAgo(5) },
      { siteId: SITE, code: 'ORD-DEL', status: 'pending', totalAmount: 3_000_000, paidAmount: 0, createdAt: daysAgo(5), isDeleted: true },
      { siteId: OTHER_SITE, code: 'ORD-OTHER', status: 'pending', totalAmount: 9_000_000, paidAmount: 0, createdAt: daysAgo(2) },
    ])

    await PurchaseOrder.create([
      { siteId: SITE, code: 'PO-OPEN', status: 'ordered', totalAmount: 8_000_000, paidAmount: 3_000_000, createdAt: daysAgo(100) },
      { siteId: SITE, code: 'PO-DRAFT', status: 'draft', totalAmount: 6_000_000, paidAmount: 0, createdAt: daysAgo(1) },
      { siteId: SITE, code: 'PO-CANCEL', status: 'cancelled', totalAmount: 2_000_000, paidAmount: 0, createdAt: daysAgo(1) },
      { siteId: SITE, code: 'PO-PAID', status: 'received', totalAmount: 1_000_000, paidAmount: 1_000_000, createdAt: daysAgo(3) },
    ])

    await check('local calendar days are the customer days, not UTC days', async () => {
      assert.equal(localDayOf(new Date('2026-10-31T16:30:00.000Z')), '2026-10-31')
      assert.equal(localDayOf(new Date('2026-10-31T17:30:00.000Z')), '2026-11-01')
      assert.equal(localDayStartUtc('2026-10-31').toISOString(), '2026-10-30T17:00:00.000Z')
    })

    await check('an invalid, reversed, over-long or future range is refused', async () => {
      await assert.rejects(async () => resolveRange('2026-02-31', '2026-03-01', NOW), isReportError(422, 'REPORT_RANGE_INVALID'))
      await assert.rejects(async () => resolveRange('2026-10-31', '2026-10-01', NOW), isReportError(422, 'REPORT_RANGE_INVALID'))
      await assert.rejects(async () => resolveRange('2024-01-01', '2026-01-01', NOW), isReportError(422, 'REPORT_RANGE_TOO_LONG'))
      await assert.rejects(async () => resolveRange('2027-01-01', '2027-01-31', NOW), isReportError(422, 'REPORT_RANGE_IN_FUTURE'))
    })

    const october = resolveRange('2026-10-01', '2026-10-31', NOW)

    await check('the October report sums only posted money inside the local month', async () => {
      const summary = await financeSummary(models, SITE, october, NOW)
      assert.equal(summary.received.total, 2_500_000, '2,000,000 banking + 500,000 cash')
      assert.equal(summary.received.count, 2)
      assert.deepEqual(summary.received.byMethod, { banking: 2_000_000, cash: 500_000 })
      assert.equal(summary.paidOut.total, 1_200_000)
      assert.equal(summary.net, 1_300_000)
      assert.deepEqual(summary.voided, { total: 900_000, count: 1 })
      assert.equal(summary.timeZone, 'Asia/Ho_Chi_Minh')
    })

    await check('receivables and payables say what is still owed, not what was billed', async () => {
      const summary = await financeSummary(models, SITE, october, NOW)
      assert.equal(summary.receivables.outstanding, 4_000_000, 'ORD-OPEN 3,000,000 + ORD-NEW 1,000,000')
      assert.equal(summary.receivables.count, 2)
      assert.equal(summary.receivables.overdueCount, 1, 'only the 40-day-old order is overdue at 30 days')
      assert.equal(summary.payables.outstanding, 5_000_000, 'PO-OPEN 5,000,000; draft/cancelled/paid excluded')
      assert.equal(summary.payables.count, 1)
    })

    await check('aging buckets the unpaid part by local document age', async () => {
      const aging = await financeAging(models, SITE, '2026-11-15')
      const receivable = Object.fromEntries(aging.receivables.map(bucket => [bucket.key, bucket]))
      assert.equal(receivable.current!.amount, 1_000_000, 'today’s order')
      assert.equal(receivable['31-60']!.amount, 3_000_000, 'the 40-day-old order')
      assert.equal(aging.receivables.reduce((sum, bucket) => sum + bucket.amount, 0), aging.totals.receivables)
      assert.equal(aging.totals.receivables, 4_000_000)

      const payable = Object.fromEntries(aging.payables.map(bucket => [bucket.key, bucket]))
      assert.equal(payable['90+']!.amount, 5_000_000, 'the 100-day-old purchase order')
      assert.equal(aging.totals.payables, 5_000_000)

      await assert.rejects(() => financeAging(models, SITE, '2026-13-01'), isReportError(422, 'REPORT_ASOF_INVALID'))
    })

    await check('the ledger is newest first, pages by cursor and keeps voided rows', async () => {
      const page = await financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', limit: 2 })
      assert.equal(page.data.length, 2)
      assert.equal(page.data[0]!.code, 'PT-LATE-OCT')
      assert.equal(page.hasMore, true)
      assert.deepEqual(page.totals, { receivable: 2_500_000, payable: 1_200_000, voided: 900_000 })

      const next = await financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', limit: 2, cursor: page.nextCursor ?? undefined })
      const seen = [...page.data, ...next.data].map(row => row.code)
      assert.equal(new Set(seen).size, seen.length, 'no row appears twice across pages')

      const all = await financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', limit: 50 })
      const voided = all.data.find(row => row.code === 'PT-VOID-OCT')
      assert.equal(voided?.state, 'voided')
      assert.equal(all.data.length, 4, 'the other site’s payment is not here')
      assert.equal(all.data.filter(row => row.code === 'PT-EARLY-NOV').length, 0, '01/11 local is not October')
    })

    await check('the ledger state filter and cursor are validated', async () => {
      const posted = await financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', state: 'posted' })
      assert.equal(posted.data.length, 3)
      assert.equal(posted.data.some(row => row.state === 'voided'), false)

      await assert.rejects(
        () => financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', state: 'cancelled' }),
        isReportError(422, 'REPORT_STATE_INVALID'),
      )
      await assert.rejects(
        () => financeLedger(Payment, SITE, { from: '2026-10-01', to: '2026-10-31', cursor: 'nope' }),
        isReportError(422, 'REPORT_CURSOR_INVALID'),
      )
    })

    await check('a CSV cell cannot become a spreadsheet formula', async () => {
      assert.equal(csvCell('=SUM(A1:A2)'), `'=SUM(A1:A2)`)
      assert.equal(csvCell('+84 900'), `'+84 900`)
      assert.equal(csvCell('-1'), `'-1`)
      assert.equal(csvCell('@cmd'), `'@cmd`)
      assert.equal(csvCell('ORD-1'), 'ORD-1')
      assert.equal(csvCell('a,"b"'), '"a,""b"""')
    })

    await check('the export carries the ledger and nothing internal', async () => {
      const exported = await exportLedgerCsv(Payment, SITE, { from: '2026-10-01', to: '2026-10-31' })
      assert.equal(exported.rows, 4)
      assert.equal(exported.truncated, false)

      const lines = exported.csv.trim().split('\n')
      assert.match(lines[0]!, /^# Báo cáo sổ chi trả 2026-10-01 → 2026-10-31/)
      assert.equal(lines[1], 'Ngày,Mã phiếu,Loại,Phương thức,Số tiền,Trạng thái,Chứng từ')
      assert.ok(exported.csv.includes('PT-VOID-OCT'))
      assert.ok(exported.csv.includes('Đã huỷ'))
      assert.ok(!exported.csv.includes('performer'), 'no actor column')
      assert.ok(!exported.csv.includes(referenceId), 'no internal reference id')
    })

    await check('another site sees none of it', async () => {
      const summary = await financeSummary(models, OTHER_SITE, october, NOW)
      assert.equal(summary.received.total, 7_000_000)
      assert.equal(summary.receivables.outstanding, 9_000_000)
      assert.equal(summary.payables.outstanding, 0)

      const ledger = await financeLedger(Payment, OTHER_SITE, { from: '2026-10-01', to: '2026-10-31' })
      assert.deepEqual(ledger.data.map(row => row.code), ['PT-OTHER'])
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Finance report checks: ${checks} passed, ${notRun} not run\n`)
