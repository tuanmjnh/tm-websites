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
  'test:media',
  'test:audit',
  'test:settings',
  'test:menus',
  'test:bulk',
  'test:tags',
  'test:redirects',
  'test:category-order',
  'test:retention',
  'test:db',
  'test:web-content',
  'test:web-site',
  'test:web-cart',
  'test:iam',
  'test:revalidate',
  'test:web-site-db',
]

const STATIC_GATES = ['typecheck', 'lint', 'validate:registry', 'verify:scaffold']

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

const env = ['TM_MONGO_URI', 'TM_MONGO_DB', 'TM_SITE_ID']
  .map(name => `${name}=${process.env[name] || '(unset)'}`)
  .join(' ')

log(`# Gates — ${new Date().toISOString()}`)
log(`# cwd: ${process.cwd()}`)
log(`# database env: ${env}`)
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
