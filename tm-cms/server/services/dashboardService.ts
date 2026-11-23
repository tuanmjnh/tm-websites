import type { AdminDashboardSummary } from '@tm/flow-contracts/dashboard-admin'

/**
 * Counts behind the CMS dashboard.
 *
 * Every query is scoped to the site and skips soft-deleted rows, and the order
 * and quotation counts are "still open" rather than "all", so the number on the
 * page is one an operator can act on. The function takes the prepared models
 * instead of a connection so the route can call it inside `withPreparedDb` and a
 * test can call it with a disposable database.
 */

interface Countable {
  countDocuments(filter: Record<string, unknown>): Promise<number>
}

export interface DashboardModels {
  Content: Countable
  CatalogItem: Countable
  Order: Countable
  Quotation: Countable
  Customer: Countable
  Inventory: Countable
}

/** Content keeps its removed rows as `status: 'deleted'`, so status is enough. */
const OPEN_ORDER_STATUSES = ['pending', 'processing', 'shipped']
const OPEN_QUOTATION_STATUSES = ['draft', 'sent']

export async function readDashboardSummary(
  models: DashboardModels,
  siteId: string,
): Promise<AdminDashboardSummary> {
  const live = { siteId, isDeleted: { $ne: true } }

  const [
    contentPublished,
    contentDraft,
    catalogPublished,
    catalogDraft,
    ordersOpen,
    quotationsOpen,
    customers,
    lowStock,
  ] = await Promise.all([
    models.Content.countDocuments({ siteId, status: 'published' }),
    models.Content.countDocuments({ siteId, status: 'draft' }),
    models.CatalogItem.countDocuments({ ...live, status: 'published' }),
    models.CatalogItem.countDocuments({ ...live, status: 'draft' }),
    models.Order.countDocuments({ ...live, status: { $in: OPEN_ORDER_STATUSES } }),
    models.Quotation.countDocuments({ ...live, status: { $in: OPEN_QUOTATION_STATUSES } }),
    models.Customer.countDocuments(live),
    // Available stock is what is on hand minus what is reserved; a balance with
    // no threshold set is not "low", it is simply not tracked.
    models.Inventory.countDocuments({
      ...live,
      lowStockThreshold: { $gt: 0 },
      $expr: { $lte: [{ $subtract: ['$quantityOnHand', '$quantityReserved'] }, '$lowStockThreshold'] },
    }),
  ])

  return {
    content: { published: contentPublished, draft: contentDraft },
    catalog: { published: catalogPublished, draft: catalogDraft },
    orders: { open: ordersOpen },
    quotations: { open: quotationsOpen },
    customers: { total: customers },
    inventory: { lowStock },
  }
}
