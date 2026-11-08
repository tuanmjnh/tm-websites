import type { H3Event } from 'h3'
import mongoose from 'mongoose'
import type { Connection } from 'mongoose'

export interface DatabaseBinding {
  uri: string
  database: string
}

export interface DatabaseBindingInput {
  uri?: string
  database?: string
  declaredDatabase?: string
}

export class DatabaseBindingError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'DatabaseBindingError'
    this.statusCode = statusCode
    this.code = code
  }
}

// Database names are identifiers, never user input. The pattern keeps a binding
// from widening the connection string or escaping the intended database.
const DATABASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const URI_PATTERN = /^mongodb(\+srv)?:\/\/\S+$/

/**
 * Resolves one customer database from deployment configuration only. The
 * registry declares the database this customer owns; an environment override
 * that disagrees with it is rejected instead of silently pointing a deployment
 * at another customer's data.
 */
export function resolveDatabaseBinding(input: DatabaseBindingInput): DatabaseBinding {
  const uri = String(input.uri || '').trim()
  const configured = String(input.database || '').trim()
  const declared = String(input.declaredDatabase || '').trim()

  if (!uri || !declared) {
    throw new DatabaseBindingError(503, 'DATABASE_NOT_CONFIGURED', 'Customer database binding is not configured')
  }

  if (!URI_PATTERN.test(uri)) {
    throw new DatabaseBindingError(503, 'DATABASE_URI_INVALID', 'TM_MONGO_URI is not a MongoDB connection string')
  }

  if (configured && configured !== declared) {
    throw new DatabaseBindingError(
      503,
      'DATABASE_BINDING_MISMATCH',
      `TM_MONGO_DB "${configured}" does not match the registry database "${declared}" for this customer`,
    )
  }

  if (!DATABASE_PATTERN.test(declared)) {
    throw new DatabaseBindingError(503, 'DATABASE_NAME_INVALID', 'Registry database name is not a valid identifier')
  }

  return { uri, database: declared }
}

interface ConnectionRegistry {
  connections: Map<string, Promise<Connection>>
}

const globalForDatabase = globalThis as unknown as { __tmCustomerConnections?: ConnectionRegistry }

function connectionRegistry(): ConnectionRegistry {
  if (!globalForDatabase.__tmCustomerConnections) {
    globalForDatabase.__tmCustomerConnections = { connections: new Map() }
  }

  return globalForDatabase.__tmCustomerConnections
}

export function bindingKey(binding: DatabaseBinding): string {
  return `${binding.uri}::${binding.database}`
}

/**
 * Opens or reuses the connection for exactly one binding. Connections are keyed
 * by binding so two deployments or tenants can be served in the same process
 * without switching a global connection under a live request.
 */
export async function connectDatabase(binding: DatabaseBinding): Promise<Connection> {
  const registry = connectionRegistry()
  const key = bindingKey(binding)
  const cached = registry.connections.get(key)
  if (cached) {
    return cached
  }

  const pending = mongoose.createConnection(binding.uri, {
    dbName: binding.database,
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 20000,
    bufferCommands: false,
  }).asPromise()

  registry.connections.set(key, pending)

  try {
    return await pending
  } catch {
    registry.connections.delete(key)
    throw new DatabaseBindingError(503, 'DATABASE_UNAVAILABLE', 'Customer database is unreachable')
  }
}

export function getDatabaseBinding(event: H3Event): DatabaseBinding {
  const config = useRuntimeConfig(event)
  return resolveDatabaseBinding({
    uri: String(config.mongoUri || ''),
    database: String(config.mongoDbOverride || ''),
    declaredDatabase: String(config.mongoDbName || ''),
  })
}

export async function withCustomerDb<T>(event: H3Event, handler: (connection: Connection) => Promise<T>): Promise<T> {
  const binding = getDatabaseBinding(event)
  const connection = await connectDatabase(binding)
  return handler(connection)
}

/** Test/shutdown helper: closes every pooled connection this process opened. */
export async function closeDatabaseConnections(): Promise<void> {
  const registry = connectionRegistry()
  const pending = [...registry.connections.values()]
  registry.connections.clear()
  await Promise.all(pending.map(async (entry) => {
    try {
      const connection = await entry
      await connection.close()
    } catch {
      // A connection that never opened has nothing to close.
    }
  }))
}
