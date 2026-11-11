import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { normalizeContentKey } from '@tm/flow-contracts/public-content'
import { z } from 'zod'

/**
 * Content is the first business domain that leaves Hub (ADR 0001). The model
 * lives in `tm-cms/server` until the shared server package question (Q11) is
 * answered; Web keeps its loose reader meanwhile. Everything here is pure or
 * connection-scoped, so both hosts can reuse it without a global model registry.
 */

export const CONTENT_SCHEMA_VERSION = 1

export const CONTENT_TYPES = ['page', 'post', 'fragment'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export const CONTENT_STATUSES = ['draft', 'scheduled', 'published', 'archived', 'deleted'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/
const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** Attribute keys may contain dots, which is why filters read them with `$getField`. */
export const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,59}$/
export const ATTRIBUTE_VALUE_MAX_LENGTH = 500
const SLUG_MAX_LENGTH = 120
const BODY_MAX_LENGTH = 200_000
/** SEO keywords are a short list per locale, not a taxonomy: tags do that job. */
export const KEYWORDS_MAX_COUNT = 20
export const KEYWORD_MAX_LENGTH = 60

export class ContentInvariantError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ContentInvariantError'
    this.code = code
  }
}

/**
 * Slugs are stored normalized so a URL never depends on the editor's casing or
 * diacritics. Vietnamese input is folded to ASCII (`đ` → `d`).
 */
export function normalizeSlug(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

/**
 * How the body is meant to be rendered. The storefront never guesses from the
 * text: an editor writing HTML says so, and a body is rendered as Markdown only
 * when the record says Markdown (both paths escape/sanitize in the Web BFF).
 */
export const CONTENT_BODY_FORMATS = ['markdown', 'html', 'text'] as const
export type ContentBodyFormat = (typeof CONTENT_BODY_FORMATS)[number]

const SeoSchema = z.object({
  title: z.string().trim().max(200).default(''),
  description: z.string().trim().max(500).default(''),
  image: z.string().trim().max(500).default(''),
})

export const ContentLocaleSchema = z.object({
  locale: z.string().regex(LOCALE_PATTERN),
  slug: z.string().regex(SLUG_PATTERN).max(SLUG_MAX_LENGTH),
  title: z.string().trim().min(1).max(200),
  excerpt: z.string().max(500).default(''),
  body: z.string().max(BODY_MAX_LENGTH).default(''),
  format: z.enum(CONTENT_BODY_FORMATS).default('markdown'),
  keywords: z.array(z.string().trim().min(1).max(KEYWORD_MAX_LENGTH)).max(KEYWORDS_MAX_COUNT).default([]),
  seo: SeoSchema.default({ title: '', description: '', image: '' }),
})

export type ContentLocale = z.infer<typeof ContentLocaleSchema>

/**
 * The draft payload an editor may submit. Status, revision, `publishedAt` and
 * `deletedAt` are server-controlled and intentionally absent here.
 */
export const ContentDraftSchema = z.object({
  siteId: z.string().regex(SITE_ID_PATTERN),
  type: z.enum(CONTENT_TYPES),
  key: z.string().min(1).max(200),
  locales: z.array(ContentLocaleSchema).min(1).max(20),
  categories: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  media: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(20).default([]),
  attributes: z
    .record(z.string().regex(ATTRIBUTE_KEY_PATTERN), z.union([z.string().max(500), z.number(), z.boolean()]))
    .default({}),
  publishAt: z.date().nullable().default(null),
  unpublishAt: z.date().nullable().default(null),
}).superRefine((draft, ctx) => {
  const seenLocales = new Set<string>()
  for (const [index, entry] of draft.locales.entries()) {
    const locale = entry.locale.toLowerCase()
    if (seenLocales.has(locale)) {
      ctx.addIssue({ code: 'custom', path: ['locales', index, 'locale'], message: `Duplicate locale ${entry.locale}` })
    }
    seenLocales.add(locale)
  }

  // Two locales may share a slug; the same locale may not, and the unique index
  // on (siteId, locale, slug) enforces this across documents too.
  const seenSlugs = new Set<string>()
  for (const [index, entry] of draft.locales.entries()) {
    const slugKey = `${entry.locale.toLowerCase()}:${entry.slug}`
    if (seenSlugs.has(slugKey)) {
      ctx.addIssue({ code: 'custom', path: ['locales', index, 'slug'], message: `Duplicate slug ${entry.slug}` })
    }
    seenSlugs.add(slugKey)
  }

  if (draft.publishAt && draft.unpublishAt && draft.unpublishAt.getTime() <= draft.publishAt.getTime()) {
    ctx.addIssue({
      code: 'custom',
      path: ['unpublishAt'],
      message: 'unpublishAt must be later than publishAt',
    })
  }
})

export type ContentDraft = z.infer<typeof ContentDraftSchema>

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toDateOrNull(value: unknown, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new ContentInvariantError('CONTENT_DATE_INVALID', `${field} is not a valid date`)
  }
  return date
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Normalizes editor input before validation: key and slugs are folded, lists
 * are de-duplicated, dates accept ISO strings from JSON boundaries. Nothing is
 * written to the database here, so it is safe to call on untrusted payloads.
 */
export function normalizeContentInput(input: unknown): ContentDraft {
  const source = readRecord(input)
  const key = normalizeContentKey(source.key)
  if (!key) {
    throw new ContentInvariantError('CONTENT_KEY_INVALID', 'Content key is missing or unsafe')
  }

  const rawLocales = Array.isArray(source.locales) ? source.locales : []
  const locales = rawLocales.map((entry) => {
    const locale = readRecord(entry)
    return {
      ...locale,
      slug: normalizeSlug(locale.slug ?? locale.title),
      keywords: uniqueStrings(locale.keywords),
    }
  })

  return ContentDraftSchema.parse({
    ...source,
    key,
    locales,
    categories: uniqueStrings(source.categories),
    tags: uniqueStrings(source.tags),
    media: uniqueStrings(source.media),
    publishAt: toDateOrNull(source.publishAt, 'publishAt'),
    unpublishAt: toDateOrNull(source.unpublishAt, 'unpublishAt'),
  })
}

export interface ContentRevisionState {
  status: ContentStatus
  locales: ContentLocale[]
  publishAt: Date | null
  unpublishAt: Date | null
  publishedAt: Date | null
  deletedAt: Date | null
  revision: number
}

export const CONTENT_EVENTS = ['publish', 'schedule', 'unpublish', 'archive', 'restore', 'delete'] as const
export type ContentEvent = (typeof CONTENT_EVENTS)[number]

const EVENT_TARGET: Record<ContentEvent, ContentStatus> = {
  publish: 'published',
  schedule: 'scheduled',
  unpublish: 'draft',
  archive: 'archived',
  restore: 'draft',
  delete: 'deleted',
}

// Archiving is reversible through a draft, never straight back to public, and a
// deleted record can only be restored — deletes stay recoverable on purpose.
const ALLOWED_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['scheduled', 'published', 'archived', 'deleted'],
  scheduled: ['published', 'draft', 'archived', 'deleted'],
  published: ['draft', 'archived', 'deleted'],
  archived: ['draft', 'deleted'],
  deleted: ['draft'],
}

