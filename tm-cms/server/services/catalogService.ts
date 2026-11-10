import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type {
  AdminCatalogBulkResult,
  AdminCatalogBulkRow,
  AdminCatalogCategory,
  AdminCatalogItem,
  AdminCatalogStatusFilter,
} from '@tm/flow-contracts/catalog-admin'
import type {
  CatalogCategoryDocument,
  CatalogEvent,
  CatalogItemDocument,
  CatalogItemStatus,
  CatalogItemType,
} from '../models/catalog'
import {
  buildFullPath,
  buildSearchString,
  CATALOG_ITEM_TYPES,
  normalizeCatalogCategoryInput,
  normalizeCatalogItemInput,
} from '../models/catalog'
import { diffFields, recordContentAudit, type ContentAuditMeta } from './contentAudit'

/**
 * Catalog commands and admin queries. No H3 here: the API layer resolves the
 * site and the verified actor, tests use a disposable database. Every query is
 * scoped by `siteId` first.
 */

export class CatalogServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CatalogServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type CatalogItemRecord = CatalogItemDocument & { _id: Types.ObjectId }
export type CatalogCategoryRecord = CatalogCategoryDocument & { _id: Types.ObjectId }

export interface CatalogItemListParams {
  status?: AdminCatalogStatusFilter
  type?: CatalogItemType
  q?: string
  tag?: string
  category?: string
  cursor?: string
  limit?: number
}

export interface CatalogItemListResult {
  data: AdminCatalogItem[]
  nextCursor: string | null
  counts: Record<AdminCatalogStatusFilter, number>
  hasMore: boolean
}

export interface CatalogWriteMeta {
  audit?: ContentAuditMeta
}

