/**
 * Process view task links (lib/services/run-tasks.ts, lib/run-tasks.ts):
 * per-caller flags for each persona (admin, explicit workflow manager,
 * the assignee's direct / indirect manager, the assignee, the run's
 * initiator, an unrelated user), who each task is with (status per person),
 * who completed it, and its history with details redacted for callers who
 * can't open the task. Also the full run read (automations.processView)
 * refusing an unrelated user and REST-shaped helpers.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { loadRunTasks, loadRunTasksForRun, labelsOf } from '@/lib/services/run-tasks'
import { runOutcomeTone, runTaskAllNames, runTaskWho, waitingTasks, type RunTask } from '@/lib/run-tasks'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const T = 'ta'
const RUN = '11111111-1111-4111-8111-111111111111'
const FORM_META = { fields: [{ key: 'amount', label: 'Amount', type: 'number' }] }

function seed() {
  return {
    workflows: [{ id: 'wf1', tenant_id: T, name: 'Invoice approval', nodes: [{ id: 'approve', type: 'user_task', label: 'Approve invoice' }, { id: 'review', type: 'user_task', label: 'Finance review' }, { id: 'claim', type: 'user_task', label: 'Pay' }] }],
    workflow_runs: [
      { id: RUN, tenant_id: T, workflow_id: 'wf1', version_id: null, status: 'waiting_for_event', started_by: 'ivan', started_at: '2026-11-01T00:00:00Z' },
      { id: 'run-other', tenant_id: T, workflow_id: 'wf2', status: 'waiting_for_event', started_by: 'zed', started_at: '2026-11-01T00:00:00Z' },
    ],
    tasks: [
      // Completed review: Ben responded himself; Mia (his manager) responded for Ana with a reason.
      { id: 'tk-review', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'review', title: 'Review invoice INV-7', status: 'completed', is_workflow_task: true, event_id: 'e0',
        assignee_id: null, assignment_mode: 'collaborative', created_at: '2026-11-01T01:00:00Z', completed_at: '2026-11-01T03:00:00Z',
        outcome: 'approved', actioned_by: 'mia', actioned_on_behalf_of: 'ana', actioned_at: '2026-11-01T03:00:00Z', metadata: {} },
      // Waiting: Alice's approval with a form.
      { id: 'tk-approve', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'approve', title: 'Approve invoice INV-7', status: 'in_progress', is_workflow_task: true, event_id: 'e1',
        assignee_id: 'alice', acceptance_status: 'accepted', accepted_at: '2026-11-01T04:00:00Z', created_at: '2026-11-01T03:30:00Z', metadata: FORM_META },
      // Waiting: an unclaimed team task (Payments team; Tess is a member).
      { id: 'tk-claim', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'claim', title: 'Pay INV-7', status: 'todo', is_workflow_task: true, event_id: 'e2',
        assignee_id: null, assigned_team_id: 'team-pay', created_at: '2026-11-01T05:00:00Z', metadata: {} },
      // Another run's task never shows.
      { id: 'tk-elsewhere', tenant_id: T, workflow_run_id: 'run-other', workflow_id: 'wf2', workflow_step_id: 'x', title: 'Other', status: 'todo', assignee_id: 'alice', created_at: '2026-11-01T00:00:00Z' },
    ],
    task_assignees: [
      { tenant_id: T, task_id: 'tk-review', user_id: 'ben', role: 'collaborator', acceptance_status: 'accepted' },
      { tenant_id: T, task_id: 'tk-review', user_id: 'ana', role: 'collaborator', acceptance_status: 'accepted' },
    ],
    task_responses: [
      { tenant_id: T, task_id: 'tk-review', user_id: 'ben', outcome: 'approved', outcome_notes: 'Numbers check out', responded_at: '2026-11-01T02:00:00Z', actioned_by: 'ben' },
      { tenant_id: T, task_id: 'tk-review', user_id: 'ana', outcome: 'approved', outcome_notes: null, responded_at: '2026-11-01T03:00:00Z', actioned_by: 'mia' },
    ],
    lifecycle_events: [
      { tenant_id: T, task_id: 'tk-review', event_type: 'task_response', actor_id: 'mia', created_at: '2026-11-01T03:00:00Z', metadata: { outcome: 'approved', on_behalf_of: 'ana', on_behalf_note: 'Ana is on leave' } },
      { tenant_id: T, task_id: 'tk-approve', event_type: 'task_redirected', actor_id: 'tom', created_at: '2026-11-01T03:45:00Z', metadata: { to_user_ids: ['alice'], comment: 'Alice owns this vendor' } },
      { tenant_id: T, task_id: 'tk-approve', event_type: 'comment_added', actor_id: 'tom', created_at: '2026-11-01T03:46:00Z', metadata: { message: 'not history' } },
    ],
    users: [
      { id: 'alice', display_name: 'Alice Ng', avatar_url: null }, { id: 'ben', display_name: 'Ben Ode' }, { id: 'ana', display_name: 'Ana Ruiz' },
      { id: 'mia', display_name: 'Mia Park' }, { id: 'tom', display_name: 'Tom Lee' }, { id: 'ivan', display_name: 'Ivan Starter' },
    ],
    teams: [{ id: 'team-pay', tenant_id: T, name: 'Payments' }],
    user_teams: [{ team_id: 'team-pay', user_id: 'tess' }],
    user_roles: [{ tenant_id: T, user_id: 'olga', role_id: 'role-ops' }],
    user_memberships: [
      { tenant_id: T, user_id: 'alice', manager_user_id: 'mia', is_active: true },
      { tenant_id: T, user_id: 'mia', manager_user_id: 'carl', is_active: true },
      { tenant_id: T, user_id: 'ana', manager_user_id: 'mia', is_active: true },
    ],
    object_permissions: [
      { tenant_id: T, object_type: 'workflow', object_id: 'wf1', role_id: 'role-ops', user_id: null, team_id: null, can_view: true, can_edit: true },
      { tenant_id: T, object_type: 'workflow', object_id: 'wf1', role_id: null, user_id: 'vic', team_id: null, can_view: true, can_edit: false },
    ],
  }
}

const MEMBER = ['tasks.view_own', 'tasks.complete', 'workflows.view_queue']
function ctx(actorId: string | null, permissions: string[] | null, db = createMemorySupabase(seed())): ServiceContext {
  return { db, supabase: db, tenantId: T, actorId, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' } as unknown as ServiceContext
}
const labels = labelsOf(seed().workflows[0].nodes)
const load = (actorId: string | null, permissions: string[] | null) =>
  loadRunTasks(ctx(actorId, permissions), { id: RUN, workflow_id: 'wf1' }, { labels })
const byId = (tasks: RunTask[]) => Object.fromEntries(tasks.map((t) => [t.id, t]))

describe('run tasks: who each task is with', () => {
  it('only this run, oldest first, with step names, people and statuses', async () => {
    const tasks = await load('alice', MEMBER)
    expect(tasks.map((t) => t.id)).toEqual(['tk-review', 'tk-approve', 'tk-claim'])
    const t = byId(tasks)
    expect(t['tk-approve']).toMatchObject({ step_name: 'Approve invoice', open: true, status: 'waiting', has_form: true, waiting_since: '2026-11-01T04:00:00Z' })
    expect(t['tk-approve'].assignees).toEqual([{ id: 'alice', name: 'Alice Ng', avatar_url: null, role: 'assignee', status: 'in_progress' }])
    expect(t['tk-review'].assignees.map((a) => [a.name, a.role, a.status])).toEqual([['Ben Ode', 'collaborator', 'done'], ['Ana Ruiz', 'collaborator', 'done']])
    expect(t['tk-review']).toMatchObject({ status: 'completed', open: false, completed_by: { name: 'Mia Park' }, completed_on_behalf_of: { name: 'Ana Ruiz' } })
    expect(t['tk-claim']).toMatchObject({ team: 'Payments', assignees: [] })
    expect(runTaskWho(t['tk-review'])).toBe('Ben Ode +1')
    expect(runTaskAllNames(t['tk-review'])).toBe('Ben Ode and Ana Ruiz')
    expect(runTaskWho(t['tk-claim'])).toBe('Payments')
    expect(waitingTasks(tasks).map((x) => x.id)).toEqual(['tk-approve', 'tk-claim'])
  })

  it('queued / declined / candidate statuses', async () => {
    const s = seed()
    s.tasks.push({ id: 'tk-q', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'approve', title: 'Q', status: 'todo', is_workflow_task: true, event_id: 'e9',
      assignee_id: 'alice', acceptance_status: 'pending', created_at: '2026-11-02T00:00:00Z', metadata: {} } as any)
    s.tasks.push({ id: 'tk-c', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'claim', title: 'C', status: 'todo', is_workflow_task: true, event_id: 'e10',
      assignee_id: null, created_at: '2026-11-03T00:00:00Z', metadata: {} } as any)
    s.task_assignees.push({ tenant_id: T, task_id: 'tk-c', user_id: 'ben', role: 'candidate', acceptance_status: 'pending' })
    s.task_assignees.push({ tenant_id: T, task_id: 'tk-c', user_id: 'ana', role: 'collaborator', acceptance_status: 'rejected' })
    const t = byId(await loadRunTasks(ctx('alice', MEMBER, createMemorySupabase(s)), { id: RUN, workflow_id: 'wf1' }, { labels }))
    expect(t['tk-q'].assignees[0].status).toBe('queued')
    expect(t['tk-c'].assignees.map((a) => [a.role, a.status])).toEqual([['candidate', 'queued'], ['collaborator', 'declined']])
  })
})

describe('run tasks: per-caller access (persona matrix)', () => {
  it('the assignee: open + act as themselves, form tab link', async () => {
    const t = byId(await load('alice', MEMBER))['tk-approve']
    expect(t).toMatchObject({ can_open: true, can_act: 'assignee', access: 'assignee', href: '/tasks/tk-approve?tab=form', title: 'Approve invoice INV-7', on_behalf_of: null })
  })

  it('direct and indirect manager of the assignee: act on behalf', async () => {
    for (const manager of ['mia', 'carl']) {
      const t = byId(await load(manager, MEMBER))['tk-approve']
      expect(t).toMatchObject({ can_open: true, can_act: 'on_behalf', access: 'manager', on_behalf_of: { id: 'alice', name: 'Alice Ng' } })
    }
  })

  it('explicit workflow manager (Edit grant by role): open + act on behalf; View-only grant: neither', async () => {
    const olga = byId(await load('olga', MEMBER))
    expect(olga['tk-approve']).toMatchObject({ can_open: true, can_act: 'on_behalf', access: 'workflow_manager', on_behalf_of: { id: 'alice' } })
    // An unclaimed team task has nobody to act for: open, not act.
    expect(olga['tk-claim']).toMatchObject({ can_open: true, can_act: 'none', access: 'workflow_manager' })
    const vic = byId(await load('vic', MEMBER))
    expect(vic['tk-approve']).toMatchObject({ can_open: false, can_act: 'none', access: null, href: null, title: null })
  })

  it('admin (tasks.view_all): opens every task; acts only with tasks.complete_any (break-glass)', async () => {
    const admin = byId(await load('adam', [...MEMBER, 'tasks.view_all', 'workflows.view_runs']))
    expect(admin['tk-approve']).toMatchObject({ can_open: true, can_act: 'none', access: 'admin', href: '/tasks/tk-approve?tab=form' })
    const owner = byId(await load('owen', [...MEMBER, 'tasks.view_all', 'workflows.view_runs', 'tasks.complete_any']))
    expect(owner['tk-approve']).toMatchObject({ can_open: true, can_act: 'on_behalf', access: 'admin', on_behalf_of: { id: 'alice' } })
  })

  it('team member of an unclaimed team task acts as assignee (claim)', async () => {
    expect(byId(await load('tess', MEMBER))['tk-claim']).toMatchObject({ can_open: true, can_act: 'assignee', access: 'assignee' })
  })

  it('the initiator alone: sees who it is with, never opens / acts; details redacted', async () => {
    const t = byId(await load('ivan', MEMBER))
    expect(t['tk-approve']).toMatchObject({ can_open: false, can_act: 'none', href: null, title: null, assignees: [{ name: 'Alice Ng' }] })
    // Completed step: who + when, no outcome / comments / redirect lines.
    expect(t['tk-review']).toMatchObject({ outcome: null, completed_by: { name: 'Mia Park' } })
    expect(t['tk-review'].history.map((h) => [h.kind, h.actor?.name, h.on_behalf_of?.name ?? null, h.outcome, h.comment])).toEqual([
      ['response', 'Ben Ode', null, null, null],
      ['response', 'Mia Park', 'Ana Ruiz', null, null],
    ])
    expect(t['tk-approve'].history).toEqual([])
  })

  it('without tasks.complete nobody acts (open only)', async () => {
    expect(byId(await load('alice', ['tasks.view_own', 'workflows.view_queue']))['tk-approve']).toMatchObject({ can_open: true, can_act: 'none' })
  })

  it('closed tasks are never actionable', async () => {
    expect(byId(await load('ben', MEMBER))['tk-review']).toMatchObject({ can_open: true, can_act: 'none' })
  })
})

describe('run tasks: step history', () => {
  it('every response (outcome, comment, on behalf with its reason) and redirects, for callers who may open the task', async () => {
    const t = byId(await load('mia', MEMBER))
    expect(t['tk-review'].outcome).toBe('approved')
    expect(t['tk-review'].history.map((h) => ({ kind: h.kind, actor: h.actor?.name, behalf: h.on_behalf_of?.name ?? null, outcome: h.outcome, comment: h.comment }))).toEqual([
      { kind: 'response', actor: 'Ben Ode', behalf: null, outcome: 'approved', comment: 'Numbers check out' },
      { kind: 'response', actor: 'Mia Park', behalf: 'Ana Ruiz', outcome: 'approved', comment: 'Ana is on leave' },
    ])
    expect(t['tk-approve'].history).toEqual([
      expect.objectContaining({ kind: 'redirected', from: ['Tom Lee'], to: ['Alice Ng'], comment: 'Alice owns this vendor', at: '2026-11-01T03:45:00Z' }),
    ])
  })

  it('a completion without per-person responses (credential) still says who / when', async () => {
    const s = seed()
    s.tasks.push({ id: 'tk-api', tenant_id: T, workflow_run_id: RUN, workflow_id: 'wf1', workflow_step_id: 'approve', title: 'API', status: 'completed', is_workflow_task: true, event_id: 'e11',
      assignee_id: 'alice', created_at: '2026-11-04T00:00:00Z', completed_at: '2026-11-04T01:00:00Z', outcome: 'rejected', outcome_notes: 'Duplicate', actioned_by: null, metadata: {} } as any)
    const t = byId(await loadRunTasks(ctx('alice', MEMBER, createMemorySupabase(s)), { id: RUN, workflow_id: 'wf1' }, { labels }))['tk-api']
    expect(t.history).toEqual([expect.objectContaining({ kind: 'completed', outcome: 'rejected', comment: 'Duplicate', at: '2026-11-04T01:00:00Z' })])
    expect(runOutcomeTone('rejected')).toBe('danger')
    expect(runOutcomeTone('approved')).toBe('success')
    expect(runOutcomeTone('ask_for_changes')).toBe('warning')
    expect(runOutcomeTone('escalate_to_cfo')).toBe('brand')
  })

  it('REST / MCP helper loads step labels from the workflow', async () => {
    const tasks = await loadRunTasksForRun(ctx('alice', MEMBER), { id: RUN, workflow_id: 'wf1' })
    expect(tasks.map((t) => t.step_name)).toEqual(['Finance review', 'Approve invoice', 'Pay'])
  })
})

describe('full run read (automations.processView): unrelated users get nothing', () => {
  it('returns the tasks for someone in scope, null for an unrelated user', async () => {
    const memory = createMemorySupabase({
      ...seed(),
      workflow_runs: seed().workflow_runs.map((r) => ({ ...r, workflow: { id: r.workflow_id, nodes: seed().workflows[0].nodes } })),
      form_submissions: [],
    })
    const m: any = memory
    const from = m.from
    m.from = (table: string) => { const b = from(table); b.not = () => b; return b }
    vi.resetModules()
    vi.doMock('@/lib/cron-auth', () => ({ createServiceClient: () => memory }))
    const { runUiRead } = await import('@/lib/services/ui-reads')
    const sessionCtx = (actorId: string, perms: string[]) => ({ db: memory, supabase: memory, tenantId: T, actorId, permissions: new Set(perms), authKind: 'session', source: 'ui' }) as unknown as ServiceContext
    const mine = await runUiRead(sessionCtx('alice', MEMBER), { name: 'automations.processView', args: { id: RUN } })
    expect(mine).toMatchObject({ ok: true })
    expect(((mine as any).data.tasks as RunTask[]).find((t) => t.id === 'tk-approve')).toMatchObject({ can_open: true, can_act: 'assignee' })
    const stranger = await runUiRead(sessionCtx('zoe', MEMBER), { name: 'automations.processView', args: { id: RUN } })
    expect(stranger).toMatchObject({ ok: true, data: null })
    vi.doUnmock('@/lib/cron-auth')
  })
})
