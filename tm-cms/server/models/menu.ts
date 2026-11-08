import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import type { AdminMenuItem } from '@tm/flow-contracts/menu-admin'
import {
  MENU_LABEL_MAX,
  MENU_LINK_TYPES,
  MENU_MAX_ITEMS,
  MENU_TARGET_MAX,
} from '@tm/flow-contracts/menu-admin'
import { normalizeSlug } from './content'

/**
 * Site menus. A menu is an immutable key plus an ordered item list; an item is a
 * per-locale label and exactly one link target. Targets are references (a content
 * key, a category key) or a literal path, never a resolved URL, so renaming a
 * record never rewrites menus and a locale switch only swaps the label.
 *
 * The collection is `site_menus`, not `menus`: every migrated customer database
 * already carries the legacy shop `menus` documents (no `siteId`, so they all
 * collide on the unique key), and they stay untouched until the import slice.
 */

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Content keys may carry a folder segment (`pages/dich-vu`). */
const CONTENT_TARGET_PATTERN = /^[a-z0-9][a-z0-9/-]*$/

export class MenuInvariantError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MenuInvariantError'
    this.code = code
  }
}

export interface MenuItem {
  label: { vi: string, en: string }
  link: { type: (typeof MENU_LINK_TYPES)[number], target: string }
}

export interface MenuDocument {
  siteId: string
  key: string
  name: string
  revision: number
  items: MenuItem[]
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

function readRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** The key is human-readable and immutable, so it is folded once at creation. */
export function normalizeMenuKey(value: unknown): string {
  const key = normalizeSlug(value)
  if (!key || !KEY_PATTERN.test(key)) {
    throw new MenuInvariantError('MENU_KEY_INVALID', 'Menu key is missing or unsafe')
  }
  return key
}

function assertTarget(type: MenuItem['link']['type'], target: string, index: number): void {
  if (type === 'content' && !CONTENT_TARGET_PATTERN.test(target)) {
    throw new MenuInvariantError('MENU_TARGET_INVALID', `Item ${index + 1}: the content key looks invalid`)
  }
  if (type === 'category' && !KEY_PATTERN.test(target)) {
    throw new MenuInvariantError('MENU_TARGET_INVALID', `Item ${index + 1}: the category key looks invalid`)
  }
  if (type === 'url') {
    const absolute = /^https?:\/\/[^\s]+$/.test(target)
    const rootedPath = target.startsWith('/') && !target.startsWith('//')
    if (!absolute && !rootedPath) {
      throw new MenuInvariantError('MENU_TARGET_INVALID', `Item ${index + 1}: use a path starting with "/" or a full URL`)
    }
  }
}

/**
 * Editor input normalization: labels are trimmed, empty ones are dropped, and
 * the target is checked against its link type. One bad item fails the whole save
 * so a menu is never half-written.
 */
export function normalizeMenuItem(input: unknown, index = 0): AdminMenuItem {
  const source = readRecord(input)
  const label = readRecord(source.label)
  const link = readRecord(source.link)

  const vi = typeof label.vi === 'string' ? label.vi.trim() : ''
  const en = typeof label.en === 'string' ? label.en.trim() : ''
  if (!vi && !en) {
    throw new MenuInvariantError('MENU_LABEL_REQUIRED', `Item ${index + 1}: at least one label is required`)
  }
  if (vi.length > MENU_LABEL_MAX || en.length > MENU_LABEL_MAX) {
    throw new MenuInvariantError('MENU_LABEL_INVALID', `Item ${index + 1}: labels are limited to ${MENU_LABEL_MAX} characters`)
  }

  const rawType = typeof link.type === 'string' ? link.type : ''
  if (!(MENU_LINK_TYPES as readonly string[]).includes(rawType)) {
    throw new MenuInvariantError('MENU_LINK_TYPE_INVALID', `Item ${index + 1}: unknown link type`)
  }

  const target = typeof link.target === 'string' ? link.target.trim() : ''
  if (!target) {
    throw new MenuInvariantError('MENU_TARGET_REQUIRED', `Item ${index + 1}: a link target is required`)
  }
  if (target.length > MENU_TARGET_MAX) {
    throw new MenuInvariantError('MENU_TARGET_INVALID', `Item ${index + 1}: the target is limited to ${MENU_TARGET_MAX} characters`)
  }

  const type = rawType as MenuItem['link']['type']
  assertTarget(type, target, index)

  return { label: { vi, en }, link: { type, target } }
}

export function normalizeMenuItems(input: unknown): AdminMenuItem[] {
  const list = Array.isArray(input) ? input : []
  if (list.length > MENU_MAX_ITEMS) {
    throw new MenuInvariantError('MENU_ITEMS_LIMIT', `A menu holds at most ${MENU_MAX_ITEMS} items`)
  }
  return list.map((entry, index) => normalizeMenuItem(entry, index))
}

const LabelMongooseSchema = new Schema(
  {
    vi: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  { _id: false },
)

const LinkMongooseSchema = new Schema(
  {
    type: { type: String, enum: MENU_LINK_TYPES, required: true },
    target: { type: String, required: true },
  },
  { _id: false },
)

const MenuItemMongooseSchema = new Schema(
  {
    label: { type: LabelMongooseSchema, required: true },
    link: { type: LinkMongooseSchema, required: true },
  },
  { _id: false },
)

export const menuSchema = new Schema<MenuDocument>(
  {
    siteId: { type: String, required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    revision: { type: Number, default: 1, required: true },
    items: { type: [MenuItemMongooseSchema], default: () => [] },
    schemaVersion: { type: Number, default: 1, required: true },
  },
  {
    collection: 'site_menus',
    timestamps: true,
    versionKey: false,
    minimize: false,
  },
)

/** One menu per key per site: the unique index is the create-time guard. */
menuSchema.index({ siteId: 1, key: 1 }, { unique: true, name: 'menu_site_key' })

export function menuModel(connection: Connection): Model<MenuDocument> {
  const registered = connection.models.Menu as Model<MenuDocument> | undefined
  if (registered) return registered
  return connection.model<MenuDocument>('Menu', menuSchema, 'site_menus')
}

export async function syncMenuIndexes(connection: Connection): Promise<void> {
  await menuModel(connection).createIndexes()
}
