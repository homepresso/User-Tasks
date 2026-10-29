/**
 * Storage migration building blocks (lib/storage/migrate.ts):
 *  - object copy between providers with checksum verification
 *  - persisted URL rewrite (JSON walk) with a dry-run report, on fixtures
 *  - on the local stack (EVENT_STREAM_DB_URL): Supabase Storage → local disk,
 *    then rewrite the URLs stored in the database and serve them via /files
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dbCapabilities } from './helpers/db-capabilities'
import type { PublicConfig } from '@/lib/config/public'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import { createSupabaseStorageProvider } from '@/lib/providers/storage/supabase'
import { readAll, type StorageProvider } from '@/lib/providers/storage/types'
import { copyStorageObjects, rewriteStorageJson, rewriteStorageUrls, sha256, STORAGE_URL_COLUMNS, type RewriteOptions } from '@/lib/storage/migrate'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { serveStorageFile } from '@/lib/storage/serve'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows */

const SB = 'https://proj.supabase.co'
const APP = 'https://tasks.example.com'
const source: PublicConfig = { supabaseUrl: SB, supabaseAnonKey: '', appUrl: APP, ssoMicrosoft: false }
const target: RewriteOptions = { sourceConfig: source, targetUrl: (bucket, key) => `${APP}/files/${bucket}/${key}` }
const pub = (bucket: string, key: string, q = '') => `${SB}/storage/v1/object/public/${bucket}/${key}${q}`

const tmpRoots: string[] = []
async function localProvider(): Promise<StorageProvider> {
  const root = await mkdtemp(path.join(tmpdir(), 'ut-migrate-'))
  tmpRoots.push(root)
  return createLocalStorageProvider({ local_root: root })
}
afterAll(async () => { for (const root of tmpRoots) await rm(root, { recursive: true, force: true }) })

describe('copyStorageObjects', () => {
  it('copies every bucket with verified checksums, idempotently', async () => {
    const from = await localProvider()
    const to = await localProvider()
    await from.put('logos', 't1/logo.png', new Uint8Array([1, 2, 3]), { contentType: 'image/png' })
    await from.put('task-files', 'data-tables/x/a.csv', new TextEncoder().encode('a,b'), { contentType: 'text/csv' })
    await from.put('task-files', 'workflow-files/t1/deep/b.bin', new Uint8Array(70_000).fill(7))

    const dry = await copyStorageObjects(from, to, { dryRun: true })
    expect(dry.buckets.map((b) => [b.bucket, b.objects, b.copied])).toEqual([['task-files', 2, 0], ['logos', 1, 0], ['brand-fonts', 0, 0], ['form-files', 0, 0]])
    expect((await to.list('logos', '')).objects).toEqual([])

    const events: string[] = []
    const report = await copyStorageObjects(from, to, { pageSize: 1, onObject: (e) => events.push(`${e.status}:${e.bucket}/${e.key}`) })
    expect(report.ok).toBe(true)
    expect(report.buckets.find((b) => b.bucket === 'task-files')).toMatchObject({ objects: 2, copied: 2, bytes: 70_003 })
    expect(events).toContain('copied:logos/t1/logo.png')
    const copied = await to.get('task-files', 'workflow-files/t1/deep/b.bin')
    expect(sha256(await readAll(copied!.body))).toBe(sha256(new Uint8Array(70_000).fill(7)))
    expect((await to.head('task-files', 'data-tables/x/a.csv'))?.contentType).toBe('text/csv')

    const again = await copyStorageObjects(from, to)
    expect(again.buckets.find((b) => b.bucket === 'task-files')).toMatchObject({ copied: 0, unchanged: 2 })
  })

  it('reports conflicting objects unless overwrite is set', async () => {
    const from = await localProvider()
    const to = await localProvider()
    await from.put('logos', 't1/logo.png', new Uint8Array([1]))
    await to.put('logos', 't1/logo.png', new Uint8Array([9]))
    const report = await copyStorageObjects(from, to, { buckets: ['logos'] })
    expect(report.ok).toBe(false)
    expect(report.buckets[0].conflicts).toEqual(['t1/logo.png'])
    const forced = await copyStorageObjects(from, to, { buckets: ['logos'], overwrite: true })
    expect(forced.buckets[0].copied).toBe(1)
    expect([...await readAll((await to.get('logos', 't1/logo.png'))!.body)]).toEqual([1])
  })
})

