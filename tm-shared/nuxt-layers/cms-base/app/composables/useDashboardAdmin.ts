import type { AdminDashboardSummary } from '@tm/flow-contracts/dashboard-admin'

/** Reads the site's own business counts for the dashboard. */
export const useDashboardAdmin = () => {
  const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

  const fetchSummary = async (): Promise<AdminDashboardSummary> => {
    const payload = await plainFetch('/api/v1/admin/dashboard/summary') as { data: AdminDashboardSummary }
    return payload.data
  }

  return { fetchSummary }
}
