import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  JobEnqueueSchema,
  type JobDocument,
  type JobEnqueueInput,
  type JobStatus,
  JOB_STATUSES,
} from '../models/job'

export class JobServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'JobServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

type StoredJob = JobDocument & { _id: Types.ObjectId }

export interface JobAdmin {
  id: string
  siteId: string
  type: string
  payload: Record<string, unknown>
  status: string
  attempts: number
  maxAttempts: number
  runAt: string
  lockedAt: string | null
  lockedBy: string | null
  error: string
  result: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function toAdmin(record: StoredJob): JobAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    type: record.type,
    payload: record.payload ?? {},
    status: record.status,
    attempts: record.attempts ?? 0,
    maxAttempts: record.maxAttempts ?? 3,
    runAt: new Date(record.runAt).toISOString(),
    lockedAt: iso(record.lockedAt),
    lockedBy: record.lockedBy ?? null,
    error: record.error ?? '',
    result: record.result ?? null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function normalizeEnqueue(input: unknown): JobEnqueueInput {
  try {
    return JobEnqueueSchema.parse(input)
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      throw new JobServiceError(422, 'JOB_PAYLOAD_INVALID', 'Job payload is invalid')
    }
    throw error
  }
}

export async function enqueueJob(
  model: Model<JobDocument>,
  siteId: string,
  input: unknown,
): Promise<JobAdmin> {
  const draft = normalizeEnqueue(input)
  const created = await model.create({
    siteId,
    type: draft.type,
    payload: draft.payload,
    status: 'queued',
    attempts: 0,
    maxAttempts: draft.maxAttempts,
    runAt: draft.runAt ?? new Date(),
    lockedAt: null,
    lockedBy: null,
    error: '',
    result: null,
  })
  return toAdmin(created.toObject() as StoredJob)
}

export async function claimJob(
  model: Model<JobDocument>,
  siteId: string,
  workerId: string,
  types?: string[],
): Promise<JobAdmin | null> {
  const now = new Date()
  const filter: Record<string, unknown> = {
    siteId,
    status: 'queued',
    runAt: { $lte: now },
  }
  if (types && types.length) filter.type = { $in: types }

  const updated = await model.findOneAndUpdate(
    filter,
    { $set: { status: 'running', lockedAt: now, lockedBy: workerId }, $inc: { attempts: 1 } },
    { returnDocument: 'after', sort: { runAt: 1, createdAt: 1 } },
  ).lean<StoredJob | null>()

  if (!updated) return null
  return toAdmin(updated)
}

export async function completeJob(
  model: Model<JobDocument>,
  siteId: string,
  id: string,
  result?: Record<string, unknown>,
  workerId?: string,
): Promise<JobAdmin> {
  if (!Types.ObjectId.isValid(id)) {
    throw new JobServiceError(422, 'JOB_ID_INVALID', 'Job id is not valid')
  }
  const filter: Record<string, unknown> = { _id: new Types.ObjectId(id), siteId, status: 'running' }
  if (workerId) filter.lockedBy = workerId
  const updated = await model.findOneAndUpdate(
    filter,
    { $set: { status: 'done', result: result ?? null, lockedAt: null, lockedBy: null, error: '' } },
    { returnDocument: 'after' },
  ).lean<StoredJob | null>()
  if (!updated) throw new JobServiceError(409, 'JOB_NOT_RUNNING', 'Job is not running or not owned by this worker')
  return toAdmin(updated)
}

export async function failJob(
  model: Model<JobDocument>,
  siteId: string,
  id: string,
  error: string,
  workerId?: string,
  retryDelayMs = 1000,
): Promise<JobAdmin> {
  if (!Types.ObjectId.isValid(id)) {
    throw new JobServiceError(422, 'JOB_ID_INVALID', 'Job id is not valid')
  }
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StoredJob | null>()
  if (!record) throw new JobServiceError(404, 'JOB_NOT_FOUND', 'Job not found')

  const willRetry = record.attempts < record.maxAttempts
  const update: Record<string, unknown> = willRetry
    ? { status: 'queued', runAt: new Date(Date.now() + retryDelayMs), lockedAt: null, lockedBy: null, error: String(error ?? '').slice(0, 2000) }
    : { status: 'failed', lockedAt: null, lockedBy: null, error: String(error ?? '').slice(0, 2000) }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, status: 'running', ...(workerId ? { lockedBy: workerId } : {}) },
    { $set: update },
    { returnDocument: 'after' },
  ).lean<StoredJob | null>()
  if (!updated) throw new JobServiceError(409, 'JOB_NOT_RUNNING', 'Job is not running or not owned by this worker')
  return toAdmin(updated)
}

export async function cancelJob(
  model: Model<JobDocument>,
  siteId: string,
  id: string,
): Promise<JobAdmin> {
  if (!Types.ObjectId.isValid(id)) {
    throw new JobServiceError(422, 'JOB_ID_INVALID', 'Job id is not valid')
  }
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<StoredJob | null>()
  if (!record) throw new JobServiceError(404, 'JOB_NOT_FOUND', 'Job not found')
  if (record.status === 'done' || record.status === 'failed') {
    throw new JobServiceError(409, 'JOB_TERMINAL', 'Job is already finished')
  }
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId },
    { $set: { status: 'cancelled', lockedAt: null, lockedBy: null } },
    { returnDocument: 'after' },
  ).lean<StoredJob | null>()
  if (!updated) throw new JobServiceError(409, 'JOB_CANCEL_CONFLICT', 'Job changed; retry')
  return toAdmin(updated)
}

export async function listJobs(
  model: Model<JobDocument>,
  siteId: string,
  params: { status?: string, type?: string, cursor?: string, limit?: number } = {},
): Promise<{ data: JobAdmin[], nextCursor: string | null, hasMore: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), 100)
  const filter: Record<string, unknown> = { siteId }
  if (params.status && JOB_STATUSES.includes(params.status as JobStatus)) filter.status = params.status
  if (params.type) filter.type = params.type
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }
  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<StoredJob[]>()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return {
    data: page.map(toAdmin),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
  }
}