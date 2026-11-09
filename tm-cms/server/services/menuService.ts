import { Types } from 'mongoose'
import type { Model } from 'mongoose'
import type { AdminMenu, AdminMenuSummary } from '@tm/flow-contracts/menu-admin'
import type { AuditActor, AuditEntryDocument } from '../models/audit'
import type { CategoryDocument } from '../models/category'
import type { ContentDocument } from '../models/content'
import {
  type MenuDocument,
  type MenuItem,
  MenuInvariantError,
  normalizeMenuItems,
  normalizeMenuKey,
} from '../models/menu'
import { recordContentAudit } from './contentAudit'

/**
 * Menu commands and queries. Menus are site configuration, so the API layer
 * gates them with `configs.read` / `configs.write`, and every write records one
 * `audit_logs` entry with the actor from the verified session.
 */

export class MenuServiceError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'MenuServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export interface MenuWriteMeta {
  audit: { model: Model<AuditEntryDocument>, actor?: AuditActor, requestId?: string | null }
  /**
   * Collections a `content` / `category` link must point at. Endpoints pass them
   * so a menu cannot be saved with a target the storefront would render as a dead
   * link; the service skips the lookup when a caller (tests, future importers)
   * writes items without it.
   */
  refs?: { content: Model<ContentDocument>, category: Model<CategoryDocument> }
}

export type MenuRecord = MenuDocument & { _id: Types.ObjectId }

const NAME_MAX = 120

/**
 * Refuse targets that do not resolve inside this site. A path target is a literal
 * the editor owns, but a content key or category key is a reference: saving one
 * that matches neither a record here nor in another site's database would publish
 * a link nobody can follow. A soft-deleted page counts as missing.
 */
async function assertLinksExist(
  refs: MenuWriteMeta['refs'],
  siteId: string,
  items: MenuItem[],
): Promise<void> {
  if (!refs) return

  const contentKeys = new Set<string>()
  const categoryKeys = new Set<string>()
  for (const item of items) {
    if (item.link.type === 'content') contentKeys.add(item.link.target)
    if (item.link.type === 'category') categoryKeys.add(item.link.target)
  }
  if (contentKeys.size === 0 && categoryKeys.size === 0) return

  const [foundContent, foundCategory] = await Promise.all([
    contentKeys.size
      ? refs.content
          .find({ siteId, key: { $in: [...contentKeys] }, deletedAt: null })
          .distinct('key') as Promise<string[]>
      : Promise.resolve<string[]>([]),
    categoryKeys.size
      ? refs.category.find({ siteId, key: { $in: [...categoryKeys] } }).distinct('key') as Promise<string[]>
      : Promise.resolve<string[]>([]),
  ])

  const knownContent = new Set(foundContent)
  const knownCategory = new Set(foundCategory)
  const missing = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.link.type === 'content'
      ? !knownContent.has(item.link.target)
      : item.link.type === 'category'
        ? !knownCategory.has(item.link.target)
        : false))
    .map(({ item, index }) => ({ index, type: item.link.type, target: item.link.target }))

  if (missing.length > 0) {
    const [first] = missing
    const kind = first!.type === 'content' ? 'page' : 'category'
    throw new MenuServiceError(
      422,
      'MENU_TARGET_NOT_FOUND',
      `Item ${first!.index + 1}: no ${kind} with the key "${first!.target}" exists in this site`,
      { missing },
    )
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null
}

function itemsOf(record: MenuRecord) {
  return (record.items ?? []).map(item => ({
    label: { vi: item.label?.vi ?? '', en: item.label?.en ?? '' },
    link: { type: item.link?.type, target: item.link?.target ?? '' },
  }))
}

export function toAdminMenu(record: MenuRecord): AdminMenu {
  const items = itemsOf(record)
  return {
    id: String(record._id),
    siteId: record.siteId,
    key: record.key,
    name: record.name,
    revision: record.revision,
    items,
    itemCount: items.length,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  }
}

function toSummary(menu: AdminMenu): AdminMenuSummary {
  return {
    id: menu.id,
    siteId: menu.siteId,
    key: menu.key,
    name: menu.name,
    revision: menu.revision,
    itemCount: menu.itemCount,
    updatedAt: menu.updatedAt,
  }
}

function objectId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new MenuServiceError(422, 'MENU_ID_INVALID', 'Menu id is not valid')
  }
  return new Types.ObjectId(value)
}

function translateInvariant(error: unknown): never {
  if (error instanceof MenuInvariantError) {
    throw new MenuServiceError(422, error.code, error.message)
  }
  throw error
}

function normalizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) {
    throw new MenuServiceError(422, 'MENU_NAME_REQUIRED', 'A menu name is required')
  }
  if (name.length > NAME_MAX) {
    throw new MenuServiceError(422, 'MENU_NAME_INVALID', `The menu name is limited to ${NAME_MAX} characters`)
  }
  return name
}

