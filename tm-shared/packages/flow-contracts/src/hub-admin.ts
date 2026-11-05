import { z } from 'zod'

export const HubUserSummarySchema = z.object({
  id: z.string().min(1),
  email: z.string().nullable(),
  username: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  role: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string(),
  roleAssignedAt: z.string().optional(),
  platform: z.string().optional(),
})
export type HubUserSummary = z.infer<typeof HubUserSummarySchema>

export const HubRolePermissionSchema = z.object({
  module: z.string().min(1),
  actions: z.array(z.string()),
})
export type HubRolePermission = z.infer<typeof HubRolePermissionSchema>

export const HubRoleSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  permissions: z.array(HubRolePermissionSchema).default([]),
  allowedRoutes: z.array(z.string()).default([]),
  isSystem: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type HubRole = z.infer<typeof HubRoleSchema>

export const HubAppDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  secretKey: z.string().optional(),
  allowedOrigins: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  isPinned: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  sort: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  configs: z.record(z.string(), z.string()).default({}),
})
export type HubAppDetail = z.infer<typeof HubAppDetailSchema>

export const HubAppConfigMetaSchema = z.object({
  key: z.string().min(1),
  category: z.string().nullable().optional(),
  isSecret: z.boolean().default(false),
  isPublic: z.boolean().default(false),
  description: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})
export type HubAppConfigMeta = z.infer<typeof HubAppConfigMetaSchema>

export const HubAuditActorSchema = z.object({
  _id: z.string().optional(),
  name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
})
export type HubAuditActor = z.infer<typeof HubAuditActorSchema>

export const HubAuditLogSchema = z.object({
  appId: z.string().optional(),
  docId: z.string().optional(),
  modelName: z.string().default(''),
  action: z.string().default(''),
  by: HubAuditActorSchema.optional(),
  source: z.string().optional(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  at: z.number(),
  changedFields: z.array(z.string()).optional(),
  summary: z.string().nullable().optional(),
})
export type HubAuditLog = z.infer<typeof HubAuditLogSchema>

export const HubContentEntrySchema = z.object({
  _id: z.string().min(1),
  appId: z.string().min(1),
  key: z.string().min(1),
  title: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  contentType: z.string().default('json'),
  isPublished: z.boolean().default(false),
  isDeleted: z.boolean().default(false),
  deletedAt: z.string().nullable().optional(),
  version: z.number().optional(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  data: z.unknown().optional(),
})
export type HubContentEntry = z.infer<typeof HubContentEntrySchema>

export const HUB_CONTENT_TYPES = ['json', 'markdown', 'html', 'text'] as const
export type HubContentType = typeof HUB_CONTENT_TYPES[number]

export const HubContentDraftSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  contentType: z.enum(HUB_CONTENT_TYPES).default('json'),
  data: z.string(),
  isPublished: z.boolean().default(false),
})
export type HubContentDraft = z.infer<typeof HubContentDraftSchema>

export interface HubContentPayload {
  key: string
  title: string
  description?: string
  category?: string
  contentType: HubContentType
  data: unknown
  isPublished: boolean
}

export type HubContentFieldError = 'key' | 'title' | 'description' | 'category' | 'data'
export type HubContentPayloadResult =
  | { ok: true, payload: HubContentPayload }
  | { ok: false, field: HubContentFieldError }

const HUB_CONTENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function isValidContentKey(key: string): boolean {
  return Boolean(key)
    && key.length <= 200
    && HUB_CONTENT_KEY_PATTERN.test(key)
    && !key.includes('..')
    && !key.endsWith('/')
}

/**
 * Validates a CMS content form and turns it into the Hub upsert payload.
 * `data` is parsed as JSON for `contentType=json`; other types keep raw text.
 */
export function buildHubContentPayload(input: HubContentDraft): HubContentPayloadResult {
  const key = input.key.trim()
  if (!isValidContentKey(key)) return { ok: false, field: 'key' }

  const title = input.title.trim()
  if (!title || title.length > 300) return { ok: false, field: 'title' }

  const description = input.description?.trim() || ''
  if (description.length > 2000) return { ok: false, field: 'description' }

  const category = input.category?.trim() || ''
  if (category.length > 100) return { ok: false, field: 'category' }

  const contentType = input.contentType
  const raw = input.data.trim()
  if (!raw) return { ok: false, field: 'data' }

  let data: unknown = raw
  if (contentType === 'json') {
    try {
      data = JSON.parse(raw)
    } catch {
      return { ok: false, field: 'data' }
    }
  }

  return {
    ok: true,
    payload: {
      key,
      title,
      description: description || undefined,
      category: category || undefined,
      contentType,
      data,
      isPublished: input.isPublished,
    },
  }
}

export const HubMediaFolderSchema = z.object({
  name: z.string().min(1),
  path: z.string().default(''),
})
export type HubMediaFolder = z.infer<typeof HubMediaFolderSchema>

export const HubMediaResourceSchema = z.object({
  public_id: z.string().min(1),
  filename: z.string().optional(),
  format: z.string().nullable().optional(),
  resource_type: z.string().default('image'),
  type: z.string().nullable().optional(),
  folder: z.string().nullable().optional(),
  bytes: z.number().default(0),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  secure_url: z.string().nullable().optional(),
})
export type HubMediaResource = z.infer<typeof HubMediaResourceSchema>

