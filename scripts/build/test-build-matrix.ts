import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { customers } from '../../tm-shared/customer-layers/registry/customers.js'

/**
 * Customer build matrix.
 *
 * Builds every enabled customer application in the registry — web and CMS — and checks each
 * finished build with the validators it has: `validate-build.ts` before the build, then
 * `test-pwa-isolation.ts` for a storefront output. Each customer gets its own output directory and
 * its own log, so one broken layer cannot hide behind the customer that happens to build last.
 *
 * `--customer=<id>` restricts the run to one customer (for debugging a failure); without it the
 * whole registry is built. Exit code is 1 if any target failed; every other target still runs.
 */

interface Target {
  customerId: string
  app: 'web' | 'cms'
  layerPath: string
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const matrixRoot = path.join(repoRoot, '.devlogs/build-matrix')
const onlyCustomer = process.argv.find(arg => arg.startsWith('--customer='))?.slice('--customer='.length)?.trim().toLowerCase()

const customersToBuild = Object.entries(customers)
  .filter(([, entry]) => entry.status !== 'disabled')
  .filter(([customerId]) => !onlyCustomer || customerId === onlyCustomer)

const targets: Target[] = []
for (const [customerId, entry] of customersToBuild) {
  for (const app of ['web', 'cms'] as const) {
    const appEntry = entry.apps[app]
    if (appEntry?.enabled) targets.push({ customerId, app, layerPath: appEntry.layerPath })
  }
}

if (targets.length === 0) {
  console.error(`No enabled targets${onlyCustomer ? ` for customer "${onlyCustomer}"` : ''}.`)
  process.exit(1)
}

const appDir = (app: Target['app']) => path.join(repoRoot, app === 'web' ? 'tm-web' : 'tm-cms')

/** Runs one command, streaming a prefixed line per output line, and appends everything to a log. */
function run(label: string, command: string, env: NodeJS.ProcessEnv, logFile: string): number {
  fs.appendFileSync(logFile, `\n===== ${label}: ${command} =====\n`)
  const result = spawnSync(command, {
    cwd: repoRoot,
    env,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trimEnd()
  fs.appendFileSync(logFile, `${output}\n[exit ${result.status ?? 1}]\n`)
  const tail = output.split('\n').filter(Boolean).slice(-2)
  for (const line of tail) console.log(`      ${line.slice(0, 140)}`)
  return result.status ?? 1
}

function moveOutput(from: string, to: string) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    // A Windows handle can keep the directory rename locked; copy instead.
    fs.cpSync(from, to, { recursive: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

console.log(`\n🏗️  Customer build matrix | ${targets.length} targets | ${customersToBuild.length} customers\n`)

const results: Array<{ customerId: string, app: string, stage: string, ok: boolean, ms: number }> = []
const startedAt = Date.now()

for (const target of targets) {
  const label = `${target.customerId}/${target.app}`
  const dir = path.join(matrixRoot, target.customerId, target.app)
  fs.mkdirSync(dir, { recursive: true })
  const logFile = path.join(dir, 'build.log')
  fs.writeFileSync(logFile, `# ${label} — ${new Date().toISOString()}\n# layer: ${target.layerPath}\n`)

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    TM_CUSTOMER_ID: target.customerId,
  }

  const startedForTarget = Date.now()
  console.log(`▶ ${label}`)

  const validateCode = run(`${label} validate`, `pnpm exec tsx scripts/build/validate-build.ts ${target.app}`, env, logFile)
  results.push({ customerId: target.customerId, app: target.app, stage: 'validate:build', ok: validateCode === 0, ms: Date.now() - startedForTarget })
  if (validateCode !== 0) {
    console.log(`❌ ${label} — validate:build failed (see ${path.relative(repoRoot, logFile)})`)
    continue
  }

  const buildStarted = Date.now()
  const buildCode = run(`${label} build`, `pnpm --dir ${target.app === 'web' ? 'tm-web' : 'tm-cms'} run build`, env, logFile)
  results.push({ customerId: target.customerId, app: target.app, stage: 'build', ok: buildCode === 0, ms: Date.now() - buildStarted })
  if (buildCode !== 0) {
    console.log(`❌ ${label} — build failed (see ${path.relative(repoRoot, logFile)})`)
    continue
  }

  const outputFrom = path.join(appDir(target.app), '.output')
  const outputTo = path.join(dir, '.output')
  moveOutput(outputFrom, outputTo)

  if (target.app === 'web') {
    const isolationStarted = Date.now()
    const isolationCode = run(
      `${label} isolation`,
      'pnpm exec tsx scripts/build/test-pwa-isolation.ts',
      { ...env, TM_OUTPUT_DIR: outputTo },
      logFile,
    )
    results.push({ customerId: target.customerId, app: target.app, stage: 'pwa-isolation', ok: isolationCode === 0, ms: Date.now() - isolationStarted })
  } else {
    // The CMS has no worker to inspect; its PWA deliverable is the manifest and icon assets.
    const manifest = path.join(outputTo, 'public/manifest.webmanifest')
    const ok = fs.existsSync(manifest) && fs.statSync(manifest).size > 0
    fs.appendFileSync(logFile, `\n===== ${label} manifest check =====\n${ok ? 'manifest present' : 'manifest MISSING'}\n`)
    results.push({ customerId: target.customerId, app: target.app, stage: 'manifest', ok, ms: 0 })
    if (!ok) console.log(`❌ ${label} — public/manifest.webmanifest missing from the build`)
  }

  console.log(`✅ ${label} in ${((Date.now() - startedForTarget) / 1000).toFixed(1)}s`)
}

// Leave the working tree with the storefront build the rest of the tooling expects.
const sentuanWeb = path.join(matrixRoot, 'sentuan/web/.output')
const webOutput = path.join(repoRoot, 'tm-web/.output')
if (fs.existsSync(sentuanWeb) && !fs.existsSync(webOutput)) {
  fs.cpSync(sentuanWeb, webOutput, { recursive: true })
  console.log(`\n↩︎ restored tm-web/.output from ${path.relative(repoRoot, sentuanWeb)}`)
}

const failures = results.filter(result => !result.ok)
const byStage = new Map<string, { ok: number, failed: number, ms: number }>()
for (const result of results) {
  const entry = byStage.get(result.stage) ?? { ok: 0, failed: 0, ms: 0 }
  if (result.ok) entry.ok++
  else entry.failed++
  entry.ms += result.ms
  byStage.set(result.stage, entry)
}

console.log(`\n📊 ${targets.length} targets in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`)
for (const [stage, entry] of byStage) {
  console.log(`   ${stage}: ${entry.ok} ok, ${entry.failed} failed, ${(entry.ms / 1000).toFixed(0)}s`)
}
if (failures.length > 0) {
  console.log(`\n❌ failed: ${failures.map(f => `${f.customerId}/${f.app} (${f.stage})`).join(', ')}`)
  console.log(`logs: ${path.relative(repoRoot, matrixRoot)}/<customer>/<app>/build.log`)
  process.exit(1)
}
console.log(`\n🎉 every target built and validated. Outputs: ${path.relative(repoRoot, matrixRoot)}/<customer>/<app>/.output`)
