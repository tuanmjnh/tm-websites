import { getInventoryTransfer } from '#server/services/inventoryTransferService'
import { translateContentError } from '#server/utils/contentApi'
import { withPreparedDb } from '#server/utils/modelRegistry'
import { resolveSiteId } from '#server/utils/site'

export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)
  requireCapabilities(user, 'content.read')

  const siteId = resolveSiteId(event)
  const id = String(getRouterParam(event, 'id') || '')

  try {
    const result = await withPreparedDb(event, ({ InventoryTransfer }) => getInventoryTransfer(InventoryTransfer, siteId, id))
    setHeader(event, 'cache-control', 'no-store')
    return successResponse({ data: result })
  } catch (error) {
    return translateContentError(error)
  }
})
