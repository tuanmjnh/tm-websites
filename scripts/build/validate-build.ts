import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveCustomerLayers } from '../../tm-shared/customer-layers/registry/resolver.js'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import type { AppKind } from '../../tm-shared/customer-layers/registry/schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const rawAppKind = process.argv[2] as AppKind
if (rawAppKind !== 'cms' && rawAppKind !== 'web') {
  console.error(`❌ [TM Build Validator] Invalid app kind argument: "${rawAppKind}". Must be "cms" or "web".`)
  process.exit(1)
}

const appKind: AppKind = rawAppKind
const failures: string[] = []

function fail(message: string) {
  failures.push(message)
  console.error(`❌ ${message}`)
}

function pass(message: string) {
  console.log(`✅ ${message}`)
}

function readText(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

console.log(`\n============================================================`)
console.log(`🛡️  TM Platform Build Validator | Mode: ${appKind.toUpperCase()}`)
console.log(`============================================================`)

if (process.env.TM_APP_KIND && process.env.TM_APP_KIND !== appKind) {
  fail(`TM_APP_KIND is "${process.env.TM_APP_KIND}" but host is "${appKind}". Build aborted.`)
}

const customerId = process.env.TM_CUSTOMER_ID?.trim().toLowerCase()
if (!customerId) {
  fail(`TM_CUSTOMER_ID is required for every build. Allowed customers: [${Object.keys(customers).join(', ')}]`)
  process.exit(1)
}

if (process.env.VERCEL) {
  if (process.env.TM_AUTH_MODE === 'mock') {
    fail('TM_AUTH_MODE=mock is not allowed on Vercel builds. Use "hub".')
  }
  if (appKind === 'cms' && !process.env.TM_HUB_URL) {
    fail('TM_HUB_URL is required for CMS production builds on Vercel.')
  }
}

if (process.env.TM_AUTH_MODE && !['hub', 'mock'].includes(process.env.TM_AUTH_MODE)) {
  fail(`TM_AUTH_MODE must be "hub" or "mock" (received "${process.env.TM_AUTH_MODE}").`)
}

const hubUrl = process.env.TM_HUB_URL?.trim()
if (hubUrl) {
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(hubUrl)
  if (!hubUrl.startsWith('https://') && !isLocal) {
    fail(`TM_HUB_URL must use https (received "${hubUrl}").`)
  } else {
    pass(`[Hub] TM_HUB_URL -> ${hubUrl}`)
  }
}

let selected
try {
  selected = resolveCustomerLayers({ appKind, customerId, repoRoot })
  pass(`[Registry] Customer "${selected.customerId}" -> tenant "${selected.tenantId}" -> app "${selected.appId}"`)
  console.log('✅ [Extends order] Customer layer first (highest precedence):')
  selected.extends.forEach((layerPath, index) => {
    console.log(`   ${index + 1}. ${path.relative(repoRoot, layerPath)}`)
  })
} catch (error) {
  fail((error as Error).message)
  console.error('\n❌ [Validation Failed] Build aborted before Nuxt started.\n')
  process.exit(1)
}

// Branding assets
for (const asset of selected.requiredAssets) {
  const assetPath = path.join(selected.customerLayer, asset)
  if (!fs.existsSync(assetPath) || fs.statSync(assetPath).size === 0) {
    fail(`[Branding] Missing or empty required asset: ${asset}`)
  }
}
if (selected.requiredAssets.length > 0) {
  pass(`[Branding] ${selected.requiredAssets.length} required assets present`)
}

const layerConfig = readText(path.join(selected.customerLayer, 'nuxt.config.ts'))
const appConfig = readText(path.join(selected.customerLayer, 'app/app.config.ts'))

if (!appConfig) {
  fail('[Config] Customer layer is missing app/app.config.ts')
} else {
  if (!appConfig.includes(`customerId: '${selected.customerId}'`)) {
    fail(`[Config] customerId in app.config.ts does not match registry key "${selected.customerId}"`)
  }
  if (!appConfig.includes(`tenantId: '${selected.tenantId}'`)) {
    fail(`[Config] tenantId in app.config.ts does not match registry value "${selected.tenantId}"`)
  }
  const appIdField = appKind === 'cms' ? 'cmsAppId' : 'webAppId'
  if (!appConfig.includes(`${appIdField}: '${selected.appId}'`)) {
    fail(`[Config] ${appIdField} in app.config.ts does not match registry value "${selected.appId}"`)
  }
}

// Both app kinds ship a customer-owned web app manifest; the service worker and
// installability rules are the same, only the branding differs per layer.
function validateManifest() {
  const manifestPath = path.join(selected.customerLayer, 'public/manifest.webmanifest')
  if (!fs.existsSync(manifestPath)) {
    fail('[PWA] Missing public/manifest.webmanifest')
    return
  }
  const failuresBefore = failures.length
  try {
    const manifest = JSON.parse(readText(manifestPath))
    if (!manifest.name || !manifest.start_url) fail('[PWA] Manifest requires name and start_url')
    if (manifest.display !== 'standalone') fail('[PWA] Manifest display must be "standalone"')
    const icons = Array.isArray(manifest.icons) ? manifest.icons : []
    const sizes = new Set(icons.map((icon: { sizes?: string }) => icon?.sizes))
    if (!sizes.has('192x192') || !sizes.has('512x512')) {
      fail('[PWA] Manifest must declare 192x192 and 512x512 icons')
    }
    for (const icon of icons) {
      const src = typeof icon?.src === 'string' ? icon.src.replace(/^\//, '') : ''
      if (!src || !fs.existsSync(path.join(selected.customerLayer, 'public', src))) {
        fail(`[PWA] Manifest icon file not found: ${icon?.src ?? '(missing src)'}`)
      }
    }
    if (!/^#[0-9a-f]{6}$/i.test(manifest.theme_color ?? '')) {
      fail('[PWA] Manifest theme_color must be a 6-digit hex color')
    }
    if (failures.length === failuresBefore) pass('[PWA] Manifest valid with 192/512 icons')
  } catch (error) {
    fail(`[PWA] Manifest is not valid JSON: ${(error as Error).message}`)
  }
}

if (appKind === 'cms') {
  validateManifest()

  for (const required of ["rel: 'manifest'", "rel: 'icon'", "name: 'theme-color'"]) {
    if (!layerConfig.includes(required)) fail(`[PWA] nuxt.config.ts must define ${required}`)
  }
}

if (appKind === 'web') {
  for (const required of ["name: 'description'", "property: 'og:title'", "rel: 'manifest'"]) {
    if (!layerConfig.includes(required)) fail(`[SEO] nuxt.config.ts must define ${required}`)
  }

  // A relative og:image in the customer head config is unfetchable by social crawlers, so the
  // storefront publishes an absolute one per page (resolveSiteUrl) and ships a share cover instead.
  if (layerConfig.includes("property: 'og:image'")) {
    fail('[SEO] nuxt.config.ts must not pin og:image; the storefront publishes it per page')
  }
  const coverAsset = path.join(selected.customerLayer, 'public/branding/og-cover.png')
  if (!fs.existsSync(coverAsset) || fs.statSync(coverAsset).size === 0) {
    fail('[SEO] customer layer must ship public/branding/og-cover.png')
  }
  for (const page of ['index.vue', 'products/[slug].vue', '[...slug].vue']) {
    const pageText = readText(path.join(repoRoot, 'tm-shared/nuxt-layers/web-base/app/pages', page))
    if (!pageText.includes('ogImage')) fail(`[SEO] storefront ${page} must publish a share image`)
  }

  validateManifest()

  if (!fs.existsSync(path.join(repoRoot, 'tm-web/public/offline.html'))) {
    fail('[PWA] Missing tm-web/public/offline.html, the offline navigation fallback')
  }

  const domains = appConfig.match(/domains:\s*\[([^\]]*)\]/)?.[1]?.trim()
  if (!domains) {
    fail('[SEO] app.config.ts must declare at least one domain for the web installation')
  }
  if (!failures.some((item) => item.startsWith('[SEO]'))) pass('[SEO] Metadata and domain binding declared')
}

// Secret leakage scan across customer layer text files and host configs.
// The loopback dev default (`mongodb://127.0.0.1:<port>`) carries no secret and
// is the documented local fallback; everything else in a connection string is
// treated as a leak, including a cluster host with blank credentials.
const LOCAL_MONGO = /^mongodb(\+srv)?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i
const forbiddenPatterns = [
  /mongodb(\+srv)?:\/\/[^\s"'`]+/gi,
  /TM_HUB_SECRET\s*=\s*['"][^'"]+['"]/gi,
  /sk-[a-zA-Z0-9]{20,}/g,
]

function scanForSecrets(filePath: string) {
  const content = readText(filePath)
  if (!content) return
  for (const pattern of forbiddenPatterns) {
    const hits = []
    for (const found of content.matchAll(pattern)) hits.push(found[0])
    if (hits.length === 0 || hits.every(hit => LOCAL_MONGO.test(hit))) continue
    fail(`[Security] Potential hardcoded secret in ${path.relative(repoRoot, filePath)}`)
  }
}

function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.nuxt' || entry.name === '.output') continue
      walk(fullPath)
    } else if (/\.(ts|tsx|js|mjs|json|css|md)$/.test(entry.name)) {
      scanForSecrets(fullPath)
    }
  }
}

walk(selected.customerLayer)
scanForSecrets(path.join(repoRoot, `${appKind === 'cms' ? 'tm-cms' : 'tm-web'}/nuxt.config.ts`))
if (!failures.some((item) => item.startsWith('[Security]'))) {
  pass('[Security] No hardcoded secrets detected in customer layer or host config')
}

if (failures.length > 0) {
  console.error(`\n❌ [Validation Failed] ${failures.length} issue(s). Build aborted before Nuxt started.\n`)
  process.exit(1)
}

console.log(`🎉 [Validation Passed] Ready to execute "nuxt build".\n`)