const STATUSES: CatalogItemStatus[] = ['draft', 'published', 'archived', 'deleted']
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const SEARCH_MAX = 80
const TAG_MAX = 60

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function objectId(value: unknown, code: string): Types.ObjectId {
  const text = String(value ?? '')
  if (!Types.ObjectId.isValid(text)) {
    throw new CatalogServiceError(422, code, 'The identifier is not valid')
  }
  return new Types.ObjectId(text)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function translateInvariant(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    throw new CatalogServiceError(422, String((error as { code: unknown }).code), String((error as { message: unknown }).message))
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const code = (error as { code?: number })?.code
  if (code === 11000) {
    throw new CatalogServiceError(409, 'CATALOG_KEY_EXISTS', 'Another record already uses this key or slug')
  }
  throw error
}

export function toAdminCatalogItem(record: CatalogItemRecord): AdminCatalogItem {
  return {
    id: String(record._id),
    siteId: record.siteId,
    key: record.key,
    status: record.status,
    type: record.type,
    title: record.title ?? {},
    slug: record.slug ?? {},
    shortDesc: record.shortDesc ?? {},
    description: record.description ?? {},
    thumbnail: record.thumbnail ?? null,
    gallery: record.gallery ?? [],
    basePrice: record.basePrice ?? 0,
    salePrice: record.salePrice ?? null,
    sku: record.sku ?? '',
    uom: record.uom ?? '',
    stock: record.stock ?? 0,
    manageStock: record.manageStock !== false,
    categories: (record.categories ?? []).map(String),
    tags: record.tags ?? [],
    attributes: record.attributes ?? [],
    variants: record.variants ?? [],
    seo: {
      title: record.seo?.title ?? {},
      description: record.seo?.description ?? {},
      image: record.seo?.image ?? '',
    },
    publishedAt: iso(record.publishedAt),
    deletedAt: iso(record.deletedAt),
    revision: record.revision,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

export function toAdminCatalogCategory(record: CatalogCategoryRecord, itemCount = 0): AdminCatalogCategory {
  return {
    id: String(record._id),
    siteId: record.siteId,
    key: record.key,
    parent: record.parent ? String(record.parent) : null,
    order: record.order ?? 0,
    title: record.title ?? {},
    slug: record.slug ?? {},
    fullPath: record.fullPath ?? {},
    description: record.description ?? {},
    thumbnail: record.thumbnail ?? null,
    revision: record.revision,
    itemCount,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

/** Item categories are stored as ids, so the editor's keys are resolved once, per site. */
async function resolveCategoryIds(
  model: Model<CatalogCategoryDocument>,
  siteId: string,
  keys: string[],
): Promise<Types.ObjectId[]> {
  if (!keys.length) return []
  const unique = [...new Set(keys)]
  const records = await model
    .find({ siteId, key: { $in: unique }, isDeleted: { $ne: true } }, '_id key')
    .lean<{ _id: Types.ObjectId, key: string }[]>()

  if (records.length !== unique.length) {
    const found = new Set(records.map(record => record.key))
    throw new CatalogServiceError(422, 'CATALOG_CATEGORY_NOT_FOUND', 'A selected category does not exist', {
      missing: unique.filter(key => !found.has(key)),
    })
  }
  return records.map(record => record._id)
}

async function categoryKeysById(
  model: Model<CatalogCategoryDocument>,
  siteId: string,
  ids: Types.ObjectId[],
): Promise<string[]> {
  if (!ids.length) return []
  const records = await model
    .find({ siteId, _id: { $in: ids } }, '_id key')
    .lean<{ _id: Types.ObjectId, key: string }[]>()
  return records.map(record => record.key)
}

export async function listCatalogItems(
  model: Model<CatalogItemDocument>,
  categoryModel: Model<CatalogCategoryDocument>,
  siteId: string,
  params: CatalogItemListParams = {},
): Promise<CatalogItemListResult> {
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const filter: Record<string, unknown> = { siteId }

  if (params.status && params.status !== 'all') filter.status = params.status
  if (params.type) filter.type = params.type

  const tag = (params.tag ?? '').trim().slice(0, TAG_MAX)
  if (tag) filter.tags = tag

  if (params.category) {
    const id = Types.ObjectId.isValid(params.category) ? new Types.ObjectId(params.category) : null
    if (!id) {
      // A key filter also covers the subtree, the same way the public listing does.
      const root = await categoryModel.findOne({ siteId, key: params.category, isDeleted: { $ne: true } }, '_id').lean()
      if (!root) {
        return {
          data: [],
          nextCursor: null,
          counts: await statusCounts(model, siteId),
          hasMore: false,
        }
      }
      const descendants = await categoryModel
        .find({ siteId, ancestors: (root as { _id: Types.ObjectId })._id }, '_id')
        .lean<{ _id: Types.ObjectId }[]>()
      filter.categories = { $in: [(root as { _id: Types.ObjectId })._id, ...descendants.map(entry => entry._id)] }
    } else {
      filter.categories = id
    }
  }

  const search = (params.q ?? '').trim().slice(0, SEARCH_MAX)
  if (search) {
    const pattern = new RegExp(escapeRegExp(search), 'i')
    filter.$or = [
      { key: pattern },
      { 'title.vi': pattern },
      { 'title.en': pattern },
      { 'slug.vi': pattern },
      { sku: pattern },
    ]
  }

  if (params.cursor) {
    filter._id = { $lt: objectId(params.cursor, 'CATALOG_CURSOR_INVALID') }
  }

  const records = await model.find(filter).sort({ _id: -1 }).limit(limit + 1).lean<CatalogItemRecord[]>()
  const hasMore = records.length > limit
  const page = hasMore ? records.slice(0, limit) : records

  return {
    data: page.map(toAdminCatalogItem),
    nextCursor: hasMore ? String(page[page.length - 1]!._id) : null,
    counts: await statusCounts(model, siteId),
    hasMore,
  }
}

async function statusCounts(
  model: Model<CatalogItemDocument>,
  siteId: string,
): Promise<Record<AdminCatalogStatusFilter, number>> {
  const grouped = await model.aggregate<{ _id: CatalogItemStatus, count: number }>([
    { $match: { siteId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])

  const counts: Record<AdminCatalogStatusFilter, number> = {
    all: 0,
    draft: 0,
    published: 0,
    archived: 0,
    deleted: 0,
  }
  for (const entry of grouped) {
    if (STATUSES.includes(entry._id)) {
      counts[entry._id] = entry.count
      counts.all += entry.count
    }
  }
  return counts
}

export async function getCatalogItem(
  model: Model<CatalogItemDocument>,
  siteId: string,
  id: string,
): Promise<AdminCatalogItem> {
  const record = await model.findOne({ _id: objectId(id, 'CATALOG_ID_INVALID'), siteId }).lean<CatalogItemRecord>()
  if (!record) throw new CatalogServiceError(404, 'CATALOG_ITEM_NOT_FOUND', 'Catalog item not found')
  return toAdminCatalogItem(record)
}

export async function createCatalogItem(
  model: Model<CatalogItemDocument>,
  categoryModel: Model<CatalogCategoryDocument>,
  siteId: string,
  input: unknown,
  meta?: CatalogWriteMeta,
): Promise<AdminCatalogItem> {
  let draft
  try {
    draft = normalizeCatalogItemInput(input)
  } catch (error) {
    return translateInvariant(error)
  }

  const categories = await resolveCategoryIds(categoryModel, siteId, draft.categories)

  let created
  try {
    created = await model.create({
      ...draft,
      siteId,
      categories,
      status: 'draft',
      isActive: false,
      isDeleted: false,
      publishedAt: null,
      deletedAt: null,
      revision: 1,
      searchString: buildSearchString(draft),
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as CatalogItemRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_item',
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: record.status,
    changedFields: ['key', 'title', 'basePrice', 'categories'],
  })

  return toAdminCatalogItem(record)
}

export async function updateCatalogItem(
  model: Model<CatalogItemDocument>,
  categoryModel: Model<CatalogCategoryDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: CatalogWriteMeta,
): Promise<AdminCatalogItem> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CatalogServiceError(422, 'CATALOG_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CATALOG_ID_INVALID'), siteId }).lean<CatalogItemRecord>()
  if (!record) throw new CatalogServiceError(404, 'CATALOG_ITEM_NOT_FOUND', 'Catalog item not found')

  if (typeof body.key === 'string' && body.key !== record.key) {
    throw new CatalogServiceError(422, 'CATALOG_KEY_IMMUTABLE', 'Catalog key cannot change after creation')
  }

  let draft
  try {
    draft = normalizeCatalogItemInput({ ...body, key: record.key })
  } catch (error) {
    return translateInvariant(error)
  }

  const categories = await resolveCategoryIds(categoryModel, siteId, draft.categories)

  let updated: CatalogItemRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          type: draft.type,
          title: draft.title,
          slug: draft.slug,
          shortDesc: draft.shortDesc,
          description: draft.description,
          thumbnail: draft.thumbnail,
          gallery: draft.gallery,
          basePrice: draft.basePrice,
          salePrice: draft.salePrice,
          sku: draft.sku,
          uom: draft.uom,
          stock: draft.stock,
          manageStock: draft.manageStock,
          categories,
          tags: draft.tags,
          attributes: draft.attributes,
          variants: draft.variants,
          seo: draft.seo,
          searchString: buildSearchString(draft),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<CatalogItemRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new CatalogServiceError(
      409,
      'CATALOG_REVISION_CONFLICT',
      'Catalog item was changed by someone else; reload before saving',
      { expected: revision },
    )
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_item',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'update',
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: diffFields(record, draft),
  })

  return toAdminCatalogItem(updated)
}

/**
 * Status changes. `delete`/`restore` are soft: the storefront filter needs the
 * record to keep existing for a link to 404 instead of resolving to nothing.
 */
export async function runCatalogItemEvent(
  model: Model<CatalogItemDocument>,
  siteId: string,
  id: string,
  input: { event: CatalogEvent, revision: number },
  meta?: CatalogWriteMeta,
  now: Date = new Date(),
): Promise<AdminCatalogItem> {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new CatalogServiceError(422, 'CATALOG_REVISION_REQUIRED', 'An integer revision is required')
  }
  if (!['publish', 'archive', 'restore', 'delete'].includes(input.event)) {
    throw new CatalogServiceError(422, 'CATALOG_EVENT_INVALID', 'Unknown catalog event')
  }

  const record = await model.findOne({ _id: objectId(id, 'CATALOG_ID_INVALID'), siteId }).lean<CatalogItemRecord>()
  if (!record) throw new CatalogServiceError(404, 'CATALOG_ITEM_NOT_FOUND', 'Catalog item not found')

  const update: Record<string, unknown> = {}
  let toStatus: CatalogItemStatus = record.status

  switch (input.event) {
    case 'publish':
      if (record.status === 'deleted') {
        throw new CatalogServiceError(409, 'CATALOG_DELETED', 'Restore the item before publishing it')
      }
      toStatus = 'published'
      update.publishedAt = record.publishedAt ?? now
      update.isActive = true
      break
    case 'archive':
      toStatus = 'archived'
      update.isActive = false
      break
    case 'restore':
      if (record.status !== 'deleted') {
        throw new CatalogServiceError(409, 'CATALOG_NOT_DELETED', 'Only a deleted item can be restored')
      }
      toStatus = 'draft'
      update.deletedAt = null
      update.isDeleted = false
      update.isActive = false
      break
    case 'delete':
      toStatus = 'deleted'
      update.deletedAt = now
      update.isDeleted = true
      update.isActive = false
      break
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision: input.revision },
    { $set: { ...update, status: toStatus }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CatalogItemRecord>()

  if (!updated) {
    throw new CatalogServiceError(409, 'CATALOG_REVISION_CONFLICT', 'Catalog item was changed by someone else; reload before saving')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_item',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: input.event,
    revision: updated.revision,
    fromStatus: record.status,
    toStatus: updated.status,
    changedFields: ['status'],
  })

  return toAdminCatalogItem(updated)
}

export async function listCatalogCategories(
  model: Model<CatalogCategoryDocument>,
  itemModel: Model<CatalogItemDocument>,
  siteId: string,
): Promise<AdminCatalogCategory[]> {
  const records = await model
    .find({ siteId, isDeleted: { $ne: true } })
    .sort({ order: 1, 'title.vi': 1 })
    .lean<CatalogCategoryRecord[]>()

  const grouped = await itemModel.aggregate<{ _id: Types.ObjectId, count: number }>([
    { $match: { siteId, isDeleted: { $ne: true } } },
    { $unwind: '$categories' },
    { $group: { _id: '$categories', count: { $sum: 1 } } },
  ])
  const counts = new Map(grouped.map(entry => [String(entry._id), entry.count]))

  return records.map(record => toAdminCatalogCategory(record, counts.get(String(record._id)) ?? 0))
}

/**
 * Recomputes `ancestors`, `fullPath` and the ordering mirrors for a category and
 * every descendant. A moved branch must not keep the old URL prefix.
 */
async function refreshSubtree(
  model: Model<CatalogCategoryDocument>,
  siteId: string,
  rootId: Types.ObjectId,
): Promise<void> {
  const all = await model.find({ siteId, isDeleted: { $ne: true } }).lean<CatalogCategoryRecord[]>()
  const byId = new Map(all.map(record => [String(record._id), record]))

  async function walk(id: string, ancestors: Types.ObjectId[]): Promise<void> {
    const record = byId.get(id)
    if (!record) return

    const parent = ancestors.length ? byId.get(String(ancestors[ancestors.length - 1])) : null
    const parentPath = parent?.fullPath ?? {}
    const fullPath = buildFullPath(record.slug ?? {}, parentPath)

    await model.updateOne(
      { _id: record._id, siteId },
      { $set: { ancestors, fullPath, displayOrder: record.order ?? 0, pid: record.parent ?? null } },
    )
    byId.set(id, { ...record, ancestors, fullPath })

    for (const child of all.filter(entry => entry.parent && String(entry.parent) === id)) {
      await walk(String(child._id), [...ancestors, record._id])
    }
  }

  await walk(String(rootId), byId.get(String(rootId))?.ancestors ?? [])
}

export async function createCatalogCategory(
  model: Model<CatalogCategoryDocument>,
  siteId: string,
  input: unknown,
  meta?: CatalogWriteMeta,
): Promise<AdminCatalogCategory> {
  let draft
  try {
    draft = normalizeCatalogCategoryInput(input)
  } catch (error) {
    return translateInvariant(error)
  }

  let parentId: Types.ObjectId | null = null
  let ancestors: Types.ObjectId[] = []
  let parentPath: Record<string, string> = {}

  if (draft.parent) {
    const parent = await model
      .findOne({ siteId, key: draft.parent, isDeleted: { $ne: true } })
      .lean<CatalogCategoryRecord>()
    if (!parent) {
      throw new CatalogServiceError(422, 'CATALOG_PARENT_NOT_FOUND', 'The parent category does not exist')
    }
    parentId = parent._id
    ancestors = [...(parent.ancestors ?? []), parent._id]
    parentPath = parent.fullPath ?? {}
  }

  let created
  try {
    created = await model.create({
      ...draft,
      siteId,
      parent: parentId,
      pid: parentId,
      ancestors,
      displayOrder: draft.order,
      fullPath: buildFullPath(draft.slug, parentPath),
      isDeleted: false,
      deletedAt: null,
      revision: 1,
    })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as CatalogCategoryRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_category',
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: 'draft',
    changedFields: ['key', 'parent', 'title'],
  })

  return toAdminCatalogCategory(record, 0)
}

export async function updateCatalogCategory(
  model: Model<CatalogCategoryDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: CatalogWriteMeta,
): Promise<AdminCatalogCategory> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CatalogServiceError(422, 'CATALOG_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model.findOne({ _id: objectId(id, 'CATALOG_ID_INVALID'), siteId }).lean<CatalogCategoryRecord>()
  if (!record) throw new CatalogServiceError(404, 'CATALOG_CATEGORY_NOT_FOUND', 'Catalog category not found')

  if (typeof body.key === 'string' && body.key !== record.key) {
    throw new CatalogServiceError(422, 'CATALOG_KEY_IMMUTABLE', 'Catalog key cannot change after creation')
  }

  let draft
  try {
    draft = normalizeCatalogCategoryInput({ ...body, key: record.key })
  } catch (error) {
    return translateInvariant(error)
  }

  let parentId: Types.ObjectId | null = null
  let ancestors: Types.ObjectId[] = []
  let parentPath: Record<string, string> = {}

  if (draft.parent) {
    if (draft.parent === record.key) {
      throw new CatalogServiceError(422, 'CATALOG_PARENT_INVALID', 'A category cannot be its own parent')
    }
    const parent = await model
      .findOne({ siteId, key: draft.parent, isDeleted: { $ne: true } })
      .lean<CatalogCategoryRecord>()
    if (!parent) {
      throw new CatalogServiceError(422, 'CATALOG_PARENT_NOT_FOUND', 'The parent category does not exist')
    }
    // A move into an own descendant would detach the branch from the tree.
    if ((parent.ancestors ?? []).some(ancestor => String(ancestor) === String(record._id))) {
      throw new CatalogServiceError(422, 'CATALOG_PARENT_CYCLE', 'A category cannot move inside its own subtree')
    }
    parentId = parent._id
    ancestors = [...(parent.ancestors ?? []), parent._id]
    parentPath = parent.fullPath ?? {}
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    {
      $set: {
        parent: parentId,
        pid: parentId,
        ancestors,
        order: draft.order,
        displayOrder: draft.order,
        title: draft.title,
        slug: draft.slug,
        fullPath: buildFullPath(draft.slug, parentPath),
        description: draft.description,
        thumbnail: draft.thumbnail,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: 'after' },
  ).lean<CatalogCategoryRecord>()

  if (!updated) {
    throw new CatalogServiceError(409, 'CATALOG_REVISION_CONFLICT', 'Catalog category was changed by someone else; reload before saving')
  }

  await refreshSubtree(model, siteId, updated._id)

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_category',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: diffFields(record, draft),
  })

  const refreshed = await model.findOne({ _id: updated._id, siteId }).lean<CatalogCategoryRecord>()
  return toAdminCatalogCategory(refreshed ?? updated)
}

