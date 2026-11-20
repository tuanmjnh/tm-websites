import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  type AttendanceDocument,
  type AttendanceStatus,
  AttendanceInvariantError,
  normalizeAttendanceInput,
} from '../models/attendance'
import type { StaffProfileDocument } from '../models/staffProfile'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { HrServiceError } from './staffService'

/**
 * Attendance capture (HR-01). The pair (staff, day) is unique and writing it
 * again replaces the row: an operator fixing a check-in time is correcting one
 * day, and two rows for one day would be paid twice.
 */

export interface AttendanceAdmin {
  id: string
  staffId: string
  date: string
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  warehouseId: string | null
  note: string
  updatedAt: string | null
}

export interface AttendanceRecord extends AttendanceDocument {
  _id: Types.ObjectId
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminAttendance(record: AttendanceRecord): AttendanceAdmin {
  return {
    id: String(record._id),
    staffId: record.staffId,
    date: record.date,
    status: record.status,
    checkIn: record.checkIn ?? null,
    checkOut: record.checkOut ?? null,
    warehouseId: record.warehouseId ?? null,
    note: record.note ?? '',
    updatedAt: iso(record.updatedAt),
  }
}

export async function upsertAttendance(
  model: Model<AttendanceDocument>,
  staffModel: Model<StaffProfileDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ attendance: AttendanceAdmin, created: boolean }> {
  let draft
  try {
    draft = normalizeAttendanceInput(input)
  } catch (error) {
    if (error instanceof AttendanceInvariantError) {
      throw new HrServiceError(422, error.code, error.message)
    }
    throw error
  }

  if (!Types.ObjectId.isValid(draft.staffId)) {
    throw new HrServiceError(422, 'STAFF_ID_INVALID', 'Staff id is not valid')
  }
  const staff = await staffModel
    .findOne({ _id: new Types.ObjectId(draft.staffId), siteId, isDeleted: { $ne: true } })
    .lean<{ _id: Types.ObjectId, employeeCode: string } | null>()
  if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')

  const filter = { siteId, staffId: draft.staffId, date: draft.date }
  const before = await model.findOne(filter).lean<AttendanceRecord | null>()

  let record: AttendanceRecord | null
  try {
    record = await model.findOneAndUpdate(
      filter,
      {
        $set: {
          status: draft.status,
          checkIn: draft.checkIn,
          checkOut: draft.checkOut,
          warehouseId: draft.warehouseId,
          note: draft.note,
        },
        $setOnInsert: { siteId, staffId: draft.staffId, date: draft.date },
      },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false },
    ).lean<AttendanceRecord | null>()
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      // Two concurrent corrections for the same day: understood as a duplicate
      // write, not a second row.
      record = await model.findOne(filter).lean<AttendanceRecord | null>()
      if (!record) throw error
    } else {
      throw error
    }
  }
  if (!record) throw new HrServiceError(500, 'ATTENDANCE_WRITE_FAILED', 'Không lưu được chấm công')

  const created = !before
  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'attendance',
    resourceId: String(record._id),
    resourceKey: `${staff.employeeCode}:${draft.date}`,
    action: created ? 'create' : 'update',
    revision: 1,
    fromStatus: before?.status ?? null,
    toStatus: record.status,
    changedFields: before ? ['status', 'checkIn', 'checkOut', 'warehouseId', 'note'] : ['status', 'date'],
  })

  return { attendance: toAdminAttendance(record), created }
}

export interface AttendanceListParams {
  month?: string | null
  staffId?: string | null
  status?: AttendanceStatus | null
}

export async function listAttendances(
  model: Model<AttendanceDocument>,
  siteId: string,
  params: AttendanceListParams = {},
): Promise<{ data: AttendanceAdmin[], summary: Record<AttendanceStatus | 'all', number> }> {
  const filter: Record<string, unknown> = { siteId }
  if (params.staffId) {
    if (!Types.ObjectId.isValid(params.staffId)) {
      throw new HrServiceError(422, 'STAFF_ID_INVALID', 'Staff id is not valid')
    }
    filter.staffId = params.staffId
  }
  if (params.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month)) {
      throw new HrServiceError(422, 'ATTENDANCE_MONTH_INVALID', 'Tháng không hợp lệ (YYYY-MM)')
    }
    filter.date = { $gte: `${params.month}-01`, $lte: `${params.month}-31` }
  }
  if (params.status) filter.status = params.status

  const records = await model.find(filter).sort({ date: -1, _id: -1 }).limit(1000).lean<AttendanceRecord[]>()
  const summary = { all: 0, present: 0, late: 0, leave: 0, absent: 0 } as Record<AttendanceStatus | 'all', number>
  for (const record of records) {
    summary[record.status] += 1
    summary.all += 1
  }

  return { data: records.map(toAdminAttendance), summary }
}

/**
 * Correcting a day means removing the row, not hiding it: the day is factual
 * data and a hidden row would still be counted by payroll. The audit entry keeps
 * who removed it and what it said.
 */
export async function deleteAttendance(
  model: Model<AttendanceDocument>,
  siteId: string,
  id: string,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) {
    throw new HrServiceError(422, 'ATTENDANCE_ID_INVALID', 'Attendance id is not valid')
  }
  const record = await model
    .findOneAndDelete({ _id: new Types.ObjectId(id), siteId })
    .lean<AttendanceRecord | null>()
  if (!record) throw new HrServiceError(404, 'ATTENDANCE_NOT_FOUND', 'Không tìm thấy bản ghi chấm công')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'attendance',
    resourceId: String(record._id),
    resourceKey: `${record.staffId}:${record.date}`,
    action: 'delete',
    revision: 1,
    fromStatus: record.status,
    toStatus: null,
    changedFields: ['date', 'status'],
  })

  return { id: String(record._id) }
}
