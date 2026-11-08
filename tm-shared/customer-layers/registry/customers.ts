import type { CustomerRegistry } from './schema'

const CMS_ASSETS = [
  'public/branding/logo.svg',
  'public/branding/favicon.svg',
  'public/branding/icon-192.png',
  'public/branding/icon-512.png',
  'public/manifest.webmanifest',
]

const WEB_ASSETS = [
  'public/branding/logo.svg',
  'public/branding/favicon.svg',
  'public/branding/icon-192.png',
  'public/branding/icon-512.png',
  'public/branding/og-cover.png',
  'public/manifest.webmanifest',
]

export const customers: CustomerRegistry = {
  default: {
    customerId: 'default',
    tenantId: 'tenant_default',
    companyName: 'TM Enterprise Platform',
    displayName: 'TM Enterprise Default',
    status: 'active',
    domains: ['localhost', 'tm-web.vercel.app'],
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/default-cms',
        displayName: 'TM Default CMS',
        appId: 'app_default_cms',
        requiredAssets: CMS_ASSETS,
      },
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/default-web',
        displayName: 'TM Default Website',
        appId: 'app_default_web',
        requiredAssets: WEB_ASSETS,
      },
    },
  },

  sentuan: {
    customerId: 'sentuan',
    tenantId: 'tenant_sentuan',
    companyName: 'Sen Tuấn Jewelry & Gemstones',
    displayName: 'Sen Tuấn Jewelry & Gemstones',
    status: 'active',
    domains: ['sentuan.vn', 'www.sentuan.vn'],
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/sentuan-cms',
        displayName: 'Sen Tuấn CMS',
        appId: 'app_sentuan_cms',
        requiredAssets: CMS_ASSETS,
      },
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/sentuan-web',
        displayName: 'Sen Tuấn Website',
        appId: 'app_sentuan_web',
        requiredAssets: WEB_ASSETS,
      },
    },
    dataSources: {
      mongo: { database: 'sen-tuan' },
    },
  },

  bagpost: {
    customerId: 'bagpost',
    tenantId: 'tenant_bag_post',
    companyName: 'Bag Post Logistics & Packaging',
    displayName: 'Bag Post Logistics & Packaging',
    status: 'active',
    domains: ['bagpost.vn', 'www.bagpost.vn'],
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/bag-post-cms',
        displayName: 'Bag Post CMS',
        appId: 'app_bag_post_cms',
        requiredAssets: CMS_ASSETS,
      },
      web: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/web/bag-post-web',
        displayName: 'Bag Post Website',
        appId: 'app_bag_post_web',
        requiredAssets: WEB_ASSETS,
      },
    },
    dataSources: {
      mongo: { database: 'bag-post' },
    },
  },

  thanhtung: {
    customerId: 'thanhtung',
    tenantId: 'tenant_thanh_tung',
    companyName: 'Thanh Tùng Industrial Commerce',
    displayName: 'Thanh Tùng Industrial Commerce',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/thanh-tung',
        displayName: 'Thanh Tùng CMS',
        appId: 'app_thanh_tung_cms',
        requiredAssets: CMS_ASSETS,
      },
      // CMS only deployment
    },
  },

  hoangvi: {
    customerId: 'hoangvi',
    tenantId: 'tenant_hoang_vi',
    companyName: 'Hoàng Vi Beauty & Cosmetics',
    displayName: 'Hoàng Vi Beauty & Cosmetics',
    status: 'active',
    apps: {
      cms: {
        enabled: true,
        layerPath: 'tm-shared/customer-layers/cms/hoang-vi',
        displayName: 'Hoàng Vi CMS',
        appId: 'app_hoang_vi_cms',
        requiredAssets: CMS_ASSETS,
      },
      // CMS only deployment
    },
  },

  // __TM_REGISTRY_ENTRIES__
} as const
