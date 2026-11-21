import { z } from 'zod'

/**
 * Public newsletter contract.
 *
 * Signup is double opt-in: the storefront stores a pending subscription and
 * queues one confirmation mail. The confirmation token never reaches the
 * browser; it exists only in the link inside that mail, so an address cannot be
 * confirmed by whoever typed it.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeNewsletterEmail(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Stands in for a missing subscriber name in a greeting.
 *
 * A signup may come from a footer form with no name field. Falling back to the
 * address would greet the reader with their own email, so the confirmation mail
 * uses a neutral salutation instead.
 */
export const NEWSLETTER_NEUTRAL_NAME = 'bạn'

export function newsletterRecipientName(name: string): string {
  const trimmed = name.trim()
  return trimmed || NEWSLETTER_NEUTRAL_NAME
}

export const NewsletterSubscribeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN).max(200),
  name: z.string().trim().max(120).default(''),
  consent: z.literal(true),
})

export type NewsletterSubscribeRequest = z.infer<typeof NewsletterSubscribeRequestSchema>

export const NewsletterSubscribeResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    /**
     * `pending_confirmation` means the signup is recorded and a confirmation
     * mail was queued. `confirmation_not_queued` means it is recorded but no
     * mail went out, because the confirmation template or the site URL is
     * missing — not because a mail provider failed.
     */
    state: z.enum(['pending_confirmation', 'already_confirmed', 'confirmation_not_queued']),
  }),
})

export type NewsletterSubscribeResponse = z.infer<typeof NewsletterSubscribeResponseSchema>

export const NewsletterTokenRequestSchema = z.object({
  token: z.string().trim().min(16).max(200),
})

export type NewsletterTokenRequest = z.infer<typeof NewsletterTokenRequestSchema>

export const NewsletterConfirmResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal('confirmed') }),
})

/**
 * Opting out carries its own token.
 *
 * Confirmation consumes its token, so a confirmed subscriber has nothing left
 * to prove the address is theirs. Every signup therefore stores a second hash
 * for the unsubscribe link that stays usable after confirmation.
 */
export const NewsletterUnsubscribeResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal('unsubscribed') }),
})

export type NewsletterUnsubscribeResponse = z.infer<typeof NewsletterUnsubscribeResponseSchema>
