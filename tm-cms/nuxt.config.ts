import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveCustomerLayers } from '../tm-shared/customer-layers/registry/resolver.js'

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, '..')

/**
 * The Vue build this app already loads, so a `link:`ed package shares it rather
 * than pulling its own copy from the other repo's tree. Resolved through the
 * pnpm store because no `vue` is reachable from this package's `node_modules`.
 */
function appVueEntry(): string {
  const store = resolve(repoRoot, 'node_modules/.pnpm')
  const entry = readdirSync(store).find(name => name.startsWith('vue@'))
  return entry
    ? resolve(store, entry, 'node_modules/vue/dist/vue.runtime.esm-bundler.js')
    : 'vue'
}

const customerId = process.env.TM_CUSTOMER_ID || (process.env.VERCEL ? '' : 'default')

const selected = resolveCustomerLayers({
  appKind: 'cms',
  customerId,
  repoRoot,
})

if (process.env.TM_APP_KIND && process.env.TM_APP_KIND !== 'cms') {
  throw new Error(`[TM Config Error] TM_APP_KIND must be "cms" for tm-cms host, received: "${process.env.TM_APP_KIND}"`)
}

console.info(`🚀 [TM Build] Initializing Nuxt 4 SPA | Host: cms | Customer: ${selected.customerId}`)

export default defineNuxtConfig({
  ssr: false,

  extends: selected.extends,

  modules: [
    '@nuxt/image',
    '@nuxtjs/i18n',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    // Must stay last: generates .nuxt/eslint.config.mjs consumed by eslint.config.mjs
    '@nuxt/eslint',
  ],

  i18n: {
    // i18n v10 resolves `file` from <rootDir>/i18n/locales/ by default
    locales: [
      { code: 'vi', language: 'vi-VN', name: 'Tiếng Việt', file: 'vi.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
    ],
    defaultLocale: 'vi',
    // Admin UI keeps a stable URL surface; locale lives in a cookie, not the path
    strategy: 'no_prefix',
  },

  runtimeConfig: {
    hubSecret: process.env.TM_HUB_SECRET || '',
    authMode: process.env.TM_AUTH_MODE || 'hub',
    // Server-only customer database binding. The registry owns the database
    // name; TM_MONGO_DB may only repeat it, never point at another customer.
    mongoUri: process.env.TM_MONGO_URI || '',
    mongoDbName: selected.mongoDbName || '',
    mongoDbOverride: process.env.TM_MONGO_DB || '',
    // Site that content records belong to; deployment-scoped, never request input.
    siteId: process.env.TM_SITE_ID || selected.customerId || '',
    // Paired storefront for cache purges after a settings/menu save. Both halves
    // are required: without TM_REVALIDATE_SECRET the call is skipped, never sent
    // with an empty secret.
    webRevalidateUrl: process.env.TM_WEB_REVALIDATE_URL || '',
    revalidateSecret: process.env.TM_REVALIDATE_SECRET || '',
    public: {
      hubUrl: process.env.TM_HUB_URL || 'http://localhost:4000',
      hubAppId: process.env.TM_CMS_APP_ID || selected.appId,
      appId: process.env.TM_CMS_APP_ID || selected.appId,
      // Content belongs to the paired Website app so the CMS edits what the site renders.
      contentAppId: process.env.TM_CONTENT_APP_ID || selected.contentAppId,
      customerId: selected.customerId,
      tenantId: process.env.TM_TENANT_ID || selected.tenantId,
    },
  },

  typescript: {
    strict: true,
  },

  // Nuxt 4.6.4 resolves an unset devServer.host to `{}`, which crashes @nuxt/cli
  // 4.0.1 in syncAllowedHosts (options.hostname.toLowerCase is not a function).
  // Pin it to a string; the port still comes from `nuxt dev --port 4005`.
  devServer: {
    host: 'localhost',
  },

  // `@tuanmjnh/tm-ui` is consumed with `link:`, so its files live outside this
  // project: Vite must be allowed to serve them, and it must not resolve `vue`
  // from the package's own tree (3.5.45 next to our 3.5.44). Two Vue instances
  // make the package's `resolveComponent()` return a tag name, and its pills
  // then render as empty `<ubadge>` elements with no warning.
  vite: {
    server: {
      fs: {
        allow: [fileURLToPath(new URL('../tm-platform/packages/tm-ui', import.meta.url))],
      },
    },
    resolve: {
      alias: [{ find: /^vue$/, replacement: appVueEntry() }],
    },
  },

  devtools: { enabled: false },
})
