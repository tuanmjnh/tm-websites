import { Schema } from 'mongoose'
import type { Connection, Model } from 'mongoose'
import { syncAuditIndexes } from './audit'
import { syncContentIndexes } from './content'
import { syncIdempotencyIndexes } from './idempotency'
import { syncCategoryIndexes } from './category'
import { syncContentRevisionIndexes } from './revision'
import { syncMediaIndexes } from './media'
import { syncSettingsIndexes } from './settings'
import { syncMenuIndexes } from './menu'

/**
 * Migration-version records. Every schema change that ships must carry a stable
 * id, a version and a checksum: a changed body under an applied id is a bug we
 * refuse to run, rather than a silent partial upgrade on a customer database.
 */

export const MIGRATIONS_COLLECTION = 'tm_migrations'

export interface Migration {
  id: string
  version: number
  /** Author-maintained fingerprint of the migration body. */
  checksum: string
  apply: (connection: Connection) => Promise<void>
}

export interface AppliedMigration {
  id: string
  version: number
  checksum: string
  appliedAt: Date
}

export interface MigrationPlan {
  pending: Migration[]
  conflicts: string[]
}

export class MigrationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MigrationError'
    this.code = code
  }
}

/**
 * Decides what to run without touching the database: same id + same checksum is
 * already applied, same id + different checksum is a conflict, and a pending
 * migration numbered below an applied one means the history was rewritten.
 */
export function planMigrations(applied: readonly AppliedMigration[], migrations: readonly Migration[]): MigrationPlan {
  const appliedById = new Map(applied.map(entry => [entry.id, entry]))
  const highestApplied = applied.reduce((highest, entry) => Math.max(highest, entry.version), 0)

  const conflicts: string[] = []
  const pending: Migration[] = []

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    const known = appliedById.get(migration.id)

    if (known) {
      if (known.checksum !== migration.checksum) {
        conflicts.push(`${migration.id}: applied with checksum ${known.checksum}, declared ${migration.checksum}`)
      }
      continue
    }

    if (migration.version < highestApplied) {
      conflicts.push(`${migration.id}: version ${migration.version} is below an applied version ${highestApplied}`)
      continue
    }

    pending.push(migration)
  }

  return { pending, conflicts }
}

interface MigrationDocument {
  _id: string
  version: number
  checksum: string
  appliedAt: Date
}

export function migrationModel(connection: Connection): Model<MigrationDocument> {
  const registered = connection.models.TmMigration as Model<MigrationDocument> | undefined
  if (registered) return registered

  const schema = new Schema<MigrationDocument>(
    {
      _id: { type: String, required: true },
      version: { type: Number, required: true },
      checksum: { type: String, required: true },
      appliedAt: { type: Date, required: true },
    },
    { collection: MIGRATIONS_COLLECTION, versionKey: false },
  )

  return connection.model<MigrationDocument>('TmMigration', schema, MIGRATIONS_COLLECTION)
}

export async function readAppliedMigrations(connection: Connection): Promise<AppliedMigration[]> {
  const records = await migrationModel(connection).find().lean<MigrationDocument[]>()
  return records.map(record => ({
    id: record._id,
    version: record.version,
    checksum: record.checksum,
    appliedAt: record.appliedAt,
  }))
}

/**
 * Applies pending migrations in version order and records each one only after
 * its body succeeded. An interrupted run re-applies the same migration, so a
 * migration body must itself be idempotent (create-if-missing, never a blind
 * rename or drop).
 */
export async function applyMigrations(
  connection: Connection,
  migrations: readonly Migration[],
  now: Date = new Date(),
): Promise<{ applied: string[]; skipped: string[] }> {
  const plan = planMigrations(await readAppliedMigrations(connection), migrations)
  if (plan.conflicts.length > 0) {
    throw new MigrationError('MIGRATION_CONFLICT', plan.conflicts.join('; '))
  }

  const model = migrationModel(connection)
  const applied: string[] = []
  const skipped = migrations.filter(migration => !plan.pending.includes(migration)).map(migration => migration.id)

  for (const migration of plan.pending) {
    await migration.apply(connection)
    await model.updateOne(
      { _id: migration.id },
      { $set: { version: migration.version, checksum: migration.checksum, appliedAt: now } },
      { upsert: true },
    )
    applied.push(migration.id)
  }

  return { applied, skipped }
}

/**
 * The first real migration: create the content indexes. Declared with an
 * explicit checksum so a later edit to the index set has to be a new version.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 'content-indexes',
    version: 1,
    checksum: 'content-indexes@1',
    apply: async (connection) => {
      await syncContentIndexes(connection)
    },
  },
  {
    // P2.c: business audit trail and retry-safety keys. Both are additive
    // collections; the idempotency TTL index is what keeps them from growing.
    id: 'content-audit-idempotency-indexes',
    version: 2,
    checksum: 'content-audit-idempotency-indexes@1',
    apply: async (connection) => {
      await syncAuditIndexes(connection)
      await syncIdempotencyIndexes(connection)
    },
  },
  {
    // P3.c: immutable per-revision snapshots. The unique (site, content,
    // revision) index is what keeps a retried command from forking the history.
    id: 'content-revision-indexes',
    version: 3,
    checksum: 'content-revision-indexes@1',
    apply: async (connection) => {
      await syncContentRevisionIndexes(connection)
    },
  },
  {
    // P3.e: the content category tree. Unique keys and locale slugs per site,
    // plus the parent/order index the tree query uses.
    id: 'category-indexes',
    version: 4,
    checksum: 'category-indexes@1',
    apply: async (connection) => {
      await syncCategoryIndexes(connection)
    },
  },
  {
    // Media metadata is the first collection that describes a binary owned by a
    // storage adapter; the unique key keeps one document per stored object.
    id: 'media-indexes',
    version: 5,
    checksum: 'media-indexes@1',
    apply: async (connection) => {
      await syncMediaIndexes(connection)
    },
  },
  {
    // P2.d: one settings document per site. The unique index is what turns a
    // concurrent first save into one document instead of two.
    id: 'settings-indexes',
    version: 6,
    checksum: 'settings-indexes@1',
    apply: async (connection) => {
      await syncSettingsIndexes(connection)
    },
  },
  {
    // P2.d: site menus in their own collection. The unique (site, key) index is
    // what makes a duplicate `main` menu a conflict, and `menus` is left to the
    // legacy documents until the import slice.
    id: 'menu-indexes',
    version: 7,
    checksum: 'menu-indexes@2',
    apply: async (connection) => {
      await syncMenuIndexes(connection)
    },
  },
]
