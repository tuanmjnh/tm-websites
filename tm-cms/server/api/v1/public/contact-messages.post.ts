import { submitContactMessage } from '#server/services/contactMessageService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const PublicContactMessageBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(200),
  phone: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(120).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(PublicContactMessageBodySchema, body, 'CONTACT_MESSAGE_PAYLOAD_INVALID', 'Dữ liệu liên hệ không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ ContactMessage }) =>
      submitContactMessage(ContactMessage, siteId, {
        ...input,
        phone: input.phone ?? '',
        subject: input.subject ?? '',
        source: input.source ?? 'public-form',
        ipHash: null,
        userAgent: String(getHeader(event, 'user-agent') || '').slice(0, 500),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: { id: result.id, status: result.status }, message: 'Đã gửi liên hệ' })
  } catch (error) {
    return translateContentError(error)
  }
})
