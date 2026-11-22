import assert from 'node:assert/strict'
import { failedRowsCsv, parseImportRows } from '../../tm-shared/nuxt-layers/cms-base/app/utils/import-rows.js'
import type { ImportRowResult } from '../../tm-shared/nuxt-layers/cms-base/app/utils/import-rows.js'

/**
 * Gate: the failed-row CSV a bulk import offers for download.
 *
 * The dialog promises "fix this file and import it again", which is only true if
 * the export keeps the operator's own cells, leaves out the rows that already
 * saved, and survives quotes and commas. That is pure string logic, so it is
 * checked here instead of by clicking a download in a browser.
 */

let checks = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`  ✅ ${name}`)
  } catch (error) {
    console.error(`  ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const result = (row: number, status: string, code: string | null = null, message: string | null = null): ImportRowResult =>
  ({ row, key: null, status, code, message })

console.log('Bulk import — the failed-row CSV\n')

const parsed = parseImportRows([
  'sku,name,price',
  'A-1,"Bộ, lớn",120000',
  'A-2,"Ống ""đôi""",90000',
  'A-3,Ok,1000',
].join('\n'))

const results: ImportRowResult[] = [
  result(1, 'created'),
  result(2, 'failed', 'CATALOG_SKU_EXISTS', 'SKU đã dùng'),
  result(3, 'updated'),
]

const csv = failedRowsCsv(parsed.rows, results)
const lines = csv.split('\n')

check('only failed rows are exported, with the reason appended', () => {
  assert.equal(lines.length, 2)
  assert.equal(lines[0], 'sku,name,price,error_code,error_message')
  assert.ok(lines[1]!.startsWith('A-2,'), 'the failed row is the only data line')
  assert.ok(lines[1]!.endsWith(',CATALOG_SKU_EXISTS,SKU đã dùng'))
  assert.ok(!csv.includes('A-1') && !csv.includes('A-3'), 'created and updated rows are not re-sent')
})

check('quotes, commas and diacritics survive the round trip', () => {
  assert.ok(lines[1]!.includes('"Ống ""đôi"""'), `got: ${lines[1]}`)
  // Re-parsing the export gives back the original cells plus the two reason columns.
  const roundTrip = parseImportRows(csv)
  assert.equal(roundTrip.error, null)
  assert.equal(roundTrip.rows.length, 1)
  assert.equal(roundTrip.rows[0]!.sku, 'A-2')
  assert.equal(roundTrip.rows[0]!.name, 'Ống "đôi"')
  assert.equal(roundTrip.rows[0]!.price, 90000)
  assert.equal(roundTrip.rows[0]!.error_code, 'CATALOG_SKU_EXISTS')
})

check('an object cell is written as JSON text and quoted', () => {
  const rows = [{ sku: 'B-1', title: { vi: 'Bộ, lớn', en: 'Big set' } }]
  const one = failedRowsCsv(rows, [result(1, 'failed', 'CATALOG_TITLE_INVALID', null)])
  assert.ok(one.includes('"{""vi"":""Bộ, lớn"",""en"":""Big set""}"'), `got: ${one}`)
  assert.ok(one.endsWith(',CATALOG_TITLE_INVALID,'), 'a missing message is an empty cell, not "null"')
})

check('a run with no failures exports nothing', () => {
  assert.equal(failedRowsCsv(parsed.rows, [result(1, 'created'), result(2, 'updated')]), '')
  // A result pointing outside the submitted rows cannot be exported either.
  assert.equal(failedRowsCsv(parsed.rows, [result(99, 'failed', 'X', 'y')]), '')
})

console.log(`\n${process.exitCode ? '❌' : '✅'} Import CSV checks: ${checks} passed\n`)