export const HubMediaFoldersPayloadSchema = z.object({
  success: z.boolean(),
  data: z.object({
    parent: z.string().nullable().optional(),
    folders: z.array(HubMediaFolderSchema).default([]),
  }).optional(),
  folders: z.array(HubMediaFolderSchema).default([]),
  nextCursor: z.string().nullable().optional(),
})
export type HubMediaFoldersPayload = z.infer<typeof HubMediaFoldersPayloadSchema>

export const HubMediaResourcesPayloadSchema = z.object({
  success: z.boolean(),
  resources: z.array(HubMediaResourceSchema).default([]),
  nextCursor: z.string().nullable().optional(),
})
export type HubMediaResourcesPayload = z.infer<typeof HubMediaResourcesPayloadSchema>

export const HubNotificationSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  userId: z.string().optional(),
  title: z.string().default(''),
  body: z.string().default(''),
  icon: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  isRead: z.boolean().default(false),
  createdAt: z.string(),
})
export type HubNotification = z.infer<typeof HubNotificationSchema>

export const HubMailTemplateSchema = z.object({
  id: z.string().min(1),
  appId: z.string().optional(),
  key: z.string().min(1),
  name: z.string().default(''),
  subject: z.string().default(''),
  preheader: z.string().nullable().optional(),
  locale: z.string().default('en'),
  status: z.string().default('draft'),
  version: z.number().default(1),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
})
export type HubMailTemplate = z.infer<typeof HubMailTemplateSchema>

export const HubMailTemplateListPayloadSchema = z.object({
  success: z.boolean(),
  data: z.array(HubMailTemplateSchema).default([]),
  pagination: z.object({
    page: z.number().default(1),
    limit: z.number().default(20),
    total: z.number().default(0),
  }).optional(),
})
export type HubMailTemplateListPayload = z.infer<typeof HubMailTemplateListPayloadSchema>

export const HubMailAnalyticsSummarySchema = z.object({
  totalSent: z.number().default(0),
  totalDelivered: z.number().default(0),
  totalBounced: z.number().default(0),
  totalOpened: z.number().default(0),
  totalClicked: z.number().default(0),
  totalUnsubscribed: z.number().default(0),
  totalComplained: z.number().default(0),
  deliveryRate: z.number().default(0),
  openRate: z.number().default(0),
  clickRate: z.number().default(0),
  bounceRate: z.number().default(0),
  unsubscribeRate: z.number().default(0),
  complaintRate: z.number().default(0),
  period: z.object({ from: z.string(), to: z.string() }).optional(),
})
export type HubMailAnalyticsSummary = z.infer<typeof HubMailAnalyticsSummarySchema>

export const HubMailQueuePayloadSchema = z.object({
  success: z.boolean(),
  data: z.object({
    enabled: z.boolean().default(false),
    stats: z.record(z.string(), z.unknown()).nullable().optional(),
    jobs: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
})
export type HubMailQueuePayload = z.infer<typeof HubMailQueuePayloadSchema>

export const HubRouteSchema = z.object({
  id: z.string().min(1),
  appId: z.string().optional(),
  path: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sort: z.number().default(0),
  isVisible: z.boolean().default(true),
  parentId: z.string().nullable().optional(),
  isDeleted: z.boolean().default(false),
  requiredPermission: z.string().nullable().optional(),
})
export type HubRoute = z.infer<typeof HubRouteSchema>

export const HubRouteListPayloadSchema = z.object({
  success: z.boolean(),
  data: z.object({
    routes: z.array(HubRouteSchema).default([]),
    tree: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
  nextCursor: z.string().nullable().optional(),
})
export type HubRouteListPayload = z.infer<typeof HubRouteListPayloadSchema>

export const HubConnectionSchema = z.object({
  id: z.string().optional(),
  provider: z.string().optional(),
  name: z.string().default('default'),
  mode: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  hasSecrets: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  isShared: z.boolean().default(false),
  environment: z.string().nullable().optional(),
  lastTestAt: z.string().nullable().optional(),
  lastTestOk: z.boolean().nullable().optional(),
  connectedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})
export type HubConnection = z.infer<typeof HubConnectionSchema>

export const HubConnectionProviderSchema = z.object({
  key: z.string().min(1),
  name: z.string().default(''),
  description: z.string().default(''),
  icon: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  quick: z.boolean().optional(),
  connection: HubConnectionSchema.nullable().optional(),
})
export type HubConnectionProvider = z.infer<typeof HubConnectionProviderSchema>

export const HubConnectionsPayloadSchema = z.object({
  success: z.boolean(),
  data: z.array(HubConnectionProviderSchema).default([]),
})
export type HubConnectionsPayload = z.infer<typeof HubConnectionsPayloadSchema>

export const HubListPayloadSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  success: z.boolean(),
  data: z.array(item),
  nextCursor: z.string().nullable().optional(),
})

export const HubConfigListPayloadSchema = z.object({
  success: z.boolean(),
  data: z.record(z.string(), z.unknown()).default({}),
  meta: z.array(HubAppConfigMetaSchema).default([]),
  nextCursor: z.string().nullable().optional(),
})
export type HubConfigListPayload = z.infer<typeof HubConfigListPayloadSchema>
