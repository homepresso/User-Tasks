import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn(), getProcessorSecret: vi.fn(() => 'processor-secret') }))
vi.mock('@/lib/services/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/context')>()
  return { ...actual, fromSession: vi.fn() }
})
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { writeAudit } from '@/lib/audit-log'
import { createServiceClient } from '@/lib/cron-auth'
import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { fromSession, ServiceError, type ServiceContext } from '@/lib/services/context'
import { actOnQueueJobAction, deleteQueueJob } from '@/app/actions/workflow-queue'
import { queueLeaseExpired } from '@/lib/automations/queue-filters'
import { resetQueueKickState } from '@/lib/process-queue'
import { POST as queueActionRoute } from '@/app/api/v1/workflows/queue/[id]/action/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / JSON payloads */

const A = 'tenant-a'
const B = 'tenant-b'
const WF = 'aaaaaaaa-0000-4000-8000-000000000001'
const job = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const J = {
  pending: job(1), failed: job(2), dead: job(3), completed: job(4), processing: job(5), otherTenant: job(6), stuck: job(7),
}
const RUN = 'dddddddd-0000-4000-8000-000000000001'

function seed() {
  const db = createMemorySupabase({
    workflow_queue: [
      { id: J.pending, tenant_id: A, workflow_id: WF, status: 'pending', trigger_type: 'task_created' },
      { id: J.failed, tenant_id: A, workflow_id: WF, status: 'failed', trigger_type: 'task_created' },
      { id: J.dead, tenant_id: A, workflow_id: WF, status: 'dead', trigger_type: 'task_created' },
      { id: J.completed, tenant_id: A, workflow_id: WF, status: 'completed', trigger_type: 'task_created' },
      { id: J.processing, tenant_id: A, workflow_id: WF, status: 'processing', trigger_type: 'task_created', locked_by: 'worker-live', locked_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() + 60_000).toISOString(), lease_lost_count: 0 },
      { id: J.stuck, tenant_id: A, workflow_id: WF, status: 'processing', trigger_type: 'task_created', locked_by: 'worker-dead', locked_at: new Date(Date.now() - 600_000).toISOString(), lease_expires_at: new Date(Date.now() - 60_000).toISOString(), lease_lost_count: 0, run_id: RUN },
      { id: J.otherTenant, tenant_id: B, workflow_id: WF, status: 'pending', trigger_type: 'task_created' },
    ],
    workflow_runs: [
      { id: RUN, tenant_id: A, workflow_id: WF, status: 'running' },
    ],
  }) as any
  db.rpc = async (name: string, args: any) => {
    if (name !== 'recover_queue_job') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
    return { data: recoverQueueJobFake(db, args), error: null }
  }
  return db
}
type Db = ReturnType<typeof seed>

/** In-memory mirror of public.recover_queue_job (migration 20270124090000). */
function recoverQueueJobFake(db: any, args: any) {
  const row = db.tables.workflow_queue.find((r: any) => r.id === args.p_job_id && r.tenant_id === args.p_tenant_id)
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status !== 'processing') return { ok: false, reason: 'not_processing', status: row.status }
  const expired = queueLeaseExpired(row.lease_expires_at, row.locked_at)
  if (!expired && (args.p_action === 'retry' || !args.p_force)) return { ok: false, reason: 'lease_active', locked_by: row.locked_by }
  const lockedBy = row.locked_by
  if (args.p_action === 'retry') {
    Object.assign(row, { status: 'pending', attempts: 0, error: null, locked_by: null, locked_at: null, lease_expires_at: null, lease_lost_count: (row.lease_lost_count ?? 0) + 1 })
  } else {
    Object.assign(row, { status: 'dead', error: expired ? 'Cancelled after the worker was lost (lease expired)' : 'Force-cancelled while a worker was processing it', locked_by: null, locked_at: null, lease_expires_at: null })
    const run = db.tables.workflow_runs.find((r: any) => r.id === row.run_id && r.status === 'running')
    if (run) Object.assign(run, { status: 'failed', error: 'Cancelled from the workflow queue while processing' })
  }
  return { ok: true, action: args.p_action, lease_expired: expired, locked_by: lockedBy, run_id: row.run_id ?? null }
}

const ids = (db: Db) => db.tables.workflow_queue.map((r: any) => r.id)

