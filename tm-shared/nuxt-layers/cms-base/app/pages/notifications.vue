<script setup lang="ts">
import { z } from 'zod'
import type { HubNotification } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const toast = useToast()
const { hasCapability } = useHub()
const { fetchNotifications, markNotificationRead, markAllNotificationsRead, sendNotification, describeError } = useHubAdmin()

const canRead = computed(() => hasCapability('notifications.read'))
const canSend = computed(() => hasCapability('notifications.send'))

const composeOpen = ref(false)
const sending = ref(false)
const composeForm = reactive({ title: '', body: '', url: '' })

const composeSchema = computed(() => z.object({
  title: z.string().trim().min(1, t('admin.notifications.form.titleRequired')).max(255, t('admin.notifications.form.titleMax')),
  body: z.string().trim().min(1, t('admin.notifications.form.bodyRequired')),
  url: z.string().trim().url(t('admin.notifications.form.urlInvalid')).or(z.literal('')),
}))

const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const items = ref<HubNotification[]>([])
const cursor = ref<string | null>(null)
const canLoadMore = ref(false)
const marking = ref<string | null>(null)
const filter = ref<'all' | 'unread'>('all')

const filterItems = computed(() => [
  { label: t('admin.notifications.filter.all'), value: 'all' },
  { label: t('admin.notifications.filter.unread'), value: 'unread' },
])

const unreadCount = computed(() => items.value.filter(item => !item.isRead).length)

const visibleItems = computed(() =>
  filter.value === 'unread' ? items.value.filter(item => !item.isRead) : items.value
)

const stats = computed(() => [
  { title: t('admin.notifications.stats.total'), value: String(items.value.length), icon: 'i-lucide-bell' },
  { title: t('admin.notifications.stats.unread'), value: String(unreadCount.value), icon: 'i-lucide-bell-ring' },
  { title: t('admin.notifications.stats.read'), value: String(items.value.length - unreadCount.value), icon: 'i-lucide-check-check' },
])

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

