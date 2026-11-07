/**
 * The Task completed screen's server side against a LOCAL Supabase stack
 * (lib/services/task-completion-screen.ts):
 *  - what happens next: the next task with its assignee (and team), the run
 *    completed, waiting on a timer / event, processing (the resume not yet
 *    picked up), stopped, not a workflow task;
 *  - access: only people involved in the task (or tasks.view_all); someone
 *    who acted on it but may not see the run gets `unknown`; names and
 *    step labels only (no data);
 *  - the bounded wait the API / MCP completion responses use;
 *  - Next task by the Home "My tasks" order;
 *  - the workspace setting (tenants.settings.tasks.completion_screen):
 *    defaults, partial updates, validation, other keys kept.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-completion-screen-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as svc from '@/lib/services/task-completion-screen'
import { DEFAULT_TASK_COMPLETION } from '@/lib/tasks/completion-screen'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `c0c0c000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const uid = (n: number) => `c0${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000c0`
const A = id(0xa)
const B = id(0xb)
const ME = uid(0x101)        // actions the tasks
const PRIYA = uid(0x102)     // the next step's assignee
const MANAGER = uid(0x103)   // acted on behalf: may not see the run
const OTHER = uid(0x104)     // not involved
const OUTSIDER = uid(0x105)  // workspace B
const USERS = [ME, PRIYA, MANAGER, OTHER, OUTSIDER]
const TEAM = id(0x201)
const WF = id(0x301)
const VERSION = id(0x302)
const RUN_NEXT = id(0x601)
const RUN_DONE = id(0x602)
const RUN_WAIT = id(0x603)
const RUN_PROC = id(0x604)
const RUN_FAIL = id(0x605)
const T_APPROVED = id(0x701)   // done by ME; run moved on to Priya
const T_REVIEW = id(0x702)     // Priya's open task (the next step)
const T_LAST = id(0x703)       // done by ME; run completed
const T_WAIT = id(0x704)       // done by ME; run waits on a timer
const T_PROC = id(0x705)       // done by ME; resume not picked up yet
const T_FAIL = id(0x706)       // done by ME; run failed
const T_BEHALF = id(0x707)     // Priya's, actioned by MANAGER on her behalf
const T_PLAIN = id(0x708)      // a standard task
const T_OPEN_SOON = id(0x709)  // ME's open task, due soon
const T_OPEN_LATER = id(0x70a) // ME's open task, due later
const SECRET = 'SECRET-c0c0-amount'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const NODES = [
  { id: 'start', type: 'manual_trigger', label: 'Start', position: { x: 0, y: 0 }, config: {} },
  { id: 'approve', type: 'user_task', label: 'Manager approval', position: { x: 0, y: 150 }, config: { title: `Approve ${SECRET}`, outcomes: ['Approve', 'Reject'] } },
  { id: 'review', type: 'user_task', label: 'Finance review', position: { x: 0, y: 300 }, config: { title: `Review ${SECRET}` } },
  { id: 'timer', type: 'delay', label: 'Payment run', position: { x: 0, y: 450 }, config: { amount: 1, unit: 'days' } },
]

describe.skipIf(!DB_URL)('task completed screen (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const member = ['tasks.view_own', 'tasks.complete', 'forms.submit']
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] = member): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const t of [A, B]) {
      for (const table of ['run_followers', 'tasks', 'workflow_queue', 'workflow_runs']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      for (const table of ['workflow_versions', 'workflows', 'teams', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
  }

  const run = (rid: string, o: { status: string; event?: string | null; paused?: string | null; waits?: string[] }) =>
    q(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, version_id, started_by, started_via, event_id, paused_node_id, paused_at, completed_at, node_results, pause_variables, execution_trace)
       VALUES ($1, $2, $3, $4, $5, $6, 'ui', $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END, CASE WHEN $4 = 'completed' THEN now() END,
         $9::jsonb, $10::jsonb, '[]'::jsonb)`,
    [rid, WF, A, o.status, VERSION, OTHER, o.event ?? null, o.paused ?? null,
      JSON.stringify({ approve: { status: 'success', output: { amount: SECRET } } }),
      JSON.stringify({ secret: SECRET, ...(o.waits ? { _parallel: { waits: o.waits.map((n) => ({ node_id: n })) } } : {}) })])

  const task = (tid: string, o: { title: string; assignee?: string | null; team?: string | null; status?: string; run?: string | null; step?: string | null; event?: string | null; due?: string | null; outcome?: string | null; actioned_by?: string | null }) =>
    q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigned_team_id, due_date, workflow_run_id, workflow_id, workflow_step_id, event_id, is_workflow_task, acceptance_status, completed_at, outcome, actioned_by, available_outcomes, assignment_type)
       VALUES ($1, $2, $3, $4::task_status, 'medium', $5, $6, $7, $8, $9, $10, $11, $12, 'accepted', CASE WHEN $4 = 'completed' THEN now() END, $13, $14, '["Approve","Reject"]'::jsonb, $15)`,
    [tid, A, o.title, o.status ?? 'todo', o.assignee ?? null, o.team ?? null, o.due ?? null, o.run ?? null, o.run ? WF : null, o.step ?? null, o.event ?? null, !!o.run, o.outcome ?? null, o.actioned_by ?? null, o.team && !o.assignee ? 'team' : 'individual'])

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Done A', 'tcs-a-test'), ($2, 'Done B', 'tcs-b-test')`, [A, B])
    const names: Record<string, string> = { [ME]: 'Morgan Me', [PRIYA]: 'Priya Shah', [MANAGER]: 'Max Manager', [OTHER]: 'Olly Other', [OUTSIDER]: 'Oscar Outside' }
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `t${user.slice(2, 8)}.${Date.now().toString(36)}@done.test`])
      const home = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home, names[user]])
    }
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Finance')`, [TEAM, A])
    await q(`INSERT INTO public.workflows (id, tenant_id, name, nodes, edges) VALUES ($1, $2, 'Invoice approval', $3::jsonb, '[]'::jsonb)`, [WF, A, JSON.stringify(NODES)])
    await q(`INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, trigger_type, nodes, edges) VALUES ($1, $2, $3, 1, 'manual', $4::jsonb, '[]'::jsonb)`, [VERSION, WF, A, JSON.stringify(NODES)])

    await run(RUN_NEXT, { status: 'waiting_for_event', event: 'evt_tcs_review', paused: 'review' })
    await run(RUN_DONE, { status: 'completed' })
    await run(RUN_WAIT, { status: 'paused', event: 'evt_tcs_timer', paused: 'timer' })
    await run(RUN_PROC, { status: 'waiting_for_event', event: 'evt_tcs_proc', paused: 'approve' })
    await run(RUN_FAIL, { status: 'failed' })

    await task(T_APPROVED, { title: 'Invoice #1042', assignee: ME, status: 'completed', outcome: 'Approve', run: RUN_NEXT, step: 'approve', event: 'evt_tcs_old', actioned_by: ME })
    await task(T_REVIEW, { title: `Review ${SECRET}`, assignee: PRIYA, team: TEAM, run: RUN_NEXT, step: 'review', event: 'evt_tcs_review' })
    await task(T_LAST, { title: 'Last step', assignee: ME, status: 'completed', outcome: 'Approve', run: RUN_DONE, step: 'review' })
    await task(T_WAIT, { title: 'Before the timer', assignee: ME, status: 'completed', outcome: 'Approve', run: RUN_WAIT, step: 'approve', event: 'evt_tcs_w' })
    await task(T_PROC, { title: 'Just now', assignee: ME, status: 'completed', outcome: 'Reject', run: RUN_PROC, step: 'approve', event: 'evt_tcs_proc' })
    await task(T_FAIL, { title: 'Broke', assignee: ME, status: 'completed', outcome: 'Approve', run: RUN_FAIL, step: 'approve' })
    await task(T_BEHALF, { title: 'On behalf', assignee: OTHER, status: 'completed', outcome: 'Approve', run: RUN_FAIL, step: 'approve', actioned_by: MANAGER })
    await task(T_PLAIN, { title: 'Plain task', assignee: ME, status: 'completed', outcome: 'completed' })
    await task(T_OPEN_LATER, { title: 'Later one', assignee: ME, due: new Date(Date.now() + 5 * 86_400_000).toISOString() })
    await task(T_OPEN_SOON, { title: 'Soon one', assignee: ME, due: new Date(Date.now() + 86_400_000).toISOString() })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
  })

  /* ── what happens next ─────────────────────────────────────────────── */

  it('the next task and who has it (step label, person, team) — names only, no data', async () => {
    const next = await svc.getTaskNextStep(ctx(A, ME), T_APPROVED)
    expect(next).toEqual({
      state: 'assigned', run_id: RUN_NEXT, process: { name: 'Invoice approval' }, run_view: 'progress',
      steps: [{ name: 'Finance review', assignees: ['Priya Shah'], team: 'Finance' }],
    })
    expect(JSON.stringify(next)).not.toContain(SECRET)
  })

  it('a finished run: complete; a failed one: stopped; a plain task: none', async () => {
    expect(await svc.getTaskNextStep(ctx(A, ME), T_LAST)).toMatchObject({ state: 'complete', run_id: RUN_DONE, steps: [] })
    expect(await svc.getTaskNextStep(ctx(A, ME), T_FAIL)).toMatchObject({ state: 'stopped', run_id: RUN_FAIL })
    expect(await svc.getTaskNextStep(ctx(A, ME), T_PLAIN)).toEqual({ state: 'none', run_id: null, steps: [], process: null, run_view: null })
  })

  it('waiting on a timer / event: the step it waits on, with no one', async () => {
    expect(await svc.getTaskNextStep(ctx(A, ME), T_WAIT)).toMatchObject({ state: 'waiting', steps: [{ name: 'Payment run', assignees: [], team: null }] })
  })

  it('processing while the resume is not picked up yet (run still paused where the task left it), and the bounded wait gives up', async () => {
    expect(await svc.getTaskNextStep(ctx(A, ME), T_PROC)).toMatchObject({ state: 'processing', run_id: RUN_PROC })
    const started = Date.now()
    const next = await svc.waitForTaskNextStep(ctx(A, ME), T_PROC, { timeoutMs: 300, intervalMs: 100 })
    expect(next.state).toBe('processing')
    expect(Date.now() - started).toBeLessThan(2000)
    // The queue moves the run on: the next read sees it.
    await q(`UPDATE public.workflow_runs SET status = 'completed', paused_node_id = NULL, completed_at = now() WHERE id = $1`, [RUN_PROC])
    expect((await svc.nextStepForResponse(ctx(A, ME), T_PROC))?.state).toBe('complete')
    await q(`UPDATE public.workflow_runs SET status = 'waiting_for_event', paused_node_id = 'approve', completed_at = NULL WHERE id = $1`, [RUN_PROC])
  })

  it('a resume job still on the queue for the run is processing (another run\'s job is not)', async () => {
    await q(`INSERT INTO public.workflow_queue (tenant_id, workflow_id, trigger_type, trigger_data, status) VALUES ($1, $2, 'task_resume', $3::jsonb, 'pending')`,
      [A, WF, JSON.stringify({ _task_resume: { run_id: RUN_WAIT, event_id: 'evt_tcs_timer', payload: '{}', sig: 'x' } })])
    expect((await svc.getTaskNextStep(ctx(A, ME), T_WAIT)).state).toBe('processing')
    expect((await svc.getTaskNextStep(ctx(A, ME), T_APPROVED)).state).toBe('assigned')
    await q(`UPDATE public.workflow_queue SET status = 'completed' WHERE tenant_id = $1`, [A])
    expect((await svc.getTaskNextStep(ctx(A, ME), T_WAIT)).state).toBe('waiting')
  })

  it('a running run is processing too', async () => {
    await q(`UPDATE public.workflow_runs SET status = 'running' WHERE id = $1`, [RUN_NEXT])
    expect((await svc.getTaskNextStep(ctx(A, ME), T_APPROVED)).state).toBe('processing')
    await q(`UPDATE public.workflow_runs SET status = 'waiting_for_event' WHERE id = $1`, [RUN_NEXT])
  })

  it('access: not involved → not found; another workspace → not found; tasks.view_all may read it', async () => {
    await expect(svc.getTaskNextStep(ctx(A, OTHER), T_APPROVED)).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.getTaskNextStep(ctx(B, OUTSIDER), T_APPROVED)).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.getTaskNextStep(ctx(A, ME), 'not-a-uuid')).rejects.toMatchObject({ code: 'not_found' })
    // workflows.view_runs opens the full run view.
    expect(await svc.getTaskNextStep(ctx(A, OTHER, ['tasks.view_all', 'workflows.view_runs']), T_APPROVED)).toMatchObject({ state: 'assigned', run_view: 'full' })
  })

  it('acted on behalf but may not see the run: unknown (a neutral line), nothing about the run', async () => {
    expect(await svc.getTaskNextStep(ctx(A, MANAGER), T_BEHALF)).toEqual({ state: 'unknown', run_id: null, steps: [], process: null, run_view: null })
  })

  /* ── next task and the screen's read ───────────────────────────────── */

  it('Next task: my next open task by the Home order (soonest due first), never the one just done', async () => {
    expect(await svc.getNextTask(ctx(A, ME), T_APPROVED)).toMatchObject({ id: T_OPEN_SOON, title: 'Soon one' })
    expect(await svc.getNextTask(ctx(A, ME), T_OPEN_SOON)).toMatchObject({ id: T_OPEN_LATER })
    expect(await svc.getNextTask(ctx(A, PRIYA), T_REVIEW)).toBeNull()
    expect(await svc.getNextTask(ctx(A, null), T_APPROVED)).toBeNull()
  })

  it('the screen read: settings, task, next, next task and my name', async () => {
    const screen = await svc.getTaskCompletedScreen(ctx(A, ME), T_APPROVED)
    expect(screen.settings).toEqual(DEFAULT_TASK_COMPLETION)
    expect(screen.task).toMatchObject({ id: T_APPROVED, title: 'Invoice #1042', outcome: 'Approve', available_outcomes: ['Approve', 'Reject'] })
    expect(screen.next.state).toBe('assigned')
    expect(screen.next_task?.id).toBe(T_OPEN_SOON)
    expect(screen.user.name).toBe('Morgan Me')
  })

  /* ── the workspace setting ─────────────────────────────────────────── */

  it('defaults, partial updates (other settings keys kept), validation, settings.edit', async () => {
    await q(`UPDATE public.tenants SET settings = '{"forms": {"anonymous": {"enabled": true}}}'::jsonb WHERE id = $1`, [A])
    expect(await svc.getTaskCompletionSettings(ctx(A, ME))).toEqual(DEFAULT_TASK_COMPLETION)
    await expect(svc.setTaskCompletionSettings(ctx(A, ME), { heading: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    const editor = ctx(A, ME, [...member, 'settings.edit'])
    const saved = await svc.setTaskCompletionSettings(editor, { heading: 'Done: {{task.title}}', back_target: 'home', show_view_flow: false })
    expect(saved).toMatchObject({ heading: 'Done: {{task.title}}', back_target: 'home', show_view_flow: false, next_complete: 'Process complete' })
    expect(await svc.getTaskCompletionSettings(ctx(A, OTHER))).toEqual(saved)
    const [{ settings }] = await q('SELECT settings FROM public.tenants WHERE id = $1', [A])
    expect(settings.forms).toEqual({ anonymous: { enabled: true } })
    expect(settings.tasks.completion_screen.heading).toBe('Done: {{task.title}}')
    await expect(svc.setTaskCompletionSettings(editor, { back_target: 'nowhere' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(svc.setTaskCompletionSettings(editor, { heading: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(svc.setTaskCompletionSettings(editor, { enabled: 'yes' })).rejects.toMatchObject({ code: 'validation_error' })
    // Workspace B is untouched.
    expect(await svc.getTaskCompletionSettings(ctx(B, OUTSIDER))).toEqual(DEFAULT_TASK_COMPLETION)
  })
})