/**
 * Applies one explicit publication transition. Every accepted transition bumps
 * the revision so optimistic concurrency can reject a stale editor tab.
 */
export function applyContentTransition(
  state: ContentRevisionState,
  event: ContentEvent,
  now: Date = new Date(),
): ContentRevisionState {
  const target = EVENT_TARGET[event]
  if (!ALLOWED_TRANSITIONS[state.status].includes(target)) {
    throw new ContentInvariantError(
      'CONTENT_TRANSITION_INVALID',
      `Cannot ${event} content in status ${state.status}`,
    )
  }

  if (event === 'publish') {
    if (state.publishAt && state.publishAt.getTime() > now.getTime()) {
      throw new ContentInvariantError('CONTENT_PUBLISH_AT_FUTURE', 'Scheduled content must be published by its schedule, not early')
    }
    if (!state.locales.some(entry => entry.title.trim() && entry.slug)) {
      throw new ContentInvariantError('CONTENT_LOCALE_REQUIRED', 'Content needs at least one locale with a title and slug')
    }
  }

  if (event === 'schedule' && !state.publishAt) {
    throw new ContentInvariantError('CONTENT_PUBLISH_AT_REQUIRED', 'Scheduling requires publishAt')
  }

  const next: ContentRevisionState = {
    ...state,
    status: target,
    revision: state.revision + 1,
  }

  if (event === 'publish') {
    next.publishedAt = now
  }
  if (event === 'unpublish' || event === 'delete') {
    next.publishedAt = null
  }
  if (event === 'delete') {
    next.deletedAt = now
  }
  if (event === 'restore') {
    next.deletedAt = null
  }

  return next
}

