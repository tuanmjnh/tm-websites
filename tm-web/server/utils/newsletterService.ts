import { createHash, randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { newsletterRecipientName, type NewsletterSubscribeRequest } from '@tm/flow-contracts'
import { PublicNewsletterModel } from '#server/models/newsletterPublic'
import { CheckoutError, resolveSiteId } from './checkoutService'
import { queueStorefrontMail } from './mailQueue'
import { withSiteDb } from './mongo'

/**
 * Newsletter signup from the storefront.
 *
 * Double opt-in only: a signup stores a `pending` subscription and queues one
 * confirmation mail. The token is hashed in the database and never returned to
 * the browser, so typing an address cannot confirm it. A store that has not
 * defined the confirmation template (or its public URL) still records the
 * pending signup, and the caller is told no mail went out instead of the form
 * claiming one did.
 *
 * The pending row is written with an upsert so two concurrent signups for the
 * same address race on the unique `(siteId, email)` index instead of both
 * inserting and one failing with a duplicate-key 500.
 */

export const NEWSLETTER_CONFIRM_TEMPLATE = 'newsletter-confirm'

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type SubscribeState = 'pending_confirmation' | 'already_confirmed' | 'confirmation_not_queued'

export async function subscribePublicNewsletter(
  event: H3Event,
  input: NewsletterSubscribeRequest,
): Promise<SubscribeState> {
  const siteId = resolveSiteId(event)
  const config = useRuntimeConfig(event)
  const siteUrl = String(config.public.siteUrl || '').replace(/\/+$/, '')
  const email = input.email
  const token = randomUUID()
  const tokenHash = hashToken(token)
  const now = new Date()

  return withSiteDb(event, async () => {
    const existing = await PublicNewsletterModel
      .findOne({ siteId, email })
      .lean<Record<string, unknown> | null>()

    if (existing?.status === 'confirmed' && existing.isDeleted !== true) {
      await PublicNewsletterModel.updateOne(
        { _id: existing._id, siteId },
        { $set: { name: input.name || existing.name || '', consent: true, updatedAt: now }, $inc: { revision: 1 } },
      )
      return 'already_confirmed' as const
    }

    const fields = {
      siteId,
      email,
      name: input.name,
      status: 'pending',
      consent: true,
      source: 'web-newsletter-form',
      ipHash: null,
      confirmTokenHash: tokenHash,
      subscribedAt: now,
      confirmedAt: null,
      unsubscribedAt: null,
      isDeleted: false,
      deletedAt: null,
      updatedAt: now,
    }

    // Upsert instead of insert-or-update: when two signups arrive together the
    // unique index picks a winner and the other one updates that same row,
    // rather than throwing E11000. A confirmed row is never downgraded, so a
    // signup that races a confirmation joins it and answers `already_confirmed`.
    let subscriptionId = ''
    try {
      const saved = await PublicNewsletterModel.findOneAndUpdate(
        { siteId, email, status: { $ne: 'confirmed' } },
        { $set: fields, $inc: { revision: 1 }, $setOnInsert: { schemaVersion: 1, createdAt: now } },
        { upsert: true, returnDocument: 'after' },
      ).lean<Record<string, unknown> | null>()
      if (saved) subscriptionId = String(saved._id)
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
    }

    if (!subscriptionId) {
      // The insert lost the race, or a row that must not be overwritten appeared.
      const winner = await PublicNewsletterModel
        .findOne({ siteId, email })
        .lean<Record<string, unknown> | null>()
      if (!winner) {
        throw new CheckoutError(409, 'NEWSLETTER_SIGNUP_CONFLICT', 'Đăng ký chưa hoàn tất, vui lòng thử lại')
      }
      if (winner.status === 'confirmed' && winner.isDeleted !== true) return 'already_confirmed' as const

      const joined = await PublicNewsletterModel.findOneAndUpdate(
        { _id: winner._id, siteId },
        { $set: fields, $inc: { revision: 1 } },
        { returnDocument: 'after' },
      ).lean<Record<string, unknown> | null>()
      if (!joined) {
        throw new CheckoutError(409, 'NEWSLETTER_SIGNUP_CONFLICT', 'Đăng ký chưa hoàn tất, vui lòng thử lại')
      }
      subscriptionId = String(joined._id)
    }

    // Without a public URL the confirmation link cannot be built, so no mail is
    // queued; the signup stays pending and visible to the operator.
    if (!siteUrl) return 'confirmation_not_queued' as const

    const mail = await queueStorefrontMail(event, {
      templateCode: NEWSLETTER_CONFIRM_TEMPLATE,
      to: email,
      variables: {
        email,
        // Many templates greet by name. A footer signup has no name, so greet
        // neutrally instead of echoing the address back at the reader.
        name: newsletterRecipientName(input.name),
        confirmUrl: `${siteUrl}/newsletter/xac-nhan?token=${token}`,
      },
      // Keyed by the confirmation token, not just the subscription: each
      // signup rotates the stored hash, so a per-subscription key would let the
      // queue answer `queued` with an older message whose token no longer
      // matches — a dead link. The fingerprint keeps one mail per issued token.
      dedupeKey: `newsletter-confirm:${subscriptionId}:${tokenHash.slice(0, 16)}`,
    })

    return mail.queued ? ('pending_confirmation' as const) : ('confirmation_not_queued' as const)
  })
}

export async function confirmPublicNewsletter(
  event: H3Event,
  token: string,
): Promise<void> {
  const siteId = resolveSiteId(event)
  const tokenHash = hashToken(token)

  await withSiteDb(event, async () => {
    const updated = await PublicNewsletterModel.findOneAndUpdate(
      { siteId, confirmTokenHash: tokenHash, status: 'pending', isDeleted: { $ne: true } },
      {
        $set: { status: 'confirmed', confirmedAt: new Date(), confirmTokenHash: null, updatedAt: new Date() },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Record<string, unknown> | null>()

    if (!updated) {
      throw new CheckoutError(404, 'NEWSLETTER_TOKEN_NOT_FOUND', 'Liên kết xác nhận không còn hiệu lực')
    }
  })
}
