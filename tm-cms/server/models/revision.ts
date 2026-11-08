import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import type { AuditAction, AuditActor } from './audit'
import { AUDIT_ACTIONS } from './audit'
import type { ContentDraft, ContentStatus } from './content'
import { CONTENT_STATUSES } from './content'

/**
 * Immutable snapshots of the editable fields of one content revision. The record
 * itself stays small (one document per record); history lives here so a reviewer
 * can compare revisions and an editor can restore an earlier state.
 *
 * A snapshot never includes status, `publishedAt` or `deletedAt`: restoring an
 * old revision restores its wording, not its publication state. Going public is
 * always an explicit transition recorded in the audit trail.
 */

export const CONTENT_REVISION_ACTIONS = [...AUDIT_ACTIONS, 'revert'] as const
export type ContentRevisionAction = AuditAction | 'revert'

export type ContentRevisionSnapshot = Pick<
  ContentDraft,
  'type' | 'locales' | 'categories' | 'tags' | 'media' | 'attributes' | 'publishAt' | 'unpublishAt'
>

export interface ContentRevisionDocument {
  siteId: string
  contentId: string
  revision: number
  status: ContentStatus
  action: ContentRevisionAction
  /** Top-level fields that differed from the previous snapshot. */
  changedFields: string[]
  snapshot: ContentRevisionSnapshot
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

const LocaleSchema = new Schema(
  {
    locale: { type: String, required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    excerpt: { type: String, default: '' },
    body: { type: String, default: '' },
    format: { type: String, default: 'markdown' },
    seo: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: '' },
    },
  },
  { _id: false },
)

const SnapshotSchema = new Schema(
  {
    type: { type: String, required: true },
    locales: { type: [LocaleSchema], required: true },
    categories: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    media: { type: [String], default: [] },
    attributes: { type: Schema.Types.Mixed, default: {} },
    publishAt: { type: Date, default: null },
    unpublishAt: { type: Date, default: null },
  },
  { _id: false },
)

export const contentRevisionSchema = new Schema<ContentRevisionDocument>(
  {
    siteId: { type: String, required: true },
    contentId: { type: String, required: true },
    revision: { type: Number, required: true },
    status: { type: String, enum: CONTENT_STATUSES, required: true },
    action: { type: String, enum: CONTENT_REVISION_ACTIONS, required: true },
    changedFields: { type: [String], default: [] },
    snapshot: { type: SnapshotSchema, required: true },
    actor: { type: ActorSchema, required: true },
    requestId: { type: String, default: null },
  },
  {
    collection: 'content_revisions',
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    minimize: false,
  },
)

// One snapshot per revision: a retried command can never fork the history, and
// the unique index (not a read-then-write check) decides who captured it first.
contentRevisionSchema.index(
  { siteId: 1, contentId: 1, revision: 1 },
  { unique: true, name: 'revision_site_content_revision' },
)

/** Model factory: one registration per connection, never a global model. */
export function contentRevisionModel(connection: Connection): Model<ContentRevisionDocument> {
  const registered = connection.models.ContentRevision as Model<ContentRevisionDocument> | undefined
  if (registered) return registered
  return connection.model<ContentRevisionDocument>('ContentRevision', contentRevisionSchema, 'content_revisions')
}

export async function syncContentRevisionIndexes(connection: Connection): Promise<void> {
  await contentRevisionModel(connection).createIndexes()
}
