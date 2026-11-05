import {
  PUBLIC_CATALOG_SORTS,
  normalizeCatalogSegment,
  type PublicCatalogQuery,
  type PublicCatalogSort,
} from '@tm/flow-contracts'

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i

function pickString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
  return ''
}

function pickInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(pickString(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function pickPrice(value: unknown): number | undefined {
  const raw = pickString(value)
  if (!raw) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

/**
 * Parses public catalog filters leniently: unknown values fall back to defaults
 * instead of failing the request, so a crawler or a stale link never produces an
 * error page. `category` accepts either a 24-char id or a slug.
 */
export function parsePublicCatalogQuery(raw: unknown): PublicCatalogQuery {
  const query = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const categoryRaw = pickString(query.category)
  const category = categoryRaw && (OBJECT_ID_PATTERN.test(categoryRaw) || normalizeCatalogSegment(categoryRaw))
    ? categoryRaw.toLowerCase()
    : undefined

  const search = pickString(query.search).slice(0, 120)
  const sortRaw = pickString(query.sort)
  const sort: PublicCatalogSort = (PUBLIC_CATALOG_SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as PublicCatalogSort)
    : 'newest'

  const minPrice = pickPrice(query.minPrice)
  const maxPrice = pickPrice(query.maxPrice)

  return {
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
    sort,
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    page: pickInt(query.page, 1, 500, 1),
    limit: pickInt(query.limit, 1, 48, 24),
  }
}
