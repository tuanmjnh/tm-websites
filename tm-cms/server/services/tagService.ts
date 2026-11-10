import type { Model } from 'mongoose'
import type { AdminTag, AdminTagRenameRequest, AdminTagRenameResult } from '@tm/flow-contracts/tag-admin'
import { ADMIN_TAG_MAX_LENGTH } from '@tm/flow-contracts/tag-admin'
import type { ContentDocument } from '../models/content'
import { recordContentAudit } from './contentAudit'
import { captureContentRevision, revisionSnapshotOf } from './contentRevisions'
import type { ContentRecord, ContentWriteMeta } from './contentService'

/**
 * Tag commands. Tags live as strings on the content records, so a rename is a
 * loop over the records that carry the tag: each row keeps its own optimistic
 * lock, its audit entry and its revision snapshot, and a row an editor changed
 * at the same time is reported instead of silently overwritten.
 */

export class TagServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'TagServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

function normalizeTag(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TagServiceError(422, 'TAG_INVALID', `${field} is not a tag name`)
  }
  const tag = value.trim().replace(/\s+/g, ' ')
  if (!tag) {
    throw new TagServiceError(422, 'TAG_REQUIRED', 'A tag name is required')
  }
  if (tag.length > ADMIN_TAG_MAX_LENGTH) {
    throw new TagServiceError(422, 'TAG_TOO_LONG', `A tag cannot be longer than ${ADMIN_TAG_MAX_LENGTH} characters`)
  }
  return tag
}

/**
 * Every tag in use with its record count. Deleted records are counted too: a tag
 * that only survives on deleted content still has to be visible to be cleaned up.
 */
export async function listTags(
  model: Model<ContentDocument>,
  siteId: string,
): Promise<AdminTag[]> {
  const rows = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 500 },
  ])

  return rows
    .filter(row => typeof row._id === 'string' && row._id.trim().length > 0)
    .map(row => ({ name: row._id, count: row.count }))
}

/**
 * Replaces one tag with another on every record that carries it. `to: null`
 * detaches the tag; renaming onto an existing tag merges the two. Position in
 * the list is preserved and a duplicate produced by a merge is dropped.
 */
export async function renameTag(
  model: Model<ContentDocument>,
  siteId: string,
  input: AdminTagRenameRequest,
  meta?: ContentWriteMeta,
): Promise<AdminTagRenameResult> {
  const from = normalizeTag(input.from, 'from')
  const to = input.to === null || input.to === undefined ? null : normalizeTag(input.to, 'to')

  if (to === from) {
    throw new TagServiceError(422, 'TAG_RENAME_SAME', 'The new name is the same as the current one')
  }

  const affected = await model
    .find({ siteId, tags: from })
    .lean<ContentRecord[]>()

  if (affected.length === 0) {
    throw new TagServiceError(404, 'TAG_NOT_FOUND', 'No content uses this tag')
  }

  let updated = 0
  let skipped = 0

  for (const record of affected) {
    const tags = replaceTag(record.tags ?? [], from, to)

    const next = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision: record.revision },
      { $set: { tags }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    ).lean<ContentRecord | null>()

    if (!next) {
      // An editor saved this record between the read and the write. Their save
      // wins; the caller sees the row count and can run the command again.
      skipped += 1
      continue
    }

    updated += 1

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceId: String(next._id),
      resourceKey: next.key,
      action: 'update',
      revision: next.revision,
      fromStatus: record.status,
      toStatus: next.status,
      changedFields: ['tags'],
    })

    await captureContentRevision(meta?.revision, {
      siteId,
      contentId: String(next._id),
      revision: next.revision,
      status: next.status,
      action: 'update',
      changedFields: ['tags'],
      snapshot: revisionSnapshotOf(next),
    })
  }

  return { from, to, updated, skipped }
}

export function replaceTag(tags: string[], from: string, to: string | null): string[] {
  const out: string[] = []
  for (const tag of tags) {
    const next = tag === from ? to : tag
    if (!next) continue
    if (!out.includes(next)) out.push(next)
  }
  return out
}
