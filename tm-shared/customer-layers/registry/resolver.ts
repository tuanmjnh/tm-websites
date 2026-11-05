import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { customers } from './customers.js'
import type { AppKind, CustomerRegistryEntry } from './schema.js'

export interface ResolveCustomerLayersInput {
  appKind: AppKind
  customerId: string | undefined
  repoRoot: string
}

export interface ResolveCustomerLayersResult {
  customerId: string
  tenantId: string
  appId: string
  /**
   * App that owns the public content this build reads or writes.
   * A CMS shares the paired Website app's content; a Web app owns its own.
   * Falls back to `appId` when the customer has no enabled Website app.
   */
  contentAppId: string
  /**
   * MongoDB database bound to this customer's public website data, or
   * `undefined` when the customer has no storefront data source yet.
   */
  mongoDbName?: string
  companyName: string
  domains: string[]
  appKind: AppKind
  customerLayer: string
  requiredAssets: string[]
  extends: string[]
}

// Database names are identifiers, not user input; reject anything that could
// be used to widen a connection string or escape the intended database.
const MONGO_DB_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function resolveMongoDbName(customer: CustomerRegistryEntry): string | undefined {
  const database = customer.dataSources?.mongo?.database
  if (!database) return undefined

  if (!MONGO_DB_PATTERN.test(database)) {
    throw new Error(
      `[TM Resolver Error] Customer "${customer.customerId}" declares an invalid MongoDB database name: "${database}"`
    )
  }

  return database
}

/**
 * A customer's CMS manages the content rendered by its paired Website.
 * When the customer has no enabled Website app (CMS-only), content stays
 * scoped to the CMS app itself.
 */
function resolveContentAppId(
  customer: CustomerRegistryEntry,
  appKind: AppKind,
  appId: string
): string {
  if (appKind !== 'cms') return appId
  const webApp = customer.apps.web
  return webApp?.enabled && webApp.appId ? webApp.appId : appId
}

export function resolveCustomerLayers(input: ResolveCustomerLayersInput): ResolveCustomerLayersResult {
  const customerId = input.customerId?.trim().toLowerCase()

  if (!customerId) {
    throw new Error(
      `[TM Resolver Error] TM_CUSTOMER_ID environment variable is required for build. Received: "${input.customerId}"`
    )
  }

  const customer = customers[customerId as keyof typeof customers]
  if (!customer) {
    const validKeys = Object.keys(customers).join(', ')
    throw new Error(
      `[TM Resolver Error] Unknown TM_CUSTOMER_ID: "${customerId}". Allowed customers in registry: [${validKeys}]`
    )
  }

  if (customer.status !== 'active') {
    throw new Error(`[TM Resolver Error] Customer "${customerId}" is inactive in the registry.`)
  }

  const appEntry = customer.apps[input.appKind]
  if (!appEntry || !appEntry.enabled) {
    throw new Error(
      `[TM Resolver Error] Customer "${customerId}" does not have app kind "${input.appKind}" enabled in the registry.`
    )
  }

  if (!appEntry.appId || !customer.tenantId) {
    throw new Error(
      `[TM Resolver Error] Customer "${customerId}" is missing tenantId or appId assignment in the registry.`
    )
  }

  const repoRoot = realpathSync(input.repoRoot)
  const unresolvedLayer = resolve(repoRoot, appEntry.layerPath)
  if (!existsSync(unresolvedLayer)) {
    throw new Error(
      `[TM Resolver Error] Customer layer path not found on disk: "${unresolvedLayer}" (declared: "${appEntry.layerPath}")`
    )
  }

  const layerPath = realpathSync(unresolvedLayer)
  const rel = relative(repoRoot, layerPath)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`[TM Resolver Security Alert] Customer layer path "${layerPath}" escapes repository root.`)
  }

  if (!existsSync(resolve(layerPath, 'nuxt.config.ts'))) {
    throw new Error(`[TM Resolver Error] Customer layer at "${layerPath}" is missing required nuxt.config.ts`)
  }

  const baseDir = input.appKind === 'cms' ? 'cms-base' : 'web-base'
  const appBase = resolve(repoRoot, 'tm-shared/nuxt-layers', baseDir)
  const apiBase = resolve(repoRoot, 'tm-shared/nuxt-layers/api-base')
  const configBase = resolve(repoRoot, 'tm-shared/nuxt-layers/config-base')
  const coreBase = resolve(repoRoot, 'tm-shared/nuxt-layers/core-base')

  for (const base of [appBase, apiBase, configBase, coreBase]) {
    if (!existsSync(resolve(base, 'nuxt.config.ts'))) {
      throw new Error(`[TM Resolver Error] Required base layer is missing nuxt.config.ts: "${base}"`)
    }
  }

  // Precedence: Customer Layer FIRST (highest priority among extends), followed by app base, api base, config base, core base
  return {
    customerId,
    tenantId: customer.tenantId,
    appId: appEntry.appId,
    contentAppId: resolveContentAppId(customer, input.appKind, appEntry.appId),
    mongoDbName: resolveMongoDbName(customer),
    companyName: customer.companyName,
    domains: [...(customer.domains ?? [])],
    appKind: input.appKind,
    customerLayer: layerPath,
    requiredAssets: [...(appEntry.requiredAssets ?? [])],
    extends: [layerPath, appBase, apiBase, configBase, coreBase],
  }
}

