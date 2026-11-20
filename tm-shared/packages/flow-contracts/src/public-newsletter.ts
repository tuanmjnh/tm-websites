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

export const NewsletterSubscribeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_PATTERN).max(200),
  name: z.string().trim().max(120).default(''),
  consent: z.literal(true),
})

export type NewsletterSubscribeRequest = z.infer<typeof NewsletterSubscribeRequestSchema>

export const NewsletterSubscribeResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    /** `pending_confirmation` means a confirmation mail was queued. */
    state: z.enum(['pending_confirmation', 'already_confirmed', 'no_mail_provider']),
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
