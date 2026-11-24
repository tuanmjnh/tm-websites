import { connectDatabase } from '../../tm-cms/server/utils/database.js'
import { syncDocumentTemplateIndexes } from '../../tm-cms/server/models/documentTemplate.js'
import { legacyText, legacyLocalized } from '../../tm-cms/server/utils/legacyImport.js'

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

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function str(value: unknown, max = 500): string {
  return legacyText(value).slice(0, max)
}

const connection = await connectDatabase({ uri, database })
try {
  const tenantMatcher = { $or: [{ tenantId: tenant }, { tenantId: { $exists: false } }] }
  const legacy = await connection.collection('document_templates').find(tenantMatcher).toArray()
  console.log(`document-template migration site=${siteId} db=${database} tenant=${tenant} apply=${apply}`)
  console.log(`  legacy rows: ${legacy.length}`)

  const collection = connection.collection('crm_document_templates')
  let written = 0
  for (const row of legacy) {
    const code = (str(row.code, 64) || str(row.name, 64).toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 64)
    if (!code) continue
    const doc = {
      siteId,
      name: str(row.name, 200) || code,
      code,
      type: 'quotation',
      isDefault: bool(row.isDefault, false),
      primaryColor: str(row.primaryColor, 20) || '#0284c7',
      showLogo: bool(row.showLogo, true),
      title: str(row.title, 200),
      subtitle: str(row.subtitle, 300),
      companyName: str(row.companyName, 200),
      companyAddress: str(row.companyAddress, 500),
      companyPhone: str(row.companyPhone, 60),
      companyEmail: str(row.companyEmail, 200),
      companyTaxCode: str(row.companyTaxCode, 60),
      companyWebsite: str(row.companyWebsite, 300),
      showSku: bool(row.showSku, true),
      showThumbnail: bool(row.showThumbnail, false),
      showUom: bool(row.showUom, true),
      showUnitPrice: bool(row.showUnitPrice, true),
      showDiscount: bool(row.showDiscount, true),
      showTotalInWords: bool(row.showTotalInWords, true),
      showBankAccounts: bool(row.showBankAccounts, true),
      terms: str(row.terms, 5000),
      notes: str(row.notes, 5000),
      showSignatures: bool(row.showSignatures, true),
      senderTitle: str(row.senderTitle, 120),
      receiverTitle: str(row.receiverTitle, 120),
      accountantTitle: str(row.accountantTitle, 120),
      revision: 1,
      schemaVersion: 1,
      updatedAt: new Date(),
    }

    if (!apply) {
      console.log(`  would write ${code} (default=${doc.isDefault})`)
      continue
    }

    await syncDocumentTemplateIndexes(connection)
    await collection.updateOne(
      { siteId, code },
      { $set: doc, $setOnInsert: { createdAt: new Date(), isDeleted: false, deletedAt: null } },
      { upsert: true },
    )
    written++
  }

  if (apply) {
    // ensure only one default per type
    const defaults = await collection.find({ siteId, type: 'quotation', isDefault: true }).toArray()
    if (defaults.length > 1) {
      for (let i = 1; i < defaults.length; i++) {
        await collection.updateOne({ _id: defaults[i]._id }, { $set: { isDefault: false } })
      }
    }
    console.log(`  written: ${written}`)
  } else {
    console.log('  nothing was written; rerun with --apply')
  }
} finally {
  await connection.close()
}