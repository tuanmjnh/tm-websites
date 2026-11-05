<script setup lang="ts">
import { toPublicContentView, type HubPublicContent } from '@tm/flow-contracts'
import { sanitizePublicHtml } from '@tm/flow-utils/html'
import { renderSafeMarkdown } from '@tm/flow-utils/markdown'

const props = defineProps<{
  content: HubPublicContent
}>()

const view = computed(() => toPublicContentView(props.content))

const html = computed(() => (view.value.kind === 'html' ? sanitizePublicHtml(view.value.html) : ''))
const markdown = computed(() => (view.value.kind === 'markdown' ? renderSafeMarkdown(view.value.markdown) : ''))
const text = computed(() => (view.value.kind === 'text' ? view.value.text : ''))
const sections = computed(() => (view.value.kind === 'sections' ? view.value.sections : []))
const json = computed(() => (view.value.kind === 'json' ? view.value.json : ''))
</script>

<template>
  <div class="web-content text-sm leading-7 text-default sm:text-base">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="view.kind === 'html'" class="web-content-html" v-html="html" />

    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-else-if="view.kind === 'markdown'" class="web-content-html" v-html="markdown" />

    <p v-else-if="view.kind === 'text'" class="whitespace-pre-line">{{ text }}</p>

    <div v-else-if="view.kind === 'sections'" class="space-y-6">
      <section v-for="(section, index) in sections" :key="index">
        <h2 v-if="section.heading" class="text-lg font-semibold text-highlighted">
          {{ section.heading }}
        </h2>
        <p class="mt-2 whitespace-pre-line text-default">{{ section.body }}</p>
      </section>
    </div>

    <pre v-else class="overflow-x-auto rounded-[6px] border border-default/60 bg-elevated/40 p-4 text-xs text-default"><code>{{ json }}</code></pre>
  </div>
</template>

<style scoped>
.web-content-html :deep(h1),
.web-content-html :deep(h2),
.web-content-html :deep(h3),
.web-content-html :deep(h4) {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ui-text-highlighted);
}

.web-content-html :deep(h1) { font-size: 1.5rem; }
.web-content-html :deep(h2) { font-size: 1.25rem; }
.web-content-html :deep(h3) { font-size: 1.125rem; }

.web-content-html :deep(p),
.web-content-html :deep(ul),
.web-content-html :deep(ol),
.web-content-html :deep(blockquote),
.web-content-html :deep(pre),
.web-content-html :deep(table) {
  margin-bottom: 1rem;
}

.web-content-html :deep(ul) { list-style: disc; padding-left: 1.25rem; }
.web-content-html :deep(ol) { list-style: decimal; padding-left: 1.25rem; }
.web-content-html :deep(li) { margin-bottom: 0.25rem; }

.web-content-html :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.web-content-html :deep(blockquote) {
  border-left: 3px solid var(--ui-primary);
  padding-left: 1rem;
  color: var(--ui-text-muted);
}

.web-content-html :deep(pre) {
  overflow-x: auto;
  border-radius: 6px;
  border: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg-elevated) 40%, transparent);
  padding: 1rem;
  font-size: 0.75rem;
}

.web-content-html :deep(code) {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.web-content-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}
</style>
