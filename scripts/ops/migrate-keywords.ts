import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncKeywordIndexes } from '../../tm-cms/server/models/keyword.js'
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

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacy = await connection.collection('keywords').find(tenantMatcher).toArray()
  console.log(`keyword migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy rows: ${legacy.length}`)

  const collection = connection.collection('crm_keywords')
  let written = 0
  for (const row of legacy) {
    const slug = str(row.slug, 64).toLowerCase() || str(row.title || row.name, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 64)
    if (!slug) continue
    const doc = {
      siteId,
      slug,
      title: str(row.title ?? row.name ?? slug, 200),
      color: str(row.color, 20),
      count: typeof row.count === 'number' ? row.count : 0,
      scope: str(row.scope, 40) || 'share',
      isActive: row.isDeleted !== true,
      isDeleted: row.isDeleted === true,
      deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
      revision: 1,
      updatedAt: new Date(),
    }

    if (!apply) {
      console.log(`  would write ${slug}`)
      continue
    }

    await syncKeywordIndexes(connection)
    await collection.updateOne(
      { siteId, slug },
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