import { restoreKeyword } from '#server/services/keywordService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const result = await withPreparedDb(event, ({ Keyword, Audit }) =>
      restoreKeyword(Keyword, siteId, id, {
        audit: auditMetaOf(event, user, Audit),
      }))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result, message: 'Đã khôi phục từ khoá' })
  } catch (error) {
    return translateContentError(error)
  }
})