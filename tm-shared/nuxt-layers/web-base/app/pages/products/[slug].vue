<script setup lang="ts">
import { catalogSegmentFromParam } from '@tm/flow-contracts'
import { sanitizePublicHtml } from '@tm/flow-utils/html'
import { buildBreadcrumbJsonLd, buildCanonicalUrl, resolveSiteUrl } from '@tm/flow-utils/seo'

const { t, locale } = useI18n()
const route = useRoute()
const config = useRuntimeConfig()
const requestUrl = useRequestURL()

const { brandName } = usePublicSite()
const slug = computed(() => catalogSegmentFromParam(route.params.slug) ?? '')
const catalog = useCatalogItem(slug)
const { result, pending } = catalog

const item = computed(() => (result.value.status === 'ok' ? result.value.value : null))
const status = computed(() => result.value.status)

if (import.meta.server) {
  // The read settles after setup, and Nuxt stores its result one tick after the
  // handler returns; the server waits for both so an unknown slug answers 404
  // instead of rendering an empty page with 200.
  await catalog.ready
  await nextTick()
  if (status.value === 'notfound') {
    throw createError({ statusCode: 404, statusMessage: 'error.productNotFound', fatal: true })
  }
}

watch(status, (value) => {
  if (value === 'notfound') {
    showError({ statusCode: 404, statusMessage: 'error.productNotFound' })
  }
})

const name = computed(() => (item.value ? readLocalized(item.value.name, locale.value) : ''))
const summary = computed(() => (item.value ? readLocalized(item.value.summary, locale.value) : ''))
const description = computed(() => {
  if (!item.value?.description) return ''
  return sanitizePublicHtml(readLocalized(item.value.description, locale.value))
})

const currency = computed(() => String(config.public.currency || item.value?.currency || 'VND'))
const price = computed(() => formatCatalogPrice(unitPrice.value, currency.value, locale.value))
const compareAtPrice = computed(() =>
  unitCompareAtPrice.value ? formatCatalogPrice(unitCompareAtPrice.value, currency.value, locale.value) : '')

const gallery = computed(() => {
  if (!item.value) return []
  const images = [item.value.thumbnail, ...item.value.gallery].filter((image): image is string => Boolean(image))
  return [...new Set(images)]
})

const activeImage = ref(0)
watch(gallery, () => {
  activeImage.value = 0
})

const primaryCategory = computed(() => item.value?.categories[0] ?? null)
const attributes = computed(() => item.value?.attributes ?? [])
const variants = computed(() => item.value?.variants ?? [])
const updatedAt = computed(() => (item.value ? formatCatalogDate(item.value.updatedAt, locale.value) : ''))

// Variant-aware purchase panel. The cart only stores the id, the SKU and the
// quantity; the price shown here is what `POST /cart/validate` re-checks.
const { add } = useCart()
const selectedVariantSku = ref<string | null>(null)
const quantity = ref(1)
const added = ref(false)

watch(item, () => {
  quantity.value = 1
  added.value = false
})

// The default variant is derived, not assigned from a watcher: that keeps the
// server-rendered markup and the hydrated client in the same state, so the
// add-to-cart button is never rendered disabled for an in-stock variant.
const defaultVariantSku = computed(() =>
  (variants.value.find(variant => variant.inStock && variant.sku) ?? variants.value[0])?.sku ?? null)
const activeVariantSku = computed(() => selectedVariantSku.value ?? defaultVariantSku.value)
const selectedVariant = computed(() => variants.value.find(variant => variant.sku === activeVariantSku.value) ?? null)
const unitPrice = computed(() => selectedVariant.value?.price ?? item.value?.price ?? 0)
const unitCompareAtPrice = computed(() => {
  const compareAt = selectedVariant.value?.compareAtPrice ?? item.value?.compareAtPrice ?? 0
  return compareAt > unitPrice.value ? compareAt : 0
})
const canAdd = computed(() => {
  if (!item.value?.inStock) return false
  if (!variants.value.length) return true
  return Boolean(selectedVariant.value?.sku && selectedVariant.value.inStock)
})

