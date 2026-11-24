import { softDeleteDocumentTemplate } from '#server/services/documentTemplateService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const BodySchema = z.object({ revision: z.coerce.number().int().min(1) })

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(BodySchema, await readBody(event), 'DOCUMENT_TEMPLATE_PAYLOAD_INVALID', 'Dữ liệu mẫu không hợp lệ')

  try {
    const result = await withPreparedDb(event, ({ DocumentTemplate, Audit }) =>
      softDeleteDocumentTemplate(DocumentTemplate, siteId, id, body.revision, {
        audit: auditMetaOf(event, user, Audit),
      }))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã xoá mẫu' })
  } catch (error) {
    return translateContentError(error)
  }
})