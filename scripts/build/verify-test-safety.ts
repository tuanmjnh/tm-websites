import fs from 'node:fs'
import path from 'node:path'

/**
 * Static half of the local-development database policy
 * (`docs/v2/15-local-development-and-test-policy.md`).
 *
 * Local development and gates run on the real `sen-tuan` database, so a test
 * suite may only clear data in a disposable `tm_test_*` fixture database, and
 * only through `scripts/build/testDatabase.ts`. This gate reads the sources and
 * refuses a suite that drops an unguarded database, names `sen-tuan` as a
 * fixture, or reconciles indexes destructively. It also prints the data-safety
 * classification the policy asks every gate to have.
 */

const BUILD_DIR = 'scripts/build'
const OPS_DIR = 'scripts/ops'
const GUARD_MODULE = './testDatabase.js'
const FIXTURE_PREFIX = 'tm_test_'
const DEVELOPMENT_DATABASE = 'sen-tuan'

interface Finding {
  file: string
  message: string
}

const findings: Finding[] = []

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

function list(dir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(predicate)
    .map(name => path.posix.join(dir, name))
    .sort()
}

/** Scripts actually reachable from `pnpm verify:all` (declared gates only). */
function gateFiles(): string[] {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  const files = new Set<string>()
  for (const [name, command] of Object.entries(pkg.scripts)) {
    if (!name.startsWith('test:') && !name.startsWith('verify:') && name !== 'typecheck' && name !== 'lint') continue
    for (const match of command.matchAll(/tsx\s+(scripts\/[^\s&]+)/g)) {
      files.add(match[1]!)
    }
  }
  return [...files].sort()
}

const buildTests = list(BUILD_DIR, name => /^test-.*\.ts$/.test(name))
const opsScripts = list(OPS_DIR, name => name.endsWith('.ts'))

for (const file of buildTests) {
  const source = read(file)
  const usesFixture = /testDatabaseBinding\(|openTestDatabase\(|dropTestMongooseDatabase\(|'tm_test_/.test(source)
  const drops = /dropDatabase\(/.test(source)
  const guarded = source.includes(GUARD_MODULE)

  // Only a fixture targeting sen-tuan is a violation; the binding suite legitimately
  // asserts that the registry name resolves, without ever connecting to it.
  if (/testDatabaseBinding\(\s*'sen-tuan'|(?:connectDatabase|openTestDatabase)\(\{[^}]*database:\s*'sen-tuan'|connectMongo\(\{[^}]*database:\s*'sen-tuan'/.test(source)) {
    findings.push({ file, message: 'names sen-tuan as a fixture database' })
  }

  if (drops && !guarded) {
    findings.push({ file, message: 'drops a database without the guarded fixture helper' })
  }

  if (usesFixture && !/dropTestDatabase\(|dropTestMongooseDatabase\(/.test(source)) {
    findings.push({ file, message: 'opens a fixture database but never drops it' })
  }

  if (/dropDatabase\(/.test(source) && /database:\s*'(?!tm_test_)[A-Za-z0-9_-]+'/.test(source) && !guarded) {
    findings.push({ file, message: 'drops a database whose name is not a tm_test_* fixture' })
  }
}

for (const file of [...buildTests, ...opsScripts]) {
  const source = read(file)
  if (/\.syncIndexes\(/.test(source)) {
    findings.push({ file, message: 'calls syncIndexes(), which is destructive against a real database' })
  }
}

for (const file of opsScripts) {
  const source = read(file)
  if (/dropDatabase\(/.test(source)) {
    findings.push({ file, message: 'drops a database from scripts/ops; destructive drills belong in a guarded fixture suite' })
  }
}

// Classification for the report: how each gate touches the database.
const classification: Array<{ file: string, kind: string }> = []
for (const file of buildTests) {
  const source = read(file)
  const fixture = /testDatabaseBinding\(|openTestDatabase\(/.test(source)
  if (!fixture) classification.push({ file, kind: 'no-database (pure/static)' })
  else if (/dropTestDatabase\(|dropTestMongooseDatabase\(/.test(source)) classification.push({ file, kind: 'fixture: tm_test_*, guarded, dropped' })
  else classification.push({ file, kind: 'fixture: tm_test_*, guarded, read-only' })
}

const gates = new Set(gateFiles())
const unclassified = gateFiles().filter(file => !buildTests.includes(file) && !opsScripts.includes(file))

console.log(`test safety — ${buildTests.length} suites, ${gateFiles().length} gate scripts reachable from verify:all\n`)

const writes = classification.filter(entry => entry.kind.startsWith('fixture:'))
const pure = classification.filter(entry => entry.kind.startsWith('no-database'))
console.log(`   ${writes.length} suites use a disposable tm_test_* fixture; ${pure.length} suites need no database`)

console.log('\n   Data-safety classification:')
for (const entry of classification) {
  console.log(`   · ${entry.file} — ${entry.kind}`)
}

if (unclassified.length) {
  console.log('\n   Gate scripts that are not test-*.ts suites (classified by their own implementation):')
  for (const file of unclassified) console.log(`   · ${file}`)
}

if (findings.length) {
  console.error('\n❌ Database safety violations:')
  for (const finding of findings) console.error(`   · ${finding.file}: ${finding.message}`)
  console.error('\nEvery destructive test must use scripts/build/testDatabase.ts with a tm_test_* database.')
  process.exit(1)
}

// A gate that stops being wired into verify:all would still pass here; scaffold
// owns coverage, this gate owns database safety. Report it so the two never drift.
const fixturesNotInGates = writes.filter(entry => !gates.has(entry.file)).map(entry => entry.file)
if (fixturesNotInGates.length) {
  console.log(`\n   ℹ️  Fixture suites not currently wired into verify:all: ${fixturesNotInGates.join(', ')}`)
}

console.log('\n✅ Every fixture database is guarded, named tm_test_*, and dropped by its suite.')