async function load(reset = true) {
  if (!canRead.value) return
  if (reset) {
    loading.value = true
    cursor.value = null
    items.value = []
  } else {
    loadingMore.value = true
  }
  error.value = null
  try {
    const payload = await fetchNotifications({
      limit: 20,
      cursor: reset ? undefined : (cursor.value || undefined),
    })
    const fetched = payload.data ?? []
    if (reset) {
      items.value = fetched
    } else {
      const known = new Set(items.value.map(item => item.id))
      items.value = [...items.value, ...fetched.filter(item => !known.has(item.id))]
    }
    cursor.value = payload.nextCursor ?? null
    canLoadMore.value = Boolean(payload.nextCursor)
  } catch (cause) {
    error.value = describeError(cause)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function markOne(item: HubNotification) {
  if (item.isRead) return
  marking.value = item.id
  try {
    await markNotificationRead(item.id)
    items.value = items.value.map(entry => (entry.id === item.id ? { ...entry, isRead: true } : entry))
  } catch (cause) {
    toast.add({ title: describeError(cause), color: 'error' })
  } finally {
    marking.value = null
  }
}

async function markAll() {
  marking.value = 'all'
  try {
    await markAllNotificationsRead()
    items.value = items.value.map(entry => ({ ...entry, isRead: true }))
    toast.add({ title: t('admin.notifications.markedAll'), color: 'success' })
  } catch (cause) {
    toast.add({ title: describeError(cause), color: 'error' })
  } finally {
    marking.value = null
  }
}

function openCompose() {
  composeForm.title = ''
  composeForm.body = ''
  composeForm.url = ''
  composeOpen.value = true
}

async function submitCompose() {
  sending.value = true
  try {
    await sendNotification({
      title: composeForm.title.trim(),
      body: composeForm.body.trim(),
      url: composeForm.url.trim() || undefined,
    })
    toast.add({ title: t('admin.notifications.form.sent'), color: 'success' })
    composeOpen.value = false
    await load(true)
  } catch (cause) {
    toast.add({ title: describeError(cause), color: 'error' })
  } finally {
    sending.value = false
  }
}

onMounted(() => load(true))
</script>

<template>
  <CmsBasePage
    :title="t('admin.notifications.title')"
    :description="t('admin.notifications.description')"
    :loading="loading"
    :error="error"
    :empty="!canRead"
    :empty-text="t('admin.notifications.permissionDenied')"
    empty-icon="i-lucide-shield-off"
  >
    <template #right>
      <UButton
        v-if="canSend"
        icon="i-lucide-send"
        color="neutral"
        variant="soft"
        size="sm"
        :label="t('admin.notifications.compose')"
        @click="openCompose"
      />
      <UButton
        icon="i-lucide-check-check"
        color="primary"
        variant="soft"
        size="sm"
        :label="t('admin.notifications.markAll')"
        :disabled="!unreadCount || marking === 'all'"
        :loading="marking === 'all'"
        @click="markAll"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="loading"
        @click="load(true)"
      />
    </template>

    <template #toolbar>
      <div class="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <USelect
          v-model="filter"
          :items="filterItems"
          value-key="value"
          class="w-full sm:w-48"
        />
      </div>
    </template>

    <template #error-retry>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="soft"
        size="sm"
        :label="t('common.refresh')"
        class="mt-4"
        @click="load(true)"
      />
    </template>

    <div class="bento-grid">
      <BentoCard v-for="stat in stats" :key="stat.title" :title="stat.title" :icon="stat.icon">
        <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">{{ stat.value }}</p>
      </BentoCard>

      <BentoCard
        :title="t('admin.notifications.listTitle')"
        :description="t('admin.notifications.listDescription')"
        icon="i-lucide-bell"
        :col-span="4"
      >
        <p v-if="!visibleItems.length" class="py-8 text-center text-sm text-muted">
          {{ t('admin.notifications.noItems') }}
        </p>
        <div v-else class="mt-3 divide-y divide-default/40">
          <div
            v-for="item in visibleItems"
            :key="item.id"
            class="flex flex-wrap items-start justify-between gap-3 py-3"
            :class="item.isRead ? 'opacity-70' : ''"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  :class="item.isRead ? 'bg-transparent' : 'bg-primary'"
                />
                <p class="text-sm font-semibold text-highlighted">{{ item.title }}</p>
                <UBadge v-if="!item.isRead" color="primary" variant="subtle" size="sm">
                  {{ t('admin.notifications.unread') }}
                </UBadge>
              </div>
              <p class="mt-1 whitespace-pre-line text-sm text-muted">{{ item.body }}</p>
              <p class="mt-1 text-[11px] text-dimmed">{{ formatTime(item.createdAt) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UButton
                v-if="item.url"
                :to="item.url"
                target="_blank"
                icon="i-lucide-external-link"
                color="neutral"
                variant="ghost"
                size="xs"
                :label="t('admin.notifications.open')"
              />
              <UButton
                v-if="!item.isRead"
                icon="i-lucide-check"
                color="neutral"
                variant="soft"
                size="xs"
                :label="t('admin.notifications.markRead')"
                :loading="marking === item.id"
                @click="markOne(item)"
              />
            </div>
          </div>
        </div>

        <div v-if="canLoadMore" class="mt-4 flex justify-center">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            size="sm"
            :loading="loadingMore"
            :label="t('common.more')"
            @click="load(false)"
          />
        </div>
      </BentoCard>
    </div>

    <UModal v-model:open="composeOpen" :title="t('admin.notifications.compose')" :description="t('admin.notifications.composeDescription')">
      <template #body>
        <UForm id="notification-compose" :schema="composeSchema" :state="composeForm" class="flex flex-col gap-4" @submit="submitCompose">
          <UFormField :label="t('admin.notifications.form.title')" name="title" required>
            <UInput v-model="composeForm.title" class="w-full" :placeholder="t('admin.notifications.form.titlePlaceholder')" />
          </UFormField>
          <UFormField :label="t('admin.notifications.form.body')" name="body" required>
            <UTextarea v-model="composeForm.body" class="w-full" :rows="4" :placeholder="t('admin.notifications.form.bodyPlaceholder')" />
          </UFormField>
          <UFormField :label="t('admin.notifications.form.url')" name="url">
            <UInput v-model="composeForm.url" class="w-full" :placeholder="t('admin.notifications.form.urlPlaceholder')" />
          </UFormField>
        </UForm>
      </template>
      <template #footer="{ close }">
        <div class="flex w-full items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="t('common.cancel')" @click="close" />
          <UButton type="submit" form="notification-compose" color="primary" variant="soft" icon="i-lucide-send" :label="t('admin.notifications.form.submit')" :loading="sending" />
        </div>
      </template>
    </UModal>
  </CmsBasePage>
</template>
