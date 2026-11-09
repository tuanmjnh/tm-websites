import type { Model } from 'mongoose'
import type { MenuReference } from '@tm/flow-contracts/menu-admin'
import type { MenuDocument } from '../models/menu'

/**
 * Reverse lookup for the menu link guards: which menus of a site point at one
 * record. Deleting a referenced page or category would leave a saved item that
 * no longer resolves, so the delete commands ask this first and name the menus
 * the editor has to change.
 */

export type { MenuReference }

/**
 * A site owns only a handful of menus, so the filter runs in JS over the whole
 * list: that walks top-level rows and their children with the same code, where a
 * query would need a nested `$elemMatch` that Mongo matches per array.
 */
export function menuLinksTo(
  items: readonly { link?: { type?: string, target?: string }, children?: readonly { link?: { type?: string, target?: string } }[] }[],
  type: 'content' | 'category',
  target: string,
): boolean {
  const matches = (link?: { type?: string, target?: string }) => link?.type === type && link?.target === target
  return items.some(item => matches(item.link) || (item.children ?? []).some(child => matches(child.link)))
}

export async function findMenuReferences(
  model: Model<MenuDocument>,
  siteId: string,
  type: 'content' | 'category',
  target: string,
): Promise<MenuReference[]> {
  const records = await model
    .find({ siteId })
    .sort({ key: 1 })
    .select('key name items')
    .lean<Array<{ _id: unknown, key: string, name: string, items?: MenuDocument['items'] }>>()

  return records
    .filter(record => menuLinksTo(record.items ?? [], type, target))
    .map(record => ({ id: String(record._id), key: record.key, name: record.name }))
}
