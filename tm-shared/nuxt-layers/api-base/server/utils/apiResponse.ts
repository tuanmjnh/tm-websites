import type { H3Event } from 'h3'

export interface ApiResponseOptions<T> {
  event?: H3Event
  data: T
  message?: string
  meta?: {
    total?: number
    page?: number
    limit?: number
    nextCursor?: string
    hasMore?: boolean
    /** Status buckets for a filtered admin list. */
    counts?: Record<string, number>
    /** Money and day sums for an admin list that reports totals (payroll). */
    totals?: Record<string, number>
    /** Folder names the current admin list is grouped by (media library). */
    folders?: string[]
    /** Number of duplicate groups an admin report found (CRM). */
    groups?: number
    /** Customer the portal list was resolved to (own orders). */
    customerId?: string
  }
}

export function successResponse<T>({ data, message, meta }: ApiResponseOptions<T>) {
  return {
    success: true,
    data,
    message,
    meta,
  }
}

export function errorResponse(statusCode: number, code: string, message: string, details?: any): never {
  throw createError({
    statusCode,
    statusMessage: message,
    data: {
      success: false,
      error: {
        code,
        message,
        details,
      },
    },
  })
}

