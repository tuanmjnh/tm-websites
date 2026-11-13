import assert from 'node:assert/strict'
import {
  publicCacheKey,
  publicCachePrefix,
  purgePublicCache,
  scopesForReason,
  type PublicCacheStorage,
} from '../../tm-web/server/utils/publicCache.js'

/**
 * Scoped purge of the storefront's Nitro handler cache.
 *
 * Pure: the storage is a map, so this needs neither MongoDB nor a running
 * server. It pins the two things that used to be wrong — a save dropped every
 * tenant's entries, and the site projection's key did not name its tenant.
 */

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

const SEN = 'sen-tuan'
const BAG = 'bag-post'

function handler(key: string) {
  return `nitro:handlers:${key}.json`
}

interface MemoryStorage extends PublicCacheStorage {
  keys(): string[]
}

function memoryStorage(initial: string[]): MemoryStorage {
  const entries = new Set(initial)
  return {
    getKeys: async () => [...entries],
    removeItem: async (key: string) => {
      entries.delete(key)
    },
    keys: () => [...entries],
  }
}

function seeded() {
  return memoryStorage([
    handler(publicCacheKey(SEN, 'catalog', 'products:/api/public/products')),
    handler(publicCacheKey(SEN, 'catalog', 'product:/api/public/products/bo-hn-bo')),
    handler(publicCacheKey(SEN, 'site', 'public-site:vi')),
    handler(publicCacheKey(BAG, 'catalog', 'products:/api/public/products')),
    handler(publicCacheKey(BAG, 'site', 'public-site:vi')),
    handler('public-site:vi'),
    'assets:logo.png',
  ])
}

console.log('Storefront cache — scoped purge\n')

await check('a key names its tenant and its scope in a form Nitro keeps', () => {
  assert.equal(
    publicCacheKey(SEN, 'catalog', 'products:/api/public/products?limit=1'),
    'public__sen_tuan__catalog__products__api_public_products_limit_1',
    'no punctuation: Nitro strips every non-word character from the key',
  )
  assert.equal(publicCacheKey('', 'site', 'public-site:vi'), 'public__none__site__public_site_vi', 'an unset database falls back to none, dashes slugged too')
  assert.equal(publicCachePrefix(SEN, 'site'), 'public__sen_tuan__site__')
  // Nitro runs `String(key).replace(/\W/g, '')`; a key made only of word characters is unchanged by it.
  assert.ok(/^[A-Za-z0-9_]+$/.test(publicCacheKey('bag-post', 'site', 'public-site:vi')))
})

await check('a CMS reason decides the scope', () => {
  assert.deepEqual(scopesForReason('catalog.item.update'), ['catalog'])
  assert.deepEqual(scopesForReason('catalog.item.bulk'), ['catalog'])
  assert.deepEqual(scopesForReason('catalog.category.update'), ['site', 'catalog'], 'a renamed category reaches menus and URLs')
  assert.deepEqual(scopesForReason('catalog.category.create'), ['site', 'catalog'])
  assert.deepEqual(scopesForReason('menu.create'), ['site'])
  assert.deepEqual(scopesForReason('settings.update'), ['site'])
  assert.deepEqual(scopesForReason('redirect.delete'), ['site'])
  assert.deepEqual(scopesForReason('something.new'), ['site', 'catalog'], 'an unknown reason under-purges nothing')
  assert.deepEqual(scopesForReason(undefined), ['site', 'catalog'])
})

await check('a catalog write drops that tenant\'s catalog keys and nothing else', async () => {
  const storage = seeded()
  const result = await purgePublicCache(storage, SEN, scopesForReason('catalog.item.update'))

  assert.equal(result.removedCount, 2)
  assert.deepEqual(result.removedKeys.sort(), [
    handler(publicCacheKey(SEN, 'catalog', 'product:/api/public/products/bo-hn-bo')),
    handler(publicCacheKey(SEN, 'catalog', 'products:/api/public/products')),
  ].sort())
  assert.ok(storage.keys().includes(handler(publicCacheKey(SEN, 'site', 'public-site:vi'))), 'the site projection survives')
  assert.ok(storage.keys().includes(handler(publicCacheKey(BAG, 'catalog', 'products:/api/public/products'))), 'another tenant survives')
  assert.ok(storage.keys().includes(handler('public-site:vi')), 'an entry with no tenant is not this tenant\'s to drop')
  assert.ok(storage.keys().includes('assets:logo.png'), 'non-handler storage is never touched')
  assert.equal(storage.keys().filter(key => key.includes('nitro:handlers:')).length, 4, 'the other four entries are still cached')
})

await check('a settings or menu save drops only the site projection', async () => {
  const storage = seeded()
  const result = await purgePublicCache(storage, SEN, scopesForReason('settings.update'))

  assert.equal(result.removedCount, 1)
  assert.deepEqual(result.removedKeys, [handler(publicCacheKey(SEN, 'site', 'public-site:vi'))])
  assert.equal(
    storage.keys().filter(key => key.includes(publicCachePrefix(SEN, 'catalog'))).length,
    2,
    'both catalog entries of the same tenant survive',
  )
})

await check('a category rename drops both scopes of its own tenant only', async () => {
  const storage = seeded()
  const result = await purgePublicCache(storage, SEN, scopesForReason('catalog.category.update'))

  assert.equal(result.removedCount, 3)
  assert.deepEqual(
    storage.keys().sort(),
    [
      handler(publicCacheKey(BAG, 'catalog', 'products:/api/public/products')),
      handler(publicCacheKey(BAG, 'site', 'public-site:vi')),
      handler('public-site:vi'),
      'assets:logo.png',
    ].sort(),
    'the other tenant keeps every entry',
  )
})

await check('an unknown reason is tenant-scoped but not scope-scoped', async () => {
  const storage = seeded()
  const result = await purgePublicCache(storage, SEN, scopesForReason('import.finished'))

  assert.deepEqual(result.scopes, ['site', 'catalog'])
  assert.equal(result.removedCount, 3)
  assert.ok(storage.keys().every(key => !key.includes(`public__${SEN.replace('-', '_')}__`)))
})

await check('the operator escape hatch still stops at handler entries', async () => {
  const storage = seeded()
  const result = await purgePublicCache(storage, SEN, 'all')

  assert.equal(result.removedCount, 6)
  assert.deepEqual(storage.keys(), ['assets:logo.png'], 'other storage keeps its keys')
})

await check('nothing to remove is a no-op, whether the cache or the tenant is empty', async () => {
  const empty = await purgePublicCache(memoryStorage([]), SEN, ['site', 'catalog'])
  assert.equal(empty.removedCount, 0)
  assert.deepEqual(empty.removedKeys, [])

  const storage = seeded()
  const other = await purgePublicCache(storage, 'hoangvi', ['site', 'catalog'])
  assert.equal(other.removedCount, 0)
  assert.equal(storage.keys().length, 7, 'a tenant with no entries leaves every other tenant intact')
})

console.log(`\n${checks} checks passed`)
if (process.exitCode) {
  console.error('Purge scope checks failed')
}
