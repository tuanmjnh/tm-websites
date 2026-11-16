import type { AdminCatalogCategory } from '@tm/flow-contracts/catalog-admin'

export interface CatalogCategoryFormDraft {
  key: string
  parent: string | null
  order: number
  title: string
  description: string
  thumbnail: string
  seoTitle: string
  seoDescription: string
}

type CatalogCategoryLocales = Pick<AdminCatalogCategory, 'title' | 'slug' | 'description' | 'seo'>

/**
 * The category panel edits Vietnamese only. Rebuild the payload from the loaded
 * record so saving one field cannot drop the locales the panel does not show.
 */
export function buildCatalogCategoryDraft(
  draft: CatalogCategoryFormDraft,
  original: CatalogCategoryLocales | null,
) {
  return {
    key: draft.key,
    parent: draft.parent,
    order: Number(draft.order) || 0,
    title: { ...original?.title, vi: draft.title },
    slug: { ...original?.slug, vi: draft.title },
    description: { ...original?.description, vi: draft.description },
    thumbnail: draft.thumbnail.trim() || null,
    seo: {
      title: { ...original?.seo.title, vi: draft.seoTitle },
      description: { ...original?.seo.description, vi: draft.seoDescription },
    },
  }
}
