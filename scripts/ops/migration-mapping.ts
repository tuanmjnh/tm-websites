import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { asLegacyRecord, legacyLocalized, legacyNumber, legacyText } from '../../tm-cms/server/utils/legacyImport.js'
import type { Document } from 'mongodb'

/**
 * `pnpm migration:mapping --site <customerId>`
 *
 * The mapping matrix the replacement plan (§7.2) asks for: every populated
 * legacy field, where it lands, and how many rows carry it on each side.
 *
 * Counts are deliberately one-directional, like `check:migration`: v2 may hold
 * more than the source (an editor wrote something), but a field the source
 * populates must have at least as many target rows carrying it. That is enough
 * to spot a mapper that silently drops a field — the failure mode that lost
 * every tag for a day — without pretending the two sides are identical.
 *
 * Read-only: no write, no `--apply`, no credential value printed (settings only
 * counts allowlisted identity keys by name).
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID || ''
const tenant = flag('tenant') || 'default'
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB || ''

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const connection = await connectDatabase({ uri, database })
const db = connection.db!
const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }

type Row = Record<string, unknown>

/** A value counts as present when it is not empty, blank, zero-length or null. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false
  // A Date is an object with no enumerable keys: without this it would always
  // read as missing and every migrated date would look lost.
  if (value instanceof Date) return !Number.isNaN(value.getTime())
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Row).length > 0
  return true
}

function get(record: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined
    return (current as Row)[key]
  }, record)
}

const LOCALES = ['vi', 'en']
const localized = (record: Row, path: string) => legacyLocalized(get(record, path), 100000)

/** Localized source field → present when any locale carries text. */
function localizedPresent(record: Row, path: string): boolean {
  const map = localized(record, path)
  return LOCALES.some(locale => present(map[locale]))
}

/** Localized target: counted per v2 row when any locale carries the value. */
function localeEntries(row: Row): Row[] {
  return Array.isArray(row.locales) ? (row.locales as Row[]) : []
}

function anyLocaleValue(row: Row, key: string): boolean {
  return localeEntries(row).some(entry => present((entry as Row)[key]))
}

/**
 * Reads a literal attribute key such as `legacy.thumbnail`.
 *
 * `get()` splits on dots because it walks nested objects, which is wrong here:
 * the key itself contains the dot, so it must be read as one property.
 */
function attr(row: Row, key: string): unknown {
  const attributes = row.attributes
  return attributes && typeof attributes === 'object' ? (attributes as Row)[key] : undefined
}

function anyLocaleNested(row: Row, path: string): boolean {
  return localeEntries(row).some(entry => present(get(entry as Row, path)))
}

interface Field {
  source: string
  target: string
  transform: string
  /** Present in a legacy source record. */
  legacy: (record: Row) => boolean
  /** Present on a v2 target record. */
  v2: (row: Row) => boolean
  note?: string
}