function session(permissions: string[], tenantId = A): ServiceContext {
  // fromSession hands back the cookie client; the action swaps in the
  // service-role client (createServiceClient, mocked to the memory db).
  return { supabase: { from: () => { throw new Error('cookie client must not be used') } } as any, tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

describe('deleteQueueJob server action', () => {
  let db: Db
  beforeEach(() => {
    db = seed()
    vi.mocked(createServiceClient).mockReturnValue(db)
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate', 'workflows.view_runs']))
    vi.mocked(writeAudit).mockClear()
  })

  it('deletes pending / failed / dead / completed jobs of the caller workspace and audits each', async () => {
    for (const id of [J.pending, J.failed, J.dead, J.completed]) {
      const result = await deleteQueueJob(id)
      expect(result).toMatchObject({ deleted: true, id })
    }
    expect(ids(db).sort()).toEqual([J.processing, J.otherTenant, J.stuck].sort())
    expect(vi.mocked(writeAudit)).toHaveBeenCalledTimes(4)
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({
      tenantId: A, actorId: 'user-1', objectType: 'workflow', objectId: WF, action: 'delete_queue_job',
      metadata: { job_id: J.pending, status: 'pending', via: 'ui' },
    })
  })

  it('requires workflows.activate', async () => {
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.view']))
    const result = await deleteQueueJob(J.pending)
    expect(result).toEqual({ error: "Forbidden: you lack the 'workflows.activate' permission" })
    expect(ids(db)).toContain(J.pending)
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled()
  })

  it('needs the job in the run scope too: activate + involved-only queue access cannot delete a job they are not involved in', async () => {
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate', 'workflows.view_queue']))
    expect(await deleteQueueJob(J.pending)).toEqual({ error: 'Queue job not found' })
    expect(ids(db)).toContain(J.pending)
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate']))
    expect(await deleteQueueJob(J.pending)).toEqual({ error: "Forbidden: you lack the 'workflows.view_queue' permission" })
  })

  it('refuses a job a worker is processing', async () => {
    const result = await deleteQueueJob(J.processing)
    expect(result).toEqual({ error: expect.stringMatching(/being processed/) })
    expect(ids(db)).toContain(J.processing)
  })

  it("cannot see or delete another workspace's job", async () => {
    expect(await deleteQueueJob(J.otherTenant)).toEqual({ error: 'Queue job not found' })
    expect(ids(db)).toContain(J.otherTenant)
    // …even with the permission held in that other workspace, the job of the
    // current one is the only thing in scope.
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate', 'workflows.view_runs'], B))
    expect(await deleteQueueJob(J.pending)).toEqual({ error: 'Queue job not found' })
    expect(ids(db)).toContain(J.pending)
  })

  it('404s an unknown or malformed id', async () => {
    expect(await deleteQueueJob(job(99))).toEqual({ error: 'Queue job not found' })
    expect(await deleteQueueJob('run:abc')).toEqual({ error: 'Queue job not found' })
  })

  it('refuses when a worker claims the job between the check and the delete', async () => {
    // Flip the job to processing right after the service reads it.
    const from = db.from.bind(db)
    let reads = 0
    db.from = (table: string) => {
      const builder = from(table)
      if (table !== 'workflow_queue') return builder
      const maybeSingle = builder.maybeSingle.bind(builder)
      builder.maybeSingle = () => {
        const pending = maybeSingle()
        return {
          then: (resolve: any, reject: any) => Promise.resolve(pending).then((res: any) => {
            if (reads++ === 0) db.tables.workflow_queue.find((r: any) => r.id === J.pending).status = 'processing'
            return res
          }).then(resolve, reject),
        }
      }
      return builder
    }
    const result = await deleteQueueJob(J.pending)
    expect(result).toEqual({ error: expect.stringMatching(/being processed/) })
    expect(ids(db)).toContain(J.pending)
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled()
  })

  it('reports an unauthenticated session', async () => {
    vi.mocked(fromSession).mockRejectedValue(new ServiceError('unauthorized', 'Not authenticated'))
    expect(await deleteQueueJob(J.pending)).toEqual({ error: 'Not authenticated' })
  })
})

describe('POST /workflows/queue/{id}/action (shares the queue rules)', () => {
  let db: Db
  const fetchMock = vi.fn(async () => new Response('{}'))
  beforeEach(() => {
    db = seed()
    resetQueueKickState()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    vi.mocked(writeAudit).mockClear()
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: A, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ['workflows.activate', 'workflows.view_runs'],
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as any)
  })
  const call = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    const res = await queueActionRoute(new NextRequest(`https://app.test/api/v1/workflows/queue/${id}/action`, {
      method: 'POST', headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }),
    }), { params: Promise.resolve({ id }) })
    return { status: res.status, body: (await res.json()) as any }
  }
  const row = (id: string) => db.tables.workflow_queue.find((r: any) => r.id === id)

  it('cancels a pending job (dead, "Cancelled via API") and audits it', async () => {
    const res = await call(J.pending, 'cancel')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ action: 'cancelled', previous_status: 'pending' })
    expect(row(J.pending)).toMatchObject({ status: 'dead', error: 'Cancelled via API' })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'cancel_queue_job', metadata: { via: 'api' } })
  })

  it('refuses to cancel a processing or finished job', async () => {
    expect((await call(J.processing, 'cancel')).status).toBe(409)
    expect(row(J.processing).status).toBe('processing')
    expect((await call(J.completed, 'cancel')).status).toBe(409)
    expect(row(J.completed).status).toBe('completed')
  })

  it('retries failed / dead jobs only and kicks the processor', async () => {
    const res = await call(J.dead, 'retry')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ action: 'retried' })
    expect(row(J.dead)).toMatchObject({ status: 'pending', attempts: 0, error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The kick now carries the processor secret (it used to be sent without one and refused).
    expect(((fetchMock.mock.calls[0] as any)[1].headers as Record<string, string>)['X-Processor-Secret']).toBe('processor-secret')
    expect((await call(J.pending, 'retry')).status).toBe(400)
  })

  it("404s another tenant's job and honours the key's workflow allowlist", async () => {
    expect((await call(J.otherTenant, 'cancel')).status).toBe(404)
    expect(row(J.otherTenant).status).toBe('pending')
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: A, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: ['cccccccc-0000-4000-8000-000000000000'], table_ids: [] }, permissions: ['workflows.activate', 'workflows.view_runs'],
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as any)
    expect((await call(J.pending, 'cancel')).status).toBe(403)
    expect(row(J.pending).status).toBe('pending')
  })

  it('retries a stuck processing job (lease expired), audits it and kicks the processor', async () => {
    const res = await call(J.stuck, 'retry')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ action: 'retried', previous_status: 'processing', lease_expired: true })
    expect(row(J.stuck)).toMatchObject({ status: 'pending', attempts: 0, locked_by: null, lease_lost_count: 1 })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({
      action: 'retry_queue_job', metadata: { job_id: J.stuck, lease_expired: true, worker: 'worker-dead', forced: false, via: 'api' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels a stuck processing job and fails its unfinished run', async () => {
    const res = await call(J.stuck, 'cancel')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ action: 'cancelled', previous_status: 'processing', forced: false, lease_expired: true })
    expect(row(J.stuck).status).toBe('dead')
    expect(db.tables.workflow_runs[0]).toMatchObject({ status: 'failed' })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'cancel_queue_job' })
  })

  it('refuses to retry a job whose worker is alive, even with force (it would run twice)', async () => {
    const res = await call(J.processing, 'retry', { force: true })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/still processing/)
    expect(row(J.processing).status).toBe('processing')
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled()
  })

  it('force-cancels a live processing job only with force: true, audited as a forced cancel', async () => {
    expect((await call(J.processing, 'cancel')).status).toBe(409)
    const res = await call(J.processing, 'cancel', { force: true })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ action: 'cancelled', forced: true, lease_expired: false })
    expect(row(J.processing)).toMatchObject({ status: 'dead', error: 'Force-cancelled while a worker was processing it' })
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'force_cancel_queue_job', metadata: { forced: true } })
  })

  it('keeps refusing processing jobs before the lease migration is applied', async () => {
    db.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    const res = await call(J.stuck, 'retry')
    expect(res.status).toBe(409)
    expect(row(J.stuck).status).toBe('processing')
  })
})

