import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { isSafeStorageKey } from '../models/media'

/**
 * Local storage adapter for media binaries. Documents live in MongoDB; bytes
 * live in one directory this deployment owns, so a later object-store adapter
 * changes only this file. Nothing here accepts a caller-supplied path: the key
 * shape is validated and resolved under the media root.
 */

export class MediaStorageError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = 'MediaStorageError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function mediaRoot(): string {
  const configured = process.env.TM_MEDIA_DIR?.trim()
  return resolve(configured || join(process.cwd(), '.data', 'media'))
}

function absolutePath(key: string): string {
  if (!isSafeStorageKey(key)) {
    throw new MediaStorageError(500, 'MEDIA_KEY_INVALID', 'Media storage key is not valid')
  }
  const root = mediaRoot()
  const target = resolve(root, key)
  if (!target.startsWith(`${root}${sep}`)) {
    throw new MediaStorageError(500, 'MEDIA_KEY_INVALID', 'Media storage key escapes the media root')
  }
  return target
}

export function checksumOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}

/** Writes a new object. `wx` fails instead of overwriting an existing file. */
export async function putMediaObject(key: string, body: Buffer): Promise<void> {
  const target = absolutePath(key)
  await mkdir(dirname(target), { recursive: true })
  try {
    await writeFile(target, body, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new MediaStorageError(409, 'MEDIA_OBJECT_EXISTS', 'A file already exists under this storage key')
    }
    throw new MediaStorageError(500, 'MEDIA_WRITE_FAILED', 'The file could not be stored')
  }
}

/** Returns null when the metadata outlived the file (a manual cleanup). */
export async function getMediaObject(key: string): Promise<Buffer | null> {
  try {
    return await readFile(absolutePath(key))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new MediaStorageError(500, 'MEDIA_READ_FAILED', 'The file could not be read')
  }
}

/** Deletion is best-effort: a missing file is not an error, a busy one is. */
export async function removeMediaObject(key: string): Promise<void> {
  try {
    await unlink(absolutePath(key))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new MediaStorageError(500, 'MEDIA_DELETE_FAILED', 'The file could not be removed')
  }
}
