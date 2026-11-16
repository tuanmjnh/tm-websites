import fs from 'node:fs'
import path from 'node:path'
import { CMS_MODULE_BLOCKERS, CMS_MODULES } from '../../tm-shared/nuxt-layers/cms-base/app/utils/module-registry.js'

/**
 * Gate: the CMS module registry and its pages must agree.
 *
 * `catalog` was marked `dataSource: 'pending'` for weeks after CAT-01 shipped: the
 * page was a full editor while the registry still told anyone reading it to connect
 * a database first. Nothing rendered that flag for catalog, so no test or browser
 * pass could notice. The rule is mechanical — a pending module is exactly a module
 * whose page renders the shared pending page — and it is checked here.
 *
 * The page is parsed, not grepped: the gate reads the `<ModulePendingPage>` tag and
 * its `module-key` attribute, so attribute order, line breaks and quoted values do
 * not matter, and a page that only mentions the component in a comment passes
 * nothing.
 */

const rootDir = process.cwd()
const appDir = 'tm-shared/nuxt-layers/cms-base/app'
const pagesDir = path.join(rootDir, appDir, 'pages')
const componentFile = path.join(rootDir, appDir, 'components/ModulePendingPage.vue')

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

const relative = file => path.relative(rootDir, file).split(path.sep).join('/')

/** Comments are blanked with spaces so offsets stay put and prose never matches. */
function stripComments(text: string): string {
  return text
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
    .replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
}

const locales = ['en', 'vi'].map((name) => {
  const file = path.join(rootDir, 'tm-cms/i18n/locales', `${name}.json`)
  return { name, json: JSON.parse(fs.readFileSync(file, 'utf-8')) }
})

const lookup = (json: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => {
    if (!node || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, json)

console.log('🔍 Checking the CMS module registry against its pages...\n')

check(CMS_MODULES.length > 0, `the registry declares modules (${CMS_MODULES.length})`)
check(fs.existsSync(componentFile), `${relative(componentFile)} exists`)

const routes = new Set<string>()
const duplicated: string[] = []

for (const module of CMS_MODULES) {
  if (routes.has(module.route)) duplicated.push(module.route)
  routes.add(module.route)

  const page = path.join(pagesDir, `${module.route.replace(/^\//, '')}.vue`)
  if (!fs.existsSync(page)) {
    check(false, `${module.key}: ${relative(page)} exists`)
    continue
  }

  const code = stripComments(fs.readFileSync(page, 'utf-8'))
  const tag = code.match(/<ModulePendingPage\b([^>]*)>/)
  const usedKey = tag?.[1].match(/module-key\s*=\s*["']([^"']*)["']/)?.[1]

  if (module.dataSource === 'pending') {
    check(Boolean(tag), `${module.key}: a pending module renders ModulePendingPage`, [
      `${relative(page)}: expected <ModulePendingPage module-key="${module.key}" />`,
    ])
    check(usedKey === module.key, `${module.key}: the pending page names its own module`, [
      `${relative(page)}: module-key is ${usedKey === undefined ? 'missing' : `"${usedKey}"`}`,
    ])

    // The blocker is the difference between "we need a connection" and "nobody
    // has agreed what this module stores yet"; a bare `pending` claims the first.
    const blocker = module.blocker
    check(
      Boolean(blocker) && CMS_MODULE_BLOCKERS.includes(blocker!),
      `${module.key}: a pending module says why it is pending`,
      [`blocker is ${blocker === undefined ? 'missing' : `"${blocker}"`}`],
    )

    const hintKey = module.pendingHintKey
    check(Boolean(hintKey), `${module.key}: a pending module declares a pendingHintKey`)
    if (hintKey) {
      const keys = [hintKey, `modules.blockers.${blocker}`, blocker === 'out-of-scope' ? 'modules.status.outOfScopeText' : 'modules.status.decisionText']
      const missing = locales.flatMap(locale => keys
        .filter(key => typeof lookup(locale.json, key) !== 'string')
        .map(key => `${locale.name}.json: no "${key}"`))
      check(missing.length === 0, `${module.key}: its hint and blocker copy exist in every locale`, missing)
    }
    continue
  }

  check(!tag, `${module.key}: a connected module is not the pending page`, [
    `${relative(page)}: a connected module needs a real page`,
  ])
  check(!module.pendingHintKey, `${module.key}: a connected module declares no pendingHintKey`, [
    `"${module.pendingHintKey}": never rendered, because the module is connected`,
  ])
  check(!module.blocker, `${module.key}: a connected module declares no blocker`,
    [`"${module.blocker}": nothing is blocking a connected module`])
}

check(duplicated.length === 0, 'every module route is unique', duplicated.map(route => `${route}: declared twice`))

console.log(`\n${errors.length === 0 ? '🎉' : '⚠️'} ${checkCount - errors.length}/${checkCount} checks passed.`)

if (errors.length > 0) process.exit(1)
