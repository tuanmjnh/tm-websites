<script setup lang="ts">
import type { ImportOutcome } from '../utils/import-rows'
import { parseImportRows } from '../utils/import-rows'

const props = defineProps<{
  open: boolean
  title: string
  hint: string
  example: string
  busy?: boolean
  error?: string | null
  result?: ImportOutcome | null
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  submit: [{ rows: Record<string, unknown>[], reason: string }]
}>()

const { t } = useI18n()
const text = ref('')
const reason = ref('')
const parsed = computed(() => parseImportRows(text.value))

const parseMessage = computed(() => {
  if (parsed.value.error === 'invalid') return t('admin.import.invalid')
  if (parsed.value.error === 'no-rows') return t('admin.import.noRows')
  return null
})

const canSubmit = computed(() => !props.busy && parsed.value.rows.length > 0)

function submit() {
  if (!canSubmit.value) return
  emit('submit', { rows: parsed.value.rows, reason: reason.value.trim() })
}

watch(() => props.open, (open) => {
  if (!open) return
  text.value = ''
  reason.value = ''
})
</script>

<template>
  <UModal
    :open="open"
    :title="title"
    :ui="{ content: 'w-[calc(100vw-2rem)] max-w-2xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto scroll-thin">
        <p class="text-xs text-muted">{{ hint }}</p>
        <pre class="overflow-x-auto rounded-[4px] border border-default/60 bg-elevated/40 p-2 text-xs text-muted">{{ example }}</pre>
        <UFormField :label="t('admin.import.source')">
          <UTextarea v-model="text" :rows="8" class="w-full" :placeholder="t('admin.import.placeholder')" />
        </UFormField>
        <p v-if="parseMessage" class="text-xs text-error">{{ parseMessage }}</p>
        <p v-else-if="parsed.rows.length" class="text-xs text-muted">{{ t('admin.import.preview', { count: parsed.rows.length }) }}</p>

        <AuditReasonField v-model="reason" />
        <p v-if="error" class="text-xs text-error">{{ error }}</p>

        <div v-if="result" class="flex flex-col gap-2 rounded-[4px] border border-default/60 p-2">
          <p class="text-xs font-medium text-highlighted">
            {{ t('admin.import.result', { created: result.created, updated: result.updated, failed: result.failed }) }}
          </p>
          <div class="max-h-56 overflow-y-auto scroll-thin">
            <div
              v-for="entry in result.results"
              :key="entry.row"
              class="flex flex-wrap items-center gap-2 border-b border-default/40 py-1 text-xs last:border-b-0"
            >
              <span class="w-14 shrink-0 text-muted">#{{ entry.row }}</span>
              <span class="min-w-0 flex-1 truncate font-mono">{{ entry.key ?? '—' }}</span>
              <UBadge :color="entry.status === 'failed' ? 'error' : entry.status === 'updated' ? 'warning' : 'success'" variant="subtle" size="sm">
                {{ t(`admin.import.statuses.${entry.status}`) }}
              </UBadge>
              <span v-if="entry.code" class="w-full truncate text-muted">{{ entry.code }}<template v-if="entry.message"> · {{ entry.message }}</template></span>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="emit('update:open', false)" />
        <UButton color="primary" variant="soft" :loading="busy" :disabled="!canSubmit" :label="t('admin.import.submit')" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
