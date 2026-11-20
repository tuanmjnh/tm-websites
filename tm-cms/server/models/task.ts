import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

/**
 * A site-scoped task record (MSG-01).
 *
 * Tasks are owned by a recipient/assignee and carry a simple status lifecycle.
 * Soft delete keeps the row for audit; restore brings it back. Optimistic
 * `revision` guards concurrent edits.
 */

export const TASK_SCHEMA_VERSION = 1

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

const RECIPIENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,127}$/

export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  assigneeId: z.string().regex(RECIPIENT_PATTERN),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueAt: z.date().nullable().default(null),
})

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>

export interface TaskDocument {
  siteId: string
  title: string
  description: string
  assigneeId: string
  status: TaskStatus
  priority: TaskPriority
  dueAt: Date | null
  completedAt: Date | null
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const TaskMongooseSchema = new Schema<TaskDocument>(
  {
    siteId: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    assigneeId: { type: String, required: true },
    status: { type: String, enum: TASK_STATUSES, default: 'todo', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium', required: true },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: TASK_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_tasks',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

TaskMongooseSchema.index({ siteId: 1, assigneeId: 1, status: 1 }, { name: 'task_site_assignee_status' })
TaskMongooseSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'task_site_deleted_created' })

export function taskModel(connection: Connection): Model<TaskDocument> {
  const registered = connection.models.Task as Model<TaskDocument> | undefined
  if (registered) return registered
  return connection.model<TaskDocument>('Task', TaskMongooseSchema, 'crm_tasks')
}

export async function syncTaskIndexes(connection: Connection): Promise<void> {
  await taskModel(connection).createIndexes()
}