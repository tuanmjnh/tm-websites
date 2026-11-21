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
 *
 * Signup also mints a second token for opting out. Confirmation burns its token,
 * so without a separate unsubscribe hash a confirmed subscriber could never
 * leave the list from the mail they received.
 */

export const NEWSLETTER_CONFIRM_TEMPLATE = 'newsletter-confirm'

/**
 * How long one address must wait before another confirmation mail is queued.
 *
 * The storefront has no captcha; without a floor on repeats the resend button
 * would let anyone put the same inbox into the queue in a loop.
 */
export const NEWSLETTER_RESEND_COOLDOWN_MS = 5 * 60 * 1000

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

interface NewsletterConfirmationMail {
  siteId: string
  siteUrl: string
  subscriptionId: string
  email: string
  name: string
  confirmToken: string
  unsubscribeToken: string
}

/**
 * Queue the one confirmation mail for a subscription and note when it went out.
 *
 * `confirmSentAt` is written only after the row is queued, so a missing template
 * does not start a cooldown over a mail nobody received.
 */
async function queueNewsletterConfirmation(event: H3Event, mail: NewsletterConfirmationMail): Promise<boolean> {
  const result = await queueStorefrontMail(event, {
    templateCode: NEWSLETTER_CONFIRM_TEMPLATE,
    to: mail.email,
    variables: {
      email: mail.email,
      // Many templates greet by name. A footer signup has no name, so greet
      // neutrally instead of echoing the address back at the reader.
      name: mail.name,
      confirmUrl: `${mail.siteUrl}/newsletter/xac-nhan?token=${mail.confirmToken}`,
      // A template that offers an opt-out link uses this one; a template that
      // does not simply ignores the extra variable.
      unsubscribeUrl: `${mail.siteUrl}/newsletter/huy-dang-ky?token=${mail.unsubscribeToken}`,
    },
    // Keyed by the confirmation token, not just the subscription: each signup
    // or resend rotates the stored hash, so a per-subscription key would let the
    // queue answer `queued` with an older message whose token no longer
    // matches — a dead link. The fingerprint keeps one mail per issued token.
    dedupeKey: `newsletter-confirm:${mail.subscriptionId}:${hashToken(mail.confirmToken).slice(0, 16)}`,
  })

  if (!result.queued) return false

  await PublicNewsletterModel.updateOne(
    { _id: mail.subscriptionId, siteId: mail.siteId },
    { $set: { confirmSentAt: new Date() } },
  )
  return true
}

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
  const unsubscribeToken = randomUUID()
  const unsubscribeTokenHash = hashToken(unsubscribeToken)
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
      unsubscribeTokenHash,
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

    const queued = await queueNewsletterConfirmation(event, {
      siteId,
      siteUrl,
      subscriptionId,
      email,
      name: newsletterRecipientName(input.name),
      confirmToken: token,
      unsubscribeToken,
    })

    return queued ? ('pending_confirmation' as const) : ('confirmation_not_queued' as const)
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

/**
 * Opt a subscriber out from the link in their mail.
 *
 * The unsubscribe hash is kept after the transition, so opening the same link
 * twice (or a mail client prefetching it) answers success instead of looking
 * like a broken link. A signup again later rotates the hash, which retires the
 * old link with the rest of that subscription's tokens.
 */
export async function unsubscribePublicNewsletter(
  event: H3Event,
  token: string,
): Promise<void> {
  const siteId = resolveSiteId(event)
  const tokenHash = hashToken(token)

  await withSiteDb(event, async () => {
    const now = new Date()
    const updated = await PublicNewsletterModel.findOneAndUpdate(
      {
        siteId,
        unsubscribeTokenHash: tokenHash,
        status: { $in: ['pending', 'confirmed'] },
        isDeleted: { $ne: true },
      },
      {
        $set: {
          status: 'unsubscribed',
          unsubscribedAt: now,
          // The confirmation link must not be able to opt them back in.
          confirmTokenHash: null,
          consent: false,
          updatedAt: now,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Record<string, unknown> | null>()

    if (updated) return

    const already = await PublicNewsletterModel
      .findOne({ siteId, unsubscribeTokenHash: tokenHash, isDeleted: { $ne: true } })
      .lean<Record<string, unknown> | null>()
    if (!already) {
      throw new CheckoutError(404, 'NEWSLETTER_TOKEN_NOT_FOUND', 'Liên kết huỷ đăng ký không hợp lệ')
    }
  })
}

/**
 * Send the confirmation mail again for a signup that is still pending.
 *
 * The answer is the same whether or not the address is on the list, because a
 * distinguishable response would turn this into a way to probe subscribers.
 * A pending row gets a fresh confirm/unsubscribe pair — the older links die with
 * the hashes they were issued against — and one address cannot be queued twice
 * inside `NEWSLETTER_RESEND_COOLDOWN_MS`. The token rotation is a conditional
 * update, so two taps that pass the cooldown together still queue one mail.
 */
export async function resendNewsletterConfirmation(event: H3Event, email: string): Promise<void> {
  const siteId = resolveSiteId(event)
  const config = useRuntimeConfig(event)
  const siteUrl = String(config.public.siteUrl || '').replace(/\/+$/, '')
  if (!siteUrl) return

  const confirmToken = randomUUID()
  const unsubscribeToken = randomUUID()

  await withSiteDb(event, async () => {
    const now = new Date()
    const pending = await PublicNewsletterModel
      .findOne({ siteId, email, status: 'pending', isDeleted: { $ne: true } })
      .lean<Record<string, unknown> | null>()
    if (!pending) return

    const lastSentAt = pending.confirmSentAt instanceof Date ? pending.confirmSentAt : null
    if (lastSentAt && now.getTime() - lastSentAt.getTime() < NEWSLETTER_RESEND_COOLDOWN_MS) return

    const rotated = await PublicNewsletterModel.findOneAndUpdate(
      {
        _id: pending._id,
        siteId,
        status: 'pending',
        confirmTokenHash: pending.confirmTokenHash ?? null,
      },
      {
        $set: {
          confirmTokenHash: hashToken(confirmToken),
          // A resent mail carries a fresh opt-out link too; the previous one is
          // retired with the hash it was issued against.
          unsubscribeTokenHash: hashToken(unsubscribeToken),
          updatedAt: now,
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    ).lean<Record<string, unknown> | null>()
    if (!rotated) return

    await queueNewsletterConfirmation(event, {
      siteId,
      siteUrl,
      subscriptionId: String(rotated._id),
      email,
      name: newsletterRecipientName(typeof pending.name === 'string' ? pending.name : ''),
      confirmToken,
      unsubscribeToken,
    })
  })
}
