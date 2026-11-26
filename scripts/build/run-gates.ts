import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Runs every gate the repository has, in one command, and records each step in a log.
 *
 * All steps run even after a failure, so one invocation shows everything that is broken
 * instead of only the first problem; the process still exits non-zero if any step failed.
 */

interface Gate {
  name: string
  script: string
}

const DOMAIN_GATES = [
  'test:layers',
  'test:hub',
  'test:content',
  'test:categories',
  'test:catalog',
  'test:crm',
  'test:commerce',
  'test:inventory',
  'test:procurement',
  'test:inventory-transactions',
  'test:finance',
  'test:inventory-transfers',
  'test:notifications',
  'test:mail',
  'test:hr',
  'test:finance-reports',
  'test:mail-analytics',
  'test:supplier-prices',
  'test:newsletter',
  'test:contact-messages',
  'test:shipments',
  'test:shipment-movements',
  'test:order-returns',
  'test:order-stock',
  'test:serial-numbers',
  'test:serial-sync',
  'test:serial-import',
  'test:hr-self-service',
  'test:catalog-import',
  'test:supplier-import',
  'test:customer-import',
  // The failed-row download: a fix-and-retry file is only honest when it keeps
  // the operator's cells, drops the rows that already saved and escapes quotes.
  'test:import-csv',
  'test:hr-shifts',
  'test:stocktake',
  // The importers' --apply half: upserts, key/slug collisions and revision
  // preservation, driven through the real CLIs on a disposable fixture.
  'test:migrate-apply',
  // The dashboard's own business counts: status filters, soft deletes and site
  // isolation, so the numbers on the front page cannot be invented.
  'test:dashboard',
  'test:media',
  'test:audit',
  'test:audit-write',
  // Backs up a seeded database, restores it and compares bytes: the launch path
  // was untested, and a restore that only counts rows proves nothing.
  'test:backup-restore',
  // The pair: a backup is only a backup when both halves verify, so this gates the
  // refusal of a half bundle as much as the restore itself.
  'test:backup-bundle',
  'test:settings',
  'test:menus',
  'test:bulk',
  'test:tags',
  'test:redirects',
  'test:category-order',
  'test:retention',
  // Suites that existed on disk but were never wired into a script or a gate, so
  // nothing ran them: the public checkout, order lookup, contact form, payables,
  // jobs, customer portals, push subscriptions and staff tasks.
  'test:checkout',
  'test:order-lookup',
  'test:public-contact',
  'test:payables',
  'test:jobs',
  'test:tasks',
  'test:customer-portal',
  'test:customer-dedup',
  'test:push-subscriptions',
  'test:audit-export',
  'test:db',
  'test:web-content',
  'test:web-site',
  'test:web-cart',
  // The product page's size/colour chips: variant option mapping and the chip
  // that resolves to a sellable variant.
  'test:web-variant-options',
  'test:iam',
  'test:refresh-coordinator',
  'test:revalidate',
  'test:web-site-db',
]

const STATIC_GATES = [
  'typecheck',
  'lint',
  'validate:registry',
  'verify:scaffold',
  // Reads every test suite and refuses an unguarded or un-dropped fixture database:
  // local development runs on the real sen-tuan database (policy doc 15).
  'verify:test-safety',
  // Reads the admin routes as source: no build, no database, so it belongs in the
  // default run and fails fast when a route forgets the audit reason.
  'verify:audit-meta',
  // Compares the module registry with the pages behind it: static, no build.
  'verify:modules',
  // Client half of the audit note: every write screen keeps its note control and
  // hands the typed note to a composable. Static, no build.
  'verify:audit-reason-ui',
  // The media archive half of the backup: filesystem only, no build, no database.
  'test:media-backup',
  // Reads the admin routes as source: catches that answer over an errorResponse
  // their own try raised. Static, no build, no database.
  'verify:error-answers',
  'test:purge-scope',
  // Pure price rules shared by the storefront and the CMS list: no build or database.
  'test:price',
  // The legacy importers' field rules: pure, no build or database. A wrong rule
  // there does not fail, it writes less data, which is how every tag was lost.
  'test:legacy-import',
  // Reads the storefront's page files and its hand-written links; no build or
  // database needed, so it belongs in the default run.
  'test:web-routes',
]

const GATES: Gate[] = [...DOMAIN_GATES, ...STATIC_GATES].map(script => ({ name: script, script }))

/**
 * Gates that cannot run from a clean checkout: they need a production build or a running preview
 * server. They are declared here rather than left out, and `verify:scaffold` fails if a
 * `test:`/`verify:` script appears in neither this list nor GATES, so a new gate can never be
 * forgotten silently.
 */
