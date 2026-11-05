import type { DateFormatStyle } from './types'

export const formatDate = (value?: string | number | Date | null, locale = 'vi-VN'): string => {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const formatDateTime = (value?: string | number | Date | null, locale = 'vi-VN'): string => {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export const formatDateStyle = (
  date: string | Date | number | undefined | null,
  style: DateFormatStyle = 'date',
  locale = 'vi'
): string => {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''

  const currentLocale = locale === 'vi' ? 'en-VN' : 'en-US'
  const intlOptions: Intl.DateTimeFormatOptions = {}

  if (style === 'date') {
    intlOptions.day = '2-digit'
    intlOptions.month = '2-digit'
    intlOptions.year = 'numeric'
  } else if (style === 'time') {
    intlOptions.hour = '2-digit'
    intlOptions.minute = '2-digit'
  } else if (style === 'full') {
    intlOptions.day = '2-digit'
    intlOptions.month = '2-digit'
    intlOptions.year = 'numeric'
    intlOptions.hour = '2-digit'
    intlOptions.minute = '2-digit'
  }

  return new Intl.DateTimeFormat(currentLocale, intlOptions).format(d)
}

export const formatTimeAgo = (date: string | Date | number | undefined | null, locale = 'vi'): string => {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''

  const diff = (Date.now() - d.getTime()) / 1000
  const currentLocale = locale === 'vi' ? 'en-VN' : 'en-US'
  const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' })

  if (diff < 60) return rtf.format(-Math.floor(diff), 'second')
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour')
  return rtf.format(-Math.floor(diff / 86400), 'day')
}

export const formatNumber = (
  value: number | string | undefined | null,
  intlOptions?: Intl.NumberFormatOptions,
  locale = 'vi-VN'
): string => {
  if (value === undefined || value === null || value === '') return '0'
  const num = Number(value)
  if (isNaN(num)) return '0'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...intlOptions }).format(num)
}

export const formatCurrency = (
  value: number | string | undefined | null,
  currency = 'VND',
  locale = 'vi-VN'
): string => {
  const num = Number(value)
  if (value === undefined || value === null || value === '' || isNaN(num)) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(0)
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(num)
}

export const formatCompactNumber = (value: number | string | undefined | null, locale = 'vi-VN'): string => {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1
  }).format(Number(value || 0))
}

export const formatPhoneNumber = (phone?: string | number | null): string => {
  if (!phone) return '-'
  const s = String(phone).replace(/\D/g, '')
  if (s.length === 10) return s.replace(/(\d{3,4})(\d{3})(\d{3,4})/, '$1 $2 $3')
  return s
}