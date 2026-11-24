/**
 * Settings → Infrastructure → Processing and /api/v1/admin/processing:
 * instance admins only (the Infrastructure check), status from the queue
 * and the processing provider, instance-wide Retry / Cancel / Force-cancel
 * of processing jobs (audited in the job's workspace).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: sessionMock }))
const canSeeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: canSeeMock }))
const dbMock = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => dbMock.current }))
const auditMock = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/audit-log', () => ({ writeAudit: auditMock }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

import { recoverProcessingJob, refreshProcessingStatus } from '@/app/actions/processing'
import { __setProcessingProviderForTests } from '@/lib/processing/handoff'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const T = '0c000000-0000-4000-8000-00000000000a'
const WF = '0c000000-0000-4000-8000-0000000000a1'
const STUCK = '0c000000-0000-4000-8000-0000000000e1'
const LIVE = '0c000000-0000-4000-8000-0000000000e2'

function seed() {
  const fake = createFakeSupabase({
    workflows: [{ id: WF, tenant_id: T, name: 'Invoices' }],
    workflow_queue: [
      { id: LIVE, tenant_id: T, workflow_id: WF, status: 'processing', locked_by: 'w-live', locked_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 1, max_attempts: 3, lease_lost_count: 0 },
      { id: STUCK, tenant_id: T, workflow_id: WF, status: 'processing', locked_by: 'w-dead', locked_at: new Date(Date.now() - 600_000).toISOString(), lease_expires_at: new Date(Date.now() - 1000).toISOString(), attempts: 1, max_attempts: 3, lease_lost_count: 0 },
    ],
  })
  fake.rpcs.get_queue_health = () => ({ data: { due: 0, scheduled: 0, processing: 2, stuck: 1, retrying: 0, dead_24h: 0, oldest_due_seconds: 0, at: 'now' } })
  fake.rpcs.recover_queue_job = (args) => {
    const job = fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)!
    const expired = Date.parse(String(job.lease_expires_at)) < Date.now()
    if (!expired && (args.p_action === 'retry' || !args.p_force)) return { data: { ok: false, reason: 'lease_active' } }
    job.status = args.p_action === 'retry' ? 'pending' : 'dead'
    return { data: { ok: true, lease_expired: expired, locked_by: job.locked_by } }
  }
  dbMock.current = fake.client
  return fake
}

beforeEach(() => {
  sessionMock.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.com' } })
  canSeeMock.mockResolvedValue(true)
  auditMock.mockClear()
  __setProcessingProviderForTests(null)
})

describe('processing settings (instance admins only)', () => {
  it('refuses people who are not instance admins (workspace roles do not count)', async () => {
    seed()
    canSeeMock.mockResolvedValue(false)
    expect(await refreshProcessingStatus()).toEqual({ ok: false, error: 'Only instance administrators can see processing.' })
    expect(await recoverProcessingJob(STUCK, 'retry')).toMatchObject({ ok: false, status: 403 })
    sessionMock.mockResolvedValue({ user: null })
    expect(await refreshProcessingStatus()).toMatchObject({ ok: false })
  })

  it('shows web mode, queue health and processing jobs, stuck ones first', async () => {
    seed()
    const result = await refreshProcessingStatus()
    if (!result.ok) throw new Error(result.error)
    expect(result.status.mode).toBe('web')
    expect(result.status.provider).toBeNull()
    expect(result.status.queue).toMatchObject({ processing: 2, stuck: 1 })
    expect(result.status.jobs.map((j) => [j.id, j.stuck, j.workflow_name])).toEqual([[STUCK, true, 'Invoices'], [LIVE, false, 'Invoices']])
  })

  it("includes the processing provider's own status", async () => {
    seed()
    __setProcessingProviderForTests({ extensionId: 'processing', ctx: {} as any, provider: { handoff: async () => 'queue', status: async () => ({ mode: 'queue', label: 'Separate workers (2 online)', href: '/x/processing' }) } })
    const result = await refreshProcessingStatus()
    expect(result.ok && result.status).toMatchObject({ mode: 'queue', provider: { extension_id: 'processing', label: 'Separate workers (2 online)', href: '/x/processing' } })
  })

  it('retries a stuck job, audited in its workspace; a live job only force-cancels', async () => {
    const fake = seed()
    expect(await recoverProcessingJob(STUCK, 'retry')).toEqual({ ok: true, action: 'retry', lease_expired: true, forced: false })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: T, actorId: 'admin-1', action: 'retry_queue_job', metadata: expect.objectContaining({ job_id: STUCK, scope: 'instance', via: 'ui' }) }))
    expect(await recoverProcessingJob(LIVE, 'retry')).toMatchObject({ ok: false, status: 409 })
    expect(await recoverProcessingJob(LIVE, 'cancel', true)).toEqual({ ok: true, action: 'cancel', lease_expired: false, forced: true })
    expect(fake.tables.workflow_queue.find((j) => j.id === LIVE)!.status).toBe('dead')
    expect(auditMock).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'force_cancel_queue_job' }))
  })
})
