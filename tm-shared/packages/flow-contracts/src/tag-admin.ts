import { z } from 'zod'

/**
 * Tags are stored as free text on each content record, so there is no tag
 * collection to edit. The admin surface is therefore a projection of the tags in
 * use plus one command that rewrites a tag everywhere it appears.
 */

export const ADMIN_TAG_MAX_LENGTH = 60

export const AdminTagSchema = z.object({
  name: z.string(),
  /** How many content records (any status) carry the tag. */
  count: z.number().int().nonnegative(),
})

export type AdminTag = z.infer<typeof AdminTagSchema>

/**
 * `to: null` detaches the tag instead of renaming it; renaming onto a tag that
 * already exists merges the two.
 */
export const AdminTagRenameRequestSchema = z.object({
  from: z.string().trim().min(1).max(ADMIN_TAG_MAX_LENGTH),
  to: z.string().trim().min(1).max(ADMIN_TAG_MAX_LENGTH).nullable(),
})

export type AdminTagRenameRequest = z.infer<typeof AdminTagRenameRequestSchema>

export interface AdminTagRenameResult {
  from: string
  to: string | null
  /** Records rewritten by this command. */
  updated: number
  /** Records an editor changed at the same time; re-run to include them. */
  skipped: number
}
