import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { AdminCategory, AdminCategoryNode } from '@tm/flow-contracts/category-admin'
import type { ContentDocument } from '../models/content'
import {
  CATEGORY_MAX_DEPTH,
  CategoryInvariantError,
  type CategoryDocument,
  normalizeCategoryInput,
} from '../models/category'
import { recordContentAudit } from './contentAudit'
import type { ContentWriteMeta } from './contentService'

/**
 * Category tree commands and queries. The service is H3-free: the API layer
 * supplies the verified site id and prepared models, tests a disposable
 * database. Every write records an audit entry in the same request.
 */

export class CategoryServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CategoryServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export type CategoryRecord = CategoryDocument & { _id: Types.ObjectId }

export interface CategoryListResult {
  data: AdminCategory[]
  tree: AdminCategoryNode[]
}

const MAX_KEY_LENGTH = 120

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

export function toAdminCategory(record: CategoryRecord): AdminCategory {
  return {
    id: String(record._id),
    siteId: record.siteId,
    key: record.key,
    parent: record.parent ?? null,
    order: record.order ?? 0,
    revision: record.revision,
    locales: (record.locales ?? []).map(entry => ({
      locale: entry.locale,
      name: entry.name,
      slug: entry.slug,
    })),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function objectId(value: unknown, code: string): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new CategoryServiceError(422, code, 'Category id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof CategoryInvariantError) {
    throw new CategoryServiceError(422, error.code, error.message)
  }
  throw error
}

function translateWriteError(error: unknown): never {
  const duplicate = error as { code?: number, keyPattern?: Record<string, unknown> }
  if (duplicate?.code === 11000) {
    const isSlug = Object.keys(duplicate.keyPattern ?? {}).includes('locales.slug')
    throw new CategoryServiceError(
      409,
      isSlug ? 'CATEGORY_SLUG_EXISTS' : 'CATEGORY_KEY_EXISTS',
      isSlug ? 'Another category already uses this locale slug' : 'Another category already uses this key',
    )
  }
  throw error
}

/**
 * Builds roots + ordered descendants from a flat list. Records whose parent is
 * missing (a database edited outside the app) are surfaced as roots instead of
 * disappearing from the editor.
 */
export function buildCategoryTree(records: AdminCategory[]): AdminCategoryNode[] {
  const children = new Map<string | null, AdminCategory[]>()
  const keys = new Set(records.map(record => record.key))

  for (const record of records) {
    const parent = record.parent && keys.has(record.parent) ? record.parent : null
    const bucket = children.get(parent) ?? []
    bucket.push(record)
    children.set(parent, bucket)
  }

  const sortBucket = (bucket: AdminCategory[]) =>
    [...bucket].sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))

  const seen = new Set<string>()
  const build = (parent: string | null, depth: number): AdminCategoryNode[] =>
    sortBucket(children.get(parent) ?? []).map((record) => {
      if (seen.has(record.key)) return { ...record, depth, children: [] }
      seen.add(record.key)
      return { ...record, depth, children: build(record.key, depth + 1) }
    })

  return build(null, 0)
}

export async function listCategories(
  model: Model<CategoryDocument>,
  siteId: string,
): Promise<CategoryListResult> {
  const records = await model
    .find({ siteId })
    .sort({ order: 1, key: 1 })
    .lean<CategoryRecord[]>()

  const data = records.map(toAdminCategory)
  return { data, tree: buildCategoryTree(data) }
}

export async function getCategory(
  model: Model<CategoryDocument>,
  siteId: string,
  id: string,
): Promise<AdminCategory> {
  const record = await model
    .findOne({ _id: objectId(id, 'CATEGORY_ID_INVALID'), siteId })
    .lean<CategoryRecord>()
  if (!record) {
    throw new CategoryServiceError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
  }
  return toAdminCategory(record)
}

/**
 * Validates a parent reference: it must exist in this site, must not be the
 * category itself, and the resulting depth must stay within the tree limit.
 */
