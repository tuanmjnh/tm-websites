<script setup lang="ts">
/** One social profile the storefront footer links to. */
interface SocialLinkRow {
  code: string
  label: string
  url: string
}

const props = defineProps<{
  modelValue: SocialLinkRow[]
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [SocialLinkRow[]] }>()

const { t } = useI18n()

// The API stores at most twelve; the editor stops there instead of failing a save.
const MAX_LINKS = 12

function commit(next: SocialLinkRow[]) {
  emit('update:modelValue', next)
}

function add() {
  if (props.modelValue.length >= MAX_LINKS) return
  commit([...props.modelValue, { code: '', label: '', url: '' }])
}

function remove(index: number) {
  commit(props.modelValue.filter((_, position) => position !== index))
}

function edit(index: number, field: 'label' | 'url', value: unknown) {
  commit(props.modelValue.map((row, position) => (
    position === index ? { ...row, [field]: String(value ?? '') } : row
  )))
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs font-medium text-muted">{{ t('admin.configs.site.fields.social') }}</span>
      <UButton
        size="xs"
        color="neutral"
        variant="soft"
        icon="i-lucide-plus"
        :label="t('admin.configs.site.fields.socialAdd')"
        :disabled="disabled || modelValue.length >= MAX_LINKS"
        @click="add"
      />
    </div>

    <!-- Plain inputs on purpose: a type-generic Nuxt UI field inside a v-for loses
         the row scope in the type checker, while these keep it. -->
    <div
      v-for="(row, index) in modelValue"
      :key="index"
      class="mt-2 flex flex-wrap items-center gap-2"
    >
      <input
        :value="row.label"
        type="text"
        class="w-full rounded-[4px] border border-default bg-default px-2.5 py-1.5 text-sm text-highlighted placeholder:text-dimmed focus:border-primary focus:outline-none disabled:opacity-60 sm:w-40"
        :disabled="disabled"
        :maxlength="80"
        :placeholder="t('admin.configs.site.fields.socialLabel')"
        @input="edit(index, 'label', ($event.target as HTMLInputElement).value)"
      >
      <input
        :value="row.url"
        type="url"
        class="min-w-0 flex-1 rounded-[4px] border border-default bg-default px-2.5 py-1.5 text-sm text-highlighted placeholder:text-dimmed focus:border-primary focus:outline-none disabled:opacity-60"
        :disabled="disabled"
        :maxlength="300"
        placeholder="https://"
        @input="edit(index, 'url', ($event.target as HTMLInputElement).value)"
      >
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-[4px] text-muted transition-colors hover:bg-elevated/60 hover:text-error disabled:opacity-60"
        :disabled="disabled"
        :aria-label="t('admin.configs.site.clear')"
        @click="remove(index)"
      >
        <UIcon name="i-lucide-x" class="size-4" aria-hidden="true" />
      </button>
    </div>

    <p v-if="!modelValue.length" class="mt-2 text-[11px] text-muted">
      {{ t('admin.configs.site.fields.socialEmpty') }}
    </p>
  </div>
</template>
