/**
 * CMS quotations client. Quotations already have a server service and admin
 * routes; this file only speaks HTTP to them and shapes the record the list and
 * the print sheet render.
 */

export interface AdminQuotationItem {
  itemId: string | null
  variantId: string | null
  itemName: string
  sku: string
  attributes: Record<string, string>
  price: number
  quantity: number
  thumbnail: string | null
}

export interface AdminQuotation {
  id: string
  siteId: string
  code: string
  customerId: string | null
  userId: string
  channel: string
  status: string
  currency: string
  items: AdminQuotationItem[]
  itemsPrice: number
  shippingFee: number
  discountAmount: number
  totalAmount: number
  shippingAddress: {
    fullName: string
    phone: string
    street: string
    ward: string
    district: string
    city: string
    country: string
  }
  adminNote: string
  customerNote: string
  internalNote: string
  assignedStaffId: string | null
  warehouseId: string | null
  validUntil: number | null
  convertedOrderId: string | null
  estimatedCost: number
  estimatedProfit: number
  version: number
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

interface ListResponse<T> {
  success: boolean
  data: T[]
  meta?: { nextCursor?: string, hasMore?: boolean, counts?: Record<string, number> }
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

export const useQuotationsAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const listQuotations = async (params: {
    q?: string
    status?: string
    customer?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/quotations${pageQuery({
      q: params.q,
      status: params.status,
      customer: params.customer,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminQuotation>
    return {
      data: payload.data,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
      counts: payload.meta?.counts ?? {},
    }
  }

  const getQuotation = async (id: string) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/quotations/${id}`) as { data: AdminQuotation }
    return payload.data
  }

  const updateQuotation = async (id: string, body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/quotations/${id}`, {
      method: 'PATCH',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminQuotation }
    return payload.data
  }

  return { listQuotations, getQuotation, updateQuotation }
}