describe('rewriteStorageJson', () => {
  it('asset columns: own URLs become storage:// refs (query kept), foreign URLs stay', () => {
    const branding = { logo_url: pub('logos', 't1/logo.png', '?t=5'), primary_color: '#123456', other: 'https://example.com/x.png' }
    const { value, changes } = rewriteStorageJson(branding, 'asset', target)
    expect(value).toEqual({ logo_url: 'storage://logos/t1/logo.png?t=5', primary_color: '#123456', other: 'https://example.com/x.png' })
    expect(changes).toEqual([{ path: 'logo_url', from: branding.logo_url, to: 'storage://logos/t1/logo.png?t=5' }])
  })

  it('theme: images and nested font URLs', () => {
    const theme = { branding: { logoLight: pub('logos', 't1/l.png'), wordmark: 'Acme' }, typography: { sans: { source: 'upload', family: 'A', url: pub('brand-fonts', 't1/a.woff2') }, mono: { source: 'system', family: 'mono' } } }
    const { value, changes } = rewriteStorageJson(theme, 'asset', target) as any
    expect(value.branding).toEqual({ logoLight: 'storage://logos/t1/l.png', wordmark: 'Acme' })
    expect(value.typography.sans.url).toBe('storage://brand-fonts/t1/a.woff2')
    expect(changes.map((c: any) => c.path)).toEqual(['branding.logoLight', 'typography.sans.url'])
  })

  it('data columns: file objects keep a usable url (re-pointed) and gain ref; other URLs re-point; icons become refs', () => {
    const row = {
      title: 'x',
      doc: { name: 'a.pdf', url: pub('task-files', 'data-tables/t/a.pdf'), size: 3, path: 'data-tables/t/a.pdf' },
      files: [{ _file: true, name: 'r.xlsx', url: pub('task-files', 'workflow-files/t1/r.xlsx'), path: 'workflow-files/t1/r.xlsx' }],
      file_url: pub('task-files', 'workflow-files/t1/r.xlsx'),
      config: { node_icon_url: pub('task-files', 'reference-icons/i.svg') },
      external: { url: 'https://example.com/a.pdf', path: 'a.pdf' },
    }
    const { value, changes } = rewriteStorageJson(row, 'data', target) as any
    expect(value.doc).toEqual({ name: 'a.pdf', url: `${APP}/files/task-files/data-tables/t/a.pdf`, size: 3, path: 'data-tables/t/a.pdf', ref: 'storage://task-files/data-tables/t/a.pdf' })
    expect(value.files[0]).toMatchObject({ url: `${APP}/files/task-files/workflow-files/t1/r.xlsx`, ref: 'storage://task-files/workflow-files/t1/r.xlsx' })
    expect(value.file_url).toBe(`${APP}/files/task-files/workflow-files/t1/r.xlsx`)
    expect(value.config.node_icon_url).toBe('storage://task-files/reference-icons/i.svg')
    expect(value.external).toEqual(row.external)
    expect(changes).toHaveLength(6)
  })

  it('unchanged values are returned as is (same reference) and refs are idempotent', () => {
    const value = { logo_url: 'storage://logos/t/l.png', n: [1, 'two', null] }
    const result = rewriteStorageJson(value, 'asset', target)
    expect(result.changes).toEqual([])
    expect(result.value).toBe(value)
  })
})

