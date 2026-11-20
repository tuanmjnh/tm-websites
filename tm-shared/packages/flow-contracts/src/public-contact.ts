import { z } from 'zod'

/**
 * Public contact form contract.
 *
 * The visitor's message is stored for the operator to triage; nothing is sent
 * from the request itself, so no mail provider has to be configured for the
 * form to work. `website` is a honeypot: it is hidden from people and filled
 * only by bots, and a filled value is accepted silently without storing.
 */

export const PublicContactMessageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).default(''),
  subject: z.string().trim().max(200).default(''),
  message: z.string().trim().min(10).max(5000),
  website: z.string().trim().max(200).default(''),
})

export type PublicContactMessage = z.infer<typeof PublicContactMessageSchema>

export const PublicContactResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({ received: z.literal(true) }),
})

export type PublicContactResponse = z.infer<typeof PublicContactResponseSchema>