describe('queue UI: retry / cancel of stuck jobs (server action)', () => {
  let db: Db
  beforeEach(() => {
    db = seed()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    vi.mocked(createServiceClient).mockReturnValue(db)
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate', 'workflows.view_runs']))
    vi.mocked(writeAudit).mockClear()
  })

  it('retries a stuck job from the queue', async () => {
    expect(await actOnQueueJobAction(J.stuck, 'retry')).toMatchObject({ action: 'retried' })
    expect(db.tables.workflow_queue.find((r: any) => r.id === J.stuck).status).toBe('pending')
    expect(vi.mocked(writeAudit).mock.calls[0][0]).toMatchObject({ action: 'retry_queue_job', metadata: { via: 'ui' } })
  })

  it('needs workflows.activate', async () => {
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.view_runs']))
    expect(await actOnQueueJobAction(J.stuck, 'retry')).toEqual({ error: "Forbidden: you lack the 'workflows.activate' permission" })
  })

  it('force-cancel needs the force flag the confirmation sends', async () => {
    expect(await actOnQueueJobAction(J.processing, 'cancel')).toMatchObject({ error: expect.stringMatching(/Force-cancel/) })
    expect(await actOnQueueJobAction(J.processing, 'cancel', { force: true })).toMatchObject({ action: 'cancelled', forced: true })
  })
})

describe('queueLeaseExpired (mirror of public.queue_job_lease_expired)', () => {
  const now = Date.parse('2026-11-22T12:00:00Z')
  it('judges by the lease when there is one', () => {
    expect(queueLeaseExpired('2026-11-22T11:59:59Z', '2026-11-22T11:00:00Z', now)).toBe(true)
    expect(queueLeaseExpired('2026-11-22T12:00:30Z', '2026-11-22T11:00:00Z', now)).toBe(false)
  })
  it('without a lease (claimed by older code): stuck 15 minutes after the claim', () => {
    expect(queueLeaseExpired(null, '2026-11-22T11:50:00Z', now)).toBe(false)
    expect(queueLeaseExpired(null, '2026-11-22T11:40:00Z', now)).toBe(true)
    expect(queueLeaseExpired(null, null, now)).toBe(true)
  })
})
