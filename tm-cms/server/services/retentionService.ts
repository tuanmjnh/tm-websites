import type { Model } from 'mongoose'
import type { AuditEntryDocument } from '../models/audit'
import type { ContentRevisionDocument } from '../models/revision'

/**
 * Retention for the two collections that grow without a bound: content revision
 * snapshots and the business audit trail.
 *
 * This is an operator tool, not a request path: nothing here runs on its own,
 * `dryRun` is the default, and every number is passed in. The defaults in the
 * CLI are conservative placeholders until the owner sets a real policy; the
 * service simply executes what it is told, inside one site.
 */

export interface RetentionOptions {
  /** Revision snapshots kept per content record, newest first. */
  keepRevisions: number
  /** Audit entries older than this many days are eligible for removal. */
  auditDays: number
  dryRun: boolean
}

export interface RetentionReport {
  siteId: string
  dryRun: boolean
  keepRevisions: number
  auditDays: number
  revisions: { deleted: number, kept: number, contents: number }
  audit: { deleted: number, cutoff: string }
}

export const RETENTION_LIMITS = {
  minKeepRevisions: 1,
  maxKeepRevisions: 500,
  minAuditDays: 1,
  maxAuditDays: 3650,
} as const

export class RetentionError extends Error {
  statusCode = 422
  code = 'RETENTION_OPTIONS_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'RetentionError'
  }
}

export function normalizeRetentionOptions(input: Partial<RetentionOptions>): RetentionOptions {
  const keepRevisions = input.keepRevisions ?? 50
  const auditDays = input.auditDays ?? 365

  if (!Number.isInteger(keepRevisions) || keepRevisions < RETENTION_LIMITS.minKeepRevisions || keepRevisions > RETENTION_LIMITS.maxKeepRevisions) {
    throw new RetentionError(`keepRevisions must be an integer between ${RETENTION_LIMITS.minKeepRevisions} and ${RETENTION_LIMITS.maxKeepRevisions}`)
  }
  if (!Number.isInteger(auditDays) || auditDays < RETENTION_LIMITS.minAuditDays || auditDays > RETENTION_LIMITS.maxAuditDays) {
    throw new RetentionError(`auditDays must be an integer between ${RETENTION_LIMITS.minAuditDays} and ${RETENTION_LIMITS.maxAuditDays}`)
  }

  return { keepRevisions, auditDays, dryRun: input.dryRun ?? true }
}

interface RevisionGroup {
  _id: string
  max: number
  count: number
}

export async function pruneRetention(
  models: { Audit: Model<AuditEntryDocument>, Revision: Model<ContentRevisionDocument> },
  siteId: string,
  input: Partial<RetentionOptions>,
  now = new Date(),
): Promise<RetentionReport> {
  const options = normalizeRetentionOptions(input)
  const cutoff = new Date(now.getTime() - options.auditDays * 24 * 60 * 60 * 1000)

  const groups = await models.Revision.aggregate<RevisionGroup>([
    { $match: { siteId } },
    { $group: { _id: '$contentId', max: { $max: '$revision' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: options.keepRevisions } } },
  ])

  let revisionsDeleted = 0
  let revisionsKept = 0

  for (const group of groups) {
    const filter = {
      siteId,
      contentId: group._id,
      revision: { $lte: group.max - options.keepRevisions },
    }

    if (options.dryRun) {
      revisionsDeleted += await models.Revision.countDocuments(filter)
    } else {
      const removed = await models.Revision.deleteMany(filter)
      revisionsDeleted += removed.deletedCount ?? 0
    }
    revisionsKept += Math.min(group.count, options.keepRevisions)
  }

  const auditFilter = { siteId, createdAt: { $lt: cutoff } }
  const auditDeleted = options.dryRun
    ? await models.Audit.countDocuments(auditFilter)
    : (await models.Audit.deleteMany(auditFilter)).deletedCount ?? 0

  return {
    siteId,
    dryRun: options.dryRun,
    keepRevisions: options.keepRevisions,
    auditDays: options.auditDays,
    revisions: { deleted: revisionsDeleted, kept: revisionsKept, contents: groups.length },
    audit: { deleted: auditDeleted, cutoff: cutoff.toISOString() },
  }
}
