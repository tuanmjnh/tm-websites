import { getTask } from '#server/services/taskService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')
  const includeDeleted = getQuery(event).includeDeleted === 'true'

  try {
    const record = await withPreparedDb(event, ({ Task }) => getTask(Task, siteId, id, includeDeleted))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: record })
  } catch (error) {
    return translateContentError(error)
  }
})
