export default defineEventHandler(async (event) => {
  const user = await requireVerifiedContext(event)

  return successResponse({ event, data: user })
})