export async function listMenus(
  model: Model<MenuDocument>,
  siteId: string,
): Promise<AdminMenuSummary[]> {
  const records = await model
    .find({ siteId })
    .sort({ key: 1 })
    .lean<MenuRecord[]>()
  return records.map(record => toSummary(toAdminMenu(record)))
}

export async function getMenu(
  model: Model<MenuDocument>,
  siteId: string,
  id: string,
): Promise<AdminMenu> {
  const record = await model
    .findOne({ _id: objectId(id), siteId })
    .lean<MenuRecord | null>()
  if (!record) {
    throw new MenuServiceError(404, 'MENU_NOT_FOUND', 'Menu not found')
  }
  return toAdminMenu(record)
}

export async function createMenu(
  model: Model<MenuDocument>,
  siteId: string,
  input: unknown,
  meta?: MenuWriteMeta,
): Promise<AdminMenu> {
  const body = (input ?? {}) as Record<string, unknown>

  const key = (() => {
    try {
      return normalizeMenuKey(body.key)
    } catch (error) {
      return translateInvariant(error)
    }
  })()
  const name = normalizeName(body.name)
  const items = (() => {
    try {
      return body.items === undefined ? [] : normalizeMenuItems(body.items)
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertLinksExist(meta?.refs, siteId, items)

  let created
  try {
    created = await model.create({ siteId, key, name, items, revision: 1 })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new MenuServiceError(409, 'MENU_KEY_EXISTS', 'Another menu already uses this key')
    }
    throw error
  }

  const record = created.toObject() as MenuRecord

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'menu',
    resourceId: String(record._id),
    resourceKey: record.key,
    action: 'create',
    revision: record.revision,
    fromStatus: null,
    toStatus: null,
    changedFields: ['key', 'name', 'items'],
  })

  return toAdminMenu(record)
}

export async function updateMenu(
  model: Model<MenuDocument>,
  siteId: string,
  id: string,
  input: unknown,
  meta?: MenuWriteMeta,
): Promise<AdminMenu> {
  const body = (input ?? {}) as Record<string, unknown>
  const revision = Number(body.revision)
  if (!Number.isInteger(revision) || revision < 1) {
    throw new MenuServiceError(422, 'MENU_REVISION_REQUIRED', 'An integer revision is required')
  }

  const record = await model
    .findOne({ _id: objectId(id), siteId })
    .lean<MenuRecord | null>()
  if (!record) {
    throw new MenuServiceError(404, 'MENU_NOT_FOUND', 'Menu not found')
  }

  if (typeof body.key === 'string' && body.key !== record.key) {
    throw new MenuServiceError(422, 'MENU_KEY_IMMUTABLE', 'Menu key cannot change after creation')
  }

  const name = body.name === undefined ? record.name : normalizeName(body.name)
  const items = (() => {
    try {
      return body.items === undefined ? itemsOf(record) : normalizeMenuItems(body.items)
    } catch (error) {
      return translateInvariant(error)
    }
  })()

  await assertLinksExist(meta?.refs, siteId, items)

  const changedFields: string[] = []
  if (name !== record.name) changedFields.push('name')
  if (JSON.stringify(items) !== JSON.stringify(itemsOf(record))) changedFields.push('items')

  if (changedFields.length === 0) {
    throw new MenuServiceError(422, 'MENU_UPDATE_UNCHANGED', 'There is nothing to save')
  }

  const updated = await model.findOneAndUpdate(
    { _id: record._id, siteId, revision },
    { $set: { name, items }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  ).lean<MenuRecord | null>()

  if (!updated) {
    throw new MenuServiceError(
      409,
      'MENU_REVISION_CONFLICT',
      'Menu was changed by someone else; reload before saving',
      { expected: revision },
    )
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'menu',
    resourceId: String(updated._id),
    resourceKey: updated.key,
    action: 'update',
    revision: updated.revision,
    fromStatus: null,
    toStatus: null,
    changedFields,
  })

  return toAdminMenu(updated)
}

export async function deleteMenu(
  model: Model<MenuDocument>,
  siteId: string,
  id: string,
  revision: number,
  meta?: MenuWriteMeta,
): Promise<{ id: string, key: string }> {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new MenuServiceError(422, 'MENU_REVISION_REQUIRED', 'An integer revision is required')
  }

  const deleted = await model
    .findOneAndDelete({ _id: objectId(id), siteId, revision })
    .lean<MenuRecord | null>()

  if (!deleted) {
    const exists = await model.countDocuments({ _id: objectId(id), siteId })
    if (!exists) {
      throw new MenuServiceError(404, 'MENU_NOT_FOUND', 'Menu not found')
    }
    throw new MenuServiceError(409, 'MENU_REVISION_CONFLICT', 'Menu was changed by someone else; reload before deleting')
  }

  await recordContentAudit(meta?.audit, {
    siteId,
    resourceType: 'menu',
    resourceId: String(deleted._id),
    resourceKey: deleted.key,
    action: 'delete',
    revision: deleted.revision + 1,
    fromStatus: null,
    toStatus: null,
    changedFields: [],
  })

  return { id: String(deleted._id), key: deleted.key }
}