/** Soft delete only: a child category or a live item referencing it refuses the delete. */
export async function deleteCatalogCategory(
  model: Model<CatalogCategoryDocument>,
  itemModel: Model<CatalogItemDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: CatalogWriteMeta,
): Promise<{ id: string }> {
  const record = await model.findOne({ _id: objectId(id, 'CATALOG_ID_INVALID'), siteId }).lean<CatalogCategoryRecord>()
  if (!record) throw new CatalogServiceError(404, 'CATALOG_CATEGORY_NOT_FOUND', 'Catalog category not found')

  const children = await model.countDocuments({ siteId, parent: record._id, isDeleted: { $ne: true } })
  if (children > 0) {
    throw new CatalogServiceError(409, 'CATALOG_CATEGORY_HAS_CHILDREN', 'Move or delete the child categories first', {
      children,
    })
  }

  const items = await itemModel.countDocuments({ siteId, categories: record._id, isDeleted: { $ne: true } })
  if (items > 0) {
    throw new CatalogServiceError(409, 'CATALOG_CATEGORY_IN_USE', 'Items still use this category', { items })
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<CatalogCategoryRecord>()

  if (!updated) {
    throw new CatalogServiceError(409, 'CATALOG_REVISION_CONFLICT', 'Catalog category was changed by someone else; reload before saving')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'catalog_category',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'delete',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['isDeleted'],
  })

  return { id: String(updated._id) }
}

