/**
 * StorageProvider contract: the same behaviour from every implementation.
 *
 *  - local        always (temp directory)
 *  - supabase     local stack (EVENT_STREAM_DB_URL set, like the other DB tests)
 *  - s3           STORAGE_TEST_S3_ENDPOINT (MinIO: docker run -p 9010:9000 pgsty/minio server /data;
 *                 STORAGE_TEST_S3_ACCESS_KEY / _SECRET_KEY default to minioadmin)
 *  - azure_blob   STORAGE_TEST_AZURE_CONNECTION_STRING (Azurite)
 *  - gcs          STORAGE_TEST_GCS_ENDPOINT (fsouza/fake-gcs-server)
 * Providers whose backend isn't configured are skipped.
 */
import { mkdtemp, rm, symlink, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dbCapabilities } from './helpers/db-capabilities'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import { createS3StorageProvider } from '@/lib/providers/storage/s3'
import { createAzureBlobStorageProvider } from '@/lib/providers/storage/azure-blob'
import { createGcsStorageProvider } from '@/lib/providers/storage/gcs'
import { createSupabaseStorageProvider } from '@/lib/providers/storage/supabase'
import { readAll, StorageObjectExistsError, type StorageProvider } from '@/lib/providers/storage/types'
import { resolveStorageProvider } from '@/lib/providers/storage'
import { ProviderNotAvailableError } from '@/lib/providers/registry'

const RUN = `ct${Date.now().toString(36)}`
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

interface Backend {
  name: string
  enabled: boolean
  /** Bucket used by the suite (mapped to a fresh physical bucket where possible). */
  bucket: string
  create: () => Promise<{ provider: StorageProvider; cleanup?: () => Promise<void> }>
  /** Native signed URLs can be fetched from here (emulators may not verify signatures). */
  signedFetch?: boolean
}

const BUCKET = 'task-files'
const prefixed = { bucket_prefix: `${RUN}-` }

const backends: Backend[] = [
  {
    name: 'local',
    enabled: true,
    bucket: BUCKET,
    create: async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'ut-storage-'))
      return { provider: createLocalStorageProvider({ local_root: root }), cleanup: () => rm(root, { recursive: true, force: true }) }
    },
  },
  {
    name: 'supabase',
    // Supabase Storage on the stack: only when the DB under test is the stack's.
    enabled: Boolean((await dbCapabilities())?.supabase),
    // Supabase buckets are the real (migrated) ones; keys are namespaced by run instead.
    bucket: BUCKET,
    signedFetch: true,
    create: async () => {
      const client = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      return { provider: createSupabaseStorageProvider(() => client) }
    },
  },
  {
    name: 's3',
    enabled: Boolean(process.env.STORAGE_TEST_S3_ENDPOINT),
    bucket: BUCKET,
    signedFetch: true,
    create: async () => ({
      provider: createS3StorageProvider({
        endpoint: process.env.STORAGE_TEST_S3_ENDPOINT,
        region: 'us-east-1',
        access_key_id: process.env.STORAGE_TEST_S3_ACCESS_KEY ?? 'minioadmin',
        secret_access_key: process.env.STORAGE_TEST_S3_SECRET_KEY ?? 'minioadmin',
        force_path_style: 'true',
        ...prefixed,
      }),
    }),
  },
  {
    name: 'azure_blob',
    enabled: Boolean(process.env.STORAGE_TEST_AZURE_CONNECTION_STRING),
    bucket: BUCKET,
    signedFetch: true,
    create: async () => ({
      provider: createAzureBlobStorageProvider({ azure_connection_string: process.env.STORAGE_TEST_AZURE_CONNECTION_STRING, ...prefixed }),
    }),
  },
  {
    name: 'gcs',
    enabled: Boolean(process.env.STORAGE_TEST_GCS_ENDPOINT),
    bucket: BUCKET,
    // fake-gcs-server can't sign V4 URLs without a service-account key.
    signedFetch: false,
    create: async () => ({
      provider: createGcsStorageProvider({ gcs_endpoint: process.env.STORAGE_TEST_GCS_ENDPOINT, gcs_project_id: 'test', ...prefixed }),
    }),
  },
]

const text = (s: string) => new TextEncoder().encode(s)
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

