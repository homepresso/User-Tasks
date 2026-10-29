/**
 * Form attachments service (lib/services/form-files.ts) with an in-memory
 * database and a local storage provider:
 *  - upload: authorisation per context (form page: forms.submit; task: the
 *    task's people; test run: workflows.edit), size limits (field + instance
 *    cap), content checks (magic bytes, dangerous types), SVG sanitising,
 *    storage path / private bucket, pending row bound to uploader + context;
 *  - submit / save: values rebuilt from the records — forged refs, other
 *    users' and other tenants' files, other contexts refused; `<key>_count`;
 *    binding to the submission / task;
 *  - downloads: the authorisation matrix and the /attachments route
 *    (sign-in, signed short-lived link, headers, tampering);
 *  - the engine's tenant-scoped read, and cleanup (expiry, draft binding,
 *    orphans after delete).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalStorageProvider } from '@/lib/providers/storage/local'
import type { StorageProvider } from '@/lib/providers/storage/types'
import { readAll } from '@/lib/providers/storage/types'
import { createMemorySupabase } from './fixtures/supabase-memory'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const OTHER_TENANT = u(2)
const FORM = u(10)
const OTHER_FORM = u(11)
const TASK = u(20)
const OTHER_TASK = u(21)
const WORKFLOW = u(30)
const ADA = u(40)
const BOB = u(41)
const EVE = u(42)

let db: any
let provider: StorageProvider
const roots: string[] = []

vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/providers/storage', async (orig) => ({ ...(await orig() as object), getStorageProvider: async () => provider }))
vi.mock('@/lib/reporting-lines', () => ({ loadReportingIndex: async () => ({}), isInManagerChain: () => false }))

const svc = await import('@/lib/services/form-files')
const { serveFormFileDownload } = await import('@/lib/services/form-file-download')
const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')

const enc = (text: string) => new TextEncoder().encode(text)
const PDF = enc('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3])
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])

const FIELDS = [
  { key: 'docs', label: 'Documents', type: 'attachments', required: true, attachments: { max_files: 3, max_file_mb: 1, types: ['documents', 'images'] } },
  { key: 'note', label: 'Note', type: 'text' },
  { key: 'scans', label: 'Scans', type: 'attachments', attachments: { max_files: 2, max_file_mb: 20, types: ['documents'] } },
]

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'ut-form-files-'))
  roots.push(root)
  provider = createLocalStorageProvider({ local_root: root })
  db = createMemorySupabase({
    forms: [
      { id: FORM, tenant_id: TENANT, name: 'Claim', fields: FIELDS, version: 1, buttons: null, layout: null, theme: null, header: null },
      { id: OTHER_FORM, tenant_id: TENANT, name: 'Other', fields: FIELDS, version: 1 },
      { id: u(12), tenant_id: OTHER_TENANT, name: 'Foreign', fields: FIELDS, version: 1 },
    ],
    tasks: [
      { id: TASK, tenant_id: TENANT, status: 'in_progress', is_workflow_task: true, event_id: 'ev', assignee_id: ADA, deleted_at: null, metadata: { fields: FIELDS, template_values: {} } },
      { id: OTHER_TASK, tenant_id: TENANT, status: 'in_progress', is_workflow_task: true, event_id: 'ev2', assignee_id: BOB, deleted_at: null, metadata: { fields: FIELDS, template_values: {} } },
      { id: u(22), tenant_id: TENANT, status: 'completed', is_workflow_task: true, event_id: 'ev3', assignee_id: ADA, deleted_at: null, metadata: { fields: FIELDS } },
    ],
    workflows: [{
      id: WORKFLOW, tenant_id: TENANT, nodes: [{ id: 'ut', type: 'user_task', config: { fields: FIELDS } }], published_version_id: null,
      user_variables: [
        { name: 'customerName', type: 'string' },
        { name: 'supportingDocs', type: 'array', format: 'attachments', required: true, label: 'Supporting docs', attachments: { max_files: 2, max_file_mb: 1, types: ['pdf'] } },
      ],
    }],
    task_assignees: [],
    user_teams: [],
    form_files: [],
    form_submissions: [],
    users: [{ id: ADA, display_name: 'Ada', email: 'ada@x' }],
    user_memberships: [],
  }, { uuids: true })
}
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }) })

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db, db, tenantId: TENANT, actorId: ADA, authKind: 'session', source: 'ui',
  permissions: new Set(['forms.submit', 'tasks.complete']), ...over,
})

const upload = (over: Partial<Parameters<typeof svc.uploadFormFile>[1]> = {}, c: ServiceContext = ctx()) =>
  svc.uploadFormFile(c, { context: { kind: 'form', formId: FORM }, field_key: 'docs', name: 'claim.pdf', bytes: PDF, declared_size: (over.bytes ?? PDF).byteLength, ...over })

describe('upload', () => {
  beforeEach(setup)

  it('stores a verified file privately and returns the value object (pending, bound to the uploader and form)', async () => {
    const file = await upload({ name: '../../Claim Q3 (final).pdf' })
    expect(file).toMatchObject({ name: 'Claim Q3 (final).pdf', size: PDF.byteLength, mime_type: 'application/pdf', uploaded_by: ADA })
    expect(file.url).toMatch(new RegExp(`/attachments/${file.id}$`))
    expect(file.storage_ref).toMatch(new RegExp(`^storage://form-files/${TENANT}/form-${FORM}/${file.id}/Claim-Q3-final-\\.pdf$`))
    expect(file.checksum_sha256).toMatch(/^[0-9a-f]{64}$/)
    const row = db.tables.form_files[0]
    expect(row).toMatchObject({ id: file.id, tenant_id: TENANT, status: 'pending', uploaded_by: ADA, context_kind: 'form', form_id: FORM, field_key: 'docs', scan_status: 'skipped' })
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
    const object = await provider.get('form-files', row.storage_key)
    expect(Buffer.from(await readAll(object!.body)).equals(Buffer.from(PDF))).toBe(true)
  })

  it('authorises by context: forms.submit, the task\'s people, workflows.edit for test runs; tenant-scoped', async () => {
    await expect(upload({}, ctx({ permissions: new Set(['forms.view']) }))).rejects.toThrow(/forms.submit/)
    await expect(upload({ context: { kind: 'form', formId: u(12) } })).rejects.toThrow(/Form not found/)
    await expect(upload({}, ctx({ actorId: null }))).rejects.toThrow(/signed-in/)
    await expect(upload({ field_key: 'note' })).rejects.toThrow(/no attachments field "note"/)
    // Tasks: the assignee yes; someone else's task no; closed tasks no.
    await expect(upload({ context: { kind: 'task', taskId: TASK } })).resolves.toMatchObject({ name: 'claim.pdf' })
    await expect(upload({ context: { kind: 'task', taskId: OTHER_TASK } })).rejects.toThrow(/cannot act on that task/)
    await expect(upload({ context: { kind: 'task', taskId: u(22) } })).rejects.toThrow(/closed/)
    // Designer test runs: workflows.edit and a User Task with the field.
    await expect(upload({ context: { kind: 'test', workflowId: WORKFLOW } })).rejects.toThrow(/workflows.edit/)
    await expect(upload({ context: { kind: 'test', workflowId: WORKFLOW } }, ctx({ permissions: new Set(['workflows.edit']) }))).resolves.toMatchObject({ mime_type: 'application/pdf' })
  })

  it('enforces sizes (field, instance cap, truncated bodies)', async () => {
    const big = new Uint8Array(1024 * 1024 + 10); big.set(PDF)
    await expect(upload({ bytes: big, declared_size: big.byteLength })).rejects.toMatchObject({ status: 413 })
    const mid = new Uint8Array(200 * 1024); mid.set(PDF)
    await expect(upload({ bytes: mid })).resolves.toMatchObject({ size: mid.byteLength })
    process.env.FORM_ATTACHMENT_MAX_MB = '0.1'
    try {
      await expect(upload({ bytes: mid })).rejects.toMatchObject({ status: 413 })
    } finally { delete process.env.FORM_ATTACHMENT_MAX_MB }
    await expect(upload({ declared_size: PDF.byteLength + 100 })).rejects.toThrow(/incomplete/)
    await expect(upload({ bytes: new Uint8Array() })).rejects.toThrow(/empty/)
  })

  it('checks content by magic bytes and blocks dangerous types', async () => {
    await expect(upload({ name: 'invoice.pdf', bytes: EXE })).rejects.toMatchObject({ status: 415, message: expect.stringMatching(/Programs/) })
    await expect(upload({ name: 'tool.exe', bytes: PDF })).rejects.toMatchObject({ status: 415 })
    await expect(upload({ name: 'page.txt', bytes: enc('<html><script>x</script></html>') })).rejects.toThrow(/HTML/)
    await expect(upload({ name: 'photo.png', bytes: PDF })).rejects.toThrow(/not a valid PNG/)
    await expect(upload({ name: 'sheet.csv', bytes: enc('a,b') })).rejects.toThrow(/not allowed here/)
    await expect(upload({ name: 'photo.png', bytes: PNG })).resolves.toMatchObject({ mime_type: 'image/png' })
  })

  it('sanitises SVG images', async () => {
    const file = await upload({ name: 'logo.svg', bytes: enc('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="1" height="1"/></svg>') })
    const row = db.tables.form_files.find((r: any) => r.id === file.id)
    const stored = new TextDecoder().decode(await readAll((await provider.get('form-files', row.storage_key))!.body))
    expect(stored).not.toMatch(/script|onload/)
    expect(stored).toMatch(/<rect/)
  })

  it('removes a pending upload for its uploader only', async () => {
    const file = await upload()
    await expect(svc.removePendingFormFile(ctx({ actorId: BOB }), file.id)).rejects.toThrow(/not found/)
    await expect(svc.removePendingFormFile(ctx(), file.id)).resolves.toEqual({ removed: true })
    expect(db.tables.form_files).toHaveLength(0)
    expect(await provider.head('form-files', `${TENANT}/form-${FORM}/${file.id}/claim.pdf`)).toBeNull()
  })
})

describe('submit / save: the value comes from the server', () => {
  beforeEach(setup)

  it('rebuilds a form submission\'s files from the records, adds the count; forged / foreign / other-context files are refused', async () => {
    const a = await upload()
    const b = await upload({ name: 'b.png', bytes: PNG })
    const forms = { kind: 'form' as const, formId: FORM, actorId: ADA }
    const meta = { fields: FIELDS, template_values: {} }
    // The client says a different name, size and link: ignored.
    const forged = [{ ...a, name: 'renamed.pdf', size: 1, url: 'https://evil.example/x', storage_ref: `storage://form-files/${OTHER_TENANT}/x` }, b]
    const ok = await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: forged }, { files: forms })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.docs).toEqual([a, b])
    expect(ok.templateValues.docs_count).toBe(2)

    // A forged dangerous name is refused outright.
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [{ ...a, name: 'evil.exe' }] }, { files: forms })).errors.docs).toMatch(/not an allowed file type/)
    const random = { ...a, id: u(999) }
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [random] }, { files: forms })).errors.docs).toMatch(/no longer available/)
    // Someone else's pending upload.
    const bobs = await upload({}, ctx({ actorId: BOB }))
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [bobs] }, { files: forms })).errors.docs).toMatch(/no longer available/)
    // Uploaded to another form.
    const other = await upload({ context: { kind: 'form', formId: OTHER_FORM } })
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [other] }, { files: forms })).errors.docs).toMatch(/no longer available/)
    // Another workspace (same id looked up in this tenant only).
    expect((await mergeTaskFieldValuesChecked(db, OTHER_TENANT, meta, { docs: [a] }, { files: forms })).errors.docs).toMatch(/no longer available/)
    // A string pretending to be files, and no upload context at all.
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: `storage://form-files/${TENANT}/x` }, { files: forms })).errors.docs).toBeTruthy()
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [a] }, {})).errors.docs).toMatch(/can't be attached here/)
  })

  it('submitForm binds the files to the stored submission', async () => {
    const { submitForm } = await import('@/lib/services/form-submissions')
    const a = await upload()
    db.rpc = async () => ({ data: 0, error: null })
    const result = await submitForm(ctx(), FORM, { values: { docs: [a], note: 'hi' } })
    const submission = db.tables.form_submissions[0]
    expect(submission.values.docs).toEqual([a])
    expect(submission.values.docs_count).toBe(1)
    expect(db.tables.form_files[0]).toMatchObject({ status: 'bound', submission_id: result.submission.id, expires_at: null })
    // A bound file can't be submitted again elsewhere.
    await expect(submitForm(ctx(), FORM, { values: { docs: [a] } })).rejects.toThrow(/no longer available/)
  })

  it('a task accepts its own uploads (any of its people) and refuses another task\'s', async () => {
    const mine = await upload({ context: { kind: 'task', taskId: TASK } })
    const theirs = await upload({ context: { kind: 'task', taskId: OTHER_TASK } }, ctx({ actorId: BOB }))
    const meta = { fields: FIELDS, template_values: {} }
    const ok = await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [mine] }, { partial: true, taskId: TASK })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues).toMatchObject({ docs: [mine], docs_count: 1 })
    const bad = await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [theirs] }, { partial: true, taskId: TASK })
    expect(bad.errors.docs).toMatch(/no longer available/)
    // Completion: required.
    const empty = await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [] }, { taskId: TASK })
    expect(empty.errors.docs).toMatch(/required/)
  })
})

describe('downloads', () => {
  beforeEach(setup)

  const permsCtx = (actorId: string, perms: string[] = [], tenantId = TENANT) => ctx({ actorId, tenantId, permissions: new Set(perms) })

  it('authorisation matrix', async () => {
    const pending = await upload()
    const rowOf = (id: string) => db.tables.form_files.find((r: any) => r.id === id)
    // Pending: only the uploader.
    expect(await svc.authorizeFileDownload(permsCtx(ADA), rowOf(pending.id))).toBe(true)
    expect(await svc.authorizeFileDownload(permsCtx(BOB, ['forms.edit', 'tasks.view_all']), rowOf(pending.id))).toBe(false)
    // Submitted: the submitter and forms.edit; nobody else; never another tenant.
    db.tables.form_submissions.push({ id: u(50), tenant_id: TENANT, form_id: FORM, submitted_by: ADA })
    await svc.bindFormFiles(db, TENANT, [pending.id], { submissionId: u(50) })
    expect(await svc.authorizeFileDownload(permsCtx(BOB, ['forms.edit']), rowOf(pending.id))).toBe(true)
    expect(await svc.authorizeFileDownload(permsCtx(EVE, ['forms.submit']), rowOf(pending.id))).toBe(false)
    expect(await svc.authorizeFileDownload(permsCtx(BOB, ['forms.edit'], OTHER_TENANT), rowOf(pending.id))).toBe(false)
    // A task's file: the assignee, view_all, queue managers; not other members.
    const taskFile = await upload({ context: { kind: 'task', taskId: TASK } })
    db.tables.form_files.find((r: any) => r.id === taskFile.id).uploaded_by = null
    await svc.bindFormFiles(db, TENANT, [taskFile.id], { taskId: TASK })
    expect(await svc.authorizeFileDownload(permsCtx(ADA), rowOf(taskFile.id))).toBe(true)
    expect(await svc.authorizeFileDownload(permsCtx(EVE, ['tasks.view_all']), rowOf(taskFile.id))).toBe(true)
    expect(await svc.authorizeFileDownload(permsCtx(EVE, ['tasks.manage_queue']), rowOf(taskFile.id))).toBe(true)
    expect(await svc.authorizeFileDownload(permsCtx(EVE, ['forms.edit']), rowOf(taskFile.id))).toBe(false)
    db.tables.task_assignees.push({ tenant_id: TENANT, task_id: TASK, user_id: EVE })
    expect(await svc.authorizeFileDownload(permsCtx(EVE), rowOf(taskFile.id))).toBe(true)
  })

  it('/attachments/<id>: sign-in, a short-lived signed link, attachment headers, tampering refused', async () => {
    const png = await upload({ name: 'photo.png', bytes: PNG })
    const pdf = await upload()
    const deps = (session: ServiceContext | null) => ({
      load: (id: string) => svc.loadFormFile(db, id),
      session: async () => session,
      authorize: svc.authorizeFileDownload,
      open: svc.openFormFileObject,
    })
    const req = (url: string, accept = '*/*') => new Request(`http://app.test${url}`, { headers: { accept } })

    expect((await serveFormFileDownload(req(`/attachments/${pdf.id}`), pdf.id, deps(null))).status).toBe(401)
    const login = await serveFormFileDownload(req(`/attachments/${pdf.id}`, 'text/html'), pdf.id, deps(null))
    expect(login.status).toBe(302)
    expect(login.headers.get('location')).toBe(`/login?redirect=${encodeURIComponent(`/attachments/${pdf.id}`)}`)
    expect((await serveFormFileDownload(req(`/attachments/${pdf.id}`), pdf.id, deps(ctx({ actorId: BOB })))).status).toBe(404)
    expect((await serveFormFileDownload(req(`/attachments/${u(777)}`), u(777), deps(ctx()))).status).toBe(404)

    process.env.ENCRYPTION_KEY = 'test-signing-key-for-attachments-0123456789'
    try {
      const redirect = await serveFormFileDownload(req(`/attachments/${pdf.id}`), pdf.id, deps(ctx()))
      expect(redirect.status).toBe(302)
      const location = redirect.headers.get('location')!
      expect(location).toMatch(new RegExp(`^/attachments/${pdf.id}\\?expires=\\d+&signature=`))
      const served = await serveFormFileDownload(req(location), pdf.id, deps(null))
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('application/pdf')
      expect(served.headers.get('content-disposition')).toMatch(/^attachment; filename="claim.pdf"/)
      expect(served.headers.get('x-content-type-options')).toBe('nosniff')
      expect(served.headers.get('content-security-policy')).toMatch(/sandbox/)
      expect(served.headers.get('cache-control')).toBe('private, no-store')
      expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(PDF))).toBe(true)
      // The signature names one file and expires.
      expect((await serveFormFileDownload(req(location), png.id, deps(null))).status).toBe(404)
      expect((await serveFormFileDownload(req(location.replace(/signature=./, 'signature=x')), pdf.id, deps(null))).status).toBe(404)
      expect((await serveFormFileDownload(req(location.replace(/expires=\d+/, 'expires=1000')), pdf.id, deps(null))).status).toBe(404)
      // Thumbnails: raster images inline when asked; a PDF never.
      const thumb = await serveFormFileDownload(req(`/attachments/${png.id}?inline=1`), png.id, deps(ctx()))
      const inline = await serveFormFileDownload(req(thumb.headers.get('location')!), png.id, deps(null))
      expect(inline.headers.get('content-disposition')).toMatch(/^inline;/)
      const pdfInline = await serveFormFileDownload(req(`${location}&inline=1`), pdf.id, deps(null))
      expect(pdfInline.headers.get('content-disposition')).toMatch(/^attachment;/)
    } finally {
      delete process.env.ENCRYPTION_KEY
    }
  })

  it('/files never serves the bucket, even signed', async () => {
    const { serveStorageFile } = await import('@/lib/storage/serve')
    const file = await upload()
    const key = db.tables.form_files[0].storage_key
    const res = await serveStorageFile(new Request(`http://app.test/files/form-files/${key}`), 'form-files', key.split('/'), { provider: async () => provider, sessionTenants: async () => [TENANT] })
    expect(res.status).toBe(404)
    expect(file.id).toBeTruthy()
  })
})

