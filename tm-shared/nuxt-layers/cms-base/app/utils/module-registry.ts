/**
 * Single source of truth for CMS business modules.
 *
 * `dataSource` records whether a module is actually wired to a tenant data source.
 * Pages and navigation must read the module state from here (via `useModuleState`)
 * instead of inventing their own flags. Modules with `dataSource: 'pending'` must
 * never render business records or sample numbers.
 */

export type CmsModuleKey =
  | 'catalog'
  | 'orders'
  | 'inventory'
  | 'finance'
  | 'reports'
  | 'media'
  | 'aiWorkspace'

export type CmsModuleDataSource = 'connected' | 'pending'

export interface CmsModuleDefinition {
  key: CmsModuleKey
  route: string
  icon: string
  disabledIcon: string
  /** i18n key for the navigation label (also used as the page title). */
  navKey: string
  /** i18n key for the page description. */
  descriptionKey: string
  /** i18n key explaining what is still missing before the module can show data. */
  pendingHintKey: string
  dataSource: CmsModuleDataSource
}

export const CMS_MODULE_MAP = {
  catalog: {
    key: 'catalog',
    route: '/catalog',
    icon: 'i-lucide-package',
    disabledIcon: 'i-lucide-package-x',
    navKey: 'nav.catalog',
    descriptionKey: 'modules.catalog.description',
    pendingHintKey: 'modules.catalog.pendingHint',
    dataSource: 'pending',
  },
  orders: {
    key: 'orders',
    route: '/orders',
    icon: 'i-lucide-shopping-cart',
    disabledIcon: 'i-lucide-shopping-cart',
    navKey: 'nav.orders',
    descriptionKey: 'modules.orders.description',
    pendingHintKey: 'modules.orders.pendingHint',
    dataSource: 'pending',
  },
  inventory: {
    key: 'inventory',
    route: '/inventory',
    icon: 'i-lucide-boxes',
    disabledIcon: 'i-lucide-package-x',
    navKey: 'nav.inventory',
    descriptionKey: 'modules.inventory.description',
    pendingHintKey: 'modules.inventory.pendingHint',
    dataSource: 'pending',
  },
  finance: {
    key: 'finance',
    route: '/finance',
    icon: 'i-lucide-wallet',
    disabledIcon: 'i-lucide-wallet',
    navKey: 'nav.finance',
    descriptionKey: 'modules.finance.description',
    pendingHintKey: 'modules.finance.pendingHint',
    dataSource: 'pending',
  },
  reports: {
    key: 'reports',
    route: '/reports',
    icon: 'i-lucide-bar-chart-3',
    disabledIcon: 'i-lucide-bar-chart-3',
    navKey: 'nav.reports',
    descriptionKey: 'modules.reports.description',
    pendingHintKey: 'modules.reports.pendingHint',
    dataSource: 'pending',
  },
  media: {
    key: 'media',
    route: '/media',
    icon: 'i-lucide-image',
    disabledIcon: 'i-lucide-image-off',
    navKey: 'nav.media',
    descriptionKey: 'modules.media.description',
    pendingHintKey: 'modules.media.pendingHint',
    dataSource: 'connected',
  },
  aiWorkspace: {
    key: 'aiWorkspace',
    route: '/ai',
    icon: 'i-lucide-sparkles',
    disabledIcon: 'i-lucide-sparkles',
    navKey: 'nav.aiWorkspace',
    descriptionKey: 'modules.aiWorkspace.description',
    pendingHintKey: 'modules.aiWorkspace.pendingHint',
    dataSource: 'pending',
  },
} satisfies Record<CmsModuleKey, CmsModuleDefinition>

export const CMS_MODULES: readonly CmsModuleDefinition[] = Object.values(CMS_MODULE_MAP)

export const getCmsModule = (key: CmsModuleKey): CmsModuleDefinition => CMS_MODULE_MAP[key]
