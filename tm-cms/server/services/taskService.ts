import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  TaskCreateSchema,
  type TaskDocument,
  type TaskCreateInput,
  TASK_STATUSES,
  TASK_PRIORITIES,
} from '../models/task'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class TaskServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'TaskServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

const RESOURCE = 'task' as const

type Record = TaskDocument & { _id: Types.ObjectId }

export interface TaskAdmin {
  id: string
  siteId: string
  title: string
  description: string
  assigneeId: string
  status: string
  priority: string
  dueAt: string | null
  completedAt: string | null
  isDeleted: boolean
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function toAdmin(record: Record): TaskAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    title: record.title,
    description: record.description ?? '',
    assigneeId: record.assigneeId,
    status: record.status,
    priority: record.priority,
    dueAt: iso(record.dueAt),
    completedAt: iso(record.completedAt),
    isDeleted: record.isDeleted === true,
    revision: record.revision ?? 1,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function normalizeCreate(input: unknown): TaskCreateInput {
  try {
    return TaskCreateSchema.parse(input)
  } catch (error) {
    if (error instanceof TaskServiceError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new TaskServiceError(422, 'TASK_PAYLOAD_INVALID', 'Task payload is invalid')
    }
    throw error
  }
}

export async function createTask(
  model: Model<TaskDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<TaskAdmin> {
  const draft = normalizeCreate(input)
  const created = await model.create({
    siteId,
    title: draft.title,
    description: draft.description,
    assigneeId: draft.assigneeId,
    status: 'todo',
    priority: draft.priority,
    dueAt: draft.dueAt,
    completedAt: null,
    isDeleted: false,
    deletedAt: null,
    revision: 1,
  })
  const record = created.toObject() as Record
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.title,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: 'todo',
    changedFields: ['title', 'assigneeId', 'priority'],
  })
  return toAdmin(record)
}

export async function getTask(
  model: Model<TaskDocument>,
  siteId: string,
  id: string,
  includeDeleted = false,
): Promise<TaskAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new TaskServiceError(422, 'TASK_ID_INVALID', 'Task id is not valid')
  const filter: Record<string, unknown> = { _id: new Types.ObjectId(id), siteId }
  if (!includeDeleted) filter.isDeleted = { $ne: true }
  const record = await model.findOne(filter).lean<Record | null>()
  if (!record) throw new TaskServiceError(404, 'TASK_NOT_FOUND', 'Task not found')
  return toAdmin(record)
}

export async function listTasks(
  model: Model<TaskDocument>,
  siteId: string,
  params: { assigneeId?: string, status?: string, includeDeleted?: boolean, cursor?: string, limit?: number } = {},
): Promise<{ data: TaskAdmin[], nextCursor: string | null, hasMore: boolean }> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), 100)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.assigneeId) filter.assigneeId = params.assigneeId
  if (params.status && TASK_STATUSES.includes(params.status as TaskStatus)) filter.status = params.status
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) filter._id = { $lt: new Types.ObjectId(params.cursor) }
  const rows = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<Record[]>()
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return { data: page.map(toAdmin), nextCursor: hasMore ? String(page[page.length - 1]!._id) : null, hasMore }
}

export async function updateTask(
  model: Model<TaskDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<TaskAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new TaskServiceError(422, 'TASK_ID_INVALID', 'Task id is not valid')
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new TaskServiceError(422, 'TASK_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId, isDeleted: { $ne: true } }).lean<Record | null>()
  if (!record) throw new TaskServiceError(404, 'TASK_NOT_FOUND', 'Task not found')
  if (record.revision !== revision) {
    throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 200)
  if (typeof body.description === 'string') patch.description = body.description.trim().slice(0, 4000)
  if (typeof body.assigneeId === 'string') patch.assigneeId = body.assigneeId.trim()
  if (typeof body.priority === 'string' && TASK_PRIORITIES.includes(body.priority as TaskPriority)) patch.priority = body.priority
  if (body.dueAt === null) patch.dueAt = null
  else if (body.dueAt !== undefined) {
    const d = new Date(String(body.dueAt))
    if (Number.isNaN(d.getTime())) throw new TaskServiceError(422, 'TASK_DUE_AT_INVALID', 'dueAt is not a valid date')
    patch.dueAt = d
  }
  if (typeof body.status === 'string' && TASK_STATUSES.includes(body.status as TaskStatus)) {
    patch.status = body.status
    patch.completedAt = body.status === 'done' ? new Date() : null
  }

  if (Object.keys(patch).length === 0) {
    return toAdmin(record)
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: patch, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<Record | null>()
  if (!updated) throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.title,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: Object.keys(patch),
  })
  return toAdmin(updated)
}

export async function softDeleteTask(
  model: Model<TaskDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<TaskAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new TaskServiceError(422, 'TASK_ID_INVALID', 'Task id is not valid')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<Record | null>()
  if (!record) throw new TaskServiceError(404, 'TASK_NOT_FOUND', 'Task not found')
  if (record.revision !== revision) throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<Record | null>()
  if (!updated) throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.title,
    action: 'delete',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}

export async function restoreTask(
  model: Model<TaskDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<TaskAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new TaskServiceError(422, 'TASK_ID_INVALID', 'Task id is not valid')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<Record | null>()
  if (!record) throw new TaskServiceError(404, 'TASK_NOT_FOUND', 'Task not found')
  if (record.revision !== revision) throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')
  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<Record | null>()
  if (!updated) throw new TaskServiceError(409, 'TASK_REVISION_CONFLICT', 'Task was changed by someone else; reload before saving')
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.title,
    action: 'restore',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: record.status,
    changedFields: ['isDeleted'],
  })
  return toAdmin(updated)
}