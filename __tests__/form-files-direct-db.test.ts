/**
 * Direct-to-storage form attachment uploads against a LOCAL Supabase stack:
 * init (a real Supabase signed upload URL), the browser's PUT (fetch), then
 * complete (the object is read back and verified). Also: a tampered upload
 * and a second PUT to the same signed URL.
 *
 * Runs only when EVENT_STREAM_DB_URL is set.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'
import type { ServiceContext } from '@/lib/services/context'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0d5e0000-0000-4000-8000-0000000000e1'
const FORM = '0d5e0000-0000-4000-8000-0000000000e2'
const USER = '0d5e0000-0000-4000-8000-0000000000e3'

let supabase: SupabaseClient
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => supabase }))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => supabase }))
vi.mock('@/lib/providers/storage', async (orig) => {
  const actual = await orig() as any
  const { createSupabaseStorageProvider } = await import('@/lib/providers/storage/supabase')
  return { ...actual, getStorageProvider: async () => createSupabaseStorageProvider(() => supabase as any) }
})

describe.skipIf(!DB_URL)('direct uploads to Supabase Storage', () => {
  const db = new Client({ connectionString: DB_URL })
  const ctx = (): ServiceContext => ({ supabase: supabase as any, db: supabase as any, tenantId: TENANT, actorId: USER, permissions: new Set(['forms.submit']), authKind: 'session', source: 'ui' })

  async function cleanup() {
    const { rows } = await db.query('SELECT storage_key FROM public.form_files WHERE tenant_id = $1', [TENANT])
    if (rows.length && supabase) await supabase.storage.from('form-files').remove(rows.map((r) => r.storage_key))
    await db.query('DELETE FROM public.form_files WHERE tenant_id = $1', [TENANT])
    await db.query('DELETE FROM public.forms WHERE tenant_id = $1', [TENANT])
    await db.query('DELETE FROM public.users WHERE id = $1', [USER]).catch(() => undefined)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
  }

  beforeAll(async () => {
    await db.connect()
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Direct uploads', 'direct-uploads')`, [TENANT])
    await db.query(`INSERT INTO public.users (id, tenant_id, email, display_name) VALUES ($1, $2, 'direct@uploads.test', 'Direct')`, [USER, TENANT])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $2, 'Scans', $3::jsonb)`, [FORM, TENANT, JSON.stringify([
      { key: 'scans', label: 'Scans', type: 'attachments', attachments: { max_files: 3, max_file_mb: 20, types: ['documents', 'images'] } },
    ])])
  })
  afterAll(async () => { await cleanup(); await db.end() })

  it('an 8 MB PDF: signed URL → PUT → complete; a second PUT to the same URL is refused', async () => {
    const svc = await import('@/lib/services/form-files')
    const pdf = Buffer.alloc(8 * 1024 * 1024, 0x20)
    pdf.write('%PDF-1.7\n', 0)
    const started = await svc.initDirectUpload(ctx(), { context: { kind: 'form', formId: FORM }, field_key: 'scans', name: 'contract scan.pdf', size: pdf.byteLength })
    if (started.mode !== 'direct') throw new Error('expected direct')
    expect(started.upload.url).toContain('/storage/v1/object/upload/sign/form-files/')
    const put = await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: pdf })
    expect(put.status).toBe(200)
    const file = await svc.completeDirectUpload(ctx(), started.file_id)
    expect(file).toMatchObject({ name: 'contract scan.pdf', size: pdf.byteLength, mime_type: 'application/pdf' })
    const { rows: [row] } = await db.query('SELECT status, checksum_sha256 FROM public.form_files WHERE id = $1', [started.file_id])
    expect(row.status).toBe('pending')
    expect(row.checksum_sha256).not.toBe('0'.repeat(64))
    // The signed URL can't overwrite the verified object.
    const again = await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: Buffer.from('MZ evil') })
    expect(again.ok).toBe(false)
  })

  it('a tampered direct upload is deleted from storage and refused', async () => {
    const svc = await import('@/lib/services/form-files')
    const exe = Buffer.alloc(64); exe.write('MZ', 0)
    const started = await svc.initDirectUpload(ctx(), { context: { kind: 'form', formId: FORM }, field_key: 'scans', name: 'invoice.pdf', size: exe.byteLength })
    if (started.mode !== 'direct') throw new Error('expected direct')
    expect((await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: exe })).status).toBe(200)
    const { rows: [row] } = await db.query('SELECT storage_key FROM public.form_files WHERE id = $1', [started.file_id])
    await expect(svc.completeDirectUpload(ctx(), started.file_id)).rejects.toThrow(/Programs/)
    expect((await db.query('SELECT 1 FROM public.form_files WHERE id = $1', [started.file_id])).rowCount).toBe(0)
    const { data } = await supabase.storage.from('form-files').download(row.storage_key)
    expect(data).toBeNull()
  })
})
