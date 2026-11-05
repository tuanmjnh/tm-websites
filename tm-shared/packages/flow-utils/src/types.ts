export type UrlMode = 'flat' | 'prefix' | 'category'

export type ImageStorageMode = 'string' | 'object'

export type DateFormatStyle = 'date' | 'time' | 'full'

export type LocalizedString = Record<string, string>

export interface ImageLike {
  url?: string
  secure_url?: string
  [key: string]: unknown
}

export interface CategoryLike {
  _id?: string
  slug?: LocalizedString
  [key: string]: unknown
}

export interface LocalizedPathOptions {
  slug: string
  type?: string
  urlMode?: UrlMode
  parentPath?: string
}

export interface QuickSyncOptions {
  images?: {
    banner?: boolean
    gallery?: boolean
  }
  seo?: {
    title?: boolean
    description?: boolean
    image?: boolean
  }
  force?: boolean
}

export interface ItemPrice {
  price: number
  basePrice: number
}

export interface AlternateLink {
  rel: 'alternate'
  hreflang: string
  href: string
}

export interface LocaleLike {
  code: string
  iso?: string
}