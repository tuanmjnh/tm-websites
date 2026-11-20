import { resolveCustomerBySubject } from '#server/services/customerPortalService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

/** The portal profile linked to the signed-in Hub subject. */
export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  const siteId = resolveSiteId(event)

  try {
    const customer = await withPreparedDb(event, ({ Customer }) =>
      resolveCustomerBySubject(Customer, siteId, user.id))

    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: customer })
  } catch (error) {
    return translateContentError(error)
  }
})
