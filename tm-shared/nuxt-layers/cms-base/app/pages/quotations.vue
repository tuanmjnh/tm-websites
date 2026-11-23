<script setup lang="ts">
import type { AdminQuotation } from '../composables/useQuotationsAdmin'

const { t } = useI18n()
const { hasCapability } = useHub()
const { listQuotations } = useQuotationsAdmin()

const canRead = computed(() => hasCapability('content.read'))
const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted'] as const

const loading = ref(false)
const error = ref<string | null>(null)
const rows = ref<AdminQuotation[]>([])
const query = ref('')
const statusFilter = ref('all')
const nextCursor = ref<string | null>(null)
const hasMore = ref(false)
const counts = ref<Record<string, number>>({})

const currencyOf = (row: AdminQuotation) => row.currency || 'VND'
const money = (value: number, currency: string) =>
  `${new Intl.NumberFormat('vi-VN').format(value)} ${currency}`

const load = async (append = false) => {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try {
    const result = await listQuotations({
      q: query.value.trim() || undefined,
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      cursor: append ? nextCursor.value : undefined,
      limit: 20,
    })
    rows.value = append ? [...rows.value, ...result.data] : result.data
    nextCursor.value = result.nextCursor
    hasMore.value = result.hasMore
    counts.value = result.counts
  } catch {
    error.value = t('admin.quotations.loadFailed')
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void load() }, 300)
})
watch(statusFilter, () => { void load() })

onMounted(() => { void load() })

const statusColor = (status: string) => {
  if (status === 'accepted') return 'success'
  if (status === 'rejected' || status === 'expired') return 'error'
  if (status === 'sent') return 'info'
  if (status === 'converted') return 'neutral'
  return 'warning'
}

const dateOf = (value: string | number | null | undefined) => {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('vi-VN')
}
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold text-highlighted">{{ t('admin.quotations.title') }}</h1>
        <p class="mt-1 text-sm text-muted">{{ t('admin.quotations.description') }}</p>
      </div>
      <UBadge v-if="counts.active !== undefined" variant="subtle" color="neutral">
        {{ counts.active }} / {{ counts.all }}
      </UBadge>
    </header>

    <p v-if="!canRead" class="rounded-md border border-default p-4 text-sm text-muted">
      {{ t('admin.quotations.noAccess') }}
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <UInput
          v-model="query"
          icon="i-lucide-search"
          :placeholder="t('admin.quotations.searchPlaceholder')"
          class="w-full sm:w-72"
        />
        <USelect
          v-model="statusFilter"
          :items="[
            { label: t('admin.quotations.allStatuses'), value: 'all' },
            ...QUOTATION_STATUSES.map(status => ({ label: t(`admin.quotations.statuses.${status}`), value: status })),
          ]"
          class="w-44"
        />
        <UButton
          variant="soft"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :label="t('admin.quotations.reload')"
          @click="load()"
        />
      </div>

      <p v-if="error" class="rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">{{ error }}</p>

      <div class="overflow-hidden rounded-md border border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-elevated/40 text-xs uppercase text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('admin.quotations.code') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.quotations.customer') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.quotations.status') }}</th>
              <th class="px-3 py-2 text-right font-medium">{{ t('admin.quotations.total') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.quotations.validUntil') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.quotations.createdAt') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-default/60">
            <tr v-for="row in rows" :key="row.id" class="hover:bg-elevated/20">
              <td class="px-3 py-2 font-medium text-highlighted">{{ row.code }}</td>
              <td class="px-3 py-2 text-default">{{ row.shippingAddress.fullName || '—' }}</td>
              <td class="px-3 py-2">
                <UBadge :color="statusColor(row.status)" variant="subtle" size="sm">
                  {{ t(`admin.quotations.statuses.${row.status}`) }}
                </UBadge>
              </td>
              <td class="px-3 py-2 text-right text-highlighted">{{ money(row.totalAmount, currencyOf(row)) }}</td>
              <td class="px-3 py-2 text-muted">{{ dateOf(row.validUntil) }}</td>
              <td class="px-3 py-2 text-muted">{{ dateOf(row.createdAt) }}</td>
              <td class="px-3 py-2 text-right">
                <UButton
                  :to="`/quotations/${row.id}`"
                  size="xs"
                  variant="soft"
                  icon="i-lucide-printer"
                  :label="t('admin.quotations.print')"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="!rows.length && !loading" class="p-6 text-center text-sm text-muted">
          {{ t('admin.quotations.empty') }}
        </p>
      </div>

      <div v-if="hasMore" class="flex justify-center">
        <UButton variant="ghost" :loading="loading" :label="t('admin.quotations.loadMore')" @click="load(true)" />
      </div>
    </template>
  </div>
</template>
