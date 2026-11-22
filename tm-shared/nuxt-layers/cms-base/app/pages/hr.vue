<script setup lang="ts">
import type { AdminAttendance, AdminPayroll, AdminSalaryConfig, AdminStaff } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const canWrite = computed(() => hasCapability('content.write'))

type Tab = 'staff' | 'attendance' | 'payroll'
const tab = ref<Tab>('staff')

const { reason: auditReason, resetOnClose } = useAuditReason()

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value)

const describeError = (e: unknown) => {
  const code = ops.errorCode(e) ?? ''
  if (/_REVISION_CONFLICT$/.test(code)) return t('admin.hr.errors.conflict')
  if (/_REVISION_REQUIRED$/.test(code)) return t('admin.hr.errors.revisionRequired')
  if (/_NOT_FOUND$/.test(code)) return t('admin.hr.errors.notFound')
  if (/STAFF_SUBJECT_EXISTS$|STAFF_CODE_EXISTS$|_CODE_EXISTS$/.test(code)) return t('admin.hr.errors.duplicate')
  if (/_LOCKED$|_ALREADY_|_PAID$/.test(code)) return t('admin.hr.errors.locked')
  if (/SALARY_CONFIG_MISSING$|_NO_SALARY_CONFIG$/.test(code)) return t('admin.hr.errors.noSalary')
  if (/ATTENDANCE_TIME_INVALID$|ATTENDANCE_TIMES_NOT_ALLOWED$|ATTENDANCE_DATE_INVALID$/.test(code)) return t('admin.hr.errors.attendanceInvalid')
  if (/_PAYLOAD_INVALID$|_INVALID$/.test(code)) return t('admin.hr.errors.invalid')
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 404) return t('admin.errors.notFound')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

/* --------------------------------- staff --------------------------------- */

const STAFF_POSITIONS = ['director', 'manager', 'staff'] as const
const STAFF_STATUSES = ['probation', 'official', 'resigned'] as const
const ATTENDANCE_STATUSES = ['present', 'late', 'leave', 'absent'] as const
const PAYROLL_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const

const staff = ref<AdminStaff[]>([])
const staffQuery = ref('')
const staffStatus = ref('all')
const staffIncludeDeleted = ref(false)
const staffCounts = ref({ all: 0, probation: 0, official: 0, resigned: 0 })
const staffCursor = ref<string | null>(null)
const staffHasMore = ref(false)
const staffLoading = ref(false)
const staffListError = ref<string | null>(null)

const staffStatusOptions = computed(() => [
  { label: t('admin.hr.staff.allStatuses'), value: 'all' },
  ...STAFF_STATUSES.map(status => ({ label: t(`admin.hr.staff.statuses.${status}`), value: status })),
])

const positionItems = computed<{ label: string, value: string }[]>(() =>
  STAFF_POSITIONS.map(position => ({ label: t(`admin.hr.staff.positions.${position}`), value: position })))

const staffStatusItems = computed<{ label: string, value: string }[]>(() =>
  STAFF_STATUSES.map(status => ({ label: t(`admin.hr.staff.statuses.${status}`), value: status })))

const staffName = (id: string) => staff.value.find(entry => entry.id === id)?.fullName ?? id

const staffOptions = computed(() => staff.value
  .filter(entry => !entry.isDeleted)
  .map(entry => ({ label: `${entry.fullName} (${entry.employeeCode})`, value: entry.id })))

async function loadStaff(reset = true) {
  if (!canRead.value) return
  staffLoading.value = true
  staffListError.value = null
  try {
    const page = await ops.listStaff({
      q: staffQuery.value.trim() || undefined,
      workStatus: staffStatus.value === 'all' ? undefined : staffStatus.value,
      includeDeleted: staffIncludeDeleted.value,
      cursor: reset ? null : staffCursor.value,
      limit: 50,
    })
    staff.value = reset ? page.data : [...staff.value, ...page.data]
    staffCursor.value = page.nextCursor
    staffHasMore.value = page.hasMore
    staffCounts.value = { ...staffCounts.value, ...page.counts }
  } catch (e) {
    staffListError.value = describeError(e)
  } finally {
    staffLoading.value = false
  }
}

watchDebounced(staffQuery, () => loadStaff(), { debounce: 300 })
watch([staffStatus, staffIncludeDeleted], () => loadStaff())

const staffFormOpen = ref(false)
const staffSaving = ref(false)
const staffError = ref<string | null>(null)
const staffEditing = ref<AdminStaff | null>(null)
const staffForm = reactive({
  subjectId: '',
  employeeCode: '',
  fullName: '',
  positionCode: 'staff',
  workStatus: 'probation',
  joinedAt: '',
  leftAt: '',
  phone: '',
  jobDescription: '',
  note: '',
})

