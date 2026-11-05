<script setup lang="ts">
import { sanitizePublicHtml } from '@tm/flow-utils/html'

const props = defineProps<{
  html: string
}>()

const safeHtml = computed(() => sanitizePublicHtml(props.html || ''))
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="catalog-rich-text" v-html="safeHtml" />
</template>

<style scoped>
.catalog-rich-text {
  font-size: 0.875rem;
  line-height: 1.75;
  color: var(--ui-text);
}

.catalog-rich-text :deep(h1),
.catalog-rich-text :deep(h2),
.catalog-rich-text :deep(h3),
.catalog-rich-text :deep(h4) {
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ui-text-highlighted);
}

.catalog-rich-text :deep(h1) { font-size: 1.375rem; }
.catalog-rich-text :deep(h2) { font-size: 1.25rem; }
.catalog-rich-text :deep(h3) { font-size: 1.125rem; }

.catalog-rich-text :deep(p),
.catalog-rich-text :deep(ul),
.catalog-rich-text :deep(ol),
.catalog-rich-text :deep(blockquote),
.catalog-rich-text :deep(pre),
.catalog-rich-text :deep(table) {
  margin-bottom: 0.875rem;
}

.catalog-rich-text :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
}

.catalog-rich-text :deep(ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}

.catalog-rich-text :deep(li) {
  margin-bottom: 0.25rem;
}

.catalog-rich-text :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.catalog-rich-text :deep(blockquote) {
  border-left: 3px solid var(--ui-primary);
  padding-left: 1rem;
  color: var(--ui-text-muted);
}

.catalog-rich-text :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

.catalog-rich-text :deep(table) {
  width: 100%;
  border-collapse: collapse;
}

.catalog-rich-text :deep(th),
.catalog-rich-text :deep(td) {
  border: 1px solid var(--ui-border);
  padding: 0.375rem 0.5rem;
  text-align: left;
}
</style>
