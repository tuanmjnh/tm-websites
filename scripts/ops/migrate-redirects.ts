import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncRedirectIndexes } from '../../tm-cms/server/models/redirect.js'
import {
  legacyLocalized,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:redirects --site <customerId> [--apply]`
 *
 * The legacy shop served a product at `/<fullPath>` (`chan-ga-goi-dem/bo-hn-bo`,
 * with the parent category slug in front). v2 serves it at `/products/<slug>`, so
 * every legacy product URL becomes a 404 at cutover unless it is redirected.
 *
 * This command plans those 301s from the legacy `fullPath` and writes them into
 * `content_redirects` — the same map the storefront already follows before
 * routing, and the same table a slug change writes to. It reads only what the
 * database can prove:
 *
 * - the target is the row `migrate:catalog --apply` actually wrote, so run that
 *   first; a legacy item with no v2 row is reported, never guessed;
 * - a deleted or unpublished v2 row is not a redirect target (it would 301 into a
 *   404), so those are reported and skipped;
 * - a single-segment legacy path is not written: `/<slug>` is also the content
 *   short URL, and guessing there would shadow a page;
 * - a path that already has a row is never replaced — a mapping a human typed
 *   wins, exactly like the slug-change writer;
 * - two legacy rows claiming one path are ambiguous and neither is written.
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

/** Same shape as `catalogItemPath` in `@tm/flow-contracts`. */
function productPath(slug: string): string {
  return `/products/${slug}`
}

function normalizePath(value: string): string {
  return `/${value.replace(/^\/+|\/+$/g, '')}`
}

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacyItems = await connection.collection('items').find(tenantMatcher).toArray()
  const legacyCategories = await connection.collection('item_categories').find(tenantMatcher).toArray()
  const legacyTenants = await legacyTenantBuckets(connection, ['items', 'item_categories'])

  // The target is the migrated row the CMS serves, not a slug rebuilt from the
  // legacy document: the importer may have suffixed a duplicated slug.
  const targets = new Map<string, string>()
  for (const row of await connection.collection('catalog_items')
    .find({ siteId, legacyId: { $ne: null } }, { projection: { legacyId: 1, slug: 1, status: 1 } })
    .toArray()) {
    if (row.status !== 'published') continue
    const slug = legacyText((row.slug as Record<string, unknown> | undefined)?.vi)
    if (slug) targets.set(String(row.legacyId), productPath(slug))
  }

  const categoryTargets = new Map<string, string>()
  for (const row of await connection.collection('catalog_categories')
    .find({ siteId, legacyId: { $ne: null }, isDeleted: { $ne: true } }, { projection: { legacyId: 1, slug: 1 } })
    .toArray()) {
    const slug = legacyText((row.slug as Record<string, unknown> | undefined)?.vi)
    if (slug) categoryTargets.set(String(row.legacyId), `/categories/${slug}`)
  }

  const existingFrom = new Set<string>()
  for (const row of await connection.collection('content_redirects').find({ siteId }, { projection: { from: 1 } }).toArray()) {
    existingFrom.add(String(row.from))
  }

  // Content short URLs live at `/<slug>`; a redirect must never shadow one.
  const contentPaths = new Set<string>()
  for (const row of await connection.collection('content')
    .find({ siteId, status: 'published' }, { projection: { locales: 1 } })
    .toArray()) {
    for (const entry of (row.locales as { slug?: string }[] | undefined) ?? []) {
      if (entry.slug) contentPaths.add(`/${entry.slug}`)
    }
  }

  const skipped: Record<string, number> = {}
  const examples: string[] = []
  function skip(reason: string, detail: string): void {
    skipped[reason] = (skipped[reason] ?? 0) + 1
    if (examples.length < 12) examples.push(`${detail} — ${reason}`)
  }

  // Group first: a source path reached by two legacy rows is ambiguous, and the
  // first one seen must not win by accident.
  const candidates = new Map<string, Map<string, string[]>>()
  function plan(record: Record<string, unknown>, target: string | undefined): void {
    const legacyId = String(record._id)
    const fullPath = legacyLocalized(record.fullPath, 500)
    const raw = legacyText(fullPath.vi || fullPath.en)
    if (!raw) {
      skip('no legacy path', legacyId)
      return
    }
    const from = normalizePath(raw)
    if (!target) {
      skip('no published v2 row (run migrate:catalog --apply first, or the record is not published)', from)
      return
    }
    if (from === target) {
      skip('legacy path already equals the v2 path', from)
      return
    }
    if (from.split('/').filter(Boolean).length < 2) {
      skip('single-segment legacy path', from)
      return
    }
    if (contentPaths.has(from)) {
      skip('a published page owns this path', from)
      return
    }
    if (existingFrom.has(from)) {
      skip('already has a redirect row', from)
      return
    }
    const byTarget = candidates.get(from) ?? new Map<string, string[]>()
    const owners = byTarget.get(target) ?? []
    owners.push(legacyId)
    byTarget.set(target, owners)
    candidates.set(from, byTarget)
  }

  for (const record of legacyItems) {
    plan(record, targets.get(String(record._id)))
  }
  // A legacy category path is sometimes a single segment, and `/<slug>` is also the
  // content short URL on this site, so those paths are reported for a decision
  // instead of being planned.
  let categorySingleSegment = 0
  for (const record of legacyCategories) {
    const fullPath = legacyLocalized(record.fullPath, 500)
    const raw = legacyText(fullPath.vi || fullPath.en)
    if (raw && normalizePath(raw).split('/').filter(Boolean).length < 2) {
      categorySingleSegment++
      continue
    }
    plan(record, categoryTargets.get(String(record._id)))
  }

  const planned: Array<{ from: string, to: string }> = []
  for (const [from, byTarget] of candidates) {
    if (byTarget.size > 1) {
      skip('two legacy rows claim the same path', `${from} -> ${[...byTarget.keys()].join(', ')}`)
      continue
    }
    for (const [to, ids] of byTarget) {
      planned.push({ from, to })
      examples.push(`${from} -> ${to} (legacy ${ids.join(', ')})`)
    }
  }
  planned.sort((a, b) => (a.from < b.from ? -1 : 1))

  console.log(`redirect migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy items ${legacyItems.length}, legacy item categories ${legacyCategories.length}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)
  console.log(`  planned ${planned.length}, skipped ${JSON.stringify(skipped)}`)
  console.log(`  category paths not planned ${categorySingleSegment} (a legacy category path is a single segment, and /<slug> is also the content short URL, so each one needs a decision)`)
  console.log(`  planned detail: ${planned.length} paths (${planned.filter(entry => entry.to.startsWith('/products/')).length} products, ${planned.filter(entry => entry.to.startsWith('/categories/')).length} categories)`)
  for (const example of examples) console.log(`    ${example}`)

  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  found no legacy items/item_categories in ${database}; the legacy collections live in the customer-named database (e.g. TM_MONGO_DB=sen-tuan), not in the app_*_cms one`)
  }

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    await syncRedirectIndexes(connection)
    let wrote = 0
    let kept = 0
    for (const entry of planned) {
      const result = await connection.collection('content_redirects').updateOne(
        { siteId, from: entry.from },
        {
          $setOnInsert: {
            siteId,
            from: entry.from,
            to: entry.to,
            statusCode: 301,
            isActive: true,
            note: 'legacy import',
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      )
      if (result.upsertedCount > 0) wrote++
      else kept++
    }
    console.log(`  wrote ${wrote} redirects, kept ${kept} existing rows`)
  }
} finally {
  await connection.close()
}
