import type { H3Event } from 'h3'
import type { Connection, Model } from 'mongoose'
import type { AuditEntryDocument } from '../models/audit'
import type { ContentDocument } from '../models/content'
import type { IdempotencyRecordDocument } from '../models/idempotency'
import type { CategoryDocument } from '../models/category'
import type { MediaDocument } from '../models/media'
import type { SiteSettingsDocument } from '../models/settings'
import type { MenuDocument } from '../models/menu'
import type { ContentRevisionDocument } from '../models/revision'
import type { CatalogCategoryDocument, CatalogItemDocument } from '../models/catalog'
import type { RedirectDocument } from '../models/redirect'
import { auditModel, syncAuditIndexes } from '../models/audit'
import { contentModel, syncContentIndexes } from '../models/content'
import { idempotencyModel, syncIdempotencyIndexes } from '../models/idempotency'
import { categoryModel, syncCategoryIndexes } from '../models/category'
import { mediaModel, syncMediaIndexes } from '../models/media'
import { siteSettingsModel, syncSettingsIndexes } from '../models/settings'
import { menuModel, syncMenuIndexes } from '../models/menu'
import { contentRevisionModel, syncContentRevisionIndexes } from '../models/revision'
import { catalogCategoryModel, catalogItemModel, syncCatalogIndexes } from '../models/catalog'
import { redirectModel, syncRedirectIndexes } from '../models/redirect'
import { MIGRATIONS, applyMigrations } from '../models/migrations'
import { withCustomerDb } from './database'

/**
 * Models are registered per connection, and each connection is prepared once
 * per process. A second customer served from the same process gets its own
 * registration, so nothing here depends on a global mongoose model table.
 */

export interface PreparedModels {
  Content: Model<ContentDocument>
  Audit: Model<AuditEntryDocument>
  IdempotencyKey: Model<IdempotencyRecordDocument>
  Revision: Model<ContentRevisionDocument>
  Category: Model<CategoryDocument>
  Media: Model<MediaDocument>
  Settings: Model<SiteSettingsDocument>
  Menu: Model<MenuDocument>
  CatalogItem: Model<CatalogItemDocument>
  CatalogCategory: Model<CatalogCategoryDocument>
  Redirect: Model<RedirectDocument>
}

const preparation = new WeakMap<Connection, Promise<PreparedModels>>()

async function prepare(connection: Connection, now: Date): Promise<PreparedModels> {
  const migrations = await applyMigrations(connection, MIGRATIONS, now)
  // Index creation is a migration, but an operator may have dropped an index
  // outside the app; `createIndexes()` only adds what is missing.
  await syncContentIndexes(connection)
  await syncAuditIndexes(connection)
  await syncIdempotencyIndexes(connection)
  await syncContentRevisionIndexes(connection)
  await syncCategoryIndexes(connection)
  await syncMediaIndexes(connection)
  await syncSettingsIndexes(connection)
  await syncMenuIndexes(connection)
  await syncCatalogIndexes(connection)
  await syncRedirectIndexes(connection)

  if (migrations.applied.length > 0) {
    console.info(`[tm-db] applied migrations: ${migrations.applied.join(', ')}`)
  }

  return {
    Content: contentModel(connection),
    Audit: auditModel(connection),
    IdempotencyKey: idempotencyModel(connection),
    Revision: contentRevisionModel(connection),
    Category: categoryModel(connection),
    Media: mediaModel(connection),
    Settings: siteSettingsModel(connection),
    Menu: menuModel(connection),
    CatalogItem: catalogItemModel(connection),
    CatalogCategory: catalogCategoryModel(connection),
    Redirect: redirectModel(connection),
  }
}

/**
 * Idempotent preparation of one customer connection: pending migrations, then
 * model registration. A failed preparation is not cached, so the next request
 * retries instead of serving with half-registered models.
 */
export async function prepareDatabase(connection: Connection, now: Date = new Date()): Promise<PreparedModels> {
  const cached = preparation.get(connection)
  if (cached) return cached

  const pending = prepare(connection, now)
  preparation.set(connection, pending)

  try {
    return await pending
  } catch (error) {
    preparation.delete(connection)
    throw error
  }
}

/**
 * Single entry point for a business endpoint: verified context → tenant-bound
 * connection → prepared models. Endpoints do not open connections themselves.
 */
export async function withPreparedDb<T>(
  event: H3Event,
  handler: (context: PreparedModels & { connection: Connection }) => Promise<T>,
): Promise<T> {
  return withCustomerDb(event, async (connection) => {
    const models = await prepareDatabase(connection)
    return handler({ connection, ...models })
  })
}
