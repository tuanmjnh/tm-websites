import type { QuickSyncOptions } from './types'
import { getImage } from './image'

export const syncQuickData = (
  formData: Record<string, any>,
  options: QuickSyncOptions,
  sourceImage?: unknown
): void => {
  if (!formData || !options) return

  const { images = {}, seo = {}, force = false } = options
  const imageUrl = sourceImage ? getImage(sourceImage) : getImage(formData.thumbnail || formData.avatar || formData.image)

  if (sourceImage) {
    if (images.banner) {
      if (force || !formData.banner) formData.banner = sourceImage
    }

    if (images.gallery) {
      if (!Array.isArray(formData.gallery)) formData.gallery = formData.gallery ? [formData.gallery] : []
      const isExist = formData.gallery.some((img: any) => getImage(img) === imageUrl)
      if (!isExist) formData.gallery = [...formData.gallery, sourceImage]
    }
  }

  if (formData.seo === undefined || formData.seo === null) formData.seo = {}

  const isLocalyEmpty = (val: unknown): boolean => {
    if (!val) return true
    if (typeof val !== 'object') return !val
    return Object.values(val).every(v => !v)
  }

  if (seo.title && formData.title) {
    if (force || isLocalyEmpty(formData.seo.title)) {
      const sourceStr = JSON.stringify(formData.title || {})
      const targetStr = JSON.stringify(formData.seo.title || {})
      if (force || sourceStr !== targetStr) {
        formData.seo.title = JSON.parse(sourceStr)
      }
    }
  }

  if (seo.description) {
    const descSource = formData.shortDesc || formData.excerpt || formData.description || formData.content
    if (descSource && (force || isLocalyEmpty(formData.seo.description))) {
      const sourceStr = JSON.stringify(descSource || {})
      const targetStr = JSON.stringify(formData.seo.description || {})
      if (force || sourceStr !== targetStr) {
        formData.seo.description = JSON.parse(sourceStr)
      }
    }
  }

  if (seo.image && imageUrl && imageUrl !== '/placeholder.png') {
    if (force || formData.seo.image !== imageUrl) {
      formData.seo.image = imageUrl
    }
  }
}

export const syncQuickImages = (
  formData: Record<string, any>,
  sourceImage: unknown,
  options: Record<string, boolean>
): void => {
  const mappedOptions: QuickSyncOptions = {
    images: { banner: options.banner, gallery: options.gallery },
    seo: { image: options.seo },
    force: options.force
  }
  syncQuickData(formData, mappedOptions, sourceImage)
}

export const syncQuickSeo = (
  formData: Record<string, any>,
  options: Record<string, boolean>
): void => {
  const mappedOptions: QuickSyncOptions = {
    seo: { title: options.title, description: options.description, image: options.image },
    force: options.force
  }
  syncQuickData(formData, mappedOptions)
}