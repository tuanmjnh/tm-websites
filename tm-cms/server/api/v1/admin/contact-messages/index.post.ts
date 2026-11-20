import { submitContactMessage } from '#server/services/contactMessageService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ContactMessageSubmitBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(200),
  phone: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(120).optional(),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const body = await readBody(event)
  const input = parseInput(ContactMessageSubmitBodySchema, body, 'CONTACT_MESSAGE_PAYLOAD_INVALID', 'Dữ liệu tin nhắn không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ ContactMessage, Audit }) =>
      submitContactMessage(ContactMessage, siteId, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã ghi nhận tin nhắn' })
  } catch (error) {
    return translateContentError(error)
  }
})
