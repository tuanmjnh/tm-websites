import assert from 'node:assert/strict'
import {
  RedirectServiceError,
  createRedirect,
  deleteRedirect,
  getRedirect,
  listRedirects,
  normalizeRedirectPath,
  resolveRedirect,
  updateRedirect,
} from '../../tm-cms/server/services/redirectService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

let checks = 0

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

function isServiceError(status: number, code: string) {
  return (error: unknown) => error instanceof RedirectServiceError && error.statusCode === status && error.code === code
}

const connection = await connectDatabase({ uri: 'mongodb://127.0.0.1:27017', database: 'tm_test_redirect_service' })
await connection.dropDatabase()
const { Redirect, Audit } = await prepareDatabase(connection)

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'

const draft = (from: string, to: string, extra: Record<string, unknown> = {}) => ({
  from,
  to,
  statusCode: 301 as const,
  isActive: true,
  note: '',
  ...extra,
})

console.log('redirect service')

try {
  await check('a path is normalized to one canonical form', () => {
    assert.equal(normalizeRedirectPath(' /bai-viet/cu/ ', 'from'), '/bai-viet/cu')
    assert.throws(() => normalizeRedirectPath('/bai-viet//cu', 'from'), isServiceError(422, 'REDIRECT_PATH_INVALID'))
    assert.throws(() => normalizeRedirectPath('bai-viet/cu', 'from'), isServiceError(422, 'REDIRECT_PATH_INVALID'))
    assert.throws(() => normalizeRedirectPath('/cu?x=1', 'from'), isServiceError(422, 'REDIRECT_PATH_INVALID'))
    assert.throws(() => normalizeRedirectPath('/cu#top', 'from'), isServiceError(422, 'REDIRECT_PATH_INVALID'))
    assert.throws(() => normalizeRedirectPath('https://example.com/cu', 'from'), isServiceError(422, 'REDIRECT_PATH_INVALID'))
    assert.throws(() => normalizeRedirectPath('   ', 'from'), isServiceError(422, 'REDIRECT_PATH_REQUIRED'))
  })

  let firstId = ''
  await check('creates a redirect with a normalized path and revision 1', async () => {
    const created = await createRedirect(Redirect, SITE, draft(' /bai-viet/cu/ ', '/bai-viet/moi'))
    firstId = created.id
    assert.equal(created.from, '/bai-viet/cu')
    assert.equal(created.to, '/bai-viet/moi')
    assert.equal(created.statusCode, 301)
    assert.equal(created.isActive, true)
    assert.equal(created.revision, 1)
  })

  await check('a second row for the same old path is refused', async () => {
    await assert.rejects(
      createRedirect(Redirect, SITE, draft('/bai-viet/cu', '/khac')),
      isServiceError(409, 'REDIRECT_EXISTS'),
    )
  })

  await check('a row cannot point at itself', async () => {
    await assert.rejects(
      createRedirect(Redirect, SITE, draft('/vong', '/vong')),
      isServiceError(422, 'REDIRECT_PATH_SAME'),
    )
  })

  await check('a map that would loop is refused, on create and on update', async () => {
    await createRedirect(Redirect, SITE, draft('/b', '/c'))
    await assert.rejects(
      createRedirect(Redirect, SITE, draft('/c', '/b')),
      isServiceError(409, 'REDIRECT_LOOP'),
    )

    await createRedirect(Redirect, SITE, draft('/m', '/n'))
    const second = await createRedirect(Redirect, SITE, draft('/n', '/o'))
    await assert.rejects(
      updateRedirect(Redirect, SITE, second.id, { ...draft('/n', '/m'), revision: second.revision }),
      isServiceError(409, 'REDIRECT_LOOP'),
    )
  })

  await check('resolve follows a chain and reports the first status code', async () => {
    await createRedirect(Redirect, SITE, draft('/a', '/b', { statusCode: 302 }))
    // /a -> /b -> /c: the visitor lands on /c but keeps the first row's 302.
    const resolved = await resolveRedirect(Redirect, SITE, '/a')
    assert.deepEqual(resolved, { to: '/c', statusCode: 302 })
    assert.equal(await resolveRedirect(Redirect, SITE, '/bai-viet/moi'), null)
    assert.equal(await resolveRedirect(Redirect, SITE, '/khong-co'), null)
  })

  await check('an inactive row is kept but never resolved', async () => {
    const created = await createRedirect(Redirect, SITE, draft('/tam', '/bai-viet/moi'))
    const disabled = await updateRedirect(Redirect, SITE, created.id, {
      ...draft('/tam', '/bai-viet/moi'),
      isActive: false,
      revision: created.revision,
    })
    assert.equal(disabled.isActive, false)
    assert.equal(disabled.revision, created.revision + 1)
    assert.equal(await resolveRedirect(Redirect, SITE, '/tam'), null)

    const enabled = await updateRedirect(Redirect, SITE, created.id, {
      ...draft('/tam', '/bai-viet/moi'),
      isActive: true,
      revision: disabled.revision,
    })
    assert.deepEqual(await resolveRedirect(Redirect, SITE, '/tam'), { to: '/bai-viet/moi', statusCode: 301 })
    assert.equal(enabled.revision, disabled.revision + 1)
  })

  await check('a stale revision is refused and leaves the row intact', async () => {
    const current = await getRedirect(Redirect, SITE, firstId)
    await assert.rejects(
      updateRedirect(Redirect, SITE, firstId, { ...draft('/bai-viet/cu', '/bai-viet/moi-hon'), revision: current.revision + 5 }),
      isServiceError(409, 'REDIRECT_REVISION_CONFLICT'),
    )
    const stored = await getRedirect(Redirect, SITE, firstId)
    assert.equal(stored.to, '/bai-viet/moi')
  })

  await check('another site owns a separate map with the same paths', async () => {
    const foreign = await createRedirect(Redirect, OTHER_SITE, draft('/bai-viet/cu', '/tin-tuc/cu'))
    assert.equal(foreign.to, '/tin-tuc/cu')
    assert.deepEqual(await resolveRedirect(Redirect, OTHER_SITE, '/bai-viet/cu'), { to: '/tin-tuc/cu', statusCode: 301 })
    assert.deepEqual(await resolveRedirect(Redirect, SITE, '/bai-viet/cu'), { to: '/bai-viet/moi', statusCode: 301 })

    const foreignList = await listRedirects(Redirect, OTHER_SITE)
    assert.equal(foreignList.total, 1)
    assert.equal(await getRedirectSafe(OTHER_SITE, firstId), null)
  })

  await check('the list filters by old path, target or note', async () => {
    const current = await getRedirect(Redirect, SITE, firstId)
    await updateRedirect(Redirect, SITE, firstId, {
      from: current.from,
      to: current.to,
      statusCode: current.statusCode,
      isActive: current.isActive,
      note: 'gộp bài cũ',
      revision: current.revision,
    })
    assert.equal((await listRedirects(Redirect, SITE, { q: 'bai-viet/cu' })).total, 1)
    assert.equal((await listRedirects(Redirect, SITE, { q: 'gộp' })).total, 1)
    assert.equal((await listRedirects(Redirect, SITE, { q: 'không khớp gì' })).total, 0)
    const all = await listRedirects(Redirect, SITE)
    assert.deepEqual(all.data.map(row => row.from), [...all.data.map(row => row.from)].sort())
  })

  await check('deleting needs the current revision and leaves the map consistent', async () => {
    const current = await getRedirect(Redirect, SITE, firstId)
    await assert.rejects(
      deleteRedirect(Redirect, SITE, firstId, current.revision + 3),
      isServiceError(409, 'REDIRECT_REVISION_CONFLICT'),
    )
    await deleteRedirect(Redirect, SITE, firstId, current.revision)
    await assert.rejects(getRedirect(Redirect, SITE, firstId), isServiceError(404, 'REDIRECT_NOT_FOUND'))
    await assert.rejects(
      deleteRedirect(Redirect, SITE, firstId, current.revision),
      isServiceError(404, 'REDIRECT_NOT_FOUND'),
    )
  })

  await check('every write records one audit entry with the redirect resource type', async () => {
    const meta = {
      audit: {
        model: Audit,
        actor: { id: 'tester', name: 'Tester', email: 'tester@example.com' },
        requestId: 'req-redirect-test',
      },
    }
    const created = await createRedirect(Redirect, SITE, draft('/audit-cu', '/audit-moi'), meta)
    const saved = await updateRedirect(Redirect, SITE, created.id, {
      ...draft('/audit-cu', '/audit-moi'),
      note: 'kiểm tra audit',
      revision: created.revision,
    }, meta)
    await deleteRedirect(Redirect, SITE, created.id, saved.revision, meta)

    const rows = await Audit.find({ siteId: SITE, resourceType: 'redirect', resourceId: created.id }).sort({ action: 1 }).lean<{ action: string, actor: { id: string } }[]>()
    assert.deepEqual(rows.map(row => row.action), ['create', 'delete', 'update'])
    assert.ok(rows.every(row => row.actor?.id === 'tester'))
  })
  await check('a gone path answers 410 and stores no target', async () => {
    const gone = await createRedirect(Redirect, SITE, draft('/da-xoa', '', { statusCode: 410 }))
    assert.equal(gone.statusCode, 410)
    assert.equal(gone.to, '')
    assert.deepEqual(await resolveRedirect(Redirect, SITE, '/da-xoa'), { to: '', statusCode: 410 })
  })

  await check('a gone path cannot carry a target', async () => {
    await assert.rejects(
      createRedirect(Redirect, SITE, draft('/da-xoa-co-dich', '/bai-viet/moi', { statusCode: 410 })),
      isServiceError(422, 'REDIRECT_TARGET_NOT_ALLOWED'),
    )
  })

  await check('a redirect to a gone path stops at the gone row', async () => {
    await createRedirect(Redirect, SITE, draft('/cu-vao-da-xoa', '/da-xoa'))
    assert.deepEqual(
      await resolveRedirect(Redirect, SITE, '/cu-vao-da-xoa'),
      { to: '/da-xoa', statusCode: 301 },
    )
  })
} finally {
  await connection.dropDatabase()
  await closeDatabaseConnections()
}

async function getRedirectSafe(siteId: string, id: string) {
  try {
    return await getRedirect(Redirect, siteId, id)
  } catch {
    return null
  }
}

console.log(`\n✅ Redirect service checks: ${checks} passed, 0 not run`)