async function assertParentAllowed(
  model: Model<CategoryDocument>,
  siteId: string,
  parentKey: string | null,
  selfKey: string | null,
): Promise<void> {
  if (!parentKey) return

  if (selfKey && parentKey === selfKey) {
    throw new CategoryServiceError(422, 'CATEGORY_CYCLE', 'A category cannot be its own parent')
  }

  let current = parentKey
  let depth = 1
  const visited = new Set<string>()

  while (current) {
    if (visited.has(current)) {
      throw new CategoryServiceError(422, 'CATEGORY_CYCLE', 'Category parent chain contains a cycle')
    }
    visited.add(current)

    const record = await model
      .findOne({ siteId, key: current })
      .select({ key: 1, parent: 1 })
      .lean<{ key: string, parent: string | null } | null>()

    if (!record) {
      throw new CategoryServiceError(422, 'CATEGORY_PARENT_NOT_FOUND', `Parent category ${current} does not exist`)
    }
    if (selfKey && record.key === selfKey) {
      throw new CategoryServiceError(422, 'CATEGORY_CYCLE', 'Moving a category under its own descendant is not allowed')
    }

    current = record.parent ?? ''
    depth += 1
    if (depth > CATEGORY_MAX_DEPTH) {
      throw new CategoryServiceError(422, 'CATEGORY_DEPTH_EXCEEDED', `Category tree depth cannot exceed ${CATEGORY_MAX_DEPTH}`)
    }
  }
}

export async function createCategory(
  model: Model<CategoryDocument>,
  siteId: string,
  input: unknown,
  meta?: ContentWriteMeta,
): Promise<AdminCategory> {
  const draft = (() => {
    try {
      return normalizeCategoryInput(input)
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  if (draft.key.length > MAX_KEY_LENGTH) {
    throw new CategoryServiceError(422, 'CATEGORY_KEY_INVALID', 'Category key is too long')
  }

  await assertParentAllowed(model, siteId, draft.parent, draft.key)

  let created
  try {
    created = await model.create({ ...draft, siteId, revision: 1 })
  } catch (error) {
    return translateWriteError(error)
  }

  const record = created.toObject() as CategoryRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'category',
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['key', 'parent', 'order', 'locales'],
  })

  return toAdminCategory(record)
}

export async function updateCategory(
  model: Model<CategoryDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: ContentWriteMeta,
): Promise<AdminCategory> {
  const body = input as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CategoryServiceError(422, 'CATEGORY_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'CATEGORY_ID_INVALID'), siteId })
    .lean<CategoryRecord>()
  if (!record) {
    throw new CategoryServiceError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
  }

  if (typeof body.key === 'string' && body.key !== record.key) {
    throw new CategoryServiceError(422, 'CATEGORY_KEY_IMMUTABLE', 'Category key cannot change after creation')
  }

  const draft = (() => {
    try {
      return normalizeCategoryInput({ ...body, siteId, key: record.key })
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertParentAllowed(model, siteId, draft.parent, record.key)

  let updated: CategoryRecord | null
  try {
    updated = await model.findOneAndUpdate(
      { _id: record._id, siteId, revision },
      {
        $set: {
          parent: draft.parent,
          order: draft.order,
          locales: draft.locales,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<CategoryRecord>()
  } catch (error) {
    return translateWriteError(error)
  }

  if (!updated) {
    throw new CategoryServiceError(
      409,
      'CATEGORY_REVISION_CONFLICT',
      'Category was changed by someone else; reload before saving',
      { expected: revision },
    )
  }

  const changedFields: string[] = []
  if ((record.parent ?? null) !== (updated.parent ?? null)) changedFields.push('parent')
  if (record.order !== updated.order) changedFields.push('order')
  if (JSON.stringify(record.locales) !== JSON.stringify(updated.locales)) changedFields.push('locales')

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'category',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields,
  })

  return toAdminCategory(updated)
}

/**
 * Deletes a leaf category that no content uses. Both guards report a conflict
 * the editor can act on, so a tree never ends up with orphaned children or
 * content pointing at a missing category.
 */
export async function deleteCategory(
  model: Model<CategoryDocument>,
  contentModel: Model<ContentDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: ContentWriteMeta,
): Promise<{ id: string, key: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new CategoryServiceError(422, 'CATEGORY_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id, 'CATEGORY_ID_INVALID'), siteId })
    .lean<CategoryRecord>()
  if (!record) {
    throw new CategoryServiceError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
  }

  const children = await model.countDocuments({ siteId, parent: record.key })
  if (children > 0) {
    throw new CategoryServiceError(409, 'CATEGORY_HAS_CHILDREN', 'Move or delete the child categories first', { children })
  }

  const inUse = await contentModel.countDocuments({ siteId, categories: record.key })
  if (inUse > 0) {
    throw new CategoryServiceError(409, 'CATEGORY_IN_USE', 'Content still uses this category', { content: inUse })
  }

  const deleted = await model.findOneAndDelete({ _id: record._id, siteId, revision }).lean<CategoryRecord | null>()
  if (!deleted) {
    throw new CategoryServiceError(409, 'CATEGORY_REVISION_CONFLICT', 'Category was changed by someone else; reload before deleting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'category',
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'delete',
    revision: record.revision + 1,
    fromStatus: null,
    toStatus: null,
    changedFields: [],
  })

  return { id: String(record._id), key: record.key }
}
