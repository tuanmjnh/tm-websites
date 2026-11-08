import { PublicContentCategoryListSchema } from '@tm/flow-contracts/content-public'
import { fetchPublicContentCategories } from '#server/utils/publicCategories'
import { getContentLocale } from '#server/utils/publicContent'

/**
 * Categories the storefront may link to, in the requested locale. Read-only and
 * public: a category only carries its key, display name, slug and parent.
 */
export default defineEventHandler(async (event) => {
  const data = await fetchPublicContentCategories(event, getContentLocale(event))

  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return { success: true, ...PublicContentCategoryListSchema.parse({ data }) }
})
