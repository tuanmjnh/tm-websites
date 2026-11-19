import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { StaffProfileDocument } from '../models/staffProfile'
import {
  type ShiftAssignmentDocument,
  ShiftAssignmentInvariantError,
  normalizeShiftAssignmentInput,
  shiftSnapshotOf,
} from '../models/shiftAssignment'
import {
  type ShiftTemplateDocument,
  ShiftInvariantError,
  normalizeShiftTemplateInput,
  shiftSpanMinutes,
  shiftWorkedMinutes,
} from '../models/shiftTemplate'
import { CUSTOMER_DAY_MS, isCalendarDate, localDayOf, localDayStartUtc, todayInCustomerTime } from '../utils/customerTime'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'
import { HrServiceError } from './staffService'

/**
 * Shift scheduling (HR-02).
 *
 * Two rules shape the roster: one person is in one place per day, and a shift
 * that already happened cannot be scheduled or withdrawn — past days belong to
 * attendance and payroll. Assignment copies the template's times, so a later
 * template edit never silently moves a published roster.
 */

const MAX_HORIZON_DAYS = 180
const MAX_LIST_DAYS = 62

export interface ShiftTemplateAdmin {
  id: string
  code: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  spanMinutes: number
  workedMinutes: number
  overnight: boolean
  capacity: number | null
  isActive: boolean
  note: string
  revision: number
  updatedAt: string | null
}

export interface ShiftAssignmentAdmin {
  id: string
  templateId: string
  shiftCode: string
  staffId: string
  employeeCode: string
  staffName: string | null
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  workedMinutes: number
  overnight: boolean
  note: string
  updatedAt: string | null
}

export interface ShiftTemplateRecord extends ShiftTemplateDocument {
  _id: Types.ObjectId
}

export interface ShiftAssignmentRecord extends ShiftAssignmentDocument {
  _id: Types.ObjectId
}

export function toAdminShiftTemplate(record: ShiftTemplateRecord): ShiftTemplateAdmin {
  return {
    id: String(record._id),
    code: record.code,
    name: record.name,
    startTime: record.startTime,
    endTime: record.endTime,
    breakMinutes: record.breakMinutes ?? 0,
    spanMinutes: shiftSpanMinutes(record.startTime, record.endTime),
    workedMinutes: shiftWorkedMinutes(record.startTime, record.endTime, record.breakMinutes ?? 0),
    overnight: record.endTime <= record.startTime,
    capacity: record.capacity ?? null,
    isActive: record.isActive !== false,
    note: record.note ?? '',
    revision: record.revision ?? 1,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
  }
}

export function toAdminShiftAssignment(
  record: ShiftAssignmentRecord,
  staffName: string | null = null,
): ShiftAssignmentAdmin {
  return {
    id: String(record._id),
    templateId: String(record.templateId),
    shiftCode: record.shiftCode,
    staffId: String(record.staffId),
    employeeCode: record.employeeCode,
    staffName,
    date: record.date,
    startTime: record.startTime,
    endTime: record.endTime,
    breakMinutes: record.breakMinutes ?? 0,
    workedMinutes: shiftWorkedMinutes(record.startTime, record.endTime, record.breakMinutes ?? 0),
    overnight: record.endTime <= record.startTime,
    note: record.note ?? '',
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
  }
}

function normalizeOrThrow<T>(run: () => T, ErrorClass: typeof ShiftInvariantError | typeof ShiftAssignmentInvariantError): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof ErrorClass) throw new HrServiceError(422, error.code, error.message)
    throw error
  }
}

export async function createShiftTemplate(
  model: Model<ShiftTemplateDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ template: ShiftTemplateAdmin, created: boolean }> {
  const draft = normalizeOrThrow(() => normalizeShiftTemplateInput(input), ShiftInvariantError)

  const existing = await model.findOne({ siteId, code: draft.code }).lean<ShiftTemplateRecord | null>()
  if (existing && !existing.isDeleted) {
    throw new HrServiceError(409, 'SHIFT_CODE_TAKEN', `Mã ca "${draft.code}" đã tồn tại`)
  }

  let record: ShiftTemplateRecord
  if (existing) {
    // A code that was archived is revived rather than duplicated: the unique
    // index is per site, and two live rows with one code would be ambiguous.
    record = (await model.findOneAndUpdate(
      { _id: existing._id, siteId },
      {
        $set: { ...draft, isDeleted: false, deletedAt: null },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after', includeResultMetadata: false },
    ).lean<ShiftTemplateRecord | null>())!
  } else {
    record = (await model.create({ ...draft, siteId })).toObject() as ShiftTemplateRecord
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'shift_template',
    resourceId: String(record._id),
    resourceKey: record.code,
    action: existing ? 'restore' : 'create',
    revision: record.revision ?? 1,
    fromStatus: existing ? 'archived' : null,
    toStatus: record.isActive ? 'active' : 'inactive',
    changedFields: ['code', 'name', 'startTime', 'endTime', 'breakMinutes', 'capacity'],
  })

  return { template: toAdminShiftTemplate(record), created: !existing }
}