/** A record is public only while it is published inside its schedule window. */
export function isPubliclyVisible(state: ContentRevisionState, now: Date = new Date()): boolean {
  if (state.status !== 'published' || state.deletedAt) return false
  if (state.publishAt && state.publishAt.getTime() > now.getTime()) return false
  if (state.unpublishAt && state.unpublishAt.getTime() <= now.getTime()) return false
  return true
}

export interface PublicContentProjection {
  key: string
  type: ContentType
  locale: string
  slug: string
  title: string
  excerpt: string
  body: string
  format: ContentBodyFormat
  keywords: string[]
  seo: ContentLocale['seo']
  publishedAt: string | null
  updatedAt: string | null
}

export interface ContentRecordState extends ContentRevisionState {
  key: string
  type: ContentType
  updatedAt?: Date | null
}

/**
 * Positive allowlist for anything leaving the server publicly: no status, no
 * revision, no actor fields, no unpublished body.
 */
export function toPublicContent(
  record: ContentRecordState,
  locale: string,
  now: Date = new Date(),
): PublicContentProjection | null {
  if (!isPubliclyVisible(record, now)) return null

  const wanted = locale.toLowerCase()
  const entry = record.locales.find(item => item.locale.toLowerCase() === wanted)
  if (!entry) return null

  return {
    key: record.key,
    type: record.type,
    locale: entry.locale,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    format: entry.format ?? 'markdown',
    keywords: entry.keywords ?? [],
    seo: entry.seo,
    publishedAt: record.publishedAt ? record.publishedAt.toISOString() : null,
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  }
}

export interface ContentDocument {
  siteId: string
  type: ContentType
  key: string
  status: ContentStatus
  locales: ContentLocale[]
  categories: string[]
  tags: string[]
  media: string[]
  attributes: Record<string, string | number | boolean>
  publishAt: Date | null
  unpublishAt: Date | null
  publishedAt: Date | null
  deletedAt: Date | null
  revision: number
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

const ContentLocaleMongooseSchema = new Schema(
  {
    locale: { type: String, required: true },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    excerpt: { type: String, default: '' },
    body: { type: String, default: '' },
    format: { type: String, enum: CONTENT_BODY_FORMATS, default: 'markdown' },
    keywords: { type: [String], default: [] },
    seo: {
      title: { type: String, default: '' },
      description: { type: String, default: '' },
      image: { type: String, default: '' },
    },
  },
  { _id: false },
)

export const contentSchema = new Schema<ContentDocument>(
  {
    siteId: { type: String, required: true },
    type: { type: String, enum: CONTENT_TYPES, required: true },
    key: { type: String, required: true },
    status: { type: String, enum: CONTENT_STATUSES, default: 'draft', required: true },
    locales: { type: [ContentLocaleMongooseSchema], required: true },
    categories: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    media: { type: [String], default: [] },
    attributes: { type: Schema.Types.Mixed, default: {} },
    publishAt: { type: Date, default: null },
    unpublishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    revision: { type: Number, default: 1, required: true },
    schemaVersion: { type: Number, default: CONTENT_SCHEMA_VERSION, required: true },
  },
  {
    collection: 'content',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

// A soft-deleted record keeps its key: restoring must not collide, and reusing a
// published key would silently change what an old link resolves to.
contentSchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'content_site_key' })
contentSchema.index(
  { siteId: 1, 'locales.locale': 1, 'locales.slug': 1 },
  { unique: true, name: 'content_site_locale_slug' },
)
contentSchema.index({ siteId: 1, status: 1, publishedAt: -1 }, { name: 'content_site_status_published' })

/** Model factory: one registration per connection, never a global model. */
export function contentModel(connection: Connection): Model<ContentDocument> {
  const registered = connection.models.Content as Model<ContentDocument> | undefined
  if (registered) return registered
  return connection.model<ContentDocument>('Content', contentSchema, 'content')
}

/**
 * Creates missing indexes without dropping any. `syncIndexes()` would delete
 * indexes this process does not know about, which is not safe on a live
 * customer database.
 */
export async function syncContentIndexes(connection: Connection): Promise<void> {
  await contentModel(connection).createIndexes()
}