describe('workflow reads and cleanup', () => {
  beforeEach(setup)

  it('the engine reads a file for its own tenant only', async () => {
    const file = await upload()
    const read = await svc.readWorkflowFile(db, TENANT, file)
    expect(read).toMatchObject({ name: 'claim.pdf', mime_type: 'application/pdf', size: PDF.byteLength })
    expect(await svc.readWorkflowFile(db, TENANT, file.storage_ref)).toMatchObject({ name: 'claim.pdf' })
    expect(await svc.readWorkflowFile(db, TENANT, `/attachments/${file.id}`)).toMatchObject({ name: 'claim.pdf' })
    expect(await svc.readWorkflowFile(db, OTHER_TENANT, file)).toBeNull()
    expect(await svc.readWorkflowFile(db, OTHER_TENANT, file.storage_ref)).toBeNull()
    expect(svc.formFileTarget('https://elsewhere.example/attachments/' + file.id)).toBeNull()
    // fetchFile: form files need the run's tenant.
    const { fetchFile } = await import('@/lib/storage/files')
    expect((await fetchFile(file.storage_ref)).status).toBe(404)
    const res = await fetchFile(file.storage_ref, undefined, { tenantId: TENANT })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect((await fetchFile(file.storage_ref, undefined, { tenantId: OTHER_TENANT })).status).toBe(404)
    // A test run's task values: only the tester's own uploads survive.
    const sanitized = await svc.sanitizeTestTaskFiles(db, TENANT, ADA, { docs: [file, { ...file, id: u(888) }], note: 'x' })
    expect(sanitized).toEqual({ docs: [file], docs_count: 1, note: 'x' })
    expect(await svc.sanitizeTestTaskFiles(db, TENANT, BOB, { docs: [file] })).toEqual({ docs: [], docs_count: 0 })
  })

  it('storage connector uploads: a file input becomes the bytes (raw, multipart/form-data, multipart/related)', async () => {
    const file = await upload()
    const raw = await svc.readFormFileBody(file.url, TENANT)
    expect(raw).toMatchObject({ mime_type: 'application/pdf', name: 'claim.pdf' })
    expect(Buffer.from(raw!.bytes).equals(Buffer.from(PDF))).toBe(true)
    expect(await svc.readFormFileBody(JSON.stringify(file), TENANT)).toMatchObject({ name: 'claim.pdf' })
    expect(await svc.readFormFileBody('plain text body', TENANT)).toBeNull()
    await expect(svc.readFormFileBody(file.storage_ref, OTHER_TENANT)).rejects.toThrow(/not found/)

    // Box: { attributes, file } → multipart/form-data with the real file part.
    const box = await svc.buildFormFileMultipart(JSON.stringify({ attributes: { name: 'claim.pdf', parent: { id: '0' } }, file: file.url }), 'multipart/form-data', TENANT)
    const form = box!.body as FormData
    expect(box!.contentType).toBeNull()
    expect(JSON.parse(String(form.get('attributes')))).toEqual({ name: 'claim.pdf', parent: { id: '0' } })
    const part = form.get('file') as File
    expect(part.name).toBe('claim.pdf')
    expect(Buffer.from(await part.arrayBuffer()).equals(Buffer.from(PDF))).toBe(true)
    // Google Drive: metadata + media as multipart/related, MIME type filled in.
    const drive = await svc.buildFormFileMultipart(JSON.stringify({ name: 'claim.pdf', parents: ['f'], mimeType: 'application/octet-stream', content: file.storage_ref }), 'multipart/related', TENANT)
    expect(drive!.contentType).toMatch(/^multipart\/related; boundary=/)
    const text = new TextDecoder().decode(drive!.body as Uint8Array)
    expect(text).toContain('"mimeType":"application/pdf"')
    expect(text).toContain('Content-Type: application/pdf')
    expect(text).toContain('%PDF-1.7')
    expect(await svc.buildFormFileMultipart(JSON.stringify({ name: 'x', content: 'aGVsbG8=' }), 'multipart/related', TENANT)).toBeNull()
  })

  it('deletes expired pending uploads, binds a task draft\'s saved files, removes orphans after delete', async () => {
    const expired = await upload()
    const draft = await upload({ context: { kind: 'task', taskId: TASK } })
    const kept = await upload()
    const submitted = await upload()
    const past = new Date(Date.now() - 1000).toISOString()
    for (const row of db.tables.form_files) if (row.id !== kept.id && row.id !== submitted.id) row.expires_at = past
    db.tables.tasks[0].metadata.template_values = { docs: [draft] }
    // A submitted file whose submission (and task) were then deleted: FKs set NULL.
    await svc.bindFormFiles(db, TENANT, [submitted.id], { submissionId: u(60) })
    db.tables.form_files.find((r: any) => r.id === submitted.id).submission_id = null

    const result = await svc.purgeFormFiles({ supabase: db })
    expect(result).toEqual({ deleted: 2, bound: 1 })
    const ids = db.tables.form_files.map((r: any) => r.id).sort()
    expect(ids).toEqual([draft.id, kept.id].sort())
    expect(db.tables.form_files.find((r: any) => r.id === draft.id).status).toBe('bound')
    const keyOf = (f: any) => f.storage_ref.replace('storage://form-files/', '')
    expect(await provider.head('form-files', decodeURIComponent(keyOf(expired)))).toBeNull()
    expect(await provider.head('form-files', decodeURIComponent(keyOf(submitted)))).toBeNull()
    expect(await provider.head('form-files', decodeURIComponent(keyOf(kept)))).not.toBeNull()
  })
})

