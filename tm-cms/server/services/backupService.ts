import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import mongoose from 'mongoose'
import type { Connection, Types } from 'mongoose'

/**
 * Logical backup and restore for one customer database.
 *
 * `mongodump` is not assumed to exist on an operator's machine, and a dump is only
 * trustworthy if it can prove what it contains. So a backup here is one JSONL file per
 * collection, a manifest that records each collection's count, sha256 and indexes, and
 * a restore that refuses to load a file whose hash no longer matches.
 *
 * The codec is deliberate: `JSON.stringify` turns a Date into a string and an ObjectId
 * into a two-letter field, so neither would come back. `encode`/`decode` below keep
 * those types tagged (`$oid`, `$date`, `$binary`) and sort object keys, which is what
 * makes a second dump of unchanged data byte-identical.
 *
 * What this does not carry: collection validators, collation, views and database-level
 * settings. Indexes are recreated. Recorded in `docs/v2/08`.
 */

export const BACKUP_FORMAT_VERSION = 1

export interface BackupCollectionEntry {
  name: string
  count: number
  sha256: string
  indexes: Array<Record<string, unknown>>
}

export interface BackupManifest {
  formatVersion: number
  database: string
  createdAt: string
  collections: BackupCollectionEntry[]
}

export interface BackupReport {
  directory: string
  manifest: BackupManifest
}

export interface RestoreReport {
  database: string
  collections: Array<{ name: string, inserted: number, sha256: string }>
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function isObjectId(value: unknown): value is Types.ObjectId {
  return value instanceof mongoose.Types.ObjectId
}

/**
 * The driver hands back a BSON `Binary`, not a `Buffer`, so both shapes have to encode
 * the same way — otherwise a restored file hashes differently from the one it came from.
 */
function asBytes(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value
  const candidate = value as { _bsontype?: string, buffer?: Uint8Array }
  if (candidate?._bsontype === 'Binary' && candidate.buffer) return Buffer.from(candidate.buffer)
  return null
}

function encode(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return { $date: value.toISOString() }
  if (isObjectId(value)) return { $oid: value.toHexString() }
  const bytes = asBytes(value)
  if (bytes) return { $binary: bytes.toString('base64') }
  if (typeof value === 'bigint') return { $numberLong: value.toString() }
  if (Array.isArray(value)) return value.map(encode)
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = encode(source[key])
    }
    return out
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  return null
}

function decode(value: JsonValue): unknown {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(decode)
  if (typeof value !== 'object') return value

  const tags = Object.keys(value)
  if (tags.length === 1) {
    if (tags[0] === '$oid') return new mongoose.Types.ObjectId(String((value as { $oid: string }).$oid))
    if (tags[0] === '$date') return new Date(String((value as { $date: string }).$date))
    if (tags[0] === '$binary') return Buffer.from(String((value as { $binary: string }).$binary), 'base64')
    if (tags[0] === '$numberLong') return Number((value as { $numberLong: string }).$numberLong)
  }

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) out[key] = decode(entry)
  return out
}

function canonicalLine(document: Record<string, unknown>): string {
  return JSON.stringify(encode(document))
}

function hashLines(lines: string[]): string {
  const hash = createHash('sha256')
  for (const line of lines) hash.update(line).update('\n')
  return hash.digest('hex')
}

function databaseOf(connection: Connection) {
  const db = connection.db
  if (!db) throw new Error('The connection has no database selected')
  return db
}

/** Reads a collection in `_id` order so the hash does not depend on insertion order. */
async function collectionLines(connection: Connection, name: string): Promise<string[]> {
  const documents = await databaseOf(connection).collection(name).find({}).sort({ _id: 1 }).toArray()
  return documents.map(document => canonicalLine(document as Record<string, unknown>))
}

export async function hashCollection(
  connection: Connection,
  name: string,
): Promise<{ count: number, sha256: string }> {
  const lines = await collectionLines(connection, name)
  return { count: lines.length, sha256: hashLines(lines) }
}