const contentFields: Field[] = [
  { source: 'contents.title', target: 'content.locales[].title', transform: 'localized map → per-locale title', legacy: r => localizedPresent(r, 'title'), v2: r => anyLocaleValue(r, 'title') },
  { source: 'contents.slug', target: 'content.locales[].slug', transform: 'normalized per locale; suffixed on collision', legacy: r => localizedPresent(r, 'slug'), v2: r => anyLocaleValue(r, 'slug') },
  { source: 'contents.content', target: 'content.locales[].body', transform: 'HTML kept verbatim, format `html`', legacy: r => localizedPresent(r, 'content'), v2: r => anyLocaleValue(r, 'body') },
  { source: 'contents.excerpt', target: 'content.locales[].excerpt', transform: 'localized text (500 chars)', legacy: r => localizedPresent(r, 'excerpt'), v2: r => anyLocaleValue(r, 'excerpt') },
  { source: 'contents.seo.title', target: 'content.locales[].seo.title', transform: 'localized text', legacy: r => localizedPresent(r, 'seo.title'), v2: r => anyLocaleNested(r, 'seo.title') },
  { source: 'contents.seo.description', target: 'content.locales[].seo.description', transform: 'localized text', legacy: r => localizedPresent(r, 'seo.description'), v2: r => anyLocaleNested(r, 'seo.description') },
  { source: 'contents.seo.keywords', target: 'content.locales[].keywords', transform: 'string or list → keyword list', legacy: r => LOCALES.some(l => present(get(get(r, 'seo.keywords') as Row, l))), v2: r => anyLocaleNested(r, 'keywords') },
  { source: 'contents.seo.image', target: 'content.locales[].seo.image', transform: 'URL kept as text', legacy: r => present(get(get(r, 'seo') as Row, 'image')), v2: r => anyLocaleNested(r, 'seo.image') },
  { source: 'contents.thumbnail', target: "attributes['legacy.thumbnail']", transform: '`{url}` or string → legacy attribute (no media id)', legacy: r => present(get(get(r, 'thumbnail') as Row, 'url')) || present(r.thumbnail), v2: r => present(attr(r, 'legacy.thumbnail')) },
  { source: 'contents.format (non-standard)', target: "attributes['legacy.format']", transform: 'kept as data; no renderer; `standard` is the default and is not stored', legacy: r => present(r.format) && legacyText(r.format) !== 'standard', v2: r => present(attr(r, 'legacy.format')) },
  { source: 'contents.template', target: "attributes['legacy.template']", transform: 'kept as data', legacy: r => present(r.template), v2: r => present(attr(r, 'legacy.template')) },
  { source: 'contents.sort', target: "attributes['legacy.sort']", transform: 'number; 0 is not a sort weight', legacy: r => present(r.sort) && legacyNumber(r.sort) !== 0, v2: r => present(attr(r, 'legacy.sort')) },
  { source: 'contents.views', target: "attributes['legacy.views']", transform: 'number; 0 is not a view count worth carrying', legacy: r => present(r.views) && legacyNumber(r.views) !== 0, v2: r => present(attr(r, 'legacy.views')) },
  { source: 'contents.display', target: "attributes['legacy.showOnHome' | 'legacy.priority']", transform: 'flags kept as attributes', legacy: r => { const display = asLegacyRecord(r.display); return display.showOnHome === true || legacyNumber(display.priority) !== 0 }, v2: r => present(attr(r, 'legacy.showOnHome')) || present(attr(r, 'legacy.priority')) },
  { source: 'contents.tags', target: 'content.tags', transform: '`{title}`/string → string list', legacy: r => present(r.tags), v2: r => present(r.tags) },
  { source: 'contents.categories', target: 'content.categories (category keys)', transform: 'legacy id → migrated category key', legacy: r => present(r.categories), v2: r => present(r.categories) },
  { source: 'contents.gallery', target: 'not carried as media ids', transform: 'reported + `legacy.incomplete=gallery`, `legacy.gallerySkipped`', legacy: r => present(r.gallery), v2: r => present(attr(r, 'legacy.incomplete')), note: 'J1: never converted without a mapping' },
  { source: 'contents.media', target: 'not carried as media ids', transform: 'reported + `legacy.incomplete=media`, `legacy.mediaSkipped`', legacy: r => present(r.media), v2: r => present(attr(r, 'legacy.incomplete')) },
  { source: 'contents.status', target: 'content.status', transform: 'published/draft/archived/deleted', legacy: r => present(r.status), v2: r => present(r.status) },
  { source: 'contents.isDeleted / deletedAt', target: 'content.status=deleted + content.deletedAt', transform: 'soft delete preserved, never revived', legacy: r => r.isDeleted === true, v2: r => (r as Row).status === 'deleted' },
  { source: 'contents.publishedAt', target: 'content.publishedAt', transform: 'date', legacy: r => present(r.publishedAt), v2: r => present(r.publishedAt) },
  { source: 'contents.createdAt / updatedAt', target: 'content.createdAt / updatedAt', transform: 'dates carried', legacy: r => present(r.createdAt) || present(r.updatedAt), v2: r => present(r.createdAt) || present(r.updatedAt) },
]

