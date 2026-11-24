export interface AdminShippingCarrier {
  id: string
  siteId: string
  code: string
  name: string
  trackingUrl: string
  phone: string
  note: string
  isActive: boolean
  sort: number
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

export const useShippingCarriersAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (params: { includeDeleted?: boolean, cursor?: string | null, limit?: number } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/shipping-carriers${pageQuery({
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminShippingCarrier>
    return {
      data: payload.data,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
      counts: payload.meta?.counts ?? {},
    }
  }

  const get = async (id: string) => {
    const payload = await plainFetch(`/api/v1/admin/shipping-carriers/${id}`) as { data: AdminShippingCarrier }
    return payload.data
  }

  const create = async (body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch('/api/v1/admin/shipping-carriers', {
      method: 'POST',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminShippingCarrier }
    return payload.data
  }

  const update = async (id: string, body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/shipping-carriers/${id}`, {
      method: 'PATCH',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminShippingCarrier }
    return payload.data
  }

  const remove = async (id: string, revision: number, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/shipping-carriers/${id}`, {
      method: 'DELETE',
      body: { revision },
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminShippingCarrier }
    return payload.data
  }

  const restore = async (id: string, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/shipping-carriers/${id}/restore`, {
      method: 'POST',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminShippingCarrier }
    return payload.data
  }

  return { list, get, create, update, remove, restore }
}