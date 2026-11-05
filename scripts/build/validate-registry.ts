import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'
import type { AppKind, CustomerRegistryEntry } from '../../tm-shared/customer-layers/registry/schema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

console.log('🔍 Validating Customer Registry Integrity...')

let errors = 0

function fail(message: string) {
  console.error(`   ❌ ${message}`)
  errors++
}

function validateEntry(key: string, entry: CustomerRegistryEntry) {
  if (!entry.customerId || !entry.displayName || !entry.status || !entry.apps) {
    fail(`[Missing Fields] Customer "${key}" lacks required fields.`)
    return false
  }
  if (entry.customerId !== key) {
    fail(`[Key Mismatch] "${key}" declares customerId "${entry.customerId}".`)
  }
  if (!entry.tenantId || !entry.companyName) {
    fail(`[Missing Identity] Customer "${key}" requires tenantId and companyName.`)
  }
  return true
}

function validateApp(
  key: string,
  appKind: AppKind,
  appEntry: NonNullable<CustomerRegistryEntry['apps'][AppKind]>,
  tenantId: string
) {
  const label = `${key}/${appKind}`
  if (!appEntry.appId) fail(`[${label}] Missing appId.`)
  if (!appEntry.layerPath) fail(`[${label}] Missing layerPath.`)
  if (!appEntry.requiredAssets || appEntry.requiredAssets.length === 0) {
    fail(`[${label}] Missing requiredAssets declaration.`)
  }

  const layerDir = path.join(repoRoot, appEntry.layerPath)
  if (!fs.existsSync(layerDir)) {
    fail(`[${label}] Layer path not found: ${appEntry.layerPath}`)
    return
  }
  console.log(`   └─ ${appKind.toUpperCase()}: ${appEntry.layerPath} [OK]`)

  const appConfigPath = path.join(layerDir, 'app/app.config.ts')
  if (!fs.existsSync(appConfigPath)) {
    fail(`[${label}] Missing app/app.config.ts`)
  } else {
    const appConfig = fs.readFileSync(appConfigPath, 'utf-8')
    if (!appConfig.includes(`customerId: '${key}'`)) {
      fail(`[${label}] app.config.ts customerId does not match registry key.`)
    }
    if (!appConfig.includes(`tenantId: '${tenantId}'`)) {
      fail(`[${label}] app.config.ts tenantId does not match registry.`)
    }
    const field = appKind === 'cms' ? 'cmsAppId' : 'webAppId'
    if (!appConfig.includes(`${field}: '${appEntry.appId ?? ''}'`)) {
      fail(`[${label}] app.config.ts ${field} does not match registry.`)
    }
  }

  for (const asset of appEntry.requiredAssets ?? []) {
    const assetPath = path.join(layerDir, asset)
    if (!fs.existsSync(assetPath) || fs.statSync(assetPath).size === 0) {
      fail(`[${label}] Missing or empty asset: ${asset}`)
    }
  }

  if (appKind === 'cms') {
    const manifestPath = path.join(layerDir, 'public/manifest.webmanifest')
    if (!fs.existsSync(manifestPath)) {
      fail(`[${label}] Missing public/manifest.webmanifest`)
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
          fail(`[${label}] Manifest must declare 192/512 icons.`)
        }
      } catch {
        fail(`[${label}] manifest.webmanifest is not valid JSON.`)
      }
    }
  }
}

for (const [key, entry] of Object.entries(customers)) {
  if (!validateEntry(key, entry)) continue

  console.log(`✅ [Customer Valid] ${entry.displayName} (${key}) - tenant: ${entry.tenantId}`)

  for (const appKind of ['cms', 'web'] as AppKind[]) {
    const appEntry = entry.apps[appKind]
    if (appEntry?.enabled) validateApp(key, appKind, appEntry, entry.tenantId)
  }
}

if (errors === 0) {
  console.log('\n🎉 ALL REGISTRY ENTRIES, IDENTITIES AND LAYER ASSETS VALIDATED SUCCESSFULLY!')
  process.exit(0)
} else {
  console.error(`\n⚠️ Registry validation failed with ${errors} errors.`)
  process.exit(1)
}
