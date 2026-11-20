import { z } from 'zod'

/**
 * Admin DTOs for CRM. A customer here is a business profile linked to a Hub
 * subject; it carries no credential, role or session field.
 */

export const ADMIN_CUSTOMER_ADDRESS_MAX = 10
export const ADMIN_CUSTOMER_NOTE_MAX = 2000
export const ADMIN_CUSTOMER_SEGMENT_CODE_MAX = 32
export const ADMIN_CUSTOMER_LIST_LIMIT_DEFAULT = 20
export const ADMIN_CUSTOMER_LIST_LIMIT_MAX = 100
export const ADMIN_CUSTOMER_SEARCH_MAX = 80

export const AdminCustomerAddressSchema = z.object({
  fullName: z.string(),
  phone: z.string(),
  street: z.string(),
  ward: z.string(),
  district: z.string(),
  city: z.string(),
  country: z.string(),
  isDefault: z.boolean(),
  sort: z.number(),
})

export type AdminCustomerAddress = z.infer<typeof AdminCustomerAddressSchema>

export const AdminCustomerMetricsSchema = z.object({
  totalOrders: z.number(),
  totalSpent: z.number(),
  lastOrderAt: z.string().nullable(),
})

export const AdminCustomerSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  code: z.string(),
  subjectId: z.string(),
  email: z.string(),
  fullName: z.string(),
  phone: z.string(),
  addresses: z.array(AdminCustomerAddressSchema),
  customerSegmentId: z.string().nullable(),
  loyaltyPoints: z.number(),
  metrics: AdminCustomerMetricsSchema,
  note: z.string(),
  isActive: z.boolean(),
  isDeleted: z.boolean(),
  deletedAt: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminCustomer = z.infer<typeof AdminCustomerSchema>

export const AdminCustomerCountsSchema = z.object({
  all: z.number(),
  active: z.number(),
  inactive: z.number(),
  deleted: z.number(),
})

export const AdminCustomerListSchema = z.object({
  data: z.array(AdminCustomerSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  counts: AdminCustomerCountsSchema,
})

export type AdminCustomerList = z.infer<typeof AdminCustomerListSchema>

export const AdminCustomerSegmentSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  defaultDiscountPercent: z.number(),
  freeShipping: z.boolean(),
  thumbnail: z.string().nullable(),
  gallery: z.array(z.string()),
  autoJoinCriteria: z.object({
    minSpent: z.number(),
    minOrders: z.number(),
  }),
  sort: z.number(),
  isActive: z.boolean(),
  isDeleted: z.boolean(),
  deletedAt: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type AdminCustomerSegment = z.infer<typeof AdminCustomerSegmentSchema>

/**
 * Editing payloads. `subjectId` is accepted on create only; the server rejects
 * relinking an existing profile and never reads a subject from an update body.
 */
export const AdminCustomerDraftSchema = z.object({
  code: z.string().trim().max(ADMIN_CUSTOMER_SEGMENT_CODE_MAX).optional(),
  subjectId: z.string().trim().min(1).max(128).optional(),
  email: z.string().trim().max(200).optional(),
  fullName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  addresses: z.array(AdminCustomerAddressSchema.partial()).max(ADMIN_CUSTOMER_ADDRESS_MAX).optional(),
  customerSegmentId: z.string().nullable().optional(),
  loyaltyPoints: z.number().int().min(0).optional(),
  note: z.string().max(ADMIN_CUSTOMER_NOTE_MAX).optional(),
  isActive: z.boolean().optional(),
})

export type AdminCustomerDraft = z.infer<typeof AdminCustomerDraftSchema>

/** `revision` is required: CRM writes use the same optimistic lock as content. */
export const AdminCustomerUpdateSchema = AdminCustomerDraftSchema.extend({
  revision: z.number().int().min(1),
})

export type AdminCustomerUpdate = z.infer<typeof AdminCustomerUpdateSchema>
