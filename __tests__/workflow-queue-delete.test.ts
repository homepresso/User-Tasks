import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn() }))
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
import { deleteQueueJob } from '@/app/actions/workflow-queue'
import { POST as queueActionRoute } from '@/app/api/v1/workflows/queue/[id]/action/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / JSON payloads */

const A = 'tenant-a'
const B = 'tenant-b'
const WF = 'aaaaaaaa-0000-4000-8000-000000000001'
const job = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const J = {
  pending: job(1), failed: job(2), dead: job(3), completed: job(4), processing: job(5), otherTenant: job(6),
}

function seed() {
  return createMemorySupabase({
    workflow_queue: [
      { id: J.pending, tenant_id: A, workflow_id: WF, status: 'pending', trigger_type: 'task_created' },
      { id: J.failed, tenant_id: A, workflow_id: WF, status: 'failed', trigger_type: 'task_created' },
      { id: J.dead, tenant_id: A, workflow_id: WF, status: 'dead', trigger_type: 'task_created' },
      { id: J.completed, tenant_id: A, workflow_id: WF, status: 'completed', trigger_type: 'task_created' },
      { id: J.processing, tenant_id: A, workflow_id: WF, status: 'processing', trigger_type: 'task_created' },
      { id: J.otherTenant, tenant_id: B, workflow_id: WF, status: 'pending', trigger_type: 'task_created' },
    ],
  }) as any
}
type Db = ReturnType<typeof seed>

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
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate']))
    vi.mocked(writeAudit).mockClear()
  })

  it('deletes pending / failed / dead / completed jobs of the caller workspace and audits each', async () => {
    for (const id of [J.pending, J.failed, J.dead, J.completed]) {
      const result = await deleteQueueJob(id)
      expect(result).toMatchObject({ deleted: true, id })
    }
    expect(ids(db).sort()).toEqual([J.processing, J.otherTenant].sort())
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
    vi.mocked(fromSession).mockResolvedValue(session(['workflows.activate'], B))
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
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    vi.mocked(writeAudit).mockClear()
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: A, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ['workflows.activate'],
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as any)
  })
  const call = async (id: string, action: string) => {
    const res = await queueActionRoute(new NextRequest(`https://app.test/api/v1/workflows/queue/${id}/action`, {
      method: 'POST', headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: JSON.stringify({ action }),
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
    expect((await call(J.pending, 'retry')).status).toBe(400)
  })

  it("404s another tenant's job and honours the key's workflow allowlist", async () => {
    expect((await call(J.otherTenant, 'cancel')).status).toBe(404)
    expect(row(J.otherTenant).status).toBe('pending')
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: A, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: ['cccccccc-0000-4000-8000-000000000000'], table_ids: [] }, permissions: ['workflows.activate'],
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as any)
    expect((await call(J.pending, 'cancel')).status).toBe(403)
    expect(row(J.pending).status).toBe('pending')
  })
})
