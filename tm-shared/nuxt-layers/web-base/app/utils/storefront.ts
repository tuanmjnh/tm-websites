import type { LocalizedText } from '@tm/flow-contracts'
import { formatCurrency, pickLocalized } from '@tm/flow-utils'

export const DEFAULT_CONTENT_LOCALE = 'vi'

export const localeToIntl = (locale: string): string => (locale === 'en' ? 'en-US' : 'vi-VN')

export const readLocalized = (
  value: LocalizedText | string | null | undefined,
  locale: string,
  fallbackLocale = DEFAULT_CONTENT_LOCALE
): string => pickLocalized(value as never, locale, fallbackLocale)

export const formatCatalogPrice = (value: number | undefined | null, currency: string, locale: string): string =>
  formatCurrency(value ?? 0, currency || 'VND', localeToIntl(locale))

export const formatCatalogDate = (value: string | undefined | null, locale: string): string => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(localeToIntl(locale), { dateStyle: 'medium' }).format(date)
}
