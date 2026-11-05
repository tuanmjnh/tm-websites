export type {
  UrlMode,
  ImageStorageMode,
  DateFormatStyle,
  LocalizedString,
  ImageLike,
  CategoryLike,
  LocalizedPathOptions,
  QuickSyncOptions,
  ItemPrice,
  AlternateLink,
  LocaleLike
} from './types'
export type { CsvRow } from './browser'
export type { ExcelColumn, ExcelSheet } from './excel'

export { encodeBase64 } from './base64'

export { removeById } from './collection'

export {
  toSlug,
  slugify,
  toNormalize,
  toCode,
  ensureForwardSlash,
  escapeRegExp,
  escapeNormalize,
  calculateLocalizedPath,
  generateSlug
} from './slug'

export {
  toLocalizedString,
  pickLocalized
} from './locale'

export {
  formatDate,
  formatDateTime,
  formatDateStyle,
  formatTimeAgo,
  formatNumber,
  formatCurrency,
  formatCompactNumber,
  formatPhoneNumber
} from './format'

export {
  getItemDisplayPrice,
  numberToVietnameseWords
} from './price'

export {
  minifySvg,
  isRawSvg,
  isIconify,
  getFaviconHref,
  sanitizeSvg
} from './svg'

export {
  isSpecialImage,
  isImage,
  detectDisplayType,
  formatImageUrl,
  cleanImageUrl,
  getImage,
  formatImage,
  ObjectToImageString
} from './image'

export {
  getCanonicalUrl,
  getAlternateLinks,
  getFlagEmoji
} from './url'

export {
  getYoutubeId,
  getYoutubeEmbedUrl,
  getVimeoId,
  getVimeoEmbedUrl,
  getFacebookId,
  getFacebookEmbedUrl,
  getSoundCloudEmbedUrl,
  getTiktokId,
  getTiktokEmbedUrl,
  getDailyMotionId,
  getDailyMotionEmbedUrl
} from './media'

export {
  getRandomInteger,
  generateEan13,
  generateCode
} from './code'

export {
  syncQuickData,
  syncQuickImages,
  syncQuickSeo
} from './sync'

export {
  exportToCsv,
  exportToJson,
  readCsv,
  readJson,
  downloadFile
} from './browser'

export type { HubRequestContext, HubTokenPayload } from './hub'

export {
  resolveHubUrl,
  buildHubHeaders,
  shouldAttemptTokenRefresh,
  getErrorStatus,
  extractHubTokens
} from './hub'

export { escapeHtml, sanitizePublicHtml } from './html'

export { renderSafeMarkdown } from './markdown'

export {
  normalizeSiteBaseUrl,
  buildCanonicalUrl,
  resolveSiteUrl,
  escapeXml,
  buildSitemapEntries,
  buildSitemapXml
} from './seo'

export type { SitemapEntry, SitemapPage } from './seo'