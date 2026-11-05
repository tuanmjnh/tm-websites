<script setup lang="ts">
import type { HubMediaFolder, HubMediaResource } from '@tm/flow-contracts'

const { t, locale } = useI18n()
const { isModuleEnabled } = useCustomerConfig()
const { fetchMediaFolders, fetchMediaResources, describeError, getHubErrorCode } = useHubAdmin()

const enabled = computed(() => isModuleEnabled('media'))

const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const cloudinaryMissing = ref(false)

const folders = ref<HubMediaFolder[]>([])
const resources = ref<HubMediaResource[]>([])
const currentFolder = ref<string | null>(null)
const cursor = ref<string | null>(null)
const canLoadMore = ref(false)

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const storageBytes = computed(() => resources.value.reduce((sum, item) => sum + (item.bytes || 0), 0))

const stats = computed(() => [
  { title: t('admin.media.stats.resources'), value: String(resources.value.length), icon: 'i-lucide-file-image' },
  { title: t('admin.media.stats.folders'), value: String(folders.value.length), icon: 'i-lucide-folder' },
  { title: t('admin.media.stats.images'), value: String(resources.value.filter(item => item.resource_type === 'image').length), icon: 'i-lucide-image' },
  { title: t('admin.media.stats.storage'), value: formatBytes(storageBytes.value), icon: 'i-lucide-hard-drive' },
])

const formatTime = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale.value) : '—')

const displayName = (resource: HubMediaResource) =>
  resource.filename || resource.public_id.split('/').pop() || resource.public_id

const dimensions = (resource: HubMediaResource) =>
  resource.width && resource.height ? `${resource.width}×${resource.height}` : resource.resource_type

const isImage = (resource: HubMediaResource) => resource.resource_type === 'image' && Boolean(resource.secure_url)

function handleError(cause: unknown) {
  if (getHubErrorCode(cause) === 'error.cloudinaryNotConfigured') {
    cloudinaryMissing.value = true
    error.value = null
    return
  }
  cloudinaryMissing.value = false
  error.value = describeError(cause)
}

async function load(reset = true) {
  if (enabled.value === false) return
  if (reset) {
    loading.value = true
    cursor.value = null
    resources.value = []
  } else {
    loadingMore.value = true
  }
  error.value = null
  try {
    if (reset) {
      const folderPayload = await fetchMediaFolders(currentFolder.value || undefined)
      folders.value = folderPayload.folders.length ? folderPayload.folders : (folderPayload.data?.folders ?? [])
    }
    const payload = await fetchMediaResources({
      folder: currentFolder.value || undefined,
      limit: 24,
      cursor: reset ? undefined : (cursor.value || undefined),
    })
    const items = payload.resources ?? []
    if (reset) {
      resources.value = items
    } else {
      const known = new Set(resources.value.map(item => item.public_id))
      resources.value = [...resources.value, ...items.filter(item => !known.has(item.public_id))]
    }
    cursor.value = payload.nextCursor ?? null
    canLoadMore.value = Boolean(payload.nextCursor)
    cloudinaryMissing.value = false
  } catch (cause) {
    handleError(cause)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function openFolder(folder: HubMediaFolder) {
  currentFolder.value = folder.path || folder.name
  load(true)
}

function goToRoot() {
  currentFolder.value = null
  load(true)
}

onMounted(() => load(true))
</script>

<template>
  <CmsBasePage
    :title="t('admin.media.title')"
    :description="t('admin.media.description')"
    :loading="loading"
    :error="error"
    :empty="enabled === false"
    :empty-text="t('admin.media.disabled')"
    empty-icon="i-lucide-image-off"
  >
    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('common.refresh')"
        :disabled="loading"
        @click="load(true)"
      />
      <UButton
        icon="i-lucide-upload"
        color="primary"
        variant="soft"
        size="sm"
        :label="t('admin.media.upload')"
        :disabled="cloudinaryMissing"
      />
    </template>

    <template #toolbar>
      <div class="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-highlighted"
          @click="goToRoot"
        >
          <UIcon name="i-lucide-house" class="size-3.5" />
          {{ t('admin.media.root') }}
        </button>
        <template v-if="currentFolder">
          <UIcon name="i-lucide-chevron-right" class="size-3.5" />
          <span class="font-medium text-highlighted">{{ currentFolder }}</span>
        </template>
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
      <template v-if="cloudinaryMissing">
        <BentoCard
          :title="t('admin.media.cloudinary.title')"
          :description="t('admin.media.cloudinary.description')"
          icon="i-lucide-cloud-off"
          :col-span="4"
        >
          <p class="mt-2 text-sm text-muted">{{ t('admin.media.cloudinary.hint') }}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <UBadge v-for="key in ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']" :key="key" color="neutral" variant="subtle" size="sm" class="font-mono">
              {{ key }}
            </UBadge>
          </div>
        </BentoCard>
      </template>

      <template v-else>
        <BentoCard v-for="stat in stats" :key="stat.title" :title="stat.title" :icon="stat.icon">
          <p class="mt-2 text-2xl font-bold tracking-tight text-highlighted">{{ stat.value }}</p>
        </BentoCard>

        <BentoCard
          v-if="folders.length"
          :title="t('admin.media.foldersTitle')"
          :description="t('admin.media.foldersDescription')"
          icon="i-lucide-folder-open"
          :col-span="4"
        >
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              v-for="folder in folders"
              :key="folder.path || folder.name"
              type="button"
              class="inline-flex items-center gap-2 rounded-sm border border-default/60 bg-elevated/30 px-3 py-2 text-xs font-medium text-default transition-colors hover:border-default hover:text-highlighted"
              @click="openFolder(folder)"
            >
              <UIcon name="i-lucide-folder" class="size-3.5 text-primary" />
              {{ folder.name }}
            </button>
          </div>
        </BentoCard>

        <BentoCard
          :title="t('admin.media.resourcesTitle')"
          :description="t('admin.media.resourcesDescription')"
          icon="i-lucide-file-image"
          :col-span="4"
        >
          <p v-if="!resources.length" class="py-8 text-center text-sm text-muted">
            {{ t('admin.media.noResources') }}
          </p>
          <div v-else class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="resource in resources"
              :key="resource.public_id"
              class="flex items-center gap-3 rounded-sm border border-default/50 bg-elevated/20 p-2.5"
            >
              <img
                v-if="isImage(resource)"
                :src="resource.secure_url || ''"
                :alt="displayName(resource)"
                loading="lazy"
                class="size-11 shrink-0 rounded-sm border border-default/50 object-cover"
              >
              <div v-else class="flex size-11 shrink-0 items-center justify-center rounded-sm border border-default/50 bg-elevated/40 text-muted">
                <UIcon name="i-lucide-file-image" class="size-4.5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-medium text-highlighted">{{ displayName(resource) }}</p>
                <p class="mt-0.5 truncate text-[11px] text-muted">
                  {{ dimensions(resource) }} · {{ formatBytes(resource.bytes) }}
                </p>
                <p class="mt-0.5 truncate text-[11px] text-dimmed">{{ formatTime(resource.created_at) }}</p>
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
      </template>
    </div>
  </CmsBasePage>
</template>
