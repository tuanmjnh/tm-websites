import assert from 'node:assert/strict'
import {
  PublicSiteSchema,
  buildPublicSite,
  findPublicMenu,
  publicMenuLabel,
} from '../../tm-shared/packages/flow-contracts/src/site-public.js'
import { connectMongo } from '../../tm-web/server/utils/mongo.js'
import {
  PUBLIC_MEDIA_PROJECTION,
  PUBLIC_MENU_PROJECTION,
  PUBLIC_SETTINGS_PROJECTION,
  PublicMediaModel,
  PublicSettingsModel,
  PublicSiteMenuModel,
  buildCategorySlugMap,
  buildMediaUrlMap,
} from '../../tm-web/server/models/sitePublic.js'
import { PublicCategoryModel } from '../../tm-web/server/models/contentCategoryPublic.js'
import { dropTestMongooseDatabase } from './testDatabase.js'

/**
 * Live checks for the storefront's public site read path: the projections must
 * drop every admin field, and a menu must resolve to real paths per locale.
 */

const DB_NAME = 'tm_test_public_site'
const URI = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'

let checks = 0
let notRun = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

// The media documents are created through the model, so mongoose assigns the ids;
// the settings below are given those ids once they exist.
let LOGO_ID = ''
let IMAGE_ID = ''
let DOCUMENT_ID = ''
const LOGO_KEY = 'sentuan/2026/aaaaaaaa-1111-4111-8111-111111111111.png'
const IMAGE_KEY = 'sentuan/2026/bbbbbbbb-2222-4222-8222-222222222222.webp'
const DOCUMENT_KEY = 'sentuan/2026/cccccccc-3333-4333-8333-333333333333.pdf'

const settingsDoc = {
  siteId: 'sentuan',
  revision: 4,
  company: { name: 'Sen Tuấn', email: 'hello@sentuan.vn', phone: '0909', address: 'Hà Nội', logoMediaId: '' },
  seo: { titleTemplate: '%s | Sen Tuấn', defaultDescription: 'Trang sức', defaultImageMediaId: '' },
  locales: { default: 'vi', enabled: ['vi', 'en'] },
  // Private fields that must never reach the storefront.
  modules: { content: true, catalog: false },
  updatedBy: { id: 'user_admin', name: 'Admin', email: 'admin@example.com' },
}

const menus = [
  {
    siteId: 'sentuan',
    key: 'main',
    name: 'Menu chính',
    revision: 3,
    items: [
      { label: { vi: 'Giới thiệu', en: 'About us' }, link: { type: 'content', target: 'gioi-thieu' } },
      { label: { vi: 'Trang sức', en: '' }, link: { type: 'category', target: 'trang-suc' } },
      { label: { vi: 'Liên hệ', en: 'Contact' }, link: { type: 'url', target: '/lien-he' } },
      { label: { vi: 'Nội bộ', en: '' }, link: { type: 'url', target: '/api/v1/admin/content' } },
    ],
  },
  { siteId: 'sentuan', key: 'footer', name: 'Menu chân trang', revision: 1, items: [] },
]

async function load(connection: Awaited<ReturnType<typeof connectMongo>>) {
  await dropTestMongooseDatabase(connection)
  const logo = await PublicMediaModel.create({ siteId: 'sentuan', kind: 'image', storage: { provider: 'local', key: LOGO_KEY } })
  const image = await PublicMediaModel.create({ siteId: 'sentuan', kind: 'image', storage: { provider: 'local', key: IMAGE_KEY } })
  const document = await PublicMediaModel.create({ siteId: 'sentuan', kind: 'document', storage: { provider: 'local', key: DOCUMENT_KEY } })
  LOGO_ID = String(logo._id)
  IMAGE_ID = String(image._id)
  DOCUMENT_ID = String(document._id)
  await connection.connection.collection('settings').insertOne({
    ...settingsDoc,
    company: { ...settingsDoc.company, logoMediaId: LOGO_ID },
    seo: { ...settingsDoc.seo, defaultImageMediaId: IMAGE_ID },
  })
  await connection.connection.collection('site_menus').insertMany(menus.map(menu => ({ ...menu })))
  await connection.connection.collection('categories').insertMany([
    { key: 'trang-suc', locales: [{ locale: 'vi', name: 'Trang sức', slug: 'trang-suc' }, { locale: 'en', name: 'Jewelry', slug: 'jewelry' }] },
    { key: 'phu-kien', locales: [{ locale: 'vi', name: 'Phụ kiện', slug: 'phu-kien' }] },
  ])
}

async function readSite(locale: string, mediaBaseUrl = '') {
  const [settings, menuDocs] = await Promise.all([
    PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown> | null>(),
    PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>(),
  ])
  const mediaDocs = await PublicMediaModel
    .find({ kind: 'image' })
    .select(PUBLIC_MEDIA_PROJECTION)
    .lean<{ _id?: unknown, kind?: unknown, storage?: { key?: unknown } }[]>()

  const keys = new Set<string>()
  for (const menu of menuDocs) {
    for (const raw of (menu.items as { link?: { type?: string, target?: string } }[] | undefined) ?? []) {
      if (raw.link?.type === 'category' && raw.link.target) keys.add(raw.link.target)
    }
  }

  const categoryDocs = await PublicCategoryModel
    .find({ key: { $in: [...keys] } })
    .select('key locales')
    .lean<{ key?: string, locales?: unknown }[]>()

  return buildPublicSite({
    settings,
    menus: menuDocs,
    categorySlugs: buildCategorySlugMap(categoryDocs, locale),
    mediaUrls: buildMediaUrlMap(mediaDocs, mediaBaseUrl),
  })
}

