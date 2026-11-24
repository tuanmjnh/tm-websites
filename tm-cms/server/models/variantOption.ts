import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { z } from 'zod'

export const VARIANT_OPTION_SCHEMA_VERSION = 1

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const VARIANT_OPTION_UI_TYPES = ['color', 'text', 'image', 'button'] as const
export type VariantOptionUiType = (typeof VARIANT_OPTION_UI_TYPES)[number]

export class VariantOptionInvariantError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'VariantOptionInvariantError'
    this.code = code
  }
}

export function normalizeVariantOptionCode(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '')
}

export const VariantOptionValueDraftSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(120),
  meta: z.string().trim().max(500).default(''),
  sort: z.number().int().min(0).default(0),
})

export const VariantOptionDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  code: z.string().regex(CODE_PATTERN).max(64),
  title: z.string().trim().min(1).max(200),
  uiType: z.enum(VARIANT_OPTION_UI_TYPES).default('text'),
  values: z.array(VariantOptionValueDraftSchema).max(200).default([]),
  sort: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
})

export type VariantOptionDraft = z.infer<typeof VariantOptionDraftSchema>

export interface VariantOptionValueDocument {
  label: string
  value: string
  meta: string
  sort: number
}

export interface VariantOptionDocument {
  siteId: string
  code: string
  title: string
  uiType: VariantOptionUiType
  values: VariantOptionValueDocument[]
  sort: number
  isActive: boolean
  isDeleted: boolean
  deletedAt: Date | null
  revision: number
  createdAt?: Date
  updatedAt?: Date
}

const VariantOptionValueSchema = new Schema<VariantOptionValueDocument>(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    value: { type: String, required: true, trim: true, maxlength: 120 },
    meta: { type: String, default: '', trim: true, maxlength: 500 },
    sort: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
)

const VariantOptionMongooseSchema = new Schema<VariantOptionDocument>(
  {
    siteId: { type: String, required: true, index: true },
    code: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    uiType: { type: String, enum: VARIANT_OPTION_UI_TYPES, default: 'text' },
    values: { type: [VariantOptionValueSchema], default: [] },
    sort: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true, collection: 'crm_variant_options' },
)

VariantOptionMongooseSchema.index({ siteId: 1, code: 1 }, { unique: true, name: 'variant_option_site_code' })
VariantOptionMongooseSchema.index({ siteId: 1, isDeleted: 1, sort: 1 }, { name: 'variant_option_site_deleted_sort' })

export function variantOptionModel(connection: Connection): Model<VariantOptionDocument> {
  const registered = connection.models.VariantOption as Model<VariantOptionDocument> | undefined
  if (registered) return registered
  return connection.model<VariantOptionDocument>('VariantOption', VariantOptionMongooseSchema, 'crm_variant_options')
}

export function syncVariantOptionIndexes(connection: Connection): Promise<void> {
  return variantOptionModel(connection).createIndexes().then(() => undefined)
}

export function normalizeVariantOptionInput(input: unknown): VariantOptionDraft {
  const source = (input ?? {}) as Record<string, unknown>
  try {
    return VariantOptionDraftSchema.parse({
      siteId: source.siteId,
      code: normalizeVariantOptionCode(source.code ?? source.title ?? ''),
      title: source.title ?? source.name ?? '',
      uiType: source.uiType ?? source.ui_type ?? 'text',
      values: Array.isArray(source.values)
        ? source.values.map((entry) => {
            const r = (entry ?? {}) as Record<string, unknown>
            return {
              label: r.label ?? r.title ?? '',
              value: r.value ?? '',
              meta: r.meta ?? r.color ?? '',
              sort: typeof r.sort === 'number' ? r.sort : 0,
            }
          })
        : [],
      sort: typeof source.sort === 'number' ? source.sort : 0,
      isActive: source.isActive !== false && source.isDeleted !== true,
    })
  } catch (error) {
    const issue = (error as { issues?: { message?: string }[] })?.issues?.[0]?.message
    throw new VariantOptionInvariantError('VARIANT_OPTION_PAYLOAD_INVALID', issue ?? 'Invalid variant option payload')
  }
}