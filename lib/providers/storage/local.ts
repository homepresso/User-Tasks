import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { assertBucketName, assertSafeKey, isSafeStorageKey, StorageKeyError } from '@/lib/storage/buckets'
import { appSignedFilesUrl } from '@/lib/storage/signing'
import { optionString, type StorageOptions } from './options'
import { providerPublicUrl } from './urls'
import {
  StorageObjectExistsError, cacheControlHeader, pageByKey, readAll, toBytes,
  type StorageProvider, type StoredObjectInfo,
} from './types'

/**
 * Local filesystem (or an NFS / SMB volume mounted into the container).
 *
 *   <root>/<bucket>/<key>            object bytes
 *   <root>/.meta/<bucket>/<key>.json content type, cache control, etag
 *
 * Writes go to a temp file in the target directory and are renamed into
 * place (atomic on POSIX filesystems); `upsert: false` links instead of
 * renaming, which fails when the object exists. Every path is resolved and
 * checked to stay inside <root>/<bucket> (keys are validated first, and
 * symlinked directories pointing outside the root are refused).
 * Public objects are served by the app at /files; signed URLs are app-signed.
 */

const META_DIR = '.meta'
const TEMP_PREFIX = '.ut-tmp-'

interface Meta { contentType: string | null; cacheControl: string | null; etag: string }

export function createLocalStorageProvider(options: StorageOptions): StorageProvider {
  const configured = optionString(options, 'local_root')
  if (!configured) throw new Error('The local storage provider needs STORAGE_LOCAL_ROOT (storage.local_root)')
  const root = path.resolve(configured)

  function bucketDir(bucket: string): string {
    assertBucketName(bucket)
    if (bucket.startsWith('.')) throw new StorageKeyError('Invalid bucket name')
    return path.join(root, bucket)
  }

  function objectPath(bucket: string, key: string): { dir: string; file: string; meta: string } {
    assertSafeKey(key)
    const base = bucketDir(bucket)
    const file = path.resolve(base, ...key.split('/'))
    if (!file.startsWith(base + path.sep)) throw new StorageKeyError()
    const metaBase = path.join(root, META_DIR, bucket)
    const meta = path.resolve(metaBase, ...key.split('/')) + '.json'
    if (!meta.startsWith(metaBase + path.sep)) throw new StorageKeyError()
    if (key.split('/').some((segment) => segment.startsWith(TEMP_PREFIX))) throw new StorageKeyError()
    return { dir: base, file, meta }
  }

  /** Refuse directories that resolve (through symlinks) outside the bucket. */
  async function assertInside(base: string, target: string): Promise<void> {
    const [realBase, realTarget] = await Promise.all([fs.realpath(base), fs.realpath(target)])
    if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) throw new StorageKeyError()
  }

  async function writeAtomic(target: string, data: Uint8Array | string, exclusive: boolean): Promise<void> {
    const tmp = path.join(path.dirname(target), `${TEMP_PREFIX}${randomUUID()}`)
    await fs.writeFile(tmp, data)
    try {
      if (exclusive) await fs.link(tmp, target)
      else await fs.rename(tmp, target)
    } finally {
      await fs.rm(tmp, { force: true })
    }
  }

  async function readMeta(metaPath: string): Promise<Meta | null> {
    try { return JSON.parse(await fs.readFile(metaPath, 'utf8')) as Meta } catch { return null }
  }

  async function info(bucket: string, key: string): Promise<StoredObjectInfo | null> {
    const { file, meta } = objectPath(bucket, key)
    let stat
    try { stat = await fs.stat(file) } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null
      throw e
    }
    if (!stat.isFile()) return null
    await assertInside(bucketDir(bucket), file)
    const m = await readMeta(meta)
    return {
      key,
      size: stat.size,
      contentType: m?.contentType ?? null,
      etag: m?.etag ?? null,
      lastModified: stat.mtime.toISOString(),
      cacheControl: m?.cacheControl ?? null,
    }
  }

  const provider: StorageProvider = {
    id: 'local',
    onPrem: true,

    async put(bucket, key, body, opts = {}) {
      const { dir, file, meta } = objectPath(bucket, key)
      const bytes = await toBytes(body)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await assertInside(dir, path.dirname(file))
      try {
        await writeAtomic(file, bytes, !opts.upsert)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageObjectExistsError(bucket, key)
        throw e
      }
      const m: Meta = {
        contentType: opts.contentType || null,
        cacheControl: opts.cacheControl !== undefined ? cacheControlHeader(opts.cacheControl) : null,
        etag: createHash('md5').update(bytes).digest('hex'),
      }
      await fs.mkdir(path.dirname(meta), { recursive: true })
      await writeAtomic(meta, JSON.stringify(m), false)
    },

    async get(bucket, key) {
      const found = await info(bucket, key)
      if (!found) return null
      const { file } = objectPath(bucket, key)
      const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>
      return { ...found, body }
    },

    head: info,

    async delete(bucket, keys) {
      for (const key of keys) {
        const { file, meta } = objectPath(bucket, key)
        await fs.rm(file, { force: true })
        await fs.rm(meta, { force: true })
      }
    },

    async list(bucket, prefix, opts) {
      const base = bucketDir(bucket)
      const out: StoredObjectInfo[] = []
      const slash = prefix.lastIndexOf('/')
      const startDir = slash === -1 ? '' : prefix.slice(0, slash)
      if (startDir && !isSafeStorageKey(startDir)) return { objects: [], cursor: null }
      const walk = async (rel: string) => {
        let entries
        try { entries = await fs.readdir(path.join(base, ...(rel ? rel.split('/') : [])), { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          if (entry.name.startsWith(TEMP_PREFIX)) continue
          const key = rel ? `${rel}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            if (key.startsWith(prefix) || prefix.startsWith(`${key}/`)) await walk(key)
          } else if (entry.isFile() && key.startsWith(prefix)) {
            const found = await info(bucket, key)
            if (found) out.push(found)
          }
        }
      }
      await walk(startDir)
      return pageByKey(out, opts)
    },

    publicUrl(bucket, key) {
      return providerPublicUrl(bucket, key, options)
    },

    async signedUrl(bucket, key, ttlSeconds) {
      objectPath(bucket, key)
      return appSignedFilesUrl(bucket, key, ttlSeconds)
    },

    async copy(bucket, fromKey, toKey, opts = {}) {
      const source = await provider.get(bucket, fromKey)
      if (!source) throw new Error(`The object ${bucket}/${fromKey} does not exist`)
      await provider.put(opts.toBucket ?? bucket, toKey, await readAll(source.body), {
        contentType: source.contentType ?? undefined,
        cacheControl: source.cacheControl ?? undefined,
        upsert: opts.upsert,
      })
    },

    async ensureBucket(bucket) {
      await fs.mkdir(bucketDir(bucket), { recursive: true })
    },
  }
  return provider
}
