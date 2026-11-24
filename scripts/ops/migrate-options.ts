import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncVariantOptionIndexes } from '../../tm-cms/server/models/variantOption.js'
import { legacyText } from '../../tm-cms/server/utils/legacyImport.js'

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

function str(value: unknown, max = 500): string {
  return legacyText(value).slice(0, max)
}

const UI_TYPE_MAP: Record<string, string> = {
  color: 'color',
  image: 'image',
  button: 'button',
  select: 'text',
  text: 'text',
}

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacy = await connection.collection('options').find(tenantMatcher).toArray()
  console.log(`option migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy rows: ${legacy.length}`)

  const collection = connection.collection('crm_variant_options')
  let written = 0
  for (const row of legacy) {
    const code = str(row.code, 64).toLowerCase() || str(row.title || row.name, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64)
    if (!code) continue
    const uiType = UI_TYPE_MAP[String(row.ui_type ?? row.uiType ?? 'text').toLowerCase()] ?? 'text'
    const values = Array.isArray(row.values)
      ? row.values.map((entry: any, index: number) => ({
          label: str(entry?.label ?? entry?.title ?? '', 120) || str(entry?.value, 120),
          value: str(entry?.value ?? '', 120),
          meta: str(entry?.meta ?? entry?.color ?? '', 500),
          sort: typeof entry?.sort === 'number' ? entry.sort : index,
        })).filter((v: { value: string }) => v.value)
      : []

    const doc = {
      siteId,
      code,
      title: str(row.title ?? row.name ?? code, 200),
      uiType,
      values,
      sort: typeof row.sort === 'number' ? row.sort : 0,
      isActive: row.isDeleted !== true,
      isDeleted: row.isDeleted === true,
      deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
      revision: 1,
      updatedAt: new Date(),
    }

    if (!apply) {
      console.log(`  would write ${code} (${values.length} values)`)
      continue
    }

    await syncVariantOptionIndexes(connection)
    await collection.updateOne(
      { siteId, code },
      { $set: doc, $setOnInsert: { createdAt: row.createdAt ? new Date(row.createdAt) : new Date() } },
      { upsert: true },
    )
    written++
  }

  if (apply) {
    console.log(`  written: ${written}`)
  } else {
    console.log('  nothing was written; rerun with --apply')
  }
} finally {
  await connection.close()
}