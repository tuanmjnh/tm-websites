<script setup lang="ts">
import type { AdminPayroll, AdminStaff } from '../../composables/useOperationsAdmin'

/**
 * The payslip an employee can print or save as PDF.
 *
 * It reads one row through `/api/v1/me/payroll/:id`, which resolves the staff
 * profile from the Hub subject — the id in the URL can only address the caller's
 * own payroll. The numbers are printed as they are stored on the row (an approved
 * or paid month keeps the figures it was approved with), not recalculated here.
 */

const { t } = useI18n()
const route = useRoute()
const ops = useOperationsAdmin()
const { customer } = useCustomerConfig()

const payroll = ref<AdminPayroll | null>(null)
const staff = ref<AdminStaff | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`
const asDay = (value: string | null) => (value ? value.slice(0, 10) : '—')

function statusOf(e: unknown): number | null {
  const err = e as { statusCode?: number, status?: number, response?: { status?: number } }
  return err?.statusCode ?? err?.status ?? err?.response?.status ?? null
}

function describeError(e: unknown) {
  const status = statusOf(e)
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.myWork.errors.load')
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const id = typeof route.params.id === 'string' ? route.params.id : ''
    const result = await ops.myPayslip(id)
    payroll.value = result.payroll
    staff.value = result.staff
  } catch (e) {
    const code = ops.errorCode(e)
    const status = statusOf(e)
    // Only a real 404 (or the service's not-found codes, which are 404s)
    // reads as "no payslip"; everything else is a load failure the operator
    // can retry, so it keeps its message and the retry button.
    if (status === 404 || code === 'PAYROLL_NOT_FOUND' || code === 'STAFF_NOT_FOUND') {
      error.value = code === 'STAFF_NOT_FOUND'
        ? t('admin.myWork.noProfile')
        : t('admin.myWork.payslip.notFound')
    } else {
      error.value = describeError(e)
    }
  } finally {
    loading.value = false
  }
}

const printPayslip = () => window.print()

await load()
</script>

<template>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 sm:p-6">
    <div class="payslip-toolbar flex flex-wrap items-center justify-between gap-2">
      <UButton to="/my-work" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" :label="t('admin.myWork.payslip.back')" />
      <UButton
        v-if="payroll"
        icon="i-lucide-printer"
        color="primary"
        variant="soft"
        size="sm"
        :label="t('admin.myWork.payslip.print')"
        @click="printPayslip"
      />
    </div>

    <p v-if="loading" class="text-xs text-muted">{{ t('common.loading') }}</p>

    <div v-else-if="error" class="panel border-dashed p-10 text-center">
      <UIcon name="i-lucide-receipt-text" class="mb-3 size-10 text-muted" />
      <p class="text-sm font-medium text-highlighted">{{ error }}</p>
      <UButton class="mt-3" color="neutral" variant="soft" size="sm" :label="t('admin.myWork.retry')" @click="load" />
    </div>

    <div v-else-if="payroll && staff" class="payslip panel flex flex-col gap-5 p-6">
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-default/60 pb-4">
        <div class="min-w-0">
          <p class="truncate text-base font-semibold text-highlighted">{{ customer?.companyName || 'TM CMS' }}</p>
          <p class="text-xs text-muted">{{ t('admin.myWork.payslip.heading') }}</p>
        </div>
        <div class="text-right">
          <p class="font-mono text-sm font-medium text-highlighted">{{ payroll.period }}</p>
          <UBadge :color="payroll.status === 'paid' ? 'success' : payroll.status === 'cancelled' ? 'error' : 'neutral'" variant="subtle" size="sm">
            {{ t(`admin.hr.payroll.statuses.${payroll.status}`) }}
          </UBadge>
        </div>
      </header>

      <section class="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p class="text-xs text-muted">{{ t('admin.myWork.payslip.employee') }}</p>
          <p class="font-medium text-highlighted">{{ staff.fullName }}</p>
          <p class="font-mono text-xs text-muted">{{ staff.employeeCode }}</p>
        </div>
        <div class="sm:text-right">
          <p class="text-xs text-muted">{{ t('admin.myWork.payslip.position') }}</p>
          <p class="text-highlighted">{{ t(`admin.hr.staff.positions.${staff.positionCode}`) }}</p>
          <p v-if="staff.joinedAt" class="text-xs text-muted">{{ t('admin.hr.staff.joined', { date: staff.joinedAt }) }}</p>
        </div>
      </section>

      <table class="w-full text-sm">
        <tbody>
          <tr class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">{{ t('admin.myWork.payslip.baseSalary') }}</th>
            <td class="py-1.5 text-right tabular-nums text-highlighted">{{ money(payroll.baseSalary) }}</td>
          </tr>
          <tr class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">
              {{ t('admin.myWork.payslip.dailyRate', { days: payroll.standardWorkDays }) }}
            </th>
            <td class="py-1.5 text-right tabular-nums text-highlighted">{{ money(payroll.dailyRate) }}</td>
          </tr>
          <tr class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">
              {{ t('admin.myWork.payslip.workPay', { work: payroll.workDays, leave: payroll.leaveDays, absent: payroll.absentDays }) }}
            </th>
            <td class="py-1.5 text-right tabular-nums text-highlighted">{{ money(payroll.basePay) }}</td>
          </tr>
          <tr class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">{{ t('admin.myWork.payslip.allowance') }}</th>
            <td class="py-1.5 text-right tabular-nums text-highlighted">{{ money(payroll.allowancePay) }}</td>
          </tr>
          <tr v-for="(line, index) in payroll.adjustments" :key="index" class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">{{ line.label }}</th>
            <td class="py-1.5 text-right tabular-nums" :class="line.amount < 0 ? 'text-error' : 'text-highlighted'">
              {{ money(line.amount) }}
            </td>
          </tr>
          <tr v-if="payroll.adjustmentTotal" class="border-b border-default/40">
            <th class="py-1.5 text-left font-normal text-muted">{{ t('admin.myWork.payslip.adjustmentTotal') }}</th>
            <td class="py-1.5 text-right tabular-nums text-highlighted">{{ money(payroll.adjustmentTotal) }}</td>
          </tr>
          <tr>
            <th class="pt-3 text-left text-base">{{ t('admin.myWork.netPay') }}</th>
            <td class="pt-3 text-right text-base font-semibold tabular-nums text-highlighted">{{ money(payroll.netPay) }}</td>
          </tr>
        </tbody>
      </table>

      <footer class="flex flex-col gap-1 border-t border-default/60 pt-3 text-xs text-muted">
        <p v-if="payroll.status === 'paid'" class="text-highlighted">
          {{ t('admin.myWork.payslip.paidOn', { date: asDay(payroll.paidAt) }) }}
        </p>
        <p v-else-if="payroll.status === 'draft'">{{ t('admin.myWork.payslip.draftNote') }}</p>
        <p v-else-if="payroll.status === 'approved'">{{ t('admin.myWork.payslip.approvedNote') }}</p>
        <p v-else>{{ t('admin.myWork.payslip.cancelledNote', { reason: payroll.cancelReason || '—' }) }}</p>
        <p>{{ t('admin.myWork.payslip.footer') }}</p>
      </footer>
    </div>
  </div>
</template>

<style>
/* Printed on its own: the sidebar and page chrome stay off the paper. */
@media print {
  .payslip-toolbar {
    display: none !important;
  }
  body * {
    visibility: hidden;
  }
  .payslip,
  .payslip * {
    visibility: visible;
  }
  .payslip {
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    max-width: none;
    border: 0;
    box-shadow: none;
    padding: 0;
  }
  @page {
    size: A4;
    margin: 14mm;
  }
}
</style>
