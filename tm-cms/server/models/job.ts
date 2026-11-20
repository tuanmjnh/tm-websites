import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * A site-scoped background job queue (OPS-01).
 *
 * Jobs are claimed atomically via a conditional update on `status`, so two
 * workers cannot run the same job. A failed job is retried up to `maxAttempts`
 * with a backoff; after that it stays `failed` for an operator to inspect.
 */

export const JOB_SCHEMA_VERSION = 1

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

const TYPE_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/

export const JobEnqueueSchema = z.object({
  type: z.string().regex(TYPE_PATTERN),
  payload: z.record(z.string(), z.unknown()).default({}),
  runAt: z.coerce.date().optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
})

export type JobEnqueueInput = z.infer<typeof JobEnqueueSchema>

export interface JobDocument {
  siteId: string
  type: string
  payload: Record<string, unknown>
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAt: Date
  lockedAt: Date | null
  lockedBy: string | null
  error: string
  result: Record<string, unknown> | null
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const JobMongooseSchema = new Schema<JobDocument>(
  {
    siteId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: JOB_STATUSES, default: 'queued', required: true },
    attempts: { type: Number, default: 0, required: true },
    maxAttempts: { type: Number, default: 3, required: true },
    runAt: { type: Date, required: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    error: { type: String, default: '' },
    result: { type: Schema.Types.Mixed, default: null },
    schemaVersion: { type: Number, default: JOB_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_jobs',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

JobMongooseSchema.index({ siteId: 1, status: 1, runAt: 1 }, { name: 'job_site_status_runat' })
JobMongooseSchema.index({ siteId: 1, type: 1, createdAt: -1 }, { name: 'job_site_type_created' })

export function jobModel(connection: Connection): Model<JobDocument> {
  const registered = connection.models.Job as Model<JobDocument> | undefined
  if (registered) return registered
  return connection.model<JobDocument>('Job', JobMongooseSchema, 'crm_jobs')
}

export async function syncJobIndexes(connection: Connection): Promise<void> {
  await jobModel(connection).createIndexes()
}