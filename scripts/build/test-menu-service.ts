import assert from 'node:assert/strict'
import {
  MenuServiceError,
  createMenu,
  deleteMenu,
  getMenu,
  listMenuLinkOptions,
  listMenus,
  updateMenu,
} from '../../tm-cms/server/services/menuService.js'
import { findMenuReferences } from '../../tm-cms/server/services/menuReferences.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

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

function isMenuError(status: number, code: string) {
  return (error: unknown) => error instanceof MenuServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ADMIN = { id: 'user_admin', name: 'Quản trị A', email: 'admin@example.com' }
const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_menu_service' }

const items = [
  { label: { vi: 'Giới thiệu', en: 'About us' }, link: { type: 'content', target: 'gioi-thieu' } },
  { label: { vi: 'Trang sức', en: '' }, link: { type: 'category', target: 'trang-suc' } },
  { label: { vi: 'Liên hệ', en: 'Contact' }, link: { type: 'url', target: '/lien-he' } },
]

async function integration() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await connection.db!.dropDatabase()
    const { Menu, Audit, Content, Category } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ADMIN, requestId: 'req_menu' } }

    let mainId = ''

    await check('an empty site lists no menus', async () => {
      assert.deepEqual(await listMenus(Menu, SITE), [])
    })

    await check('creating a menu folds the key and records one audit entry', async () => {
      const created = await createMenu(Menu, SITE, { key: 'Menu chính', name: ' Menu chính ' }, meta)
      mainId = created.id
      assert.equal(created.key, 'menu-chinh', 'the key is a slug, not free text')
      assert.equal(created.name, 'Menu chính')
      assert.equal(created.revision, 1)
      assert.equal(created.itemCount, 0)
      assert.deepEqual(created.items, [])

      const entries = await Audit.find({ siteId: SITE }).lean()
      assert.equal(entries.length, 1)
      assert.equal(entries[0]!.resourceType, 'menu')
      assert.equal(entries[0]!.resourceKey, 'menu-chinh')
      assert.equal(entries[0]!.action, 'create')
      assert.equal(entries[0]!.revision, 1)
      assert.deepEqual(entries[0]!.actor, ADMIN)
      assert.equal(entries[0]!.requestId, 'req_menu')
    })

    await check('a duplicate key is a conflict, not a second menu', async () => {
      await assert.rejects(
        () => createMenu(Menu, SITE, { key: 'menu-chinh', name: 'Bản sao' }, meta),
        isMenuError(409, 'MENU_KEY_EXISTS'),
      )
      assert.equal(await Menu.countDocuments({ siteId: SITE }), 1)
    })

    await check('an unusable key or a nameless menu is refused', async () => {
      await assert.rejects(
        () => createMenu(Menu, SITE, { key: '!!!', name: 'Empty' }, meta),
        isMenuError(422, 'MENU_KEY_INVALID'),
      )
      await assert.rejects(
        () => createMenu(Menu, SITE, { key: 'footer', name: '   ' }, meta),
        isMenuError(422, 'MENU_NAME_REQUIRED'),
      )
      assert.equal(await Menu.countDocuments({ siteId: SITE }), 1)
    })

    await check('saving items bumps the revision and keeps their order', async () => {
      const updated = await updateMenu(Menu, SITE, mainId, { revision: 1, items }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.itemCount, 3)
      assert.deepEqual(updated.items.map(item => item.link.target), ['gioi-thieu', 'trang-suc', '/lien-he'])
      assert.equal(updated.items[0]!.label.en, 'About us')
      assert.equal(updated.items[1]!.label.en, '', 'a missing translation stays empty instead of borrowing vi')

      const entry = await Audit.findOne({ siteId: SITE, action: 'update' }).lean()
      assert.equal(entry!.revision, 2)
      assert.deepEqual(entry!.changedFields, ['items'])
    })

    await check('the detail read returns the stored items for this site only', async () => {
      const loaded = await getMenu(Menu, SITE, mainId)
      assert.equal(loaded.id, mainId)
      assert.equal(loaded.items.length, 3)
      await assert.rejects(
        () => getMenu(Menu, OTHER_SITE, mainId),
        isMenuError(404, 'MENU_NOT_FOUND'),
        'another site cannot read this menu by id',
      )
    })

    await check('a stale revision and a no-op save are both refused', async () => {
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 1, name: 'Stale' }, meta),
        isMenuError(409, 'MENU_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items }, meta),
        isMenuError(422, 'MENU_UPDATE_UNCHANGED'),
      )
      assert.equal((await getMenu(Menu, SITE, mainId)).revision, 2)
      assert.equal(await Audit.countDocuments({ siteId: SITE, resourceType: 'menu' }), 2)
    })

    await check('item validation rejects a missing label, a bad target and an unknown type', async () => {
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items: [{ label: { vi: '', en: '' }, link: { type: 'url', target: '/' } }] }, meta),
        isMenuError(422, 'MENU_LABEL_REQUIRED'),
      )
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items: [{ label: { vi: 'X' }, link: { type: 'url', target: 'lien-he' } }] }, meta),
        isMenuError(422, 'MENU_TARGET_INVALID'),
        'a bare path without a leading slash cannot be resolved',
      )
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items: [{ label: { vi: 'X' }, link: { type: 'category', target: 'Trang sức' } }] }, meta),
        isMenuError(422, 'MENU_TARGET_INVALID'),
        'a category target must already be a key',
      )
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items: [{ label: { vi: 'X' }, link: { type: 'search', target: '/' } }] }, meta),
        isMenuError(422, 'MENU_LINK_TYPE_INVALID'),
      )
      assert.equal((await getMenu(Menu, SITE, mainId)).itemCount, 3)
    })

    await check('a menu holds at most 30 items', async () => {
      const tooMany = Array.from({ length: 31 }, (_, index) => ({
        label: { vi: `Mục ${index}`, en: '' },
        link: { type: 'url' as const, target: `/muc-${index}` },
      }))
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, items: tooMany }, meta),
        isMenuError(422, 'MENU_ITEMS_LIMIT'),
      )
    })

    await check('the key cannot change after creation', async () => {
      await assert.rejects(
        () => updateMenu(Menu, SITE, mainId, { revision: 2, key: 'other', name: 'Khác' }, meta),
        isMenuError(422, 'MENU_KEY_IMMUTABLE'),
      )
    })

    await check('another site keeps its own menus and audit trail', async () => {
      const created = await createMenu(Menu, OTHER_SITE, { key: 'menu-chinh', name: 'Bạg Post' }, meta)
      assert.equal(created.key, 'menu-chinh', 'the same key is free on another site')
      assert.deepEqual((await listMenus(Menu, OTHER_SITE)).map(entry => entry.name), ['Bạg Post'])
      assert.equal((await listMenus(Menu, SITE)).length, 1)
      assert.equal(await Audit.countDocuments({ siteId: OTHER_SITE }), 1)
    })

    await check('deleting needs the current revision and leaves an audit entry', async () => {
      await assert.rejects(
        () => deleteMenu(Menu, SITE, mainId, 1, meta),
        isMenuError(409, 'MENU_REVISION_CONFLICT'),
      )
      const removed = await deleteMenu(Menu, SITE, mainId, 2, meta)
      assert.equal(removed.key, 'menu-chinh')
      assert.deepEqual(await listMenus(Menu, SITE), [])

      const entry = await Audit.findOne({ siteId: SITE, action: 'delete' }).lean()
      assert.equal(entry!.resourceType, 'menu')
      assert.equal(entry!.revision, 3)

      await assert.rejects(
        () => getMenu(Menu, SITE, mainId),
        isMenuError(404, 'MENU_NOT_FOUND'),
      )
    })

    await check('links must point at a page or category that exists in this site', async () => {
      // Only the fields the lookup reads: the service checks references, not status.
      const page = (key: string, deletedAt: Date | null) => ({
        siteId: SITE,
        key,
        status: 'draft',
        deletedAt,
        locales: [{ locale: 'vi', slug: key }],
      })
      await Content.collection.insertOne(page('gioi-thieu', null))
      await Content.collection.insertOne(page('tin-cu', new Date()))
      await Category.collection.insertOne({
        siteId: SITE,
        key: 'trang-suc',
        locales: [{ locale: 'vi', name: 'Trang sức', slug: 'trang-suc' }],
      })
      await Category.collection.insertOne({ siteId: OTHER_SITE, key: 'bag-post' })

      const withRefs = { ...meta, refs: { content: Content, category: Category } }
      const menu = await createMenu(Menu, SITE, { key: 'menu-refs', name: 'Menu refs' }, withRefs)
      const saved = await updateMenu(Menu, SITE, menu.id, { revision: 1, items }, withRefs)
      assert.equal(saved.revision, 2, 'existing page, category and path all save')

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: [...items, { label: { vi: 'Mất' }, link: { type: 'content', target: 'khong-ton-tai' } }],
        }, withRefs),
        (error: unknown) => {
          assert.ok(isMenuError(422, 'MENU_TARGET_NOT_FOUND')(error))
          const details = (error as MenuServiceError).details as { missing: Array<{ index: number, path: string, target: string }> }
          assert.deepEqual(details.missing, [{ index: 3, path: '4', type: 'content', target: 'khong-ton-tai' }])
          return true
        },
      )

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: [{ label: { vi: 'Tin cũ' }, link: { type: 'content', target: 'tin-cu' } }],
        }, withRefs),
        isMenuError(422, 'MENU_TARGET_NOT_FOUND'),
        'a soft-deleted page is not a target',
      )

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: [{ label: { vi: 'Bag' }, link: { type: 'category', target: 'bag-post' } }],
        }, withRefs),
        isMenuError(422, 'MENU_TARGET_NOT_FOUND'),
        'another site\'s category key is not a target',
      )

      assert.equal((await getMenu(Menu, SITE, menu.id)).revision, 2, 'a refused save writes nothing')
      await deleteMenu(Menu, SITE, menu.id, 2, meta)
    })

    await check('children are stored, counted and returned in order', async () => {
      const menu = await createMenu(Menu, SITE, { key: 'menu-nested', name: 'Menu nested' }, meta)
      const saved = await updateMenu(Menu, SITE, menu.id, {
        revision: 1,
        items: [
          {
            label: { vi: 'Trang sức', en: 'Jewellery' },
            link: { type: 'url', target: '/trang-suc' },
            children: [
              { label: { vi: 'Nhẫn', en: 'Rings' }, link: { type: 'url', target: '/trang-suc/nhan' } },
              { label: { vi: 'Dây chuyền' }, link: { type: 'url', target: '/trang-suc/day-chuyen' } },
            ],
          },
          { label: { vi: 'Liên hệ' }, link: { type: 'url', target: '/lien-he' } },
        ],
      }, meta)

      assert.equal(saved.itemCount, 4, 'the count includes children, so the list view is not misleading')
      assert.deepEqual(saved.items[0]!.children.map(child => child.link.target), ['/trang-suc/nhan', '/trang-suc/day-chuyen'])
      assert.deepEqual(saved.items[1]!.children, [], 'an item without children reads back with an empty list')

      const loaded = await getMenu(Menu, SITE, menu.id)
      assert.equal(loaded.items[0]!.children.length, 2)

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: [{
            label: { vi: 'Sâu' },
            link: { type: 'url', target: '/a' },
            children: [{ label: { vi: 'Cấp 2' }, link: { type: 'url', target: '/b' }, children: [{ label: { vi: 'Cấp 3' }, link: { type: 'url', target: '/c' } }] }],
          }],
        }, meta),
        isMenuError(422, 'MENU_DEPTH_LIMIT'),
        'one level of children is the limit',
      )

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: [{
            label: { vi: 'Quá nhiều' },
            link: { type: 'url', target: '/a' },
            children: Array.from({ length: 11 }, (_, index) => ({ label: { vi: `Con ${index + 1}` }, link: { type: 'url', target: `/c-${index + 1}` } })),
          }],
        }, meta),
        isMenuError(422, 'MENU_CHILDREN_LIMIT'),
      )

      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 2,
          items: Array.from({ length: 31 }, (_, index) => ({ label: { vi: `Dòng ${index + 1}` }, link: { type: 'url', target: `/d-${index + 1}` } })),
        }, meta),
        isMenuError(422, 'MENU_ITEMS_LIMIT'),
        'children count towards the menu limit',
      )

      assert.equal((await getMenu(Menu, SITE, menu.id)).revision, 2, 'a refused save writes nothing')
      await deleteMenu(Menu, SITE, menu.id, 2, meta)
    })

    await check('a child link is validated and found by the reverse lookup', async () => {
      const menu = await createMenu(Menu, SITE, { key: 'menu-child-ref', name: 'Menu child ref' }, meta)
      await assert.rejects(
        () => updateMenu(Menu, SITE, menu.id, {
          revision: 1,
          items: [{
            label: { vi: 'Cha' },
            link: { type: 'url', target: '/cha' },
            children: [{ label: { vi: 'Con' }, link: { type: 'content', target: 'khong-ton-tai' } }],
          }],
        }, { ...meta, refs: { content: Content, category: Category } }),
        (error: unknown) => {
          assert.ok(isMenuError(422, 'MENU_TARGET_NOT_FOUND')(error))
          const details = (error as MenuServiceError).details as { missing: Array<{ path: string, target: string }> }
          assert.deepEqual(details.missing, [{ index: 0, path: '1.1', type: 'content', target: 'khong-ton-tai' }])
          return true
        },
        'the error names the child row, not just the parent',
      )

      await updateMenu(Menu, SITE, menu.id, {
        revision: 1,
        items: [{
          label: { vi: 'Cha' },
          link: { type: 'url', target: '/cha' },
          children: [{ label: { vi: 'Con' }, link: { type: 'content', target: 'gioi-thieu' } }],
        }],
      }, meta)

      const references = await findMenuReferences(Menu, SITE, 'content', 'gioi-thieu')
      assert.ok(references.some(entry => entry.key === 'menu-child-ref'), 'a link only a child carries still blocks the delete')
      await deleteMenu(Menu, SITE, menu.id, 2, meta)
    })

    await check('the item dialog is offered only this site\'s live references', async () => {
      const options = await listMenuLinkOptions({ content: Content, category: Category }, SITE)
      assert.deepEqual(options.content.map(entry => entry.key), ['gioi-thieu'], 'a soft-deleted page is not offered')
      assert.equal(options.content[0]!.label, 'gioi-thieu', 'a record without a title falls back to its key')
      assert.deepEqual(options.category.map(entry => entry.key), ['trang-suc'], 'another site\'s category is not offered')
      assert.equal(options.category[0]!.label, 'Trang sức', 'the `vi` name is the label')
    })
  } finally {
    await closeDatabaseConnections()
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
  console.error('Menu checks failed')
}
