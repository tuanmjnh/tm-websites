<script setup lang="ts">
const { t } = useI18n()
const { brandName, contactEmail, contactPhone, contactAddress } = usePublicSite()
const { socialLinks } = useSiteConfig()

/**
 * The contact channels are the ones the customer saved in site settings; the
 * storefront never invents a phone number or an address, so a site that has
 * saved none gets an explicit notice instead of a form that goes nowhere.
 */
const channels = computed(() => [
  contactEmail.value && { icon: 'i-lucide-mail', label: t('contact.email'), value: contactEmail.value, href: `mailto:${contactEmail.value}` },
  contactPhone.value && { icon: 'i-lucide-phone', label: t('contact.phone'), value: contactPhone.value, href: `tel:${contactPhone.value.replace(/\s+/g, '')}` },
  contactAddress.value && { icon: 'i-lucide-map-pin', label: t('contact.address'), value: contactAddress.value, href: undefined },
].filter(Boolean) as Array<{ icon: string, label: string, value: string, href?: string }>)

const robots = usePageRobots({ empty: () => !channels.value.length && !socialLinks.value.length })

useSeoMeta({
  title: () => t('contact.title', { company: brandName.value }),
  description: () => t('contact.subtitle', { company: brandName.value }),
  ogTitle: () => t('contact.title', { company: brandName.value }),
  ogDescription: () => t('contact.subtitle', { company: brandName.value }),
  ogType: 'website',
  robots,
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
    <header class="mb-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
        {{ t('contact.title', { company: brandName }) }}
      </h1>
      <p class="mt-2 text-sm leading-relaxed text-muted">
        {{ t('contact.subtitle', { company: brandName }) }}
      </p>
    </header>

    <section v-if="channels.length" class="panel border-default p-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('contact.channels') }}
      </h2>
      <dl class="mt-4 space-y-3">
        <div v-for="channel in channels" :key="channel.label" class="flex items-start gap-3">
          <UIcon :name="channel.icon" class="mt-0.5 size-4 text-primary" aria-hidden="true" />
          <div>
            <dt class="text-xs uppercase tracking-wide text-dimmed">
              {{ channel.label }}
            </dt>
            <dd class="text-sm text-highlighted">
              <a v-if="channel.href" :href="channel.href" class="hover:text-primary">{{ channel.value }}</a>
              <span v-else>{{ channel.value }}</span>
            </dd>
          </div>
        </div>
      </dl>
    </section>

    <WebNotice
      v-else
      icon="i-lucide-mail-question-mark"
      :title="t('contact.emptyTitle')"
      :description="t('contact.emptyHint')"
    />

    <section v-if="socialLinks.length" class="mt-6">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ t('contact.social') }}
      </h2>
      <ul class="mt-3 flex flex-wrap gap-2">
        <li v-for="[network, url] in socialLinks" :key="network">
          <a
            :href="url"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="inline-flex items-center gap-1 rounded-[4px] bg-muted px-3 py-1.5 text-xs font-medium text-muted hover:text-primary"
          >
            {{ network }}
            <UIcon name="i-lucide-external-link" class="size-3" aria-hidden="true" />
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
