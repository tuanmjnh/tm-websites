import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCustomerLayers } from '../../tm-shared/customer-layers/registry/resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

console.log('🧪 Testing Layer Precedence & Configuration Overrides...\n')

// 1. Check CMS Layer Hierarchy
const cmsSentuan = resolveCustomerLayers({
  appKind: 'cms',
  customerId: 'sentuan',
  repoRoot,
})

console.log('1. Checking CMS Extends Order (First element = highest precedence):')
const expectedCmsOrder = [
  'tm-shared/customer-layers/cms/sentuan-cms',
  'tm-shared/nuxt-layers/cms-base',
  'tm-shared/nuxt-layers/api-base',
  'tm-shared/nuxt-layers/config-base',
  'tm-shared/nuxt-layers/core-base',
]

cmsSentuan.extends.forEach((layerPath, idx) => {
  const rel = path.relative(repoRoot, layerPath).replace(/\\/g, '/')
  const expected = expectedCmsOrder[idx]
  if (rel === expected) {
    console.log(`   ✅ [${idx + 1}] Priority ${idx + 1}: ${rel} (Matches expected)`)
  } else {
    console.error(`   ❌ [${idx + 1}] Unexpected layer order: ${rel} !== ${expected}`)
    process.exit(1)
  }
})

// 2. Check Customer app.config override capability
console.log('\n2. Verifying Customer Theme Overrides vs Base Theme:')
const coreConfigPath = path.resolve(repoRoot, 'tm-shared/nuxt-layers/core-base/app/app.config.ts')
const customerConfigPath = path.resolve(repoRoot, 'tm-shared/customer-layers/cms/sentuan-cms/app/app.config.ts')

const coreConfig = fs.readFileSync(coreConfigPath, 'utf-8')
const customerConfig = fs.readFileSync(customerConfigPath, 'utf-8')

if (coreConfig.includes("primary: 'violet'") && customerConfig.includes("primary: 'amber'")) {
  console.log(`   ✅ Base layer defines generic defaults: primary = violet`)
  console.log(`   ✅ Sentuan layer overrides custom branding: primary = amber`)
  console.log(`   ✅ Because sentuan-cms is index 0 in extends, amber takes precedence over violet.`)
} else {
  console.error('   ❌ Configuration token mismatch between base and customer layer.')
  process.exit(1)
}

// 3. Check Web Layer Hierarchy
console.log('\n3. Checking Web Extends Order:')
const webBagpost = resolveCustomerLayers({
  appKind: 'web',
  customerId: 'bagpost',
  repoRoot,
})

const expectedWebOrder = [
  'tm-shared/customer-layers/web/bag-post-web',
  'tm-shared/nuxt-layers/web-base',
  'tm-shared/nuxt-layers/api-base',
  'tm-shared/nuxt-layers/config-base',
  'tm-shared/nuxt-layers/core-base',
]

webBagpost.extends.forEach((layerPath, idx) => {
  const rel = path.relative(repoRoot, layerPath).replace(/\\/g, '/')
  const expected = expectedWebOrder[idx]
  if (rel === expected) {
    console.log(`   ✅ [${idx + 1}] Priority ${idx + 1}: ${rel} (Matches expected)`)
  } else {
    console.error(`   ❌ [${idx + 1}] Unexpected layer order: ${rel} !== ${expected}`)
    process.exit(1)
  }
})

// 4. Verify Host app has no shadowing layouts or pages
console.log('\n4. Verifying Host Apps are clean minimal bootstraps (No shadowing layouts):')
const cmsLayouts = path.resolve(repoRoot, 'tm-cms/app/layouts')
const webLayouts = path.resolve(repoRoot, 'tm-web/app/layouts')

if (!fs.existsSync(cmsLayouts) && !fs.existsSync(webLayouts)) {
  console.log('   ✅ Host applications contain no layouts/ directory.')
  console.log('   ✅ Customer layers can cleanly supply custom layouts without being shadowed by Host.')
} else {
  console.warn('   ⚠️ Host layouts directory detected. Check if shadowing is intentional.')
}

// 5. Content app scope: a CMS writes content into the app its Website reads from.
console.log('\n5. Verifying paired content app scope (CMS -> Web):')
const contentScopeCases = [
  { appKind: 'cms', customerId: 'sentuan', expected: 'app_sentuan_web' },
  { appKind: 'web', customerId: 'bagpost', expected: 'app_bag_post_web' },
  // CMS-only customers have no Website app to share content with.
  { appKind: 'cms', customerId: 'thanhtung', expected: 'app_thanh_tung_cms' },
] as const

for (const { appKind, customerId, expected } of contentScopeCases) {
  const resolved = resolveCustomerLayers({ appKind, customerId, repoRoot })
  const label = `${customerId}/${appKind}`
  if (resolved.contentAppId === expected) {
    console.log(`   ✅ [${label}] contentAppId = ${expected}`)
  } else {
    console.error(`   ❌ [${label}] contentAppId = ${String(resolved.contentAppId)} (expected ${expected})`)
    process.exit(1)
  }
}

// 6. Locale messages must compile as ICU messages: a literal `{` followed by
// whitespace is never a valid placeholder and breaks the whole locale bundle.
console.log('\n6. Verifying locale messages are ICU-safe:')
const localeDirs = [
  path.resolve(repoRoot, 'tm-cms/i18n/locales'),
  path.resolve(repoRoot, 'tm-web/i18n/locales'),
]

function assertIcuSafeMessages(value: unknown, trail: string, label: string) {
  if (typeof value === 'string') {
    if (/\{[ \t\r\n]/.test(value)) {
      console.error(`   ❌ [${label}] ${trail} contains an unescaped "{" in: ${JSON.stringify(value)}`)
      process.exit(1)
    }
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assertIcuSafeMessages(child, trail ? `${trail}.${key}` : key, label)
  }
}

for (const dir of localeDirs) {
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const label = `${path.basename(path.dirname(path.dirname(dir)))}/${file}`
    assertIcuSafeMessages(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')), '', label)
    console.log(`   ✅ [${label}] all messages are ICU-safe`)
  }
}

console.log('\n🎉 ALL LAYER PRIORITY & ISOLATION CHECKS PASSED SUCCESSFULLY!')

