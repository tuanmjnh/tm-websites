import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import {
  DocumentTemplateInvariantError,
  type DocumentTemplateDocument,
  normalizeDocumentTemplateInput,
} from '../models/documentTemplate'
import { type ContentAuditMeta, recordContentAudit } from './contentAudit'

export class DocumentTemplateServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'DocumentTemplateServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type DocumentTemplateRecord = DocumentTemplateDocument & { _id: Types.ObjectId }

export interface DocumentTemplateAdmin {
  id: string
  siteId: string
  name: string
  code: string
  type: string
  isDefault: boolean
  primaryColor: string
  showLogo: boolean
  title: string
  subtitle: string
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  companyTaxCode: string
  companyWebsite: string
  showSku: boolean
  showThumbnail: boolean
  showUom: boolean
  showUnitPrice: boolean
  showDiscount: boolean
  showTotalInWords: boolean
  showBankAccounts: boolean
  terms: string
  notes: string
  showSignatures: boolean
  senderTitle: string
  receiverTitle: string
  accountantTitle: string
  isDeleted: boolean
  deletedAt: string | null
  revision: number
  createdAt: string | null
  updatedAt: string | null
}

export interface DocumentTemplateListParams {
  type?: string | null
  includeDeleted?: boolean
  cursor?: string | null
  limit?: number
}

export interface DocumentTemplateListResult {
  data: DocumentTemplateAdmin[]
  nextCursor: string | null
  hasMore: boolean
  counts: { all: number; active: number; deleted: number }
}

const RESOURCE = 'document_template'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminDocumentTemplate(record: DocumentTemplateRecord): DocumentTemplateAdmin {
  return {
    id: String(record._id),
    siteId: record.siteId,
    name: record.name,
    code: record.code,
    type: record.type ?? 'quotation',
    isDefault: record.isDefault === true,
    primaryColor: record.primaryColor ?? '#0284c7',
    showLogo: record.showLogo !== false,
    title: record.title ?? '',
    subtitle: record.subtitle ?? '',
    companyName: record.companyName ?? '',
    companyAddress: record.companyAddress ?? '',
    companyPhone: record.companyPhone ?? '',
    companyEmail: record.companyEmail ?? '',
    companyTaxCode: record.companyTaxCode ?? '',
    companyWebsite: record.companyWebsite ?? '',
    showSku: record.showSku !== false,
    showThumbnail: record.showThumbnail === true,
    showUom: record.showUom !== false,
    showUnitPrice: record.showUnitPrice !== false,
    showDiscount: record.showDiscount !== false,
    showTotalInWords: record.showTotalInWords !== false,
    showBankAccounts: record.showBankAccounts !== false,
    terms: record.terms ?? '',
    notes: record.notes ?? '',
    showSignatures: record.showSignatures !== false,
    senderTitle: record.senderTitle ?? '',
    receiverTitle: record.receiverTitle ?? '',
    accountantTitle: record.accountantTitle ?? '',
    isDeleted: record.isDeleted === true,
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new DocumentTemplateServiceError(422, code, 'Document template id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof DocumentTemplateInvariantError) {
    throw new DocumentTemplateServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number }
  if (duplicate?.code === 11000) {
    throw new DocumentTemplateServiceError(409, 'DOCUMENT_TEMPLATE_CODE_EXISTS', 'Another document template already uses this code')
  }
  throw error
}

export async function listDocumentTemplates(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  params: DocumentTemplateListParams = {},
): Promise<DocumentTemplateListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }
  if (!params.includeDeleted) filter.isDeleted = { $ne: true }
  if (params.type) filter.type = params.type
  if (params.cursor) filter._id = { $lt: objectId(params.cursor, 'DOCUMENT_TEMPLATE_CURSOR_INVALID') }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<DocumentTemplateRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  const [all, deleted] = await Promise.all([
    model.countDocuments({ siteId }),
    model.countDocuments({ siteId, isDeleted: true }),
  ])

  return {
    data: page.map(toAdminDocumentTemplate),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    hasMore,
    counts: { all: all - deleted, active: all - deleted, deleted },
  }
}

export async function getDocumentTemplate(model: Model<DocumentTemplateDocument>, siteId: string, id: string): Promise<DocumentTemplateAdmin> {
  const record = await model.findOne({ _id: objectId(id, 'DOCUMENT_TEMPLATE_ID_INVALID'), siteId }).lean<DocumentTemplateRecord>()
  if (!record) throw new DocumentTemplateServiceError(404, 'DOCUMENT_TEMPLATE_NOT_FOUND', 'Document template not found')
  return toAdminDocumentTemplate(record)
}

