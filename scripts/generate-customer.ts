import fs from 'node:fs'
import path from 'node:path'

/**
 * Scaffolds a new customer layer pair for the registry-driven build pipeline.
 * Usage: tsx scripts/generate-customer.ts <customerId> "<CompanyName>" <primaryToken> [primaryHex] [--web]
 * Example: tsx scripts/generate-customer.ts phu-quy "Phú Quý Gold" yellow "#eab308" --web
 */

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const positional = args.filter((arg) => !arg.startsWith('--'))

const customerId = positional[0]
const companyName = positional[1]
const primaryToken = positional[2]

if (!customerId || !companyName || !primaryToken) {
  console.log('Usage: tsx scripts/generate-customer.ts <customerId> "<CompanyName>" <primaryToken> [primaryHex] [--web]')
  process.exit(1)
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(customerId)) {
  console.error('customerId must be lowercase alphanumeric with optional hyphens.')
  process.exit(1)
}

const primaryHex = positional[3] || '#8b5cf6'
const includeWeb = flags.has('--web')

const rootDir = process.cwd()
const registryPath = path.join(rootDir, 'tm-shared/customer-layers/registry/customers.ts')
const cmsDir = path.join(rootDir, 'tm-shared/customer-layers/cms', customerId)
const webDir = path.join(rootDir, 'tm-shared/customer-layers/web', `${customerId}-web`)
const normalizedId = customerId.replace(/-/g, '_')
const tenantId = `tenant_${normalizedId}`
const cmsAppId = `app_${normalizedId}_cms`
const webAppId = `app_${normalizedId}_web`

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function writeLayerPackage(layerDir: string, layerName: string) {
  fs.writeFileSync(
    path.join(layerDir, 'package.json'),
    JSON.stringify({ name: layerName, version: '0.1.0', type: 'module', main: './nuxt.config.ts' }, null, 2) + '\n'
  )
}

function headConfig(kind: 'cms' | 'web') {
  const title = kind === 'cms' ? `${companyName} CMS` : companyName
  const description = kind === 'cms' ? `Quản trị ${companyName}` : `${companyName} — cửa hàng trực tuyến`
  const links = [
    `        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },`,
    `        { rel: 'apple-touch-icon', href: '/branding/icon-192.png' },`,
    `        { rel: 'manifest', href: '/manifest.webmanifest' },`,
  ]

  const meta = [
    `        { name: 'description', content: '${description}' },`,
    `        { name: 'theme-color', content: '${primaryHex}' },`,
  ]
  if (kind === 'cms') {
    meta.push(`        { name: 'apple-mobile-web-app-title', content: '${companyName}' },`)
  } else {
    meta.push(
      `        { property: 'og:type', content: 'website' },`,
      `        { property: 'og:title', content: '${title}' },`,
      `        { property: 'og:description', content: '${description}' },`,
      `        { name: 'twitter:card', content: 'summary_large_image' },`
    )
  }

  return `export default defineNuxtConfig({
  app: {
    head: {
      title: '${title}',
      link: [
${links.join('\n')}
      ],
      meta: [
${meta.join('\n')}
      ],
    },
  },
})
`
}

function copyBranding(templateDir: string, layerDir: string, kind: 'cms' | 'web') {
  fs.cpSync(path.join(templateDir, 'public'), path.join(layerDir, 'public'), { recursive: true })

  const manifestPath = path.join(layerDir, 'public/manifest.webmanifest')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  if (kind === 'cms') {
    manifest.name = `${companyName} CMS`
    manifest.short_name = companyName
    manifest.description = `Quản trị ${companyName}`
  } else {
    manifest.name = companyName
    manifest.short_name = companyName
    manifest.description = `${companyName} — cửa hàng trực tuyến`
  }
  manifest.theme_color = primaryHex
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

ensureDir(path.join(cmsDir, 'app'))
writeLayerPackage(cmsDir, `@tm/customer-layer-${customerId}-cms`)
fs.writeFileSync(path.join(cmsDir, 'nuxt.config.ts'), headConfig('cms'))
fs.writeFileSync(
  path.join(cmsDir, 'app/app.config.ts'),
  `export default defineAppConfig({
  customer: {
    customerId: '${customerId}',
    tenantId: '${tenantId}',
    cmsAppId: '${cmsAppId}',
    companyName: '${companyName}',
    theme: {
      primary: '${primaryToken}',
      secondary: 'slate',
      neutral: 'zinc',
      radius: '6px',
    },
    entitlements: {
      catalog: true,
      orders: true,
      inventory: true,
      purchaseOrders: false,
      finance: false,
      reports: true,
      media: true,
      aiWorkspace: false,
    },
  },
  ui: {
    colors: {
      primary: '${primaryToken}',
      secondary: 'slate',
      neutral: 'zinc',
    },
  },
})
`
)
copyBranding(path.join(rootDir, 'tm-shared/customer-layers/cms/default-cms'), cmsDir, 'cms')

if (includeWeb) {
  ensureDir(path.join(webDir, 'app'))
  writeLayerPackage(webDir, `@tm/customer-layer-${customerId}-web`)
  fs.writeFileSync(path.join(webDir, 'nuxt.config.ts'), headConfig('web'))
  fs.writeFileSync(
    path.join(webDir, 'app/app.config.ts'),
    `export default defineAppConfig({
  customer: {
    customerId: '${customerId}',
    tenantId: '${tenantId}',
    webAppId: '${webAppId}',
    companyName: '${companyName}',
    domains: [],
    theme: {
      primary: '${primaryToken}',
      secondary: 'slate',
      neutral: 'zinc',
      radius: '6px',
    },
  },
  ui: {
    colors: {
      primary: '${primaryToken}',
      secondary: 'slate',
      neutral: 'zinc',
    },
  },
})
`
  )
  copyBranding(path.join(rootDir, 'tm-shared/customer-layers/web/default-web'), webDir, 'web')
}

const registryEntry = `  '${customerId}': {
    customerId: '${customerId}',
    tenantId: '${tenantId}',
    companyName: '${companyName}',
    displayName: '${companyName}',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/${customerId}',
        displayName: '${companyName} CMS',
        appId: '${cmsAppId}',
        requiredAssets: CMS_ASSETS,
      },${
        includeWeb
          ? `
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/${customerId}-web',
        displayName: '${companyName} Website',
        appId: '${webAppId}',
        requiredAssets: WEB_ASSETS,
      },`
          : ''
      }
    },
  },

  // __TM_REGISTRY_ENTRIES__`

const registry = fs.readFileSync(registryPath, 'utf-8')
if (registry.includes(`'${customerId}':`) || registry.includes(`  ${customerId}:`)) {
  console.log(`Registry already contains "${customerId}", skipping registry update.`)
} else if (!registry.includes('// __TM_REGISTRY_ENTRIES__')) {
  console.error('Registry marker "// __TM_REGISTRY_ENTRIES__" is missing; add the entry manually.')
  process.exit(1)
} else {
  fs.writeFileSync(registryPath, registry.replace('  // __TM_REGISTRY_ENTRIES__', registryEntry))
  console.log(`Registry updated: ${path.relative(rootDir, registryPath)}`)
}

console.log(`\n✅ Customer layers scaffolded:`)
console.log(`   CMS: ${path.relative(rootDir, cmsDir)}`)
if (includeWeb) console.log(`   Web: ${path.relative(rootDir, webDir)}`)
console.log('\nNext steps: replace placeholder branding in public/branding, then run pnpm validate:registry && pnpm verify:scaffold.')