describe('rewriteStorageUrls (memory db)', () => {
  const seed = () => createMemorySupabase({
    tenants: [{ id: 't1', branding: { logo_url: pub('logos', 't1/logo.png', '?t=1') } }, { id: 't2', branding: {} }],
    workspace_themes: [{ tenant_id: 't1', theme: { branding: { favicon: pub('logos', 't1/favicon.png') } } }],
    custom_table_rows: [{ id: 'r1', data: { f: { name: 'a', url: pub('task-files', 'data-tables/x/a.pdf'), path: 'data-tables/x/a.pdf' } } }],
  })

  it('dry run reports without writing; a real run updates only changed rows', async () => {
    const db = seed() as any
    const columns = STORAGE_URL_COLUMNS.filter((c) => ['tenants', 'workspace_themes', 'custom_table_rows'].includes(c.table))
    const dry = await rewriteStorageUrls(db, { ...target, columns })
    expect(dry).toMatchObject({ dryRun: true, rowsChanged: 3, urlsChanged: 4 })
    expect(dry.columns.find((c) => c.table === 'tenants')).toMatchObject({ rowsScanned: 2, rowsChanged: 1 })
    expect(db.tables.tenants[0].branding.logo_url).toBe(pub('logos', 't1/logo.png', '?t=1'))

    const real = await rewriteStorageUrls(db, { ...target, columns, dryRun: false })
    expect(real.rowsChanged).toBe(3)
    expect(db.tables.tenants[0].branding.logo_url).toBe('storage://logos/t1/logo.png?t=1')
    expect(db.tables.workspace_themes[0].theme.branding.favicon).toBe('storage://logos/t1/favicon.png')
    expect(db.tables.custom_table_rows[0].data.f.ref).toBe('storage://task-files/data-tables/x/a.pdf')

    const after = await rewriteStorageUrls(db, { ...target, columns })
    expect(after.rowsChanged).toBe(0)
  })

  it('skips columns the install does not have, with a note', async () => {
    const db = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'relation "agent_runs" does not exist' } }) }) }) }) }
    const report = await rewriteStorageUrls(db, { ...target, columns: [{ table: 'agent_runs', column: 'outputs', key: 'id', mode: 'data' }] })
    expect(report.columns[0].skipped).toMatch(/does not exist/)
  })
})

