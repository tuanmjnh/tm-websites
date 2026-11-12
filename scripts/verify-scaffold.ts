import fs from 'node:fs'
import path from 'node:path'
import { customers } from '../tm-shared/customer-layers/registry/customers.js'
import { resolveCustomerLayers } from '../tm-shared/customer-layers/registry/resolver.js'
import type { AppKind } from '../tm-shared/customer-layers/registry/schema.js'

const rootDir = process.cwd()
const errors: string[] = []
let checkCount = 0

function check(condition: boolean, label: string) {
  checkCount++
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    console.error(`  ❌ ${label}`)
    errors.push(label)
  }
}

function read(filePath: string) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
}

const baseLayers = ['core-base', 'api-base', 'config-base', 'cms-base', 'web-base']

console.log('🔍 Checking TM Websites scaffolding integrity...\n')

console.log('1. Root workspace')
for (const rel of ['package.json', 'pnpm-workspace.yaml', 'tm-cms/nuxt.config.ts', 'tm-web/nuxt.config.ts']) {
  check(fs.existsSync(path.join(rootDir, rel)), rel)
}

console.log('\n2. Base Nuxt layers')
for (const layer of baseLayers) {
  const dir = path.join(rootDir, 'tm-shared/nuxt-layers', layer)
  check(fs.existsSync(path.join(dir, 'nuxt.config.ts')), `${layer}/nuxt.config.ts`)
  check(fs.existsSync(path.join(dir, 'package.json')), `${layer}/package.json`)
}

console.log('\n3. Customer layers (registry-driven)')
for (const entry of Object.values(customers)) {
  for (const appKind of ['cms', 'web'] as AppKind[]) {
    const appEntry = entry.apps[appKind]
    if (!appEntry?.enabled) continue

    const label = `${entry.customerId}/${appKind}`
    const layerDir = path.join(rootDir, appEntry.layerPath)

    try {
      const resolved = resolveCustomerLayers({ appKind, customerId: entry.customerId, repoRoot: rootDir })
      check(resolved.appId === appEntry.appId, `${label}: registry appId resolves (${resolved.appId})`)

      const configFile = path.join(layerDir, 'nuxt.config.ts')
      const appConfigFile = path.join(layerDir, 'app/app.config.ts')
      const configText = read(configFile)
      const appConfigText = read(appConfigFile)

      check(!!configText, `${label}: nuxt.config.ts`)
      check(!!appConfigText, `${label}: app/app.config.ts`)
      check(appConfigText.includes(`customerId: '${entry.customerId}'`), `${label}: customerId matches registry`)
      check(appConfigText.includes(`tenantId: '${resolved.tenantId}'`), `${label}: tenantId matches registry`)
      check(appConfigText.includes(`${appKind === 'cms' ? 'cmsAppId' : 'webAppId'}: '${resolved.appId}'`), `${label}: appId matches registry`)

      for (const asset of resolved.requiredAssets) {
        const assetPath = path.join(layerDir, asset)
        const exists = fs.existsSync(assetPath) && fs.statSync(assetPath).size > 0
        check(exists, `${label}: asset ${asset}`)
      }

      if (appKind === 'cms') {
        const manifestPath = path.join(layerDir, 'public/manifest.webmanifest')
        const manifest = fs.existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : null
        check(!!manifest?.name, `${label}: manifest name`)
        check(manifest?.display === 'standalone', `${label}: manifest display standalone`)
        check(Array.isArray(manifest?.icons) && manifest.icons.length >= 2, `${label}: manifest has 192/512 icons`)
        check(configText.includes("rel: 'manifest'"), `${label}: head links manifest`)
        check(configText.includes("rel: 'icon'"), `${label}: head links favicon`)
      }

      if (appKind === 'web') {
        check(configText.includes("name: 'description'"), `${label}: head description meta`)
        // A relative og:image in the customer head config is unfetchable by social crawlers, so the
        // share image is published per page from the storefront with an absolute URL instead.
        check(!configText.includes("property: 'og:image'"), `${label}: head does not pin a relative og:image`)
        const cover = path.join(layerDir, 'public/branding/og-cover.png')
        check(fs.existsSync(cover) && fs.statSync(cover).size > 0, `${label}: asset public/branding/og-cover.png`)
        for (const page of ['index.vue', 'products/[slug].vue', '[...slug].vue']) {
          const pageText = read(path.join(rootDir, 'tm-shared/nuxt-layers/web-base/app/pages', page))
          check(pageText.includes('ogImage'), `${label}: storefront ${page} publishes a share image`)
        }
        check(appConfigText.includes('domains:'), `${label}: app.config declares domains`)
      }
    } catch (error) {
      check(false, `${label}: ${(error as Error).message}`)
    }
  }
}

console.log('\n4. Host applications')
check(read(path.join(rootDir, 'tm-cms/nuxt.config.ts')).includes('ssr: false'), 'tm-cms is SPA (ssr: false)')
check(read(path.join(rootDir, 'tm-web/nuxt.config.ts')).includes('ssr: true'), 'tm-web is SSR (ssr: true)')
check(read(path.join(rootDir, 'tm-cms/nuxt.config.ts')).includes('resolveCustomerLayers'), 'tm-cms resolves customer layer dynamically')
check(read(path.join(rootDir, 'tm-web/nuxt.config.ts')).includes('resolveCustomerLayers'), 'tm-web resolves customer layer dynamically')
check(!fs.existsSync(path.join(rootDir, 'tm-cms/app/pages')), 'tm-cms host does not shadow layer pages')
check(!fs.existsSync(path.join(rootDir, 'tm-web/app/pages')), 'tm-web host does not shadow layer pages')

console.log(`\n${errors.length === 0 ? '🎉' : '⚠️'} ${checkCount - errors.length}/${checkCount} checks passed.`)

if (errors.length > 0) {
  process.exit(1)
}
