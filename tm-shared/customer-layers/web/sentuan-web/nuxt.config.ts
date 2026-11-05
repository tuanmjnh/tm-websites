export default defineNuxtConfig({
  app: {
    head: {
      title: 'Sen Tuấn Jewelry & Gemstones',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/branding/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/branding/logo.svg' },
      ],
      meta: [
        { name: 'description', content: 'Trang sức & đá quý cao cấp Sen Tuấn' },
        { name: 'theme-color', content: '#f59e0b' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: 'Sen Tuấn Jewelry & Gemstones' },
        { property: 'og:description', content: 'Trang sức & đá quý cao cấp Sen Tuấn' },
        { property: 'og:image', content: '/branding/og-cover.png' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
    },
  },
})
