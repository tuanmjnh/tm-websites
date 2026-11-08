<script setup lang="ts">
import type { AdminContentAudit } from '@tm/flow-contracts/content-admin'

/**
 * Activity trail of one category or media record.
 *
 * Neither domain keeps revision snapshots, so the `audit_logs` rows are the whole
 * history. The component owns its request because it is the only reader; a failed
 * read shows the reason instead of an empty list that would look like "no edits".
 */
const props = defineProps<{
  resourceType: 'category' | 'media'
  resourceId: string | null
}>()

const { t, locale } = useI18n()
const plainFetch = $fetch as unknown as (url: string, options?: Record<string, unknown>) => Promise<unknown>

const entries = ref<AdminContentAudit[]>([])
const loading = ref(false)
const failed = ref(false)

const endpoint = computed(() => {
  const segment = props.resourceType === 'category' ? 'categories' : 'media'
  return `/api/v1/admin/${segment}/${encodeURIComponent(props.resourceId ?? '')}/history`
})

async function load() {
  if (!props.resourceId) {
    entries.value = []
    failed.value = false
    return
  }

  loading.value = true
  failed.value = false
  try {
    const payload = await plainFetch(endpoint.value) as { data?: AdminContentAudit[] }
    entries.value = payload.data ?? []
  } catch {
    entries.value = []
    failed.value = true
  } finally {
    loading.value = false
  }
}

watch(() => [props.resourceType, props.resourceId] as const, () => { void load() }, { immediate: true })

const formatTime = (value: string) => new Date(value).toLocaleString(locale.value)
const actionLabel = (action: string) => t(`admin.content.audit.${action}`, action)
</script>

<template>
  <div class="rounded-sm border border-default/60 p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs font-semibold text-highlighted">{{ t('admin.history.title') }}</p>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        :label="t('admin.history.reload')"
        @click="load"
      />
    </div>

    <p v-if="failed" class="mt-2 text-xs text-error">{{ t('admin.history.loadFailed') }}</p>
    <p v-else-if="!entries.length && !loading" class="mt-2 text-xs text-muted">
      {{ t('admin.history.empty') }}
    </p>
    <ul v-else class="mt-2 flex flex-col gap-2">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="flex flex-wrap items-baseline gap-2 text-xs"
      >
        <UBadge color="neutral" variant="subtle" size="sm">
          {{ actionLabel(entry.action) }}
        </UBadge>
        <span class="text-muted">{{ t('admin.history.revision') }} {{ entry.revision }}</span>
        <span class="text-default">{{ entry.actor.name || entry.actor.email || entry.actor.id }}</span>
        <span v-if="entry.changedFields.length" class="font-mono text-[11px] text-muted">
          {{ entry.changedFields.join(', ') }}
        </span>
        <span class="ml-auto text-muted">{{ formatTime(entry.createdAt) }}</span>
      </li>
    </ul>
  </div>
</template>