const addToCart = () => {
  if (!item.value || !canAdd.value) return
  added.value = add({
    itemId: item.value.id,
    ...(activeVariantSku.value ? { variantSku: activeVariantSku.value } : {}),
    expectedPrice: unitPrice.value,
  }, Number(quantity.value) || 1)
}

const baseUrl = String(config.public.siteUrl || requestUrl.origin)
const canonical = computed(() => buildCanonicalUrl(baseUrl, item.value?.path || route.path))

const metaTitle = computed(() => {
  if (item.value?.seo?.title) {
    const localized = readLocalized(item.value.seo.title, locale.value)
    if (localized) return localized
  }
  return name.value
})

const metaDescription = computed(() => {
  if (item.value?.seo?.description) {
    const localized = readLocalized(item.value.seo.description, locale.value)
    if (localized) return localized
  }
  return summary.value || description.value.replace(/<[^>]+>/g, ' ').slice(0, 160).trim()
})

/**
 * A share image must be absolute: a record whose media sits under this site
 * would otherwise publish a relative path a social crawler cannot fetch.
 */
const ogImage = computed(() => resolveSiteUrl(
  baseUrl,
  item.value?.seo?.image || gallery.value[0] || '/branding/og-cover.png',
))

/**
 * The breadcrumb the template renders, as structured data: the category step is
 * the product's primary one and only appears when the record has it.
 */
const breadcrumbs = computed(() => {
  const trail = [
    { name: t('common.home'), path: '/' },
    { name: t('catalog.title'), path: '/products' },
    { name: primaryCategory.value ? readLocalized(primaryCategory.value.name, locale.value) : '', path: primaryCategory.value?.path || '/products' },
    { name: name.value, path: item.value?.path || route.path },
  ]
  return buildBreadcrumbJsonLd(baseUrl, item.value ? trail : [])
})

const robots = usePageRobots()

useSeoMeta({
  title: () => metaTitle.value,
  description: () => metaDescription.value,
  ogTitle: () => metaTitle.value,
  ogDescription: () => metaDescription.value,
  ogType: 'website',
  ogUrl: () => canonical.value,
  ogImage: () => ogImage.value,
  ogImageAlt: () => name.value,
  twitterImage: () => ogImage.value,
  twitterImageAlt: () => name.value,
  twitterCard: 'summary_large_image',
  robots,
})

useHead(() => {
  if (!item.value) return { link: [] }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: name.value,
    description: metaDescription.value || undefined,
    sku: item.value.sku || undefined,
    image: gallery.value.length ? gallery.value.map(src => resolveSiteUrl(baseUrl, src)) : undefined,
    category: primaryCategory.value ? readLocalized(primaryCategory.value.name, locale.value) : undefined,
    brand: { '@type': 'Brand', name: brandName.value },
    offers: {
      '@type': 'Offer',
      url: canonical.value,
      price: unitPrice.value,
      priceCurrency: currency.value,
      availability: canAdd.value ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  }

  return {
    link: [{ rel: 'canonical', href: canonical.value }],
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(structuredData).replace(/</g, '\\u003c'),
      },
      ...(breadcrumbs.value
        ? [{
            type: 'application/ld+json' as const,
            key: 'ld-breadcrumb',
            innerHTML: JSON.stringify(breadcrumbs.value).replace(/</g, '\\u003c'),
          }]
        : []),
    ],
  }
})
</script>

