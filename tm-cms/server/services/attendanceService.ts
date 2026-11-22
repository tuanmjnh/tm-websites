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
import { csvCell } from '../utils/csv'
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
  cursor?: string | null
  limit?: number
}

export interface AttendanceListResult {
  data: AttendanceAdmin[]
  /** Counts over the whole filter, not just the page on screen. */
  summary: Record<AttendanceStatus | 'all', number>
  nextCursor: string | null
  hasMore: boolean
}

const DEFAULT_ATTENDANCE_LIMIT = 100
const MAX_ATTENDANCE_LIMIT = 500

/**
 * The list sorts by `date` and then `_id`, so one id is not enough to resume: a
 * cursor is the pair of the last row shown. Anything else would either skip rows
 * that share a day or repeat them.
 */
function parseAttendanceCursor(cursor: string): { date: string, id: Types.ObjectId } {
  const [date, id] = cursor.split('|')
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Types.ObjectId.isValid(id)) {
    throw new HrServiceError(422, 'ATTENDANCE_CURSOR_INVALID', 'Con trỏ trang không hợp lệ')
  }
  return { date, id: new Types.ObjectId(id) }
}

/**
 * The month/staff/status filter both the list and the export read, so the file
 * cannot answer a different question from the table it was downloaded from.
 */
function attendanceFilter(siteId: string, params: AttendanceListParams): Record<string, unknown> {
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
  return filter
}

export async function listAttendances(
  model: Model<AttendanceDocument>,
  siteId: string,
  params: AttendanceListParams = {},
): Promise<AttendanceListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_ATTENDANCE_LIMIT), 1), MAX_ATTENDANCE_LIMIT)
  const baseFilter = attendanceFilter(siteId, params)

  const filter: Record<string, unknown> = { ...baseFilter }
  if (params.cursor) {
    const cursor = parseAttendanceCursor(params.cursor)
    filter.$or = [
      { date: { $lt: cursor.date } },
      { date: cursor.date, _id: { $lt: cursor.id } },
    ]
  }

  const records = await model.find(filter).sort({ date: -1, _id: -1 }).limit(limit + 1).lean<AttendanceRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const summary = { all: 0, present: 0, late: 0, leave: 0, absent: 0 } as Record<AttendanceStatus | 'all', number>
  const rows = await model.aggregate<{ _id: AttendanceStatus, count: number }>([
    { $match: baseFilter },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  for (const row of rows) {
    if (row._id in summary) summary[row._id] = row.count
    summary.all += row.count
  }

  const last = page[page.length - 1]
  return {
    data: page.map(toAdminAttendance),
    summary,
    nextCursor: hasMore && last ? `${last.date}|${String(last._id)}` : null,
    hasMore,
  }
}

export interface AttendanceExportRow {
  date: string
  employeeCode: string
  fullName: string
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  warehouseId: string | null
  note: string
}

const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Có mặt',
  late: 'Trễ',
  leave: 'Nghỉ phép',
  absent: 'Vắng',
}

const EXPORT_COLUMNS = ['Ngày', 'Mã nhân sự', 'Họ tên', 'Trạng thái', 'Giờ vào', 'Giờ ra', 'Kho', 'Ghi chú'] as const

/**
 * The attendance sheet a bookkeeper opens, not a database dump: the staff code
 * and name travel with the row (an id means nothing outside the CMS), the status
 * is written as the words the screen shows, and the month is named once at the
 * top so a saved file still says which period it covers.
 */
export function attendanceToCsv(rows: AttendanceExportRow[], label: string): string {
  const lines: string[] = [`# Chấm công ${label} (${rows.length} dòng)`, EXPORT_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push([
      row.date,
      row.employeeCode,
      row.fullName,
      ATTENDANCE_STATUS_LABEL[row.status] ?? row.status,
      row.checkIn ?? '',
      row.checkOut ?? '',
      row.warehouseId ?? '',
      row.note,
    ].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

const MAX_EXPORT_ROWS = 5000

/**
 * The export answers the whole filter, not the page on screen: an attendance
 * sheet that silently stopped at 50 rows would be worse than no export. Past the
 * cap the file is truncated and says so, instead of quietly losing people.
 */
export async function exportAttendancesCsv(
  model: Model<AttendanceDocument>,
  staffModel: Model<StaffProfileDocument>,
  siteId: string,
  params: AttendanceListParams = {},
): Promise<{ csv: string, rows: number, truncated: boolean }> {
  const filter = attendanceFilter(siteId, params)
  const records = await model.find(filter).sort({ date: -1, _id: -1 }).limit(MAX_EXPORT_ROWS + 1).lean<AttendanceRecord[]>()
  const truncated = records.length > MAX_EXPORT_ROWS
  const page = truncated ? records.slice(0, MAX_EXPORT_ROWS) : records

  const staffIds = [...new Set(page.map(record => record.staffId))]
    .filter(id => Types.ObjectId.isValid(id))
    .map(id => new Types.ObjectId(id))
  const staff = staffIds.length
    ? await staffModel
        .find({ siteId, _id: { $in: staffIds } })
        .select({ employeeCode: 1, fullName: 1 })
        .lean<{ _id: Types.ObjectId, employeeCode: string, fullName: string }[]>()
    : []
  const byId = new Map(staff.map(row => [String(row._id), row]))

  const csv = attendanceToCsv(page.map(record => {
    const profile = byId.get(record.staffId)
    return {
      date: record.date,
      employeeCode: profile?.employeeCode ?? '',
      fullName: profile?.fullName ?? '',
      status: record.status,
      checkIn: record.checkIn ?? null,
      checkOut: record.checkOut ?? null,
      warehouseId: record.warehouseId ?? null,
      note: record.note ?? '',
    }
  }), params.month ?? 'tất cả các tháng')

  return { csv, rows: page.length, truncated }
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
