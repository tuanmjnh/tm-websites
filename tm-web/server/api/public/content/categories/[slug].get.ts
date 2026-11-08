import { z } from 'zod'
import { fetchPublicContentCategory } from '#server/utils/publicCategories'
import { getContentLocale } from '#server/utils/publicContent'

/**
 * Resolves a landing-page URL slug to the category `key` stored on content rows.
 *
 * Unknown slug → 404, so a landing page never renders an empty page for a
 * category that does not exist; a category that exists but has no published
 * content still resolves and shows the listing's empty state.
 */
const ParamsSchema = z.object({
  slug: z.string().trim().min(1).max(120),
})

export default defineEventHandler(async (event) => {
  const params = ParamsSchema.safeParse(getRouterParams(event))
  if (!params.success) {
    throw createError({ statusCode: 422, statusMessage: 'error.invalidQuery' })
  }

  const category = await fetchPublicContentCategory(event, {
    slug: params.data.slug,
    locale: getContentLocale(event),
  })

  if (!category) {
    throw createError({ statusCode: 404, statusMessage: 'error.categoryNotFound' })
  }

  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return { success: true, data: category }
})
