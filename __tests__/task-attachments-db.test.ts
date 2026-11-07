/**
 * Task attachments (lib/services/task-attachments.ts) against a LOCAL
 * Supabase stack with real Supabase Storage: upload validation (type by
 * content, blocked types, size), direct uploads, forged storage refs,
 * signed-URL download auth, audit rows and timeline events, delete rules,
 * legal hold and retention, cleanup, the "Add task attachment" step and
 * `{{task.attachments}}` in a Loop with a document read.
 *
 * Runs only when EVENT_STREAM_DB_URL is set. Rows are committed (the
 * services use their own connections) and deleted after.
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

const T = '0d5e0000-0000-4000-8000-0000000007a1'
const T2 = '0d5e0000-0000-4000-8000-0000000007a2'
const U = {
  assignee: '0d5e0000-0000-4000-8000-0000000007b1',
  viewer: '0d5e0000-0000-4000-8000-0000000007b2',
  outsider: '0d5e0000-0000-4000-8000-0000000007b3',
  admin: '0d5e0000-0000-4000-8000-0000000007b4',
  other: '0d5e0000-0000-4000-8000-0000000007b5',
}
const TASK = '0d5e0000-0000-4000-8000-0000000007c1'
const CLOSED = '0d5e0000-0000-4000-8000-0000000007c2'
const TASK2 = '0d5e0000-0000-4000-8000-0000000007c3'
const FORM = '0d5e0000-0000-4000-8000-0000000007d1'
const WF = '0d5e0000-0000-4000-8000-0000000007e1'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

let supabase: SupabaseClient
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => supabase }))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => supabase }))
vi.mock('@/lib/providers/storage', async (orig) => {
  const actual = await orig() as any
  const { createSupabaseStorageProvider } = await import('@/lib/providers/storage/supabase')
  return { ...actual, getStorageProvider: async () => createSupabaseStorageProvider(() => supabase as any) }
})

const PERMS: Record<keyof typeof U, string[]> = {
  assignee: ['tasks.view_own', 'tasks.complete'],
  viewer: ['tasks.view_own', 'tasks.view_all'],
  outsider: ['tasks.view_own', 'tasks.complete'],
  admin: ['tasks.view_own', 'tasks.view_all', 'tasks.complete', 'tasks.delete'],
  other: ['tasks.view_own', 'tasks.view_all', 'tasks.complete', 'tasks.delete'],
}

const ctx = (who: keyof typeof U, tenantId = who === 'other' ? T2 : T): ServiceContext => ({
  supabase: supabase as any, db: supabase as any, tenantId, actorId: U[who], permissions: new Set(PERMS[who]), authKind: 'api_key', source: 'api',
})

describe.skipIf(!DB_URL)('task attachments service', () => {
  const db = new Client({ connectionString: DB_URL })
  let svc: typeof import('@/lib/services/task-attachments')

  async function cleanup() {
    const { rows } = await db.query('SELECT storage_key FROM public.task_attachments WHERE tenant_id = ANY($1)', [[T, T2]])
    if (rows.length && supabase) await supabase.storage.from('form-files').remove(rows.map((r) => r.storage_key))
    await db.query(`DELETE FROM public.task_attachment_purges WHERE storage_key LIKE $1 OR storage_key LIKE $2`, [`${T}/%`, `${T2}/%`])
    for (const table of ['object_audit_log', 'lifecycle_events', 'workflow_logs', 'workflow_runs', 'workflows', 'task_attachments', 'tasks', 'forms', 'user_memberships']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = ANY($1)`, [[T, T2]]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.users WHERE id = ANY($1)', [Object.values(U)])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1)', [[T, T2]])
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ||= 'a'.repeat(64)
    await db.connect()
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Attach A', 'ta-svc-a'), ($2, 'Attach B', 'ta-svc-b')`, [T, T2])
    for (const [k, id] of Object.entries(U)) {
      const tenant = k === 'other' ? T2 : T
      await db.query(`INSERT INTO public.users (id, tenant_id, email, display_name) VALUES ($1, $2, $3, $4)`, [id, tenant, `${k}@ta-svc.test`, k])
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role, is_active) VALUES ($1, $2, 'member', true)`, [id, tenant])
    }
    await db.query(`INSERT INTO public.forms (id, tenant_id, name) VALUES ($1, $2, 'Contract form')`, [FORM, T])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id, metadata) VALUES ($1, $2, 'Review contract', $3, $4)`, [TASK, T, U.assignee, { form_ref: { form_id: FORM } }])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id, status, metadata) VALUES ($1, $2, 'Old', $3, 'completed', $4)`, [CLOSED, T, U.assignee, { form_ref: { form_id: FORM } }])
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assignee_id) VALUES ($1, $2, 'B task', $3)`, [TASK2, T2, U.other])
    svc = await import('@/lib/services/task-attachments')
  }, 60_000)
  afterAll(async () => { await cleanup(); await db.end() })

  let png: Awaited<ReturnType<typeof import('@/lib/services/task-attachments').addTaskAttachment>>

  it('the assignee attaches a file: stored, verified, audited, on the timeline', async () => {
    png = await svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, name: ' Site photo ', type: 'image', description: 'Front door', file_name: 'door.png', bytes: new Uint8Array(PNG) })
    expect(png).toMatchObject({ name: 'Site photo', type: 'Image', description: 'Front door', file_name: 'door.png', mime: 'image/png', size: PNG.byteLength, uploaded_by: U.assignee })
    expect(png.storage_ref).toBe(`storage://form-files/${T}/attachment-${TASK}/${png.id}/door.png`)
    expect(png.url).toMatch(new RegExp(`/attachments/${png.id}$`))
    const { rows: [row] } = await db.query('SELECT status, form_id, checksum_sha256 FROM public.task_attachments WHERE id = $1', [png.id])
    expect(row).toMatchObject({ status: 'ready', form_id: FORM })
    expect(row.checksum_sha256).toMatch(/^[0-9a-f]{64}$/)
    const { data } = await supabase.storage.from('form-files').download(`${T}/attachment-${TASK}/${png.id}/door.png`)
    expect(data?.size).toBe(PNG.byteLength)
    const { rows: audit } = await db.query(`SELECT actor_id, action, metadata FROM public.object_audit_log WHERE tenant_id = $1 AND object_id = $2 AND action = 'attachment_add'`, [T, TASK])
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor_id: U.assignee, metadata: expect.objectContaining({ attachment_id: png.id, file_name: 'door.png' }) })
    const { rows: events } = await db.query(`SELECT event_type FROM public.lifecycle_events WHERE task_id = $1`, [TASK])
    expect(events.map((e) => e.event_type)).toContain('attachment_added')
  })

  it('upload validation: content must match the name, blocked types and sizes are refused, fields are checked', async () => {
    const exe = new Uint8Array(64); exe[0] = 0x4d; exe[1] = 0x5a
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'invoice.pdf', bytes: exe })).rejects.toMatchObject({ status: 415 })
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'tool.exe', bytes: exe })).rejects.toMatchObject({ status: 415 })
    await expect(svc.initTaskAttachmentUpload(ctx('assignee'), { task_id: TASK, file_name: 'run.bat', size: 10 })).rejects.toMatchObject({ status: 415 })
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'empty.pdf', bytes: new Uint8Array(0) })).rejects.toThrow(/empty/)
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'a.pdf', type: 'x'.repeat(61), bytes: new Uint8Array(PDF) })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'a.pdf', bytes: new Uint8Array(PDF), declared_size: PDF.byteLength + 5 })).rejects.toThrow(/incomplete/)
    const before = process.env.FORM_ATTACHMENT_MAX_MB
    process.env.FORM_ATTACHMENT_MAX_MB = '0.1'
    try {
      await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'big.pdf', bytes: new Uint8Array(200 * 1024) })).rejects.toMatchObject({ status: 413 })
      await expect(svc.initTaskAttachmentUpload(ctx('assignee'), { task_id: TASK, file_name: 'big.pdf', size: 200 * 1024 })).rejects.toMatchObject({ status: 413 })
    } finally {
      if (before === undefined) delete process.env.FORM_ATTACHMENT_MAX_MB
      else process.env.FORM_ATTACHMENT_MAX_MB = before
    }
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.task_attachments WHERE task_id = $1', [TASK])
    expect(rows[0].n).toBe(1)
  })

  it('a direct upload: signed URL → PUT → complete (verified server-side)', async () => {
    const started = await svc.initTaskAttachmentUpload(ctx('assignee'), { task_id: TASK, name: 'Contract', type: 'Contract', file_name: 'contract.pdf', size: PDF.byteLength })
    if (started.mode !== 'direct') throw new Error('expected direct')
    expect((await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: PDF })).status).toBe(200)
    // Not listed until complete.
    expect((await svc.listTaskAttachments(ctx('viewer'), TASK)).attachments.map((a) => a.id)).not.toContain(started.attachment_id)
    // Only the uploader completes it.
    await expect(svc.completeTaskAttachmentUpload(ctx('admin'), started.attachment_id)).rejects.toMatchObject({ code: 'not_found' })
    const done = await svc.completeTaskAttachmentUpload(ctx('assignee'), started.attachment_id)
    expect(done).toMatchObject({ name: 'Contract', type: 'Contract', mime: 'application/pdf', size: PDF.byteLength })
  })

  it('who sees and adds: viewer reads (view only), outsiders and other workspaces get 404, closed tasks refuse adds', async () => {
    const list = await svc.listTaskAttachments(ctx('viewer'), TASK)
    expect(list.attachments.map((a) => a.name)).toEqual(['Site photo', 'Contract'])
    expect(list.can_add).toBe(false)
    expect(list.attachments.every((a) => a.can_delete === false)).toBe(true)
    expect(list.attachments[0].uploaded_by_name).toBe('assignee')
    await expect(svc.addTaskAttachment(ctx('viewer'), { task_id: TASK, file_name: 'x.png', bytes: new Uint8Array(PNG) })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(svc.listTaskAttachments(ctx('outsider'), TASK)).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.addTaskAttachment(ctx('outsider'), { task_id: TASK, file_name: 'x.png', bytes: new Uint8Array(PNG) })).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.listTaskAttachments(ctx('other'), TASK)).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.addTaskAttachment(ctx('assignee'), { task_id: CLOSED, file_name: 'x.png', bytes: new Uint8Array(PNG) })).rejects.toMatchObject({ code: 'conflict' })
    const mine = await svc.listTaskAttachments(ctx('assignee'), TASK)
    expect(mine.can_add).toBe(true)
    expect(mine.attachments.every((a) => a.can_delete)).toBe(true)
  })

  it('forged storage refs never read another workspace\'s (or a missing) file', async () => {
    const { readWorkflowFile } = await import('@/lib/services/form-files')
    expect((await readWorkflowFile(supabase as any, T, png.storage_ref))?.bytes.byteLength).toBe(PNG.byteLength)
    expect((await readWorkflowFile(supabase as any, T, png))?.name).toBe('door.png')
    expect((await readWorkflowFile(supabase as any, T, png.url))?.mime_type).toBe('image/png')
    // The same refs for a run of another workspace: not found.
    expect(await readWorkflowFile(supabase as any, T2, png.storage_ref)).toBeNull()
    expect(await readWorkflowFile(supabase as any, T2, png)).toBeNull()
    // A key under this tenant's prefix that no row owns.
    expect(await readWorkflowFile(supabase as any, T, `storage://form-files/${T}/attachment-${TASK}/${'0'.repeat(8)}-0000-4000-8000-000000000000/door.png`)).toBeNull()
  })

  it('downloads: signed links serve without a session, tampering is 404, sessions are authorised and audited', async () => {
    const { serveFormFileDownload } = await import('@/lib/services/form-file-download')
    const { loadFormFile, authorizeFileDownload, openFormFileObject } = await import('@/lib/services/form-files')
    const deps = (who: keyof typeof U | null) => ({
      load: async (id: string) => (await loadFormFile(supabase as any, id)) ?? svc.loadTaskAttachmentDownload(supabase as any, id),
      session: async () => (who ? { ...ctx(who), authKind: 'session' as const, source: 'ui' as const } : null),
      authorize: (c: ServiceContext, row: any) => (svc.isTaskAttachmentDownload(row) ? svc.authorizeTaskAttachmentDownload(c, row) : authorizeFileDownload(c, row)),
      open: openFormFileObject,
    })
    const link = await svc.taskAttachmentDownloadUrl(ctx('viewer'), TASK, png.id)
    expect(link.url).toMatch(/expires=\d+&signature=/)
    const path = new URL(link.url, 'http://localhost').pathname + new URL(link.url, 'http://localhost').search
    const signed = await serveFormFileDownload(new Request(`http://localhost${path}`), png.id, deps(null))
    expect(signed.status).toBe(200)
    expect(signed.headers.get('content-disposition')).toContain('door.png')
    expect(Buffer.from(await signed.arrayBuffer()).equals(PNG)).toBe(true)
    const tampered = await serveFormFileDownload(new Request(`http://localhost${path.replace(/signature=[^&]+/, 'signature=forged')}`), png.id, deps(null))
    expect(tampered.status).toBe(404)
    const anon = await serveFormFileDownload(new Request(`http://localhost/attachments/${png.id}`), png.id, deps(null))
    expect(anon.status).toBe(401)
    const outsider = await serveFormFileDownload(new Request(`http://localhost/attachments/${png.id}`), png.id, deps('outsider'))
    expect(outsider.status).toBe(404)
    const viewer = await serveFormFileDownload(new Request(`http://localhost/attachments/${png.id}`), png.id, deps('viewer'))
    expect(viewer.status).toBe(302)
    expect(viewer.headers.get('location')).toMatch(/signature=/)
    const { rows } = await db.query(`SELECT actor_id FROM public.object_audit_log WHERE tenant_id = $1 AND object_id = $2 AND action = 'attachment_download'`, [T, TASK])
    expect(rows.map((r) => r.actor_id)).toEqual([U.viewer, U.viewer])
    await expect(svc.taskAttachmentDownloadUrl(ctx('outsider'), TASK, png.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('delete: not a viewer; the uploader or tasks.delete; never under legal hold; audited', async () => {
    const extra = await svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, name: 'Receipt', type: 'Receipt', file_name: 'r.pdf', bytes: new Uint8Array(PDF) })
    await expect(svc.deleteTaskAttachment(ctx('viewer'), TASK, extra.id)).rejects.toMatchObject({ code: 'forbidden' })
    await db.query('UPDATE public.forms SET legal_hold = true WHERE id = $1', [FORM])
    try {
      await expect(svc.deleteTaskAttachment(ctx('admin'), TASK, extra.id)).rejects.toMatchObject({ code: 'conflict' })
      expect((await svc.listTaskAttachments(ctx('admin'), TASK)).legal_hold).toBe(true)
    } finally {
      await db.query('UPDATE public.forms SET legal_hold = false WHERE id = $1', [FORM])
    }
    expect(await svc.deleteTaskAttachment(ctx('admin'), TASK, extra.id)).toEqual({ deleted: true, id: extra.id })
    await expect(svc.deleteTaskAttachment(ctx('admin'), TASK, extra.id)).rejects.toMatchObject({ code: 'not_found' })
    const { rows } = await db.query(`SELECT actor_id FROM public.object_audit_log WHERE tenant_id = $1 AND action = 'attachment_delete'`, [T])
    expect(rows.map((r) => r.actor_id)).toEqual([U.admin])
    expect((await svc.listTaskAttachments(ctx('viewer'), TASK)).attachments.map((a) => a.id)).not.toContain(extra.id)
  })

  it('retention: the form\'s policy purges closed tasks\' attachments (open tasks keep theirs); legal hold blocks it', async () => {
    const old = await svc.addTaskAttachmentFromWorkflow(supabase as any, { tenantId: T, taskId: CLOSED, runId: null, fileName: 'old.pdf', bytes: new Uint8Array(PDF), name: 'Old', type: 'Evidence' })
    const future = new Date(Date.now() + 60_000).toISOString()
    await db.query('UPDATE public.forms SET legal_hold = true WHERE id = $1', [FORM])
    expect(await svc.purgeTaskAttachmentsForForm(supabase as any, { tenantId: T, formId: FORM, before: future })).toEqual({ held: true, attachments: 0 })
    await db.query('UPDATE public.forms SET legal_hold = false WHERE id = $1', [FORM])
    expect(await svc.purgeTaskAttachmentsForForm(supabase as any, { tenantId: T, formId: FORM, before: future })).toEqual({ held: false, attachments: 1 })
    expect((await db.query('SELECT 1 FROM public.task_attachments WHERE id = $1', [old.id])).rowCount).toBe(0)
    const { data } = await supabase.storage.from('form-files').download(`${T}/attachment-${CLOSED}/${old.id}/old.pdf`)
    expect(data).toBeNull()
    expect((await svc.listTaskAttachments(ctx('viewer'), TASK)).attachments.length).toBe(2)
  })

  it('cleanup: deleted past the window, abandoned uploads and deleted tasks\' objects are purged', async () => {
    const gone = await svc.addTaskAttachment(ctx('assignee'), { task_id: TASK, file_name: 'gone.pdf', bytes: new Uint8Array(PDF) })
    await svc.deleteTaskAttachment(ctx('assignee'), TASK, gone.id)
    const abandoned = await svc.initTaskAttachmentUpload(ctx('assignee'), { task_id: TASK, file_name: 'late.pdf', size: 10 })
    if (abandoned.mode !== 'direct') throw new Error('expected direct')
    await db.query(`UPDATE public.task_attachments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [abandoned.attachment_id])
    const cascaded = await svc.addTaskAttachmentFromWorkflow(supabase as any, { tenantId: T2, taskId: TASK2, runId: null, fileName: 'b.pdf', bytes: new Uint8Array(PDF) })
    await db.query('DELETE FROM public.tasks WHERE id = $1', [TASK2])
    process.env.TASK_ATTACHMENT_DELETED_RETENTION_DAYS = '0'
    try {
      const result = await svc.purgeTaskAttachments({ supabase: supabase as any })
      expect(result.expired).toBeGreaterThanOrEqual(1)
      expect(result.deleted).toBeGreaterThanOrEqual(1)
      expect(result.objects).toBeGreaterThanOrEqual(1)
    } finally {
      delete process.env.TASK_ATTACHMENT_DELETED_RETENTION_DAYS
    }
    expect((await db.query('SELECT 1 FROM public.task_attachments WHERE id = ANY($1)', [[gone.id, abandoned.attachment_id]])).rowCount).toBe(0)
    expect((await db.query('SELECT 1 FROM public.task_attachment_purges WHERE storage_key LIKE $1', [`${T2}/%`])).rowCount).toBe(0)
    const { data } = await supabase.storage.from('form-files').download(cascaded.storage_ref.replace('storage://form-files/', ''))
    expect(data).toBeNull()
  })

  it('workflow: Add Task Attachment step, then {{task.attachments}} in a Loop with Read Document', async () => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const nodes = [
      { id: 'start', type: 'manual', label: 'Start', config: {} },
      { id: 'attach', type: 'add_task_attachment', label: 'Attach notes', config: { file: 'data:text/plain;base64,' + Buffer.from('Inspection passed').toString('base64'), file_name: 'notes.txt', name: 'Inspection notes', type: 'Evidence', description: 'From {{who}}' } },
      { id: 'each', type: 'loop', label: 'Each attachment', config: { items: '{{task.attachments}}', item_var: 'item' } },
      { id: 'read', type: 'doc_read', label: 'Read', config: { source: '{{item}}', output_var: 'doc' } },
      { id: 'log', type: 'log', label: 'Log', config: { message: '{{item.name}} ({{item.type}}): {{doc_text}}' } },
    ]
    const edges = [
      { id: 'e1', source: 'start', target: 'attach' },
      { id: 'e2', source: 'attach', target: 'each' },
      { id: 'e3', source: 'each', target: 'read', label: 'each item' },
      { id: 'e4', source: 'read', target: 'log' },
    ]
    // The loop walks the attachments the task had when the run started: one text file.
    await db.query('DELETE FROM public.task_attachments WHERE task_id = $1', [TASK])
    await svc.addTaskAttachmentFromWorkflow(supabase as any, { tenantId: T, taskId: TASK, runId: null, fileName: 'terms.txt', bytes: new TextEncoder().encode('Net 30 days'), name: 'Contract terms', type: 'Contract' })
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'Attachments', true, 'manual', $3::jsonb, $4::jsonb)`, [WF, T, JSON.stringify(nodes), JSON.stringify(edges)])
    const run = await executeWorkflow(WF, TASK, false, { who: 'the inspector' }, undefined, undefined, undefined, { supabase })
    expect(run.error).toBeUndefined()
    expect(run.status).toBe('completed')
    expect(run.node_results.attach?.output).toMatchObject({ task_id: TASK, name: 'Inspection notes' })
    const { rows: [added] } = await db.query(`SELECT name, type, description, uploaded_by, run_id, mime_type FROM public.task_attachments WHERE task_id = $1 AND file_name = 'notes.txt'`, [TASK])
    expect(added).toMatchObject({ name: 'Inspection notes', type: 'Evidence', description: 'From the inspector', uploaded_by: null, mime_type: 'text/plain' })
    expect(added.run_id).toBe(run.run_id)
    expect(run.node_results.each?.output).toMatchObject({ count: 1, items: [expect.objectContaining({ name: 'Contract terms', type: 'Contract', file_name: 'terms.txt' })] })
    expect(run.node_results.read?.output).toMatchObject({ text_preview: 'Net 30 days' })
    expect(run.node_results.log?.output).toEqual({ logged: 'Contract terms (Contract): Net 30 days' })
  }, 60_000)
})
