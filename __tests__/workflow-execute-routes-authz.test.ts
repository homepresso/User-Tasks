/**
 * POST /api/workflows/execute and /api/workflows/execute-stream run the
 * engine with a service-role client, so they must authorise the caller
 * themselves (lib/services/workflow-designer-runs): tenant-scoped workflow,
 * permission, task in the same tenant, and resume only of the caller's own
 * designer test runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflow-engine', () => ({
  executeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {}, run_id: 'run-new' })),
  resumeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {} })),
}))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/services/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/context')>()
  return { ...actual, fromSession: vi.fn() }
})

import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/cron-auth'
import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { fromSession, ServiceError, type ServiceContext } from '@/lib/services/context'
import { POST as executePOST } from '@/app/api/workflows/execute/route'
import { POST as streamPOST } from '@/app/api/workflows/execute-stream/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'aaaaaaaa-0000-4000-8000-000000000000'
const B = 'bbbbbbbb-0000-4000-8000-000000000000'
const USER = '11111111-0000-4000-8000-000000000001'
const OTHER_USER = '11111111-0000-4000-8000-000000000002'
const WF_A = 'a0000000-0000-4000-8000-000000000001'
const WF_A2 = 'a0000000-0000-4000-8000-000000000002'
const WF_B = 'b0000000-0000-4000-8000-000000000001'
const TASK_A = 'a1000000-0000-4000-8000-000000000001'
const TASK_B = 'b1000000-0000-4000-8000-000000000001'
const RUN_TEST = 'a2000000-0000-4000-8000-000000000001'
const RUN_PROD = 'a2000000-0000-4000-8000-000000000002'
const RUN_OTHER_USER = 'a2000000-0000-4000-8000-000000000003'
const RUN_B = 'b2000000-0000-4000-8000-000000000001'
const RUN_DONE = 'a2000000-0000-4000-8000-000000000004'

const ALL = {
  workflows: [
    { id: WF_A, tenant_id: A, name: 'A' },
    { id: WF_A2, tenant_id: A, name: 'A2' },
    { id: WF_B, tenant_id: B, name: 'B' },
  ],
  tasks: [
    { id: TASK_A, tenant_id: A },
    { id: TASK_B, tenant_id: B },
  ],
  workflow_runs: [
    { id: RUN_TEST, workflow_id: WF_A, tenant_id: A, status: 'waiting_for_event', event_id: 'evt_test',
      pause_variables: { workflow_started_via: 'test', workflow_started_by: USER } },
    { id: RUN_PROD, workflow_id: WF_A, tenant_id: A, status: 'waiting_for_event', event_id: 'evt_prod',
      pause_variables: { workflow_started_via: 'ui', workflow_started_by: USER } },
    { id: RUN_OTHER_USER, workflow_id: WF_A, tenant_id: A, status: 'waiting_for_event', event_id: 'evt_other',
      pause_variables: { workflow_started_via: 'test', workflow_started_by: OTHER_USER } },
    { id: RUN_B, workflow_id: WF_B, tenant_id: B, status: 'waiting_for_event', event_id: 'evt_b',
      pause_variables: { workflow_started_via: 'test', workflow_started_by: USER } },
    { id: RUN_DONE, workflow_id: WF_A, tenant_id: A, status: 'completed', event_id: null,
      pause_variables: { workflow_started_via: 'test', workflow_started_by: USER } },
  ],
}

/** Rows the caller's RLS-scoped client sees: only the given tenants. */
function visibleTo(tenants: string[]) {
  const pick = (rows: any[]) => rows.filter((row) => tenants.includes(row.tenant_id))
  return createMemorySupabase({ workflows: pick(ALL.workflows), tasks: pick(ALL.tasks), workflow_runs: pick(ALL.workflow_runs) })
}

interface Session {
  signedIn: boolean
  /** current workspace; null = unified view (home tenant A is used). */
  current: string | null
  memberOf: string[]
  perms: Record<string, string[]>
}
let session: Session