const itemFields: Field[] = [
  { source: 'items.title', target: 'catalog_items.title', transform: 'localized map', legacy: r => localizedPresent(r, 'title'), v2: r => present(get(r as Row, 'title')) },
  { source: 'items.slug', target: 'catalog_items.slug', transform: 'per locale; suffixed on collision', legacy: r => localizedPresent(r, 'slug'), v2: r => present(get(r as Row, 'slug')) },
  { source: 'items.shortDesc', target: 'catalog_items.shortDesc', transform: 'localized text', legacy: r => localizedPresent(r, 'shortDesc'), v2: r => present(get(r as Row, 'shortDesc')) },
  { source: 'items.description', target: 'catalog_items.description', transform: 'localized text', legacy: r => localizedPresent(r, 'description'), v2: r => present(get(r as Row, 'description')) },
  { source: 'items.thumbnail', target: 'catalog_items.thumbnail', transform: 'URL string', legacy: r => present(get(get(r, 'thumbnail') as Row, 'url')) || present(r.thumbnail), v2: r => present(get(r as Row, 'thumbnail')) },
  { source: 'items.gallery', target: 'catalog_items.gallery', transform: 'usable image URLs only, unusable entries dropped', legacy: r => present(r.gallery), v2: r => present(get(r as Row, 'gallery')) },
  { source: 'items.basePrice', target: 'catalog_items.basePrice', transform: 'number', legacy: r => present(r.basePrice), v2: r => present(get(r as Row, 'basePrice')) },
  { source: 'items.salePrice', target: 'catalog_items.salePrice', transform: 'number; 0 stays 0, null stays null', legacy: r => r.salePrice !== null && r.salePrice !== undefined, v2: r => (r as Row).salePrice !== null && (r as Row).salePrice !== undefined },
  { source: 'items.sku', target: 'catalog_items.sku', transform: 'text', legacy: r => present(r.sku), v2: r => present(get(r as Row, 'sku')) },
  { source: 'items.barcode', target: 'catalog_items.barcode', transform: 'text', legacy: r => present(r.barcode), v2: r => present(get(r as Row, 'barcode')) },
  { source: 'items.uom', target: 'catalog_items.uom', transform: 'text', legacy: r => present(r.uom), v2: r => present(get(r as Row, 'uom')) },
  { source: 'items.type', target: 'catalog_items.type', transform: '`simple`|`variable`', legacy: r => present(r.type), v2: r => present(get(r as Row, 'type')) },
  { source: 'items.stock', target: 'catalog_items.stock', transform: 'number (inventory domain owns the ledger, P6)', legacy: r => present(r.stock), v2: r => (r as Row).stock !== undefined },
  { source: 'items.manageStock', target: 'catalog_items.manageStock', transform: 'boolean, default true', legacy: r => r.manageStock !== undefined, v2: r => (r as Row).manageStock !== undefined },
  { source: 'items.minStock / hasImei / reserved', target: 'catalog field, no column', transform: 'reported by `legacy item fields not carried`, inventory schema is P6', legacy: r => present(r.minStock) || present(r.hasImei) || present(r.reserved), v2: () => false, note: 'count kept at 0 on purpose until P6' },
  { source: 'items.supplierPrices', target: 'no column', transform: 'reported by the catalog dry run; owner decision needed', legacy: r => present(r.supplierPrices), v2: () => false, note: 'private cost, never in a public DTO' },
  { source: 'items.variants', target: 'catalog_items.variants', transform: 'SKU-bearing variants only', legacy: r => present(r.variants), v2: r => present(get(r as Row, 'variants')) },
  { source: 'items.options', target: 'no separate collection', transform: 'reported by `legacy item fields not carried`; variant attributes carry values, option definitions do not', legacy: r => present(r.options), v2: () => false, note: 'no option model yet' },
  { source: 'items.attributes', target: 'catalog_items.attributes', transform: 'name/value pairs', legacy: r => present(r.attributes), v2: r => present(get(r as Row, 'attributes')) },
  { source: 'items.tags', target: 'catalog_items.tags', transform: '`{title}`/string → string list', legacy: r => present(r.tags), v2: r => present(get(r as Row, 'tags')) },
  { source: 'items.categories', target: 'catalog_items.categories', transform: 'legacy id → migrated row id', legacy: r => present(r.categories), v2: r => present(get(r as Row, 'categories')), note: 'unresolved refs are reported by migrate:catalog and dropped' },
  { source: 'items.seo', target: 'catalog_items.seo', transform: 'title/description/image', legacy: r => present(r.seo), v2: r => present(get(r as Row, 'seo')) },
  { source: 'items.status / isActive', target: 'catalog_items.status / isActive', transform: 'published/draft/archived/deleted', legacy: r => present(r.status) || r.isActive !== undefined, v2: r => present(get(r as Row, 'status')) },
  { source: 'items.isDeleted / deletedAt', target: 'isDeleted / deletedAt / status=deleted', transform: 'soft delete preserved', legacy: r => r.isDeleted === true, v2: r => (r as Row).isDeleted === true || (r as Row).status === 'deleted' },
  { source: 'items.sales / views', target: 'catalog_items.sales / views', transform: 'numbers', legacy: r => present(r.sales) || present(r.views), v2: r => present(get(r as Row, 'sales')) || present(get(r as Row, 'views')) },
  { source: 'items.publishedAt', target: 'catalog_items.publishedAt', transform: 'date', legacy: r => present(r.publishedAt), v2: r => present(get(r as Row, 'publishedAt')) },
  { source: 'items.fullPath', target: 'content_redirects (301)', transform: '`migrate:redirects` plans unambiguous paths only', legacy: r => present(r.fullPath), v2: () => false, note: 'counted in the redirect report, not as a product column' },
]

