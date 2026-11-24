import type { Connection } from 'mongoose'
import { connectDatabase, type DatabaseBinding } from '../../tm-cms/server/utils/database.js'

/**
 * Guarded access to the disposable MongoDB databases the test suites use.
 *
 * Local development runs on the real `sen-tuan` database, so a test that needs to
 * clear or reseed data must never point at it. Every fixture database is named
 * `tm_test_*`; this module is the only accepted way to build a fixture binding,
 * and it refuses the development database before a connection is opened, so a
 * copy-pasted literal cannot empty customer data.
 */

export const TEST_DB_PREFIX = 'tm_test_'

/** The existing local development database. Never a destructive test target. */
const DEVELOPMENT_DATABASE = 'sen-tuan'

function defaultUri(): string {
  return process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
}

/**
 * Accepts only a clearly named disposable fixture database. Called before every
 * connection and again before every drop, so neither a stale literal nor a
 * runtime override can reach the customer database.
 */
export function assertDisposableTestDatabase(database: string): void {
  if (database === DEVELOPMENT_DATABASE) {
    throw new Error(
      `Refusing to open or drop "${database}" as a test fixture: it is the local development database. `
      + `Use a "${TEST_DB_PREFIX}*" database instead.`,
    )
  }

  if (!database.startsWith(TEST_DB_PREFIX) || database.length === TEST_DB_PREFIX.length) {
    throw new Error(
      `Refusing to open or drop "${database}" as a test fixture: fixture databases must start with "${TEST_DB_PREFIX}".`,
    )
  }
}

/**
 * A fixture binding for a suite. `name` may be written with or without the
 * prefix; the database is always `tm_test_*` and the URI comes from
 * `TM_TEST_MONGO_URI` (local MongoDB by default).
 */
export function testDatabaseBinding(name: string): DatabaseBinding {
  const database = name.startsWith(TEST_DB_PREFIX) ? name : `${TEST_DB_PREFIX}${name}`
  assertDisposableTestDatabase(database)
  return { uri: defaultUri(), database }
}

/**
 * Drops a fixture database. Guarded, so a suite cannot drop `sen-tuan` even if
 * its binding were constructed incorrectly.
 */
export async function dropTestDatabase(connection: Connection): Promise<void> {
  assertDisposableTestDatabase(connection.name)
  await connection.db!.dropDatabase()
}

/**
 * Drops a fixture through the storefront's mongoose client (`connectMongo`),
 * which exposes the connection on `.connection` instead of a `Connection`.
 */
export async function dropTestMongooseDatabase(
  client: { connection: { name?: string, db?: { dropDatabase(): Promise<unknown> } } },
): Promise<void> {
  assertDisposableTestDatabase(client.connection.name || '')
  await client.connection.db!.dropDatabase()
}

/** Opens a fixture database and clears it, refusing anything but `tm_test_*`. */
export async function openTestDatabase(name: string): Promise<Connection> {
  const binding = testDatabaseBinding(name)
  const connection = await connectDatabase(binding)
  await dropTestDatabase(connection)
  return connection
}