export async function listShiftTemplates(
  model: Model<ShiftTemplateDocument>,
  siteId: string,
  params: { includeInactive?: boolean } = {},
): Promise<{ data: ShiftTemplateAdmin[], summary: { active: number, inactive: number } }> {
  const filter: Record<string, unknown> = { siteId, isDeleted: { $ne: true } }
  if (!params.includeInactive) filter.isActive = true

  const records = await model.find(filter).sort({ startTime: 1, code: 1 }).limit(200).lean<ShiftTemplateRecord[]>()
  const all = await model.find({ siteId, isDeleted: { $ne: true } }).select({ isActive: 1 }).lean<{ isActive: boolean }[]>()
  const summary = {
    active: all.filter(row => row.isActive !== false).length,
    inactive: all.filter(row => row.isActive === false).length,
  }
  return { data: records.map(toAdminShiftTemplate), summary }
}

export async function updateShiftTemplate(
  model: Model<ShiftTemplateDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<ShiftTemplateAdmin> {
  if (!Types.ObjectId.isValid(id)) throw new HrServiceError(422, 'SHIFT_TEMPLATE_ID_INVALID', 'Mã ca không hợp lệ')
  const before = await model.findOne({ _id: new Types.ObjectId(id), siteId, isDeleted: { $ne: true } })
    .lean<ShiftTemplateRecord | null>()
  if (!before) throw new HrServiceError(404, 'SHIFT_TEMPLATE_NOT_FOUND', 'Không tìm thấy ca làm việc')

  const source = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const revision = source.revision
  if (revision !== undefined && Number(revision) !== (before.revision ?? 1)) {
    throw new HrServiceError(409, 'SHIFT_REVISION_CONFLICT', 'Ca làm việc đã được người khác sửa, hãy tải lại')
  }

  const merged = {
    code: before.code,
    name: before.name,
    startTime: before.startTime,
    endTime: before.endTime,
    breakMinutes: before.breakMinutes ?? 0,
    capacity: before.capacity ?? null,
    isActive: before.isActive !== false,
    note: before.note ?? '',
    ...Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null)),
  }
  const draft = normalizeOrThrow(() => normalizeShiftTemplateInput(merged), ShiftInvariantError)

  const duplicate = await model.findOne({ siteId, code: draft.code, _id: { $ne: before._id } }).lean<ShiftTemplateRecord | null>()
  if (duplicate && !duplicate.isDeleted) {
    throw new HrServiceError(409, 'SHIFT_CODE_TAKEN', `Mã ca "${draft.code}" đã tồn tại`)
  }

  const record = (await model.findOneAndUpdate(
    { _id: before._id, siteId, revision: before.revision ?? 1 },
    { $set: draft, $inc: { revision: 1 } },
    { returnDocument: 'after', includeResultMetadata: false },
  ).lean<ShiftTemplateRecord | null>())
  if (!record) throw new HrServiceError(409, 'SHIFT_REVISION_CONFLICT', 'Ca làm việc đã được người khác sửa, hãy tải lại')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'shift_template',
    resourceId: id,
    resourceKey: record.code,
    action: 'update',
    revision: record.revision ?? 1,
    fromStatus: before.isActive !== false ? 'active' : 'inactive',
    toStatus: record.isActive ? 'active' : 'inactive',
    changedFields: ['code', 'name', 'startTime', 'endTime', 'breakMinutes', 'capacity', 'isActive'],
  })

  return toAdminShiftTemplate(record)
}

/**
 * Archiving is refused while the template still has assignments from today on:
 * those people would keep a shift that no longer has a definition to edit, and
 * the roster is a promise to them, not a draft.
 */
export async function archiveShiftTemplate(
  model: Model<ShiftTemplateDocument>,
  assignmentModel: Model<ShiftAssignmentDocument>,
  siteId: string,
  id: string,
  now: Date = new Date(),
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) throw new HrServiceError(422, 'SHIFT_TEMPLATE_ID_INVALID', 'Mã ca không hợp lệ')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId, isDeleted: { $ne: true } })
    .lean<ShiftTemplateRecord | null>()
  if (!record) throw new HrServiceError(404, 'SHIFT_TEMPLATE_NOT_FOUND', 'Không tìm thấy ca làm việc')

  const upcoming = await assignmentModel.countDocuments({
    siteId,
    templateId: new Types.ObjectId(id),
    date: { $gte: todayInCustomerTime(now) },
  })
  if (upcoming > 0) {
    throw new HrServiceError(409, 'SHIFT_TEMPLATE_IN_USE', `Ca còn ${upcoming} phân ca từ hôm nay, hãy huỷ trước`, { upcoming })
  }

  await model.updateOne(
    { _id: record._id, siteId },
    { $set: { isDeleted: true, deletedAt: new Date(), isActive: false }, $inc: { revision: 1 } },
  )

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'shift_template',
    resourceId: id,
    resourceKey: record.code,
    action: 'archive',
    revision: (record.revision ?? 1) + 1,
    fromStatus: record.isActive !== false ? 'active' : 'inactive',
    toStatus: 'archived',
    changedFields: ['isDeleted'],
  })

  return { id }
}

