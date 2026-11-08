import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveCustomerLayers } from '../tm-shared/customer-layers/registry/resolver.js'

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, '..')

const customerId = process.env.TM_CUSTOMER_ID || (process.env.VERCEL ? '' : 'default')

const selected = resolveCustomerLayers({
  appKind: 'web',
  customerId,
  repoRoot,
})

if (process.env.TM_APP_KIND && process.env.TM_APP_KIND !== 'web') {
  throw new Error(`[TM Config Error] TM_APP_KIND must be "web" for tm-web host, received: "${process.env.TM_APP_KIND}"`)
}

console.info(`🌐 [TM Build] Initializing Nuxt 4 SSR | Host: web | Customer: ${selected.customerId}`)

export default defineNuxtConfig({
  ssr: true,

  extends: selected.extends,

  modules: [
    '@nuxt/image',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@vite-pwa/nuxt',
    // Must stay last: generates .nuxt/eslint.config.mjs consumed by eslint.config.mjs
    '@nuxt/eslint',
  ],

  // Offline shell for the storefront. Customer identity (name, colours, icons)
  // lives in each customer layer's public/manifest.webmanifest; this block only
  // holds tenant-agnostic behaviour, so a build cannot emit another tenant's brand.
  pwa: {
    // Never served from `nuxt dev`: a localhost worker would survive redeploys
    // and shadow the next build's assets wiped by `cache:clear`.
    disable: Boolean(process.env.TM_PWA_DISABLED) || process.env.NODE_ENV !== 'production',
    registerType: 'autoUpdate',
    // Point at the customer layer's static manifest instead of generating one
    // here, and let that layer own its icons.
    manifest: false,
    includeManifestIcons: false,
    injectRegister: false,
    // Hand-written worker: generateSW's `navigateFallback` answers every route
    // with one precached document, which is wrong for an SSR storefront.
    strategies: 'injectManifest',
    srcDir: resolve(appDir, 'service-worker'),
    filename: 'sw.ts',
    injectManifest: {
      // Hashed client assets plus the customer's shell files. SSR documents are
      // never matched, so no rendered page can end up in this manifest; the
      // offline page is cached by the worker itself to keep its `.html` URL.
      globPatterns: ['**/*.{js,css,woff2,webmanifest,png,svg,ico}'],
    },
    // Serves `/sw.js` with must-revalidate, so a new deployment is picked up on
    // the next visit instead of being pinned by an HTTP cache.
    registerWebManifestInRouteRules: true,
    devOptions: {
      enabled: false,
    },
  },

  i18n: {
    // i18n v10 resolves `file` from <rootDir>/i18n/locales/ by default
    locales: [
      { code: 'vi', language: 'vi-VN', name: 'Tiếng Việt', file: 'vi.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    defaultLocale: 'vi',
    // Public URLs stay locale-free; language is negotiated per visitor
    strategy: 'no_prefix',
  },

  runtimeConfig: {
    // Server-only. Never exposed to the browser: the website reads its catalog
    // through the BFF, so credentials and the database name stay on the server.
    mongoUri: process.env.TM_MONGO_URI || (process.env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017'),
    catalogDbName: process.env.TM_MONGO_DB || selected.mongoDbName || '',
    revalidateSecret: process.env.REVALIDATE_SECRET || '',

    public: {
      siteId: process.env.TM_SITE_ID || 'main',
      siteUrl: process.env.TM_SITE_URL || '',
      indexable: process.env.TM_SITE_INDEXABLE !== 'false',
      hubUrl: process.env.TM_HUB_URL || 'http://localhost:4000',
      hubAppId: process.env.TM_WEB_APP_ID || selected.appId,
      appId: process.env.TM_WEB_APP_ID || selected.appId,
      customerId: selected.customerId,
      tenantId: process.env.TM_TENANT_ID || selected.tenantId,
      currency: process.env.TM_CURRENCY || 'VND',
      catalogEnabled: Boolean(process.env.TM_MONGO_DB || selected.mongoDbName),
    },
  },

  image: {
    // Remote storefront imagery (Cloudinary/Unsplash libraries in the CMS data).
    domains: (process.env.TM_IMAGE_DOMAINS || 'res.cloudinary.com,images.unsplash.com,images.pexels.com')
      .split(',')
      .map(domain => domain.trim())
      .filter(Boolean),
  },

  routeRules: {
    // Storefront reads are served from the Nitro cache with tenant-scoped keys
    // (see server/utils/catalogCache.ts); publishing content can purge them.
    '/api/public/**': {
      cors: true,
      headers: {
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    },
    '/api/_internal/**': { cache: false },
    '/api/auth/**': { cache: false },
  },

  typescript: {
    strict: true,
  },

  // Nuxt 4.6.4 resolves an unset devServer.host to `{}`, which crashes @nuxt/cli
  // 4.0.1 in syncAllowedHosts (options.hostname.toLowerCase is not a function).
  // Pin it to a string; the port still comes from `nuxt dev --port 4006`.
  devServer: {
    host: 'localhost',
  },

  devtools: { enabled: false },
})
