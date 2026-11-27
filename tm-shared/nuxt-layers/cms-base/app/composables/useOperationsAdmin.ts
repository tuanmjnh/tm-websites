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

export interface AdminShipment {
  id: string
  siteId: string
  code: string
  orderId: string
  status: string
  carrier: string
  trackingNumber: string
  items: { itemId: string | null, variantId: string | null, itemName: string, sku: string, quantity: number, serials: string[] }[]
  shippingAddress: Record<string, string>
  note: string
  shippedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  revision: number
  isDeleted: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminOrderReturn {
  id: string
  siteId: string
  code: string
  orderId: string
  status: string
  items: { itemId: string | null, variantId: string | null, itemName: string, sku: string, quantity: number, unitPrice: number, reason: string }[]
  refundAmount: number
  refundMethod: string
  note: string
  approvedAt: string | null
  refundedAt: string | null
  cancelledAt: string | null
  revision: number
  isDeleted: boolean
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

export interface AdminSerialNumber {
  id: string
  siteId: string
  serial: string
  itemId: string
  variantId: string | null
  warehouseId: string | null
  status: string
  purchaseOrderId: string | null
  orderId: string | null
  note: string
  receivedAt: string | null
  soldAt: string | null
  returnedAt: string | null
  scrappedAt: string | null
  revision: number
  isDeleted: boolean
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

export interface AdminOpenDocument {
  id: string
  code: string
  model: string
  status: string
  totalAmount: number
  paidAmount: number
  outstanding: number
  partyId: string | null
  partyName: string
  createdAt: string | null
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

export interface AdminSupplier {
  id: string
  siteId: string
  code: string
  title: string
  email: string
  phone: string
  status: string
  rating: number
  itemsSupplied: string[]
  avatar: string | null
  note: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminPurchaseOrderLine {
  itemId: string | null
  variantId: string | null
  itemName: string
  sku: string
  quantity: number
  unitCost: number
  receivedQuantity: number
  rejectedQuantity: number
  note: string
}

export interface AdminPurchaseOrder {
  id: string
  siteId: string
  code: string
  supplierId: string | null
  warehouseId: string | null
  status: string
  paymentStatus: string
  paymentMethod: string
  items: AdminPurchaseOrderLine[]
  totalAmount: number
  orderedTotalAmount: number
  paidAmount: number
  expectedDeliveryDate: string | null
  reconcileNote: string
  note: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminStaff {
  id: string
  subjectId: string
  employeeCode: string
  fullName: string
  positionCode: string
  jobDescription: string
  workStatus: string
  joinedAt: string | null
  leftAt: string | null
  phone: string
  note: string
  isDeleted: boolean
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminAttendance {
  id: string
  staffId: string
  date: string
  status: string
  checkIn: string | null
  checkOut: string | null
  warehouseId: string | null
  note: string
  updatedAt: string | null
}

export interface AdminSalaryConfig {
  id: string
  staffId: string
  baseSalary: number
  allowances: { title: string, amount: number }[]
  allowanceTotal: number
  standardWorkDays: number
  effectiveFrom: string
  note: string
}

export interface AdminPayroll {
  id: string
  staffId: string
  employeeCode: string
  period: string
  status: string
  salaryConfigId: string
  standardWorkDays: number
  baseSalary: number
  dailyRate: number
  workDays: number
  leaveDays: number
  absentDays: number
  basePay: number
  allowancePay: number
  adjustments: { label: string, amount: number }[]
  adjustmentTotal: number
  netPay: number
  approvedAt: string | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminShiftTemplate {
  id: string
  code: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  spanMinutes: number
  workedMinutes: number
  overnight: boolean
  capacity: number | null
  isActive: boolean
  note: string
  revision: number
  updatedAt: string | null
}

export interface AdminShiftAssignment {
  id: string
  templateId: string
  shiftCode: string
  staffId: string
  employeeCode: string
  staffName: string | null
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  workedMinutes: number
  overnight: boolean
  note: string
  updatedAt: string | null
}

export interface PriceObservation {
  date: string
  receivedAt: string
  purchaseOrderCode: string
  quantity: number
  unitCost: number
  totalValue: number
}

export interface SupplierItemPrice {
  key: string
  supplierId: string | null
  itemId: string
  variantId: string | null
  sku: string
  itemName: string
  lastUnitCost: number
  lastReceivedAt: string
  lastQuantity: number
  previousUnitCost: number | null
  changePercent: number | null
  minUnitCost: number
  maxUnitCost: number
  averageUnitCost: number
  totalQuantity: number
  totalValue: number
  observations: number
  history: PriceObservation[]
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

  /* --------------------------- fulfillment ------------------------------ */

  const listShipments = async (params: { orderId: string, status?: string, includeDeleted?: boolean, limit?: number }) => {
    const payload = await plainFetch(`/api/v1/admin/shipments${pageQuery({
      orderId: params.orderId,
      status: params.status,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      limit: params.limit ?? 100,
    })}`) as ListResponse<AdminShipment>
    return withMeta(payload, { all: 0, deleted: 0 })
  }

  const createShipment = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminShipment>(await write('/api/v1/admin/shipments', 'POST', body, reason))

  const updateShipment = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminShipment>(await write(`/api/v1/admin/shipments/${id}/update`, 'POST', body, reason))

  const deleteShipment = async (id: string, revision: number, reason?: string) =>
    one<AdminShipment>(await write(`/api/v1/admin/shipments/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const listOrderReturns = async (params: { orderId: string, status?: string, includeDeleted?: boolean, limit?: number }) => {
    const payload = await plainFetch(`/api/v1/admin/order-returns${pageQuery({
      orderId: params.orderId,
      status: params.status,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      limit: params.limit ?? 100,
    })}`) as ListResponse<AdminOrderReturn>
    return withMeta(payload, { all: 0, deleted: 0 })
  }

  const createOrderReturn = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminOrderReturn>(await write('/api/v1/admin/order-returns', 'POST', body, reason))

  const updateOrderReturn = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminOrderReturn>(await write(`/api/v1/admin/order-returns/${id}/update`, 'POST', body, reason))

  const deleteOrderReturn = async (id: string, revision: number, reason?: string) =>
    one<AdminOrderReturn>(await write(`/api/v1/admin/order-returns/${id}?revision=${revision}`, 'DELETE', {}, reason))

  /* ------------------------------- catalog ------------------------------- */

  const listItemOptions = async (q = '', limit = 20) => {
    // The catalog list route caps `limit` at 50; anything larger is a 422.
    const bounded = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50)
    const payload = await plainFetch(`/api/v1/admin/catalog/items${pageQuery({ q, limit: bounded })}`) as {
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

  const importSuppliers = async (rows: Record<string, unknown>[], reason?: string) => {
    const payload = await write('/api/v1/admin/procurement/suppliers/import', 'POST', { rows }, reason) as unknown as {
      data: {
        total: number
        created: number
        updated: number
        failed: number
        results: { row: number, code: string | null, status: string, codeError: string | null, message: string | null }[]
      }
    }
    return {
      ...payload.data,
      results: payload.data.results.map(entry => ({
        row: entry.row,
        key: entry.code,
        status: entry.status,
        code: entry.codeError,
        message: entry.message,
      })),
    }
  }

  /* ---------------------------- serial numbers ---------------------------- */

  const listSerialNumbers = async (params: {
    status?: string
    itemId?: string
    warehouseId?: string
    q?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/serial-numbers${pageQuery({
      status: params.status,
      itemId: params.itemId,
      warehouseId: params.warehouseId,
      q: params.q,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminSerialNumber>
    return withMeta(payload, { all: 0, in_stock: 0, sold: 0, returned: 0, scrapped: 0, deleted: 0 })
  }

  const registerSerialNumbers = async (serials: Record<string, unknown>[], reason?: string) =>
    (await write('/api/v1/admin/serial-numbers', 'POST', { serials }, reason)) as unknown as { data: AdminSerialNumber[] }

  const importSerialNumbers = async (rows: Record<string, unknown>[], reason?: string) => {
    const payload = await write('/api/v1/admin/serial-numbers/import', 'POST', { rows }, reason) as unknown as {
      data: {
        total: number
        created: number
        failed: number
        results: { row: number, serial: string | null, status: string, code: string | null, message: string | null }[]
      }
    }
    return {
      total: payload.data.total,
      created: payload.data.created,
      // An import only ever creates: an existing serial is a per-row failure.
      updated: 0,
      failed: payload.data.failed,
      results: payload.data.results.map(entry => ({
        row: entry.row,
        key: entry.serial,
        status: entry.status,
        code: entry.code,
        message: entry.message,
      })),
    }
  }

  const markSerialSold = async (id: string, orderId: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}/mark-sold`, 'POST', { orderId, revision }, reason))

  const markSerialReturned = async (id: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}/mark-returned`, 'POST', { revision }, reason))

  const scrapSerialNumber = async (id: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}/scrap`, 'POST', { revision }, reason))

  const moveSerialNumber = async (id: string, warehouseId: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}/move`, 'POST', { warehouseId, revision }, reason))

  // These two routes read the revision from the query, like the other soft-delete pairs.
  const deleteSerialNumber = async (id: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const restoreSerialNumber = async (id: string, revision: number, reason?: string) =>
    one<AdminSerialNumber>(await write(`/api/v1/admin/serial-numbers/${id}/restore?revision=${revision}`, 'POST', {}, reason))

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

  /** Documents a payment can still be applied to, for the payment dialog's picker. */
  const listOpenDocuments = async (params: { model?: string, q?: string, limit?: number } = {}) => {
    const bounded = Math.min(Math.max(Math.trunc(params.limit ?? 20) || 20, 1), 50)
    const payload = await plainFetch(`/api/v1/admin/finance/open-documents${pageQuery({
      model: params.model,
      q: params.q?.trim() || undefined,
      limit: bounded,
    })}`) as { data: AdminOpenDocument[] }
    return payload.data
  }

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

  /* ----------------------------- procurement ----------------------------- */

  const listSuppliers = async (params: {
    q?: string
    status?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/procurement/suppliers${pageQuery({
      q: params.q,
      status: params.status,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminSupplier>
    return withMeta(payload, { all: 0, active: 0, inactive: 0, deleted: 0 })
  }

  const createSupplier = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminSupplier>(await write('/api/v1/admin/procurement/suppliers', 'POST', body, reason))

  const updateSupplier = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminSupplier>(await write(`/api/v1/admin/procurement/suppliers/${id}`, 'PATCH', body, reason))

  const deleteSupplier = async (id: string, revision: number, reason?: string) =>
    one<AdminSupplier>(await write(`/api/v1/admin/procurement/suppliers/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const restoreSupplier = async (id: string, revision: number, reason?: string) =>
    one<AdminSupplier>(await write(`/api/v1/admin/procurement/suppliers/${id}/restore?revision=${revision}`, 'POST', {}, reason))

  const listPurchaseOrders = async (params: {
    q?: string
    status?: string
    supplier?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/procurement/purchase-orders${pageQuery({
      q: params.q,
      status: params.status,
      supplier: params.supplier,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminPurchaseOrder>
    return withMeta(payload, { all: 0, active: 0, deleted: 0 })
  }

  const createPurchaseOrder = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminPurchaseOrder>(await write('/api/v1/admin/procurement/purchase-orders', 'POST', body, reason))

  const updatePurchaseOrder = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminPurchaseOrder>(await write(`/api/v1/admin/procurement/purchase-orders/${id}`, 'PATCH', body, reason))

  const deletePurchaseOrder = async (id: string, revision: number, reason?: string) =>
    one<AdminPurchaseOrder>(await write(`/api/v1/admin/procurement/purchase-orders/${id}?revision=${revision}`, 'DELETE', {}, reason))

  const restorePurchaseOrder = async (id: string, revision: number, reason?: string) =>
    one<AdminPurchaseOrder>(await write(`/api/v1/admin/procurement/purchase-orders/${id}/restore?revision=${revision}`, 'POST', {}, reason))

  const receivePurchaseOrder = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminPurchaseOrder>(await write(`/api/v1/admin/procurement/purchase-orders/${id}/receive`, 'POST', body, reason))

  /* --------------------------------- hr ---------------------------------- */

  const listStaff = async (params: {
    q?: string
    workStatus?: string
    positionCode?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/hr/staff${pageQuery({
      q: params.q,
      workStatus: params.workStatus,
      positionCode: params.positionCode,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminStaff>
    return withMeta(payload, { all: 0, probation: 0, official: 0, resigned: 0 })
  }

  const createStaff = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminStaff>(await write('/api/v1/admin/hr/staff', 'POST', body, reason))

  const updateStaff = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminStaff>(await write(`/api/v1/admin/hr/staff/${id}`, 'PATCH', body, reason))

  const deleteStaff = async (id: string, revision: number, reason?: string) =>
    one<AdminStaff>(await write(`/api/v1/admin/hr/staff/${id}`, 'DELETE', { revision }, reason))

  const restoreStaff = async (id: string, revision: number, reason?: string) =>
    one<AdminStaff>(await write(`/api/v1/admin/hr/staff/${id}/restore`, 'POST', { revision }, reason))

  const listAttendances = async (params: {
    month?: string
    staffId?: string
    status?: string
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/hr/attendances${pageQuery({
      month: params.month,
      staffId: params.staffId,
      status: params.status,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as {
      data: AdminAttendance[]
      meta?: { counts?: Record<string, number>, nextCursor?: string | null, hasMore?: boolean }
    }
    return {
      data: payload.data,
      summary: { all: 0, present: 0, late: 0, leave: 0, absent: 0, ...(payload.meta?.counts ?? {}) } as Record<string, number>,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
    }
  }

  const upsertAttendance = async (body: Record<string, unknown>, reason?: string) =>
    (await write('/api/v1/admin/hr/attendances', 'POST', body, reason)) as unknown as { data: AdminAttendance, meta?: { created?: boolean } }

  const deleteAttendance = async (id: string, reason?: string) =>
    one<{ id: string }>(await write(`/api/v1/admin/hr/attendances/${id}`, 'DELETE', {}, reason))

  const listSalaryConfigs = async (staffId: string) => {
    const payload = await plainFetch(`/api/v1/admin/hr/salary-configs${pageQuery({ staffId })}`) as { data: AdminSalaryConfig[] }
    return payload.data
  }

  const setSalaryConfig = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminSalaryConfig>(await write('/api/v1/admin/hr/salary-configs', 'POST', body, reason))

  const listPayrolls = async (params: { period?: string, staffId?: string, status?: string, limit?: number } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/hr/payrolls${pageQuery({
      period: params.period,
      staffId: params.staffId,
      status: params.status,
      limit: params.limit,
    })}`) as {
      data: AdminPayroll[]
      meta?: { counts?: Record<string, number>, totals?: { netPay?: number, workDays?: number } }
    }
    return {
      data: payload.data,
      counts: { all: 0, draft: 0, approved: 0, paid: 0, cancelled: 0, ...(payload.meta?.counts ?? {}) } as Record<string, number>,
      totals: { netPay: payload.meta?.totals?.netPay ?? 0, workDays: payload.meta?.totals?.workDays ?? 0 },
    }
  }

  const calculatePayroll = async (body: Record<string, unknown>, reason?: string) =>
    (await write('/api/v1/admin/hr/payrolls/calculate', 'POST', body, reason)) as unknown as {
      data: AdminPayroll[]
      meta?: { lines?: { staffId: string, employeeCode: string, outcome: string, reason?: string, netPay?: number }[] }
    }

  const approvePayroll = async (id: string, revision: number, reason?: string) =>
    one<AdminPayroll>(await write(`/api/v1/admin/hr/payrolls/${id}/approve`, 'POST', { revision }, reason))

  const payPayroll = async (id: string, revision: number, reason?: string) =>
    one<AdminPayroll>(await write(`/api/v1/admin/hr/payrolls/${id}/pay`, 'POST', { revision }, reason))

  const cancelPayroll = async (id: string, revision: number, cancelReason: string, reason?: string) =>
    one<AdminPayroll>(await write(`/api/v1/admin/hr/payrolls/${id}/cancel`, 'POST', { revision, reason: cancelReason }, reason))

  /* ----------------------------- self-service ---------------------------- */

  /**
   * Self-service reads carry no staff id on purpose: the server resolves the
   * staff profile from the verified Hub subject, so one person can never ask
   * for another person's attendance or pay.
   */
  const myAttendance = async (month?: string) => {
    const payload = await plainFetch(`/api/v1/me/attendance${pageQuery({ month })}`) as {
      data: { staff: AdminStaff, attendance: { data: AdminAttendance[], summary?: Record<string, number> } }
    }
    return {
      staff: payload.data.staff,
      data: payload.data.attendance.data,
      summary: { all: 0, present: 0, late: 0, leave: 0, absent: 0, ...(payload.data.attendance.summary ?? {}) } as Record<string, number>,
    }
  }

  const myShifts = async (params: { from?: string, to?: string } = {}) => {
    const payload = await plainFetch(`/api/v1/me/shifts${pageQuery({ from: params.from, to: params.to })}`) as {
      data: { staff: AdminStaff, assignments: AdminShiftAssignment[] }
      meta?: { totals?: { assignments?: number, staff?: number, days?: number, workedMinutes?: number } }
    }
    return {
      staff: payload.data.staff,
      data: payload.data.assignments,
      totals: { assignments: 0, days: 0, workedMinutes: 0, ...(payload.meta?.totals ?? {}) },
    }
  }

  const myPayroll = async (period?: string) => {
    const payload = await plainFetch(`/api/v1/me/payroll${pageQuery({ period })}`) as {
      data: { staff: AdminStaff, payroll: { data: AdminPayroll[], counts?: Record<string, number>, totals?: { netPay?: number, workDays?: number } } }
    }
    return { staff: payload.data.staff, data: payload.data.payroll.data }
  }

  /**
   * One own payroll row, for the printable payslip. The row is addressed by id
   * only: the server checks it belongs to the signed-in staff member.
   */
  const myPayslip = async (id: string) => {
    const payload = await plainFetch(`/api/v1/me/payroll/${encodeURIComponent(id)}`) as {
      data: { staff: AdminStaff, payroll: AdminPayroll }
    }
    return { staff: payload.data.staff, payroll: payload.data.payroll }
  }

  const listShiftTemplates = async (includeInactive = false) => {
    const payload = await plainFetch(`/api/v1/admin/hr/shift-templates${pageQuery({
      includeInactive: includeInactive ? 'true' : undefined,
    })}`) as { data: AdminShiftTemplate[], meta?: { counts?: Record<string, number> } }
    return {
      data: payload.data,
      summary: { active: 0, inactive: 0, ...(payload.meta?.counts ?? {}) } as Record<string, number>,
    }
  }

  const createShiftTemplate = async (body: Record<string, unknown>, reason?: string) =>
    one<AdminShiftTemplate>(await write('/api/v1/admin/hr/shift-templates', 'POST', body, reason))

  const updateShiftTemplate = async (id: string, body: Record<string, unknown>, reason?: string) =>
    one<AdminShiftTemplate>(await write(`/api/v1/admin/hr/shift-templates/${id}`, 'PATCH', body, reason))

  const archiveShiftTemplate = async (id: string, reason?: string) =>
    one<AdminShiftTemplate>(await write(`/api/v1/admin/hr/shift-templates/${id}`, 'DELETE', {}, reason))

  const listShiftAssignments = async (params: { from?: string, to?: string, staffId?: string, templateId?: string } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/hr/shift-assignments${pageQuery({
      from: params.from,
      to: params.to,
      staffId: params.staffId,
      templateId: params.templateId,
    })}`) as { data: AdminShiftAssignment[], meta?: { totals?: Record<string, number> } }
    return {
      data: payload.data,
      totals: {
        assignments: payload.meta?.totals?.assignments ?? 0,
        staff: payload.meta?.totals?.staff ?? 0,
        days: payload.meta?.totals?.days ?? 0,
        workedMinutes: payload.meta?.totals?.workedMinutes ?? 0,
      },
    }
  }

  const assignShift = async (body: Record<string, unknown>, reason?: string) =>
    (await write('/api/v1/admin/hr/shift-assignments', 'POST', body, reason)) as unknown as {
      data: AdminShiftAssignment
      meta?: { created?: boolean }
    }

  const cancelShiftAssignment = async (id: string, reason?: string) =>
    one<{ id: string }>(await write(`/api/v1/admin/hr/shift-assignments/${id}`, 'DELETE', {}, reason))

  const supplierPriceHistory = async (params: {
    supplierId?: string
    itemId?: string
    variantId?: string
    from?: string
    to?: string
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/procurement/supplier-prices${pageQuery({
      supplierId: params.supplierId,
      itemId: params.itemId,
      variantId: params.variantId,
      from: params.from,
      to: params.to,
      limit: params.limit,
    })}`) as {
      data: {
        range: { from: string, to: string }
        data: SupplierItemPrice[]
        summary: { suppliers: number, items: number, observations: number }
      }
    }
    return payload.data
  }

  const checkSupplierPrice = async (params: {
    supplierId?: string
    itemId: string
    variantId?: string
    unitCost: number
    quantity?: number
    thresholdPercent?: number
  }) => {
    const payload = await plainFetch(`/api/v1/admin/procurement/supplier-prices/check${pageQuery({
      supplierId: params.supplierId,
      itemId: params.itemId,
      variantId: params.variantId,
      unitCost: params.unitCost,
      quantity: params.quantity,
      thresholdPercent: params.thresholdPercent,
    })}`) as {
      data: {
        supplierId: string | null
        itemId: string
        variantId: string | null
        proposedUnitCost: number
        quantity: number
        hasHistory: boolean
        lastUnitCost: number | null
        lastReceivedAt: string | null
        changePercent: number | null
        thresholdPercent: number
        needsReview: boolean
        reason: string
      }
    }
    return payload.data
  }

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
    listShipments,
    createShipment,
    updateShipment,
    deleteShipment,
    listOrderReturns,
    createOrderReturn,
    updateOrderReturn,
    deleteOrderReturn,
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
    listSerialNumbers,
    registerSerialNumbers,
    importSerialNumbers,
    markSerialSold,
    markSerialReturned,
    scrapSerialNumber,
    moveSerialNumber,
    deleteSerialNumber,
    restoreSerialNumber,
    listPayments,
    createPayment,
    voidPayment,
    listOpenDocuments,
    listPayables,
    voidPayable,
    listSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    restoreSupplier,
    importSuppliers,
    listPurchaseOrders,
    createPurchaseOrder,
    updatePurchaseOrder,
    deletePurchaseOrder,
    restorePurchaseOrder,
    receivePurchaseOrder,
    listStaff,
    createStaff,
    updateStaff,
    deleteStaff,
    restoreStaff,
    listAttendances,
    upsertAttendance,
    deleteAttendance,
    listSalaryConfigs,
    setSalaryConfig,
    listPayrolls,
    calculatePayroll,
    approvePayroll,
    payPayroll,
    cancelPayroll,
    myAttendance,
    myShifts,
    myPayroll,
    myPayslip,
    listShiftTemplates,
    createShiftTemplate,
    updateShiftTemplate,
    archiveShiftTemplate,
    listShiftAssignments,
    assignShift,
    cancelShiftAssignment,
    supplierPriceHistory,
    checkSupplierPrice,
    financeSummary,
    financeAging,
    financeLedger,
    errorCode,
  }
}
