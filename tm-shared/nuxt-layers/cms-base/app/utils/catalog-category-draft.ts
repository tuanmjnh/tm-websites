import type { AdminCatalogCategory } from '@tm/flow-contracts/catalog-admin'

export interface CatalogCategoryFormDraft {
  key: string
  parent: string | null
  order: number
  title: string
  titleEn: string
  slugEn: string
  description: string
  descriptionEn: string
  thumbnail: string
  seoTitle: string
  seoTitleEn: string
  seoDescription: string
  seoDescriptionEn: string
}

type CatalogCategoryLocales = Pick<AdminCatalogCategory, 'title' | 'slug' | 'description' | 'seo'>

/**
 * The panel edits Vietnamese and English. Write those two locales explicitly so
 * clearing one removes it, and keep any other locale the record already carries
 * so opening the form cannot erase data it does not show.
 */
function withEditedLocales(original: Record<string, string> | undefined, vi: string, en: string) {
  const next = { ...original }
  if (vi.trim()) next.vi = vi
  else delete next.vi
  if (en.trim()) next.en = en
  else delete next.en
  return next
}

export function buildCatalogCategoryDraft(
  draft: CatalogCategoryFormDraft,
  original: CatalogCategoryLocales | null,
) {
  return {
    key: draft.key,
    parent: draft.parent,
    order: Number(draft.order) || 0,
    title: withEditedLocales(original?.title, draft.title, draft.titleEn),
    slug: withEditedLocales(original?.slug, draft.title, draft.slugEn),
    description: withEditedLocales(original?.description, draft.description, draft.descriptionEn),
    thumbnail: draft.thumbnail.trim() || null,
    seo: {
      title: withEditedLocales(original?.seo.title, draft.seoTitle, draft.seoTitleEn),
      description: withEditedLocales(original?.seo.description, draft.seoDescription, draft.seoDescriptionEn),
    },
  }
}
