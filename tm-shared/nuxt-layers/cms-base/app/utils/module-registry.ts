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
  | 'purchaseOrders'
  | 'finance'
  | 'reports'
  | 'media'
  | 'aiWorkspace'

export type CmsModuleDataSource = 'connected' | 'pending'

/**
 * Why a pending module cannot show data yet. The distinction is the point: the
 * modules below are not all "waiting for a connection" — most wait for a data
 * model that does not exist, and one was left out of this round by decision.
 *
 * - `waiting-data`     the model exists and only the tenant source is missing
 * - `waiting-decision` no accepted data model yet (P5 domain decisions)
 * - `out-of-scope`     decided out of this round (ADR 0002)
 */
export type CmsModuleBlocker = 'waiting-data' | 'waiting-decision' | 'out-of-scope'

export const CMS_MODULE_BLOCKERS: readonly CmsModuleBlocker[] = ['waiting-data', 'waiting-decision', 'out-of-scope']

export interface CmsModuleDefinition {
  key: CmsModuleKey
  route: string
  icon: string
  disabledIcon: string
  /** i18n key for the navigation label (also used as the page title). */
  navKey: string
  /** i18n key for the page description. */
  descriptionKey: string
  /**
   * i18n key explaining what is still missing before the module can show data.
   * Only an unwired module has one: a connected module that kept a hint would be
   * telling the editor to connect something that already is.
   */
  pendingHintKey?: string
  /** Why the module is pending; absent on a connected module. */
  blocker?: CmsModuleBlocker
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
    // CAT-01 runs on the tenant database; only CAT-02 (serial/IMEI) is still open,
    // and that waits on inventory rather than on a connection.
    dataSource: 'connected',
  },
  orders: {
    key: 'orders',
    route: '/orders',
    icon: 'i-lucide-shopping-cart',
    disabledIcon: 'i-lucide-shopping-cart',
    navKey: 'nav.orders',
    descriptionKey: 'modules.orders.description',
    // COM-01/02/03 landed on the tenant database: the page lists, creates,
    // updates, hides and restores orders and shows their status history.
    dataSource: 'connected',
  },
  inventory: {
    key: 'inventory',
    route: '/inventory',
    icon: 'i-lucide-boxes',
    disabledIcon: 'i-lucide-package-x',
    navKey: 'nav.inventory',
    descriptionKey: 'modules.inventory.description',
    // INV-01/02: balances, warehouses, transfers and stocktakes are live.
    dataSource: 'connected',
  },
  purchaseOrders: {
    key: 'purchaseOrders',
    route: '/purchasing',
    icon: 'i-lucide-clipboard-list',
    disabledIcon: 'i-lucide-clipboard-list',
    navKey: 'nav.purchaseOrders',
    descriptionKey: 'modules.purchaseOrders.description',
    // PUR-01: suppliers, purchase orders and the partial receipt against them.
    dataSource: 'connected',
  },
  finance: {
    key: 'finance',
    route: '/finance',
    icon: 'i-lucide-wallet',
    disabledIcon: 'i-lucide-wallet',
    navKey: 'nav.finance',
    descriptionKey: 'modules.finance.description',
    // FIN-01: payments and payables have their own collections and commands.
    dataSource: 'connected',
  },
  reports: {
    key: 'reports',
    route: '/reports',
    icon: 'i-lucide-bar-chart-3',
    disabledIcon: 'i-lucide-bar-chart-3',
    navKey: 'nav.reports',
    descriptionKey: 'modules.reports.description',
    // FIN-02: summary, aging and ledger computed from the live ledger.
    dataSource: 'connected',
  },
  media: {
    key: 'media',
    route: '/media',
    icon: 'i-lucide-image',
    disabledIcon: 'i-lucide-image-off',
    navKey: 'nav.media',
    descriptionKey: 'modules.media.description',
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
    // Q15: out of v2 scope. Its old hint told editors to configure a provider,
    // which implied work that is not planned.
    blocker: 'out-of-scope',
    dataSource: 'pending',
  },
} satisfies Record<CmsModuleKey, CmsModuleDefinition>

export const CMS_MODULES: readonly CmsModuleDefinition[] = Object.values(CMS_MODULE_MAP)

export const getCmsModule = (key: CmsModuleKey): CmsModuleDefinition => CMS_MODULE_MAP[key]
