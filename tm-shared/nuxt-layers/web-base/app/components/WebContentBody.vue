<script setup lang="ts">
import type { PublicContent } from '@tm/flow-contracts/content-public'
import { sanitizePublicHtml } from '@tm/flow-utils/html'
import { renderSafeMarkdown } from '@tm/flow-utils/markdown'

/**
 * Renders the body according to the format the editor chose. Both HTML and
 * Markdown pass through their sanitizing renderer (HTML is allowlisted, Markdown
 * escapes raw HTML and rejects unsafe links), and plain text is never parsed.
 */
const props = defineProps<{
  content: PublicContent
}>()

const html = computed(() => {
  const body = props.content.body || ''
  if (!body.trim()) return ''
  if (props.content.format === 'html') return sanitizePublicHtml(body)
  if (props.content.format === 'text') return ''
  return renderSafeMarkdown(body)
})
</script>

<template>
  <div class="web-content text-sm leading-7 text-default sm:text-base">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="content.format !== 'text' && html" class="web-content-html" v-html="html" />
    <p v-else-if="content.format === 'text' && content.body" class="whitespace-pre-line">
      {{ content.body }}
    </p>
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