const categoryFields: Field[] = [
  { source: 'item_categories.title', target: 'catalog_categories.title', transform: 'localized map', legacy: r => localizedPresent(r, 'title'), v2: r => present(get(r as Row, 'title')) },
  { source: 'item_categories.slug', target: 'catalog_categories.slug', transform: 'per locale; suffixed on collision', legacy: r => localizedPresent(r, 'slug'), v2: r => present(get(r as Row, 'slug')) },
  { source: 'item_categories.fullPath', target: 'catalog_categories.fullPath', transform: 'localized text', legacy: r => localizedPresent(r, 'fullPath'), v2: r => present(get(r as Row, 'fullPath')) },
  { source: 'item_categories.description', target: 'catalog_categories.description', transform: 'localized text', legacy: r => localizedPresent(r, 'description'), v2: r => present(get(r as Row, 'description')) },
  { source: 'item_categories.thumbnail', target: 'catalog_categories.thumbnail', transform: 'URL string', legacy: r => present(get(get(r, 'thumbnail') as Row, 'url')) || present(r.thumbnail), v2: r => present(get(r as Row, 'thumbnail')) },
  { source: 'item_categories.displayOrder', target: 'catalog_categories.order', transform: 'number', legacy: r => present(r.displayOrder), v2: r => present(get(r as Row, 'order')) },
  { source: 'item_categories.pid', target: 'catalog_categories.parent', transform: 'legacy id → migrated row id', legacy: r => present(r.pid), v2: r => present(get(r as Row, 'parent')) },
  { source: 'item_categories.ancestors', target: 'catalog_categories.ancestors', transform: 'ids → migrated ids', legacy: r => present(r.ancestors), v2: r => present(get(r as Row, 'ancestors')) },
  { source: 'item_categories.seo', target: 'catalog_categories.seo', transform: 'title/description', legacy: r => present(r.seo), v2: r => present(get(r as Row, 'seo')) },
  { source: 'item_categories.isDeleted / deletedAt', target: 'isDeleted / deletedAt', transform: 'soft delete preserved', legacy: r => r.isDeleted === true, v2: r => (r as Row).isDeleted === true },
]

function render(fields: Field[], source: Row[], target: Row[]): string[] {
  const lines = [
    '| Source field | Target | Transform | Present in source | Carried in v2 | Verdict |',
    '| --- | --- | --- | ---: | ---: | --- |',
  ]
  for (const field of fields) {
    const sourceCount = source.filter(field.legacy).length
    if (!sourceCount) continue
    const targetCount = target.filter(field.v2).length
    const verdict = targetCount >= sourceCount ? 'ok' : (field.note ? `reported — ${field.note}` : 'FEWER THAN SOURCE')
    if (verdict === 'FEWER THAN SOURCE') process.exitCode = 1
    lines.push(`| \`${field.source}\` | ${field.target} | ${field.transform} | ${sourceCount} | ${targetCount} | ${verdict} |`)
  }
  return lines
}

try {
  const contents = (await db.collection('contents').find(tenantMatcher).toArray()) as Row[]
  const items = (await db.collection('items').find(tenantMatcher).toArray()) as Row[]
  const categories = (await db.collection('item_categories').find(tenantMatcher).toArray()) as Row[]
  const v2Content = (await db.collection('content').find({ siteId }).toArray()) as Row[]
  const v2Items = (await db.collection('catalog_items').find({ siteId, legacyId: { $ne: null } }).toArray()) as Row[]
  const v2Categories = (await db.collection('catalog_categories').find({ siteId, legacyId: { $ne: null } }).toArray()) as Row[]

  const legacyTenantKeys = new Set((await db.collection('system_configs').find(tenantMatcher, { projection: { key: 1 } }).toArray()).map(row => legacyText((row as Row).key)))
  const identity = ['site_name', 'site_description', 'content_locales', 'enabled_modules'].filter(key => legacyTenantKeys.has(key))
  const settings = await db.collection('settings').findOne({ siteId })

  console.log(`migration mapping site=${siteId} db=${database} tenant=${tenant}`)
  console.log(`\nContent (${contents.length} source rows, ${v2Content.length} v2 rows)\n`)
  console.log(render(contentFields, contents, v2Content).join('\n'))
  console.log(`\nCatalog items (${items.length} source rows, ${v2Items.length} v2 rows)\n`)
  if (items.length) console.log(render(itemFields, items, v2Items).join('\n'))
  else console.log('(the source copy holds no items)')
  console.log(`\nCatalog categories (${categories.length} source rows, ${v2Categories.length} v2 rows)\n`)
  if (categories.length) console.log(render(categoryFields, categories, v2Categories).join('\n'))
  else console.log('(the source copy holds no categories)')
  console.log(`\nSettings identity keys available: ${JSON.stringify(identity)}; settings document ${settings ? 'present' : 'missing'}`)
} finally {
  await connection.close()
}
