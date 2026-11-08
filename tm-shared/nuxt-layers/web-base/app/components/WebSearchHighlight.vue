<script setup lang="ts">
import { escapeHtml } from '@tm/flow-utils/html'

/**
 * Highlights the visitor's search term inside already-plain text.
 *
 * The text is HTML-escaped first and only `<mark>` is added afterwards, so a
 * term or a record title can never inject markup. Matching is case-insensitive
 * and literal: the term is escaped before it becomes a pattern.
 */
const props = defineProps<{
  text: string
  term?: string
}>()

const html = computed(() => {
  const source = escapeHtml(props.text || '')
  const term = (props.term || '').trim()
  if (!term || !source) return source

  const pattern = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>')
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span v-html="html" />
</template>