// ── local stack: Supabase Storage → local disk ──────────────────────────────

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Copies out of Supabase Storage: only when the DB under test is the stack's.
describe.skipIf(!DB_URL || !(await dbCapabilities())?.supabase)('migration on the local stack (supabase → local disk)', () => {
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const supabase = createSupabaseStorageProvider(() => admin)
  const TENANT = '5707a9e0-0000-4000-8000-0000000000a1'
  const RUN = `mig-${Date.now().toString(36)}`
  const keys = { logo: `${TENANT}/${RUN}-logo.png`, font: `${TENANT}/${RUN}-brand.woff2`, file: `data-tables/${RUN}/report.csv` }
  const tableId = '5707a9e0-0000-4000-8000-0000000000b1'
  const rowId = '5707a9e0-0000-4000-8000-0000000000c1'
  let local: StorageProvider

  beforeAll(async () => {
    local = await localProvider()
    await admin.from('tenants').upsert({ id: TENANT, name: 'Storage migration', slug: `storage-mig-${RUN}`, branding: {} })
    await supabase.put('logos', keys.logo, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), { contentType: 'image/png', upsert: true })
    await supabase.put('brand-fonts', keys.font, new Uint8Array([0x77, 0x4f, 0x46, 0x32, 2]), { contentType: 'font/woff2', upsert: true })
    await supabase.put('task-files', keys.file, new TextEncoder().encode('a,b\n1,2'), { contentType: 'text/csv', upsert: true })
    const legacy = (bucket: string, key: string) => supabase.publicUrl(bucket, key)
    await admin.from('tenants').update({ branding: { logo_url: `${legacy('logos', keys.logo)}?t=1`, primary_color: '#123456' } }).eq('id', TENANT)
    const { error: tErr } = await admin.from('custom_tables').upsert({ id: tableId, tenant_id: TENANT, name: `Mig ${RUN}`, slug: `mig-${RUN}`, columns: [{ key: 'doc', type: 'file' }] })
    if (tErr) throw new Error(tErr.message)
    const { error: rErr } = await admin.from('custom_table_rows').upsert({ id: rowId, table_id: tableId, tenant_id: TENANT, data: { doc: { name: 'report.csv', url: legacy('task-files', keys.file), size: 7, path: keys.file } } })
    if (rErr) throw new Error(rErr.message)
  }, 60_000)

  afterAll(async () => {
    await admin.from('custom_table_rows').delete().eq('id', rowId)
    await admin.from('custom_tables').delete().eq('id', tableId)
    await admin.from('tenants').delete().eq('id', TENANT)
    await supabase.delete('logos', [keys.logo])
    await supabase.delete('brand-fonts', [keys.font])
    await supabase.delete('task-files', [keys.file])
  }, 60_000)

  it('copies the objects with verified checksums', async () => {
    // Only this suite's tenant: other suites add and remove logos concurrently.
    const report = await copyStorageObjects(supabase, local, { prefix: `${TENANT}/`, buckets: ['logos', 'brand-fonts'], dryRun: false })
    const logos = report.buckets.find((b) => b.bucket === 'logos')!
    expect(logos.failed).toEqual([])
    expect(logos.copied + logos.unchanged).toBeGreaterThanOrEqual(1)
    const files = await copyStorageObjects(supabase, local, { buckets: ['task-files'], prefix: `data-tables/${RUN}/` })
    expect(files.buckets[0]).toMatchObject({ objects: 1, copied: 1 })
    const copied = await local.get('task-files', keys.file)
    expect(new TextDecoder().decode(await readAll(copied!.body))).toBe('a,b\n1,2')
    expect(copied!.contentType).toMatch(/^text\/csv/)
  }, 120_000)

  it('rewrites the stored URLs (dry run first) and the results load through /files', async () => {
    const options: RewriteOptions = {
      sourceConfig: { supabaseUrl: API_URL, supabaseAnonKey: '', appUrl: APP, ssoMicrosoft: false },
      targetUrl: (bucket, key) => `${APP}/files/${bucket}/${key}`,
    }
    const columns = STORAGE_URL_COLUMNS.filter((c) => c.table === 'tenants' || c.table === 'custom_table_rows')
    const dry = await rewriteStorageUrls(admin, { ...options, columns })
    const tenantChange = dry.columns.find((c) => c.table === 'tenants')!.changes.find((c) => c.id === TENANT)
    expect(tenantChange?.changes[0].to).toBe(`storage://logos/${keys.logo}?t=1`)
    const { data: before } = await admin.from('tenants').select('branding').eq('id', TENANT).single()
    expect((before!.branding as any).logo_url).toMatch(/^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/public\/logos\//)

    await rewriteStorageUrls(admin, { ...options, columns, dryRun: false })
    const { data: tenant } = await admin.from('tenants').select('branding').eq('id', TENANT).single()
    expect(tenant!.branding).toEqual({ logo_url: `storage://logos/${keys.logo}?t=1`, primary_color: '#123456' })
    const { data: row } = await admin.from('custom_table_rows').select('data').eq('id', rowId).single()
    expect((row!.data as any).doc).toMatchObject({ url: `${APP}/files/task-files/${keys.file}`, ref: `storage://task-files/${keys.file}`, path: keys.file })

    // The rewritten reference resolves to /files, which the local provider serves.
    const config: PublicConfig = { ...options.sourceConfig, storage: { provider: 'local' } }
    const url = resolveStorageUrl((tenant!.branding as any).logo_url, { config })
    expect(url).toBe(`/files/logos/${keys.logo}?t=1`)
    const res = await serveStorageFile(new Request(`${APP}${url}`), 'logos', keys.logo.split('/'), { provider: async () => local, sessionTenants: async () => null })
    expect(res.status).toBe(200)
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 1])
  }, 120_000)
})
