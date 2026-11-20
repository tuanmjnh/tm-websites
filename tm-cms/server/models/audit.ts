import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'

/**
 * Business audit trail. Hub owns IAM audit; every business mutation here records
 * its own actor, so a customer database can answer "who changed this record"
 * without calling Hub for a token or a session.
 */

export const AUDIT_RESOURCE_TYPES = [
  'content',
  'category',
  'media',
  'settings',
  'menu',
  'catalog_item',
  'catalog_category',
  'redirect',
  'customer',
  'customer_segment',
    'order',
  'order_return',
  'quotation',
  'warehouse',
  'inventory',
  'inventory_transaction',
  'supplier',
  'purchase_order',
  'payment',
  'inventory_transfer',
    'stocktake',
  'newsletter_subscription',
  'contact_message',
  'shipment',
  'serial_number',
  'notification',
    'notification_subscription',
  'push_subscription',
  'mail_template',
  'mail_delivery',
  'staff_profile',
  'attendance',
  'salary_config',
  'payroll',
  'shift_template',
  'shift_assignment',
] as const
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number]

/**
 * Why the operator made the change. Free text supplied by the client (the CMS
 * sends it in `x-audit-reason`), trimmed and capped so one paste cannot fill a
 * document; it is the only audit field that carries human intent.
 */
export const AUDIT_REASON_MAX = 500

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'publish',
  'schedule',
  'unpublish',
  'archive',
  'restore',
  'delete',
  // Restoring an earlier content snapshot: a content change, not a status event.
  'revert',
  // Money and approval transitions, so a payroll trail reads in its own terms.
  'approve',
  'pay',
  'cancel',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditActor {
  id: string
  name: string
  email: string
}

/**
 * The actor always comes from the verified context. `system` is only used by
 * command paths that have no request (tests, backfills); a request path must
 * pass the session user.
 */
export const SYSTEM_AUDIT_ACTOR: AuditActor = { id: 'system', name: '', email: '' }

export interface AuditEntryDocument {
  siteId: string
  resourceType: AuditResourceType
  resourceId: string
  resourceKey: string
  action: AuditAction
  /** Revision produced by the action, so the trail matches stored revisions. */
  revision: number
  fromStatus: string | null
  toStatus: string | null
  /** Top-level fields the action touched (`status`, `locales`, `tags`, ...). */
  changedFields: string[]
  /** Operator-supplied note; `null` when the mutation carried none. */
  reason: string | null
  actor: AuditActor
  requestId: string | null
  createdAt: Date
}

const ActorSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
  },
  { _id: false },
)

export const auditSchema = new Schema<AuditEntryDocument>(
  {
    siteId: { type: String, required: true },
    resourceType: { type: String, enum: AUDIT_RESOURCE_TYPES, required: true },
    resourceId: { type: String, required: true },
    resourceKey: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    revision: { type: Number, required: true },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    changedFields: { type: [String], default: [] },
    reason: { type: String, default: null, maxlength: AUDIT_REASON_MAX },
    actor: { type: ActorSchema, required: true },
    requestId: { type: String, default: null },
  },
  {
    collection: 'audit_logs',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
)

auditSchema.index(
  { siteId: 1, resourceType: 1, resourceId: 1, createdAt: -1 },
  { name: 'audit_site_resource_created' },
)
auditSchema.index({ siteId: 1, createdAt: -1 }, { name: 'audit_site_created' })

/** Model factory: one registration per connection, never a global model. */
export function auditModel(connection: Connection): Model<AuditEntryDocument> {
  const registered = connection.models.AuditEntry as Model<AuditEntryDocument> | undefined
  if (registered) return registered
  return connection.model<AuditEntryDocument>('AuditEntry', auditSchema, 'audit_logs')
}

export async function syncAuditIndexes(connection: Connection): Promise<void> {
  await auditModel(connection).createIndexes()
}
