export interface AdminDocumentTemplate {
  id: string
  siteId: string
  name: string
  code: string
  type: string
  isDefault: boolean
  primaryColor: string
  showLogo: boolean
  title: string
  subtitle: string
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  companyTaxCode: string
  companyWebsite: string
  showSku: boolean
  showThumbnail: boolean
  showUom: boolean
  showUnitPrice: boolean
  showDiscount: boolean
  showTotalInWords: boolean
  showBankAccounts: boolean
  terms: string
  notes: string
  showSignatures: boolean
  senderTitle: string
  receiverTitle: string
  accountantTitle: string
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

export const useDocumentTemplatesAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const list = async (params: { type?: string, includeDeleted?: boolean, cursor?: string | null, limit?: number } = {}) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/document-templates${pageQuery({
      type: params.type,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`) as ListResponse<AdminDocumentTemplate>
    return {
      data: payload.data,
      nextCursor: payload.meta?.nextCursor ?? null,
      hasMore: payload.meta?.hasMore === true,
      counts: payload.meta?.counts ?? {},
    }
  }

  const get = async (id: string) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/document-templates/${id}`) as { data: AdminDocumentTemplate }
    return payload.data
  }

  const getDefault = async (type = 'quotation') => {
    const payload = await plainFetch(`/api/v1/admin/commerce/document-templates/default${pageQuery({ type })}`) as { data: AdminDocumentTemplate | null }
    return payload.data ?? null
  }

  const create = async (body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch('/api/v1/admin/commerce/document-templates', {
      method: 'POST',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminDocumentTemplate }
    return payload.data
  }

  const update = async (id: string, body: Record<string, unknown>, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/document-templates/${id}`, {
      method: 'PATCH',
      body,
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: AdminDocumentTemplate }
    return payload.data
  }

  const remove = async (id: string, revision: number, reason?: string) => {
    const payload = await plainFetch(`/api/v1/admin/commerce/document-templates/${id}`, {
      method: 'DELETE',
      body: { revision },
      headers: reason ? { 'x-audit-reason': reason } : undefined,
    }) as { data: { id: string, code: string } }
    return payload.data
  }

  return { list, get, getDefault, create, update, remove }
}