function ctxFor(tenantId: string, visible: string[]): ServiceContext {
  const db = visibleTo(visible) as any
  return {
    db, supabase: db, tenantId, actorId: USER,
    permissions: new Set(session.perms[tenantId] ?? []),
    authKind: 'session', source: 'ui',
  }
}

beforeEach(() => {
  vi.mocked(executeWorkflow).mockClear()
  vi.mocked(resumeWorkflow).mockClear()
  vi.mocked(createServiceClient).mockImplementation(() => createMemorySupabase(ALL) as any)
  session = { signedIn: true, current: A, memberOf: [A], perms: { [A]: ['workflows.view', 'workflows.edit', 'workflows.activate'] } }
  vi.mocked(fromSession).mockImplementation(async (options: { tenantId?: string } = {}) => {
    if (!session.signedIn) throw new ServiceError('unauthorized', 'Not authenticated')
    if (options.tenantId) {
      if (!session.memberOf.includes(options.tenantId)) throw ServiceError.forbidden('Forbidden: you are not a member of that workspace')
      return ctxFor(options.tenantId, session.memberOf)
    }
    // RLS: COALESCE(current_tenant_id, member tenants)
    const visible = session.current ? [session.current] : session.memberOf
    return ctxFor(session.current ?? A, visible)
  })
})

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
const execute = (body: unknown) => executePOST(req('/api/workflows/execute', body))
const stream = (body: unknown, sse = false) =>
  streamPOST(req('/api/workflows/execute-stream', body, sse ? { accept: 'text/event-stream' } : {}))

