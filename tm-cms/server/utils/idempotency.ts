import { createHash } from 'node:crypto'
import type { Model } from 'mongoose'
import { IDEMPOTENCY_TTL_MS, type IdempotencyRecordDocument } from '../models/idempotency'

/**
 * Retry safety for admin mutations. A client that retries a create/patch/event
 * (timeout, double click, network retry) must not produce a second write.
 *
 * The key is supplied by the caller (`Idempotency-Key` header). The stored hash is
 * of the request payload, so the same key with a different body is rejected
 * instead of replaying an unrelated response.
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export class IdempotencyError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'IdempotencyError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

/** `null` means "no key provided", so the caller runs as a normal request. */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  if (!value) return null
  if (!KEY_PATTERN.test(value)) {
    throw new IdempotencyError(
      422,
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, underscore or dash',
    )
  }
  return value
}

/** Deterministic JSON so a reordered object still hashes to the same payload. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

export function digestPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

export interface IdempotentOptions {
  model: Model<IdempotencyRecordDocument>
  siteId: string
  /** Logical command name (`content.create`, `content.update`, ...). */
  action: string
  key: string | null
  payload: unknown
  now?: Date
}

export interface IdempotentResult<T> {
  statusCode: number
  value: T
  replayed: boolean
}

function replay<T>(record: IdempotencyRecordDocument, requestHash: string): IdempotentResult<T> {
  if (record.requestHash !== requestHash) {
    throw new IdempotencyError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used with a different payload',
    )
  }
  return {
    statusCode: record.responseStatus,
    value: JSON.parse(record.responseBody) as T,
    replayed: true,
  }
}

function isDuplicateError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000
}

/**
 * Runs `execute` at most once per (site, key). Without a key the command runs
 * normally, so existing clients keep working.
 */
export async function executeIdempotent<T>(
  options: IdempotentOptions,
  execute: () => Promise<{ statusCode: number, value: T }>,
): Promise<IdempotentResult<T>> {
  if (!options.key) {
    const result = await execute()
    return { ...result, replayed: false }
  }

  const now = options.now ?? new Date()
  const requestHash = digestPayload(options.payload)

  const existing = await options.model
    .findOne({ siteId: options.siteId, key: options.key })
    .lean<IdempotencyRecordDocument | null>()

  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    return replay<T>(existing, requestHash)
  }
  if (existing) {
    // The TTL monitor may lag behind; an expired key is treated as unused.
    await options.model.deleteOne({ _id: (existing as unknown as { _id: unknown })._id })
  }

  const result = await execute()

  try {
    await options.model.create({
      siteId: options.siteId,
      key: options.key,
      action: options.action,
      requestHash,
      responseStatus: result.statusCode,
      responseBody: JSON.stringify(result.value),
      expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
    })
  } catch (error) {
    if (!isDuplicateError(error)) throw error
    // A concurrent request stored the same key first: replay its response rather
    // than reporting a failure for a command that did run.
    const winner = await options.model
      .findOne({ siteId: options.siteId, key: options.key })
      .lean<IdempotencyRecordDocument | null>()
    if (winner) return replay<T>(winner, requestHash)
    throw error
  }

  return { ...result, replayed: false }
}