describe('direct-to-storage uploads (init → browser PUT → complete)', () => {
  // The local provider has no signed uploads; give it one for these tests (the PUT is simulated with put()).
  beforeEach(async () => {
    await setup()
    ;(provider as any).createUploadUrl = async (bucket: string, key: string, opts: { contentType: string; ttlSeconds: number }) =>
      ({ url: `https://store.test/${bucket}/${key}?ttl=${opts.ttlSeconds}`, method: 'PUT', headers: { 'Content-Type': opts.contentType } })
  })
  const init = (over: Partial<Parameters<typeof svc.initDirectUpload>[1]> = {}, c: ServiceContext = ctx()) =>
    svc.initDirectUpload(c, { context: { kind: 'form', formId: FORM }, field_key: 'docs', name: 'big scan.pdf', size: PDF.byteLength, ...over })
  const browserPut = async (fileId: string, bytes: Uint8Array) => {
    const row = db.tables.form_files.find((r: any) => r.id === fileId)
    await provider.put('form-files', row.storage_key, bytes, { contentType: 'application/octet-stream' })
  }

  it('init: authorised and limited like a server upload; an uploading row and a signed URL for one object', async () => {
    const started = await init()
    if (started.mode !== 'direct') throw new Error('expected a direct upload')
    expect(started.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } })
    expect(started.upload.url).toContain(`/form-files/${TENANT}/form-${FORM}/${started.file_id}/big-scan.pdf?ttl=900`)
    const row = db.tables.form_files.find((r: any) => r.id === started.file_id)
    expect(row).toMatchObject({ status: 'uploading', uploaded_by: ADA, size: PDF.byteLength, form_id: FORM })
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    await expect(init({ name: 'setup.exe' })).rejects.toMatchObject({ status: 415 })
    await expect(init({ name: 'sheet.xlsx' })).rejects.toMatchObject({ status: 415 })
    await expect(init({ size: 2 * 1024 * 1024 })).rejects.toMatchObject({ status: 413 })
    await expect(init({}, ctx({ permissions: new Set(['forms.view']) }))).rejects.toThrow(/forms.submit/)
    // An uploading file isn't usable yet: not submittable, not downloadable.
    const meta = { fields: FIELDS, template_values: {} }
    const pending = { id: started.file_id, name: 'big scan.pdf' }
    expect((await mergeTaskFieldValuesChecked(db, TENANT, meta, { docs: [pending] }, { files: { kind: 'form', formId: FORM, actorId: ADA } })).errors.docs).toMatch(/no longer available/)
    expect(await svc.authorizeFileDownload(ctx(), row)).toBe(false)
    // Providers without signed uploads: use the server path.
    delete (provider as any).createUploadUrl
    await expect(init()).resolves.toEqual({ mode: 'server', max_bytes: svc.streamedUploadMaxBytes() })
  })

  it('complete: reads the object back, verifies it, records the verified facts', async () => {
    const started = await init() as Extract<Awaited<ReturnType<typeof svc.initDirectUpload>>, { mode: 'direct' }>
    await browserPut(started.file_id, PDF)
    const file = await svc.completeDirectUpload(ctx(), started.file_id)
    expect(file).toMatchObject({ id: started.file_id, name: 'big scan.pdf', size: PDF.byteLength, mime_type: 'application/pdf' })
    expect(file.checksum_sha256).not.toBe('0'.repeat(64))
    const row = db.tables.form_files.find((r: any) => r.id === started.file_id)
    expect(row.status).toBe('pending')
    expect(new Date(row.expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
    // The object now carries the verified type.
    expect((await provider.head('form-files', row.storage_key))?.contentType).toBe('application/pdf')
    // Submittable now.
    const ok = await mergeTaskFieldValuesChecked(db, TENANT, { fields: FIELDS, template_values: {} }, { docs: [file] }, { files: { kind: 'form', formId: FORM, actorId: ADA } })
    expect(ok.errors).toEqual({})
    // Completing twice returns the same file.
    await expect(svc.completeDirectUpload(ctx(), started.file_id)).resolves.toMatchObject({ id: started.file_id })
  })

  it('a tampered upload (other content or size than announced) is deleted and refused', async () => {
    const exe = await init() as any
    await browserPut(exe.file_id, new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    const key = db.tables.form_files.find((r: any) => r.id === exe.file_id).storage_key
    await expect(svc.completeDirectUpload(ctx(), exe.file_id)).rejects.toThrow(/not the one that was announced|Programs/)
    expect(db.tables.form_files.find((r: any) => r.id === exe.file_id)).toBeUndefined()
    expect(await provider.head('form-files', key)).toBeNull()

    const sameSize = new Uint8Array(PDF.byteLength); sameSize.set([0x4d, 0x5a, 0x90])
    const swapped = await init() as any
    await browserPut(swapped.file_id, sameSize)
    await expect(svc.completeDirectUpload(ctx(), swapped.file_id)).rejects.toMatchObject({ status: 415, message: expect.stringMatching(/Programs/) })

    const big = new Uint8Array(1024 * 1024 + 100); big.set(PDF)
    const grown = await init() as any
    await browserPut(grown.file_id, big)
    await expect(svc.completeDirectUpload(ctx(), grown.file_id)).rejects.toMatchObject({ status: 413 })

    const missing = await init() as any
    await expect(svc.completeDirectUpload(ctx(), missing.file_id)).rejects.toThrow(/did not arrive/)
    expect(db.tables.form_files.find((r: any) => r.id === missing.file_id)).toBeUndefined()
  })

  it('an expired upload window, or someone else completing it, is refused', async () => {
    const late = await init() as any
    await browserPut(late.file_id, PDF)
    db.tables.form_files.find((r: any) => r.id === late.file_id).expires_at = new Date(Date.now() - 1000).toISOString()
    await expect(svc.completeDirectUpload(ctx(), late.file_id)).rejects.toMatchObject({ status: 410 })
    expect(db.tables.form_files.find((r: any) => r.id === late.file_id)).toBeUndefined()

    const mine = await init() as any
    await browserPut(mine.file_id, PDF)
    await expect(svc.completeDirectUpload(ctx({ actorId: BOB }), mine.file_id)).rejects.toThrow(/not found/)
    await expect(svc.completeDirectUpload(ctx({ tenantId: OTHER_TENANT }), mine.file_id)).rejects.toThrow(/not found/)
    expect(db.tables.form_files.find((r: any) => r.id === mine.file_id).status).toBe('uploading')
    // The uploader can still cancel it.
    await expect(svc.removePendingFormFile(ctx(), mine.file_id)).resolves.toEqual({ removed: true })
  })

  it('sanitises an SVG on complete (the object is rewritten) and the cleanup drops abandoned uploads', async () => {
    const svg = enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="2" height="2"/></svg>')
    const started = await init({ name: 'logo.svg', size: svg.byteLength }) as any
    await browserPut(started.file_id, svg)
    const file = await svc.completeDirectUpload(ctx(), started.file_id)
    expect(file.mime_type).toBe('image/svg+xml')
    const key = db.tables.form_files.find((r: any) => r.id === started.file_id).storage_key
    expect(new TextDecoder().decode(await readAll((await provider.get('form-files', key))!.body))).not.toMatch(/script/)

    const abandoned = await init() as any
    await browserPut(abandoned.file_id, PDF)
    db.tables.form_files.find((r: any) => r.id === abandoned.file_id).expires_at = new Date(Date.now() - 1000).toISOString()
    const abandonedKey = db.tables.form_files.find((r: any) => r.id === abandoned.file_id).storage_key
    await svc.purgeFormFiles({ supabase: db })
    expect(db.tables.form_files.find((r: any) => r.id === abandoned.file_id)).toBeUndefined()
    expect(await provider.head('form-files', abandonedKey)).toBeNull()
  })
})

describe('streamed path limits (local disk, any host)', () => {
  beforeEach(setup)

  it('FORM_UPLOAD_MAX_BODY_MB sets the streamed limit; Vercel caps it at 4 MB', () => {
    expect(svc.streamedUploadMaxBytes({})).toBe(50 * 1024 * 1024 - 64 * 1024)
    expect(svc.streamedUploadMaxBytes({ FORM_UPLOAD_MAX_BODY_MB: '200' })).toBe(200 * 1024 * 1024 - 64 * 1024)
    expect(svc.streamedUploadMaxBytes({ FORM_UPLOAD_MAX_BODY_MB: '200', VERCEL: '1' })).toBe(4 * 1024 * 1024 - 64 * 1024)
  })

  it('an 8 MB file goes through the app with local-disk storage; over the limit is refused with advice', async () => {
    const big = new Uint8Array(8 * 1024 * 1024).fill(0x20); big.set(PDF)
    // No signed uploads on local disk: init says "server".
    await expect(svc.initDirectUpload(ctx(), { context: { kind: 'form', formId: FORM }, field_key: 'scans', name: 'scan.pdf', size: big.byteLength })).resolves.toMatchObject({ mode: 'server' })
    const file = await upload({ field_key: 'scans', name: 'scan.pdf', bytes: big })
    expect(file).toMatchObject({ size: big.byteLength, mime_type: 'application/pdf' })
    process.env.FORM_UPLOAD_MAX_BODY_MB = '5'
    try {
      await expect(svc.initDirectUpload(ctx(), { context: { kind: 'form', formId: FORM }, field_key: 'scans', name: 'scan.pdf', size: big.byteLength })).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/direct uploads.*FORM_UPLOAD_MAX_BODY_MB/) })
      await expect(upload({ field_key: 'scans', name: 'scan.pdf', bytes: big })).rejects.toMatchObject({ status: 413 })
      // A body a proxy cut short (declared bigger than the limit).
      await expect(upload({ field_key: 'scans', name: 'scan.pdf', bytes: PDF, declared_size: big.byteLength })).rejects.toMatchObject({ status: 413 })
    } finally { delete process.env.FORM_UPLOAD_MAX_BODY_MB }
  })
})

