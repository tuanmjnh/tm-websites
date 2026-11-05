<script setup lang="ts">
const { t, locale, locales, setLocale } = useI18n()
const route = useRoute()
const { companyName, siteConfig, socialLinks } = useSiteConfig()

const navLinks = computed(() => [
  { label: t('nav.home'), to: '/' },
  { label: t('nav.products'), to: '/products' },
  { label: t('nav.categories'), to: '/categories' },
  { label: t('nav.about'), to: '/about' },
  { label: t('nav.contact'), to: '/contact' },
])

const isActive = (to: string) => to === '/' ? route.path === '/' : route.path.startsWith(to)

const localeLabels = computed(() => locales.value.map(entry => ({
  code: typeof entry === 'string' ? entry : entry.code,
  name: typeof entry === 'string' ? entry : entry.name || entry.code,
})))

const currentLocaleLabel = computed(() =>
  localeLabels.value.find(entry => entry.code === locale.value)?.name || locale.value
)

const switchLocale = async () => {
  const codes = localeLabels.value.map(entry => entry.code)
  const next = codes[(codes.indexOf(locale.value) + 1) % codes.length]
  if (next) await setLocale(next)
}

const contactEmail = computed(() => siteConfig.value.supportEmail || '')
const contactPhone = computed(() => siteConfig.value.supportPhone || '')
const contactAddress = computed(() => siteConfig.value.address || '')
</script>

<template>
  <div class="relative min-h-screen">
    <div class="udmt-backdrop" />

    <header class="sticky top-0 z-30 border-b border-default bg-elevated/40 backdrop-blur-xl">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5">
          <NuxtImg src="/branding/logo.svg" :alt="companyName" width="32" height="32" class="size-8 shrink-0" />
          <span class="truncate text-base font-semibold tracking-tight text-highlighted">
            {{ companyName }}
          </span>
        </NuxtLink>

        <nav class="hidden items-center gap-6 text-sm font-medium md:flex">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="transition-colors hover:text-primary"
            :class="isActive(link.to) ? 'text-primary' : 'text-default'"
          >
            {{ link.label }}
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-languages"
            :label="currentLocaleLabel"
            :aria-label="t('nav.switchLanguage')"
            @click="switchLocale"
          />
        </div>
      </div>

      <nav class="flex items-center gap-5 overflow-x-auto border-t border-default/40 px-4 py-2 text-xs font-medium md:hidden">
        <NuxtLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="whitespace-nowrap transition-colors hover:text-primary"
          :class="isActive(link.to) ? 'text-primary' : 'text-muted'"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>
    </header>

    <main class="relative z-10">
      <slot />
    </main>

    <footer class="relative z-10 border-t border-default bg-elevated/30 py-12 backdrop-blur-md">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div class="md:col-span-2">
            <div class="flex items-center gap-2.5">
              <NuxtImg src="/branding/logo.svg" :alt="companyName" width="28" height="28" class="size-7" />
              <h3 class="text-sm font-semibold text-highlighted">{{ companyName }}</h3>
            </div>
            <p class="mt-3 max-w-sm text-xs text-muted">
              {{ t('site.tagline') }}
            </p>

            <ul class="mt-4 space-y-1.5 text-xs text-muted">
              <li v-if="contactAddress" class="flex items-center gap-2">
                <UIcon name="i-lucide-map-pin" class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{{ contactAddress }}</span>
              </li>
              <li v-if="contactPhone" class="flex items-center gap-2">
                <UIcon name="i-lucide-phone" class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{{ contactPhone }}</span>
              </li>
              <li v-if="contactEmail" class="flex items-center gap-2">
                <UIcon name="i-lucide-mail" class="size-3.5 shrink-0" aria-hidden="true" />
                <span>{{ contactEmail }}</span>
              </li>
            </ul>
          </div>

          <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-highlighted">{{ t('site.explore') }}</h4>
            <ul class="mt-3 space-y-1.5 text-xs text-muted">
              <li><NuxtLink to="/products" class="transition-colors hover:text-primary">{{ t('nav.products') }}</NuxtLink></li>
              <li><NuxtLink to="/categories" class="transition-colors hover:text-primary">{{ t('nav.categories') }}</NuxtLink></li>
              <li><NuxtLink to="/products?sort=newest" class="transition-colors hover:text-primary">{{ t('catalog.sort.newest') }}</NuxtLink></li>
            </ul>
          </div>

          <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider text-highlighted">{{ t('site.support') }}</h4>
            <ul class="mt-3 space-y-1.5 text-xs text-muted">
              <li><NuxtLink to="/about" class="transition-colors hover:text-primary">{{ t('nav.about') }}</NuxtLink></li>
              <li><NuxtLink to="/contact" class="transition-colors hover:text-primary">{{ t('nav.contact') }}</NuxtLink></li>
            </ul>

            <ul v-if="socialLinks.length" class="mt-4 flex flex-wrap gap-2">
              <li v-for="[key, url] in socialLinks" :key="key">
                <ULink
                  :to="String(url)"
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  class="rounded-[4px] border border-default/60 px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:text-primary"
                >
                  {{ key }}
                </ULink>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-8 border-t border-default/40 pt-4 text-center text-xs text-muted">
          © {{ new Date().getFullYear() }} {{ companyName }}. {{ t('site.rights') }}
        </div>
      </div>
    </footer>
  </div>
</template>
