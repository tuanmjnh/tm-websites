import { updateKeyword } from '#server/services/keywordService'
import { auditMetaOf, translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'
import { parseInput } from '#server/utils/validation'
import { z } from 'zod'

const BodySchema = z.record(z.string(), z.unknown())

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)

  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.write')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const body = parseInput(BodySchema, await readBody(event), 'KEYWORD_PAYLOAD_INVALID', 'Dữ liệu từ khoá không hợp lệ')

  try {
    const record = await withPreparedDb(event, ({ Keyword, Audit }) =>
      updateKeyword(Keyword, siteId, id, body, {
        audit: auditMetaOf(event, user, Audit),
      }))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: record, message: 'Đã cập nhật từ khoá' })
  } catch (error) {
    return translateContentError(error)
  }
})