import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type {
  AdminRedirect,
  AdminRedirectDraft,
  AdminRedirectList,
  AdminRedirectUpdate,
} from '@tm/flow-contracts/redirect-admin'
import {
  ADMIN_REDIRECT_PATH_MAX,
} from '@tm/flow-contracts/redirect-admin'
import type { AuditActor, AuditEntryDocument } from '../models/audit'
import { recordContentAudit } from './contentAudit'
import type { RedirectDocument } from '../models/redirect'

/**
 * Redirect map commands and queries.
 *
 * A row answers "this old path now lives there" with a 301/302, or "this path is
 * gone for good" with a 410 and no target, and the storefront reads it before
 * rendering a page. Paths are internal and site-relative: an entry can never
 * point a visitor at another host, so the map is not an open-redirect surface.
 * Every write records one audit entry.
 */

export class RedirectServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'RedirectServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export interface RedirectWriteMeta {
  audit: { model: Model<AuditEntryDocument>, actor?: AuditActor, requestId?: string | null }
}

export type RedirectRecord = RedirectDocument & { _id: Types.ObjectId }

/** Hop limit for the loop check; a longer chain is a map nobody can follow. */
const MAX_CHAIN = 5

const SEGMENT_PATTERN = /^[A-Za-z0-9\-._~%/]+$/

/**
 * Normalizes one path for storage and lookup.
 *
 * A stored path always starts with `/`, never ends with one (except the root),
 * and carries no query or fragment. Anything a browser would send as a different
 * URL — spaces, uppercase scheme tricks, `?`, `#` — is refused instead of
 * silently rewritten, because a map row that does not match the real request
 * path is worse than no row.
 */
export function normalizeRedirectPath(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_INVALID', `${field} must be a path`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_REQUIRED', `${field} is required`)
  }
  if (trimmed.length > ADMIN_REDIRECT_PATH_MAX) {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_INVALID', `${field} is too long`)
  }
  if (!trimmed.startsWith('/')) {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_INVALID', `${field} must start with "/"`)
  }
  if (/[?#\s\\]/.test(trimmed) || trimmed.includes('//')) {
    throw new RedirectServiceError(
      422,
      'REDIRECT_PATH_INVALID',
      `${field} cannot contain a query, fragment, whitespace or an empty segment`,
    )
  }
  const path = trimmed.replace(/\/+$/, '') || '/'
  if (!SEGMENT_PATTERN.test(path)) {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_INVALID', `${field} has an unsupported character`)
  }
  return path
}

/** The stored code decides the answer; anything else is read as a 301. */
function toAdminStatusCode(value: unknown): 301 | 302 | 410 {
  if (value === 302) return 302
  if (value === 410) return 410
  return 301
}

/**
 * A redirect needs an internal target; a gone row must not carry one, because
 * there is nowhere to send the visitor and a stray target would read as advice.
 */
function normalizeRedirectTarget(statusCode: number, value: unknown): string {
  if (statusCode === 410) {
    if (typeof value === 'string' && value.trim()) {
      throw new RedirectServiceError(
        422,
        'REDIRECT_TARGET_NOT_ALLOWED',
        'A gone path cannot have a target',
      )
    }
    return ''
  }
  return normalizeRedirectPath(value, 'to')
}

function toAdminRedirect(record: RedirectRecord): AdminRedirect {
  return {
    id: String(record._id),
    from: record.from,
    to: record.to,
    statusCode: toAdminStatusCode(record.statusCode),
    isActive: record.isActive !== false,
    note: record.note ?? '',
    revision: Number(record.revision) || 1,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new RedirectServiceError(422, 'REDIRECT_ID_INVALID', 'Redirect id is not valid')
  }
  return new Types.ObjectId(value)
}

/**
 * Rejects a map in which following a row eventually returns to where it started:
 * a browser would answer `ERR_TOO_MANY_REDIRECTS` instead of a page.
 */
function assertNoCycle(entries: Map<string, string>): void {
  for (const start of entries.keys()) {
    let current = start
    for (let hop = 0; hop <= MAX_CHAIN; hop += 1) {
      const next = entries.get(current)
      if (!next) break
      if (next === start) {
        throw new RedirectServiceError(409, 'REDIRECT_LOOP', 'This redirect would create a loop')
      }
      current = next
    }
  }
}

