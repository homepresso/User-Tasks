/**
 * Invite (read only): the pure rules (lib/task-authz.ts) and the service's
 * input parsing (lib/services/task-viewers.ts). The database behaviour —
 * visibility through people / teams / roles, the tracker, the dependency
 * search, RLS — is in task-viewers-db.test.ts.
 */
import { describe, expect, it } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- a minimal stand-in client */
import {
  canViewTask, decideTaskComment, decideViewerManagement, describeTaskAccess, findTaskViewerGrant, type TaskActorFacts,
} from '@/lib/task-authz'
import { parseViewerPrincipals, viewerLabel } from '@/lib/services/task-viewers'

const none: TaskActorFacts = { isAssignee: false, isTeamMember: false, assigneeIds: ['assignee'], managedAssigneeId: null, isWorkflowManager: false }
const perms = (...keys: string[]) => new Set(keys)
const decideTaskAccessForTest = (db: any, actorId: string) => describeTaskAccess(db, { tenantId: 't', taskId: 'task', actorId, permissions: perms('tasks.view_own', 'tasks.complete') })
const U1 = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'

describe('who may invite viewers (decideViewerManagement)', () => {
  it('the people working on the task, the assigner, managers, workflow managers and admins', () => {
    const p = perms('tasks.view_own', 'tasks.complete')
    expect(decideViewerManagement({ actorId: 'u', permissions: p, facts: { ...none, isAssignee: true } })).toEqual({ allowed: true, basis: 'assignee' })
    expect(decideViewerManagement({ actorId: 'u', permissions: p, facts: { ...none, isTeamMember: true } })).toEqual({ allowed: true, basis: 'assignee' })
    expect(decideViewerManagement({ actorId: 'u', permissions: p, facts: none, assignerId: 'u' })).toEqual({ allowed: true, basis: 'assigner' })
    expect(decideViewerManagement({ actorId: 'u', permissions: p, facts: { ...none, managedAssigneeId: 'assignee' } })).toEqual({ allowed: true, basis: 'manager' })
    expect(decideViewerManagement({ actorId: 'u', permissions: p, facts: { ...none, isWorkflowManager: true } })).toEqual({ allowed: true, basis: 'workflow_manager' })
    expect(decideViewerManagement({ actorId: 'u', permissions: perms('tasks.complete_any'), facts: none })).toEqual({ allowed: true, basis: 'admin' })
  })

  it('not viewers or unrelated people (an invite is never one of the facts), and credentials only with tasks.complete_any', () => {
    expect(decideViewerManagement({ actorId: 'viewer', permissions: perms('tasks.view_own', 'tasks.complete', 'tasks.view_all'), facts: none, assignerId: 'someone' }))
      .toMatchObject({ allowed: false, status: 403 })
    expect(decideViewerManagement({ actorId: null, permissions: perms('tasks.view_all'), facts: none })).toMatchObject({ allowed: false })
    expect(decideViewerManagement({ actorId: null, permissions: perms('tasks.complete_any'), facts: none })).toEqual({ allowed: true, basis: 'credential' })
  })
})

describe('who may comment (decideTaskComment)', () => {
  it('workers on the task with tasks.complete; invited viewers always (read + comment)', () => {
    expect(decideTaskComment({ permissions: perms('tasks.complete'), reachable: true, viewer: false })).toBe(true)
    expect(decideTaskComment({ permissions: perms('tasks.view_own'), reachable: true, viewer: false })).toBe(false)
    expect(decideTaskComment({ permissions: perms('tasks.view_own'), reachable: false, viewer: true })).toBe(true)
    expect(decideTaskComment({ permissions: perms('tasks.view_all'), reachable: false, viewer: true })).toBe(true)
    expect(decideTaskComment({ permissions: perms('tasks.complete'), reachable: false, viewer: false })).toBe(false)
    expect(decideTaskComment({ permissions: perms(), reachable: false, viewer: true })).toBe(false)
  })
})

