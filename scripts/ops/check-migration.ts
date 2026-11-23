import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import {
  legacyCollectionState,
  legacyEmptyDatabaseWarning,
  legacyLocalized,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'
import { legacyCatalogStatus } from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm check:migration --site <customerId>`
 *
 * A read-only parity report for a database the importers have already written to.
 * The importers' own `verified N/N` proves a run wrote what it planned; this proves
 * the result still matches the legacy source days later, and it is the command to
 * run in a rehearsal before cutover.
 *
 * The rule is one-directional on purpose: v2 may hold **more** than the legacy
 * source (an editor has written new records since), but it must never hold fewer.
 *
 * No credential is read, printed or counted here: `system_configs` is inspected
 * only for whether the four allowlisted site-identity keys are present.
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
let failed = false

function compare(domain: string, legacy: number, v2: number): void {
  const ok = v2 >= legacy
  if (!ok) failed = true
  console.log(`  ${ok ? '✅' : '❌'} ${domain.padEnd(22)} legacy ${String(legacy).padStart(4)}  v2 ${String(v2).padStart(4)}${ok ? '' : '  — fewer rows than the source'}`)
}

try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacyCollections = ['contents', 'content_categories', 'items', 'item_categories', 'system_configs', 'menus']
  const legacyTenants = await legacyTenantBuckets(connection, legacyCollections)
  const legacyState = await legacyCollectionState(connection, legacyCollections)

  console.log(`migration parity site=${siteId} db=${database} tenant=${tenant}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)
  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database, 'collections')}`)
  }

  // Content: a legacy record the importer cannot use is still counted on the legacy
  // side under its own line, so a skipped record never looks like a lost one.
  const legacyContents = await connection.collection('contents').find(tenantMatcher).toArray()
  const legacyContentCategories = await connection.collection('content_categories').find(tenantMatcher).toArray()
  const usableContents = legacyContents.filter(record => {
    for (const locale of ['vi', 'en']) {
      const title = legacyLocalized(record.title, 200)[locale]
      const slug = legacyLocalized(record.slug, 120)[locale]
      if (title && slug) return true
    }
    return false
  })
  const v2Content = await connection.collection('content').countDocuments({ siteId })
  const v2ContentPublished = await connection.collection('content').countDocuments({ siteId, status: 'published' })
  const v2ContentCategories = await connection.collection('categories').countDocuments({ siteId })

  compare('content', usableContents.length, v2Content)
  compare('content categories', legacyContentCategories.length, v2ContentCategories)
  if (usableContents.length !== legacyContents.length) {
    console.log(`     (${legacyContents.length - usableContents.length} legacy content records have no locale with both a title and a slug; the importer skips them by rule)`)
  }
  console.log(`     v2 published: ${v2ContentPublished}`)
  // J1: a migrated row that lost its body, gallery or media embeds carries
  // `legacy.incomplete`. It is still migrated — parity counts it — but the
  // operator should not read the verdict as "nothing left to finish".
  const incompleteContent = await connection.collection('content').countDocuments({
    siteId,
    // `$type` rather than `$ne: null`: a row with no `attributes` field at all is
    // "missing", and missing compares successfully against null.
    $expr: { $eq: [{ $type: { $getField: { field: 'legacy.incomplete', input: '$attributes' } } }, 'string'] },
  })
  if (incompleteContent) {
    console.log(`  ℹ️  not fully migrated    ${incompleteContent} content row(s) carry legacy.incomplete (no body, or a gallery/media list v2 does not render)`)
  }

  // Catalog: matched on the migrated identity, so an editor-created product does not
  // make a lost row look present.
  const legacyItems = await connection.collection('items').find(tenantMatcher).toArray()
  const legacyItemCategories = await connection.collection('item_categories').find(tenantMatcher).toArray()
  const v2Items = await connection.collection('catalog_items').countDocuments({ siteId, legacyId: { $ne: null } })
  const v2ItemCategories = await connection.collection('catalog_categories').countDocuments({ siteId, legacyId: { $ne: null } })
  const v2ItemsPublished = await connection.collection('catalog_items').countDocuments({ siteId, legacyId: { $ne: null }, status: 'published' })
  const legacyPublished = legacyItems.filter(record => legacyCatalogStatus(record) === 'published').length

  compare('catalog items', legacyItems.length, v2Items)
  compare('catalog categories', legacyItemCategories.length, v2ItemCategories)
  console.log(`     published: legacy ${legacyPublished}, v2 ${v2ItemsPublished}`)
  if (legacyPublished > v2ItemsPublished) {
    console.log('  ⚠️  fewer published products than the source: check `status` on the migrated rows')
  }

  // Redirects are informational: a nested legacy path may be deliberately not
  // redirected (ambiguous, or a page already owns it), and `migrate:redirects`
  // reports each of those by name.
  const nestedPaths = new Set<string>()
  for (const record of [...legacyItems, ...legacyItemCategories]) {
    const fullPath = legacyLocalized(record.fullPath, 500)
    const raw = legacyText(fullPath.vi || fullPath.en)
    if (raw && raw.split('/').filter(Boolean).length >= 2) {
      nestedPaths.add(`/${raw}`)
    }
  }
  const redirectRows = await connection.collection('content_redirects').countDocuments({ siteId, statusCode: 301 })
  console.log(`  ℹ️  redirects            nested legacy paths ${nestedPaths.size}, v2 301 rows ${redirectRows}`)

  // Settings identity, without reading any value: only whether the keys exist.
  const settings = await connection.collection('settings').findOne({ siteId }, { projection: { company: 1, locales: 1 } })
  const configs = await connection.collection('system_configs').find(tenantMatcher, { projection: { key: 1 } }).toArray()
  const configKeys = new Set(configs.map(row => legacyText(row.key)))
  const identityKeys = ['site_name', 'site_description', 'content_locales', 'enabled_modules'].filter(key => configKeys.has(key))
  console.log(`  ${settings?.company?.name ? '✅' : '⚠️ '} settings               ${settings?.company?.name ? 'company identity present' : 'no company identity yet — run migrate:settings --apply'}, locales ${JSON.stringify(settings?.locales?.enabled ?? [])}`)
  if (identityKeys.length) {
    console.log(`     legacy identity keys available ${JSON.stringify(identityKeys)}`)
  }

  // Company identity from the legacy `companies` document. Presence only: the values
  // are customer data, so they are counted, never printed.
  const company = (settings?.company ?? {}) as Record<string, unknown>
  const companyFields = ['name', 'legalName', 'taxId', 'email', 'phone', 'address'] as const
  const missingCompanyFields = companyFields.filter((field) => {
    const value = company[field]
    return typeof value !== 'string' || value.trim() === ''
  })
  const legacyCompany = await connection.collection('companies').countDocuments(tenantMatcher)
  if (legacyCompany) {
    console.log(
      `  ${missingCompanyFields.length === 0 ? '✅' : '⚠️ '} company identity        ${companyFields.length - missingCompanyFields.length}/${companyFields.length} fields filled`
      + (missingCompanyFields.length ? ` — missing ${JSON.stringify(missingCompanyFields)}; run migrate:company --apply` : ''),
    )
  }

  // CRM, inventory, purchasing and quotations. Every domain is counted on its own
  // collection pair; `migrate:crm` is the importer behind these numbers.
  const crmDomains = [
    ['customer segments', 'customer_segments', 'crm_customer_segments'],
    ['customers', 'customers', 'crm_customers'],
    ['suppliers', 'suppliers', 'crm_suppliers'],
    ['warehouses', 'warehouses', 'crm_warehouses'],
    ['inventories', 'inventories', 'crm_inventories'],
    ['purchase orders', 'purchase_orders', 'crm_purchase_orders'],
    ['quotations', 'quotations', 'crm_quotations'],
    ['payments', 'payment_transactions', 'crm_payments'],
  ] as const
  const crmGaps: string[] = []
  for (const [label, legacyName, v2Name] of crmDomains) {
    const legacyCount = await connection.collection(legacyName).countDocuments(tenantMatcher)
    const v2Count = await connection.collection(v2Name).countDocuments({ siteId })
    if (!legacyCount && !v2Count) continue
    // A customer cannot be migrated without a reviewed Hub subject
    // (`--identity-map`), so that row is a reported gap, not a parity failure.
    if (label === 'customers') {
      if (v2Count < legacyCount) crmGaps.push(`customers ${v2Count}/${legacyCount} (needs --identity-map: a legacy user id has no Hub subject by default)`)
      console.log(`  ${v2Count >= legacyCount ? '✅' : '⚠️ '} customers              legacy ${String(legacyCount).padStart(4)}  v2 ${String(v2Count).padStart(4)}`)
      continue
    }
    compare(label, legacyCount, v2Count)
    if (v2Count < legacyCount) crmGaps.push(label)
  }

  // Menus: informational, because the counts are not 1:1. `migrate:menus` merges
  // the three legacy footer blocks into one `footer` menu, and a menu nested
  // deeper than one dropdown level (the header) stays unmigrated rather than
  // being truncated. So v2 holds fewer documents than the legacy collection even
  // when every importable row landed.
  const legacyMenus = await connection.collection('menus').countDocuments({ ...tenantMatcher, isDeleted: { $ne: true } })
  const v2Menus = await connection.collection('site_menus').countDocuments({ siteId })
  if (legacyMenus || v2Menus) {
    const ok = v2Menus >= legacyMenus
    console.log(`  ${ok ? '✅' : '⚠️ '} menus                  legacy ${String(legacyMenus).padStart(4)}  v2 ${String(v2Menus).padStart(4)}${ok ? '' : '  — 3 legacy footer menus become one, and a menu nested 3 levels deep (header) is not imported'}`)
  }

  console.log(failed ? '\n❌ parity: the database holds fewer migrated rows than the legacy source\n' : '\n✅ parity: every migrated domain holds at least what the source does\n')
  // "Migrated domain" is not "every domain": menus have no importer yet, so a reader
  // must not take the line above as a clean bill for the whole database.
  const pending: string[] = []
  // The legacy footer blocks are merged and the 3-level header is refused, so a
  // smaller v2 count is expected; `migrate:menus` names each skipped menu.
  if (v2Menus < legacyMenus) pending.push('menus (merged footer; the 3-level header needs a model decision)')
  pending.push(...crmGaps)
  if (missingCompanyFields.length) pending.push('company identity fields')
  if (pending.length) {
    console.log(`ℹ️  still to import: ${pending.join(', ')} — see 14-parity-audit-2026-11-23.md\n`)
  }
  if (failed) process.exitCode = 1
} finally {
  await connection.close()
}