function openStaffCreate() {
  staffEditing.value = null
  Object.assign(staffForm, {
    subjectId: '', employeeCode: '', fullName: '', positionCode: 'staff', workStatus: 'probation',
    joinedAt: '', leftAt: '', phone: '', jobDescription: '', note: '',
  })
  auditReason.value = ''
  staffError.value = null
  staffFormOpen.value = true
}

function openStaffEdit(entry: AdminStaff) {
  staffEditing.value = entry
  Object.assign(staffForm, {
    subjectId: entry.subjectId,
    employeeCode: entry.employeeCode,
    fullName: entry.fullName,
    positionCode: entry.positionCode,
    workStatus: entry.workStatus,
    joinedAt: entry.joinedAt ?? '',
    leftAt: entry.leftAt ?? '',
    phone: entry.phone,
    jobDescription: entry.jobDescription,
    note: entry.note,
  })
  auditReason.value = ''
  staffError.value = null
  staffFormOpen.value = true
}

async function submitStaff() {
  if (staffSaving.value) return
  if (!staffForm.fullName.trim() || !staffForm.employeeCode.trim() || !staffForm.subjectId.trim()) {
    staffError.value = t('admin.hr.errors.staffRequired')
    return
  }
  staffSaving.value = true
  staffError.value = null
  try {
    const payload = {
      subjectId: staffForm.subjectId.trim(),
      employeeCode: staffForm.employeeCode.trim().toUpperCase(),
      fullName: staffForm.fullName.trim(),
      positionCode: staffForm.positionCode,
      workStatus: staffForm.workStatus,
      joinedAt: staffForm.joinedAt || null,
      leftAt: staffForm.leftAt || null,
      phone: staffForm.phone.trim(),
      jobDescription: staffForm.jobDescription.trim(),
      note: staffForm.note.trim(),
    }
    if (staffEditing.value) {
      await ops.updateStaff(staffEditing.value.id, { ...payload, revision: staffEditing.value.revision }, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.hr.staff.updated'), color: 'success' })
    } else {
      await ops.createStaff(payload, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.hr.staff.created'), color: 'success' })
    }
    staffFormOpen.value = false
    await loadStaff()
  } catch (e) {
    staffError.value = describeError(e)
  } finally {
    staffSaving.value = false
  }
}

/* ------------------------------- attendance ------------------------------- */

const attendances = ref<AdminAttendance[]>([])
const attendanceMonth = ref(new Date().toISOString().slice(0, 7))
const attendanceStaff = ref('all')
const attendanceStatus = ref('all')
const attendanceSummary = ref<Record<string, number>>({ all: 0, present: 0, late: 0, leave: 0, absent: 0 })
const attendanceLoading = ref(false)
const attendanceError = ref<string | null>(null)

const attendanceStatusOptions = computed(() => [
  { label: t('admin.hr.attendance.allStatuses'), value: 'all' },
  ...ATTENDANCE_STATUSES.map(status => ({ label: t(`admin.hr.attendance.statuses.${status}`), value: status })),
])

const attendanceStatusItems = computed<{ label: string, value: string }[]>(() =>
  ATTENDANCE_STATUSES.map(status => ({ label: t(`admin.hr.attendance.statuses.${status}`), value: status })))

async function loadAttendances() {
  if (!canRead.value) return
  attendanceLoading.value = true
  attendanceError.value = null
  try {
    const page = await ops.listAttendances({
      month: attendanceMonth.value || undefined,
      staffId: attendanceStaff.value === 'all' ? undefined : attendanceStaff.value,
      status: attendanceStatus.value === 'all' ? undefined : attendanceStatus.value,
    })
    attendances.value = page.data
    attendanceSummary.value = page.summary
  } catch (e) {
    attendanceError.value = describeError(e)
  } finally {
    attendanceLoading.value = false
  }
}

watch([attendanceMonth, attendanceStaff, attendanceStatus], () => loadAttendances())

const attendanceFormOpen = ref(false)
const attendanceSaving = ref(false)
const attendanceFormError = ref<string | null>(null)
const attendanceForm = reactive({
  staffId: '',
  date: new Date().toISOString().slice(0, 10),
  status: 'present',
  checkIn: '',
  checkOut: '',
  note: '',
})

function openAttendanceCreate(entry?: AdminAttendance) {
  Object.assign(attendanceForm, {
    staffId: entry?.staffId || staffOptions.value[0]?.value || '',
    date: entry?.date || new Date().toISOString().slice(0, 10),
    status: entry?.status || 'present',
    checkIn: entry?.checkIn || '',
    checkOut: entry?.checkOut || '',
    note: entry?.note || '',
  })
  auditReason.value = ''
  attendanceFormError.value = null
  attendanceFormOpen.value = true
}

async function submitAttendance() {
  if (attendanceSaving.value) return
  if (!attendanceForm.staffId || !attendanceForm.date) {
    attendanceFormError.value = t('admin.hr.errors.attendanceRequired')
    return
  }
  attendanceSaving.value = true
  attendanceFormError.value = null
  try {
    const result = await ops.upsertAttendance({
      staffId: attendanceForm.staffId,
      date: attendanceForm.date,
      status: attendanceForm.status,
      checkIn: attendanceForm.checkIn || null,
      checkOut: attendanceForm.checkOut || null,
      note: attendanceForm.note.trim(),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: result.meta?.created === false ? t('admin.hr.attendance.updated') : t('admin.hr.attendance.created'), color: 'success' })
    attendanceFormOpen.value = false
    await loadAttendances()
  } catch (e) {
    attendanceFormError.value = describeError(e)
  } finally {
    attendanceSaving.value = false
  }
}

/* -------------------------------- payroll -------------------------------- */

const payrolls = ref<AdminPayroll[]>([])
const payrollPeriod = ref(new Date().toISOString().slice(0, 7))
const payrollStaff = ref('all')
const payrollStatus = ref('all')
const payrollCounts = ref({ all: 0, draft: 0, approved: 0, paid: 0, cancelled: 0 })
const payrollTotals = ref({ netPay: 0, workDays: 0 })
const payrollLoading = ref(false)
const payrollError = ref<string | null>(null)

const payrollStatusOptions = computed(() => [
  { label: t('admin.hr.payroll.allStatuses'), value: 'all' },
  ...PAYROLL_STATUSES.map(status => ({ label: t(`admin.hr.payroll.statuses.${status}`), value: status })),
])

async function loadPayrolls() {
  if (!canWrite.value) return
  payrollLoading.value = true
  payrollError.value = null
  try {
    const page = await ops.listPayrolls({
      period: payrollPeriod.value || undefined,
      staffId: payrollStaff.value === 'all' ? undefined : payrollStaff.value,
      status: payrollStatus.value === 'all' ? undefined : payrollStatus.value,
      limit: 100,
    })
    payrolls.value = page.data
    payrollCounts.value = { ...payrollCounts.value, ...page.counts }
    payrollTotals.value = page.totals
  } catch (e) {
    payrollError.value = describeError(e)
  } finally {
    payrollLoading.value = false
  }
}

watch([payrollPeriod, payrollStaff, payrollStatus], () => loadPayrolls())

const calculateOpen = ref(false)
const calculateSaving = ref(false)
const calculateError = ref<string | null>(null)
const calculateForm = reactive({
  period: new Date().toISOString().slice(0, 7),
  staffId: 'all',
  adjustments: [] as { label: string, amount: number }[],
})

function openCalculate() {
  calculateForm.period = payrollPeriod.value || new Date().toISOString().slice(0, 7)
  calculateForm.staffId = payrollStaff.value
  calculateForm.adjustments = []
  auditReason.value = ''
  calculateError.value = null
  calculateOpen.value = true
}

async function submitCalculate() {
  if (calculateSaving.value) return
  calculateSaving.value = true
  calculateError.value = null
  try {
    const adjustments = calculateForm.adjustments
      .filter(line => line.label.trim() && Number(line.amount) !== 0)
      .map(line => ({ label: line.label.trim(), amount: Math.trunc(Number(line.amount)) }))
    await ops.calculatePayroll({
      period: calculateForm.period,
      ...(calculateForm.staffId === 'all' ? {} : { staffId: calculateForm.staffId }),
      adjustments,
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.hr.payroll.calculated'), color: 'success' })
    calculateOpen.value = false
    payrollPeriod.value = calculateForm.period
    await loadPayrolls()
  } catch (e) {
    calculateError.value = describeError(e)
  } finally {
    calculateSaving.value = false
  }
}

const cancelOpen = ref(false)
const cancelSaving = ref(false)
const cancelError = ref<string | null>(null)
const cancelTarget = ref<AdminPayroll | null>(null)
const cancelReason = ref('')

function openCancelPayroll(entry: AdminPayroll) {
  cancelTarget.value = entry
  cancelReason.value = ''
  auditReason.value = ''
  cancelError.value = null
  cancelOpen.value = true
}

async function submitCancelPayroll() {
  if (cancelSaving.value || !cancelTarget.value) return
  if (cancelReason.value.trim().length < 3) {
    cancelError.value = t('admin.hr.errors.cancelReason')
    return
  }
  cancelSaving.value = true
  cancelError.value = null
  try {
    await ops.cancelPayroll(cancelTarget.value.id, cancelTarget.value.revision, cancelReason.value.trim(), auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.hr.payroll.cancelled'), color: 'success' })
    cancelOpen.value = false
    await loadPayrolls()
  } catch (e) {
    cancelError.value = describeError(e)
  } finally {
    cancelSaving.value = false
  }
}

async function movePayroll(entry: AdminPayroll, action: 'approve' | 'pay') {
  try {
    if (action === 'approve') {
      await ops.approvePayroll(entry.id, entry.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.hr.payroll.approved'), color: 'success' })
    } else {
      await ops.payPayroll(entry.id, entry.revision, auditReason.value.trim() || undefined)
      toast.add({ title: t('admin.hr.payroll.paid'), color: 'success' })
    }
    await loadPayrolls()
  } catch (e) {
    toast.add({ title: describeError(e), color: 'error' })
  }
}

/* ----------------------------- salary configs ---------------------------- */

const salaryOpen = ref(false)
const salarySaving = ref(false)
const salaryError = ref<string | null>(null)
const salaryTarget = ref<AdminStaff | null>(null)
const salaryConfigs = ref<AdminSalaryConfig[]>([])
const salaryLoading = ref(false)
const salaryForm = reactive({
  baseSalary: 0,
  standardWorkDays: 26,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  note: '',
  allowances: [] as { title: string, amount: number }[],
})

async function openSalary(entry: AdminStaff) {
  salaryTarget.value = entry
  salaryConfigs.value = []
  Object.assign(salaryForm, {
    baseSalary: 0,
    standardWorkDays: 26,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    note: '',
    allowances: [],
  })
  auditReason.value = ''
  salaryError.value = null
  salaryOpen.value = true
  salaryLoading.value = true
  try {
    salaryConfigs.value = await ops.listSalaryConfigs(entry.id)
  } catch (e) {
    salaryError.value = describeError(e)
  } finally {
    salaryLoading.value = false
  }
}

async function submitSalary() {
  if (salarySaving.value || !salaryTarget.value) return
  salarySaving.value = true
  salaryError.value = null
  try {
    await ops.setSalaryConfig({
      staffId: salaryTarget.value.id,
      baseSalary: Math.trunc(Number(salaryForm.baseSalary)) || 0,
      standardWorkDays: Math.trunc(Number(salaryForm.standardWorkDays)) || 26,
      effectiveFrom: salaryForm.effectiveFrom,
      note: salaryForm.note.trim(),
      allowances: salaryForm.allowances
        .filter(line => line.title.trim() && Number(line.amount) > 0)
        .map(line => ({ title: line.title.trim(), amount: Math.trunc(Number(line.amount)) })),
    }, auditReason.value.trim() || undefined)
    toast.add({ title: t('admin.hr.salary.saved'), color: 'success' })
    salaryConfigs.value = await ops.listSalaryConfigs(salaryTarget.value.id)
  } catch (e) {
    salaryError.value = describeError(e)
  } finally {
    salarySaving.value = false
  }
}

/* --------------------------- hide / restore staff ------------------------ */

const confirmOpen = ref(false)
const confirmBusy = ref(false)
const confirmError = ref<string | null>(null)
const confirmMode = ref<'delete' | 'restore'>('delete')
const confirmStaff = ref<AdminStaff | null>(null)
const confirmAttendance = ref<AdminAttendance | null>(null)

function askStaff(entry: AdminStaff, mode: 'delete' | 'restore') {
  confirmMode.value = mode
  confirmStaff.value = entry
  confirmAttendance.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

function askAttendance(entry: AdminAttendance) {
  confirmMode.value = 'delete'
  confirmAttendance.value = entry
  confirmStaff.value = null
  auditReason.value = ''
  confirmError.value = null
  confirmOpen.value = true
}

async function runConfirm() {
  if (confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = null
  try {
    const note = auditReason.value.trim() || undefined
    if (confirmAttendance.value) {
      await ops.deleteAttendance(confirmAttendance.value.id, note)
      toast.add({ title: t('admin.hr.attendance.deleted'), color: 'success' })
      await loadAttendances()
    } else if (confirmStaff.value) {
      if (confirmMode.value === 'restore') {
        await ops.restoreStaff(confirmStaff.value.id, confirmStaff.value.revision, note)
        toast.add({ title: t('admin.hr.staff.restored'), color: 'success' })
      } else {
        await ops.deleteStaff(confirmStaff.value.id, confirmStaff.value.revision, note)
        toast.add({ title: t('admin.hr.staff.hidden'), color: 'success' })
      }
      await loadStaff()
    }
    confirmOpen.value = false
  } catch (e) {
    confirmError.value = describeError(e)
  } finally {
    confirmBusy.value = false
  }
}

if (canRead.value) await Promise.all([loadStaff(), loadAttendances()])
if (canWrite.value) await loadPayrolls()

resetOnClose(staffFormOpen, attendanceFormOpen, calculateOpen, cancelOpen, salaryOpen, confirmOpen)
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.hr.title')"
      :description="t('admin.hr.description')"
      :loading="staffLoading && !staff.length"
      :error="staffListError"
      :empty="false"
    >
      <template #right>
        <UButton
          v-if="canWrite && tab === 'staff'"
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.hr.staff.create')"
          @click="openStaffCreate"
        />
        <UButton
          v-else-if="canWrite && tab === 'attendance'"
          icon="i-lucide-calendar-check"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.hr.attendance.create')"
          @click="openAttendanceCreate()"
        />
        <UButton
          v-else-if="canWrite && tab === 'payroll'"
          icon="i-lucide-calculator"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('admin.hr.payroll.calculate')"
          @click="openCalculate"
        />
      </template>

      <div v-if="canRead" class="flex flex-col gap-3">
        <div class="flex flex-wrap gap-2">
          <UButton
            icon="i-lucide-id-card"
            :label="t('admin.hr.tabs.staff')"
            size="sm"
            :color="tab === 'staff' ? 'primary' : 'neutral'"
            :variant="tab === 'staff' ? 'soft' : 'ghost'"
            @click="tab = 'staff'"
          />
          <UButton
            icon="i-lucide-calendar-check"
            :label="t('admin.hr.tabs.attendance')"
            size="sm"
            :color="tab === 'attendance' ? 'primary' : 'neutral'"
            :variant="tab === 'attendance' ? 'soft' : 'ghost'"
            @click="tab = 'attendance'"
          />
          <UButton
            icon="i-lucide-banknote"
            :label="t('admin.hr.tabs.payroll')"
            size="sm"
            :color="tab === 'payroll' ? 'primary' : 'neutral'"
            :variant="tab === 'payroll' ? 'soft' : 'ghost'"
            @click="tab = 'payroll'"
          />
        </div>

        <!-- Staff -->
        <template v-if="tab === 'staff'">
          <div class="flex flex-wrap items-center gap-3">
            <UInput v-model="staffQuery" icon="i-lucide-search" size="sm" class="w-full sm:w-64" :placeholder="t('admin.hr.staff.searchPlaceholder')" />
            <USelect v-model="staffStatus" :items="staffStatusOptions" value-key="value" size="sm" class="w-full sm:w-44" />
            <USwitch v-model="staffIncludeDeleted" size="sm" :label="t('admin.hr.includeDeleted')" />
            <p class="text-xs text-muted">
              {{ t('admin.hr.staff.summary', { all: staffCounts.all, probation: staffCounts.probation, official: staffCounts.official, resigned: staffCounts.resigned }) }}
            </p>
          </div>

          <p v-if="!staffLoading && !staff.length" class="text-xs text-muted">
            {{ staffQuery || staffStatus !== 'all' || staffIncludeDeleted ? t('admin.hr.noMatch') : t('admin.hr.staff.empty') }}
          </p>

          <div v-if="staff.length" class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="entry in staff" :key="entry.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs font-medium text-highlighted">{{ entry.employeeCode }}</span>
                  <span class="truncate font-medium text-highlighted">{{ entry.fullName }}</span>
                  <UBadge color="neutral" variant="subtle" size="sm">{{ t(`admin.hr.staff.positions.${entry.positionCode}`) }}</UBadge>
                  <UBadge :color="entry.workStatus === 'resigned' ? 'error' : entry.workStatus === 'official' ? 'success' : 'neutral'" variant="subtle" size="sm">
                    {{ t(`admin.hr.staff.statuses.${entry.workStatus}`) }}
                  </UBadge>
                  <UBadge v-if="entry.isDeleted" color="error" variant="subtle" size="sm">{{ t('admin.hr.badgeHidden') }}</UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span>{{ entry.subjectId }}</span>
                  <span v-if="entry.phone"> · {{ entry.phone }}</span>
                  <span v-if="entry.joinedAt"> · {{ t('admin.hr.staff.joined', { date: entry.joinedAt }) }}</span>
                </p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('common.edit')" @click="openStaffEdit(entry)" />
                <UButton icon="i-lucide-banknote" color="neutral" variant="ghost" size="xs" :title="t('admin.hr.salary.open')" @click="openSalary(entry)" />
                <UButton
                  v-if="entry.isDeleted"
                  icon="i-lucide-rotate-ccw"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.hr.staff.restore')"
                  @click="askStaff(entry, 'restore')"
                />
                <UButton
                  v-else
                  icon="i-lucide-archive"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :title="t('admin.hr.staff.hide')"
                  @click="askStaff(entry, 'delete')"
                />
              </div>
            </div>
          </div>

          <div v-if="staffHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="staffLoading" :label="t('admin.hr.loadMore')" @click="loadStaff(false)" />
          </div>
        </template>

        <!-- Attendance -->
        <template v-else-if="tab === 'attendance'">
          <div class="flex flex-wrap items-center gap-3">
            <UInput v-model="attendanceMonth" type="month" size="sm" class="w-full sm:w-44" />
            <USelect v-model="attendanceStaff" :items="[{ label: t('admin.hr.attendance.allStaff'), value: 'all' }, ...staffOptions]" value-key="value" size="sm" class="w-full sm:w-56" />
            <USelect v-model="attendanceStatus" :items="attendanceStatusOptions" value-key="value" size="sm" class="w-full sm:w-40" />
            <p class="text-xs text-muted">
              {{ t('admin.hr.attendance.summary', { all: attendanceSummary.all, present: attendanceSummary.present, late: attendanceSummary.late, leave: attendanceSummary.leave, absent: attendanceSummary.absent }) }}
            </p>
          </div>

          <p v-if="attendanceError" class="text-xs text-error">{{ attendanceError }}</p>
          <p v-else-if="!attendanceLoading && !attendances.length" class="text-xs text-muted">{{ t('admin.hr.attendance.empty') }}</p>

          <div v-if="attendances.length" class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="entry in attendances" :key="entry.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-xs text-highlighted">{{ entry.date }}</span>
                  <span class="truncate font-medium text-highlighted">{{ staffName(entry.staffId) }}</span>
                  <UBadge :color="entry.status === 'present' ? 'success' : entry.status === 'late' ? 'primary' : entry.status === 'leave' ? 'neutral' : 'error'" variant="subtle" size="sm">
                    {{ t(`admin.hr.attendance.statuses.${entry.status}`) }}
                  </UBadge>
                </div>
                <p class="mt-0.5 truncate text-xs text-muted">
                  <span v-if="entry.checkIn || entry.checkOut">{{ entry.checkIn || '—' }} → {{ entry.checkOut || '—' }}</span>
                  <span v-if="entry.note"> · {{ entry.note }}</span>
                </p>
              </div>
              <div v-if="canWrite" class="flex items-center gap-1">
                <UButton icon="i-lucide-pencil" color="neutral" variant="ghost" size="xs" :title="t('admin.hr.attendance.correct')" @click="openAttendanceCreate(entry)" />
                <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.hr.attendance.delete')" @click="askAttendance(entry)" />
              </div>
            </div>
          </div>
        </template>

        <!-- Payroll -->
        <template v-else>
          <div v-if="!canWrite" class="rounded-[4px] border border-default/60 p-4 text-sm text-muted">
            {{ t('admin.hr.payroll.permissionDenied') }}
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-3">
              <UInput v-model="payrollPeriod" type="month" size="sm" class="w-full sm:w-44" />
              <USelect v-model="payrollStaff" :items="[{ label: t('admin.hr.attendance.allStaff'), value: 'all' }, ...staffOptions]" value-key="value" size="sm" class="w-full sm:w-56" />
              <USelect v-model="payrollStatus" :items="payrollStatusOptions" value-key="value" size="sm" class="w-full sm:w-40" />
              <p class="text-xs text-muted">
                {{ t('admin.hr.payroll.summary', { all: payrollCounts.all, draft: payrollCounts.draft, approved: payrollCounts.approved, paid: payrollCounts.paid, cancelled: payrollCounts.cancelled, total: money(payrollTotals.netPay) }) }}
              </p>
            </div>

            <p v-if="payrollError" class="text-xs text-error">{{ payrollError }}</p>
            <p v-else-if="!payrollLoading && !payrolls.length" class="text-xs text-muted">{{ t('admin.hr.payroll.empty') }}</p>

            <div v-if="payrolls.length" class="overflow-hidden rounded-[4px] border border-default/60">
              <div v-for="entry in payrolls" :key="entry.id" class="flex flex-wrap items-center gap-3 border-b border-default/40 px-3 py-2 text-sm last:border-b-0">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs text-highlighted">{{ entry.period }}</span>
                    <span class="truncate font-medium text-highlighted">{{ staffName(entry.staffId) }}</span>
                    <UBadge :color="entry.status === 'paid' ? 'success' : entry.status === 'cancelled' ? 'error' : entry.status === 'approved' ? 'primary' : 'neutral'" variant="subtle" size="sm">
                      {{ t(`admin.hr.payroll.statuses.${entry.status}`) }}
                    </UBadge>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted">
                    <span>{{ money(entry.netPay) }}</span>
                    <span> · {{ t('admin.hr.payroll.days', { work: entry.workDays, leave: entry.leaveDays, absent: entry.absentDays }) }}</span>
                    <span v-if="entry.adjustmentTotal"> · {{ t('admin.hr.payroll.adjustment', { amount: money(entry.adjustmentTotal) }) }}</span>
                    <span v-if="entry.cancelReason"> · {{ entry.cancelReason }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-1">
                  <UButton v-if="entry.status === 'draft'" icon="i-lucide-check" color="primary" variant="ghost" size="xs" :title="t('admin.hr.payroll.approve')" @click="movePayroll(entry, 'approve')" />
                  <UButton v-if="entry.status === 'approved'" icon="i-lucide-banknote" color="primary" variant="ghost" size="xs" :title="t('admin.hr.payroll.pay')" @click="movePayroll(entry, 'pay')" />
                  <UButton v-if="entry.status === 'draft' || entry.status === 'approved'" icon="i-lucide-ban" color="error" variant="ghost" size="xs" :title="t('admin.hr.payroll.cancel')" @click="openCancelPayroll(entry)" />
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>
    </CmsBasePage>

    <!-- Staff form -->
    <UModal v-model:open="staffFormOpen" :title="staffEditing ? t('admin.hr.staff.editTitle') : t('admin.hr.staff.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.hr.staff.fields.subjectId')">
              <UInput v-model="staffForm.subjectId" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.employeeCode')">
              <UInput v-model="staffForm.employeeCode" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.fullName')">
              <UInput v-model="staffForm.fullName" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.phone')">
              <UInput v-model="staffForm.phone" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.position')">
              <USelect v-model="staffForm.positionCode" :items="positionItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.workStatus')">
              <USelect v-model="staffForm.workStatus" :items="staffStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.joinedAt')">
              <UInput v-model="staffForm.joinedAt" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.staff.fields.leftAt')">
              <UInput v-model="staffForm.leftAt" type="date" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="t('admin.hr.staff.fields.jobDescription')">
            <UTextarea v-model="staffForm.jobDescription" :rows="2" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.hr.staff.fields.note')">
            <UTextarea v-model="staffForm.note" :rows="2" class="w-full" />
          </UFormField>
          <AuditReasonField v-model="auditReason" />
          <p v-if="staffError" class="text-xs text-error">{{ staffError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="staffFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="staffSaving" :label="t('common.save')" @click="submitStaff" />
        </div>
      </template>
    </UModal>

    <!-- Attendance form -->
    <UModal v-model:open="attendanceFormOpen" :title="t('admin.hr.attendance.createTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <UFormField :label="t('admin.hr.attendance.fields.staff')">
            <USelect v-model="attendanceForm.staffId" :items="staffOptions" value-key="value" class="w-full" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.hr.attendance.fields.date')">
              <UInput v-model="attendanceForm.date" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.attendance.fields.status')">
              <USelect v-model="attendanceForm.status" :items="attendanceStatusItems" value-key="value" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.attendance.fields.checkIn')">
              <UInput v-model="attendanceForm.checkIn" type="time" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.attendance.fields.checkOut')">
              <UInput v-model="attendanceForm.checkOut" type="time" class="w-full" />
            </UFormField>
          </div>
          <UFormField :label="t('admin.hr.attendance.fields.note')">
            <UInput v-model="attendanceForm.note" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted">{{ t('admin.hr.attendance.hint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="attendanceFormError" class="text-xs text-error">{{ attendanceFormError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="attendanceFormOpen = false" />
          <UButton color="primary" variant="soft" :loading="attendanceSaving" :label="t('common.save')" @click="submitAttendance" />
        </div>
      </template>
    </UModal>

    <!-- Calculate payroll -->
    <UModal v-model:open="calculateOpen" :title="t('admin.hr.payroll.calculateTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-lg' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.hr.payroll.fields.period')">
              <UInput v-model="calculateForm.period" type="month" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.payroll.fields.staff')">
              <USelect v-model="calculateForm.staffId" :items="[{ label: t('admin.hr.attendance.allStaff'), value: 'all' }, ...staffOptions]" value-key="value" class="w-full" />
            </UFormField>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.hr.payroll.adjustments') }}</p>
            <UButton icon="i-lucide-plus" color="neutral" variant="ghost" size="xs" :label="t('admin.hr.payroll.addAdjustment')" @click="calculateForm.adjustments.push({ label: '', amount: 0 })" />
          </div>
          <div v-for="(line, index) in calculateForm.adjustments" :key="index" class="flex items-end gap-2">
            <UInput v-model="line.label" :placeholder="t('admin.hr.payroll.fields.adjustmentLabel')" size="sm" class="flex-1" />
            <UInput v-model.number="line.amount" type="number" size="sm" class="w-32" />
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.hr.payroll.removeAdjustment')" @click="calculateForm.adjustments.splice(index, 1)" />
          </div>
          <p class="text-xs text-muted">{{ t('admin.hr.payroll.calculateHint') }}</p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="calculateError" class="text-xs text-error">{{ calculateError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="calculateOpen = false" />
          <UButton color="primary" variant="soft" :loading="calculateSaving" :label="t('admin.hr.payroll.calculateSubmit')" @click="submitCalculate" />
        </div>
      </template>
    </UModal>

    <!-- Cancel payroll -->
    <UModal v-model:open="cancelOpen" :title="t('admin.hr.payroll.cancelTitle')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <UFormField :label="t('admin.hr.payroll.fields.cancelReason')">
            <UInput v-model="cancelReason" class="w-full" />
          </UFormField>
          <AuditReasonField v-model="auditReason" />
          <p v-if="cancelError" class="text-xs text-error">{{ cancelError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="cancelOpen = false" />
          <UButton color="error" variant="soft" :loading="cancelSaving" :label="t('admin.hr.payroll.cancel')" @click="submitCancelPayroll" />
        </div>
      </template>
    </UModal>

    <!-- Salary config -->
    <UModal v-model:open="salaryOpen" :title="t('admin.hr.salary.title', { name: salaryTarget?.fullName || '' })" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-xl' }">
      <template #body>
        <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
          <p class="text-sm font-medium text-highlighted">{{ t('admin.hr.salary.history') }}</p>
          <p v-if="salaryLoading" class="text-xs text-muted">{{ t('common.loading') }}</p>
          <p v-else-if="!salaryConfigs.length" class="text-xs text-muted">{{ t('admin.hr.salary.empty') }}</p>
          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div v-for="config in salaryConfigs" :key="config.id" class="border-b border-default/40 px-3 py-2 text-xs last:border-b-0">
              <p class="text-highlighted">
                {{ money(config.baseSalary) }} · {{ t('admin.hr.salary.days', { days: config.standardWorkDays }) }} · {{ config.effectiveFrom }}
              </p>
              <p class="text-muted">
                {{ t('admin.hr.salary.allowanceTotal', { amount: money(config.allowanceTotal) }) }}
                <span v-if="config.allowances.length"> · {{ config.allowances.map(entry => `${entry.title} ${money(entry.amount)}`).join(', ') }}</span>
              </p>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('admin.hr.salary.fields.baseSalary')">
              <UInput v-model.number="salaryForm.baseSalary" type="number" min="0" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.salary.fields.standardWorkDays')">
              <UInput v-model.number="salaryForm.standardWorkDays" type="number" min="1" max="31" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.salary.fields.effectiveFrom')">
              <UInput v-model="salaryForm.effectiveFrom" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="t('admin.hr.salary.fields.note')">
              <UInput v-model="salaryForm.note" class="w-full" />
            </UFormField>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium text-highlighted">{{ t('admin.hr.salary.allowances') }}</p>
            <UButton icon="i-lucide-plus" color="neutral" variant="ghost" size="xs" :label="t('admin.hr.salary.addAllowance')" @click="salaryForm.allowances.push({ title: '', amount: 0 })" />
          </div>
          <div v-for="(line, index) in salaryForm.allowances" :key="index" class="flex items-end gap-2">
            <UInput v-model="line.title" :placeholder="t('admin.hr.salary.fields.allowanceTitle')" size="sm" class="flex-1" />
            <UInput v-model.number="line.amount" type="number" min="0" size="sm" class="w-32" />
            <UButton icon="i-lucide-trash-2" color="error" variant="ghost" size="xs" :title="t('admin.hr.salary.removeAllowance')" @click="salaryForm.allowances.splice(index, 1)" />
          </div>

          <AuditReasonField v-model="auditReason" />
          <p v-if="salaryError" class="text-xs text-error">{{ salaryError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.close')" @click="salaryOpen = false" />
          <UButton color="primary" variant="soft" :loading="salarySaving" :label="t('admin.hr.salary.save')" @click="submitSalary" />
        </div>
      </template>
    </UModal>

    <!-- Hide / restore / delete day -->
    <UModal v-model:open="confirmOpen" :title="confirmMode === 'restore' ? t('admin.hr.staff.restore') : confirmAttendance ? t('admin.hr.attendance.delete') : t('admin.hr.staff.hide')" :ui="{ content: 'w-[calc(100vw-2rem)] max-w-md' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <p class="text-sm text-toned">
            {{ confirmAttendance
              ? t('admin.hr.attendance.deleteHint', { date: confirmAttendance.date, name: staffName(confirmAttendance.staffId) })
              : confirmMode === 'restore'
                ? t('admin.hr.staff.restoreHint', { code: confirmStaff?.employeeCode || '' })
                : t('admin.hr.staff.hideHint', { code: confirmStaff?.employeeCode || '' }) }}
          </p>
          <AuditReasonField v-model="auditReason" />
          <p v-if="confirmError" class="text-xs text-error">{{ confirmError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="confirmOpen = false" />
          <UButton :color="confirmAttendance || confirmMode === 'delete' ? 'error' : 'primary'" variant="soft" :loading="confirmBusy" :label="t('common.save')" @click="runConfirm" />
        </div>
      </template>
    </UModal>
  </div>
</template>
