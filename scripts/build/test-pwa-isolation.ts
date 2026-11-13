import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'

/**
 * Storefront build isolation.
 *
 * A production build of one customer must precache only files that build actually emits, serve
 * that customer's own manifest and branding, and carry no identifier or branding binary belonging
 * to another customer. Opt-in gate: it reads `tm-web/.output`, so `pnpm build:web` has to run first.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.resolve(repoRoot, process.env.TM_OUTPUT_DIR || 'tm-web/.output')
const publicDir = path.join(outputDir, 'public')

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.json', '.html', '.htm', '.svg', '.webmanifest', '.txt', '.xml', '.map'])
const PRECACHE_ALLOWED = new Set(['.js', '.mjs', '.css', '.woff2', '.woff', '.png', '.svg', '.ico', '.webmanifest', '.json'])

let checks = 0
const failures: string[] = []

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}\n      ${(error as Error).message.split('\n')[0]}`)
    failures.push(name)
  }
}

function readText(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

function sha256(filePath: string) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

/** The precache manifest the worker is built with: `W([{"revision":…,"url":…},…])`. */
function precacheManifest(swText: string): Array<{ url: string, revision: string | null }> {
  const start = swText.indexOf('W([{"revision"')
  assert.ok(start >= 0, 'sw.js does not contain an inlined precache manifest')
  const end = swText.indexOf(']', start)
  assert.ok(end > start, 'the precache manifest is not terminated')
  return JSON.parse(swText.slice(start + 2, end + 1).replace(/^W\(/, ''))
}

const customerId = (process.env.TM_CUSTOMER_ID || '').trim().toLowerCase()
const entry = customers[customerId]
const app = entry?.apps.web

console.log(`\n🔍 Storefront build isolation | customer: ${customerId || '(unset)'} | output: ${path.relative(repoRoot, outputDir)}\n`)

if (!entry || !app?.enabled) {
  console.error(`❌ TM_CUSTOMER_ID must name a customer with an enabled web app. Known: ${Object.entries(customers).filter(([, value]) => value.apps.web?.enabled).map(([id]) => id).join(', ')}`)
  process.exit(1)
}

const layerDir = path.join(repoRoot, app.layerPath)
const swPath = path.join(publicDir, 'sw.js')
const swText = readText(swPath)

console.log('1. Build output present')
check('public/sw.js exists and is not empty', () => assert.ok(swText.length > 1000, 'sw.js missing or suspiciously small'))
check('public/offline.html exists', () => assert.ok(fs.existsSync(path.join(publicDir, 'offline.html'))))
check('public/manifest.webmanifest exists', () => assert.ok(fs.existsSync(path.join(publicDir, 'manifest.webmanifest'))))

console.log('\n2. Precache lists only files this build emits')
const manifest = precacheManifest(swText)
check(`precache is not empty (${manifest.length} entries)`, () => assert.ok(manifest.length > 0))
check('every precached URL resolves to a file in public/', () => {
  const missing = manifest.filter(item => !fs.existsSync(path.join(publicDir, item.url))).map(item => item.url)
  assert.deepEqual(missing, [], `precached but not emitted: ${missing.slice(0, 5).join(', ')}`)
})
check('no API route is precached', () => {
  const api = manifest.filter(item => /^\/?api\//.test(item.url)).map(item => item.url)
  assert.deepEqual(api, [], `API paths precached: ${api.join(', ')}`)
})
check('no HTML document is precached', () => {
  const html = manifest.filter(item => /\.html?$/i.test(item.url)).map(item => item.url)
  assert.deepEqual(html, [], `documents precached (SSR pages can carry per-visitor state): ${html.join(', ')}`)
})
check('every precached file has a static-asset extension', () => {
  const odd = manifest.filter(item => !PRECACHE_ALLOWED.has(path.extname(item.url).toLowerCase())).map(item => item.url)
  assert.deepEqual(odd, [], `unexpected precache entries: ${odd.join(', ')}`)
})

console.log('\n3. Offline fallback is handled by the worker, not the precache')
check('the worker keeps its own offline cache', () => assert.ok(swText.includes('tm-offline')))
check('the worker references /offline.html', () => assert.ok(swText.includes('/offline.html')))
check('offline.html is not part of the precache manifest', () => {
  assert.equal(manifest.some(item => item.url === 'offline.html'), false, 'offline.html leaked into the precache manifest')
})

console.log('\n4. Served manifest and branding belong to this customer')
const ownManifestPath = path.join(layerDir, 'public/manifest.webmanifest')
check(`manifest.webmanifest is byte-identical to ${app.layerPath}/public/manifest.webmanifest`, () => {
  assert.deepEqual(JSON.parse(readText(path.join(publicDir, 'manifest.webmanifest'))), JSON.parse(readText(ownManifestPath)))
})
check('every manifest icon exists in the build output', () => {
  const icons: Array<{ src?: string }> = JSON.parse(readText(ownManifestPath)).icons ?? []
  const missing = icons.map(icon => icon.src || '').filter(src => !src || !fs.existsSync(path.join(publicDir, src.replace(/^\//, ''))))
  assert.deepEqual(missing, [], `missing icons: ${missing.join(', ')}`)
})
for (const asset of app.requiredAssets ?? []) {
  const relative = asset.replace(/^public\//, '')
  check(`ships its own ${relative}`, () => {
    const built = path.join(publicDir, relative)
    assert.ok(fs.existsSync(built), `${relative} is missing from the build`)
    assert.equal(sha256(built), sha256(path.join(layerDir, 'public', relative)), `${relative} is not the ${customerId} file`)
  })
}

console.log('\n5. No other customer\'s identifiers or branding')
const textFiles = walk(publicDir).filter(file => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
const outputHashes = new Map(walk(publicDir).map(file => [sha256(file), file]))
check(`scanned ${textFiles.length} text files in public/`, () => assert.ok(textFiles.length > 0))

for (const [otherId, other] of Object.entries(customers)) {
  const otherApp = other.apps.web
  if (otherId === customerId || !otherApp?.enabled) continue

  const identifiers = [otherApp.appId, other.tenantId].filter(Boolean)
  check(`no ${otherId} app/tenant identifier in the build`, () => {
    const hits: string[] = []
    for (const identifier of identifiers) {
      for (const file of textFiles) {
        if (readText(file).includes(identifier)) hits.push(`${identifier} in ${path.relative(publicDir, file)}`)
      }
    }
    assert.deepEqual(hits, [], hits.slice(0, 3).join('; '))
  })

  const foreignAssets = (otherApp.requiredAssets ?? []).map(asset => path.join(repoRoot, otherApp.layerPath, asset))
  check(`no ${otherId} branding binary in the build`, () => {
    const hits: string[] = []
    for (const asset of foreignAssets) {
      if (!fs.existsSync(asset)) continue
      const twin = outputHashes.get(sha256(asset))
      if (twin) hits.push(`${path.basename(asset)} also appears as ${path.relative(publicDir, twin)}`)
    }
    assert.deepEqual(hits, [], hits.join('; '))
  })
}

console.log(`\n${failures.length === 0 ? '🎉' : '⚠️'} ${checks - failures.length}/${checks} storefront isolation checks passed.`)
if (failures.length > 0) process.exit(1)
