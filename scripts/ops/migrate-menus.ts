import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'
import { MENU_MAX_CHILDREN, MENU_MAX_ITEMS } from '../../tm-shared/packages/flow-contracts/src/menu-admin.js'
import {
  asLegacyRecord,
  legacyCollectionState,
  legacyEmptyDatabaseWarning,
  legacyList,
  legacyLocalized,
  legacyNumber,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:menus --site <customerId> [--apply]`
 *
 * Copies the legacy navigation (`menus` + `menu_items`) into `site_menus`.
 *
 * A menu item is stored as a reference, so a target has to resolve to a migrated
 * record rather than to the URL the legacy row carried:
 *
 * - `page` → `content` link, legacy content id → migrated content key (matched
 *   through the localized slug, because the content importer did not keep ids),
 * - `post_category` → `category` link, legacy slug → content-category key,
 * - `item_category` → `product-category` link, legacy id → migrated catalog
 *   category key (`catalog_categories.legacyId`),
 * - `url` → `url` link, kept only when it is a rooted path or an absolute URL.
 *
 * The legacy header (`position: header`, slug `header-menu`) becomes the `main`
 * menu, which is the key the storefront header reads; three legacy levels map to
 * the item → child → grandchild rows the model now stores.
 *
 * What it refuses, and says so instead of truncating:
 *
 * - a menu nested deeper than the model allows (three levels, so a fourth has no
 *   place to go),
 * - a menu over the item or per-parent children cap,
 * - an item whose record was not migrated, or whose target is a dead dynamic
 *   route such as `/customer/orders/[id]`.
 *
 * The three legacy footer blocks (`footer-products`, `footer-news`,
 * `footer-resources`) become one `footer` menu, because the storefront renders
 * one flat footer column; their items are concatenated in legacy order.
 *
 * Dry run unless `--apply`; each menu is matched on its key, so a rerun updates
 * the rows it wrote and never duplicates them. Nothing legacy is deleted.
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID || ''
const tenant = flag('tenant') || 'default'
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB || ''
const apply = process.argv.includes('--apply')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

type Raw = Record<string, unknown>
type LinkType = 'content' | 'category' | 'product-category' | 'url'

interface DraftItem {
  label: { vi: string, en: string }
  link: { type: LinkType, target: string }
  children: DraftItem[]
}

interface MenuPlan {
  key: string
  name: string
  items: DraftItem[]
  /** Legacy menus folded into this one (only the footer). */
  merged?: string[]
  skippedItems: number
  hiddenItems: number
  roleItems: number
}

const connection = await connectDatabase({ uri, database })
let failed = false

try {
  const db = connection.db!
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacyCollections = ['menus', 'menu_items', 'contents', 'content_categories']
  const legacyTenants = await legacyTenantBuckets(connection, legacyCollections)
  const legacyState = await legacyCollectionState(connection, legacyCollections)

  console.log(`menu migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)
  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database, 'menu')}`)
  }

  const menus = await db.collection('menus').find({ ...tenantMatcher, isDeleted: { $ne: true } }).toArray()
  const menuItems = await db.collection('menu_items').find(tenantMatcher).toArray()
  const legacyContents = await db.collection('contents').find(tenantMatcher).toArray()
  const legacyContentCategories = await db.collection('content_categories').find(tenantMatcher).toArray()

  // --------------------------------------------------------------- lookup maps
  const contentKeyBySlug = new Map<string, string>()
  for (const row of await connection.collection('content').find({ siteId }, { projection: { key: 1, locales: 1 } }).toArray()) {
    const key = legacyText(row.key)
    if (!key) continue
    contentKeyBySlug.set(key, key)
    for (const entry of legacyList(row.locales)) {
      const slug = legacyText(asLegacyRecord(entry).slug).toLowerCase()
      if (slug) contentKeyBySlug.set(slug, key)
    }
  }

  const contentSlugByLegacyId = new Map<string, string>()
  for (const row of legacyContents) {
    const slug = legacyLocalized(row.slug, 120)
    const chosen = (slug.vi || slug.en || '').toLowerCase()
    if (chosen) contentSlugByLegacyId.set(String(row._id), chosen)
  }

  const categoryKeyBySlug = new Map<string, string>()
  for (const row of await connection.collection('categories').find({ siteId }, { projection: { key: 1, locales: 1 } }).toArray()) {
    const key = legacyText(row.key)
    if (!key) continue
    categoryKeyBySlug.set(key, key)
    for (const entry of legacyList(row.locales)) {
      const slug = legacyText(asLegacyRecord(entry).slug).toLowerCase()
      if (slug) categoryKeyBySlug.set(slug, key)
    }
  }

  // A deleted category is not a link target: its row stays migrated, but an item
  // pointing at it is skipped rather than published as a dead link.
  const productCategoryKeyByLegacyId = new Map<string, string>()
  for (const row of await connection.collection('catalog_categories')
    .find({ siteId, legacyId: { $ne: null }, isDeleted: { $ne: true } }, { projection: { legacyId: 1, key: 1 } })
    .toArray()) {
    const key = legacyText(row.key)
    if (key) productCategoryKeyByLegacyId.set(String(row.legacyId), key)
  }

  // ------------------------------------------------------------ tree per menu
  const itemsByMenu = new Map<string, Raw[]>()
  for (const item of menuItems) {
    const menuId = String(item.menu ?? '')
    if (!menuId) continue
    itemsByMenu.set(menuId, [...(itemsByMenu.get(menuId) ?? []), item])
  }

  const countDraft = (items: DraftItem[]): number =>
    items.reduce(
      (sum, item) => sum + 1 + item.children.reduce((count, child) => count + 1 + child.children.length, 0),
      0,
    )

  const sorted = (rows: Raw[]) => [...rows].sort((left, right) => legacyNumber(left.sort) - legacyNumber(right.sort))
  const childrenOf = (rows: Raw[], parentId: string) =>
    sorted(rows.filter(row => row.pid && String(row.pid) === parentId))
  const topsOf = (rows: Raw[]) => sorted(rows.filter(row => !row.pid))
  const maxDepth = (rows: Raw[]): number => {
    let depth = 0
    const walk = (parentId: string, level: number) => {
      for (const child of childrenOf(rows, parentId)) {
        depth = Math.max(depth, level)
        walk(String(child._id), level + 1)
      }
    }
    for (const top of topsOf(rows)) walk(String(top._id), 1)
    return depth
  }

  interface Conversion {
    item: DraftItem | null
    hidden: boolean
    roleScoped: boolean
    reason?: string
  }

  const toLink = (row: Raw): { type: LinkType, target: string } | null => {
    const type = legacyText(row.type)
    const localized = legacyLocalized(row.url, 300)

    if (type === 'url') {
      const target = localized.vi || localized.en
      const absolute = /^https?:\/\/[^\s]+$/.test(target)
      const rooted = target.startsWith('/') && !target.startsWith('//')
      // A legacy dynamic route has no page on the new site.
      if (!target || !(absolute || rooted) || target.includes('[')) return null
      return { type: 'url', target }
    }

    if (type === 'page') {
      const byRef = contentSlugByLegacyId.get(String(row.refId ?? ''))
      const key = (byRef ? contentKeyBySlug.get(byRef) : undefined)
        ?? contentKeyBySlug.get((localized.vi || localized.en).toLowerCase())
      return key ? { type: 'content', target: key } : null
    }

    if (type === 'post_category') {
      const key = categoryKeyBySlug.get((localized.vi || localized.en).toLowerCase())
      return key ? { type: 'category', target: key } : null
    }

    if (type === 'item_category') {
      const key = productCategoryKeyByLegacyId.get(String(row.refId ?? ''))
      return key ? { type: 'product-category', target: key } : null
    }

    return null
  }

  const convert = (row: Raw): Conversion => {
    const hidden = row.isVisible === false
    const permission = asLegacyRecord(row.permission)
    const roleScoped = legacyText(permission.type) && legacyText(permission.type) !== 'public'
    if (hidden) return { item: null, hidden: true, roleScoped: false }
    const link = toLink(row)
    if (!link) return { item: null, hidden: false, roleScoped: Boolean(roleScoped), reason: `type ${legacyText(row.type) || '(empty)'} has no migrated target` }
    const labels = legacyLocalized(row.title, 80)
    if (!labels.vi && !labels.en) return { item: null, hidden: false, roleScoped: Boolean(roleScoped), reason: 'no label' }
    return { item: { label: { vi: labels.vi ?? '', en: labels.en ?? '' }, link, children: [] }, hidden: false, roleScoped: Boolean(roleScoped) }
  }

  interface MenuResult {
    legacySlug: string
    plan?: MenuPlan
    skipped?: string
  }

  const results: MenuResult[] = []
  const footerParts: Array<{ slug: string, items: DraftItem[], stats: { skipped: number, hidden: number, role: number } }> = []

  for (const menu of menus) {
    const slug = legacyText(legacyLocalized(menu.slug, 80).vi) || String(menu._id)
    const rows = itemsByMenu.get(String(menu._id)) ?? []
    const name = (legacyLocalized(menu.title, 120).vi || legacyLocalized(menu.title, 120).en || slug).slice(0, 120)

    if (!rows.length) {
      results.push({ legacySlug: slug, skipped: 'no items' })
      continue
    }

    // `maxDepth` counts a top-level row as 1, so the model holds 3.
    const depth = maxDepth(rows)
    if (depth > 3) {
      results.push({ legacySlug: slug, skipped: `${depth} nesting levels (v2 holds three: item, child, link)` })
      continue
    }

    // Legacy rows are a parent pointer, so the tree is rebuilt level by level:
    // level 0 is a top-level row, 1 a dropdown row, 2 a link inside a column.
    const stats = { skipped: 0, hidden: 0, role: 0 }
    const buildTree = (parentId: string | null, level: number): DraftItem[] => {
      const source = parentId === null ? topsOf(rows) : childrenOf(rows, parentId)
      const built: DraftItem[] = []
      for (const row of source) {
        const converted = convert(row)
        if (converted.hidden) { stats.hidden++; continue }
        if (!converted.item) { stats.skipped++; continue }
        if (converted.roleScoped) stats.role++
        let children: DraftItem[] = []
        if (level < 2) {
          children = buildTree(String(row._id), level + 1)
          if (children.length > MENU_MAX_CHILDREN) {
            stats.skipped += children.length
            children = []
          }
        }
        built.push({ ...converted.item, children })
      }
      return built
    }

    const items = buildTree(null, 0)
    const { skipped: skippedItems, hidden: hiddenItems, role: roleItems } = stats

    const total = countDraft(items)
    if (!items.length) {
      results.push({ legacySlug: slug, skipped: 'no item had a migrated target' })
      continue
    }
    if (total > MENU_MAX_ITEMS) {
      results.push({ legacySlug: slug, skipped: `${total} items (v2 holds ${MENU_MAX_ITEMS})` })
      continue
    }

    if (legacyText(menu.position) === 'footer') {
      footerParts.push({ slug, items, stats: { skipped: skippedItems, hidden: hiddenItems, role: roleItems } })
      continue
    }

    results.push({
      legacySlug: slug,
      // The storefront header reads the `main` key, so the legacy header menu has
      // to land there; every other menu keeps its legacy slug.
      plan: { key: legacyText(menu.position) === 'header' ? 'main' : slug, name, items, skippedItems, hiddenItems, roleItems },
    })
  }

  if (footerParts.length) {
    const items = footerParts.flatMap(part => part.items)
    const total = countDraft(items)
    const stats = footerParts.reduce(
      (acc, part) => ({
        skipped: acc.skipped + part.stats.skipped,
        hidden: acc.hidden + part.stats.hidden,
        role: acc.role + part.stats.role,
      }),
      { skipped: 0, hidden: 0, role: 0 },
    )
    if (total <= MENU_MAX_ITEMS) {
      results.push({
        legacySlug: footerParts.map(part => part.slug).join(' + '),
        plan: {
          key: 'footer',
          name: 'Footer',
          items,
          merged: footerParts.map(part => part.slug),
          skippedItems: stats.skipped,
          hiddenItems: stats.hidden,
          roleItems: stats.role,
        },
      })
    } else {
      results.push({ legacySlug: footerParts.map(part => part.slug).join(' + '), skipped: `${total} items merged (v2 holds ${MENU_MAX_ITEMS})` })
    }
  }

  const planned = results.filter((entry): entry is MenuResult & { plan: MenuPlan } => Boolean(entry.plan))
  const refused = results.filter(entry => entry.skipped)

  console.log('\n  plan')
  for (const entry of planned) {
    const plan = entry.plan
    const parts = [`key ${plan.key}`, `${countDraft(plan.items)} items`]
    if (plan.merged) parts.push(`merged from ${plan.merged.join(', ')}`)
    if (plan.skippedItems) parts.push(`${plan.skippedItems} item(s) skipped (no migrated target)`)
    if (plan.hiddenItems) parts.push(`${plan.hiddenItems} hidden legacy row(s) dropped`)
    if (plan.roleItems) parts.push(`${plan.roleItems} role-scoped row(s) imported as public (v2 menus carry no permission)`)
    console.log(`    ✅ ${entry.legacySlug} → ${parts.join(', ')}`)
  }
  for (const entry of refused) {
    console.log(`    ⏭️  ${entry.legacySlug} skipped: ${entry.skipped}`)
  }

  const totalItems = planned.reduce((sum, entry) => sum + countDraft(entry.plan.items), 0)
  console.log(`  ${planned.length} menu(s), ${totalItems} item(s) planned, ${refused.length} skipped`)

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else if (!planned.length) {
    console.log('  nothing to write')
  } else {
    const { Menu } = await prepareDatabase(connection)
    for (const entry of planned) {
      await Menu.updateOne(
        { siteId, key: entry.plan.key },
        {
          $set: { siteId, name: entry.plan.name, items: entry.plan.items, schemaVersion: 1 },
          $setOnInsert: { revision: 1 },
        },
        { upsert: true },
      )
    }

    const keys = planned.map(entry => entry.plan.key)
    const found = await Menu.countDocuments({ siteId, key: { $in: keys } })
    console.log(`  wrote ${planned.length} menu(s); verified ${found}/${keys.length}`)
    if (found < keys.length) failed = true
  }

} finally {
  await closeDatabaseConnections()
}

if (failed) process.exitCode = 1