describe('workflow start forms: attachments inputs', () => {
  beforeEach(setup)
  const startCtx = (over: Partial<ServiceContext> = {}) => ctx({ permissions: new Set(['workflows.activate']), ...over })
  const startUpload = (c: ServiceContext = startCtx(), over: Partial<Parameters<typeof svc.uploadFormFile>[1]> = {}) =>
    svc.uploadFormFile(c, { context: { kind: 'start', workflowId: WORKFLOW }, field_key: 'supportingDocs', name: 'id.pdf', bytes: PDF, declared_size: (over.bytes ?? PDF).byteLength, ...over })

  it('the input is a field keyed by the variable name, with its limits', async () => {
    expect(svc.startAttachmentFields(db.tables.workflows[0].user_variables)).toEqual([
      { key: 'supportingDocs', label: 'Supporting docs', type: 'attachments', required: true, attachments: { max_files: 2, max_file_mb: 1, types: ['pdf'] } },
    ])
    const { deriveInputFields, validateWorkflowInputs } = await import('@/lib/workflow-inputs')
    const fields = deriveInputFields(db.tables.workflows[0].user_variables)
    expect(fields[1]).toMatchObject({ key: 'supportingDocs', type: 'attachments', default: null })
    // Values: file objects, JSON text (the Run dialog) or file ids (API).
    expect(validateWorkflowInputs(fields, { supportingDocs: [u(5)] }).values.supportingDocs).toEqual([expect.objectContaining({ id: u(5), name: '' })])
    expect(validateWorkflowInputs(fields, { supportingDocs: JSON.stringify([{ id: u(6), name: 'a.pdf' }]) }).values.supportingDocs).toEqual([expect.objectContaining({ id: u(6), name: 'a.pdf' })])
    expect(validateWorkflowInputs(fields, { supportingDocs: [] }).errors[0]?.message).toMatch(/required/)
    expect(validateWorkflowInputs(fields, { supportingDocs: [{ nope: true }] }).ok).toBe(false)
  })

  it('uploads need workflows.activate; the start value is rebuilt from this person\'s uploads to this workflow', async () => {
    await expect(startUpload(ctx())).rejects.toThrow(/workflows.activate/)
    await expect(startUpload(startCtx(), { name: 'pic.png', bytes: PNG })).rejects.toMatchObject({ status: 415 })
    const mine = await startUpload()
    const bobs = await startUpload(startCtx({ actorId: BOB }))
    const formFile = await upload()
    const defs = svc.startAttachmentFields(db.tables.workflows[0].user_variables)
    const context = { kind: 'start' as const, workflowId: WORKFLOW, actorId: ADA }
    const ok = await svc.resolveAttachmentValues(db, TENANT, defs, { supportingDocs: [mine.id] }, context)
    expect(ok).toEqual({ errors: {}, values: { supportingDocs: [mine], supportingDocs_count: 1 } })
    for (const forged of [bobs.id, formFile.id, u(404)]) {
      expect((await svc.resolveAttachmentValues(db, TENANT, defs, { supportingDocs: [forged] }, context)).errors.supportingDocs).toMatch(/no longer available/)
    }
    // The run binds them (the engine, when the run row exists).
    await svc.bindStartRunFiles(db, TENANT, WORKFLOW, u(70), { supportingDocs: [mine], other: 'x' })
    expect(db.tables.form_files.find((r: any) => r.id === mine.id)).toMatchObject({ status: 'bound', run_id: u(70), expires_at: null })
    expect(db.tables.form_files.find((r: any) => r.id === bobs.id).status).toBe('pending')
    // Test starts (Save & Test) upload in the test context: the start form's field is found in the draft.
    const test = await svc.uploadFormFile(ctx({ permissions: new Set(['workflows.edit']) }), { context: { kind: 'test', workflowId: WORKFLOW }, field_key: 'supportingdocs', name: 't.pdf', bytes: PDF, declared_size: PDF.byteLength })
    expect(db.tables.form_files.find((r: any) => r.id === test.id)).toMatchObject({ context_kind: 'test', field_key: 'supportingDocs' })
  })
})

