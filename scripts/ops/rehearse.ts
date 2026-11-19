import { spawnSync } from 'node:child_process'

/**
 * `pnpm rehearse --site <customerId> [--tenant default] [--apply]`
 *
 * The runbook in `docs/v2/08` is five commands in a fixed order, and the order is
 * not cosmetic: `migrate:redirects` resolves every target from the row
 * `migrate:catalog --apply` wrote, and `check:migration` is only meaningful once
 * every writer has run. Typed by hand, that order is easy to get wrong and the
 * mistake does not fail — it writes fewer redirects. This command runs the five
 * steps in the documented order, stops at the first failure instead of running the
 * steps that depend on it, and ends with the parity report.
 *
 * It runs the real CLIs as separate processes, exactly as an operator would, so it
 * adds no migration logic of its own: every count, warning and `verified N/N` line
 * comes from the command that owns it. Nothing is written unless `--apply` is
 * passed, and a dry run skips `check:migration` on purpose — the parity report
 * compares v2 against the legacy source, so before an apply it would be reporting
 * the absence of writes that were never planned to happen.
 */

interface Step {
  script: string
  /** What this step owns, shown before its output. */
  why: string
  /** `migrate:*` commands take `--apply`; a read-only report does not. */
  writable: boolean
}

const APPLY_STEPS: Step[] = [
  {
    script: 'migrate:content',
    why: 'legacy `contents`/`content_categories` into `content`/`categories`',
    writable: true,
  },
  {
    script: 'migrate:catalog',
    why: 'legacy `items`/`item_categories` into the catalog, and the rows redirects point at',
    writable: true,
  },
  {
    script: 'migrate:redirects',
    why: 'legacy `fullPath` URLs into 301 rows, targeting the rows the catalog step wrote',
    writable: true,
  },
  {
    script: 'migrate:settings',
    why: 'the four allowlisted site-identity keys; independent of the rest',
    writable: true,
  },
]

const PARITY_STEP: Step = {
  script: 'check:migration',
  why: 'read-only parity of every migrated domain against the legacy source',
  writable: false,
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const siteId = flag('site') || process.env.TM_CUSTOMER_ID || ''
const tenant = flag('tenant') || 'default'
const uri = process.env.TM_MONGO_URI || 'mongodb://127.0.0.1:27017'
const database = process.env.TM_MONGO_DB || ''
const apply = process.argv.includes('--apply')

if (!siteId) throw new Error('Pass --site <customerId> or set TM_CUSTOMER_ID')
if (!database) throw new Error('Set TM_MONGO_DB to the customer database name')
// The legacy collections live in the customer-named database. The `app_*_cms` one
// is the v2 side: pointing at it plans 0 rows and reports no error, which is the
// easiest way to believe a migration finished when nothing ran (runbook step 1).
if (/^app_.*_cms$/i.test(database)) {
  throw new Error(
    `TM_MONGO_DB=${database} looks like a v2 app database; the legacy collections live in the customer-named one (e.g. sen-tuan, bag-post). Nothing was run.`,
  )
}

const steps: Step[] = apply ? [...APPLY_STEPS, PARITY_STEP] : APPLY_STEPS

console.log(`\nlegacy migration rehearsal site=${siteId} db=${database} tenant=${tenant} mode=${apply ? 'apply' : 'dry run'}`)
console.log(apply ? '  every step writes; the run ends with the parity report' : '  nothing will be written; rerun with --apply to write, then parity follows')

interface Result {
  script: string
  code: number
  seconds: number
}

const results: Result[] = []
const env = { ...process.env, TM_MONGO_URI: uri, TM_MONGO_DB: database, TM_CUSTOMER_ID: siteId }

for (const [index, step] of steps.entries()) {
  const command = `pnpm -s ${step.script} --site ${siteId} --tenant ${tenant}${apply && step.writable ? ' --apply' : ''}`
  console.log(`\n▶ ${index + 1}/${steps.length} ${step.script} — ${step.why}`)
  const startedAt = Date.now()
  const result = spawnSync(command, { cwd: process.cwd(), shell: true, stdio: 'inherit', env })
  const seconds = (Date.now() - startedAt) / 1000
  const code = result.status ?? 1
  results.push({ script: step.script, code, seconds })
  if (code !== 0) {
    // A later step reads what this one wrote, so continuing would plan against a
    // half-written database. The importers are resumable: fix the cause and rerun.
    console.log(`\n⛔ ${step.script} exited ${code}; the steps after it were not run`)
    break
  }
}

const ran = new Set(results.map(result => result.script))
const skipped = steps.filter(step => !ran.has(step.script))

console.log(`\nrehearsal summary site=${siteId} db=${database} mode=${apply ? 'apply' : 'dry run'}`)
for (const result of results) {
  console.log(`  ${result.code === 0 ? '✅' : '❌'} ${result.script.padEnd(20)} ${result.seconds.toFixed(1)}s`)
}
for (const step of skipped) {
  console.log(`  –  ${step.script.padEnd(20)} not run (an earlier step failed)`)
}
if (!apply) {
  console.log('\n  nothing was written; rerun with --apply to write and check parity')
}

const failed = results.some(result => result.code !== 0)
if (failed) {
  console.log('\n❌ rehearsal stopped: read the first failing step above, fix it and rerun (the importers resume)\n')
  process.exitCode = 1
} else if (apply) {
  console.log('\n✅ rehearsal complete: every writer ran, and parity holds\n')
} else {
  console.log('')
}
