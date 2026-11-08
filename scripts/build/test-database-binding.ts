import assert from 'node:assert/strict'
import {
  DatabaseBindingError,
  bindingKey,
  closeDatabaseConnections,
  connectDatabase,
  resolveDatabaseBinding,
} from '../../tm-cms/server/utils/database.js'

let checks = 0
let notRun = 0

function check(name: string, fn: () => void) {
  try {
    fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

function isBindingError(code: string) {
  return (error: unknown) => error instanceof DatabaseBindingError && error.code === code
}

console.log('DB — customer database binding\n')

console.log('   Binding resolution (pure)')

check('an unconfigured deployment fails closed', () => {
  assert.throws(() => resolveDatabaseBinding({}), isBindingError('DATABASE_NOT_CONFIGURED'))
  assert.throws(() => resolveDatabaseBinding({ uri: 'mongodb://localhost:27017' }), isBindingError('DATABASE_NOT_CONFIGURED'))
  assert.throws(() => resolveDatabaseBinding({ declaredDatabase: 'sen-tuan' }), isBindingError('DATABASE_NOT_CONFIGURED'))
})

check('a non-MongoDB URI is rejected', () => {
  assert.throws(
    () => resolveDatabaseBinding({ uri: 'https://example.com', declaredDatabase: 'sen-tuan' }),
    isBindingError('DATABASE_URI_INVALID'),
  )
})

check('an override pointing at another database is rejected', () => {
  assert.throws(
    () => resolveDatabaseBinding({ uri: 'mongodb://localhost:27017', declaredDatabase: 'sen-tuan', database: 'bag-post' }),
    isBindingError('DATABASE_BINDING_MISMATCH'),
  )
})

check('an override that repeats the registry database is accepted', () => {
  const binding = resolveDatabaseBinding({
    uri: 'mongodb://localhost:27017',
    declaredDatabase: 'sen-tuan',
    database: 'sen-tuan',
  })
  assert.deepEqual(binding, { uri: 'mongodb://localhost:27017', database: 'sen-tuan' })
})

check('an invalid database identifier is rejected', () => {
  assert.throws(
    () => resolveDatabaseBinding({ uri: 'mongodb://localhost:27017', declaredDatabase: '../etc' }),
    isBindingError('DATABASE_NAME_INVALID'),
  )
})

check('binding keys separate tenants on the same server', () => {
  const a = resolveDatabaseBinding({ uri: 'mongodb://localhost:27017', declaredDatabase: 'tm_test_iso_a' })
  const b = resolveDatabaseBinding({ uri: 'mongodb://localhost:27017', declaredDatabase: 'tm_test_iso_b' })
  assert.notEqual(bindingKey(a), bindingKey(b))
  assert.equal(bindingKey(a), bindingKey({ ...a }))
})

console.log('\n   Two-database isolation (live MongoDB)')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const bindingA = { uri: URI, database: 'tm_test_iso_a' }
const bindingB = { uri: URI, database: 'tm_test_iso_b' }

async function integration() {
  let connectionA
  try {
    connectionA = await connectDatabase(bindingA)
  } catch {
    notRun++
    console.log('   ⚠️  NOT RUN — no MongoDB reachable at ' + URI)
    console.log('      Start a local MongoDB and re-run `pnpm test:db` to cover isolation.')
    return
  }

  try {
    const connectionB = await connectDatabase(bindingB)

    const collectionA = connectionA.db!.collection('binding_probe')
    const collectionB = connectionB.db!.collection('binding_probe')

    await collectionA.deleteMany({})
    await collectionB.deleteMany({})
    await collectionA.insertOne({ marker: 'tenant-a' })

    const seenInA = await collectionA.countDocuments({})
    const seenInB = await collectionB.countDocuments({})

    assert.equal(seenInA, 1, 'tenant A must see its own document')
    assert.equal(seenInB, 0, 'tenant B must not see tenant A documents')
    checks++
    console.log('   ✅ two bindings on one server stay isolated')

    const again = await connectDatabase(bindingA)
    assert.equal(again, connectionA, 'the same binding must reuse its pooled connection')
    checks++
    console.log('   ✅ the same binding reuses its connection')
  } finally {
    await connectionA.db?.dropDatabase().catch(() => undefined)
    const connectionB = await connectDatabase(bindingB).catch(() => null)
    await connectionB?.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} Database checks: ${checks} passed, ${notRun} not run\n`)
