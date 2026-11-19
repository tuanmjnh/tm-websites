/**
 * Customer-local calendar time.
 *
 * Business days (payments, shifts, aging) are the customer's days, not UTC days:
 * Vietnam runs a fixed UTC+7 with no DST since 1975, so the offset is exact
 * rather than an approximation. One helper here keeps payroll, reports and
 * scheduling from drifting apart on month and day boundaries.
 */

export const CUSTOMER_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const OFFSET_MINUTES = 7 * 60
const DAY_MS = 24 * 60 * 60 * 1000

export const CUSTOMER_DAY_MS = DAY_MS

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

/** Local midnight of a calendar day as a UTC instant. */
export function localDayStartUtc(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, date, 0, 0, 0, 0) - OFFSET_MINUTES * 60_000)
}

/** The local calendar day a UTC instant falls on. */
export function localDayOf(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MINUTES * 60_000).toISOString().slice(0, 10)
}

export function todayInCustomerTime(now: Date = new Date()): string {
  return localDayOf(now)
}