async function integration() {
  let connection
  try {
    connection = await connectMongo({ uri: URI, database: DB_NAME })
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await check('the settings projection drops modules, revision and actor', async () => {
      await load(connection)
      const doc = await PublicSettingsModel.findOne({}).select(PUBLIC_SETTINGS_PROJECTION).lean<Record<string, unknown>>()
      assert.ok(doc)
      assert.deepEqual(Object.keys(doc).sort(), ['_id', 'company', 'locales', 'seo'])
      assert.equal(doc.modules, undefined)
      assert.equal(doc.revision, undefined)
      assert.equal(doc.updatedBy, undefined)
      assert.equal((doc.company as { name: string }).name, 'Sen Tuấn')
    })

    await check('the menu projection keeps ordered items and drops site and revision', async () => {
      const docs = await PublicSiteMenuModel.find({}).select(PUBLIC_MENU_PROJECTION).sort({ key: 1 }).lean<Record<string, unknown>[]>()
      assert.deepEqual(docs.map(doc => doc.key), ['footer', 'main'])
      assert.deepEqual(Object.keys(docs[1]!).sort(), ['_id', 'items', 'key'])
      assert.equal((docs[1]!.items as unknown[]).length, 4)
      assert.equal(docs[0]!.items && (docs[0]!.items as unknown[]).length, 0)
    })

    await check('the header menu resolves to locale paths', async () => {
      const vi = await readSite('vi')
      const header = findPublicMenu(vi.menus, 'main')
      assert.ok(header)
      assert.deepEqual(header.items.map(item => `${publicMenuLabel(item.label, 'vi')} ${item.href}`), [
        'Giới thiệu /gioi-thieu',
        'Trang sức /danh-muc/trang-suc',
        'Liên hệ /lien-he',
        'Nội bộ /api/v1/admin/content',
      ])

      const en = await readSite('en')
      assert.deepEqual(findPublicMenu(en.menus, 'main')!.items.map(item => publicMenuLabel(item.label, 'en')), [
        'About us',
        'Trang sức',
        'Contact',
        'Nội bộ',
      ])
      assert.equal(findPublicMenu(en.menus, 'main')!.items[1]!.href, '/danh-muc/jewelry')
    })

    await check('a category with only a vi slug falls back instead of breaking', async () => {
      const map = buildCategorySlugMap(
        [{ key: 'phu-kien', locales: [{ locale: 'vi', name: 'Phụ kiện', slug: 'phu-kien' }] }],
        'en',
      )
      assert.equal(map.get('phu-kien'), 'phu-kien')
      assert.equal(buildCategorySlugMap([{ key: 'empty', locales: [] }], 'en').get('empty'), 'empty')
      assert.equal(buildCategorySlugMap([{ locales: [] }], 'en').size, 0)
    })

    await check('the assembled document matches the public contract', async () => {
      const site = await readSite('vi')
      const parsed = PublicSiteSchema.safeParse(site)
      assert.equal(parsed.success, true)
      assert.equal(site.company.email, 'hello@sentuan.vn')
      assert.equal(site.seo.titleTemplate, '%s | Sen Tuấn')
      assert.deepEqual(site.locales, { default: 'vi', enabled: ['vi', 'en'] })
      assert.equal(JSON.stringify(site).includes('admin@example.com'), false)
      assert.equal(JSON.stringify(site).includes('revision'), false)
    })

    await check('a configured media origin turns the settings ids into absolute URLs', async () => {
      const site = await readSite('vi', 'https://cms.example/')
      assert.equal(site.company.logoUrl, `https://cms.example/media/${LOGO_KEY}`)
      assert.equal(site.seo.defaultImageUrl, `https://cms.example/media/${IMAGE_KEY}`)
      assert.equal(PublicSiteSchema.safeParse(site).success, true)

      const unresolved = await readSite('vi')
      assert.equal(unresolved.company.logoUrl, '')
      assert.equal(unresolved.seo.defaultImageUrl, '')
      assert.equal(unresolved.company.logoMediaId, LOGO_ID)
    })

    await check('a document or an unsafe storage key never becomes an image URL', () => {
      const map = buildMediaUrlMap([
        { _id: DOCUMENT_ID, kind: 'document', storage: { key: LOGO_KEY } },
        { _id: IMAGE_ID, kind: 'image', storage: { key: '../outside.png' } },
        { _id: LOGO_ID, kind: 'image', storage: { key: LOGO_KEY } },
      ], 'https://cms.example')
      assert.deepEqual([...map.keys()], [LOGO_ID])
      assert.equal(map.get(LOGO_ID), `https://cms.example/media/${LOGO_KEY}`)
    })

    await check('an empty database reads defaults rather than failing', async () => {
      await dropTestMongooseDatabase(connection)
      const site = await readSite('vi')
      assert.equal(site.company.name, '')
      assert.equal(site.seo.titleTemplate, '%s')
      assert.deepEqual(site.menus, [])
      assert.equal(PublicSiteSchema.safeParse(site).success, true)
    })
  } finally {
    await dropTestMongooseDatabase(connection).catch(() => undefined)
    await connection.disconnect()
  }
}

try {
  await integration()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}

console.log(`\n${checks} checks passed${notRun ? `, ${notRun} not run` : ''}`)
if (process.exitCode) {
  console.error('Public site checks failed')
}