for (const backend of backends) {
  describe.skipIf(!backend.enabled)(`storage contract: ${backend.name}`, () => {
    let provider: StorageProvider
    let cleanup: (() => Promise<void>) | undefined
    const base = `contract/${RUN}`
    const key = (k: string) => `${base}/${k}`

    beforeAll(async () => {
      ({ provider, cleanup } = await backend.create())
      await provider.ensureBucket(backend.bucket, { public: true })
    }, 60_000)

    afterAll(async () => {
      if (!provider) return
      for (let cursor: string | null = null, first = true; first || cursor; first = false) {
        const page = await provider.list(backend.bucket, `${base}/`, { cursor })
        if (page.objects.length) await provider.delete(backend.bucket, page.objects.map((o) => o.key))
        cursor = page.cursor
      }
      await cleanup?.()
    }, 60_000)

    it('put / get / head round-trip bytes, content type and cache control', async () => {
      await provider.put(backend.bucket, key('a/hello.txt'), text('hello world'), { contentType: 'text/plain', cacheControl: '600' })
      const head = await provider.head(backend.bucket, key('a/hello.txt'))
      expect(head).toMatchObject({ key: key('a/hello.txt'), size: 11 })
      expect(head!.contentType).toMatch(/^text\/plain/)
      const object = await provider.get(backend.bucket, key('a/hello.txt'))
      expect(object).not.toBeNull()
      expect(decode(await readAll(object!.body))).toBe('hello world')
      expect(object!.contentType).toMatch(/^text\/plain/)
      if (backend.name !== 'supabase') expect(object!.cacheControl).toMatch(/max-age=600/)
    })

    it('accepts Uint8Array, ArrayBuffer and Blob bodies', async () => {
      await provider.put(backend.bucket, key('b/1.bin'), new Uint8Array([1, 2, 3]))
      await provider.put(backend.bucket, key('b/2.bin'), new Uint8Array([4, 5]).buffer)
      await provider.put(backend.bucket, key('b/3.bin'), new Blob([new Uint8Array([6])]))
      expect([...await readAll((await provider.get(backend.bucket, key('b/2.bin')))!.body)]).toEqual([4, 5])
      expect([...await readAll((await provider.get(backend.bucket, key('b/3.bin')))!.body)]).toEqual([6])
    })

    it('refuses to overwrite without upsert and replaces with it', async () => {
      await provider.put(backend.bucket, key('c/x.txt'), text('one'))
      await expect(provider.put(backend.bucket, key('c/x.txt'), text('two'))).rejects.toBeInstanceOf(StorageObjectExistsError)
      await provider.put(backend.bucket, key('c/x.txt'), text('three'), { upsert: true })
      expect(decode(await readAll((await provider.get(backend.bucket, key('c/x.txt')))!.body))).toBe('three')
    })

    it('missing objects: get / head return null, delete ignores them', async () => {
      expect(await provider.get(backend.bucket, key('nope/missing.txt'))).toBeNull()
      expect(await provider.head(backend.bucket, key('nope/missing.txt'))).toBeNull()
      await expect(provider.delete(backend.bucket, [key('nope/missing.txt')])).resolves.toBeUndefined()
    })

    it('lists recursively under a prefix with a cursor', async () => {
      for (const name of ['l/1.txt', 'l/2.txt', 'l/deep/3.txt', 'l/deep/er/4.txt', 'lx/5.txt']) {
        await provider.put(backend.bucket, key(name), text(name), { upsert: true })
      }
      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const page = await provider.list(backend.bucket, key('l/'), { limit: 2, cursor })
        seen.push(...page.objects.map((o) => o.key))
        expect(page.objects.length).toBeLessThanOrEqual(2)
        cursor = page.cursor
        pages++
      } while (cursor && pages < 10)
      expect(seen.sort()).toEqual(['l/1.txt', 'l/2.txt', 'l/deep/3.txt', 'l/deep/er/4.txt'].map(key))
      const all = await provider.list(backend.bucket, key('l'))
      expect(all.objects.map((o) => o.key).sort()).toContain(key('lx/5.txt'))
      expect(all.objects.find((o) => o.key === key('l/1.txt'))?.size).toBe(key('l/1.txt').length - base.length - 1)
    })

    it('deletes many keys', async () => {
      await provider.put(backend.bucket, key('d/1'), text('1'))
      await provider.put(backend.bucket, key('d/2'), text('2'))
      await provider.delete(backend.bucket, [key('d/1'), key('d/2')])
      expect((await provider.list(backend.bucket, key('d/'))).objects).toEqual([])
    })

    it('copies an object', async () => {
      await provider.put(backend.bucket, key('e/src.txt'), text('copy me'), { contentType: 'text/plain' })
      await provider.copy(backend.bucket, key('e/src.txt'), key('e/dst.txt'))
      expect(decode(await readAll((await provider.get(backend.bucket, key('e/dst.txt')))!.body))).toBe('copy me')
      await expect(provider.copy(backend.bucket, key('e/src.txt'), key('e/dst.txt'))).rejects.toBeInstanceOf(StorageObjectExistsError)
    })

    it('public and signed URLs', async () => {
      await provider.put(backend.bucket, key('f/pub.txt'), text('public'), { contentType: 'text/plain' })
      const url = provider.publicUrl(backend.bucket, key('f/pub.txt'))
      expect(url).toContain(`${base.split('/').map(encodeURIComponent).join('/')}/f/pub.txt`)
      if (backend.name === 'local' || backend.name === 'gcs' && !backend.signedFetch) {
        // local: app-signed /files URLs (needs a signing secret); covered by the /files route tests.
        return
      }
      const signed = await provider.signedUrl(backend.bucket, key('f/pub.txt'), 60)
      expect(signed).toMatch(/^https?:\/\//)
      if (backend.signedFetch) {
        const res = await fetch(signed)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('public')
      }
    })

    it('rejects traversal and malformed keys before touching the store', async () => {
      for (const bad of ['../escape.txt', 'a/../../b', 'a//b', '/abs', 'a\\b', 'nul\u0000', '']) {
        await expect(provider.put(backend.bucket, bad, text('x'))).rejects.toThrow(/Invalid storage key/)
        await expect(provider.get(backend.bucket, bad)).rejects.toThrow(/Invalid storage key/)
      }
    })
  })
}

