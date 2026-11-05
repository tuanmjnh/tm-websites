import { z } from 'zod'

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
})
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>

export const ApiResponseMetaSchema = z.object({
  total: z.number().int().optional(),
  page: z.number().int().optional(),
  limit: z.number().int().optional(),
  nextCursor: z.string().optional(),
  hasMore: z.boolean().optional(),
})
export type ApiResponseMeta = z.infer<typeof ApiResponseMetaSchema>

export function createApiResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    success: z.boolean(),
    data: itemSchema,
    meta: ApiResponseMetaSchema.optional(),
    message: z.string().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.any().optional(),
      })
      .optional(),
  })
}

export const TenantIdentifierSchema = z.object({
  tenantId: z.string().min(1),
  appId: z.string().min(1),
  siteId: z.string().optional(),
})
export type TenantIdentifier = z.infer<typeof TenantIdentifierSchema>

