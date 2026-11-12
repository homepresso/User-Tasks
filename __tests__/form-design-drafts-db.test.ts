/**
 * Form drafts against a LOCAL Supabase stack (migration
 * 20270110000000_form_design_drafts.sql):
 *  - the tables: RLS on and no client access at all (authenticated / anon
 *    can't read or write drafts or reviewers, even in their own workspace);
 *    form_versions.note and notifications.form_id exist;
 *  - the service end to end through PostgREST: saving writes the draft and
 *    the published row is unchanged; sharing with a person and a team gives
 *    a preview (enforced in the service: an outsider and a non-reviewer get
 *    404); publishing bumps the version, snapshots it with the note, and the
 *    reviewer rows CASCADE away (access ends); discarding cascades too;
 *  - the engine: a designer test run shows the published form in a User
 *    Task by default and the draft with "Use form drafts"; a caller's
 *    variables can't switch it on.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/form-design-drafts-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }))

import * as forms from '@/lib/services/forms'
import * as drafts from '@/lib/services/form-design-drafts'
import { executeWorkflow } from '@/lib/workflow-engine'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// The first 8 characters differ per id: a user's personal workspace slug is personal-<first 8>.
const id = (n: number) => `fd0f${n.toString(16).padStart(4, '0')}-0000-4000-8000-00000000fd0f`
const A = id(0xa)
const B = id(0xb)
const ANA = id(0x1)
const BEN = id(0x2)
const CARA = id(0x3)
const DAN = id(0x4)
const OUTSIDER = id(0x5)
const USERS = [ANA, BEN, CARA, DAN, OUTSIDER]
const TEAM = id(0x70)
const WORKFLOW = id(0x101)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const V1 = [
  { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true },
  { key: 'reason', label: 'Reason', type: 'textarea' },
]
const V2 = [...V1, { key: 'cost_center', label: 'Cost center', type: 'text' }]

describe.skipIf(!DB_URL)('form drafts (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] | null = null): ServiceContext =>
    ({ supabase: admin, tenantId, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as any[]
  let formId = ''

  async function as(user: string, sql: string, params: unknown[] = [], role = 'authenticated') {
    await db.query('BEGIN')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role })])
      return { rows: (await db.query(sql, params)).rows as any[], error: null as null | { code?: string } }
    } catch (e) {
      return { rows: [] as any[], error: e as { code?: string } }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r) => r.tenant_id)
    for (const t of [A, B]) {
      for (const table of ['workflow_logs', 'workflow_runs', 'workflow_versions', 'workflows', 'notifications', 'form_design_draft_reviewers', 'form_design_drafts', 'forms', 'object_audit_log', 'github_sync_queue']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.teams WHERE tenant_id = $1', [t]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    drafts.resetDesignDraftAvailability()
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Drafts A', 'drafts-a-test'), ($2, 'Drafts B', 'drafts-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `d${user.slice(-4)}.${Date.now().toString(36)}@drafts.test`])
      const home = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home, { [ANA]: 'Ana', [BEN]: 'Ben', [CARA]: 'Cara', [DAN]: 'Dan', [OUTSIDER]: 'Olly' }[user]])
    }
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Finance')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [CARA, TEAM])
    formId = (await forms.createForm(ctx(A, ANA), { name: 'Expense claim', fields: V1 })).id
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('has the tables, RLS on and no client grants; form_versions.note and notifications.form_id', async () => {
    const rls = await q(`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('form_design_drafts', 'form_design_draft_reviewers') ORDER BY relname`)
    expect(rls).toEqual([{ relname: 'form_design_draft_reviewers', relrowsecurity: true }, { relname: 'form_design_drafts', relrowsecurity: true }])
    const cols = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE (table_name = 'form_versions' AND column_name = 'note') OR (table_name = 'notifications' AND column_name = 'form_id') ORDER BY table_name`)
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual(['form_versions.note', 'notifications.form_id'])
    await drafts.saveDesignDraft(ctx(A, ANA), formId, { fields: V2 })
    for (const role of ['authenticated', 'anon']) {
      for (const sql of [
        'SELECT * FROM public.form_design_drafts',
        'SELECT * FROM public.form_design_draft_reviewers',
        `INSERT INTO public.form_design_drafts (form_id, tenant_id, base_version) VALUES ('${formId}', '${A}', 1)`,
        `UPDATE public.form_design_drafts SET fields = '[]' WHERE form_id = '${formId}'`,
        `DELETE FROM public.form_design_drafts WHERE form_id = '${formId}'`,
        `INSERT INTO public.form_design_draft_reviewers (tenant_id, form_id, principal_type, principal_id) VALUES ('${A}', '${formId}', 'user', '${BEN}')`,
      ]) {
        const result = await as(ANA, sql, [], role)
        expect(result.error?.code, `${role}: ${sql}`).toBe('42501')
      }
    }
    // A member still reads the published form (as before).
    const own = await as(BEN, 'SELECT version FROM public.forms WHERE id = $1', [formId])
    expect(own.rows).toEqual([{ version: 1 }])
  })

  it('saves to the draft, shares it, publishes with a note and the reviewers cascade away', async () => {
    const saved = await drafts.saveDesignDraft(ctx(A, ANA), formId, { fields: V2 })
    expect(saved.mode).toBe('draft')
    const published = await q('SELECT version, fields FROM public.forms WHERE id = $1', [formId])
    expect(published[0].version).toBe(1)
    expect(published[0].fields.map((f: any) => f.key)).toEqual(['amount', 'reason'])
    const row = (await q('SELECT base_version, updated_by, updated_at FROM public.form_design_drafts WHERE form_id = $1', [formId]))[0]
    expect(row).toMatchObject({ base_version: 1, updated_by: ANA })

    // Last-saved stamp moves on every save (the updated_at trigger); a stale stamp is refused.
    const stamp = new Date(row.updated_at).toISOString()
    const view = await drafts.getDesignDraft(ctx(A, BEN, ['forms.view', 'forms.edit']), formId)
    await drafts.saveDesignDraft(ctx(A, BEN, ['forms.view', 'forms.edit']), formId, { fields: V2, expected_updated_at: view.draft!.updated_at })
    await expect(drafts.saveDesignDraft(ctx(A, ANA), formId, { fields: V2, expected_updated_at: stamp === view.draft!.updated_at ? '2000-01-01T00:00:00+00:00' : stamp })).rejects.toMatchObject({ status: 409 })

    const shared = await drafts.addDraftReviewers(ctx(A, ANA), formId, { principals: [{ type: 'user', id: BEN }, { type: 'team', id: TEAM }] })
    expect(shared.added).toHaveLength(2)
    const notes = await q(`SELECT user_id, form_id, type FROM public.notifications WHERE tenant_id = $1 AND type = 'form_draft_shared' ORDER BY user_id`, [A])
    expect(notes).toEqual([{ user_id: BEN, form_id: formId, type: 'form_draft_shared' }, { user_id: CARA, form_id: formId, type: 'form_draft_shared' }])
    // Outsiders (another workspace) can't be added.
    await expect(drafts.addDraftReviewers(ctx(A, ANA), formId, { principals: [{ type: 'user', id: OUTSIDER }] })).rejects.toMatchObject({ status: 400 })

    const member = ['forms.submit']
    expect((await drafts.getDraftPreview(ctx(A, BEN, member), formId)).access).toBe('reviewer')
    expect((await drafts.getDraftPreview(ctx(A, CARA, member), formId)).access).toBe('reviewer')
    await expect(drafts.getDraftPreview(ctx(A, DAN, member), formId)).rejects.toMatchObject({ status: 404 })
    await expect(drafts.getDraftPreview(ctx(B, OUTSIDER, member), formId)).rejects.toMatchObject({ status: 404 })

    const result = await drafts.publishDesignDraft(ctx(A, ANA), formId, { note: 'Adds the cost center' })
    expect(result).toMatchObject({ version: 2, version_changed: true })
    expect(await q('SELECT version, note, created_by FROM public.form_versions WHERE form_id = $1 ORDER BY version', [formId])).toEqual([
      { version: 1, note: null, created_by: ANA },
      { version: 2, note: 'Adds the cost center', created_by: ANA },
    ])
    expect(await q('SELECT 1 FROM public.form_design_drafts WHERE form_id = $1', [formId])).toEqual([])
    // ON DELETE CASCADE: the reviewers went with the draft.
    expect(await q('SELECT 1 FROM public.form_design_draft_reviewers WHERE form_id = $1', [formId])).toEqual([])
    await expect(drafts.getDraftPreview(ctx(A, BEN, member), formId)).rejects.toMatchObject({ status: 404 })
  })

  it('discarding removes the draft and its reviewers, and leaves the published version', async () => {
    await drafts.saveDesignDraft(ctx(A, ANA), formId, { fields: [...V2, { key: 'notes', label: 'Notes', type: 'textarea' }] })
    await drafts.addDraftReviewers(ctx(A, ANA), formId, { principals: [{ type: 'user', id: BEN }] })
    await drafts.discardDesignDraft(ctx(A, ANA), formId)
    expect(await q('SELECT 1 FROM public.form_design_draft_reviewers WHERE form_id = $1', [formId])).toEqual([])
    expect((await q('SELECT version FROM public.forms WHERE id = $1', [formId]))[0].version).toBe(2)
    // Another workspace can't touch it.
    await expect(drafts.saveDesignDraft(ctx(B, OUTSIDER), formId, { fields: V1 })).rejects.toMatchObject({ status: 404 })
  })

  it('a designer test run shows the published form; with "Use form drafts" the draft', async () => {
    await drafts.saveDesignDraft(ctx(A, ANA), formId, { fields: [...V2, { key: 'project', label: 'Project', type: 'text' }] })
    const nodes = [
      { id: 'start', type: 'manual', label: 'Start', config: {} },
      { id: 'review', type: 'user_task', label: 'Review', config: { task_title: 'Review', outcomes: ['Approved'], form_id: formId, form_name: 'Expense claim', fields: V1 } },
    ]
    await q(`INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'Drafts test', false, 'manual', $3::jsonb, $4::jsonb)`,
      [WORKFLOW, A, JSON.stringify(nodes), JSON.stringify([{ id: 'e1', source: 'start', target: 'review' }])])
    const keysOf = async (options: { testFormDrafts?: boolean }, variables: Record<string, unknown> = {}) => {
      const events: any[] = []
      await executeWorkflow(WORKFLOW, undefined, true, variables, (e) => events.push(e), undefined, undefined, { supabase: admin as any, initiator: { userId: ANA, via: 'test' }, ...options })
      const prompt = events.find((e) => e?.data?.status === 'test_user_task')
      return (prompt?.data?.fields ?? []).map((f: any) => f.key)
    }
    expect(await keysOf({})).toEqual(['amount', 'reason', 'cost_center'])
    // A caller's variables can't turn it on.
    expect(await keysOf({}, { _test_form_drafts: true })).toEqual(['amount', 'reason', 'cost_center'])
    expect(await keysOf({ testFormDrafts: true })).toEqual(['amount', 'reason', 'cost_center', 'project'])
  }, 60_000)
})
