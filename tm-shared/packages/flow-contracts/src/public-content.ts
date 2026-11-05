import { z } from 'zod'

/**
 * Public content contracts shared by the Hub API, the Web BFF and the
 * storefront renderer. Only published, app-scoped content is ever represented
 * here; internal fields such as `appId`, `updatedBy` and `isDeleted` are not
 * part of the public read model.
 */

export const PUBLIC_CONTENT_TYPES = ['json', 'markdown', 'html', 'text'] as const
export type PublicContentType = typeof PUBLIC_CONTENT_TYPES[number]

export const HubPublicContentSchema = z.object({
  key: z.string().min(1).max(200),
  title: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  contentType: z.enum(PUBLIC_CONTENT_TYPES),
  data: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  version: z.number().default(1),
  updatedAt: z.string().nullable().optional(),
})
export type HubPublicContent = z.infer<typeof HubPublicContentSchema>

export const HubPublicContentListSchema = z.object({
  success: z.boolean(),
  data: z.array(HubPublicContentSchema),
  nextCursor: z.string().nullable().optional(),
})
export type HubPublicContentList = z.infer<typeof HubPublicContentListSchema>

const CONTENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Normalizes a content key and rejects traversal or unsafe characters. */
export function normalizeContentKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key || key.length > 200) return null
  if (!CONTENT_KEY_PATTERN.test(key)) return null
  if (key.includes('..') || key.endsWith('/')) return null
  return key
}

/**
 * Turns the catch-all route segments into a Hub content key.
 * Each segment is decoded once and must be a plain path segment.
 */
export function contentKeyFromPath(segments: string | string[] | null | undefined): string | null {
  const list = Array.isArray(segments)
    ? segments
    : typeof segments === 'string'
      ? segments.split('/')
      : []

  if (list.length === 0) return null

  const parts: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') return null

    let part = ''
    try {
      part = decodeURIComponent(raw)
    } catch {
      return null
    }

    if (!part || part === '.' || part === '..') return null
    if (part.includes('/') || part.includes('\\')) return null
    parts.push(part)
  }

  return normalizeContentKey(parts.join('/'))
}

/** Public URL path for a content key (always starts with a single slash). */
export function contentKeyToPath(key: string): string | null {
  const normalized = normalizeContentKey(key)
  if (!normalized) return null
  return `/${normalized.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
}

export interface PublicContentSection {
  heading?: string
  body: string
}

export type PublicContentView =
  | { kind: 'html', html: string }
  | { kind: 'markdown', markdown: string }
  | { kind: 'text', text: string }
  | { kind: 'sections', sections: PublicContentSection[] }
  | { kind: 'json', json: string }

type ContentData = Pick<HubPublicContent, 'contentType' | 'data'>

const HEADING_KEYS = ['heading', 'title', 'name'] as const
const BODY_KEYS = ['body', 'text', 'content', 'description'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function toSections(value: unknown): PublicContentSection[] | null {
  const list = Array.isArray(value) ? value : null
  if (!list?.length) return null

  const sections: PublicContentSection[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim()) sections.push({ body: item })
      continue
    }
    if (!isRecord(item)) continue

    const body = firstString(item, BODY_KEYS)
    if (!body) continue

    const heading = firstString(item, HEADING_KEYS)
    sections.push(heading ? { heading, body } : { body })
  }

  return sections.length ? sections : null
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2) ?? 'null'
  } catch {
    return ''
  }
}

/**
 * Converts a public content record into a safe render model.
 * Raw strings are never interpreted as HTML unless `contentType` is `html`.
 */
export function toPublicContentView(content: ContentData): PublicContentView {
  const { contentType, data } = content

  if (contentType === 'html') {
    if (typeof data === 'string') return { kind: 'html', html: data }
    if (isRecord(data) && typeof data.html === 'string') return { kind: 'html', html: data.html }
    return { kind: 'text', text: stringifyJson(data) }
  }

  if (contentType === 'markdown') {
    if (typeof data === 'string') return { kind: 'markdown', markdown: data }
    if (isRecord(data) && typeof data.markdown === 'string') {
      return { kind: 'markdown', markdown: data.markdown }
    }
    return { kind: 'text', text: stringifyJson(data) }
  }

  if (contentType === 'text') {
    if (typeof data === 'string') return { kind: 'text', text: data }
    if (isRecord(data) && typeof data.text === 'string') return { kind: 'text', text: data.text }
    return { kind: 'text', text: stringifyJson(data) }
  }

  // contentType === 'json'
  if (typeof data === 'string') {
    return data.trim() ? { kind: 'text', text: data } : { kind: 'json', json: '' }
  }

  if (isRecord(data)) {
    if (typeof data.html === 'string') return { kind: 'html', html: data.html }
    if (typeof data.markdown === 'string') return { kind: 'markdown', markdown: data.markdown }
    if (typeof data.text === 'string') return { kind: 'text', text: data.text }

    const sections = toSections(data.sections)
    if (sections) return { kind: 'sections', sections }

    const body = firstString(data, BODY_KEYS)
    if (body) {
      const heading = firstString(data, HEADING_KEYS)
      return { kind: 'sections', sections: [heading ? { heading, body } : { body }] }
    }
  }

  const sections = toSections(data)
  if (sections) return { kind: 'sections', sections }

  return { kind: 'json', json: stringifyJson(data) }
}
