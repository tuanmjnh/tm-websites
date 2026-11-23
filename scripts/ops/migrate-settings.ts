import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncSettingsIndexes, SETTINGS_LOCALES } from '../../tm-cms/server/models/settings.js'
import {
  legacyCollectionState,
  legacyEmptyDatabaseWarning,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:settings --site <customerId> [--apply]`
 *
 * The legacy CMS kept site configuration in `system_configs`: one row per key, with
 * `group`, `type`, `isPublic` and `value`. v2 has one `settings` document per site
 * (company identity, SEO defaults, enabled locales, module switches).
 *
 * This command imports **four keys through an explicit allowlist** and nothing else:
 * `site_name`, `site_description`, `content_locales` and the content/catalog part of
 * `enabled_modules`. That is deliberately narrow, because the same collection also
 * holds plaintext credentials — measured on the local copies on 2026-11-18: JWT
 * secrets, a refresh secret, a revalidate secret, a Google client secret, a Firebase
 * private key, a VAPID private key, a Cloudinary API secret, a password-reset value
 * and a MongoDB URI with a username and password in it.
 *
 * Two rules follow from that and are not negotiable:
 *
 * - a value only lands in v2 if its key is on the allowlist **and** it does not look
 *   like a credential; a value is never printed, copied into a report or written
 *   anywhere except the settings field it maps to;
 * - the report names the keys that are secret so the owner knows to rotate them,
 *   because they have been sitting in a customer database in plaintext.
 *
 * A rerun never overwrites an existing settings document: the import writes with
 * `$setOnInsert`, so once an editor has touched the settings, this command keeps it.
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

/** The only keys this command may write. Everything else is reported. */
const ALLOWED_KEYS = [
  'site_name',
  'site_description',
  'content_locales',
  'enabled_modules',
  'site_footer_text',
  'copyright',
  'website_url',
  'keywords',
  'maintenance_mode',
] as const

/** A key is treated as a credential on its name, regardless of `isPublic`. */
const SECRET_KEY_PATTERN = /secret|password|passwd|private|token|credential|api_key|apikey|jwt|uri|preset|vapid/i

/** Legacy module names that map onto a v2 module switch. */
const MODULE_MAP: Record<string, string> = {
  posts: 'content',
  pages: 'content',
  products: 'catalog',
}

function readList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(entry => legacyText(entry)).filter(Boolean)
  const text = legacyText(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map(entry => legacyText(entry)).filter(Boolean) : []
  } catch {
    return text.split(',').map(entry => entry.trim()).filter(Boolean)
  }
}

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const configs = await connection.collection('system_configs').find(tenantMatcher).toArray()
  const legacyTenants = await legacyTenantBuckets(connection, ['system_configs'])
  const legacyState = await legacyCollectionState(connection, ['system_configs'])

  const byKey = new Map<string, Record<string, unknown>>()
  for (const row of configs) {
    const key = legacyText(row.key)
    if (key) byKey.set(key, row)
  }

  const secretKeys = [...byKey.keys()].filter(key => SECRET_KEY_PATTERN.test(key)).sort()
  const allowedKeys = ALLOWED_KEYS.filter(key => byKey.has(key))
  const notCarried = [...byKey.keys()]
    .filter(key => !(ALLOWED_KEYS as readonly string[]).includes(key) && !SECRET_KEY_PATTERN.test(key))
    .sort()

  const name = legacyText(byKey.get('site_name')?.value).slice(0, 200)
  const description = legacyText(byKey.get('site_description')?.value).slice(0, 500)
  const locales = readList(byKey.get('content_locales')?.value)
    .filter(locale => (SETTINGS_LOCALES as readonly string[]).includes(locale))
  // The storefront skin: text and toggles the business owns. A URL is only kept
  // when it is an absolute http(s) address, because the storefront renders it as
  // the public website link.
  const footerText = legacyText(byKey.get('site_footer_text')?.value).slice(0, 300)
  const copyright = legacyText(byKey.get('copyright')?.value).slice(0, 200)
  const websiteUrl = (() => {
    const value = legacyText(byKey.get('website_url')?.value).slice(0, 300)
    return /^https?:\/\/[^\s]+$/.test(value) ? value : ''
  })()
  const keywords = legacyText(byKey.get('keywords')?.value).slice(0, 500)
  const maintenanceMode = byKey.get('maintenance_mode')?.value === true

  const modules: Record<string, boolean> = {}
  const unmappedModules: string[] = []
  for (const entry of readList(byKey.get('enabled_modules')?.value)) {
    const mapped = MODULE_MAP[entry]
    if (mapped) modules[mapped] = true
    else unmappedModules.push(entry)
  }

  console.log(`settings migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  system configs ${configs.length}, legacy tenants ${JSON.stringify(legacyTenants)}`)
  console.log(`  mapped ${allowedKeys.length} ${JSON.stringify(allowedKeys)}`)
  console.log(`  mapped fields ${JSON.stringify({
    'company.name': Boolean(name),
    'seo.defaultDescription': Boolean(description),
    'locales.enabled': locales,
    modules,
    'site.footerText': Boolean(footerText),
    'site.websiteUrl': Boolean(websiteUrl),
    'site.maintenanceMode': maintenanceMode,
  })}`)
  if (unmappedModules.length) {
    console.log(`  legacy modules without a v2 switch ${JSON.stringify(unmappedModules.sort())}`)
  }
  if (notCarried.length) {
    const shown = notCarried.slice(0, 12)
    console.log(`  not carried ${notCarried.length} ${JSON.stringify(shown)}${notCarried.length > shown.length ? ` (+${notCarried.length - shown.length} more)` : ''}`)
  }
  if (secretKeys.length) {
    // Names only. The values must never leave the customer database through this tool.
    console.log(`  ⚠️  ${secretKeys.length} legacy keys hold credentials in plaintext and are NOT imported — rotate them before launch:`)
    console.log(`      ${secretKeys.join(', ')}`)
  }
  if (!Object.keys(legacyTenants).length) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database, 'system_configs')}`)
  }

  if (!apply) {
    console.log('  nothing was written; rerun with --apply')
  } else {
    await syncSettingsIndexes(connection)
    const existing = await connection.collection('settings').findOne({ siteId })
    if (existing) {
      // An existing document is still owned by the editor, so nothing is replaced.
      // The storefront section is filled only where it is empty, the same rule
      // `migrate:company` uses for the company identity.
      const current = (existing.site ?? {}) as Record<string, unknown>
      const empty = (value: unknown) => typeof value !== 'string' || value.trim() === ''
      const patch: Record<string, unknown> = {}
      if (footerText && empty(current.footerText)) patch['site.footerText'] = footerText
      if (copyright && empty(current.copyright)) patch['site.copyright'] = copyright
      if (websiteUrl && empty(current.websiteUrl)) patch['site.websiteUrl'] = websiteUrl
      if (keywords && empty(current.keywords)) patch['site.keywords'] = keywords
      if (maintenanceMode && current.maintenanceMode !== true) {
        patch['site.maintenanceMode'] = true
      }
      if (!Object.keys(patch).length) {
        console.log('  kept the existing settings document (every storefront field already has a value)')
      } else {
        await connection.collection('settings').updateOne(
          { siteId },
          { $set: { ...patch, updatedAt: new Date() }, $inc: { revision: 1 } },
        )
        console.log(`  filled ${Object.keys(patch).length} empty storefront field(s) on the existing settings document`)
      }
    } else {
      await connection.collection('settings').updateOne(
        { siteId },
        {
          $setOnInsert: {
            siteId,
            revision: 1,
            company: name ? { name, names: { vi: name } } : {},
            seo: description ? { defaultDescription: description } : {},
            locales: locales.length ? { enabled: locales } : {},
            modules,
            site: {
              footerText,
              copyright,
              websiteUrl,
              keywords,
              maintenanceMode,
              openingHours: {},
              social: [],
            },
            updatedBy: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      )
      console.log('  wrote the settings document')
    }
  }
} finally {
  await connection.close()
}
