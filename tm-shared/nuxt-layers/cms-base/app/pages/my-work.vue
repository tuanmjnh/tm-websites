<script setup lang="ts">
import type { AdminAttendance, AdminPayroll, AdminStaff } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const ops = useOperationsAdmin()

const month = ref(new Date().toISOString().slice(0, 7))
const staff = ref<AdminStaff | null>(null)
const attendances = ref<AdminAttendance[]>([])
const attendanceSummary = ref<Record<string, number>>({ all: 0, present: 0, late: 0, leave: 0, absent: 0 })
const payrolls = ref<AdminPayroll[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const notLinked = ref(false)

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const attendanceColor = (status: string) =>
  status === 'present' ? 'success' : status === 'late' ? 'primary' : status === 'leave' ? 'neutral' : 'error'

const payrollColor = (status: string) =>
  status === 'paid' ? 'success' : status === 'approved' ? 'primary' : status === 'cancelled' ? 'error' : 'neutral'

function describeError(e: unknown) {
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.myWork.errors.load')
}

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const [attendance, payroll] = await Promise.all([
      ops.myAttendance(month.value || undefined),
      ops.myPayroll(month.value || undefined),
    ])
    staff.value = attendance.staff
    attendances.value = attendance.data
    attendanceSummary.value = attendance.summary
    payrolls.value = payroll.data
    notLinked.value = false
  } catch (e) {
    if (ops.errorCode(e) === 'STAFF_NOT_FOUND') {
      notLinked.value = true
      staff.value = null
      attendances.value = []
      payrolls.value = []
    } else {
      error.value = describeError(e)
    }
  } finally {
    loading.value = false
  }
}

watch(month, () => load())

await load()
</script>

<template>
  <CmsBasePage
    :title="t('admin.myWork.title')"
    :description="t('admin.myWork.description')"
    :loading="loading && !staff && !notLinked"
    :error="error"
  >
    <template #error-retry>
      <UButton class="mt-3" color="neutral" variant="soft" size="sm" :loading="loading" :label="t('admin.myWork.retry')" @click="load" />
    </template>

    <div v-if="notLinked" class="panel flex flex-col items-center justify-center border-dashed p-12 text-center">
      <UIcon name="i-lucide-id-card" class="mb-3 size-12 text-muted" />
      <p class="text-sm font-medium text-highlighted">{{ t('admin.myWork.noProfileTitle') }}</p>
      <p class="mt-1 max-w-md text-xs text-muted">{{ t('admin.myWork.noProfile') }}</p>
    </div>

    <div v-else-if="staff" class="flex flex-col gap-5">
      <div class="panel flex flex-wrap items-center gap-3 p-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-xs text-highlighted">{{ staff.employeeCode }}</span>
            <span class="truncate text-base font-semibold text-highlighted">{{ staff.fullName }}</span>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ t(`admin.hr.staff.positions.${staff.positionCode}`) }}
            </UBadge>
            <UBadge :color="staff.workStatus === 'resigned' ? 'error' : staff.workStatus === 'official' ? 'success' : 'neutral'" variant="subtle" size="sm">
              {{ t(`admin.hr.staff.statuses.${staff.workStatus}`) }}
            </UBadge>
          </div>
          <p class="mt-0.5 truncate text-xs text-muted">
            <span v-if="staff.phone">{{ staff.phone }}</span>
            <span v-if="staff.joinedAt"> · {{ t('admin.hr.staff.joined', { date: staff.joinedAt }) }}</span>
          </p>
        </div>
        <UInput v-model="month" type="month" size="sm" class="w-full sm:w-44" />
      </div>

      <section class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-medium text-highlighted">{{ t('admin.myWork.attendanceTitle') }}</h2>
          <p class="text-xs text-muted">
            {{ t('admin.hr.attendance.summary', {
              all: attendanceSummary.all,
              present: attendanceSummary.present,
              late: attendanceSummary.late,
              leave: attendanceSummary.leave,
              absent: attendanceSummary.absent,
            }) }}
          </p>
        </div>

        <p v-if="!attendances.length" class="text-xs text-muted">{{ t('admin.myWork.attendanceEmpty') }}</p>

        <div v-if="attendances.length" class="overflow-hidden rounded-[4px] border border-default/60">
          <div v-for="entry in attendances" :key="entry.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
            <span class="font-mono text-xs text-highlighted">{{ entry.date }}</span>
            <UBadge :color="attendanceColor(entry.status)" variant="subtle" size="sm">
              {{ t(`admin.hr.attendance.statuses.${entry.status}`) }}
            </UBadge>
            <span class="text-xs text-muted">{{ entry.checkIn || '—' }} → {{ entry.checkOut || '—' }}</span>
            <span v-if="entry.note" class="min-w-0 flex-1 truncate text-xs text-muted">{{ entry.note }}</span>
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h2 class="text-sm font-medium text-highlighted">{{ t('admin.myWork.payrollTitle') }}</h2>

        <p v-if="!payrolls.length" class="text-xs text-muted">{{ t('admin.myWork.payrollEmpty') }}</p>

        <div v-if="payrolls.length" class="overflow-hidden rounded-[4px] border border-default/60">
          <div v-for="entry in payrolls" :key="entry.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs text-highlighted">{{ entry.period }}</span>
                <UBadge :color="payrollColor(entry.status)" variant="subtle" size="sm">
                  {{ t(`admin.hr.payroll.statuses.${entry.status}`) }}
                </UBadge>
                <span class="text-sm font-medium text-highlighted">{{ t('admin.myWork.netPay') }} {{ money(entry.netPay) }}</span>
              </div>
              <p class="mt-0.5 truncate text-xs text-muted">
                <span>{{ t('admin.hr.payroll.days', { work: entry.workDays, leave: entry.leaveDays, absent: entry.absentDays }) }}</span>
                <span v-if="entry.adjustmentTotal"> · {{ t('admin.hr.payroll.adjustment', { amount: money(entry.adjustmentTotal) }) }}</span>
                <span v-if="entry.paidAt"> · {{ entry.paidAt }}</span>
                <span v-if="entry.cancelReason"> · {{ entry.cancelReason }}</span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </CmsBasePage>
</template>
