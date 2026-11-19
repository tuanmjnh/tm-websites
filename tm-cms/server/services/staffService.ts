import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  StaffInvariantError,
  type StaffProfileDocument,
  type StaffPosition,
  type StaffWorkStatus,
  normalizeStaffInput,
} from '../models/staffProfile'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

/**
 * Staff directory (HR-01). The profile holds employment facts only; salary and
 * payroll live in their own collections so a staff list cannot leak pay.
 */

export class HrServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HrServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type StaffRecord = StaffProfileDocument & { _id: Types.ObjectId }

export interface StaffAdmin {
  id: string
  subjectId: string
  employeeCode: string
  fullName: string
  positionCode: StaffPosition
  jobDescription: string
  workStatus: StaffWorkStatus
  joinedAt: string | null
  leftAt: string | null
  phone: string
  note: string
  isDeleted: boolean
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface StaffListParams {
  q?: string | null
  workStatus?: StaffWorkStatus | null
  positionCode?: StaffPosition | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface StaffListResult {
  data: StaffAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number, probation: number, official: number, resigned: number }
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const SEARCH_MAX = 80

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new HrServiceError(422, code, 'Staff id is not valid')
  }
  return new Types.ObjectId(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function toAdminStaff(record: StaffRecord): StaffAdmin {
  return {
    id: String(record._id),
    subjectId: record.subjectId,
    employeeCode: record.employeeCode,
    fullName: record.fullName,
    positionCode: record.positionCode ?? 'staff',
    jobDescription: record.jobDescription ?? '',
    workStatus: record.workStatus ?? 'probation',
    joinedAt: record.joinedAt ?? null,
    leftAt: record.leftAt ?? null,
    phone: record.phone ?? '',
    note: record.note ?? '',
    isDeleted: record.isDeleted === true,
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function parseStaff(input: unknown) {
  try {
    return normalizeStaffInput(input)
  } catch (error) {
    if (error instanceof StaffInvariantError) {
      throw new HrServiceError(422, error.code, error.message)
    }
    throw error
  }
}

export async function createStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<StaffAdmin> {
  const draft = parseStaff(input)
  let created: StaffRecord
  try {
    created = await model.create({
      ...draft,
      siteId,
      isDeleted: false,
      deletedAt: null,
      revision: 1,
    }) as StaffRecord
  } catch (error) {
    const duplicate = error as { code?: number, keyPattern?: Record<string, unknown> }
    if (duplicate.code === 11000) {
      throw new HrServiceError(409, 'STAFF_EXISTS', duplicate.keyPattern?.subjectId
        ? 'Nhân sự này đã có hồ sơ'
        : 'Mã nhân viên đã được dùng')
    }
    throw error
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'staff_profile',
    resourceId: String(created._id),
    resourceKey: created.employeeCode,
    action: 'create',
    revision: 1,
    fromStatus: null,
    toStatus: created.workStatus,
    changedFields: ['subjectId', 'employeeCode', 'fullName', 'positionCode', 'workStatus'],
  })

  return toAdminStaff(created)
}

export async function updateStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<StaffAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new HrServiceError(422, 'STAFF_REVISION_REQUIRED', 'Thiếu phiên bản hiện tại')
  }

  const record = await model.findOne({ _id: objectId(id, 'STAFF_ID_INVALID'), siteId }).lean<StaffRecord | null>()
  if (!record) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
  if (record.isDeleted) throw new HrServiceError(409, 'STAFF_DELETED', 'Hồ sơ đã bị ẩn')

  const draft = parseStaff({
    employeeCode: record.employeeCode,
    fullName: record.fullName,
    positionCode: record.positionCode,
    jobDescription: record.jobDescription,
    workStatus: record.workStatus,
    joinedAt: record.joinedAt,
    leftAt: record.leftAt,
    phone: record.phone,
    note: record.note,
    ...body,
    // Identity is Hub's; a profile edit must not move it to another account.
    subjectId: record.subjectId,
  })

  let updated: StaffRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          employeeCode: draft.employeeCode,
          fullName: draft.fullName,
          positionCode: draft.positionCode,
          jobDescription: draft.jobDescription,
          workStatus: draft.workStatus,
          joinedAt: draft.joinedAt,
          leftAt: draft.leftAt,
          phone: draft.phone,
          note: draft.note,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<StaffRecord | null>()
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new HrServiceError(409, 'STAFF_EXISTS', 'Mã nhân viên đã được dùng')
    }
    throw error
  }

  if (!updated) {
    const current = await model.findOne({ _id: record._id, siteId }).lean<StaffRecord | null>()
    throw new HrServiceError(409, 'STAFF_REVISION_CONFLICT', 'Hồ sơ vừa được người khác sửa', {
      currentRevision: current?.revision ?? null,
    })
  }

  const before = {
    employeeCode: record.employeeCode,
    fullName: record.fullName,
    positionCode: record.positionCode,
    jobDescription: record.jobDescription,
    workStatus: record.workStatus,
    joinedAt: record.joinedAt,
    leftAt: record.leftAt,
    phone: record.phone,
    note: record.note,
  }
  const changed = Object.keys(before).filter(key =>
    JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((draft as Record<string, unknown>)[key]))

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'staff_profile',
    resourceId: String(record._id),
    resourceKey: updated.employeeCode,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.workStatus,
    toStatus: updated.workStatus,
    changedFields: changed,
  })

  return toAdminStaff(updated)
}

