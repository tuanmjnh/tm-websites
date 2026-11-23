import { z } from 'zod'

/**
 * The CMS dashboard's business counts: what the site actually holds, read from
 * the site's own collections. Nothing here is a Hub figure or an estimate — a
 * section with no rows reports `0`, and a module the customer did not license is
 * left out by the page rather than reported as zero.
 */

const count = z.number().int().nonnegative()

export const AdminDashboardSummarySchema = z.object({
  content: z.object({
    published: count,
    draft: count,
  }),
  catalog: z.object({
    published: count,
    draft: count,
  }),
  orders: z.object({
    /** Pending, processing or shipped: the orders still needing an action. */
    open: count,
  }),
  quotations: z.object({
    /** Draft or sent: quotations a customer has not answered yet. */
    open: count,
  }),
  customers: z.object({
    total: count,
  }),
  inventory: z.object({
    /** Balances at or below their own threshold, threshold greater than zero. */
    lowStock: count,
  }),
})

export type AdminDashboardSummary = z.infer<typeof AdminDashboardSummarySchema>
