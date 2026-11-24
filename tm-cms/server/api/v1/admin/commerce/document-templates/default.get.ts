import { getDefaultDocumentTemplate } from '#server/services/documentTemplateService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const QuerySchema = z.object({
  type: z.string().trim().max(40).optional(),
})

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const query = parseInput(QuerySchema, getQuery(event), 'DOCUMENT_TEMPLATE_QUERY_INVALID', 'Tham số không hợp lệ')

  try {
    const record = await withPreparedDb(event, ({ DocumentTemplate }) =>
      getDefaultDocumentTemplate(DocumentTemplate, siteId, query.type ?? 'quotation'))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: record })
  } catch (error) {
    return translateContentError(error)
  }
})