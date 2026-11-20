import { updateContactMessage } from '#server/services/contactMessageService'
import {
  auditMetaOf,
  translateContentError,
} from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const ContactMessageUpdateBodySchema = z.object({
  status: z.enum(['new', 'read', 'replied', 'closed']).optional(),
  adminNote: z.string().trim().max(2000).optional(),
  revision: z.coerce.number().int().min(1),
})

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event)
  const input = parseInput(ContactMessageUpdateBodySchema, body, 'CONTACT_MESSAGE_UPDATE_INVALID', 'Dữ liệu cập nhật không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ ContactMessage, Audit }) =>
      updateContactMessage(ContactMessage, siteId, id, input, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã cập nhật tin nhắn' })
  } catch (error) {
    return translateContentError(error)
  }
})
