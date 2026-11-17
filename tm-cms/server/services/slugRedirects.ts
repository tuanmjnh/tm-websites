import type { Model } from 'mongoose'
import type { RedirectDocument } from '../models/redirect'

export interface SlugRedirectChange {
  from: string
  to: string
}

export interface SlugRedirectOutcome {
  /** Rows that now answer a 301, as `from -> to`. */
  created: Array<{ from: string, to: string }>
  /** Paths that already had a row, so nothing was written. */
  kept: string[]
  /** Old slugs that could not be a route, so no row was written. */
  skipped: string[]
}

/**
 * Writes one 301 per changed path. A path that already has a row is never
 * replaced: a mapping a human typed is a better answer than a generated one,
 * and the storefront follows chains.
 */
export async function writeSlugRedirects(
  model: Model<RedirectDocument>,
  siteId: string,
  changes: SlugRedirectChange[],
  note: string,
): Promise<SlugRedirectOutcome> {
  const outcome: SlugRedirectOutcome = { created: [], kept: [], skipped: [] }

  for (const change of changes) {
    if (change.from === change.to) continue
    let upserted = false
    try {
      const result = await model.updateOne(
        { siteId, from: change.from },
        {
          $setOnInsert: {
            siteId,
            from: change.from,
            to: change.to,
            statusCode: 301,
            isActive: true,
            note,
            revision: 1,
          },
        },
        { upsert: true },
      )
      upserted = result.upsertedCount > 0
    } catch (error) {
      // Another writer claimed the path between the read and this upsert; the
      // record must still save, so the row is reported as kept instead.
      const duplicate = error as { code?: number }
      if (duplicate?.code !== 11000) throw error
    }

    if (upserted) {
      outcome.created.push({ from: change.from, to: change.to })
    } else {
      outcome.kept.push(change.from)
    }
  }

  return outcome
}
