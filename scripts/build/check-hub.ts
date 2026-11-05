const fallbackUrl = 'https://tm-hub-app.vercel.app'

const urlArg = process.argv.find((arg) => arg.startsWith('--url='))
const hubUrl = (urlArg?.slice('--url='.length) || process.env.TM_HUB_URL || fallbackUrl).replace(/\/+$/, '')

const checks: { name: string, ok: boolean, detail: string }[] = []

async function probe(path: string, verify: (body: Record<string, unknown>) => boolean) {
  const started = Date.now()
  try {
    const response = await fetch(`${hubUrl}${path}`, { signal: AbortSignal.timeout(10_000) })
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    const ok = response.ok && !!body && verify(body)
    checks.push({
      name: path,
      ok,
      detail: ok
        ? `HTTP ${response.status} in ${Date.now() - started}ms`
        : `HTTP ${response.status} unexpected payload`,
    })
  } catch (error) {
    checks.push({
      name: path,
      ok: false,
      detail: (error as Error).message,
    })
  }
}

console.log(`🔎 Checking TM Hub at ${hubUrl}\n`)

await probe('/api/health', (body) => body.success === true && typeof body.data === 'object')
await probe('/api/v1/health', (body) => {
  const data = body.data as Record<string, unknown> | undefined
  return body.success === true && data?.status === 'healthy' && data?.db === 'ok'
})

for (const check of checks) {
  console.log(`${check.ok ? '✅' : '❌'} ${check.name} — ${check.detail}`)
}

const failed = checks.filter((check) => !check.ok).length
console.log(`\n${failed === 0 ? '🎉' : '⚠️ '} ${checks.length - failed}/${checks.length} health checks passed`)

if (failed > 0) {
  process.exit(1)
}