export async function dumpDatabase(
  connection: Connection,
  targetDir: string,
  options: { exclude?: string[] } = {},
): Promise<BackupReport> {
  const db = databaseOf(connection)
  const exclude = new Set(options.exclude ?? [])
  const directory = join(targetDir, db.databaseName)
  await mkdir(directory, { recursive: true })

  const existing = (await readdir(directory)).filter(name => name.endsWith('.jsonl'))
  const names = (await db.listCollections().toArray())
    .map(collection => collection.name)
    .filter(name => !exclude.has(name))
    .sort()

  const collections: BackupCollectionEntry[] = []
  for (const name of names) {
    const lines = await collectionLines(connection, name)
    await writeFile(join(directory, `${name}.jsonl`), lines.map(line => `${line}\n`).join(''), 'utf8')
    const indexes = (await db.collection(name).indexes())
      .filter(index => index.name !== '_id_')
      .map(index => JSON.parse(JSON.stringify(index)) as Record<string, unknown>)
    collections.push({ name, count: lines.length, sha256: hashLines(lines), indexes })
  }

  // A collection that no longer exists must not survive in the directory, or a restore
  // would bring back data the dump was meant to leave behind.
  for (const file of existing.filter(entry => !names.includes(entry.replace(/\.jsonl$/, '')))) {
    await writeFile(join(directory, file), '', 'utf8')
  }

  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    database: db.databaseName,
    createdAt: new Date().toISOString(),
    collections,
  }
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { directory, manifest }
}

export class BackupIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupIntegrityError'
  }
}

export async function readManifest(directory: string): Promise<BackupManifest> {
  const raw = await readFile(join(directory, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as BackupManifest
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupIntegrityError(
      `Backup format ${manifest.formatVersion} is not supported (expected ${BACKUP_FORMAT_VERSION})`,
    )
  }
  return manifest
}

/**
 * Checks a dump against its own manifest without touching a database. A restore runs
 * this first, so a truncated or edited file fails before anything is written.
 */
export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const manifest = await readManifest(directory)
  for (const entry of manifest.collections) {
    const raw = await readFile(join(directory, `${entry.name}.jsonl`), 'utf8')
    const lines = raw.split('\n').filter(line => line.length > 0)
    if (lines.length !== entry.count) {
      throw new BackupIntegrityError(`${entry.name}: manifest says ${entry.count} documents, file has ${lines.length}`)
    }
    const sha256 = hashLines(lines)
    if (sha256 !== entry.sha256) {
      throw new BackupIntegrityError(`${entry.name}: sha256 ${sha256} does not match the manifest`)
    }
    for (const line of lines) {
      try {
        JSON.parse(line)
      } catch (error) {
        throw new BackupIntegrityError(`${entry.name}: a line is not valid JSON (${(error as Error).message})`)
      }
    }
  }
  return manifest
}

/**
 * Restores a verified dump into the connection's database. Each collection is replaced
 * rather than appended, so restoring the same backup twice cannot duplicate rows, and
 * the report re-hashes what landed so "restored" means the bytes match.
 */
export async function restoreDatabase(
  connection: Connection,
  directory: string,
  options: { drop?: boolean } = {},
): Promise<RestoreReport> {
  const manifest = await verifyBackup(directory)
  const db = databaseOf(connection)
  if (options.drop) await db.dropDatabase()

  const restored: RestoreReport['collections'] = []
  for (const entry of manifest.collections) {
    const raw = await readFile(join(directory, `${entry.name}.jsonl`), 'utf8')
    const documents = raw
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => decode(JSON.parse(line) as JsonValue) as Record<string, unknown>)

    await db.collection(entry.name).deleteMany({})
    if (documents.length > 0) await db.collection(entry.name).insertMany(documents as never[])
    if (entry.indexes.length > 0) await db.collection(entry.name).createIndexes(entry.indexes as never[])

    const landed = await hashCollection(connection, entry.name)
    if (landed.sha256 !== entry.sha256) {
      throw new BackupIntegrityError(
        `${entry.name}: restored bytes differ from the backup (${landed.sha256} ≠ ${entry.sha256})`,
      )
    }
    restored.push({ name: entry.name, inserted: documents.length, sha256: landed.sha256 })
  }

  return { database: db.databaseName, collections: restored }
}
