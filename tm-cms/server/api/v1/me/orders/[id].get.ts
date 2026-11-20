import { getOrderForSubject } from '#server/services/customerPortalService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const order = await withPreparedDb(event, ({ Order, Customer }) =>
      getOrderForSubject(Order, Customer, siteId, user.id, id))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: order })
  } catch (error) {
    return translateContentError(error)
  }
})
