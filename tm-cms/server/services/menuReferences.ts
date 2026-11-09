import type { Model } from 'mongoose'
import type { MenuDocument } from '../models/menu'

/**
 * Reverse lookup for the menu link guards: which menus of a site point at one
 * record. Deleting a referenced page or category would leave a saved item that
 * no longer resolves, so the delete commands ask this first and name the menus
 * the editor has to change.
 */

export interface MenuReference {
  id: string
  key: string
  name: string
}

export async function findMenuReferences(
  model: Model<MenuDocument>,
  siteId: string,
  type: 'content' | 'category',
  target: string,
): Promise<MenuReference[]> {
  const records = await model
    .find({ siteId, items: { $elemMatch: { 'link.type': type, 'link.target': target } } })
    .sort({ key: 1 })
    .select('key name')
    .lean<Array<{ _id: unknown, key: string, name: string }>>()

  return records.map(record => ({ id: String(record._id), key: record.key, name: record.name }))
}
