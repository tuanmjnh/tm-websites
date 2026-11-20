import { createHash, randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import type { NewsletterSubscribeRequest } from '@tm/flow-contracts'
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
 */

export const NEWSLETTER_CONFIRM_TEMPLATE = 'newsletter-confirm'

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type SubscribeState = 'pending_confirmation' | 'already_confirmed' | 'no_mail_provider'

export async function subscribePublicNewsletter(
  event: H3Event,
  input: NewsletterSubscribeRequest,
): Promise<SubscribeState> {
  const siteId = resolveSiteId(event)
  const config = useRuntimeConfig(event)
  const siteUrl = String(config.public.siteUrl || '').replace(/\/+$/, '')
  const token = randomUUID()
  const tokenHash = hashToken(token)
  const now = new Date()

  return withSiteDb(event, async () => {
    const existing = await PublicNewsletterModel
      .findOne({ siteId, email: input.email })
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
      email: input.email,
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

    let subscriptionId: string
    if (existing) {
      await PublicNewsletterModel.updateOne(
        { _id: existing._id, siteId },
        { $set: fields, $inc: { revision: 1 } },
      )
      subscriptionId = String(existing._id)
    } else {
      const created = await PublicNewsletterModel.create({
        ...fields,
        revision: 1,
        schemaVersion: 1,
        createdAt: now,
      })
      subscriptionId = String(created._id)
    }

    // Without a public URL the confirmation link cannot be built, so no mail is
    // queued; the signup stays pending and visible to the operator.
    if (!siteUrl) return 'no_mail_provider' as const

    const mail = await queueStorefrontMail(event, {
      templateCode: NEWSLETTER_CONFIRM_TEMPLATE,
      to: input.email,
      variables: {
        email: input.email,
        // Templates commonly greet by name, but a signup may come from a footer
        // with no name field: fall back to the address so the variable is never
        // blank (a blank one would make the queue refuse the message).
        name: input.name || input.email,
        confirmUrl: `${siteUrl}/newsletter/xac-nhan?token=${token}`,
      },
      dedupeKey: `newsletter-confirm:${subscriptionId}`,
    })

    return mail.queued ? ('pending_confirmation' as const) : ('no_mail_provider' as const)
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