describe('local provider hardening', () => {
  let root: string
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'ut-local-')) })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  it('refuses symlinked directories that point outside the bucket', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'ut-outside-'))
    await writeFile(path.join(outside, 'secret.txt'), 'secret')
    await mkdir(path.join(root, 'task-files'), { recursive: true })
    await symlink(outside, path.join(root, 'task-files', 'link'))
    const provider = createLocalStorageProvider({ local_root: root })
    await expect(provider.get('task-files', 'link/secret.txt')).rejects.toThrow(/Invalid storage key/)
    await expect(provider.put('task-files', 'link/new.txt', text('x'))).rejects.toThrow(/Invalid storage key/)
    await rm(outside, { recursive: true, force: true })
  })

  it('writes atomically (no temp files left behind) and hides temp names', async () => {
    const provider = createLocalStorageProvider({ local_root: root })
    await provider.put('logos', 't1/logo.png', new Uint8Array([1]), { contentType: 'image/png' })
    await provider.put('logos', 't1/logo.png', new Uint8Array([2]), { upsert: true })
    const listed = await provider.list('logos', '')
    expect(listed.objects.map((o) => o.key)).toEqual(['t1/logo.png'])
    await expect(provider.put('logos', 't1/.ut-tmp-x', new Uint8Array([1]))).rejects.toThrow(/Invalid storage key/)
  })

  it('needs a root directory', () => {
    expect(() => createLocalStorageProvider({})).toThrow(/STORAGE_LOCAL_ROOT/)
  })
})

describe('provider registry', () => {
  it('resolves every storage provider id', () => {
    expect(resolveStorageProvider().id).toBe('supabase')
    expect(resolveStorageProvider('local', { local_root: tmpdir() }).id).toBe('local')
    expect(resolveStorageProvider('s3', {}).id).toBe('s3')
    expect(resolveStorageProvider('azure_blob', {}).id).toBe('azure_blob')
    expect(resolveStorageProvider('gcs', {}).id).toBe('gcs')
    expect(resolveStorageProvider('local', { local_root: tmpdir() }).onPrem).toBe(true)
    expect(resolveStorageProvider('s3', {}).onPrem).toBe(true)
    expect(() => resolveStorageProvider('nope' as never)).toThrow(ProviderNotAvailableError)
  })
})
