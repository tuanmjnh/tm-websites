import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncSettingsIndexes } from '../../tm-cms/server/models/settings.js'
import {
  legacyCollectionState,
  legacyEmptyDatabaseWarning,
  legacyLocalized,
  legacyTenantBuckets,
  legacyText,
} from '../../tm-cms/server/utils/legacyImport.js'

/**
 * `pnpm migrate:company --site <customerId> [--apply] [--replace-name]`
 *
 * The legacy CMS kept the customer's identity in a single `companies` document:
 * localized name/short name/slogan, an address list, phone/hotline/fax/email/website,
 * tax code, logo/favicon/banner, a gallery, social links, opening hours, bank accounts
 * and SEO defaults. v2 keeps only `settings.company` (name, names, legalName, taxId,
 * email, phone, address, logoMediaId) plus the site SEO defaults, so this command
 * imports **the fields that have a v2 destination** and names every field that does
 * not. It never invents a value: an empty legacy field stays empty.
 *
 * Two rules:
 *
 * - a field is only written when its v2 destination is still empty, so a rerun or an
 *   editor's own value is never overwritten (revision is bumped, not reset);
 * - `company.name` is the exception the operator must ask for: `migrate:settings`
 *   seeds it from `system_configs.site_name`, which on the local copy holds the CMS
 *   name ("Sen Tuấn CMS") rather than the registered company. Pass `--replace-name`
 *   to take the legacy company name instead.
 *
 * `settings.site` (the footer/public website section) now carries what used to have no
 * destination: the public website, opening hours and social links.
 *
 * Never written: `logo` (an inline SVG string with no media record to point at),
 * bank accounts, gallery, map embed, favicon and banner — no v2 field holds them.
 * They are counted in the report so the owner knows the storefront still lacks them.
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
const replaceName = process.argv.includes('--replace-name')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')

const MAX_NAME = 200
const MAX_TEXT = 500

function trimmed(value: unknown, max = MAX_TEXT): string {
  return legacyText(value).slice(0, max)
}

/** `Twitter (X)` becomes `twitter-x`: a stable, readable platform key. */
function socialCode(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * The legacy social list, reduced to what the footer can render: a label and an
 * absolute address. A row without an http(s) URL is dropped, and `showInFloat`
 * has no v2 field (the storefront renders the footer list only).
 */
function readSocial(value: unknown): Array<{ code: string, label: string, url: string }> {
  const rows = Array.isArray(value) ? value : []
  const result: Array<{ code: string, label: string, url: string }> = []
  for (const raw of rows) {
    const entry = (raw ?? {}) as Record<string, unknown>
    const label = legacyText(entry.platform).slice(0, 80)
    const url = legacyText(entry.url).slice(0, 300)
    if (!label || !/^https?:\/\/[^\s]+$/.test(url)) continue
    result.push({ code: socialCode(label), label, url })
    if (result.length >= 12) break
  }
  return result
}

/** The default address, else the first one: the same choice the storefront makes. */
function primaryAddress(value: unknown, locale: string): string {
  const list = Array.isArray(value) ? value : []
  const rows = list
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>
      const localized = legacyLocalized(record.address, MAX_TEXT)
      return {
        text: localized[locale] || localized.vi || localized.en || '',
        isDefault: record.isDefault === true,
        sort: Number(record.sort) || 0,
      }
    })
    .filter(row => row.text)
  const chosen = rows.find(row => row.isDefault) ?? [...rows].sort((a, b) => a.sort - b.sort)[0]
  return chosen?.text.slice(0, MAX_TEXT) ?? ''
}

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const company = await connection.collection('companies').findOne(tenantMatcher)
  const legacyTenants = await legacyTenantBuckets(connection, ['companies'])
  const legacyState = await legacyCollectionState(connection, ['companies'])
  const settings = await connection.collection('settings').findOne({ siteId })

  console.log(`company migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy tenants ${JSON.stringify(legacyTenants)}`)

  if (!company) {
    console.log(`  ⚠️  ${legacyEmptyDatabaseWarning(legacyState, database, 'companies')}`)
    console.log('  nothing was written')
  } else {
    const names = legacyLocalized(company.name, MAX_NAME)
    const name = (names.vi || names.en || '').slice(0, MAX_NAME)
    const shortNames = legacyLocalized(company.shortName, MAX_NAME)
    const seo = (company.seo ?? {}) as Record<string, unknown>
    const seoDescriptions = legacyLocalized(seo.description, MAX_TEXT)

    const carried = {
      'company.name': name,
      'company.names': names,
      'company.legalName': name,
      'company.taxId': trimmed(company.taxCode, 60),
      'company.email': trimmed(company.email, 200),
      'company.phone': trimmed(company.phone || company.hotline, 60),
      'company.address': primaryAddress(company.address, 'vi'),
      'seo.defaultDescription': (seoDescriptions.vi || seoDescriptions.en || '').slice(0, MAX_TEXT),
      // `shortName` has no destination either; reported rather than dropped silently.
      'company.shortName': shortNames.vi || shortNames.en || '',
    }

    const current = (settings?.company ?? {}) as Record<string, unknown>
    const empty = (value: unknown) => typeof value !== 'string' || value.trim() === ''

    const patch: Record<string, unknown> = {}
    const wanted: Array<[string, string, string]> = [
      ['company.name', 'name', carried['company.name']],
      ['company.legalName', 'legalName', carried['company.legalName']],
      ['company.taxId', 'taxId', carried['company.taxId']],
      ['company.email', 'email', carried['company.email']],
      ['company.phone', 'phone', carried['company.phone']],
      ['company.address', 'address', carried['company.address']],
    ]
    for (const [label, field, value] of wanted) {
      if (!value) continue
      if (label === 'company.name' && replaceName) {
        if (current[field] !== value) patch[`company.${field}`] = value
        continue
      }
      if (empty(current[field])) patch[`company.${field}`] = value
    }

    const currentNames = (current.names ?? {}) as Record<string, unknown>
    const namesPatch: Record<string, string> = {}
    for (const [locale, value] of Object.entries(names)) {
      // A display name lives in `names`, so `--replace-name` has to reach it too:
      // replacing only `company.name` left the storefront showing the old label.
      if (!value) continue
      if (replaceName ? currentNames[locale] !== value : empty(currentNames[locale])) {
        namesPatch[locale] = value
      }
    }
    if (Object.keys(namesPatch).length) {
      for (const [locale, value] of Object.entries(namesPatch)) patch[`company.names.${locale}`] = value
    }

    const seoDefaults = (settings?.seo ?? {}) as Record<string, unknown>
    if (carried['seo.defaultDescription'] && empty(seoDefaults.defaultDescription)) {
      patch['seo.defaultDescription'] = carried['seo.defaultDescription']
    }

    // Storefront section: website, opening hours (per locale) and social links.
    const currentSite = (settings?.site ?? {}) as Record<string, unknown>
    const website = legacyText(company.website).slice(0, 300)
    if (website && /^https?:\/\/[^\s]+$/.test(website) && empty(currentSite.websiteUrl)) {
      patch['site.websiteUrl'] = website
    }
    const hours = legacyLocalized(company.openingHours, 200)
    const currentHours = (currentSite.openingHours ?? {}) as Record<string, unknown>
    for (const [locale, value] of Object.entries(hours)) {
      if (!value) continue
      if (empty(currentHours[locale])) patch[`site.openingHours.${locale}`] = value
    }
    const social = readSocial(company.social)
    const socialPresent = Array.isArray(currentSite.social) && currentSite.social.length > 0
    if (social.length && !socialPresent) patch['site.social'] = social

    console.log(`  company document found: ${Boolean(name)}`)
    console.log(`  fields with a v2 destination ${JSON.stringify(Object.keys(carried))}`)
    console.log(`  storefront section: website ${Boolean(website)}, opening hours ${JSON.stringify(Object.keys(hours))}, social ${social.length}`)
    console.log(`  planned writes ${JSON.stringify(patch)}`)

    const notCarried: string[] = []
    if (carried['company.name'] && current.name && current.name !== carried['company.name'] && !replaceName) {
      notCarried.push(`company.name (settings holds "${String(current.name)}"; pass --replace-name to take the legacy name)`)
    }
    if (carried['company.shortName']) notCarried.push('company.shortName')
    const counts: Array<[string, unknown]> = [
      ['company.slogan/badge/desc', company.slogan ?? company.badge ?? company.desc],
      ['company.fax', company.fax],
      ['company.logo (inline SVG, no media record)', company.logo],
      ['company.favicon', company.favicon],
      ['company.banner', company.banner],
      ['company.gallery', Array.isArray(company.gallery) ? company.gallery.length : 0],
      ['company.bankAccounts', Array.isArray(company.bankAccounts) ? company.bankAccounts.length : 0],
      ['company.mapEmbed', company.mapEmbed],
      ['company.seo.keywords/image', seo.keywords ?? seo.image],
    ]
    for (const [label, value] of counts) {
      const present = Array.isArray(value) ? value.length > 0 : Boolean(legacyText(value))
      if (present) notCarried.push(label)
    }
    if (notCarried.length) {
      console.log(`  ⚠️  ${notCarried.length} legacy field(s) have no v2 destination and are NOT imported:`)
      for (const entry of notCarried) console.log(`      ${entry}`)
    }

    if (!Object.keys(patch).length) {
      console.log('  nothing to fill (every destination already holds a value)')
    } else if (!apply) {
      console.log('  nothing was written; rerun with --apply')
    } else {
      await syncSettingsIndexes(connection)
      await connection.collection('settings').updateOne(
        { siteId },
        {
          $set: { ...patch, updatedAt: new Date(), updatedBy: null },
          $inc: { revision: 1 },
          $setOnInsert: { siteId, createdAt: new Date() },
        },
        { upsert: true },
      )
      console.log(`  wrote ${Object.keys(patch).length} field(s)`)
    }
  }
} finally {
  await connection.close()
}
