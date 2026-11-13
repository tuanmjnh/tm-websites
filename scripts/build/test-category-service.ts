import assert from 'node:assert/strict'
import {
  CategoryServiceError,
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  listCategoryMenuReferences,
  updateCategory,
} from '../../tm-cms/server/services/categoryService.js'
import { createContent } from '../../tm-cms/server/services/contentService.js'
import { createMenu, deleteMenu } from '../../tm-cms/server/services/menuService.js'
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

function isCategoryError(status: number, code: string) {
  return (error: unknown) => error instanceof CategoryServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

function category(key: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    locales: [{ locale: 'vi', name, slug: key }],
    ...extra,
  }
}

console.log('Categories — tree commands (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_category_service' }

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
    const { Category, Content, Audit, Revision, Menu } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR }, revision: { model: Revision, actor: ACTOR } }

    const jewelry = await createCategory(Category, SITE, category('trang-suc', 'Trang sức'), meta)
    const rings = await createCategory(Category, SITE, category('nhan', 'Nhẫn', { parent: 'trang-suc', order: 2 }), meta)
    const necklaces = await createCategory(Category, SITE, category('day-chuyen', 'Dây chuyền', { parent: 'trang-suc', order: 1 }), meta)

    await check('create normalizes the key, folds slugs and starts at revision 1', async () => {
      assert.equal(jewelry.key, 'trang-suc')
      assert.equal(jewelry.revision, 1)
      assert.equal(jewelry.parent, null)
      const accented = await createCategory(Category, SITE, { key: 'Trang sức cao cấp', locales: [{ locale: 'vi', name: 'Cao cấp' }] }, meta)
      assert.equal(accented.key, 'trang-suc-cao-cap')
      assert.equal(accented.locales[0]!.slug, 'cao-cap')
      await deleteCategory(Category, Content, SITE, accented.id, accented.revision, meta)
    })

    await check('a locale description is trimmed, defaults to empty and is capped', async () => {
      const described = await createCategory(Category, SITE, {
        key: 'mo-ta',
        locales: [{ locale: 'vi', name: 'Mô tả', slug: 'mo-ta', description: '  Trang sức bạc thủ công  ' }],
      }, meta)
      assert.equal(described.locales[0]!.description, 'Trang sức bạc thủ công')

      const bare = await createCategory(Category, SITE, category('khong-mo-ta', 'Không mô tả'), meta)
      assert.equal(bare.locales[0]!.description, '')

      await assert.rejects(
        () =>
          createCategory(Category, SITE, {
            key: 'qua-dai',
            locales: [{ locale: 'vi', name: 'Quá dài', slug: 'qua-dai', description: 'x'.repeat(501) }],
          }),
        isCategoryError(422, 'CATEGORY_PAYLOAD_INVALID'),
      )

      for (const record of [described, bare]) {
        await deleteCategory(Category, Content, SITE, record.id, record.revision, meta)
      }
    })

    await check('the tree is ordered by order and reports depth', async () => {
      const { tree, data } = await listCategories(Category, SITE)
      assert.equal(data.length, 3)
      assert.equal(tree.length, 1)
      assert.equal(tree[0]!.key, 'trang-suc')
      assert.equal(tree[0]!.depth, 0)
      assert.deepEqual(tree[0]!.children.map(node => node.key), ['day-chuyen', 'nhan'])
      assert.equal(tree[0]!.children[0]!.depth, 1)
      assert.equal(tree[0]!.children[0]!.parent, 'trang-suc')
    })

    await check('duplicate keys and locale slugs are conflicts', async () => {
      await assert.rejects(() => createCategory(Category, SITE, category('trang-suc', 'Khác')), isCategoryError(409, 'CATEGORY_KEY_EXISTS'))
      await assert.rejects(
        () => createCategory(Category, SITE, { key: 'khac', locales: [{ locale: 'vi', name: 'Khác', slug: 'trang-suc' }] }),
        isCategoryError(409, 'CATEGORY_SLUG_EXISTS'),
      )
    })

    await check('a missing parent is rejected', async () => {
      await assert.rejects(
        () => createCategory(Category, SITE, category('bong-tai', 'Bông tai', { parent: 'khong-ton-tai' })),
        isCategoryError(422, 'CATEGORY_PARENT_NOT_FOUND'),
      )
    })

    await check('a category cannot be its own parent or move under a descendant', async () => {
      await assert.rejects(
        () => updateCategory(Category, SITE, jewelry.id, { ...category('trang-suc', 'Trang sức'), revision: jewelry.revision, parent: 'trang-suc' }, meta),
        isCategoryError(422, 'CATEGORY_CYCLE'),
      )
      await assert.rejects(
        () => updateCategory(Category, SITE, jewelry.id, { ...category('trang-suc', 'Trang sức'), revision: jewelry.revision, parent: 'nhan' }, meta),
        isCategoryError(422, 'CATEGORY_CYCLE'),
      )
    })

    await check('the tree depth is capped', async () => {
      let parent: string | null = null
      let last: Awaited<ReturnType<typeof createCategory>> | null = null
      for (let level = 1; level <= 5; level++) {
        last = await createCategory(Category, SITE, category(`cap-${level}`, `Cấp ${level}`, { parent }), meta)
        parent = last.key
      }
      await assert.rejects(
        () => createCategory(Category, SITE, category('cap-6', 'Cấp 6', { parent: 'cap-5' })),
        isCategoryError(422, 'CATEGORY_DEPTH_EXCEEDED'),
      )
      for (let level = 5; level >= 1; level--) {
        const node = await listCategories(Category, SITE)
        const record = node.data.find(entry => entry.key === `cap-${level}`)!
        await deleteCategory(Category, Content, SITE, record.id, record.revision, meta)
      }
    })

    await check('update renames, reorders and moves with an optimistic lock', async () => {
      const updated = await updateCategory(
        Category,
        SITE,
        necklaces.id,
        {
          ...category('day-chuyen', 'Dây chuyền bạc'),
          revision: necklaces.revision,
          parent: 'trang-suc',
          order: 0,
        },
        meta,
      )
      assert.equal(updated.revision, 2)
      assert.equal(updated.locales[0]!.name, 'Dây chuyền bạc')
      assert.equal(updated.order, 0)

      const { tree } = await listCategories(Category, SITE)
      assert.equal(tree[0]!.children[0]!.key, 'day-chuyen')

      await assert.rejects(
        () => updateCategory(Category, SITE, necklaces.id, { ...category('day-chuyen', 'Khác'), revision: 1 }, meta),
        isCategoryError(409, 'CATEGORY_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => updateCategory(Category, SITE, necklaces.id, { ...category('day-chuyen-moi', 'Khác'), revision: 2 }, meta),
        isCategoryError(422, 'CATEGORY_KEY_IMMUTABLE'),
      )
    })

    await check('delete refuses a category with children', async () => {
      await assert.rejects(
        () => deleteCategory(Category, Content, SITE, jewelry.id, jewelry.revision, meta),
        isCategoryError(409, 'CATEGORY_HAS_CHILDREN'),
      )
    })

    await check('delete refuses a category used by content, then allows it once free', async () => {
      await createContent(Content, SITE, {
        type: 'fragment',
        key: 'fragments/ring-note',
        locales: [{ locale: 'vi', slug: 'ring-note', title: 'Ghi chú nhẫn' }],
        categories: ['nhan'],
      })

      const ring = (await listCategories(Category, SITE)).data.find(entry => entry.key === 'nhan')!
      await assert.rejects(
        () => deleteCategory(Category, Content, SITE, ring.id, ring.revision, meta),
        isCategoryError(409, 'CATEGORY_IN_USE'),
      )

      const content = await Content.findOne({ siteId: SITE, key: 'fragments/ring-note' }).lean<{ _id: unknown }>()
      await Content.deleteOne({ _id: content!._id })

      const removed = await deleteCategory(Category, Content, SITE, ring.id, ring.revision, meta)
      assert.equal(removed.key, 'nhan')
      assert.equal((await listCategories(Category, SITE)).data.some(entry => entry.key === 'nhan'), false)
    })

    await check('a category a menu links to cannot be deleted until the menu is fixed', async () => {
      const target = await createCategory(Category, SITE, category('menu-guard', 'Menu guard'), meta)
      const menu = await createMenu(Menu, SITE, {
        key: 'guard-footer',
        name: 'Guard footer',
        items: [{ label: { vi: 'Menu guard', en: '' }, link: { type: 'category', target: 'menu-guard' } }],
      })

      await assert.rejects(
        () => deleteCategory(Category, Content, SITE, target.id, target.revision, { ...meta, menus: Menu }),
        (error: unknown) => {
          assert.ok(isCategoryError(409, 'CATEGORY_IN_MENU')(error))
          const details = (error as CategoryServiceError).details as { menus: Array<{ key: string }> }
          assert.deepEqual(details.menus.map(entry => entry.key), ['guard-footer'])
          return true
        },
      )
      assert.equal((await getCategory(Category, SITE, target.id)).revision, 1, 'the refused delete changes nothing')

      const references = await listCategoryMenuReferences(Category, Menu, SITE, target.id)
      assert.deepEqual(references.map(entry => entry.key), ['guard-footer'])
      await assert.rejects(
        () => listCategoryMenuReferences(Category, Menu, OTHER_SITE, target.id),
        isCategoryError(404, 'CATEGORY_NOT_FOUND'),
      )

      await deleteMenu(Menu, SITE, menu.id, 1)
      assert.deepEqual(await listCategoryMenuReferences(Category, Menu, SITE, target.id), [])
      const removed = await deleteCategory(Category, Content, SITE, target.id, target.revision, { ...meta, menus: Menu })
      assert.equal(removed.key, 'menu-guard')
    })

    await check('the category tree is site-scoped', async () => {
      const foreign = await listCategories(Category, OTHER_SITE)
      assert.equal(foreign.data.length, 0)
      await assert.rejects(() => getCategory(Category, OTHER_SITE, jewelry.id), isCategoryError(404, 'CATEGORY_NOT_FOUND'))
    })

    await check('every category mutation records an audit entry', async () => {
      const entries = await Audit.find({ siteId: SITE, resourceType: 'category' }).sort({ createdAt: 1 }).lean<{ action: string, resourceKey: string, actor: { email: string } }[]>()
      assert.ok(entries.length >= 6)
      assert.ok(entries.every(entry => entry.actor.email === ACTOR.email))
      assert.ok(entries.some(entry => entry.action === 'create' && entry.resourceKey === 'trang-suc'))
      assert.ok(entries.some(entry => entry.action === 'update' && entry.resourceKey === 'day-chuyen'))
      assert.ok(entries.some(entry => entry.action === 'delete' && entry.resourceKey === 'nhan'))
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Category service checks: ${checks} passed, ${notRun} not run\n`)
