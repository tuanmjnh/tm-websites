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

