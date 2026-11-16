import fs from 'node:fs'
import path from 'node:path'

/**
 * Gate: every CMS write screen collects the audit note and hands it to its composable.
 *
 * `verify:audit-meta` covers the server half — a route that forgets `x-audit-reason`
 * drops the note while the UI still reports success. The client half had no test at
 * all: the note was proven by driving eight dialogs and three selection bars by hand
 * (see `docs/v2/08`), which protects nothing against a later refactor. Deleting one
 * `<AuditReasonField>` would have left every gate green.
 *
 * The rule is mechanical: a page in the table below must render the note control, and
 * it must pass the typed note into a write. Both sides are parsed as source, with
 * comments blanked out, so a page that only mentions the component passes nothing.
 */

const rootDir = process.cwd()
const appDir = 'tm-shared/nuxt-layers/cms-base/app'
const pagesDir = path.join(rootDir, appDir, 'pages')
const composablesDir = path.join(rootDir, appDir, 'composables')

type PageExpectation = {
  page: string
  /** The composable whose every write must carry the header. */
  composable: string
}

/** Every screen that writes auditable data, and the composable it writes through. */
const WRITE_PAGES: PageExpectation[] = [
  { page: 'catalog', composable: 'useCatalogAdmin' },
  { page: 'categories', composable: 'useCategoryAdmin' },
  { page: 'content', composable: 'useContentAdmin' },
  { page: 'media', composable: 'useMediaAdmin' },
  { page: 'menus', composable: 'useMenuAdmin' },
  { page: 'redirects', composable: 'useRedirects' },
  { page: 'tags', composable: 'useTagAdmin' },
  { page: 'configs', composable: 'useSettingsAdmin' },
]

const errors: string[] = []
let checkCount = 0

function check(condition: boolean, label: string, details: string[] = []) {
  checkCount++
  if (condition) {
    console.log(`  ✅ ${label}`)
    return
  }
  console.error(`  ❌ ${label}`)
  for (const detail of details) console.error(`      ${detail}`)
  errors.push(label)
}

const relative = (file: string) => path.relative(rootDir, file).split(path.sep).join('/')

/** Comments are blanked, not removed, so a line number still means what it says. */
function stripComments(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
}

function read(file: string): string {
  if (!fs.existsSync(file)) {
    errors.push(`missing file: ${relative(file)}`)
    checkCount++
    return ''
  }
  return stripComments(fs.readFileSync(file, 'utf8'))
}

const localeFiles = ['en', 'vi'].map(name => ({
  name,
  path: path.join(rootDir, 'tm-cms/i18n/locales', `${name}.json`),
}))

function lookup(json: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part]
    return undefined
  }, json)
}

for (const { page, composable } of WRITE_PAGES) {
  const pageFile = path.join(pagesDir, `${page}.vue`)
  const source = read(pageFile)

  check(
    /<AuditReasonField\b/.test(source) || /<AuditReasonModal\b/.test(source),
    `${page}: renders a control that collects the audit note`,
    [`${relative(pageFile)}: no <AuditReasonField> or <AuditReasonModal>`],
  )

  check(
    /auditReason\.value\.trim\(\)/.test(source),
    `${page}: passes the typed note into a write`,
    [`${relative(pageFile)}: the note is collected but never sent (no auditReason.value.trim())`],
  )
}

const pagesWithNoteControl = fs
  .readdirSync(pagesDir)
  .filter(name => name.endsWith('.vue'))
  .filter(name => /<AuditReasonField\b|<AuditReasonModal\b/.test(stripComments(fs.readFileSync(path.join(pagesDir, name), 'utf8'))))
  .map(name => name.replace(/\.vue$/, ''))
  .sort()

const declaredPages = WRITE_PAGES.map(entry => entry.page).sort()

check(
  pagesWithNoteControl.join(',') === declaredPages.join(','),
  'every page that collects a note is listed in this gate',
  [
    `pages with a note control: ${pagesWithNoteControl.join(', ') || '(none)'}`,
    `pages the gate knows:     ${declaredPages.join(', ')}`,
    'a new write screen must be added to WRITE_PAGES, or its note is untested',
  ],
)

for (const { composable } of WRITE_PAGES) {
  const file = path.join(composablesDir, `${composable}.ts`)
  const source = read(file)
  const writes = source.match(/headers: reason \? \{ 'x-audit-reason': reason \} : undefined/g)?.length ?? 0

  check(
    writes > 0,
    `${composable}: sends x-audit-reason on its writes`,
    [`${relative(file)}: no 'x-audit-reason' header; a typed note would be discarded`],
  )
  check(
    /reason\?: string/.test(source),
    `${composable}: accepts the note as an argument`,
    [`${relative(file)}: writes take no reason, so the page cannot pass one`],
  )
}

const fieldFile = path.join(rootDir, appDir, 'components/AuditReasonField.vue')
const fieldSource = read(fieldFile)

check(
  /:placeholder="t\('common\.auditReasonPlaceholder'\)"/.test(fieldSource),
  'the note field is labelled in the active locale',
  [`${relative(fieldFile)}: placeholder is not the translated common.auditReasonPlaceholder`],
)
check(
  /:aria-label="t\('common\.auditReason'\)"/.test(fieldSource),
  'the note field has an accessible name',
  [`${relative(fieldFile)}: missing aria-label="t('common.auditReason')"`],
)

for (const locale of localeFiles) {
  const json = JSON.parse(fs.readFileSync(locale.path, 'utf8')) as unknown
  for (const key of ['common.auditReason', 'common.auditReasonPlaceholder']) {
    const value = lookup(json, key)
    check(
      typeof value === 'string' && value.trim().length > 0,
      `${locale.name}.json: ${key} is present`,
      [`${relative(locale.path)}: no string at "${key}"`],
    )
  }
}

console.log(`\n${errors.length === 0 ? '🎉' : '⚠️'} ${checkCount - errors.length}/${checkCount} checks passed.`)

if (errors.length > 0) process.exit(1)
