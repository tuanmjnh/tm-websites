export interface AdminKeyword {
  id: string
  siteId: string
  slug: string
  title: string
  color: string
  count: number
  scope: string
  isActive: boolean
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

export const useKeywordsAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (params: { scope?: string, includeDeleted?: boolean, cursor?: string | null, limit?: number } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/keywords${pageQuery({
      scope: params.scope,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminKeyword>
    return {
      data: payload.data,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
      counts: payload.meta?.counts ?? {},
    }
  }

  const get = async (id: string) => {
    const payload = await plainFetch(`/api/v1/admin/keywords/${id}`) as { data: AdminKeyword }
    return payload.data
  }

  const create = async (body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch('/api/v1/admin/keywords', {
      method: 'POST',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminKeyword }
    return payload.data
  }

  const update = async (id: string, body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/keywords/${id}`, {
      method: 'PATCH',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminKeyword }
    return payload.data
  }

  const remove = async (id: string, revision: number, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/keywords/${id}`, {
      method: 'DELETE',
      body: { revision },
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminKeyword }
    return payload.data
  }

  const restore = async (id: string, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/keywords/${id}/restore`, {
      method: 'POST',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminKeyword }
    return payload.data
  }

  return { list, get, create, update, remove, restore }
}