export const OPT_IN_GATES: Array<{ script: string; needs: string }> = [
  { script: 'test:empty-listing', needs: 'production web build and a preview server on :4006' },
  { script: 'validate:build:cms', needs: 'a built CMS (.output)' },
  { script: 'validate:build:web', needs: 'a built storefront (.output)' },
  { script: 'test:pwa-isolation', needs: 'a built storefront (tm-web/.output) and TM_CUSTOMER_ID' },
  { script: 'test:build-matrix', needs: 'builds all 8 customer apps (about 5.5 minutes), so it stays out of the default run' },
]

const logArg = process.argv.find(arg => arg.startsWith('--log='))?.slice('--log='.length)
const logPath = path.resolve(process.cwd(), logArg || '.devlogs/gates.log')

fs.mkdirSync(path.dirname(logPath), { recursive: true })
fs.writeFileSync(logPath, '')

function log(line = '') {
  fs.appendFileSync(logPath, `${line}\n`)
}

function duration(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`
}

// The project runs dev and gates on one customer database. Refuse any other
// name instead of writing into a stray database; the suites that need a
// disposable fixture still create and drop their own short-lived database.
const DEV_DATABASE = 'sen-tuan'
const configuredDatabase = process.env.TM_MONGO_DB || DEV_DATABASE
if (configuredDatabase !== DEV_DATABASE) {
  console.error(`TM_MONGO_DB="${configuredDatabase}" is not "${DEV_DATABASE}"; this repo runs dev and gates on ${DEV_DATABASE} only.`)
  process.exit(1)
}
process.env.TM_MONGO_DB = DEV_DATABASE
process.env.TM_MONGO_URI ||= 'mongodb://127.0.0.1:27017'
process.env.TM_SITE_ID ||= 'sentuan'

/** Host only: a connection string may carry credentials and a query, neither belongs in a log. */
function describeMongoEndpoint(uri: string): string {
  try {
    const parsed = new URL(uri)
    const auth = parsed.username || parsed.password ? 'credentials:redacted@' : ''
    return `${parsed.protocol}//${auth}${parsed.host}`
  } catch {
    return '(invalid TM_MONGO_URI)'
  }
}

const env = ['TM_MONGO_URI', 'TM_MONGO_DB', 'TM_SITE_ID']
  .map(name => `${name}=${process.env[name] || '(unset)'}`)
  .join(' ')

log(`# Gates — ${new Date().toISOString()}`)
log(`# cwd: ${process.cwd()}`)
log(`# database env: ${env}`)
log(`# target: customer=${process.env.TM_CUSTOMER_ID || '(default)'} site=${process.env.TM_SITE_ID} database=${process.env.TM_MONGO_DB}`)
log(`# mongo endpoint: ${describeMongoEndpoint(process.env.TM_MONGO_URI)}`)
console.log(`database: ${process.env.TM_MONGO_DB} at ${describeMongoEndpoint(process.env.TM_MONGO_URI)} (site ${process.env.TM_SITE_ID})`)
log(`# steps: ${GATES.map(gate => gate.name).join(', ')}`)
log('')

const failures: Array<{ name: string; exitCode: number }> = []
const startedAt = Date.now()

for (const [index, gate] of GATES.entries()) {
  const label = `[${index + 1}/${GATES.length}] ${gate.name}`
  console.log(`${label} …`)

  const stepStartedAt = Date.now()
  // One command string rather than an argument list: on Windows pnpm is a .cmd shim, and Node
  // warns when it has to concatenate an argument list for a shell. Gate names are constants.
  const result = spawnSync(`pnpm -s ${gate.script}`, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const elapsed = duration(Date.now() - stepStartedAt)
  const exitCode = result.status ?? 1
  const output = `${result.stdout || ''}${result.stderr || ''}`.trimEnd()

  log(`===== ${label} — exit ${exitCode} in ${elapsed} =====`)
  log(output || '(no output)')
  log('')

  if (exitCode === 0) {
    console.log(`✅ ${gate.name} (${elapsed})`)
    continue
  }

  failures.push({ name: gate.name, exitCode })
  console.log(`❌ ${gate.name} (${elapsed}) — exit ${exitCode}`)
  const tail = output.split('\n').slice(-12)
  if (tail.length) console.log(tail.map(line => `   ${line}`).join('\n'))
}

const elapsed = duration(Date.now() - startedAt)
const summary = [
  `# Summary: ${GATES.length - failures.length}/${GATES.length} gates passed in ${elapsed}`,
  ...(failures.length
    ? ['# Failed:', ...failures.map(failure => `#   ${failure.name} (exit ${failure.exitCode})`)]
    : ['# Every gate passed.']),
]

log('')
for (const line of summary) log(line)

console.log(`\n${GATES.length - failures.length}/${GATES.length} gates passed in ${elapsed}`)
console.log(`log: ${logPath}`)
if (failures.length) {
  console.log(`failed: ${failures.map(failure => failure.name).join(', ')}`)
  process.exit(1)
}