/** Current `from -> to` map of one site, optionally pretending one row is gone. */
async function loadChain(
  model: Model<RedirectDocument>,
  siteId: string,
  ignoreId?: Types.ObjectId,
): Promise<Map<string, string>> {
  // A gone row ends a chain instead of continuing one, so it is not an edge.
  const filter: Record<string, unknown> = { siteId, isActive: true, statusCode: { $ne: 410 } }
  if (ignoreId) filter._id = { $ne: ignoreId }
  const rows = await model.find(filter).select('from to').lean<{ from: string, to: string }[]>()
  return new Map(rows.map(row => [row.from, row.to]))
}

async function assertNoConflict(
  model: Model<RedirectDocument>,
  siteId: string,
  candidate: { from: string, to: string, statusCode: 301 | 302 | 410 },
  ignoreId?: Types.ObjectId,
): Promise<void> {
  // A gone path has no target, so it cannot loop and cannot be reached by one.
  if (candidate.statusCode === 410) return
  if (candidate.from === candidate.to) {
    throw new RedirectServiceError(422, 'REDIRECT_PATH_SAME', 'A path cannot redirect to itself')
  }
  const entries = await loadChain(model, siteId, ignoreId)
  entries.set(candidate.from, candidate.to)
  assertNoCycle(entries)
}

export async function listRedirects(
  model: Model<RedirectDocument>,
  siteId: string,
  input: { q?: string } = {},
): Promise<AdminRedirectList> {
  const filter: Record<string, unknown> = { siteId }
  const q = input.q?.trim()
  if (q) {
    const pattern = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ from: pattern }, { to: pattern }, { note: pattern }]
  }

  const [rows, total] = await Promise.all([
    model.find(filter).sort({ from: 1 }).limit(500).lean<RedirectRecord[]>(),
    model.countDocuments(filter),
  ])

  return { data: rows.map(toAdminRedirect), total }
}

export async function getRedirect(
  model: Model<RedirectDocument>,
  siteId: string,
  id: string,
): Promise<AdminRedirect> {
  const record = await model.findOne({ _id: objectId(id), siteId }).lean<RedirectRecord>()
  if (!record) {
    throw new RedirectServiceError(404, 'REDIRECT_NOT_FOUND', 'Redirect not found')
  }
  return toAdminRedirect(record)
}

export async function createRedirect(
  model: Model<RedirectDocument>,
  siteId: string,
  input: AdminRedirectDraft,
  meta?: RedirectWriteMeta,
): Promise<AdminRedirect> {
  const from = normalizeRedirectPath(input.from, 'from')
  const to = normalizeRedirectTarget(input.statusCode, input.to)
  await assertNoConflict(model, siteId, { from, to, statusCode: input.statusCode })

  let created: RedirectRecord
  try {
    created = await model.create({
      siteId,
      from,
      to,
      statusCode: input.statusCode,
      isActive: input.isActive,
      note: input.note,
      revision: 1,
    }) as RedirectRecord
  } catch (error) {
    const duplicate = error as { code?: number }
    if (duplicate?.code === 11000) {
      throw new RedirectServiceError(409, 'REDIRECT_EXISTS', 'This path already has a redirect')
    }
    throw error
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'redirect',
    resourceId: String(created._id),
    resourceKey: created.from,
    action: 'create',
    revision: created.revision,
    fromStatus: null,
    toStatus: created.isActive ? 'active' : 'inactive',
    changedFields: ['from', 'to', 'statusCode', 'isActive', 'note'],
  })

  return toAdminRedirect(created)
}

