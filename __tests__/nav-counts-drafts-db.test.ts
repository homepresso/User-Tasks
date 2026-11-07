/**
 * Side menu badges and form drafts against a LOCAL Supabase stack (migration
 * 20261218000000_nav_counts_form_drafts.sql, lib/services/home.ts
 * getNavCounts, lib/services/form-drafts.ts):
 *  - nav_task_counts: my_tasks / queue equal the Home card's open / queue
 *    for every person; tracker = open tasks I assigned to others; a count
 *    drops when a task is completed; tenant isolation; a signed-in caller
 *    asking for someone else gets zeros; no permission → 0;
 *  - favourites: the heart's toggle (only forms I can open; idempotent);
 *  - drafts: save / restore (only the form's own values; unknown keys and
 *    forged file references refused / dropped), bounded size, delete on
 *    "Start fresh" and on a successful submit, RLS (own rows only, other
 *    workspaces invisible, inserting for someone else refused).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/nav-counts-drafts-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as home from '@/lib/services/home'
import * as drafts from '@/lib/services/form-drafts'
import { submitForm } from '@/lib/services/form-submissions'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `ac0ac000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `ac${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000ac`
const A = id(0xa)
const B = id(0xb)
const ME = uid(0x201)        // assignee of tasks, assigner of others
const TEAMER = uid(0x202)    // team member (queue)
const OTHER = uid(0x203)     // member, nothing assigned
const OUTSIDER = uid(0x204)  // workspace B
const USERS = [ME, TEAMER, OTHER, OUTSIDER]
const TEAM = id(0x301)
const FORM = id(0x401)
const FORM_B = id(0x402)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'files', label: 'Files', type: 'attachments' },
]

describe.skipIf(!DB_URL)('nav counts and form drafts (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const member = ['tasks.view_own', 'tasks.complete', 'tasks.manage_queue', 'tasks.view_all', 'forms.submit', 'forms.view']
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] = member): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  /** SQL as a signed-in user (PostgREST style), rolled back. */
  async function as(user: string, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
      return { rows: (await db.query(sql, params)).rows as any[], error: null as null | { code?: string } }
    } catch (e) {
      return { rows: [] as any[], error: e as { code?: string } }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const t of [A, B]) {
      for (const table of ['form_drafts', 'form_favorites', 'form_submissions', 'tasks']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      for (const table of ['forms', 'teams', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch((e) => console.warn(`[nav test cleanup] ${table}: ${e.message}`))
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-ac0002%'`).catch(() => undefined)
  }

  const task = (tid: string, o: { tenant?: string; assignee?: string | null; assigner?: string | null; team?: string | null; status?: string; acceptance?: string; parent?: string | null }) =>
    q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigner_id, assigned_team_id, acceptance_status, parent_task_id, assignment_type, completed_at)
       VALUES ($1, $2, $3, $4::task_status, 'medium', $5, $6, $7, $8, $9, $10, CASE WHEN $4 = 'completed' THEN now() END)`,
    [tid, o.tenant ?? A, `Task ${tid.slice(-4)}`, o.status ?? 'todo', o.assignee ?? null, o.assigner ?? null, o.team ?? null, o.acceptance ?? 'accepted', o.parent ?? null, o.team ? 'team' : 'individual'])

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Nav A', 'nav-a-test'), ($2, 'Nav B', 'nav-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `n${user.slice(2, 8)}.${Date.now().toString(36)}@nav.test`])
      const home_ = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home_])
      await q('UPDATE public.users SET current_tenant_id = $2 WHERE id = $1', [user, home_])
    }
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const memberRole = await roleId(A, 'member')
    for (const user of [ME, TEAMER, OTHER]) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [B, OUTSIDER, await roleId(B, 'member')])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Ops')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2), ($3, $2)', [TEAMER, TEAM, ME])
    await q(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $3, 'Leave request', $5::jsonb), ($2, $4, 'B form', '[]')`, [FORM, FORM_B, A, B, JSON.stringify(FIELDS)])

    // ME: 3 open (one in progress, one blocked), 1 pending acceptance (queue), 1 completed, 1 subtask (never counted).
    await task(id(0x501), { assignee: ME, assigner: TEAMER })
    await task(id(0x502), { assignee: ME, status: 'in_progress' })
    await task(id(0x503), { assignee: ME, status: 'blocked' })
    await task(id(0x504), { assignee: ME, acceptance: 'pending' })
    await task(id(0x505), { assignee: ME, status: 'completed' })
    await task(id(0x506), { assignee: ME, parent: id(0x501) })
    // Team queue: unassigned, my team (ME and TEAMER both see it).
    await task(id(0x507), { team: TEAM })
    await task(id(0x508), { team: TEAM, status: 'completed' })
    // ME assigned: two open to others, one completed, one to myself (not tracked), one unassigned team task.
    await task(id(0x509), { assignee: TEAMER, assigner: ME })
    await task(id(0x50a), { assignee: OTHER, assigner: ME, status: 'in_progress' })
    await task(id(0x50b), { assignee: OTHER, assigner: ME, status: 'completed' })
    await task(id(0x50c), { assignee: ME, assigner: ME })
    await task(id(0x50d), { team: TEAM, assigner: ME, status: 'cancelled' })
    // Workspace B: never counted for A.
    await task(id(0x50e), { tenant: B, assignee: OUTSIDER })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
  })

  /* ── nav counts ────────────────────────────────────────────────────── */

  it('my_tasks and queue equal the Home My tasks card for everyone', async () => {
    for (const user of [ME, TEAMER, OTHER]) {
      const [nav, card] = await Promise.all([home.getNavCounts(ctx(A, user)), home.getTaskMetrics(ctx(A, user))])
      expect(nav.my_tasks, user).toBe(card.open)
      expect(nav.queue, user).toBe(card.queue)
    }
    expect(await home.getNavCounts(ctx(A, ME))).toEqual({ my_tasks: 4, queue: 2, tracker: 2 })
    expect(await home.getNavCounts(ctx(A, TEAMER))).toMatchObject({ my_tasks: 1, queue: 1, tracker: 1 })
    expect(await home.getNavCounts(ctx(A, OTHER))).toEqual({ my_tasks: 1, queue: 0, tracker: 0 })
  })

  it('tracker = Task Tracker default view (assigned by me to others), open only', async () => {
    const rows = await q(`SELECT count(*)::int AS n FROM public.tasks WHERE tenant_id = $1 AND assigner_id = $2 AND assignee_id <> $2
      AND parent_task_id IS NULL AND deleted_at IS NULL AND status NOT IN ('completed', 'cancelled', 'draft')`, [A, ME])
    expect((await home.getNavCounts(ctx(A, ME))).tracker).toBe(rows[0].n)
  })

  it('a count drops when a task is completed (and the Home card with it)', async () => {
    await q(`UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = $1`, [id(0x502)])
    try {
      expect((await home.getNavCounts(ctx(A, ME))).my_tasks).toBe(3)
      expect((await home.getTaskMetrics(ctx(A, ME))).open).toBe(3)
    } finally {
      await q(`UPDATE public.tasks SET status = 'in_progress', completed_at = NULL WHERE id = $1`, [id(0x502)])
    }
  })

  it('tenant isolation: another workspace counts nothing; signed-in callers can only ask for themselves', async () => {
    expect(await home.getNavCounts(ctx(B, ME))).toEqual({ my_tasks: 0, queue: 0, tracker: 0 })
    expect(await home.getNavCounts(ctx(B, OUTSIDER))).toEqual({ my_tasks: 1, queue: 0, tracker: 0 })
    const own = await as(ME, 'SELECT public.nav_task_counts($1, $2) AS c', [A, ME])
    expect(own.error).toBeNull()
    expect(own.rows[0].c).toEqual({ my_tasks: 4, queue: 2, tracker: 2 })
    const spy = await as(OTHER, 'SELECT public.nav_task_counts($1, $2) AS c', [A, ME])
    expect(spy.rows[0].c).toEqual({ my_tasks: 0, queue: 0, tracker: 0 })
    const anon = await (async () => {
      await db.query('BEGIN')
      try { await db.query('SET LOCAL ROLE anon'); return await db.query('SELECT public.nav_task_counts($1, $2)', [A, ME]).then(() => null, (e) => e) } finally { await db.query('ROLLBACK') }
    })()
    expect(anon?.code).toBe('42501')
  })

  it('permissions: no tasks.view_all → no tracker count; neither permission → zeros; a person is needed', async () => {
    expect(await home.getNavCounts(ctx(A, ME, ['tasks.view_own']))).toEqual({ my_tasks: 4, queue: 2, tracker: 0 })
    expect(await home.getNavCounts(ctx(A, ME, ['forms.submit']))).toEqual({ my_tasks: 0, queue: 0, tracker: 0 })
    await expect(home.getNavCounts(ctx(A, null))).rejects.toThrow(/bound to a user/)
  })

  /* ── favourite toggle ──────────────────────────────────────────────── */

  it('the heart toggles a favourite (idempotent), only for forms I can open', async () => {
    expect(await home.setFormFavorite(ctx(A, ME), FORM, true)).toEqual({ form_id: FORM, favorite: true })
    expect(await home.setFormFavorite(ctx(A, ME), FORM, true)).toEqual({ form_id: FORM, favorite: true })
    expect((await home.listFavoriteForms(ctx(A, ME))).map((f) => f.id)).toEqual([FORM])
    expect(await home.setFormFavorite(ctx(A, ME), FORM, false)).toEqual({ form_id: FORM, favorite: false })
    expect(await home.listFavoriteForms(ctx(A, ME))).toEqual([])
    await expect(home.setFormFavorite(ctx(A, ME), FORM_B, true)).rejects.toThrow(/not found/i)
    await expect(home.setFormFavorite(ctx(A, ME, ['tasks.view_own']), FORM, true)).rejects.toThrow()
  })

  /* ── drafts ────────────────────────────────────────────────────────── */

  it('saves and restores a draft: only the form’s own values, parameters kept, one per person per form', async () => {
    expect(await drafts.getFormDraft(ctx(A, ME), FORM)).toBeNull()
    const saved = await drafts.saveFormDraft(ctx(A, ME), FORM, { values: { name: 'Ada', notes: 'first', not_a_field: 'x', __form_vars: { a: 1 }, submission: { id: 'forged' } }, params: { customer: 'ALFKI', 'bad name': 1, nested: { x: 1 }, submission: 'x' } })
    expect(saved.form_id).toBe(FORM)
    const back = await drafts.getFormDraft(ctx(A, ME), FORM)
    expect(back).toMatchObject({ form_id: FORM, values: { name: 'Ada', notes: 'first' }, params: { customer: 'ALFKI' } })
    expect(back!.values).not.toHaveProperty('not_a_field')
    expect(back!.values).not.toHaveProperty('__form_vars')
    expect(back!.values).not.toHaveProperty('submission')
    expect(back!.params).toEqual({ customer: 'ALFKI' })
    await drafts.saveFormDraft(ctx(A, ME), FORM, { values: { name: 'Ada L' } })
    expect((await drafts.getFormDraft(ctx(A, ME), FORM))!.values).toEqual({ name: 'Ada L' })
    expect((await q('SELECT count(*)::int AS n FROM public.form_drafts WHERE user_id = $1', [ME]))[0].n).toBe(1)
    expect((await drafts.listMyFormDrafts(ctx(A, ME))).map((d) => d.form_name)).toEqual(['Leave request'])
    // Someone else sees nothing of it.
    expect(await drafts.getFormDraft(ctx(A, OTHER), FORM)).toBeNull()
    expect(await drafts.listMyFormDrafts(ctx(A, OTHER))).toEqual([])
  })

  it('files are references the server checks: a forged one is refused; a draft is bounded', async () => {
    await expect(drafts.saveFormDraft(ctx(A, ME), FORM, { values: { files: [{ id: id(0x999), name: 'x.pdf', size: 1 }] } })).rejects.toThrow(/no longer available|invalid/)
    await expect(drafts.saveFormDraft(ctx(A, ME), FORM, { values: { notes: 'x'.repeat(300 * 1024) } })).rejects.toThrow(/too large/)
    // The table refuses it too (a write that skipped the service).
    await expect(q(`INSERT INTO public.form_drafts (tenant_id, user_id, form_id, values) VALUES ($1, $2, $3, jsonb_build_object('notes', repeat('x', 300000)))`, [A, OTHER, FORM])).rejects.toThrow(/form_drafts_size/)
  })

  it('needs forms.submit and a form of this workspace', async () => {
    await expect(drafts.saveFormDraft(ctx(A, ME, ['tasks.view_own']), FORM, { values: { name: 'x' } })).rejects.toThrow()
    await expect(drafts.saveFormDraft(ctx(A, ME), FORM_B, { values: {} })).rejects.toThrow(/not found/i)
    await expect(drafts.saveFormDraft(ctx(A, null), FORM, { values: {} })).rejects.toThrow(/bound to a user/)
  })

  it('RLS: own rows only, nothing across workspaces, no inserting for someone else', async () => {
    await drafts.saveFormDraft(ctx(A, ME), FORM, { values: { name: 'Ada' } })
    expect((await as(ME, 'SELECT form_id FROM public.form_drafts')).rows.map((r) => r.form_id)).toEqual([FORM])
    expect((await as(OTHER, 'SELECT form_id FROM public.form_drafts')).rows).toEqual([])
    expect((await as(OUTSIDER, 'SELECT form_id FROM public.form_drafts')).rows).toEqual([])
    const forged = await as(OTHER, `INSERT INTO public.form_drafts (tenant_id, user_id, form_id, values) VALUES ($1, $2, $3, '{}')`, [A, ME, FORM])
    expect(forged.error?.code).toBe('42501')
    const crossTenant = await as(OUTSIDER, `INSERT INTO public.form_drafts (tenant_id, user_id, form_id, values) VALUES ($1, $2, $3, '{}')`, [B, OUTSIDER, FORM])
    expect(crossTenant.error?.code).toBe('42501')
    const ownInsert = await as(OTHER, `INSERT INTO public.form_drafts (tenant_id, user_id, form_id, values) VALUES ($1, $2, $3, '{"name":"me"}') RETURNING tenant_id`, [B, OTHER, FORM])
    // tenant_id follows the form (trigger), whatever the caller sent.
    expect(ownInsert.error).toBeNull()
    expect(ownInsert.rows[0].tenant_id).toBe(A)
    const steal = await as(OTHER, `UPDATE public.form_drafts SET values = '{}' WHERE user_id = $1 RETURNING 1`, [ME])
    expect(steal.rows).toEqual([])
    const wipe = await as(OTHER, `DELETE FROM public.form_drafts WHERE user_id = $1 RETURNING 1`, [ME])
    expect(wipe.rows).toEqual([])
    expect((await q('SELECT count(*)::int AS n FROM public.form_drafts WHERE user_id = $1', [ME]))[0].n).toBe(1)
  })

  it('Start fresh deletes it; a successful submit deletes it', async () => {
    await drafts.saveFormDraft(ctx(A, ME), FORM, { values: { name: 'Ada' } })
    expect(await drafts.deleteFormDraft(ctx(A, ME), FORM)).toEqual({ form_id: FORM, deleted: true })
    expect(await drafts.deleteFormDraft(ctx(A, ME), FORM)).toEqual({ form_id: FORM, deleted: false })
    expect(await drafts.getFormDraft(ctx(A, ME), FORM)).toBeNull()

    await drafts.saveFormDraft(ctx(A, ME), FORM, { values: { name: 'Ada' } })
    await drafts.saveFormDraft(ctx(A, OTHER), FORM, { values: { name: 'Olly' } })
    // A failed submission (required field empty) keeps the draft.
    await expect(submitForm(ctx(A, ME), FORM, { values: { notes: 'no name' } })).rejects.toThrow()
    expect(await drafts.getFormDraft(ctx(A, ME), FORM)).not.toBeNull()
    const result = await submitForm(ctx(A, ME), FORM, { values: { name: 'Ada' } })
    expect(result.submission.id).toBeTruthy()
    expect(await drafts.getFormDraft(ctx(A, ME), FORM)).toBeNull()
    // Only the submitter's draft goes.
    expect((await drafts.getFormDraft(ctx(A, OTHER), FORM))!.values).toEqual({ name: 'Olly' })
  })
})