/** Tags in use by this site's catalog, for the editor's filter and suggestions. */
export async function listCatalogTags(
  model: Model<CatalogItemDocument>,
  siteId: string,
): Promise<{ name: string, count: number }[]> {
  const grouped = await model.aggregate<{ _id: string, count: number }>([
    { $match: { siteId, isDeleted: { $ne: true } } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  return grouped.filter(entry => typeof entry._id === 'string' && entry._id).map(entry => ({ name: entry._id, count: entry.count }))
}

export { CATALOG_ITEM_TYPES, categoryKeysById }

export interface CatalogBulkPatchRow {
  id: string
  revision: number
  basePrice?: number
  salePrice?: number | null
  stock?: number
}

export interface CatalogBulkPatchInput {
  items: CatalogBulkPatchRow[]
}

function bulkFailure(id: string, code: string, message: string): AdminCatalogBulkRow {
  return { id, ok: false, revision: null, error: { code, message } }
}

/**
 * Partial price/stock update over many records. Each row keeps its own
 * optimistic-lock check and audit entry, so one stale row cannot roll back the
 * others and a retry only re-applies what still differs. A row whose patch
 * changes nothing is answered `ok` without bumping its revision, which keeps a
 * retried batch from manufacturing revisions (and conflicts) out of thin air.
 */
export async function bulkUpdateCatalogItems(
  model: Model<CatalogItemDocument>,
  siteId: string,
  input: CatalogBulkPatchInput,
  meta?: CatalogWriteMeta,
): Promise<AdminCatalogBulkResult> {
  const results: AdminCatalogBulkRow[] = []
  const seen = new Set<string>()

  for (const row of input.items) {
    if (seen.has(row.id)) {
      results.push(bulkFailure(row.id, 'CATALOG_BULK_DUPLICATE', 'The same record is listed twice in this batch'))
      continue
    }
    seen.add(row.id)

    if (!Types.ObjectId.isValid(row.id)) {
      results.push(bulkFailure(row.id, 'CATALOG_ID_INVALID', 'The identifier is not valid'))
      continue
    }

    const record = await model
      .findOne({ _id: new Types.ObjectId(row.id), siteId })
      .lean<CatalogItemRecord>()
    if (!record) {
      results.push(bulkFailure(row.id, 'CATALOG_ITEM_NOT_FOUND', 'Catalog item not found'))
      continue
    }
    if (record.revision !== row.revision) {
      results.push(bulkFailure(row.id, 'CATALOG_REVISION_CONFLICT', 'Catalog item was changed by someone else; reload before saving'))
      continue
    }

    const basePrice = row.basePrice ?? record.basePrice
    const salePrice = row.salePrice === undefined ? record.salePrice : row.salePrice
    if (salePrice !== null && salePrice > basePrice) {
      results.push(bulkFailure(row.id, 'CATALOG_SALE_PRICE_INVALID', 'salePrice cannot exceed basePrice'))
      continue
    }

    const patch: Record<string, number | null> = {}
    if (row.basePrice !== undefined && row.basePrice !== record.basePrice) patch.basePrice = row.basePrice
    if (row.salePrice !== undefined && row.salePrice !== record.salePrice) patch.salePrice = row.salePrice
    if (row.stock !== undefined && row.stock !== record.stock) patch.stock = row.stock

    if (!Object.keys(patch).length) {
      results.push({ id: row.id, ok: true, revision: record.revision, error: null })
      continue
    }

    const updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision: row.revision },
      { $set: patch, $inc: { revision: 1 } },
      { returnDocument: 'after' },
    ).lean<CatalogItemRecord>()

    if (!updated) {
      results.push(bulkFailure(row.id, 'CATALOG_REVISION_CONFLICT', 'Catalog item was changed by someone else; reload before saving'))
      continue
    }

    await recordContentAudit(meta?.audit, {
      siteId,
      resourceType: 'catalog_item',
      resourceId: String(updated._id),
      resourceKey: updated.key,
      action: 'update',
      revision: updated.revision,
      fromStatus: record.status,
      toStatus: updated.status,
      changedFields: Object.keys(patch),
    })

    results.push({ id: row.id, ok: true, revision: updated.revision, error: null })
  }

  const succeeded = results.filter(row => row.ok).length
  return { results, succeeded, failed: results.length - succeeded }
}
