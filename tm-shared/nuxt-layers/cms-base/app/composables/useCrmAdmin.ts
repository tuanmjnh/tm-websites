import type {
  AdminCustomer,
  AdminCustomerDraft,
  AdminCustomerList,
  AdminCustomerSegment,
  AdminCustomerUpdate,
} from '@tm/flow-contracts/customer-admin'
import type { ImportOutcome } from '../utils/import-rows'

/**
 * CMS CRM client. A customer profile links to a Hub subject; nothing here sends
 * a password, role or session — identity stays in Hub.
 */

interface ApiErrorBody {
  data?: { error?: { code?: string }, data?: { error?: { code?: string } } }
  error?: { code?: string }
}

interface CustomerListResponse {
  success: boolean
  data: AdminCustomer[]
  meta?: {
    nextCursor?: string
    hasMore?: boolean
    counts?: Record<string, number>
  }
}

const emptyCounts = { all: 0, active: 0, inactive: 0, deleted: 0 }

export const useCrmAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const listCustomers = async (params: {
    q?: string
    segment?: string
    includeDeleted?: boolean
    cursor?: string | null
    limit?: number
  } = {}): Promise<AdminCustomerList> => {
    const query = new URLSearchParams()
    if (params.q) query.set('q', params.q)
    if (params.segment) query.set('segment', params.segment)
    if (params.includeDeleted) query.set('includeDeleted', 'true')
    if (params.cursor) query.set('cursor', params.cursor)
    if (params.limit) query.set('limit', String(params.limit))

    const suffix = query.toString()
    const payload = await plainFetch(`/api/v1/admin/crm/customers${suffix ? `?${suffix}` : ''}`) as CustomerListResponse

    return {
      data: payload.data,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
      counts: { ...emptyCounts, ...(payload.meta?.counts ?? {}) } as AdminCustomerList['counts'],
    }
  }

  const getCustomer = async (id: string): Promise<AdminCustomer> => {
    const payload = await plainFetch(`/api/v1/admin/crm/customers/${id}`) as { success: boolean, data: AdminCustomer }
    return payload.data
  }

  const createCustomer = async (input: AdminCustomerDraft, reason?: string): Promise<AdminCustomer> => {
    const payload = await plainFetch('/api/v1/admin/crm/customers', {
      method: 'POST',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomer }
    return payload.data
  }

  const updateCustomer = async (id: string, input: AdminCustomerUpdate, reason?: string): Promise<AdminCustomer> => {
    const payload = await plainFetch(`/api/v1/admin/crm/customers/${id}`, {
      method: 'PATCH',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomer }
    return payload.data
  }

  const deleteCustomer = async (id: string, revision: number, reason?: string): Promise<void> => {
    await plainFetch(`/api/v1/admin/crm/customers/${id}?revision=${revision}`, {
      method: 'DELETE',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    })
  }

  const restoreCustomer = async (id: string, revision: number, reason?: string): Promise<AdminCustomer> => {
    const payload = await plainFetch(`/api/v1/admin/crm/customers/${id}/restore?revision=${revision}`, {
      method: 'POST',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomer }
    return payload.data
  }

  const listSegments = async (includeDeleted = false): Promise<AdminCustomerSegment[]> => {
    const payload = await plainFetch(`/api/v1/admin/crm/segments${includeDeleted ? '?includeDeleted=true' : ''}`) as {
      success: boolean
      data: AdminCustomerSegment[]
    }
    return payload.data
  }

  const importCustomers = async (rows: Record<string, unknown>[], reason?: string): Promise<ImportOutcome> => {
    const payload = await plainFetch('/api/v1/admin/crm/customers/import', {
      method: 'POST',
      body: { rows },
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as {
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

  const createSegment = async (input: Record<string, unknown>, reason?: string): Promise<AdminCustomerSegment> => {
    const payload = await plainFetch('/api/v1/admin/crm/segments', {
      method: 'POST',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomerSegment }
    return payload.data
  }

  const updateSegment = async (id: string, input: Record<string, unknown>, reason?: string): Promise<AdminCustomerSegment> => {
    const payload = await plainFetch(`/api/v1/admin/crm/segments/${id}`, {
      method: 'PATCH',
      body: input,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomerSegment }
    return payload.data
  }

  const deleteSegment = async (id: string, revision: number, reason?: string): Promise<void> => {
    await plainFetch(`/api/v1/admin/crm/segments/${id}?revision=${revision}`, {
      method: 'DELETE',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    })
  }

  const restoreSegment = async (id: string, revision: number, reason?: string): Promise<AdminCustomerSegment> => {
    const payload = await plainFetch(`/api/v1/admin/crm/segments/${id}/restore?revision=${revision}`, {
      method: 'POST',
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { success: boolean, data: AdminCustomerSegment }
    return payload.data
  }

  const errorCode = (error: unknown): string | null => {
    const body = (error as ApiErrorBody)?.data
    return body?.data?.error?.code || body?.error?.code || null
  }

  return {
    listCustomers,
    getCustomer,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    restoreCustomer,
    importCustomers,
    listSegments,
    createSegment,
    updateSegment,
    deleteSegment,
    restoreSegment,
    errorCode,
  }
}