describe('API / MCP / CLI uploads', () => {
  beforeEach(setup)

  it('base64 content is checked and stored; the id then works as the field value', async () => {
    const result = await svc.apiUploadFile(ctx(), { form_id: FORM, field_key: 'docs', name: 'scan.pdf', content_base64: Buffer.from(PDF).toString('base64') })
    if (result.mode !== 'uploaded') throw new Error('expected uploaded')
    expect(result.file).toMatchObject({ name: 'scan.pdf', mime_type: 'application/pdf' })
    const merged = await mergeTaskFieldValuesChecked(db, TENANT, { fields: FIELDS, template_values: {} }, { docs: [result.file.id] }, { files: { kind: 'form', formId: FORM, actorId: ADA } })
    expect(merged.errors).toEqual({})
    expect(merged.templateValues.docs).toEqual([result.file])
    // Another user's API key can't use that id.
    expect((await mergeTaskFieldValuesChecked(db, TENANT, { fields: FIELDS, template_values: {} }, { docs: [result.file.id] }, { files: { kind: 'form', formId: FORM, actorId: BOB } })).errors.docs).toMatch(/no longer available/)
  })

  it('refuses tenant keys (no user), bad contexts, bad base64 and dangerous content', async () => {
    await expect(svc.apiUploadFile(ctx({ actorId: null }), { form_id: FORM, field_key: 'docs', name: 'a.pdf', content_base64: 'JVBERg==' })).rejects.toThrow(/user-bound/)
    await expect(svc.apiUploadFile(ctx(), { form_id: FORM, task_id: TASK, field_key: 'docs', name: 'a.pdf', content_base64: 'JVBERg==' })).rejects.toThrow(/exactly one/)
    await expect(svc.apiUploadFile(ctx(), { form_id: FORM, field_key: 'docs', name: 'a.pdf', content_base64: '%%%' })).rejects.toThrow(/base64/)
    await expect(svc.apiUploadFile(ctx(), { form_id: FORM, field_key: 'docs', name: 'a.pdf', content_base64: Buffer.from('MZ\x90\x00evil').toString('base64') })).rejects.toMatchObject({ status: 415 })
    await expect(svc.apiUploadFile(ctx(), { form_id: FORM, field_key: 'docs', name: 'a.pdf' })).rejects.toThrow(/content_base64, or size/)
    await expect(svc.apiUploadFile(ctx(), { task_id: OTHER_TASK, field_key: 'docs', name: 'a.pdf', content_base64: Buffer.from(PDF).toString('base64') })).rejects.toThrow(/cannot act/)
    // Size only → a direct upload plan (server mode on local disk).
    await expect(svc.apiUploadFile(ctx(), { form_id: FORM, field_key: 'docs', name: 'a.pdf', size: 100 })).resolves.toMatchObject({ mode: 'server' })
  })
})
