/**
 * The form wizard against a LOCAL Supabase stack (migration
 * 20261229000000_form_wizard.sql, lib/services/form-wizard.ts,
 * lib/services/form-wizard-policy.ts). Runs only when EVENT_STREAM_DB_URL is
 * set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-wizard-db.test.ts
 *
 * - seed_tenant_roles: forms.wizard for Owner, Admin, Manager and Member, not Viewer;
 * - a Member's create makes the table, form, published workflow, grants,
 *   reports and the project, all created_by the member;
 * - form_wizard_projects RLS: own rows only, no end-user writes;
 * - submit-time policy: one response per person, closed forms;
 * - update keeps data and adds columns.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import { createWizardForm, updateWizardForm } from '@/lib/services/form-wizard'
import { submitForm } from '@/lib/services/form-submissions'
import { SYSTEM_ROLES } from '@/lib/tenant-provisioning'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const T = 'f12a0000-0000-4000-8000-0000000000a1'
const uid = (n: number) => `f12a${n.toString(16).padStart(4, '0')}-0000-4000-8000-0000000000f1`
const MEMBER = uid(1)
const OTHER = uid(2)
const APPROVER = uid(3)
const USERS = [MEMBER, OTHER, APPROVER]
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('form wizard (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const pgq = createPgQuery({ pool, maxRows: 1000 })
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const memberPerms = SYSTEM_ROLES.find((r) => r.slug === 'member')!.permissions
  const apiCtx = (actorId: string): ServiceContext => ({ db: admin as any, supabase: admin as any, tenantId: T, actorId, permissions: new Set(memberPerms), authKind: 'api_key', source: 'api', keyType: 'user' })
  const sessionClient = (actorId: string) => pgq.client({ role: 'authenticated', claims: { sub: actorId, role: 'authenticated', aud: 'authenticated' } }) as any

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const table of ['form_wizard_projects', 'object_permissions', 'reports', 'workflow_queue', 'workflow_runs', 'workflows', 'form_submissions', 'forms', 'custom_table_rows', 'custom_tables']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [T]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[T, ...personal.filter((t: string | null) => t && t !== T)]])
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Wizard DB', 'wizard-db-test')`, [T])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `w${user.slice(4, 8)}.${Date.now().toString(36)}@wizard-db.test`])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, T])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, T, `User ${user.slice(4, 8)}`])
      const role = (await q(`SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = 'member'`, [T]))[0].id
      await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [T, user, role])
    }
  })

  afterAll(async () => {
    await cleanup()
    await db.end()
    await pool.end()
  })

  it('seeds forms.wizard for Owner, Admin, Manager and Member, not Viewer', async () => {
    const rows = await q(`SELECT slug, 'forms.wizard' = ANY (permissions) AS has FROM public.roles WHERE tenant_id = $1 AND is_system ORDER BY slug`, [T])
    expect(Object.fromEntries(rows.map((r: any) => [r.slug, r.has]))).toEqual({ admin: true, manager: true, member: true, owner: true, viewer: false })
  })

  let created: Awaited<ReturnType<typeof createWizardForm>>
  it('a Member creates the form, table, published workflow, grants, reports and project — owned by them', async () => {
    created = await createWizardForm(apiCtx(MEMBER), {
      name: 'Wizard DB request',
      questions: [{ id: 'q1', kind: 'short_text', label: 'What do you need?', required: true }, { id: 'q2', kind: 'choice', label: 'Category', options: ['A', 'B'] }],
      approval: { mode: 'single', stages: [{ id: 's1', name: 'Approval', assignee: { kind: 'person', user_id: APPROVER } }] },
      audience: { internal: true, who: 'everyone', multiple_responses: false },
    })
    const m = created.manifest
    expect((await q('SELECT created_by FROM public.custom_tables WHERE id = $1', [m.table_id]))[0].created_by).toBe(MEMBER)
    expect((await q('SELECT created_by, tags FROM public.forms WHERE id = $1', [m.form_id]))[0]).toEqual({ created_by: MEMBER, tags: ['wizard'] })
    const wf = (await q('SELECT created_by, is_active, published_version_id, trigger_type FROM public.workflows WHERE id = $1', [m.workflow_id]))[0]
    expect(wf).toMatchObject({ created_by: MEMBER, is_active: true, trigger_type: 'form_submitted' })
    expect(wf.published_version_id).toBeTruthy()
    expect((await q(`SELECT count(*)::int AS n FROM public.object_permissions WHERE object_type = 'form' AND object_id = $1`, [m.form_id]))[0].n).toBeGreaterThan(0)
    expect((await q('SELECT count(*)::int AS n FROM public.reports WHERE id = ANY($1::uuid[]) AND created_by = $2 AND NOT is_shared', [m.report_ids, MEMBER]))[0].n).toBe(m.report_ids.length)
    expect((await q('SELECT owner_id, status, form_id FROM public.form_wizard_projects WHERE id = $1', [created.project.id]))[0]).toEqual({ owner_id: MEMBER, status: 'created', form_id: m.form_id })
  })

  it('form_wizard_projects RLS: the owner reads their row, others do not; nobody writes', async () => {
    const own = await sessionClient(MEMBER).from('form_wizard_projects').select('id').eq('id', created.project.id)
    expect(own.data?.map((r: any) => r.id)).toEqual([created.project.id])
    const other = await sessionClient(OTHER).from('form_wizard_projects').select('id').eq('id', created.project.id)
    expect(other.data).toEqual([])
    const write = await sessionClient(MEMBER).from('form_wizard_projects').update({ name: 'x' }).eq('id', created.project.id)
    expect(write.error?.code).toBe('42501')
  })

  it('one response per person, and a closed form refuses responses', async () => {
    const key = created.project.spec as any
    const values = { [key.questions[0].key]: 'Laptop', [key.questions[1].key]: 'A' }
    const formId = created.manifest.form_id
    const first = await submitForm(apiCtx(OTHER), formId, { values }, { source: 'api' })
    expect(first.submission.id).toBeTruthy()
    await expect(submitForm(apiCtx(OTHER), formId, { values }, { source: 'api' })).rejects.toThrow(/already responded/)
    await q(`UPDATE public.form_wizard_projects SET spec = jsonb_set(spec, '{audience,closes_at}', to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id = $1`, [created.project.id])
    await expect(submitForm(apiCtx(MEMBER), formId, { values }, { source: 'api' })).rejects.toThrow(/closed/)
    await q(`UPDATE public.form_wizard_projects SET spec = spec #- '{audience,closes_at}' WHERE id = $1`, [created.project.id])
  })

  it('update keeps rows and existing columns and adds new ones; another member cannot update', async () => {
    await q(`INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, '{"what_do_you_need": "Kept"}')`, [T, created.manifest.table_id])
    const spec = { ...(created.project.spec as any), questions: [...(created.project.spec as any).questions, { id: 'q3', kind: 'date', label: 'Needed by' }] }
    await expect(updateWizardForm(apiCtx(OTHER), created.project.id, spec)).rejects.toThrow(/not found/)
    const updated = await updateWizardForm(apiCtx(MEMBER), created.project.id, spec)
    const columns = (await q('SELECT columns FROM public.custom_tables WHERE id = $1', [created.manifest.table_id]))[0].columns.map((c: any) => c.key)
    expect(columns).toEqual(expect.arrayContaining(['what_do_you_need', 'category', 'status', 'needed_by']))
    expect((await q(`SELECT count(*)::int AS n FROM public.custom_table_rows WHERE table_id = $1 AND data->>'what_do_you_need' = 'Kept'`, [created.manifest.table_id]))[0].n).toBe(1)
    expect((await q('SELECT version FROM public.forms WHERE id = $1', [created.manifest.form_id]))[0].version).toBe(2)
    expect((updated.project.spec as any).questions.map((x: any) => x.key)).toEqual(['what_do_you_need', 'category', 'needed_by'])
  })
})