export interface AssignShiftParams {
  /** Assignment window: today or later, at most 180 days ahead. */
  now?: Date
}

export async function assignShift(
  models: { ShiftTemplate: Model<ShiftTemplateDocument>, ShiftAssignment: Model<ShiftAssignmentDocument>, StaffProfile: Model<StaffProfileDocument> },
  siteId: string,
  input: unknown,
  params: AssignShiftParams = {},
  meta?: { audit?: ContentAuditMeta },
): Promise<{ assignment: ShiftAssignmentAdmin, created: boolean }> {
  const draft = normalizeOrThrow(() => normalizeShiftAssignmentInput(input), ShiftAssignmentInvariantError)
  if (!isCalendarDate(draft.date)) {
    throw new HrServiceError(422, 'SHIFT_DATE_INVALID', 'Ngày phân ca không hợp lệ')
  }
  const now = params.now ?? new Date()
  const today = todayInCustomerTime(now)
  if (draft.date < today) {
    throw new HrServiceError(409, 'SHIFT_DATE_IN_PAST', 'Không thể phân ca cho ngày đã qua', { date: draft.date, today })
  }
  const horizon = localDayOf(new Date(localDayStartUtc(today).getTime() + MAX_HORIZON_DAYS * CUSTOMER_DAY_MS))
  if (draft.date > horizon) {
    throw new HrServiceError(422, 'SHIFT_DATE_TOO_FAR', `Chỉ phân ca trong ${MAX_HORIZON_DAYS} ngày tới`, { horizon })
  }

  const template = await models.ShiftTemplate.findOne({
    _id: new Types.ObjectId(draft.templateId),
    siteId,
    isDeleted: { $ne: true },
  }).lean<ShiftTemplateRecord | null>()
  if (!template) throw new HrServiceError(404, 'SHIFT_TEMPLATE_NOT_FOUND', 'Không tìm thấy ca làm việc')
  if (template.isActive === false) {
    throw new HrServiceError(409, 'SHIFT_TEMPLATE_INACTIVE', 'Ca làm việc đang tạm ngưng')
  }

  const staff = await models.StaffProfile.findOne({
    _id: new Types.ObjectId(draft.staffId),
    siteId,
    isDeleted: { $ne: true },
  }).lean<{ _id: Types.ObjectId, employeeCode: string, fullName: string, workStatus: string } | null>()
  if (!staff) throw new HrServiceError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy hồ sơ nhân sự')
  if (staff.workStatus === 'resigned') {
    throw new HrServiceError(409, 'STAFF_RESIGNED', 'Nhân sự đã nghỉ việc, không thể phân ca')
  }

  const staffObjectId = new Types.ObjectId(draft.staffId)
  const clash = await models.ShiftAssignment.findOne({ siteId, staffId: staffObjectId, date: draft.date })
    .lean<ShiftAssignmentRecord | null>()
  if (clash) {
    throw new HrServiceError(409, 'SHIFT_ALREADY_ASSIGNED', `${staff.fullName} đã có ca ${clash.shiftCode} ngày ${draft.date}`, {
      assignmentId: String(clash._id),
      shiftCode: clash.shiftCode,
    })
  }

  if (template.capacity) {
    const taken = await models.ShiftAssignment.countDocuments({
      siteId,
      templateId: template._id,
      date: draft.date,
    })
    if (taken >= template.capacity) {
      throw new HrServiceError(409, 'SHIFT_CAPACITY_REACHED', `Ca ${template.code} ngày ${draft.date} đã đủ ${template.capacity} người`, {
        capacity: template.capacity,
      })
    }
  }

  let record: ShiftAssignmentRecord
  try {
    record = (await models.ShiftAssignment.create({
      siteId,
      templateId: template._id,
      staffId: staffObjectId,
      employeeCode: staff.employeeCode,
      date: draft.date,
      note: draft.note,
      ...shiftSnapshotOf(template),
    })).toObject() as ShiftAssignmentRecord
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new HrServiceError(409, 'SHIFT_ALREADY_ASSIGNED', `${staff.fullName} đã có ca trong ngày ${draft.date}`)
    }
    throw error
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'shift_assignment',
    resourceId: String(record._id),
    resourceKey: `${record.employeeCode}:${record.date}`,
    action: 'create',
    revision: 1,
    fromStatus: null,
    toStatus: record.shiftCode,
    changedFields: ['templateId', 'staffId', 'date'],
  })

  return { assignment: toAdminShiftAssignment(record, staff.fullName), created: true }
}

