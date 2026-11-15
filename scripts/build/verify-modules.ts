import fs from 'node:fs'
import path from 'node:path'
import { CMS_MODULES } from '../../tm-shared/nuxt-layers/cms-base/app/utils/module-registry.js'

/**
 * Gate: the CMS module registry and its pages must agree.
 *
 * `catalog` was marked `dataSource: 'pending'` for weeks after CAT-01 shipped: the
 * page was a full editor while the registry still told anyone reading it to connect
 * a database first. Nothing rendered that flag for catalog, so no test or browser
 * pass could notice. The rule is mechanical — a pending module is exactly a module
 * whose page renders the shared pending page — and it is checked here.
 */

const rootDir = process.cwd()
const pagesDir = path.join(rootDir, 'tm-shared/nuxt-layers/cms-base/app/pages')

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

console.log('🔍 Checking the CMS module registry against its pages...\n')

check(CMS_MODULES.length > 0, `the registry declares modules (${CMS_MODULES.length})`)

const routes = new Set<string>()
const duplicated: string[] = []

for (const module of CMS_MODULES) {
  if (routes.has(module.route)) duplicated.push(module.route)
  routes.add(module.route)

  const page = path.join(pagesDir, `${module.route.replace(/^\//, '')}.vue`)
  const relative = path.relative(rootDir, page).split(path.sep).join('/')

  if (!fs.existsSync(page)) {
    check(false, `${module.key}: ${relative} exists`)
    continue
  }

  const text = fs.readFileSync(page, 'utf-8')
  const rendersPendingPage = text.includes('<ModulePendingPage')
  const usesKey = text.includes(`module-key="${module.key}"`)

  if (module.dataSource === 'pending') {
    check(
      rendersPendingPage && usesKey,
      `${module.key}: a pending module renders ModulePendingPage for its own key`,
      [`${relative}: expected "<ModulePendingPage module-key=\"${module.key}\""`],
    )
    continue
  }

  check(
    !rendersPendingPage && !usesKey,
    `${module.key}: a connected module is not the pending page`,
    [`${relative}: connected modules need a real page, not the pending stub`],
  )
}

check(duplicated.length === 0, 'every module route is unique', duplicated.map(route => `${route}: declared twice`))

console.log(`\n${errors.length === 0 ? '🎉' : '⚠️'} ${checkCount - errors.length}/${checkCount} checks passed.`)

if (errors.length > 0) process.exit(1)