describe('viewer grants and read access', () => {
  /** A minimal client: task_viewer_grant answers `grant`; reads return the given rows. */
  function client(opts: { grant: string | null; rows?: Record<string, any[]>; rpcError?: boolean }) {
    const calls: string[] = []
    const chain = (table: string) => {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select: () => api, is: () => api, in: () => api, order: () => api, limit: () => api,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return api },
        maybeSingle: async () => ({ data: (opts.rows?.[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v)) ?? null, error: null }),
        then: (resolve: any) => resolve({ data: opts.rows?.[table] ?? [], error: null }),
      }
      return api
    }
    return {
      calls,
      from: (table: string) => { calls.push(table); return chain(table) },
      rpc: async (name: string) => { calls.push(`rpc:${name}`); return opts.rpcError ? { data: null, error: { message: 'missing' } } : { data: opts.grant, error: null } },
    }
  }

  it('findTaskViewerGrant: the invite row, inherited when it is on a parent; null without one, without rpc or before the migration', async () => {
    const row = { id: 'v1', task_id: 'parent', principal_type: 'team', principal_id: 'team-1', invited_by: 'boss', tenant_id: 't' }
    expect(await findTaskViewerGrant(client({ grant: 'v1', rows: { task_viewers: [row] } }), 't', 'u', 'child'))
      .toEqual({ id: 'v1', task_id: 'parent', principal_type: 'team', principal_id: 'team-1', invited_by: 'boss', inherited: true })
    expect(await findTaskViewerGrant(client({ grant: null }), 't', 'u', 'task')).toBeNull()
    expect(await findTaskViewerGrant(client({ grant: 'v1', rpcError: true }), 't', 'u', 'task')).toBeNull()
    expect(await findTaskViewerGrant({ from: () => null }, 't', 'u', 'task')).toBeNull()
    expect(await findTaskViewerGrant(client({ grant: 'v1' }), 't', null, 'task')).toBeNull()
  })

  it('canViewTask: an invite opens a task the person cannot reach; reach alone still works', async () => {
    const task = { id: 'task', tenant_id: 't', assignee_id: 'assignee', assigner_id: null, parent_task_id: null }
    const viewer = client({ grant: 'v1', rows: { tasks: [task], task_viewers: [{ id: 'v1', task_id: 'task', principal_type: 'user', principal_id: 'u', invited_by: null, tenant_id: 't' }] } })
    expect(await canViewTask(viewer, { tenantId: 't', taskId: 'task', actorId: 'u', permissions: perms('tasks.view_own') })).toBe(true)
    const stranger = client({ grant: null, rows: { tasks: [task] } })
    expect(await canViewTask(stranger, { tenantId: 't', taskId: 'task', actorId: 'u', permissions: perms('tasks.view_own') })).toBe(false)
    expect(await canViewTask(stranger, { tenantId: 't', taskId: 'task', actorId: 'u', permissions: perms('tasks.view_all') })).toBe(true)
  })

  it('describeTaskAccess: a viewer is mode none with the invite; a worker gets canManageViewers', async () => {
    const task = { id: 'task', tenant_id: 't', status: 'todo', assignee_id: 'assignee', assigner_id: 'assigner', assigned_team_id: null, deleted_at: null, is_workflow_task: true, event_id: 'e' }
    const rows = { tasks: [task], task_viewers: [{ id: 'v1', task_id: 'task', principal_type: 'role', principal_id: 'r', invited_by: 'assigner', tenant_id: 't' }] }
    expect(await decideTaskAccessForTest(client({ grant: 'v1', rows }), 'viewer')).toMatchObject({ mode: 'none', canManageViewers: false, viewer: { invitedBy: 'assigner', principalType: 'role', inherited: false } })
    const assigner = await decideTaskAccessForTest(client({ grant: null, rows }), 'assigner')
    expect(assigner).toMatchObject({ canManageViewers: true })
    expect(assigner?.viewer).toBeUndefined()
  })
})

describe('invite input (parseViewerPrincipals)', () => {
  it('validates types and ids, lower-cases and de-duplicates', () => {
    expect(parseViewerPrincipals([{ type: 'user', id: U1.toUpperCase() }, { type: 'user', id: U1 }, { type: 'team', id: T1 }]))
      .toEqual([{ type: 'user', id: U1 }, { type: 'team', id: T1 }])
    expect(() => parseViewerPrincipals([])).toThrow(/at least one/)
    expect(() => parseViewerPrincipals([{ type: 'group', id: U1 }])).toThrow(/user, team or role/)
    expect(() => parseViewerPrincipals([{ type: 'role', id: 'nope' }])).toThrow(/Invalid role id/)
    const many = Array.from({ length: 51 }, (_, i) => ({ type: 'user', id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}` }))
    expect(() => parseViewerPrincipals(many)).toThrow(/at most 50/)
  })

  it('labels: a person by name, groups with their kind', () => {
    expect(viewerLabel({ principal_type: 'user', name: 'Priya Nair' })).toBe('Priya Nair')
    expect(viewerLabel({ principal_type: 'team', name: 'Finance' })).toBe('Finance (team)')
    expect(viewerLabel({ principal_type: 'role', name: 'Auditors' })).toBe('Auditors (role)')
  })
})