<template>
  <div class="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <CatalogStateNotice v-if="status === 'disconnected' || status === 'unavailable'" :status="status" />

    <template v-else-if="item">
      <nav class="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted" :aria-label="t('a11y.breadcrumb')">
        <NuxtLink to="/" class="transition-colors hover:text-primary">{{ t('common.home') }}</NuxtLink>
        <span aria-hidden="true">/</span>
        <NuxtLink to="/products" class="transition-colors hover:text-primary">{{ t('catalog.title') }}</NuxtLink>
        <template v-if="primaryCategory">
          <span aria-hidden="true">/</span>
          <NuxtLink :to="primaryCategory.path" class="transition-colors hover:text-primary">
            {{ readLocalized(primaryCategory.name, locale) }}
          </NuxtLink>
        </template>
        <span aria-hidden="true">/</span>
        <span class="truncate text-default">{{ name }}</span>
      </nav>

      <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <div class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[6px] border border-default/60 bg-elevated/30">
            <NuxtImg
              v-if="gallery.length"
              :src="gallery[activeImage]"
              :alt="name"
              width="800"
              height="800"
              format="webp"
              class="size-full object-cover"
            />
            <UIcon v-else name="i-lucide-image-off" class="size-12 text-dimmed" aria-hidden="true" />
          </div>

          <div v-if="gallery.length > 1" class="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              v-for="(image, index) in gallery"
              :key="image"
              type="button"
              class="size-16 shrink-0 overflow-hidden rounded-[4px] border transition-colors"
              :class="index === activeImage ? 'border-primary' : 'border-default/60 hover:border-primary/50'"
              :aria-label="`${name} ${index + 1}`"
              @click="activeImage = index"
            >
              <NuxtImg :src="image" :alt="name" width="64" height="64" format="webp" class="size-full object-cover" />
            </button>
          </div>
        </div>

        <div class="flex flex-col">
          <div v-if="primaryCategory" class="mb-2 flex flex-wrap gap-1.5">
            <NuxtLink
              v-for="category in item.categories"
              :key="category.id"
              :to="category.path"
              class="rounded-[4px] border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
            >
              {{ readLocalized(category.name, locale) }}
            </NuxtLink>
          </div>

          <h1 class="text-2xl font-extrabold tracking-tight text-highlighted sm:text-3xl">
            {{ name }}
          </h1>

          <p v-if="summary" class="mt-2 text-sm text-muted">{{ summary }}</p>

          <div class="mt-5 flex flex-wrap items-end gap-3">
            <span class="text-2xl font-bold text-highlighted">{{ price }}</span>
            <span v-if="compareAtPrice" class="text-sm text-dimmed line-through">{{ compareAtPrice }}</span>
            <UBadge :color="item.inStock ? 'primary' : 'neutral'" variant="subtle" size="sm" class="rounded-[4px]">
              {{ item.inStock ? t('catalog.inStock') : t('catalog.outOfStock') }}
            </UBadge>
          </div>

          <div class="mt-6 rounded-[6px] border border-default/60 bg-elevated/20 p-4">
            <div v-if="variants.length">
              <p class="text-xs font-medium text-muted">{{ t('cart.selectVariant') }}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  v-for="variant in variants"
                  :key="variant.sku || 'base'"
                  type="button"
                  class="rounded-[4px] border px-2.5 py-1.5 text-xs transition-colors"
                  :class="activeVariantSku === variant.sku ? 'border-primary bg-primary/10 text-primary' : 'border-default/60 text-default hover:border-primary/50'"
                  :disabled="!variant.sku || !variant.inStock"
                  :aria-pressed="activeVariantSku === variant.sku"
                  @click="selectedVariantSku = variant.sku ?? null"
                >
                  {{ variant.name ? readLocalized(variant.name, locale) : variant.sku }}
                  <span class="ml-1 text-dimmed">{{ formatCatalogPrice(variant.price, currency, locale) }}</span>
                  <span v-if="!variant.inStock" class="ml-1 text-dimmed">({{ t('catalog.outOfStock') }})</span>
                </button>
              </div>
            </div>

            <div class="mt-3 flex flex-wrap items-end gap-2">
              <UInput
                v-model.number="quantity"
                type="number"
                min="1"
                max="99"
                class="w-20"
                :aria-label="t('cart.quantity')"
              />
              <UButton
                color="primary"
                size="md"
                icon="i-lucide-shopping-cart"
                :label="t('cart.add')"
                :disabled="!canAdd"
                @click="addToCart"
              />
              <UButton
                v-if="added"
                to="/gio-hang"
                color="neutral"
                variant="ghost"
                size="md"
                icon="i-lucide-arrow-right"
                trailing
                :label="t('cart.viewCart')"
              />
            </div>

            <p v-if="added" class="mt-2 text-xs text-primary">{{ t('cart.added') }}</p>
            <p v-else-if="!item.inStock" class="mt-2 text-xs text-muted">{{ t('catalog.outOfStock') }}</p>
          </div>

          <dl class="mt-5 grid grid-cols-2 gap-3 text-xs">
            <div v-if="item.sku" class="flex flex-col">
              <dt class="text-muted">{{ t('catalog.sku') }}</dt>
              <dd class="font-medium text-highlighted">{{ item.sku }}</dd>
            </div>
            <div v-if="item.uom" class="flex flex-col">
              <dt class="text-muted">{{ t('catalog.uom') }}</dt>
              <dd class="font-medium text-highlighted">{{ item.uom }}</dd>
            </div>
            <div v-if="updatedAt" class="flex flex-col">
              <dt class="text-muted">{{ t('content.updatedAt') }}</dt>
              <dd class="font-medium text-highlighted">{{ updatedAt }}</dd>
            </div>
          </dl>

          <div v-if="attributes.length" class="mt-6">
            <h2 class="text-sm font-semibold text-highlighted">{{ t('catalog.attributes') }}</h2>
            <dl class="mt-2 divide-y divide-default/50 rounded-[6px] border border-default/60">
              <div v-for="(attribute, index) in attributes" :key="index" class="grid grid-cols-2 gap-2 px-3 py-2 text-xs">
                <dt class="text-muted">{{ readLocalized(attribute.name, locale) }}</dt>
                <dd class="text-default">{{ readLocalized(attribute.value, locale) }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="variants.length" class="mt-6">
            <h2 class="text-sm font-semibold text-highlighted">{{ t('catalog.variants') }}</h2>
            <div class="mt-2 overflow-hidden rounded-[6px] border border-default/60">
              <table class="w-full text-left text-xs">
                <thead class="bg-elevated/30 text-muted">
                  <tr>
                    <th class="px-3 py-2 font-medium">{{ t('catalog.variantName') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('catalog.variantSku') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('catalog.variantPrice') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('catalog.variantStock') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default/50">
                  <tr v-for="(variant, index) in variants" :key="variant.sku || index">
                    <td class="px-3 py-2 text-default">{{ variant.name ? readLocalized(variant.name, locale) : '—' }}</td>
                    <td class="px-3 py-2 text-muted">{{ variant.sku || '—' }}</td>
                    <td class="px-3 py-2 font-medium text-highlighted">
                      {{ formatCatalogPrice(variant.price, currency, locale) }}
                    </td>
                    <td class="px-3 py-2 text-muted">
                      {{ variant.inStock ? t('catalog.inStock') : t('catalog.outOfStock') }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap gap-2">
            <UButton to="/products" color="neutral" variant="soft" size="md" icon="i-lucide-arrow-left" :label="t('catalog.backToList')" />
            <UButton
              v-if="primaryCategory"
              :to="primaryCategory.path"
              color="primary"
              variant="ghost"
              size="md"
              :label="t('catalog.viewCategory')"
            />
          </div>
        </div>
      </div>

      <section v-if="description" class="mt-12 border-t border-default/50 pt-8">
        <h2 class="text-lg font-semibold text-highlighted">{{ t('catalog.description') }}</h2>
        <CatalogRichText class="mt-3" :html="description" />
      </section>
    </template>

    <div v-else-if="pending" class="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div class="aspect-square animate-pulse rounded-[6px] border border-default/50 bg-elevated/30" />
      <div class="space-y-3">
        <div class="h-8 w-2/3 animate-pulse rounded bg-elevated/40" />
        <div class="h-4 w-1/3 animate-pulse rounded bg-elevated/30" />
        <div class="h-24 w-full animate-pulse rounded bg-elevated/20" />
      </div>
    </div>
  </div>
</template>
