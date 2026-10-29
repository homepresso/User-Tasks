/**
 * Engine run over form attachments against a LOCAL Supabase stack:
 * manual start with a list of uploaded files → Loop For Each → Log each
 * file's name / size → HTTP Request (multipart, the file part `{{item}}`)
 * to a local mock endpoint; then, on Done, Send Email with every file
 * attached (console provider, .eml written to a temp dir). Files live in a
 * local storage provider and `form_files` rows; a run in another workspace
 * can't read them.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-attachments-engine-db.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows and node outputs are free-form JSON */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0d5e0000-0000-4000-8000-0000000000f1'
const OTHER = '0d5e0000-0000-4000-8000-0000000000f2'
const WF = '0d5e0000-0000-4000-8000-0000000000f3'
const WF_OTHER = '0d5e0000-0000-4000-8000-0000000000f4'
const FILE_A = '0d5e0000-0000-4000-8000-0000000000fa'
const FILE_B = '0d5e0000-0000-4000-8000-0000000000fb'

let supabase: SupabaseClient
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => supabase }))

const received: Array<{ name: string | null; fileName: string | null; type: string | null; bytes: Buffer }> = []

function nodes(endpoint: string) {
  return [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    { id: 'each', type: 'loop', label: 'Each file', config: { items: '{{files}}' } },
    { id: 'log', type: 'log', label: 'Log', config: { message: 'File {{item.name}} ({{item.size}} bytes)' } },
    {
      id: 'post', type: 'http_request', label: 'Upload',
      config: { method: 'POST', url: endpoint, content_type: 'multipart', multipart: [{ key: 'name', value: '{{item.name}}', type: 'text' }, { key: 'file', value: '{{item}}', type: 'file' }] },
    },
    { id: 'mail', type: 'send_email', label: 'Mail', config: { to: 'ops@northwind.example', subject: 'Receipts', body: '<p>{{=FILE_NAMES(files)}}</p>', attachments: '{{files}}' } },
  ]
}
const edges = [
  { id: 'e1', source: 'start', target: 'each' },
  { id: 'e2', source: 'each', target: 'log', label: 'Each Item' },
  { id: 'e3', source: 'log', target: 'post' },
  { id: 'e4', source: 'each', target: 'mail', label: 'Done' },
]

