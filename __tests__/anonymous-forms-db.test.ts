/**
 * Anonymous forms against a LOCAL Supabase stack (migration
 * 20261219000000_anonymous_forms.sql), through the service-role REST client:
 *  - form_anonymous_access has no client grants (anon / authenticated get
 *    42501 for every statement: the token is never readable via PostgREST);
 *  - form_submissions.source allows 'anonymous' (and nothing made up);
 *    form_files.upload_session must be a sha256 hex;
 *  - end to end: the workspace switch, the form's anonymous responses, the
 *    public link resolving, an anonymous submission stored with source
 *    'anonymous', no submitter and hashed abuse-review metadata, and the
 *    "Form submitted" workflow queued with a signed 'anonymous' initiator
 *    and no user; regenerating the link revokes the old one; turning the
 *    workspace switch off stops the new one.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/anonymous-forms-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import type { ServiceContext } from '@/lib/services/context'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `a0a0a19a-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const FORM = id(0x10)
const WORKFLOW = id(0x20)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('anonymous forms (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const staff = (tenantId: string): ServiceContext => ({ supabase: admin, db: admin, tenantId, actorId: null, permissions: new Set(['forms.view', 'forms.edit', 'forms.submit', 'settings.edit', 'settings.view']), authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, enc: process.env.ENCRYPTION_KEY }
  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0]
  let svc: typeof import('@/lib/services/anonymous-forms')

  async function cleanup() {
    for (const t of [A, B]) {
      for (const table of ['workflow_queue', 'form_files', 'form_submissions', 'form_anonymous_access', 'workflows', 'forms', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.ENCRYPTION_KEY = prev.enc || 'b'.repeat(64)
    svc = await import('@/lib/services/anonymous-forms')
    svc.anonymousDeps.serviceClient = async () => admin
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Anon A', 'anon-a-test'), ($2, 'Anon B', 'anon-b-test')`, [A, B])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name, fields, version) VALUES ($1, $2, 'Contact us', $3, 1)`,
      [FORM, A, JSON.stringify([{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'message', label: 'Message', type: 'textarea' }])])
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'On contact', 'form_submitted', '{}', $3, '[]', true)`,
      [WORKFLOW, A, JSON.stringify([{ id: 't', type: 'form_submitted', label: 'Form submitted', position: { x: 0, y: 0 }, config: { form_id: FORM } }])])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.ENCRYPTION_KEY = prev.enc
  })

  it('the schema: no client grants on the link table; the new source and upload key checks', async () => {
    await db.query(`INSERT INTO public.form_anonymous_access (form_id, tenant_id, token) VALUES ($1, $2, $3)`, [FORM, A, 'x'.repeat(43)])
    for (const role of ['anon', 'authenticated']) {
      for (const sql of ['SELECT token FROM public.form_anonymous_access', `UPDATE public.form_anonymous_access SET enabled = true`, 'DELETE FROM public.form_anonymous_access', `INSERT INTO public.form_anonymous_access (form_id, tenant_id, token) VALUES ('${FORM}', '${A}', '${'y'.repeat(43)}')`]) {
        await db.query('BEGIN')
        try {
          await db.query(`SET LOCAL ROLE ${role}`)
          await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id(0xdead), role })])
          await expect(db.query(sql), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' })
        } finally {
          await db.query('ROLLBACK')
        }
      }
    }
    await db.query('DELETE FROM public.form_anonymous_access WHERE form_id = $1', [FORM])
    await expect(db.query(`INSERT INTO public.form_anonymous_access (form_id, tenant_id, token) VALUES ($1, $2, 'short')`, [FORM, A])).rejects.toMatchObject({ code: '23514' })
    await expect(db.query(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, source) VALUES ($1, $2, 'x', 'bogus')`, [A, FORM])).rejects.toMatchObject({ code: '23514' })
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, source) VALUES ($1, $2, 'x', 'anonymous')`, [A, FORM])
    await db.query('ROLLBACK')
    await expect(db.query(`INSERT INTO public.form_files (tenant_id, storage_key, name, size, mime_type, checksum_sha256, context_kind, field_key, upload_session) VALUES ($1, 'k/anon-check', 'f', 1, 'text/plain', $2, 'form', 'files', 'not-a-hash')`, [A, '0'.repeat(64)])).rejects.toMatchObject({ code: '23514' })
  })

  it('end to end: switch, link, anonymous submission, trigger as anonymous; regenerate and switch off revoke', async () => {
    // The form can't be turned on before the workspace allows it.
    await expect(svc.setFormAnonymousAccess(staff(A), FORM, { enabled: true })).rejects.toMatchObject({ code: 'forbidden' })
    await svc.setAnonymousWorkspaceSettings(staff(A), { enabled: true })
    const access = await svc.setFormAnonymousAccess(staff(A), FORM, { enabled: true, settings: { min_fill_seconds: 0 } })
    expect(access.live).toBe(true)
    expect(access.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Another workspace can't see or change it.
    await expect(svc.getFormAnonymousAccess(staff(B), FORM)).rejects.toMatchObject({ code: 'not_found' })

    const resolved = await svc.resolveAnonymousForm(access.token)
    expect(resolved).toMatchObject({ formId: FORM, tenantId: A })
    const result = await svc.submitAnonymousForm(access.token!, { values: { name: 'Visitor', message: 'Hi' }, ticket: svc.issueTicket(FORM, Date.now() - 5_000) }, { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 test' })
    const row = await one('SELECT tenant_id, source, submitted_by, anonymous_meta, values FROM public.form_submissions WHERE id = $1', [result.submission.id])
    expect(row).toMatchObject({ tenant_id: A, source: 'anonymous', submitted_by: null, values: { name: 'Visitor', message: 'Hi' } })
    expect(row.anonymous_meta.ip_hash).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(row)).not.toContain('203.0.113.5')

    const job = await one('SELECT trigger_type, trigger_data FROM public.workflow_queue WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1', [WORKFLOW])
    expect(job.trigger_type).toBe('form_submitted')
    expect(job.trigger_data.submission).toMatchObject({ source: 'anonymous', submitted_by: { id: null, name: 'Anonymous', email: null } })
    expect(job.trigger_data._started_by).toMatchObject({ user_id: null, via: 'anonymous' })
    const { readQueuedInitiator } = await import('@/lib/workflow-initiator')
    expect(readQueuedInitiator(job.trigger_data, { tenantId: A, workflowId: WORKFLOW })).toEqual({ userId: null, via: 'anonymous' })

    const next = await svc.regenerateFormAnonymousToken(staff(A), FORM)
    expect(await svc.resolveAnonymousForm(access.token)).toBeNull()
    expect(await svc.resolveAnonymousForm(next.token)).not.toBeNull()
    await svc.setAnonymousWorkspaceSettings(staff(A), { enabled: false })
    expect(await svc.resolveAnonymousForm(next.token)).toBeNull()
  })
})
