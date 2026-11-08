import { z } from 'zod'
import { PUBLIC_CONTENT_SEARCH_MAX, PublicContentListSchema } from '@tm/flow-contracts/content-public'
import { fetchPublicContentList, getContentLocale } from '#server/utils/publicContent'

/**
 * Public content listing over the same read policy as a single record. No body
 * leaves the server: a listing only needs the link, the title and the teaser.
 */
const ContentListQuerySchema = z.object({
  type: z.enum(['page', 'post', 'fragment']).optional(),
  tag: z.string().trim().max(60).optional(),
  category: z.string().trim().max(120).optional(),
  // An empty ?q= means "no search" rather than an error; a longer one is rejected.
  q: z.string().trim().max(PUBLIC_CONTENT_SEARCH_MAX).optional(),
  sort: z.enum(['newest', 'oldest']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
})

export default defineEventHandler(async (event) => {
  const query = ContentListQuerySchema.safeParse(getQuery(event))
  if (!query.success) {
    throw createError({ statusCode: 422, statusMessage: 'error.invalidQuery' })
  }

  const result = await fetchPublicContentList(event, {
    ...query.data,
    locale: getContentLocale(event),
  })

  setHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return { success: true, ...PublicContentListSchema.parse(result) }
})
