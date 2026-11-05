import type {
  HubAppDetail,
  HubAuditLog,
  HubConfigListPayload,
  HubContentEntry,
  HubContentPayload,
  HubConnectionsPayload,
  HubMailAnalyticsSummary,
  HubMailQueuePayload,
  HubMailTemplateListPayload,
  HubMediaFoldersPayload,
  HubMediaResourcesPayload,
  HubNotification,
  HubRole,
  HubRouteListPayload,
  HubUserSummary,
} from '@tm/flow-contracts'
import { getErrorStatus, getHubErrorCode } from '@tm/flow-utils/hub'

interface HubListResult<T> {
  success: boolean
  data: T[]
  nextCursor?: string | null
}

interface HubDetailResult<T> {
  success: boolean
  data: T
}

export const useHubAdmin = () => {
  const { t } = useI18n()
  const { hubFetch, appId, contentAppId } = useHub()

  const appPath = (suffix = '') => `api/v1/apps/${encodeURIComponent(appId)}${suffix}`

  const fetchAppDetail = async () => {
    const payload = await hubFetch<HubDetailResult<HubAppDetail>>(appPath())
    return payload.data
  }

  const fetchUsers = async (options: { limit?: number, cursor?: string, q?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    if (options.q) query.q = options.q
    return hubFetch<HubListResult<HubUserSummary>>(appPath('/users'), { query })
  }

  const fetchRoles = async (options: { limit?: number, cursor?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubListResult<HubRole>>(appPath('/roles'), { query })
  }

  const fetchAuditLogs = async (options: { limit?: number, cursor?: number } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubListResult<HubAuditLog>>(appPath('/audit-logs'), { query })
  }

  const fetchConfigs = async (options: { limit?: number, cursor?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubConfigListPayload>(appPath('/configs'), { query })
  }

  const fetchContent = async (options: {
    status?: 'all' | 'published' | 'hidden' | 'deleted'
    category?: string
    contentType?: string
    search?: string
    includeUnpublished?: boolean
    includeDeleted?: boolean
  } = {}) => {
    const query: Record<string, unknown> = { appId: contentAppId }
    if (options.status) query.status = options.status
    if (options.category) query.category = options.category
    if (options.contentType) query.contentType = options.contentType
    if (options.search) query.search = options.search
    if (options.includeUnpublished) query.includeUnpublished = true
    if (options.includeDeleted) query.includeDeleted = true
    return hubFetch<HubListResult<HubContentEntry>>('api/v1/content', { query })
  }

  /**
   * Hub upserts by `appId + key`, so create and edit share one call.
   * Keys are immutable in the CMS (changing one would create a new record).
   */
  const saveContent = async (payload: HubContentPayload) => {
    return hubFetch<HubDetailResult<HubContentEntry>>('api/v1/content', {
      method: 'POST',
      body: { ...payload, appId: contentAppId },
    })
  }

  const patchContent = async (id: string, body: Record<string, unknown>) => {
    return hubFetch<HubDetailResult<HubContentEntry>>(`api/v1/content/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    })
  }

  const publishContent = (id: string) => patchContent(id, { isPublished: true })
  const unpublishContent = (id: string) => patchContent(id, { isPublished: false })
  const restoreContent = (id: string) => patchContent(id, { action: 'restore' })

  const deleteContent = async (id: string) => {
    return hubFetch<{ success: boolean }>(`api/v1/content/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  const fetchMediaFolders = async (folder?: string) => {
    const query: Record<string, unknown> = {}
    if (folder) query.folder = folder
    return hubFetch<HubMediaFoldersPayload>(appPath('/media/folders'), { query })
  }

  const fetchMediaResources = async (options: { folder?: string, limit?: number, cursor?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.folder) query.folder = options.folder
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubMediaResourcesPayload>(appPath('/media/resources'), { query })
  }

  const fetchNotifications = async (options: { limit?: number, cursor?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubListResult<HubNotification>>(appPath('/notifications'), { query })
  }

  const markNotificationRead = async (notificationId: string) => {
    return hubFetch<{ success: boolean }>(appPath(`/notifications/${encodeURIComponent(notificationId)}/read`), { method: 'POST' })
  }

  const markAllNotificationsRead = async () => {
    return hubFetch<{ success: boolean }>(appPath('/notifications/read-all'), { method: 'POST' })
  }

  const sendNotification = async (payload: { title: string, body: string, icon?: string, url?: string, userId?: string }) => {
    return hubFetch<{ success: boolean }>(appPath('/notifications/send'), { method: 'POST', body: payload })
  }

  const fetchMailTemplates = async (options: { status?: string, locale?: string, key?: string, page?: number, limit?: number } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.status) query.status = options.status
    if (options.locale) query.locale = options.locale
    if (options.key) query.key = options.key
    if (options.page) query.page = options.page
    if (options.limit) query.limit = options.limit
    return hubFetch<HubMailTemplateListPayload>(appPath('/mail/templates'), { query })
  }

  const fetchMailAnalyticsSummary = async (options: { from?: string, to?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.from) query.from = options.from
    if (options.to) query.to = options.to
    const payload = await hubFetch<HubDetailResult<HubMailAnalyticsSummary>>(appPath('/mail/analytics/summary'), { query })
    return payload.data
  }

  const fetchMailQueue = async (options: { status?: string, start?: number, limit?: number } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.status) query.status = options.status
    if (options.start) query.start = options.start
    if (options.limit) query.limit = options.limit
    const payload = await hubFetch<HubMailQueuePayload>(appPath('/mail/queue'), { query })
    return payload.data
  }

  const fetchRoutes = async (options: { limit?: number, cursor?: string } = {}) => {
    const query: Record<string, unknown> = {}
    if (options.limit) query.limit = options.limit
    if (options.cursor) query.cursor = options.cursor
    return hubFetch<HubRouteListPayload>(appPath('/routes'), { query })
  }

  const fetchConnections = async () => {
    return hubFetch<HubConnectionsPayload>(appPath('/connections'))
  }

  const describeError = (error: unknown) => {
    const status = getErrorStatus(error)
    if (status === 401) return t('admin.errors.unauthorized')
    if (status === 403) return t('admin.errors.forbidden')
    if (status === 404) return t('admin.errors.notFound')
    if (!status) return t('admin.errors.network')
    return t('admin.errors.generic')
  }

  return {
    appId,
    appPath,
    fetchAppDetail,
    fetchUsers,
    fetchRoles,
    fetchAuditLogs,
    fetchConfigs,
    fetchContent,
    saveContent,
    patchContent,
    publishContent,
    unpublishContent,
    restoreContent,
    deleteContent,
    fetchMediaFolders,
    fetchMediaResources,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    sendNotification,
    fetchMailTemplates,
    fetchMailAnalyticsSummary,
    fetchMailQueue,
    fetchRoutes,
    fetchConnections,
    describeError,
    getHubErrorCode,
  }
}