describe('POST /api/workflows/execute', () => {
  it('401 when signed out', async () => {
    session.signedIn = false
    const res = await execute({ workflow_id: WF_A })
    expect(res.status).toBe(401)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('runs a workflow of the caller\'s tenant with workflows.activate, as the caller', async () => {
    const res = await execute({ workflow_id: WF_A, variables: { x: 1 } })
    expect(res.status).toBe(200)
    expect(executeWorkflow).toHaveBeenCalledWith(WF_A, undefined, false, { x: 1 }, undefined, undefined, undefined,
      { initiator: { userId: USER, via: 'ui' } })
  })

  it('test runs need workflows.edit', async () => {
    session.perms[A] = ['workflows.view', 'workflows.activate']
    expect((await execute({ workflow_id: WF_A, test: true })).status).toBe(403)
    session.perms[A] = ['workflows.view', 'workflows.edit']
    const res = await execute({ workflow_id: WF_A, test: true })
    expect(res.status).toBe(200)
    expect(vi.mocked(executeWorkflow).mock.calls[0][2]).toBe(true)
    expect(vi.mocked(executeWorkflow).mock.calls[0][7]).toEqual({ initiator: { userId: USER, via: 'test' } })
  })

  it('403 in the same tenant without workflows.activate', async () => {
    session.perms[A] = ['workflows.view', 'workflows.edit']
    const res = await execute({ workflow_id: WF_A })
    expect(res.status).toBe(403)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('404 for another tenant\'s workflow (same answer as a missing id)', async () => {
    const other = await execute({ workflow_id: WF_B })
    const missing = await execute({ workflow_id: 'c0000000-0000-4000-8000-000000000009' })
    const junk = await execute({ workflow_id: 'not-a-uuid' })
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(junk.status).toBe(404)
    expect(await other.json()).toEqual(await missing.json())
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('a task must be in the workflow\'s tenant', async () => {
    expect((await execute({ workflow_id: WF_A, task_id: TASK_B })).status).toBe(404)
    expect((await execute({ workflow_id: WF_A, task_id: 'nope' })).status).toBe(404)
    expect(executeWorkflow).not.toHaveBeenCalled()
    const ok = await execute({ workflow_id: WF_A, task_id: TASK_A })
    expect(ok.status).toBe(200)
    expect(vi.mocked(executeWorkflow).mock.calls[0][1]).toBe(TASK_A)
  })

  it('unified view: acts in the workflow\'s tenant with that tenant\'s permissions', async () => {
    session = { signedIn: true, current: null, memberOf: [A, B], perms: { [A]: [], [B]: ['workflows.activate'] } }
    expect((await execute({ workflow_id: WF_B })).status).toBe(200)
    expect((await execute({ workflow_id: WF_A })).status).toBe(403)
  })
})

describe('POST /api/workflows/execute-stream — start a test run', () => {
  it('401 when signed out', async () => {
    session.signedIn = false
    expect((await stream({ workflow_id: WF_A })).status).toBe(401)
    expect((await stream({ workflow_id: WF_A, resume_event_id: RUN_TEST })).status).toBe(401)
    expect(executeWorkflow).not.toHaveBeenCalled()
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('starts a test run of the caller\'s workflow with workflows.edit', async () => {
    const res = await stream({ workflow_id: WF_A, variables: { a: 'b' } })
    expect(res.status).toBe(200)
    const call = vi.mocked(executeWorkflow).mock.calls[0]
    expect(call[0]).toBe(WF_A)
    expect(call[2]).toBe(true)
    expect(call[7]).toEqual({ initiator: { userId: USER, via: 'test' } })
  })

  it('403 without workflows.edit (streaming and JSON)', async () => {
    session.perms[A] = ['workflows.view', 'workflows.activate']
    expect((await stream({ workflow_id: WF_A })).status).toBe(403)
    expect((await stream({ workflow_id: WF_A }, true)).status).toBe(403)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('404 for another tenant\'s workflow (streaming and JSON)', async () => {
    expect((await stream({ workflow_id: WF_B })).status).toBe(404)
    expect((await stream({ workflow_id: WF_B }, true)).status).toBe(404)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('streams events for an authorised test run', async () => {
    const res = await stream({ workflow_id: WF_A }, true)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"done"')
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/workflows/execute-stream — resume', () => {
  it('resumes the caller\'s own designer test run (by run id or event id), pinned to the checked event', async () => {
    const byRun = await stream({ workflow_id: WF_A, resume_event_id: RUN_TEST, variables: { outcome: 'approve' } })
    expect(byRun.status).toBe(200)
    expect(vi.mocked(resumeWorkflow).mock.calls[0][0]).toBe(RUN_TEST)
    expect(vi.mocked(resumeWorkflow).mock.calls[0][1]).toMatchObject({ outcome: 'approve' })
    expect(vi.mocked(resumeWorkflow).mock.calls[0][3]).toEqual({ eventId: 'evt_test' })

    const byEvent = await stream({ resume_event_id: 'evt_test', variables: {} }, true)
    expect(byEvent.status).toBe(200)
    await byEvent.text()
    expect(vi.mocked(resumeWorkflow).mock.calls[1][0]).toBe(RUN_TEST)
  })

  it('denies resuming a production run waiting on a real task', async () => {
    const res = await stream({ workflow_id: WF_A, resume_event_id: RUN_PROD, variables: { outcome: 'approve' } })
    expect(res.status).toBe(403)
    expect((await stream({ resume_event_id: 'evt_prod' }, true)).status).toBe(403)
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('denies resuming someone else\'s test run', async () => {
    expect((await stream({ workflow_id: WF_A, resume_event_id: RUN_OTHER_USER })).status).toBe(403)
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('403 without workflows.edit, even for the caller\'s own test run', async () => {
    session.perms[A] = ['workflows.view', 'workflows.activate']
    expect((await stream({ workflow_id: WF_A, resume_event_id: RUN_TEST })).status).toBe(403)
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('404 for a run in another tenant, a missing run, or a workflow_id that is not the run\'s', async () => {
    const other = await stream({ resume_event_id: RUN_B })
    const otherByEvent = await stream({ resume_event_id: 'evt_b' })
    const missing = await stream({ resume_event_id: 'c2000000-0000-4000-8000-000000000009' })
    const mismatched = await stream({ workflow_id: WF_A2, resume_event_id: RUN_TEST })
    expect([other.status, otherByEvent.status, missing.status, mismatched.status]).toEqual([404, 404, 404, 404])
    expect(await other.json()).toEqual(await missing.json())
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('409 for a run that is no longer waiting', async () => {
    expect((await stream({ workflow_id: WF_A, resume_event_id: RUN_DONE })).status).toBe(409)
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })
})
