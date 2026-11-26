import { beforeEach, describe, expect, it, vi } from 'vitest'

// reorderTasks checked each task's reach one after another (each a chain of
// task / assignee / reporting-line reads) and then fired every update at
// once. Checks now run 8 at a time, all before any write; writes are bounded.
const state = vi.hoisted(() => ({ inFlight: 0, maxInFlight: 0, updates: [] as Array<{ id: string; sequence: number }>, deny: null as string | null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/permissions-server', () => ({ requirePermission: vi.fn(async () => undefined) }))
vi.mock('@/lib/services/context', async (orig) => ({ ...(await orig() as object), fromSession: vi.fn(async () => ({ tenantId: 'ta', actorId: 'u1' })) }))
vi.mock('@/lib/services/tasks', async (orig) => ({
  ...(await orig() as object),
  requireTaskReach: vi.fn(async (_ctx: unknown, id: string) => {
    state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
    await new Promise((r) => setTimeout(r, 20))
    state.inFlight--
    if (id === state.deny) throw new Error('Task not found')
  }),
}))
const writer = vi.hoisted(() => ({
  from: () => {
    const q: any = { _set: null as any, update(v: any) { q._set = v; return q }, eq(col: string, val: string) { if (col === 'id') q._id = val; return q },
      then(resolve: any) { state.updates.push({ id: q._id, sequence: q._set.sequence }); resolve({ error: null }) } }
    return q
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  getCachedUser: vi.fn(async () => ({ id: 'u1' })),
  createClient: vi.fn(async () => writer),
}))
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createActorServiceClient: vi.fn(() => writer) }))

import { reorderTasks } from '@/app/actions/tasks'

describe('reorderTasks', () => {
  beforeEach(() => { state.inFlight = 0; state.maxInFlight = 0; state.updates = []; state.deny = null })

  it('checks reach 8 at a time (not serially) and writes every sequence', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `t${i}`)
    const t0 = Date.now()
    await reorderTasks(ids)
    const ms = Date.now() - t0
    expect(state.maxInFlight).toBe(8)
    expect(ms).toBeLessThan(40 * 20) // serial was >= 800 ms
    expect(state.updates.sort((a, b) => a.sequence - b.sequence).map((u) => u.id)).toEqual(ids)
  })

  it('writes nothing when any task is out of reach', async () => {
    state.deny = 't7'
    await expect(reorderTasks(Array.from({ length: 20 }, (_, i) => `t${i}`))).rejects.toThrow('Task not found')
    expect(state.updates).toEqual([])
  })
})
