import { PublicContactMessageSchema, PublicContactResponseSchema } from '@tm/flow-contracts'
import { submitPublicContactMessage } from '#server/utils/contactService'

/**
 * `POST /api/public/contact-message` stores a visitor's message for triage.
 *
 * The message is kept in `crm_contact_messages` with status `new`; delivery to
 * the operator is the CMS queue's business, so the form works without a mail
 * provider. A filled honeypot answers success and stores nothing.
 */
export default defineEventHandler(async (event) => {
  const body = PublicContactMessageSchema.safeParse(await readBody(event).catch(() => null))
  if (!body.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'error.contactMessageInvalid',
      data: { code: 'CONTACT_MESSAGE_INVALID' },
    })
  }

  await submitPublicContactMessage(event, body.data)

  setResponseStatus(event, 201)
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return PublicContactResponseSchema.parse({ success: true, data: { received: true } })
})
