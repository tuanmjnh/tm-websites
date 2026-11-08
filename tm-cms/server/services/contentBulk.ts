import type { Model } from 'mongoose'
import type {
  AdminContentBulkAction,
  AdminContentBulkResult,
  AdminContentBulkRow,
} from '@tm/flow-contracts/content-admin'
import type { ContentDocument } from '../models/content'
import { ContentServiceError, runContentEvent, type ContentWriteMeta } from './contentService'

/**
 * Bulk commands are a loop over the single-record transition, not a second
 * implementation of it: each row keeps its own optimistic-lock check, its audit
 * entry and its revision snapshot, and one bad row cannot roll back the others.
 * Retrying the same batch is safe because the state machine refuses a transition
 * that already happened instead of applying it twice.
 */

export const BULK_MAX_ITEMS = 50

export interface BulkContentItem {
  id: string
  revision: number
}

export interface BulkContentInput {
  action: AdminContentBulkAction
  items: BulkContentItem[]
}

function failure(id: string, code: string, message: string): AdminContentBulkRow {
  return { id, ok: false, status: null, revision: null, error: { code, message } }
}

export async function runBulkContentCommand(
  model: Model<ContentDocument>,
  siteId: string,
  input: BulkContentInput,
  now: Date = new Date(),
  meta?: ContentWriteMeta,
): Promise<AdminContentBulkResult> {
  const results: AdminContentBulkRow[] = []
  const seen = new Set<string>()

  for (const item of input.items) {
    if (seen.has(item.id)) {
      results.push(failure(item.id, 'CONTENT_BULK_DUPLICATE', 'The same record is listed twice in this batch'))
      continue
    }
    seen.add(item.id)

    try {
      const updated = await runContentEvent(
        model,
        siteId,
        item.id,
        { event: input.action, revision: item.revision },
        now,
        meta,
      )
      results.push({ id: item.id, ok: true, status: updated.status, revision: updated.revision, error: null })
    } catch (error) {
      // A row failure is data the editor sees per record, never a 500. Unknown
      // errors still propagate: a broken database must not look like a refusal.
      if (!(error instanceof ContentServiceError)) throw error
      results.push(failure(item.id, error.code, error.message))
    }
  }

  const succeeded = results.filter(row => row.ok).length
  return { action: input.action, results, succeeded, failed: results.length - succeeded }
}
