export type AppKind = 'cms' | 'web'

export interface CustomerAppLayerEntry {
  enabled: boolean
  layerPath: string
  displayName: string
  appId: string
  requiredAssets?: string[]
}

/**
 * Server-side data binding for a customer. The BFF resolves its database from
 * here, never from a request, so a visitor can never select another tenant's DB.
 * Websites without a binding report their catalog as "not connected".
 */
export interface CustomerDataSources {
  mongo?: {
    database: string
  }
}

export interface CustomerRegistryEntry {
  customerId: string
  tenantId: string
  companyName: string
  displayName: string
  status: 'active' | 'inactive'
  domains?: string[]
  apps: {
    cms?: CustomerAppLayerEntry
    web?: CustomerAppLayerEntry
  }
  dataSources?: CustomerDataSources
}

export type CustomerRegistry = Record<string, CustomerRegistryEntry>