export async function getDefaultDocumentTemplate(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  type: string = 'quotation',
): Promise<DocumentTemplateAdmin | null> {
  const record = await model.findOne({ siteId, type, isDefault: true, isDeleted: { $ne: true } } as unknown as Parameters<typeof model.findOne>[0]).lean<DocumentTemplateRecord>()
  if (!record) {
    const fallback = await model.findOne({ siteId, type, isDeleted: { $ne: true } } as unknown as Parameters<typeof model.findOne>[0]).sort({ createdAt: 1 }).lean<DocumentTemplateRecord>()
    if (!fallback) return null
    return toAdminDocumentTemplate(fallback)
  }
  return toAdminDocumentTemplate(record)
}

export async function createDocumentTemplate(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta; actorId?: string },
): Promise<DocumentTemplateAdmin> {
  const source = (input ?? {}) as Record<string, unknown>
  const draft = (() => {
    try {
      return normalizeDocumentTemplateInput({ ...source, siteId })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let created
  try {
    created = await model.create({ ...draft, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as DocumentTemplateRecord

  if (draft.isDefault) {
    await model.updateMany({ siteId, type: draft.type, _id: { $ne: record._id } } as unknown as Parameters<typeof model.updateMany>[0], { $set: { isDefault: false } })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['name', 'code', 'type', 'isDefault'],
  })

  return toAdminDocumentTemplate(record)
}

export async function updateDocumentTemplate(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: { audit?: ContentAuditMeta },
): Promise<DocumentTemplateAdmin> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new DocumentTemplateServiceError(422, 'DOCUMENT_TEMPLATE_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'DOCUMENT_TEMPLATE_ID_INVALID'), siteId }).lean<DocumentTemplateRecord>()
  if (!record) throw new DocumentTemplateServiceError(404, 'DOCUMENT_TEMPLATE_NOT_FOUND', 'Document template not found')
  if (record.isDeleted) throw new DocumentTemplateServiceError(409, 'DOCUMENT_TEMPLATE_DELETED', 'Document template is deleted')

  const draft = (() => {
    try {
      return normalizeDocumentTemplateInput({ ...record, ...body, siteId, code: body.code ?? record.code })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  let updated: DocumentTemplateRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      { $set: { ...draft, revision: record.revision }, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    ).lean<DocumentTemplateRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new DocumentTemplateServiceError(409, 'DOCUMENT_TEMPLATE_REVISION_CONFLICT', 'Document template was changed by someone else; reload before saving', { expected: revision })
  }

  if (draft.isDefault) {
    await model.updateMany({ siteId, type: draft.type, _id: { $ne: updated._id } } as unknown as Parameters<typeof model.updateMany>[0], { $set: { isDefault: false } })
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(updated._id),
    resourceKey: updated.code,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['name', 'code', 'isDefault', 'primaryColor'],
  })

  return toAdminDocumentTemplate(updated)
}

export async function softDeleteDocumentTemplate(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<{ id: string; code: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new DocumentTemplateServiceError(422, 'DOCUMENT_TEMPLATE_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'DOCUMENT_TEMPLATE_ID_INVALID'), siteId }).lean<DocumentTemplateRecord>()
  if (!record) throw new DocumentTemplateServiceError(404, 'DOCUMENT_TEMPLATE_NOT_FOUND', 'Document template not found')

  const deleted = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<DocumentTemplateRecord | null>()

  if (!deleted) throw new DocumentTemplateServiceError(409, 'DOCUMENT_TEMPLATE_REVISION_CONFLICT', 'Document template was changed by someone else; reload before deleting')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'delete',
    revision: deleted.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return { id: String(record._id), code: record.code }
}

export async function restoreDocumentTemplate(
  model: Model<DocumentTemplateDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: { audit?: ContentAuditMeta },
): Promise<DocumentTemplateAdmin> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new DocumentTemplateServiceError(422, 'DOCUMENT_TEMPLATE_REVISION_REQUIRED', 'An integer revision is required')
  }
  const record = await model.findOne({ _id: objectId(id, 'DOCUMENT_TEMPLATE_ID_INVALID'), siteId }).lean<DocumentTemplateRecord>()
  if (!record) throw new DocumentTemplateServiceError(404, 'DOCUMENT_TEMPLATE_NOT_FOUND', 'Document template not found')

  const restored = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: false, deletedAt: null }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<DocumentTemplateRecord | null>()

  if (!restored) throw new DocumentTemplateServiceError(409, 'DOCUMENT_TEMPLATE_REVISION_CONFLICT', 'Document template was changed by someone else; reload before restoring')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: RESOURCE,
    resourceId: String(record._id),
    resourceKey: record.code,
    action: 'restore',
    revision: restored.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return toAdminDocumentTemplate(restored)
}