async function cleanup(db: Client) {
  for (const tenant of [TENANT, OTHER]) {
    for (const table of ['form_files', 'workflow_logs', 'workflow_queue', 'workflow_runs', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [tenant]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.tenants WHERE id = $1', [tenant])
  }
}

describe.skipIf(!DB_URL)('engine: loop over form attachments, HTTP multipart and email attachments', () => {
  const db = new Client({ connectionString: DB_URL })
  let server: Server
  let endpoint = ''
  let storageRoot = ''
  let mailDir = ''
  const saved: Record<string, string | undefined> = {}
  const files: any[] = []

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), 'ut-attach-store-'))
    mailDir = await mkdtemp(path.join(tmpdir(), 'ut-attach-mail-'))
    for (const [k, v] of Object.entries({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: storageRoot, EMAIL_PROVIDER: 'console', EMAIL_CONSOLE_DIR: mailDir })) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': String(req.headers['content-type']) }, body: Buffer.concat(chunks) }).formData()
      const file = form.get('file') as File | null
      received.push({ name: form.get('name') as string | null, fileName: file?.name ?? null, type: file?.type ?? null, bytes: file ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0) })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/upload`

    await db.connect()
    await cleanup(db)
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Attach engine', 'attach-engine'), ($2, 'Attach other', 'attach-other')`, [TENANT, OTHER])
    for (const [id, tenant] of [[WF, TENANT], [WF_OTHER, OTHER]]) {
      await db.query(
        `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'Attachments', true, 'manual', $3::jsonb, $4::jsonb)`,
        [id, tenant, JSON.stringify(nodes(endpoint)), JSON.stringify(edges)],
      )
    }

    // Two uploaded files (as lib/services/form-files stores them).
    const { getStorageProvider } = await import('@/lib/providers/storage')
    const { presentFormFile } = await import('@/lib/services/form-files')
    const storage = await getStorageProvider()
    expect(storage.id).toBe('local')
    const pdf = Buffer.from('%PDF-1.7\nreceipt one\n%%EOF\n')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    for (const [id, name, mime, bytes] of [[FILE_A, 'taxi receipt.pdf', 'application/pdf', pdf], [FILE_B, 'lunch.png', 'image/png', png]] as const) {
      const key = `${TENANT}/form-test/${id}/${name.replace(/ /g, '-')}`
      await storage.put('form-files', key, bytes, { contentType: mime })
      const { rows: [row] } = await db.query(
        `INSERT INTO public.form_files (id, tenant_id, storage_key, name, size, mime_type, checksum_sha256, context_kind, field_key, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'form', 'receipts', 'bound', now()) RETURNING *`,
        [id, TENANT, key, name, bytes.byteLength, mime, createHash('sha256').update(bytes).digest('hex')],
      )
      files.push(presentFormFile(row))
    }
  })

  afterAll(async () => {
    await cleanup(db).catch(() => undefined)
    await db.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    await rm(storageRoot, { recursive: true, force: true })
    await rm(mailDir, { recursive: true, force: true })
  })

  it('logs each file, posts each as a multipart part, and emails them all', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const result = await executeWorkflow(WF, undefined, false, { files }, undefined, undefined, undefined, { supabase })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe('completed')

    // HTTP: one multipart request per file, with its bytes, name and type.
    expect(received.map((r) => [r.name, r.fileName, r.type])).toEqual([
      ['taxi receipt.pdf', 'taxi receipt.pdf', 'application/pdf'],
      ['lunch.png', 'lunch.png', 'image/png'],
    ])
    expect(received[0].bytes.toString()).toContain('receipt one')

    // Logs: names and sizes.
    const { rows: logs } = await db.query(`SELECT message, metadata FROM public.workflow_logs WHERE tenant_id = $1 ORDER BY created_at`, [TENANT])
    const text = logs.map((l) => `${l.message} ${JSON.stringify(l.metadata ?? {})}`).join('\n')
    expect(text).toContain('File taxi receipt.pdf (')
    expect(text).toContain('File lunch.png (12 bytes)')

    // Email: both files attached (console provider writes the .eml).
    expect(result.node_results.mail?.output).toMatchObject({ sent: true, attachments: [{ name: 'taxi receipt.pdf' }, { name: 'lunch.png', size: 12 }] })
    const [eml] = await readdir(mailDir)
    const message = await readFile(path.join(mailDir, eml), 'utf8')
    expect(message).toMatch(/Content-Type: multipart\/mixed/)
    expect(message).toContain('Content-Disposition: attachment; filename="taxi receipt.pdf"')
    expect(message).toContain('filename="lunch.png"')
    expect(message).toContain(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64'))
  })

  it('deleting the task deletes its files (FK set NULL → cleanup removes row and object)', async () => {
    const { getStorageProvider } = await import('@/lib/providers/storage')
    const { purgeFormFiles } = await import('@/lib/services/form-files')
    const storage = await getStorageProvider()
    const { rows: [task] } = await db.query(`INSERT INTO public.tasks (tenant_id, title) VALUES ($1, 'Claim') RETURNING id`, [TENANT])
    const id = '0d5e0000-0000-4000-8000-0000000000fc'
    const key = `${TENANT}/task-${task.id}/${id}/scan.pdf`
    await storage.put('form-files', key, Buffer.from('%PDF-1.4\n%%EOF'), { contentType: 'application/pdf' })
    await db.query(
      `INSERT INTO public.form_files (id, tenant_id, storage_key, name, size, mime_type, checksum_sha256, context_kind, task_id, field_key, status)
       VALUES ($1, $2, $3, 'scan.pdf', 14, 'application/pdf', $4, 'task', $5, 'receipts', 'bound')`,
      [id, TENANT, key, '0'.repeat(64), task.id],
    )
    // (The purge is instance-wide: assert on this row, not on counts.)
    await purgeFormFiles({ supabase: supabase as never })
    expect((await db.query('SELECT 1 FROM public.form_files WHERE id = $1', [id])).rowCount).toBe(1)
    await db.query('DELETE FROM public.tasks WHERE id = $1', [task.id])
    const { rows: [orphan] } = await db.query('SELECT task_id, submission_id, status FROM public.form_files WHERE id = $1', [id])
    expect(orphan).toEqual({ task_id: null, submission_id: null, status: 'bound' })
    expect((await purgeFormFiles({ supabase: supabase as never })).deleted).toBeGreaterThanOrEqual(1)
    expect((await db.query('SELECT 1 FROM public.form_files WHERE id = $1', [id])).rowCount).toBe(0)
    expect(await storage.head('form-files', key)).toBeNull()
  })

  it("a run in another workspace can't read this workspace's files", async () => {
    received.length = 0
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const result = await executeWorkflow(WF_OTHER, undefined, false, { files }, undefined, undefined, undefined, { supabase })
    expect(result.status).toBe('failed')
    expect(received).toHaveLength(0)
    expect(JSON.stringify(result.node_results)).toMatch(/could not be read \(HTTP 404\)/)
  })
})