export async function updateRedirect(
  model: Model<RedirectDocument>,
  siteId: string,
  id: string,
  input: AdminRedirectUpdate,
  meta?: RedirectWriteMeta,
): Promise<AdminRedirect> {
  const redirectId = objectId(id)
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new RedirectServiceError(422, 'REDIRECT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: redirectId, siteId }).lean<RedirectRecord>()
  if (!record) {
    throw new RedirectServiceError(404, 'REDIRECT_NOT_FOUND', 'Redirect not found')
  }

  const from = normalizeRedirectPath(input.from, 'from')
  const to = normalizeRedirectTarget(input.statusCode, input.to)
  await assertNoConflict(model, siteId, { from, to, statusCode: input.statusCode }, redirectId)

  let updated: RedirectRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: redirectId, siteId, revision: input.revision },
      {
        $set: {
          from,
          to,
          statusCode: input.statusCode,
          isActive: input.isActive,
          note: input.note,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<RedirectRecord>()
  } catch (error) {
    const duplicate = error as { code?: number }
    if (duplicate?.code === 11000) {
      throw new RedirectServiceError(409, 'REDIRECT_EXISTS', 'This path already has a redirect')
    }
    throw error
  }

  if (!updated) {
    throw new RedirectServiceError(
      409,
      'REDIRECT_REVISION_CONFLICT',
      'Redirect was changed by someone else; reload before saving',
      { expected: input.revision },
    )
  }

  const changedFields = [
    record.from !== updated.from ? 'from' : null,
    record.to !== updated.to ? 'to' : null,
    record.statusCode !== updated.statusCode ? 'statusCode' : null,
    record.isActive !== updated.isActive ? 'isActive' : null,
    (record.note ?? '') !== (updated.note ?? '') ? 'note' : null,
  ].filter((field): field is string => Boolean(field))

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'redirect',
    resourceId: String(updated._id),
    resourceKey: updated.from,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.isActive ? 'active' : 'inactive',
    toStatus: updated.isActive ? 'active' : 'inactive',
    changedFields,
  })

  return toAdminRedirect(updated)
}

export async function deleteRedirect(
  model: Model<RedirectDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: RedirectWriteMeta,
): Promise<{ id: string }> {
  const redirectId = objectId(id)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new RedirectServiceError(422, 'REDIRECT_REVISION_REQUIRED', 'An integer revision is required')
  }

  const removed = await model.findOneAndDelete({ _id: redirectId, siteId, revision }).lean<RedirectRecord>()
  if (!removed) {
    const exists = await model.countDocuments({ _id: redirectId, siteId })
    if (!exists) {
      throw new RedirectServiceError(404, 'REDIRECT_NOT_FOUND', 'Redirect not found')
    }
    throw new RedirectServiceError(
      409,
      'REDIRECT_REVISION_CONFLICT',
      'Redirect was changed by someone else; reload before deleting',
      { expected: revision },
    )
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'redirect',
    resourceId: String(removed._id),
    resourceKey: removed.from,
    action: 'delete',
    revision: Number(removed.revision) || 1,
    fromStatus: removed.isActive ? 'active' : 'inactive',
    toStatus: null,
    changedFields: [],
  })

  return { id: String(removed._id) }
}

/**
 * Resolves one request path to its target, following at most `MAX_CHAIN` hops
 * through other active rows so an entry pointing at a path that later got its own
 * redirect still lands on a real page. `null` means "render the path normally".
 */
export async function resolveRedirect(
  model: Model<RedirectDocument>,
  siteId: string,
  path: string,
): Promise<{ to: string, statusCode: 301 | 302 | 410 } | null> {
  let normalized: string
  try {
    normalized = normalizeRedirectPath(path, 'path')
  } catch {
    return null
  }

  const first = await model.findOne({ siteId, from: normalized, isActive: true }).lean<RedirectRecord>()
  if (!first) return null
  if (toAdminStatusCode(first.statusCode) === 410) return { to: '', statusCode: 410 }

  let target = first.to
  for (let hop = 0; hop < MAX_CHAIN; hop += 1) {
    if (target === normalized) return null
    const next = await model.findOne({ siteId, from: target, isActive: true }).lean<RedirectRecord>()
    // A gone target is the end of the chain: the visitor must not follow on.
    if (!next || toAdminStatusCode(next.statusCode) === 410) break
    target = next.to
  }

  if (target === normalized) return null
  return { to: target, statusCode: toAdminStatusCode(first.statusCode) }
}
