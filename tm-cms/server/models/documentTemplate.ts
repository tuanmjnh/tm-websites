import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const DOCUMENT_TEMPLATE_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/

export const DOCUMENT_TEMPLATE_TYPES = ['quotation'] as const
export type DocumentTemplateType = (typeof DOCUMENT_TEMPLATE_TYPES)[number]

export class DocumentTemplateInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DocumentTemplateInvariantError'
    this.code = code
  }
}

export function normalizeDocumentTemplateCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '')
}

export const DocumentTemplateDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  name: z.string().trim().min(1).max(200),
  code: z.string().regex(CODE_PATTERN).max(64),
  type: z.enum(DOCUMENT_TEMPLATE_TYPES).default('quotation'),
  isDefault: z.boolean().default(false),
  primaryColor: z.string().trim().regex(COLOR_PATTERN).default('#0284c7'),
  showLogo: z.boolean().default(true),
  title: z.string().trim().max(200).default(''),
  subtitle: z.string().trim().max(300).default(''),
  companyName: z.string().trim().max(200).default(''),
  companyAddress: z.string().trim().max(500).default(''),
  companyPhone: z.string().trim().max(60).default(''),
  companyEmail: z.string().trim().max(200).default(''),
  companyTaxCode: z.string().trim().max(60).default(''),
  companyWebsite: z.string().trim().max(300).default(''),
  showSku: z.boolean().default(true),
  showThumbnail: z.boolean().default(false),
  showUom: z.boolean().default(true),
  showUnitPrice: z.boolean().default(true),
  showDiscount: z.boolean().default(true),
  showTotalInWords: z.boolean().default(true),
  showBankAccounts: z.boolean().default(true),
  terms: z.string().trim().max(5000).default(''),
  notes: z.string().trim().max(5000).default(''),
  showSignatures: z.boolean().default(true),
  senderTitle: z.string().trim().max(120).default(''),
  receiverTitle: z.string().trim().max(120).default(''),
  accountantTitle: z.string().trim().max(120).default(''),
})

export type DocumentTemplateDraft = z.infer<typeof DocumentTemplateDraftSchema>

export interface DocumentTemplateDocument {
  siteId: string
  name: string
  code: string
  type: DocumentTemplateType
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
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeDocumentTemplateInput(input: unknown): DocumentTemplateDraft {
  const source = readRecord(input)
  const code = normalizeDocumentTemplateCode(source.code || source.name)
  try {
    return DocumentTemplateDraftSchema.parse({
      ...source,
      code: code || undefined,
    })
  } catch (error) {
    if (error instanceof DocumentTemplateInvariantError) throw error
    if (error instanceof Error && error.name === 'ZodError') {
      throw new DocumentTemplateInvariantError('DOCUMENT_TEMPLATE_PAYLOAD_INVALID', 'Document template payload is invalid')
    }
    throw error
  }
}

const DocumentTemplateMongooseSchema = new Schema<DocumentTemplateDocument>(
  {
    siteId: { type: String, required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    type: { type: String, enum: DOCUMENT_TEMPLATE_TYPES, default: 'quotation' },
    isDefault: { type: Boolean, default: false },
    primaryColor: { type: String, default: '#0284c7' },
    showLogo: { type: Boolean, default: true },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    companyName: { type: String, default: '' },
    companyAddress: { type: String, default: '' },
    companyPhone: { type: String, default: '' },
    companyEmail: { type: String, default: '' },
    companyTaxCode: { type: String, default: '' },
    companyWebsite: { type: String, default: '' },
    showSku: { type: Boolean, default: true },
    showThumbnail: { type: Boolean, default: false },
    showUom: { type: Boolean, default: true },
    showUnitPrice: { type: Boolean, default: true },
    showDiscount: { type: Boolean, default: true },
    showTotalInWords: { type: Boolean, default: true },
    showBankAccounts: { type: Boolean, default: true },
    terms: { type: String, default: '' },
    notes: { type: String, default: '' },
    showSignatures: { type: Boolean, default: true },
    senderTitle: { type: String, default: '' },
    receiverTitle: { type: String, default: '' },
    accountantTitle: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: DOCUMENT_TEMPLATE_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'crm_document_templates',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

DocumentTemplateMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'document_template_site_code' })
DocumentTemplateMongooseSchema.index({ siteId: 1, type: 1, isDefault: 1 }, { name: 'document_template_site_type_default' })
DocumentTemplateMongooseSchema.index({ siteId: 1, isDeleted: 1, createdAt: -1 }, { name: 'document_template_site_created' })

export function documentTemplateModel(connection: Connection): Model<DocumentTemplateDocument> {
  const registered = connection.models.DocumentTemplate as Model<DocumentTemplateDocument> | undefined
  if (registered) return registered
  return connection.model<DocumentTemplateDocument>('DocumentTemplate', DocumentTemplateMongooseSchema, 'crm_document_templates')
}

export async function syncDocumentTemplateIndexes(connection: Connection): Promise<void> {
  await documentTemplateModel(connection).createIndexes()
}