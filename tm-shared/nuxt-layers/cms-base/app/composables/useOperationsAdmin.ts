/**
 * CMS operations client: orders, inventory (balances, warehouses, transfers,
 * stocktakes), finance (payments, payables) and the finance reports.
 *
 * Every module here already owns a server service and admin routes; this file
 * only speaks HTTP to them. Records belong to the deployment's site, so requests
 * carry no site id — the server resolves it from the tenant binding.
 */

export interface AdminOrderItem {
  itemId: string | null
  variantId: string | null
  supplierId: string | null
  itemName: string
  sku: string
  attributes: Record<string, string>
  price: number
  quantity: number
  thumbnail: string | null
  returnedQuantity: number
}

export interface AdminOrder {
  id: string
  siteId: string
  code: string
  customerId: string | null
  channel: string
  status: string
  paymentStatus: string
  paymentMethod: string
  currency: string
  items: AdminOrderItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  paidAmount: number
  shippingAddress: Record<string, string>
  note: string
  warehouseId: string | null
  history: { status: string, at: string, note: string, actorId: string }[]
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminInventoryBalance {
  id: string
  siteId: string
  itemId: string
  variantId: string | null
  warehouseId: string
  sku: string
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  binLocation: string
  lowStockThreshold: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminWarehouse {
  id: string
  siteId: string
  code: string
  title: string
  address: string
  phone: string
  status: string
  description: string
  avatar: string | null
  sort: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminTransferLine {
  itemId: string
  variantId: string | null
  sku: string
  itemName: string
  quantity: number
  receivedQuantity: number
  serials: string[]
}

export interface AdminTransfer {
  id: string
  siteId: string
  code: string
  fromWarehouseId: string
  toWarehouseId: string
  status: string
  lines: AdminTransferLine[]
  note: string
  shippedAt: string | null
  receivedAt: string | null
  cancelledAt: string | null
  cancelReason: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminStocktakeLine {
  itemId: string
  variantId: string | null
  sku: string
  itemName: string
  expectedQuantity: number
  countedQuantity: number
  difference: number
  note: string
  serials?: string[]
}

export interface AdminStocktake {
  id: string
  code: string
  warehouseId: string
  status: string
  lines: AdminStocktakeLine[]
  note: string
  completedAt: string | null
  revision: number
  updatedAt: string | null
}

export interface AdminPayment {
  id: string
  siteId: string
  code: string
  direction: string
  referenceModel: string
  referenceId: string
  referenceCode: string
  partyId: string | null
  allocations: { referenceModel: string, referenceId: string, referenceCode: string, amount: number }[]
  amount: number
  currency: string
  method: string
  state: string
  note: string
  paidAt: string
  performerId: string | null
  voidedAt: string | null
  voidReason: string
  reconciledAt: string | null
  reconciliationRef: string
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminPayable {
  id: string
  siteId: string
  code: string
  purchaseOrderId: string
  purchaseOrderCode: string
  supplierId: string | null
  amount: number
  currency: string
  status: string
  postedAt: string | null
  voidedAt: string | null
  voidReason: string
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface FinanceSummary {
  range: { from: string, to: string }
  timeZone: string
  received: { total: number, count: number, byMethod: Record<string, number> }
  paidOut: { total: number, count: number, byMethod: Record<string, number> }
  net: number
  receivables: { outstanding: number, count: number, overdueCount: number }
  payables: { outstanding: number, count: number, overdueCount: number }
  voided: { total: number, count: number }
}

export interface FinanceAging {
  asOf: string
  timeZone: string
  receivables: { key: string, label: string, amount: number, count: number }[]
  payables: { key: string, label: string, amount: number, count: number }[]
  totals: { receivables: number, payables: number }
}

export interface FinanceLedgerRow {
  id: string
  paidAt: string
  day: string
  code: string
  direction: string
  method: string
  amount: number
  state: string
  referenceCode: string
  voidedAt: string | null
}

interface ListMeta {
  nextCursor?: string
  hasMore?: boolean
  counts?: Record<string, number>
}

interface ListResponse<T> {
  success: boolean
  data: T[]
  meta?: ListMeta
}

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

const pageQuery = (params: Record<string, string | number | boolean | undefined | null>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

const withMeta = <T,>(payload: ListResponse<T>, counts: Record<string, number>) => ({
  data: payload.data,
  nextCursor: payload.meta?.nextCursor ?? null,
  hasMore: payload.meta?.hasMore === true,
  counts: { ...counts, ...(payload.meta?.counts ?? {}) },
})

export const useOperationsAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const write = (url: string, method: string, body: unknown, reason?: string) =>
    plainFetch(url, {
      method,
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as Promise<{ success: boolean, data: unknown }>

  const one = <T,>(payload: { data: unknown }): T => payload.data as T

  /* ------------------------------- orders -------------------------------- */

  const listOrders = async (params: {
    q?: string
    status?: string
    customer?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/orders${pageQuery({
      q: params.q,
      status: params.status,
      customer: params.customer,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminOrder>
    return withMeta(payload, { all: 0, active: 0, deleted: 0 })
  }

  const createOrder = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminOrder>(await write('/api/v1/admin/commerce/orders', 'POST', body, reason))

  const updateOrder = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminOrder>(await write(`/api/v1/admin/commerce/orders/${id}`, 'PATCH', body, reason))

  const deleteOrder = async (id: string, revision: number, reason?: string) =>
    one<AdminOrder>(await write(`/api/v1/admin/commerce/orders/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const restoreOrder = async (id: string, revision: number, reason?: string) =>
    one<AdminOrder>(await write(`/api/v1/admin/commerce/orders/${id}/restore?revision=${revision}`, 'POST', {}, reason))

  /* ------------------------------- catalog ------------------------------- */

  const listItemOptions = async (q = '') => {
    const payload = await plainFetch(`/api/v1/admin/catalog/items${pageQuery({ q, limit: 20 })}`) as {
      data: { id: string, key: string, sku: string, title: Record<string, string>, basePrice: number, salePrice: number | null, stock: number }[]
    }
    return payload.data
  }

  /* ------------------------------ inventory ------------------------------ */

  const listInventories = async (params: {
    q?: string
    warehouse?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/inventory/inventories${pageQuery({
      q: params.q,
      warehouse: params.warehouse,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminInventoryBalance>
    return withMeta(payload, { all: 0, lowStock: 0, deleted: 0 })
  }

  const listWarehouses = async (params: {
    q?: string
    status?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/inventory/warehouses${pageQuery({
      q: params.q,
      status: params.status,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminWarehouse>
    return withMeta(payload, { all: 0, active: 0, inactive: 0, deleted: 0 })
  }

  const createWarehouse = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminWarehouse>(await write('/api/v1/admin/inventory/warehouses', 'POST', body, reason))

  const updateWarehouse = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminWarehouse>(await write(`/api/v1/admin/inventory/warehouses/${id}`, 'PATCH', body, reason))

  const deleteWarehouse = async (id: string, revision: number, reason?: string) =>
    one<AdminWarehouse>(await write(`/api/v1/admin/inventory/warehouses/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const restoreWarehouse = async (id: string, revision: number, reason?: string) =>
    one<AdminWarehouse>(await write(`/api/v1/admin/inventory/warehouses/${id}/restore?revision=${revision}`, 'POST', {}, reason))

  const listTransfers = async (params: {
    q?: string
    status?: string
    warehouse?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/inventory/transfers${pageQuery({
      q: params.q,
      status: params.status,
      warehouse: params.warehouse,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminTransfer>
    return withMeta(payload, { all: 0, draft: 0, inTransit: 0, received: 0, cancelled: 0 })
  }

  const createTransfer = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminTransfer>(await write('/api/v1/admin/inventory/transfers', 'POST', body, reason))

  const shipTransfer = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminTransfer>(await write(`/api/v1/admin/inventory/transfers/${id}/ship`, 'POST', body, reason))

  const receiveTransfer = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminTransfer>(await write(`/api/v1/admin/inventory/transfers/${id}/receive`, 'POST', body, reason))

  const cancelTransfer = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminTransfer>(await write(`/api/v1/admin/inventory/transfers/${id}/cancel`, 'POST', body, reason))

  const listStocktakes = async (params: { status?: string, warehouseId?: string } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/inventory/stocktakes${pageQuery({
      status: params.status,
      warehouseId: params.warehouseId,
    })}`) as { data: AdminStocktake[], meta?: { counts?: Record<string, number> } }
    return {
      data: payload.data,
      counts: { draft: 0, completed: 0, cancelled: 0, ...(payload.meta?.counts ?? {}) },
    }
  }

  const createStocktake = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminStocktake>(await write('/api/v1/admin/inventory/stocktakes', 'POST', body, reason))

  const completeStocktake = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminStocktake>(await write(`/api/v1/admin/inventory/stocktakes/${id}/complete`, 'POST', body, reason))

  const cancelStocktake = async (id: string, reason?: string) =>
    one<{ id: string }>(await write(`/api/v1/admin/inventory/stocktakes/${id}/cancel`, 'POST', {}, reason))

  /* ------------------------------- finance ------------------------------- */

  const listPayments = async (params: {
    direction?: string
    state?: string
    referenceModel?: string
    referenceId?: string
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/finance/payments${pageQuery({
      direction: params.direction,
      state: params.state,
      referenceModel: params.referenceModel,
      referenceId: params.referenceId,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminPayment>
    return withMeta(payload, { all: 0, posted: 0, voided: 0, postedAmount: 0 })
  }

  const createPayment = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminPayment>(await write('/api/v1/admin/finance/payments', 'POST', body, reason))

  const voidPayment = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminPayment>(await write(`/api/v1/admin/finance/payments/${id}/void`, 'POST', body, reason))

  const listPayables = async (params: { status?: string, cursor?: string | null, limit?: number } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/finance/payables${pageQuery({
      status: params.status,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminPayable>
    return withMeta(payload, {})
  }

  const voidPayable = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminPayable>(await write(`/api/v1/admin/finance/payables/${id}/void`, 'POST', body, reason))

  /* ------------------------------- reports ------------------------------- */

  const financeSummary = async (range: { from?: string, to?: string } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/reports/finance/summary${pageQuery(range)}`) as { data: FinanceSummary }
    return payload.data
  }

  const financeAging = async (asOf?: string) => {
    const payload = await plainFetch(`/api/v1/admin/reports/finance/aging${pageQuery({ asOf })}`) as { data: FinanceAging }
    return payload.data
  }

  const financeLedger = async (params: {
    from?: string
    to?: string
    state?: string
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/reports/finance/ledger${pageQuery({
      from: params.from,
      to: params.to,
      state: params.state,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as {
      data: FinanceLedgerRow[]
      meta?: { totals?: { receivable?: number, payable?: number, voided?: number }, hasMore?: boolean, nextCursor?: string }
    }
    return {
      data: payload.data,
      hasMore: payload.meta?.hasMore === true,
      nextCursor: payload.meta?.nextCursor ?? null,
      totals: {
        receivable: payload.meta?.totals?.receivable ?? 0,
        payable: payload.meta?.totals?.payable ?? 0,
        voided: payload.meta?.totals?.voided ?? 0,
      },
    }
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return {
    listOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    restoreOrder,
    listItemOptions,
    listInventories,
    listWarehouses,
    createWarehouse,
    updateWarehouse,
    deleteWarehouse,
    restoreWarehouse,
    listTransfers,
    createTransfer,
    shipTransfer,
    receiveTransfer,
    cancelTransfer,
    listStocktakes,
    createStocktake,
    completeStocktake,
    cancelStocktake,
    listPayments,
    createPayment,
    voidPayment,
    listPayables,
    voidPayable,
    financeSummary,
    financeAging,
    financeLedger,
    errorCode,
  }
}