export async function listStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  params: StaffListParams = {},
): Promise<StaffListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.workStatus) filter.workStatus = params.workStatus
  if (params.positionCode) filter.positionCode = params.positionCode

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [{ employeeCode: pattern }, { fullName: pattern }, { phone: pattern }]
  }
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'STAFF_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<StaffRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const rows = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId, isDeleted: { $ne: true } } },
    { $group: { _id: '$workStatus', count: { $sum: 1 } } },
  ])
  const counts = { all: 0, probation: 0, official: 0, resigned: 0 }
  for (const row of rows) {
    if (row._id === 'probation' || row._id === 'official' || row._id === 'resigned') counts[row._id] = row.count
    counts.all += row.count
  }

  return {
    data: page.map(toAdminStaff),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts,
  }
}

export async function getStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  id: string,
): Promise<StaffAdmin> {
  const record = await model
    .findOne({ _id: objectId(id, 'STAFF_ID_INVALID'), siteId })
    .lean<StaffRecord | null>()
  if (!record) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
  return toAdminStaff(record)
}

async function setStaffDeleted(
  model: Model<StaffProfileDocument>,
  siteId: string,
  id: string,
  revision: number,
  deleted: boolean,
  meta?: { audit?: ContentAuditMeta },
): Promise<StaffAdmin> {
  const _id = objectId(id, 'STAFF_ID_INVALID')
  const record = await model.findOneAndUpdate(
    { _id, siteId, revision, isDeleted: deleted ? { $ne: true } : true },
    { $set: { isDeleted: deleted, deletedAt: deleted ? new Date() : null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<StaffRecord | null>()

  if (!record) {
    const current = await model.findOne({ _id, siteId }).lean<StaffRecord | null>()
    if (!current) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
    throw new HrServiceError(409, deleted ? 'STAFF_REVISION_CONFLICT' : 'STAFF_NOT_DELETED',
      deleted ? 'Hồ sơ vừa được người khác sửa' : 'Hồ sơ chưa bị ẩn', { currentRevision: current.revision })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'staff_profile',
    resourceId: String(_id),
    resourceKey: record.employeeCode,
    action: deleted ? 'delete' : 'restore',
    revision: record.revision,
    fromStatus: deleted ? 'active' : 'deleted',
    toStatus: deleted ? 'deleted' : 'active',
    changedFields: ['isDeleted'],
  })

  return toAdminStaff(record)
}

export function softDeleteStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<StaffAdmin> {
  return setStaffDeleted(model, siteId, id, revision, true, meta)
}

export function restoreStaff(
  model: Model<StaffProfileDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<StaffAdmin> {
  return setStaffDeleted(model, siteId, id, revision, false, meta)
}
