<script setup lang="ts">
import type { FinanceAging, FinanceLedgerRow, FinanceSummary } from '../composables/useOperationsAdmin'

const { t } = useI18n()
const { hasCapability } = useHub()
const ops = useOperationsAdmin()

const canRead = computed(() => hasCapability('content.read'))

const isoDay = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const today = new Date()
const monthAgo = new Date(today.getTime() - 29 * 86_400_000)

const from = ref(isoDay(monthAgo))
const to = ref(isoDay(today))
const asOf = ref(isoDay(today))
const ledgerState = ref('all')

const summary = ref<FinanceSummary | null>(null)
const aging = ref<FinanceAging | null>(null)
const ledger = ref<FinanceLedgerRow[]>([])
const ledgerTotals = ref({ receivable: 0, payable: 0, voided: 0 })
const ledgerHasMore = ref(false)
const ledgerCursor = ref<string | null>(null)
const loading = ref(false)
const loadingLedger = ref(false)
const error = ref<string | null>(null)

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} ₫`

const describeError = (e: unknown) => {
  const status = (e as { statusCode?: number, status?: number })?.statusCode ?? (e as { status?: number })?.status
  if (status === 401) return t('admin.errors.unauthorized')
  if (status === 403) return t('admin.errors.forbidden')
  if (status === 422) return t('admin.reports.errors.invalidRange')
  if (!status) return t('admin.errors.network')
  if (status === 503) return t('admin.errors.unavailable')
  return t('admin.errors.generic')
}

const methods = computed(() => {
  const keys = new Set<string>([
    ...Object.keys(summary.value?.received.byMethod ?? {}),
    ...Object.keys(summary.value?.paidOut.byMethod ?? {}),
  ])
  return [...keys].sort()
})

const ledgerCsvHref = computed(() => {
  const query = new URLSearchParams({ from: from.value, to: to.value })
  return `/api/v1/admin/reports/finance/ledger.csv?${query.toString()}`
})

async function loadReports() {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const [summaryResult, agingResult] = await Promise.all([
      ops.financeSummary({ from: from.value, to: to.value }),
      ops.financeAging(asOf.value),
    ])
    summary.value = summaryResult
    aging.value = agingResult
    await loadLedger(true)
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loading.value = false
  }
}

async function loadLedger(reset = true) {
  if (!canRead.value) return
  loadingLedger.value = true
  try {
    const page = await ops.financeLedger({
      from: from.value,
      to: to.value,
      state: ledgerState.value === 'all' ? undefined : ledgerState.value,
      cursor: reset ? null : ledgerCursor.value,
    })
    ledger.value = reset ? page.data : [...ledger.value, ...page.data]
    ledgerTotals.value = page.totals
    ledgerCursor.value = page.nextCursor
    ledgerHasMore.value = page.hasMore
  } catch (e) {
    error.value = describeError(e)
  } finally {
    loadingLedger.value = false
  }
}

watch(ledgerState, () => loadLedger())

if (canRead.value) await loadReports()
</script>

<template>
  <div>
    <CmsBasePage
      :title="t('admin.reports.title')"
      :description="t('admin.reports.description')"
      :loading="loading"
      :error="error"
      :empty="!canRead"
      :empty-text="t('admin.reports.permissionDenied')"
      empty-icon="i-lucide-bar-chart-3"
    >
      <template #right>
        <div class="flex items-end gap-2">
          <UFormField :label="t('admin.reports.from')">
            <UInput v-model="from" type="date" size="sm" />
          </UFormField>
          <UFormField :label="t('admin.reports.to')">
            <UInput v-model="to" type="date" size="sm" />
          </UFormField>
          <UButton color="primary" variant="soft" size="sm" icon="i-lucide-refresh-cw" :label="t('admin.reports.apply')" :loading="loading" @click="loadReports" />
        </div>
      </template>

      <div v-if="canRead && summary" class="flex flex-col gap-5">
        <!-- Money in / out -->
        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold text-highlighted">{{ t('admin.reports.summary') }}</h2>
          <p class="text-xs text-muted">{{ t('admin.reports.rangeHint', { from: summary.range.from, to: summary.range.to, timeZone: summary.timeZone }) }}</p>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.received') }}</p>
              <p class="text-lg font-semibold text-highlighted">{{ money(summary.received.total) }}</p>
              <p class="text-xs text-muted">{{ t('admin.reports.paymentCount', { count: summary.received.count }) }}</p>
            </div>
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.paidOut') }}</p>
              <p class="text-lg font-semibold text-highlighted">{{ money(summary.paidOut.total) }}</p>
              <p class="text-xs text-muted">{{ t('admin.reports.paymentCount', { count: summary.paidOut.count }) }}</p>
            </div>
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.net') }}</p>
              <p class="text-lg font-semibold" :class="summary.net >= 0 ? 'text-success' : 'text-error'">{{ money(summary.net) }}</p>
            </div>
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.voided') }}</p>
              <p class="text-lg font-semibold text-highlighted">{{ money(summary.voided.total) }}</p>
              <p class="text-xs text-muted">{{ t('admin.reports.paymentCount', { count: summary.voided.count }) }}</p>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.receivables') }}</p>
              <p class="text-base font-semibold text-highlighted">{{ money(summary.receivables.outstanding) }}</p>
              <p class="text-xs text-muted">
                {{ t('admin.reports.outstandingHint', { count: summary.receivables.count, overdue: summary.receivables.overdueCount }) }}
              </p>
            </div>
            <div class="rounded-[4px] border border-default/60 p-3">
              <p class="text-xs text-muted">{{ t('admin.reports.payables') }}</p>
              <p class="text-base font-semibold text-highlighted">{{ money(summary.payables.outstanding) }}</p>
              <p class="text-xs text-muted">
                {{ t('admin.reports.outstandingHint', { count: summary.payables.count, overdue: summary.payables.overdueCount }) }}
              </p>
            </div>
          </div>

          <div v-if="methods.length" class="overflow-hidden rounded-[4px] border border-default/60">
            <div class="grid grid-cols-3 gap-2 border-b border-default/40 bg-elevated/40 px-3 py-1.5 text-xs font-medium text-muted">
              <span>{{ t('admin.reports.method') }}</span>
              <span class="text-right">{{ t('admin.reports.received') }}</span>
              <span class="text-right">{{ t('admin.reports.paidOut') }}</span>
            </div>
            <div v-for="method in methods" :key="method" class="grid grid-cols-3 gap-2 border-b border-default/40 px-3 py-1.5 text-xs last:border-b-0">
              <span class="text-toned">{{ t(`admin.finance.methods.${method}`) }}</span>
              <span class="text-right">{{ money(summary.received.byMethod[method] ?? 0) }}</span>
              <span class="text-right">{{ money(summary.paidOut.byMethod[method] ?? 0) }}</span>
            </div>
          </div>
        </section>

        <!-- Aging -->
        <section v-if="aging" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <h2 class="text-sm font-semibold text-highlighted">{{ t('admin.reports.aging') }}</h2>
            <div class="flex items-end gap-2">
              <UFormField :label="t('admin.reports.asOf')">
                <UInput v-model="asOf" type="date" size="sm" />
              </UFormField>
              <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-refresh-cw" :label="t('admin.reports.refreshAging')" :loading="loading" @click="loadReports" />
            </div>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <div v-for="group in [
              { key: 'receivables', label: t('admin.reports.receivables'), buckets: aging.receivables, total: aging.totals.receivables },
              { key: 'payables', label: t('admin.reports.payables'), buckets: aging.payables, total: aging.totals.payables },
            ]" :key="group.key" class="overflow-hidden rounded-[4px] border border-default/60">
              <div class="flex items-center justify-between border-b border-default/40 bg-elevated/40 px-3 py-1.5 text-xs font-medium text-muted">
                <span>{{ group.label }}</span>
                <span>{{ money(group.total) }}</span>
              </div>
              <div v-for="bucket in group.buckets" :key="bucket.key" class="flex items-center justify-between border-b border-default/40 px-3 py-1.5 text-xs last:border-b-0">
                <span class="text-toned">{{ t(`admin.reports.buckets.${bucket.key}`) }}</span>
                <span>{{ money(bucket.amount) }} <span class="text-muted">({{ bucket.count }})</span></span>
              </div>
            </div>
          </div>
        </section>

        <!-- Ledger -->
        <section class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-highlighted">{{ t('admin.reports.ledger') }}</h2>
            <div class="flex items-center gap-2">
              <USelect
                v-model="ledgerState"
                :items="[
                  { label: t('admin.reports.allStates'), value: 'all' },
                  { label: t('admin.finance.paymentStates.posted'), value: 'posted' },
                  { label: t('admin.finance.paymentStates.voided'), value: 'voided' },
                ]"
                value-key="value"
                size="sm"
                class="w-40"
              />
              <UButton
                :href="ledgerCsvHref"
                external
                download
                icon="i-lucide-download"
                color="neutral"
                variant="soft"
                size="sm"
                :label="t('admin.reports.exportCsv')"
              />
            </div>
          </div>

          <p class="text-xs text-muted">
            {{ t('admin.reports.ledgerTotals', { receivable: money(ledgerTotals.receivable), payable: money(ledgerTotals.payable), voided: money(ledgerTotals.voided) }) }}
          </p>

          <p v-if="!ledger.length" class="text-xs text-muted">{{ t('admin.reports.ledgerEmpty') }}</p>
          <div v-else class="overflow-hidden rounded-[4px] border border-default/60">
            <div class="grid grid-cols-[7rem_1fr_1fr_7rem_6rem] gap-2 border-b border-default/40 bg-elevated/40 px-3 py-1.5 text-xs font-medium text-muted">
              <span>{{ t('admin.reports.day') }}</span>
              <span>{{ t('admin.reports.code') }}</span>
              <span>{{ t('admin.reports.reference') }}</span>
              <span class="text-right">{{ t('admin.reports.amount') }}</span>
              <span>{{ t('admin.reports.state') }}</span>
            </div>
            <div v-for="row in ledger" :key="row.id" class="grid grid-cols-[7rem_1fr_1fr_7rem_6rem] items-center gap-2 border-b border-default/40 px-3 py-1.5 text-xs last:border-b-0">
              <span class="text-muted">{{ row.day }}</span>
              <span class="truncate font-mono text-highlighted">{{ row.code }}</span>
              <span class="truncate">{{ row.referenceCode }}</span>
              <span class="text-right">{{ money(row.amount) }}</span>
              <span>
                <UBadge :color="row.state === 'voided' ? 'error' : 'neutral'" variant="subtle" size="sm">
                  {{ t(`admin.finance.paymentStates.${row.state}`) }}
                </UBadge>
              </span>
            </div>
          </div>

          <div v-if="ledgerHasMore" class="flex justify-center">
            <UButton color="neutral" variant="ghost" size="sm" :loading="loadingLedger" :label="t('admin.reports.loadMore')" @click="loadLedger(false)" />
          </div>
        </section>
      </div>
    </CmsBasePage>
  </div>
</template>
