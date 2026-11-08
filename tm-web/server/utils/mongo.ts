import mongoose from 'mongoose'
import type { H3Event } from 'h3'

export interface MongoTarget {
  uri: string
  database: string
}

interface MongoConnectionState {
  key: string
  promise: Promise<typeof mongoose>
}

const globalForMongo = globalThis as unknown as { __tmWebMongo?: MongoConnectionState }

/**
 * Resolves the server-side MongoDB binding for this website.
 * The database is chosen by the build (customer registry or TM_MONGO_DB) and is
 * never read from the request, so a visitor cannot reach another tenant's data.
 */
export function getMongoTarget(event: H3Event): MongoTarget | null {
  const config = useRuntimeConfig(event)
  const uri = String(config.mongoUri || '').trim()
  const database = String(config.catalogDbName || '').trim()
  if (!uri || !database) return null
  return { uri, database }
}

export function requireMongoTarget(event: H3Event): MongoTarget {
  const target = getMongoTarget(event)
  if (!target) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.catalogNotConnected',
      data: { code: 'CATALOG_NOT_CONFIGURED' },
    })
  }
  return target
}

/**
 * Opens (or reuses) the single pooled connection for the requested database.
 * The pool is cached on `globalThis` so Nitro hot reloads and serverless warm
 * starts do not leak connections.
 */
export async function connectMongo(target: MongoTarget): Promise<typeof mongoose> {
  const key = `${target.uri}::${target.database}`

  const cached = globalForMongo.__tmWebMongo
  if (cached?.key === key) {
    await cached.promise
    return mongoose
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => undefined)
  }

  const state: MongoConnectionState = {
    key,
    promise: mongoose.connect(target.uri, {
      dbName: target.database,
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 20000,
      bufferCommands: false,
    }),
  }
  globalForMongo.__tmWebMongo = state

  try {
    await state.promise
  } catch {
    if (globalForMongo.__tmWebMongo === state) globalForMongo.__tmWebMongo = undefined
    throw createError({
      statusCode: 503,
      statusMessage: 'error.catalogUnavailable',
      data: { code: 'CATALOG_UPSTREAM_UNAVAILABLE' },
    })
  }

  return mongoose
}

/**
 * Requires the site binding and runs `handler` against a live connection.
 * Catalog and content live in the same customer database, so the storefront
 * features share one pooled connection instead of opening a second one.
 */
export async function withSiteDb<T>(event: H3Event, handler: () => Promise<T>): Promise<T> {
  const target = requireMongoTarget(event)
  await connectMongo(target)
  return handler()
}

/** Catalog-facing alias kept for the existing catalog service imports. */
export const withCatalogDb = withSiteDb
