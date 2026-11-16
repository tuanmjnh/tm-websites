import type { H3Event } from 'h3'
import type { HubTokens } from './hubClient'

/**
 * Hub rotates the refresh token on every renewal, so two renewals racing with the
 * same token are not harmless duplicates: the slower one presents a token the Hub
 * has already replaced and comes back 401, which surfaces as a random sign-out on
 * a page that fires several calls at once. Every caller waiting on the same token
 * therefore shares one renewal.
 *
 * Scope is one process. Two CMS instances still rotate independently, and closing
 * that needs a shared store or a Hub-side grace window, neither of which exists
 * yet — see the P1 open item this slice comes from.
 */

export type RenewFn<Context> = (context: Context, refreshToken: string) => Promise<HubTokens>

export interface RefreshCoordinator<Context> {
  (context: Context, refreshToken: string): Promise<HubTokens>
  /** Renewals currently shared, exposed so a test can watch the map drain. */
  pending(): number
}

export function createRefreshCoordinator<Context>(renew: RenewFn<Context>): RefreshCoordinator<Context> {
  const inFlight = new Map<string, Promise<HubTokens>>()

  const renewOnce = async (context: Context, refreshToken: string): Promise<HubTokens> => {
    const shared = inFlight.get(refreshToken)
    if (shared) return shared

    const promise = renew(context, refreshToken).finally(() => {
      // A failed renewal is not cached: the next request must be allowed to retry.
      if (inFlight.get(refreshToken) === promise) inFlight.delete(refreshToken)
    })
    inFlight.set(refreshToken, promise)

    return promise
  }

  return Object.assign(renewOnce, { pending: () => inFlight.size })
}

const renewOnce = createRefreshCoordinator<H3Event>((event, refreshToken) => hubRefresh(event, refreshToken))

/** The BFF's renewal entry point: one Hub call per token at a time. */
export function renewSessionTokens(event: H3Event, refreshToken: string): Promise<HubTokens> {
  return renewOnce(event, refreshToken)
}