export interface ShiftListParams {
  from?: string
  to?: string
  templateId?: string
  staffId?: string
}

export async function listShiftAssignments(
  models: { ShiftAssignment: Model<ShiftAssignmentDocument>, StaffProfile: Model<StaffProfileDocument> },
  siteId: string,
  params: ShiftListParams,
  now: Date = new Date(),
): Promise<{
  data: ShiftAssignmentAdmin[]
  range: { from: string, to: string }
  summary: { assignments: number, staff: number, days: number, workedMinutes: number }
}> {
  const today = todayInCustomerTime(now)
  const from = params.from ?? today
  const to = params.to ?? from
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    throw new HrServiceError(422, 'SHIFT_RANGE_INVALID', 'Khoảng ngày không hợp lệ (YYYY-MM-DD)')
  }
  const span = Math.round((localDayStartUtc(to).getTime() - localDayStartUtc(from).getTime()) / CUSTOMER_DAY_MS)
  if (span < 0) throw new HrServiceError(422, 'SHIFT_RANGE_INVALID', 'Ngày bắt đầu phải trước ngày kết thúc')
  if (span > MAX_LIST_DAYS) {
    throw new HrServiceError(422, 'SHIFT_RANGE_TOO_LONG', `Xem tối đa ${MAX_LIST_DAYS} ngày mỗi lần`)
  }

  const filter: Record<string, unknown> = { siteId, date: { $gte: from, $lte: to } }
  if (params.templateId) {
    if (!Types.ObjectId.isValid(params.templateId)) {
      throw new HrServiceError(422, 'SHIFT_TEMPLATE_ID_INVALID', 'Mã ca không hợp lệ')
    }
    filter.templateId = new Types.ObjectId(params.templateId)
  }
  if (params.staffId) {
    if (!Types.ObjectId.isValid(params.staffId)) {
      throw new HrServiceError(422, 'STAFF_ID_INVALID', 'Staff id is not valid')
    }
    filter.staffId = new Types.ObjectId(params.staffId)
  }

  const records = await models.ShiftAssignment.find(filter)
    .sort({ date: 1, startTime: 1, _id: 1 })
    .limit(2000)
    .lean<ShiftAssignmentRecord[]>()

  const staffIds = [...new Set(records.map(record => String(record.staffId)))]
  const staff = staffIds.length
    ? await models.StaffProfile.find({ siteId, _id: { $in: staffIds.map(id => new Types.ObjectId(id)) } })
      .select({ fullName: 1 })
      .lean<{ _id: Types.ObjectId, fullName: string }[]>()
    : []
  const names = new Map(staff.map(row => [String(row._id), row.fullName]))

  const workedMinutes = records.reduce(
    (sum, record) => sum + shiftWorkedMinutes(record.startTime, record.endTime, record.breakMinutes ?? 0),
    0,
  )

  return {
    data: records.map(record => toAdminShiftAssignment(record, names.get(String(record.staffId)) ?? null)),
    range: { from, to },
    summary: {
      assignments: records.length,
      staff: staffIds.length,
      days: new Set(records.map(record => record.date)).size,
      workedMinutes,
    },
  }
}

/**
 * Withdrawing a shift is a delete, not a soft delete: the roster is a plan, not a
 * payroll input, and a leftover "cancelled" row would keep showing a person on a
 * shift they are not on. The audit entry keeps exactly who was scheduled.
 */
export async function cancelShiftAssignment(
  model: Model<ShiftAssignmentDocument>,
  siteId: string,
  id: string,
  now: Date = new Date(),
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(id)) throw new HrServiceError(422, 'SHIFT_ASSIGNMENT_ID_INVALID', 'Phân ca không hợp lệ')
  const record = await model.findOne({ _id: new Types.ObjectId(id), siteId }).lean<ShiftAssignmentRecord | null>()
  if (!record) throw new HrServiceError(404, 'SHIFT_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy phân ca')

  const today = todayInCustomerTime(now)
  if (record.date < today) {
    throw new HrServiceError(409, 'SHIFT_ASSIGNMENT_STARTED', 'Ca đã qua, không thể huỷ', { date: record.date })
  }

  await model.deleteOne({ _id: record._id, siteId })

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'shift_assignment',
    resourceId: id,
    resourceKey: `${record.employeeCode}:${record.date}`,
    action: 'cancel',
    revision: record.revision ?? 1,
    fromStatus: record.shiftCode,
    toStatus: 'cancelled',
    changedFields: ['deleted'],
  })

  return { id }
}
