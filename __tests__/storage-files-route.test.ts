/**
 * GET /files/<bucket>/<key>: stored objects streamed through the provider.
 * Content types, cache headers / ETags, 404s, traversal attempts and the
 * private-bucket rules (session tenant or app-signed URL).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { contentTypeFor, serveStorageFile, type ServeFileDeps } from '@/lib/storage/serve'
import { appSignedFilesUrl, verifyFilesSignature } from '@/lib/storage/signing'
import type { BucketPolicy } from '@/lib/storage/buckets'

let root: string
let provider: StorageProvider
const env = { ...process.env }

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ut-files-'))
  provider = createLocalStorageProvider({ local_root: root })
  await provider.put('logos', 'tenant-a/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { contentType: 'image/png', cacheControl: '31536000' })
  await provider.put('brand-fonts', 'tenant-a/acme-1.woff2', new Uint8Array([0x77, 0x4f, 0x46, 0x32]), { contentType: 'font/woff2' })
  await provider.put('task-files', 'data-tables/t1/page.html', new TextEncoder().encode('<script>alert(1)</script>'), { contentType: 'text/html' })
  await provider.put('task-files', 'workflow-files/tenant-a/report.xlsx', new Uint8Array([1, 2, 3]))
  await provider.put('task-files', 'data-tables/t1/Résumé "final".pdf', new Uint8Array([0x25, 0x50]), { contentType: 'application/pdf' })
  await provider.put('private-docs', 'tenant-a/secret.txt', new TextEncoder().encode('secret'), { contentType: 'text/plain' })
})

afterAll(async () => {
  process.env = env
  await rm(root, { recursive: true, force: true })
})

const PRIVATE: BucketPolicy = { public: false, tenantFromKey: (key) => key.split('/')[0] || null }
const policy = (bucket: string) => (bucket === 'private-docs' ? PRIVATE : bucket === 'logos' || bucket === 'brand-fonts' || bucket === 'task-files' ? { public: true } : null)

function deps(tenants: string[] | null = null): ServeFileDeps & { calls: number } {
  const d = {
    calls: 0,
    provider: async () => provider,
    policy,
    sessionTenants: async () => { d.calls++; return tenants },
  }
  return d
}

const get = (url: string, init?: RequestInit) => new Request(`http://app.test${url}`, init)
const serve = (bucket: string, key: string, d = deps(), init?: RequestInit) =>
  serveStorageFile(get(`/files/${bucket}/${key}`, init), bucket, key.split('/'), d)

describe('/files: public buckets', () => {
  it('streams the object with its content type and cache headers, no session needed', async () => {
    const d = deps()
    const res = await serve('logos', 'tenant-a/logo.png', d)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000')
    expect(res.headers.get('content-length')).toBe('4')
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(d.calls).toBe(0)
  })

  it('defaults to one hour of caching and guesses types from the extension', async () => {
    const res = await serve('task-files', 'workflow-files/tenant-a/report.xlsx')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="report.xlsx"/)
    expect(contentTypeFor('a/b.woff2', null)).toBe('font/woff2')
    expect(contentTypeFor('a/b.unknown', null)).toBe('application/octet-stream')
    expect(contentTypeFor('a/b.png', 'application/octet-stream')).toBe('image/png')
  })

  it('serves fonts inline for @font-face', async () => {
    const res = await serve('brand-fonts', 'tenant-a/acme-1.woff2')
    expect(res.headers.get('content-type')).toBe('font/woff2')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
  })

  it('never renders uploaded HTML in the app origin', async () => {
    const res = await serve('task-files', 'data-tables/t1/page.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/)
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
  })

  it('encodes non-ASCII and quoted file names safely', async () => {
    const key = 'data-tables/t1/Résumé "final".pdf'
    const res = await serveStorageFile(get('/files/task-files/x'), 'task-files', key.split('/'), deps())
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="R_sum_ _final_.pdf"; filename*=UTF-8''${encodeURIComponent('Résumé "final".pdf')}`)
  })

  it('answers conditional requests with 304 and HEAD without a body', async () => {
    const first = await serve('logos', 'tenant-a/logo.png')
    const etag = first.headers.get('etag')!
    const again = await serve('logos', 'tenant-a/logo.png', deps(), { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
    const head = await serve('logos', 'tenant-a/logo.png', deps(), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('4')
    expect(await head.text()).toBe('')
  })

  it('404s for unknown buckets and missing objects', async () => {
    expect((await serve('nope', 'tenant-a/logo.png')).status).toBe(404)
    const missing = await serve('logos', 'tenant-a/missing.png')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects traversal attempts before reaching the store', async () => {
    const spy = vi.spyOn(provider, 'get')
    for (const segments of [['..', 'etc', 'passwd'], ['tenant-a', '..', '..', 'x'], ['tenant-a', ''], ['a\\..\\b'], ['tenant-a', '.'], ['x\u0000y']]) {
      const res = await serveStorageFile(get('/files/logos/x'), 'logos', segments, deps())
      expect(res.status, segments.join('/')).toBe(400)
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('/files: private buckets', () => {
  it('404s without a session (no existence leak), and for members of other tenants', async () => {
    expect((await serve('private-docs', 'tenant-a/secret.txt', deps(null))).status).toBe(404)
    expect((await serve('private-docs', 'tenant-a/secret.txt', deps(['tenant-b']))).status).toBe(404)
    expect((await serve('private-docs', 'tenant-a/missing.txt', deps(['tenant-b']))).status).toBe(404)
  })

  it('serves members of the owning tenant with private caching', async () => {
    const res = await serve('private-docs', 'tenant-a/secret.txt', deps(['tenant-b', 'tenant-a']))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('secret')
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('denies keys without an owning tenant even to signed-in users', async () => {
    const noOwner: BucketPolicy = { public: false, tenantFromKey: () => null }
    const d = { ...deps(['tenant-a']), policy: () => noOwner }
    expect((await serve('private-docs', 'tenant-a/secret.txt', d)).status).toBe(404)
  })

  it('accepts a valid app-signed URL without a session; rejects tampered or expired ones', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    process.env.APP_URL = 'http://app.test'
    const signed = appSignedFilesUrl('private-docs', 'tenant-a/secret.txt', 60)
    const url = new URL(signed)
    expect(url.pathname).toBe('/files/private-docs/tenant-a/secret.txt')
    const ok = await serveStorageFile(new Request(signed), 'private-docs', ['tenant-a', 'secret.txt'], deps(null))
    expect(ok.status).toBe(200)

    const otherKey = await serveStorageFile(new Request(signed.replace('secret.txt', 'other.txt')), 'private-docs', ['tenant-a', 'other.txt'], deps(null))
    expect(otherKey.status).toBe(404)
    const tampered = new URL(signed)
    tampered.searchParams.set('expires', String(Number(tampered.searchParams.get('expires')) + 1000))
    expect((await serveStorageFile(new Request(tampered), 'private-docs', ['tenant-a', 'secret.txt'], deps(null))).status).toBe(404)
    expect(verifyFilesSignature('private-docs', 'tenant-a/secret.txt', url.searchParams.get('expires'), url.searchParams.get('signature'), Date.now() + 120_000)).toBe(false)
    delete process.env.ENCRYPTION_KEY
    expect(verifyFilesSignature('private-docs', 'tenant-a/secret.txt', url.searchParams.get('expires'), url.searchParams.get('signature'))).toBe(false)
  })

  it('local signedUrl() issues app-signed URLs, and refuses without a signing secret', async () => {
    delete process.env.ENCRYPTION_KEY
    delete process.env.WORKFLOW_PROCESSOR_SECRET
    delete process.env.CRON_SECRET
    delete process.env.SUPABASE_JWT_SECRET
    await expect(provider.signedUrl('logos', 'tenant-a/logo.png', 60)).rejects.toThrow(/ENCRYPTION_KEY/)
    process.env.ENCRYPTION_KEY = 'b'.repeat(64)
    expect(await provider.signedUrl('logos', 'tenant-a/logo.png', 60)).toMatch(/\/files\/logos\/tenant-a\/logo\.png\?expires=\d+&signature=/)
    delete process.env.ENCRYPTION_KEY
  })
})

describe('/files route module', () => {
  it('serves through the configured provider (STORAGE_PROVIDER=local)', async () => {
    process.env.STORAGE_PROVIDER = 'local'
    process.env.STORAGE_LOCAL_ROOT = root
    vi.resetModules()
    const { GET, HEAD } = await import('@/app/files/[bucket]/[...key]/route')
    const params = Promise.resolve({ bucket: 'logos', key: ['tenant-a', 'logo.png'] })
    const res = await GET(new NextRequest('http://app.test/files/logos/tenant-a/logo.png'), { params })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const head = await HEAD(new NextRequest('http://app.test/files/logos/tenant-a/logo.png', { method: 'HEAD' }), { params: Promise.resolve({ bucket: 'logos', key: ['tenant-a', 'logo.png'] }) })
    expect(head.status).toBe(200)
    const traversal = await GET(new NextRequest('http://app.test/files/logos/x'), { params: Promise.resolve({ bucket: 'logos', key: ['..', 'task-files', 'x'] }) })
    expect(traversal.status).toBe(400)
    delete process.env.STORAGE_PROVIDER
    delete process.env.STORAGE_LOCAL_ROOT
  })
})
