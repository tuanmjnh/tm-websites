<script setup lang="ts">
const { t } = useI18n()
const { brandName, seo, contactEmail, contactPhone, contactAddress } = usePublicSite()

/**
 * Everything here comes from the site's own settings: the storefront has no
 * about-page body of its own, so the page is the company identity the customer
 * saved in the CMS — and a plain empty state when they have not saved any.
 */
const description = computed(() => seo.value?.defaultDescription || '')

const details = computed(() => [
  contactEmail.value && { icon: 'i-lucide-mail', label: t('about.email'), value: contactEmail.value, href: `mailto:${contactEmail.value}` },
  contactPhone.value && { icon: 'i-lucide-phone', label: t('about.phone'), value: contactPhone.value, href: `tel:${contactPhone.value.replace(/\s+/g, '')}` },
  contactAddress.value && { icon: 'i-lucide-map-pin', label: t('about.address'), value: contactAddress.value, href: '' },
].filter(Boolean) as Array<{ icon: string, label: string, value: string, href: string }>)

const robots = usePageRobots({ empty: () => !description.value && !details.value.length })

useSeoMeta({
  title: () => t('about.title', { company: brandName.value }),
  description: () => description.value || t('about.metaFallback', { company: brandName.value }),
  ogTitle: () => t('about.title', { company: brandName.value }),
  ogDescription: () => description.value || t('about.metaFallback', { company: brandName.value }),
  ogType: 'website',
  robots,
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('about.title', { company: brandName }) }}
      </h1>
      <p v-if="description" class="mt-2 text-sm leading-relaxed text-muted">
        {{ description }}
      </p>
    </header>

    <section v-if="details.length" class="panel border-default p-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('about.details') }}
      </h2>
      <dl class="mt-4 space-y-3">
        <div v-for="detail in details" :key="detail.label" class="flex items-start gap-3">
          <UIcon :name="detail.icon" class="mt-0.5 size-4 text-primary" aria-hidden="true" />
          <div>
            <dt class="text-xs uppercase tracking-wide text-dimmed">
              {{ detail.label }}
            </dt>
            <dd class="text-sm text-highlighted">
              <a v-if="detail.href" :href="detail.href" class="hover:text-primary">{{ detail.value }}</a>
              <span v-else>{{ detail.value }}</span>
            </dd>
          </div>
        </div>
      </dl>
    </section>

    <div v-else class="panel border-dashed p-8 text-center">
      <UIcon name="i-lucide-info" class="mx-auto mb-3 size-8 text-dimmed" aria-hidden="true" />
      <p class="text-sm font-medium text-highlighted">
        {{ t('about.emptyTitle') }}
      </p>
      <p class="mt-1 text-xs text-muted">
        {{ t('about.emptyHint') }}
      </p>
    </div>
  </div>
</template>
