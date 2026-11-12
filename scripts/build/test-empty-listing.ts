import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import { connectMongo } from '../../tm-web/server/utils/mongo.js'

/**
 * Live checks for the empty-listing branch of the storefront.
 *
 * The site in `sen-tuan` has posts, products and categories, so its listings can
 * never show the empty state. This script borrows another registry customer whose
 * own database really is empty (default: `bagpost` / `bag-post`), starts the web
 * app against it on a free port, and asserts that every empty listing leaves the
 * index, keeps a canonical pointing at itself, and stays out of the sitemap.
 *
 * It only reads that database: nothing is created, and nothing about the site you
 * had running is modified. The temporary server is stopped when the run ends.
 *
 *   pnpm test:empty-listing                 # bagpost, port 4006
 *   pnpm test:empty-listing --site=other    # any registry customer with an empty DB
 *   pnpm test:empty-listing --port=4016     # run on another port
 *
 * The port has to be free: a Nuxt dev server owns `tm-web/.nuxt`, so two of them
 * cannot share this project directory. Stop `pnpm dev:web` first.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const WEB_DIR = path.join(ROOT, 'tm-web')
const LOG_DIR = path.join(ROOT, '.devlogs')
const READY_TIMEOUT_MS = 180_000
const HOST = '127.0.0.1'

const args = new Map(
  process.argv.slice(2)
    .map(arg => arg.replace(/^--/, '').split('='))
    .map(([key, value]) => [key, value ?? 'true']),
)

const SITE_ID = args.get('site') || 'bagpost'
const PORT = Number(args.get('port') || 4006)
const ORIGIN = `http://${HOST}:${PORT}`
const URI = args.get('uri') || process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'

/** The home page carries the brand, so it stays in the index even when everything else is empty. */
const ALWAYS_INDEXED = [{ path: '/', title: 'home' }]

/** Pages that never ask to be indexed, and the canonical each one must keep. */
const NOINDEX_PAGES = [
  { path: '/tim-kiem', title: 'search page' },
  { path: '/tag/about', title: 'tag landing with no published post' },
  { path: '/tag/about?page=2', title: 'tag query view', canonical: '/tag/about' },
]

/** A detail URL for a record this site does not have is a real 404, not an empty page. */
const NOT_FOUND_PAGES = [
  { path: '/products/khong-ton-tai', title: 'unknown product' },
  { path: '/categories/khong-ton-tai', title: 'unknown category' },
]

/** The pages a site without any content still has to serve, and how they must answer. */
const EMPTY_LISTINGS = [
  { path: '/bai-viet', title: 'post listing' },
  { path: '/products', title: 'catalog listing' },
  { path: '/categories', title: 'catalog category index' },
  { path: '/danh-muc', title: 'content category index' },
]
const NO_CANONICAL = [{ path: '/gio-hang', title: 'cart', robots: 'noindex, follow' }]
const LISTING_ROWS = ['/bai-viet', '/products', '/categories', '/danh-muc', '/tag/about', '/tim-kiem']

let checks = 0
let notRun = 0
let server: ChildProcess | null = null

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

function skip(name: string, reason: string) {
  notRun++
  console.log(`   ⏭️  ${name} — ${reason}`)
}

function meta(html: string, name: string): string {
  return html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1] || ''
}

function canonicalOf(html: string): string {
  return html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] || ''
}

async function get(pathname: string): Promise<{ status: number, html: string }> {
  const response = await fetch(ORIGIN + pathname, { headers: { accept: 'text/html' } })
  return { status: response.status, html: await response.text() }
}

/** Resolves when nothing is listening: a Nuxt dev server on this port would fight ours over `.nuxt`. */
function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: HOST, port })
    socket.once('connect', () => {
      socket.destroy()
      reject(new Error(`port ${port} is already serving; stop \`pnpm dev:web\` (or pass --port=...) first`))
    })
    socket.once('error', () => {
      socket.destroy()
      resolve()
    })
  })
}

function stopServer() {
  if (!server?.pid) return
  const pid = server.pid
  server = null
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // The child already exited.
  }
}

