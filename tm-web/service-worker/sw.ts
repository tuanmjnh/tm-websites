/// <reference lib="webworker" />

// Built by @vite-pwa/nuxt (injectManifest): `self.__WB_MANIFEST` below is
// replaced at build time with the content-hashed client assets of this customer
// build plus the static files in `public/`. No SSR document and no API response
// is ever part of it, so nothing rendered for one visitor can be replayed for
// another.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string, revision: string | null }>
}

const OFFLINE_URL = '/offline.html'
const OFFLINE_CACHE = 'tm-offline'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// The offline page is cached here rather than through the build manifest: the
// Nuxt module rewrites `*.html` entries to extension-less URLs, and the
// fallback below has to match the file byte for byte.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(OFFLINE_CACHE)
    await cache.add(OFFLINE_URL)
    // Activate as soon as this build installs: every precached URL is content
    // addressed, so replacing the cache cannot mix two builds' files.
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Navigations always go to the network. An SSR document can carry per-visitor
// state (session, locale, cart), so it must never be written to a shared cache;
// only the failure path falls back to the cached offline page.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin,
  async ({ request }) => {
    try {
      return await fetch(request)
    }
    catch {
      return (await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE })) ?? Response.error()
    }
  },
)
