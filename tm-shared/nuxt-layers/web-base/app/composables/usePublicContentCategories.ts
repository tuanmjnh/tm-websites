import type { PublicContentCategory } from '@tm/flow-contracts/content-public'

/**
 * The content categories the storefront may link to, in the active locale.
 *
 * A content record stores the category `key`, so a page that shows a category
 * needs the row to turn that key into the visitor-facing name and the landing
 * URL. The list is fetched once per locale under a fixed `useAsyncData` key, so a
 * listing page and a badge share one request, and a failing read degrades to an
 * empty map instead of an error: an unknown key still prints as stored.
 */
export const usePublicContentCategories = () => {
  const { locale } = useI18n()

  const { data } = useAsyncData<PublicContentCategory[]>(
    'public-content-categories',
    async () => {
      try {
        const response = await $fetch<{ success: boolean, data: PublicContentCategory[] }>(
          '/api/public/content/categories',
          { query: { locale: locale.value } },
        )
        return response.data ?? []
      } catch {
        return []
      }
    },
    { default: () => [], watch: [locale] },
  )

  const categories = computed(() => data.value ?? [])

  const byKey = computed(() => {
    const map = new Map<string, PublicContentCategory>()
    for (const category of categories.value) map.set(category.key, category)
    return map
  })

  return { categories, byKey }
}