async function waitForReady(child: ChildProcess) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastError = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the dev server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${ORIGIN}/`, { headers: { accept: 'text/html' } })
      if (response.status === 200) return
      lastError = `status ${response.status}`
    } catch (error) {
      lastError = (error as Error).message
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`the dev server did not answer on ${ORIGIN} within ${READY_TIMEOUT_MS / 1000}s (${lastError})`)
}

async function main() {
  const customer = customers[SITE_ID]
  if (!customer) {
    throw new Error(`unknown customer "${SITE_ID}"; registry has ${Object.keys(customers).join(', ')}`)
  }
  const database = customer.dataSources?.mongo?.database
  if (!database) {
    throw new Error(`customer "${SITE_ID}" has no mongo binding in the registry, so it cannot be served`)
  }

  console.log(`\n▶ Empty listing checks — customer ${SITE_ID}, database ${database}, ${ORIGIN}\n`)

  const mongoose = await connectMongo({ uri: URI, database })
  const db = mongoose.connection.db
  assert(db, 'failed to open the customer database')

  const counts = {
    content: await db.collection('content').countDocuments(),
    catalog_items: await db.collection('catalog_items').countDocuments(),
    catalog_categories: await db.collection('catalog_categories').countDocuments(),
    content_categories: await db.collection('content_categories').countDocuments(),
  }
  console.log(
    `   database: content ${counts.content}, catalog_items ${counts.catalog_items}, `
    + `catalog_categories ${counts.catalog_categories}, content_categories ${counts.content_categories}`,
  )

  // `content_categories` is informational: rows can belong to another site or locale and
  // still be served nowhere. If this site does serve one, the `/danh-muc` check fails,
  // which is the signal we want, so it is not part of the gate.
  const populated = [
    ['content', counts.content],
    ['catalog_items', counts.catalog_items],
    ['catalog_categories', counts.catalog_categories],
  ].filter(([, count]) => (count as number) > 0)
  if (populated.length) {
    throw new Error(
      `customer "${SITE_ID}" is not empty (${populated.map(([name, count]) => `${name}: ${count}`).join(', ')}); `
      + 'pick a customer whose database has no content or catalog, or clear that data first',
    )
  }

  await assertPortFree(PORT)
  mkdirSync(LOG_DIR, { recursive: true })
  const logPath = path.join(LOG_DIR, `web-empty-${SITE_ID}.log`)

  console.log(`   starting web against "${database}" (log: ${path.relative(ROOT, logPath).replace(/\\/g, '/')})`)
  const log = createWriteStream(logPath, { flags: 'w' })
  // Nuxt is started through its own entry point so no shell is involved: on Windows a
  // `.cmd` shim cannot be spawned without one. `--host` matters too, because Nuxt binds
  // `localhost` by default and that can mean IPv6 only while the checks dial IPv4.
  const nuxtBin = path.join(WEB_DIR, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
  server = spawn(process.execPath, [nuxtBin, 'dev', '--host', HOST, '--port', String(PORT)], {
    cwd: WEB_DIR,
    env: { ...process.env, TM_SITE_ID: SITE_ID, TM_MONGO_DB: database, TM_MONGO_URI: URI },
    stdio: ['ignore', 'pipe', 'pipe'],
    // A process group lets the POSIX branch stop Nuxt together with its workers.
    detached: process.platform !== 'win32',
  })
  server.stdout?.pipe(log)
  server.stderr?.pipe(log)
  await waitForReady(server)

  for (const page of ALWAYS_INDEXED) {
    await check(`${page.path} (${page.title}) stays indexable and keeps itself canonical`, async () => {
      const { status, html } = await get(page.path)
      assert.equal(status, 200)
      assert.equal(meta(html, 'robots'), 'index, follow')
      assert.equal(canonicalOf(html), ORIGIN + page.path)
    })
  }

  for (const page of NOINDEX_PAGES) {
    await check(`${page.path} (${page.title}) answers 200 + noindex, follow`, async () => {
      const { status, html } = await get(page.path)
      assert.equal(status, 200)
      assert.equal(meta(html, 'robots'), 'noindex, follow')
      assert.equal(canonicalOf(html), ORIGIN + (page.canonical ?? page.path))
    })
  }

  for (const page of NOT_FOUND_PAGES) {
    await check(`${page.path} (${page.title}) is 404 + noindex, follow with no canonical`, async () => {
      const { status, html } = await get(page.path)
      assert.equal(status, 404)
      assert.equal(meta(html, 'robots'), 'noindex, follow')
      assert.equal(canonicalOf(html), '')
    })
  }

  for (const page of EMPTY_LISTINGS) {
    await check(`${page.path} (${page.title}) answers 200 + noindex, follow`, async () => {
      const { status, html } = await get(page.path)
      assert.equal(status, 200)
      assert.equal(meta(html, 'robots'), 'noindex, follow')
    })
    await check(`${page.path} canonical points at itself`, async () => {
      const { html } = await get(page.path)
      assert.equal(canonicalOf(html), ORIGIN + page.path)
    })
  }

  for (const page of NO_CANONICAL) {
    await check(`${page.path} (${page.title}) is ${page.robots} and has no canonical`, async () => {
      const { status, html } = await get(page.path)
      assert.equal(status, 200)
      assert.equal(meta(html, 'robots'), page.robots)
      assert.equal(canonicalOf(html), '')
    })
  }

  const sitemap = await get('/sitemap.xml')
  const locs = [...sitemap.html.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])

  await check('the sitemap still lists the home page', () => {
    assert.equal(sitemap.status, 200)
    assert.ok(locs.includes(`${ORIGIN}/`), `expected ${ORIGIN}/ among ${locs.join(', ') || '(no rows)'}`)
  })

  await check('the sitemap lists no listing that is currently noindex', () => {
    const listed = locs.filter(loc => LISTING_ROWS.some(row => loc === ORIGIN + row))
    assert.deepEqual(listed, [])
  })

  if (!locs.length) {
    skip('every sitemap URL is 200 + indexable', 'the sitemap has no rows')
    return
  }

  await check(`all ${locs.length} sitemap URLs are 200, indexable and self-canonical`, async () => {
    const problems: string[] = []
    for (const loc of locs) {
      const response = await fetch(loc, { headers: { accept: 'text/html' } })
      const html = await response.text()
      if (response.status !== 200) problems.push(`${loc} -> ${response.status}`)
      const robots = meta(html, 'robots')
      if (robots.includes('noindex')) problems.push(`${loc} -> ${robots}`)
      if (canonicalOf(html) !== loc) problems.push(`${loc} -> canonical ${canonicalOf(html) || '(none)'}`)
    }
    assert.deepEqual(problems, [])
  })
}

try {
  await main()
} catch (error) {
  console.error(`\n❌ ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  stopServer()
  await new Promise(resolve => setTimeout(resolve, 500))
}

if (server) console.log('\n   the temporary dev server is still running')
console.log(`\n${checks} checks passed${notRun ? `, ${notRun} skipped` : ''}${process.exitCode ? ' (with failures)' : ''}`)
if (process.exitCode) process.exit(process.exitCode)
process.exit(0)
