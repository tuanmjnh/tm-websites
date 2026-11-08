<script setup lang="ts">
import type { PublicSite } from '@tm/flow-contracts/site-public'
import {
  PUBLIC_MENU_FOOTER,
  PUBLIC_MENU_HEADER,
  findPublicMenu,
  publicMenuLabel,
} from '@tm/flow-contracts/site-public'

const { t, locale, locales, setLocale } = useI18n()
const route = useRoute()
const { companyName, siteConfig, socialLinks } = useSiteConfig()

// The CMS owns the menus; the storefront only reads the public projection. When a
// site has not saved settings yet (or the read fails) the built-in navigation is
// kept, so the header is never empty.
const { data: publicSite } = await useAsyncData(
  'public-site',
  async () => {
    try {
      const response = await $fetch<{ success: boolean, data: PublicSite }>('/api/public/site', {
        query: { locale: locale.value },
      })
      return response.data
    } catch {
      return null
    }
  },
  { watch: [locale] },
)

const menuLinks = (key: string) => {
  const menu = findPublicMenu(publicSite.value?.menus ?? [], key)
  if (!menu?.items.length) return null
  return menu.items
    .map(item => ({ label: publicMenuLabel(item.label, locale.value), to: item.href }))
    .filter(link => link.label)
}

const fallbackNav = computed(() => [
  { label: t('nav.home'), to: '/' },
  { label: t('nav.products'), to: '/products' },
  { label: t('nav.categories'), to: '/categories' },
  { label: t('nav.about'), to: '/about' },
  { label: t('nav.contact'), to: '/contact' },
  { label: t('nav.search'), to: '/tim-kiem' },
])

const navLinks = computed(() => menuLinks(PUBLIC_MENU_HEADER) ?? fallbackNav.value)

const fallbackFooterLinks = computed(() => [
  { label: t('nav.products'), to: '/products' },
  { label: t('nav.categories'), to: '/categories' },
  { label: t('nav.about'), to: '/about' },
  { label: t('nav.contact'), to: '/contact' },
])

const footerLinks = computed(() => menuLinks(PUBLIC_MENU_FOOTER) ?? fallbackFooterLinks.value)

const brandName = computed(() => publicSite.value?.company.name || companyName.value)

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

// The cart lives in localStorage, so the badge can only be filled after mount.
const { count: cartCount, hydrate: hydrateCart } = useCart()
onMounted(() => hydrateCart())

// The site settings document is now the source of truth; Hub's public config
// stays as the fallback for sites that have not saved it yet.
const contactEmail = computed(() => publicSite.value?.company.email || siteConfig.value.supportEmail || '')
const contactPhone = computed(() => publicSite.value?.company.phone || siteConfig.value.supportPhone || '')
const contactAddress = computed(() => publicSite.value?.company.address || siteConfig.value.address || '')
</script>

<template>
  <div class="relative min-h-screen">
    <div class="udmt-backdrop" />

    <header class="sticky top-0 z-30 border-b border-default bg-elevated/40 backdrop-blur-xl">
      <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <NuxtLink to="/" class="flex min-w-0 items-center gap-2.5">
          <NuxtImg src="/branding/logo.svg" :alt="brandName" width="32" height="32" class="size-8 shrink-0" />
          <span class="truncate text-base font-semibold tracking-tight text-highlighted">
            {{ brandName }}
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
          <NuxtLink
            to="/gio-hang"
            class="relative inline-flex size-9 items-center justify-center rounded-[4px] text-default transition-colors hover:bg-elevated/60 hover:text-primary"
            :aria-label="t('cart.viewCart')"
          >
            <UIcon name="i-lucide-shopping-cart" class="size-5" aria-hidden="true" />
            <span
              v-if="cartCount"
              class="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-bold leading-4 text-inverted"
            >{{ cartCount > 99 ? '99+' : cartCount }}</span>
          </NuxtLink>
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
              <NuxtImg src="/branding/logo.svg" :alt="brandName" width="28" height="28" class="size-7" />
              <h3 class="text-sm font-semibold text-highlighted">{{ brandName }}</h3>
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
              <li v-for="link in footerLinks" :key="`${link.to}:${link.label}`">
                <NuxtLink :to="link.to" class="transition-colors hover:text-primary">{{ link.label }}</NuxtLink>
              </li>
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
          © {{ new Date().getFullYear() }} {{ brandName }}. {{ t('site.rights') }}
        </div>
      </div>
    </footer>
  </div>
</template>
